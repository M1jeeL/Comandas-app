import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma.service.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

import { OpenCashSessionDto } from './dto/open-cash-session.dto.js';
import { CloseCashSessionDto } from './dto/close-cash-session.dto.js';

import {
  CashHandoverStatus,
  CashMovementType,
  CashSessionStatus,
} from '../../generated/prisma/enums.js';

import { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { serializableTransaction } from '../../common/database/serializable-transaction.js';

@Injectable()
export class CashSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Verifica que la Location pertenezca
   * al Business del usuario autenticado.
   */
  private async findLocationForUser(user: JwtUser, locationId: string) {
    const location = await this.prisma.location.findFirst({
      where: {
        id: locationId,

        businessId: user.businessId,
      },
    });

    if (!location) {
      throw new NotFoundException('Localización no encontrada');
    }

    return location;
  }

  /**
   * Abrir una nueva sesión de caja.
   */
  async open(user: JwtUser, locationId: string, dto: OpenCashSessionDto) {
    await this.findLocationForUser(user, locationId);

    try {
      return await serializableTransaction(this.prisma, async (tx) => {
        /**
         * Verificar si ya existe
         * una sesión abierta.
         */
        const existingSession = await tx.cashSession.findFirst({
          where: {
            locationId,

            status: CashSessionStatus.OPEN,
          },
        });

        if (existingSession) {
          throw new ConflictException(
            'Ya existe una sesión de caja abierta para esta localización',
          );
        }

        const openingAmount = new Prisma.Decimal(dto.openingAmount);

        const session = await tx.cashSession.create({
          data: {
            locationId,

            openedBy: user.userId,

            status: CashSessionStatus.OPEN,

            openingAmount,
          },
        });

        await this.audit.record(tx, {
          businessId: user.businessId,
          locationId,
          userId: user.userId,
          action: 'CASH_SESSION_OPENED',
          entityType: 'CashSession',
          entityId: session.id,
          metadata: { openingAmount: openingAmount.toString() },
        });

        return session;
      });
    } catch (error) {
      if ((error as { code?: string } | null)?.code === 'P2002') {
        throw new ConflictException(
          'Ya existe una sesión de caja abierta para esta localización',
        );
      }
      throw error;
    }
  }

  /**
   * Obtener la sesión actualmente abierta.
   */
  async getCurrent(user: JwtUser, locationId: string) {
    await this.findLocationForUser(user, locationId);

    const session = await this.prisma.cashSession.findFirst({
      where: {
        locationId,

        status: CashSessionStatus.OPEN,
      },

      include: {
        movements: {
          orderBy: {
            createdAt: 'asc',
          },
        },

        handovers: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('No existe una sesión de caja abierta');
    }
    const salePaymentIds = session.movements
      .filter(
        (movement) =>
          movement.type === CashMovementType.SALE && movement.reference,
      )
      .map((movement) => movement.reference!);
    const payments = salePaymentIds.length
      ? await this.prisma.payment.findMany({
          where: { id: { in: salePaymentIds }, bill: { locationId } },
          select: {
            id: true,
            method: true,
            status: true,
            amount: true,
            bill: {
              select: {
                id: true,
                orders: {
                  select: {
                    order: {
                      select: {
                        id: true,
                        type: true,
                        customerName: true,
                        tableSession: {
                          select: { table: { select: { name: true } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        })
      : [];
    const paymentById = new Map(
      payments.map((payment) => [payment.id, payment]),
    );
    return {
      ...session,
      movements: session.movements.map((movement) => ({
        ...movement,
        directPayment:
          movement.type === CashMovementType.SALE && movement.reference
            ? (paymentById.get(movement.reference) ?? null)
            : null,
      })),
    };
  }

  /**
   * Obtener una sesión específica.
   */
  async findOne(user: JwtUser, id: string) {
    const session = await this.prisma.cashSession.findFirst({
      where: {
        id,

        location: {
          businessId: user.businessId,
        },
      },

      include: {
        movements: {
          orderBy: {
            createdAt: 'asc',
          },
        },

        handovers: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Sesión de caja no encontrada');
    }

    return session;
  }

  /**
   * Cerrar una sesión.
   *
   * IMPORTANTE:
   *
   * Los CashHandover CONFIRMED ya generan
   * un CashMovement de tipo HANDOVER.
   *
   * Por lo tanto NO debemos sumar CashHandover
   * directamente al cálculo.
   *
   * Toda la contabilidad de efectivo se calcula
   * exclusivamente desde CashMovement.
   */
  async close(user: JwtUser, id: string, dto: CloseCashSessionDto) {
    return serializableTransaction(this.prisma, async (tx) => {
      const session = await tx.cashSession.findFirst({
        where: {
          id,
          location: {
            businessId: user.businessId,
          },
        },
        include: {
          movements: true,
          handovers: {
            where: {
              status: CashHandoverStatus.PENDING,
            },
          },
        },
      });

      if (!session) {
        throw new NotFoundException('Sesión de caja no encontrada');
      }

      if (session.status === CashSessionStatus.CLOSED) {
        throw new ConflictException('La sesión de caja ya está cerrada');
      }

      if (session.handovers.length > 0) {
        throw new ConflictException(
          'No se puede cerrar la sesión mientras existan entregas de efectivo pendientes',
        );
      }

      const closingAmount = new Prisma.Decimal(dto.closingAmount);

      /**
       * ------------------------------------------------
       * Calcular movimientos de caja
       * ------------------------------------------------
       *
       * Todo movimiento confirmado de efectivo
       * debe estar representado aquí.
       */
      const movementBalance = session.movements.reduce((total, movement) => {
        const amount = new Prisma.Decimal(movement.amount);

        switch (movement.type) {
          case CashMovementType.SALE:
          case CashMovementType.DEPOSIT:
          case CashMovementType.HANDOVER:
          case CashMovementType.ADJUSTMENT:
            return total.add(amount);

          case CashMovementType.WITHDRAWAL:
          case CashMovementType.REFUND:
            return total.sub(amount);

          default:
            return total;
        }
      }, new Prisma.Decimal(0));

      /**
       * ------------------------------------------------
       * Expected Amount
       * ------------------------------------------------
       *
       * IMPORTANTE:
       *
       * CashHandover NO se suma aquí.
       *
       * Un HANDOVER confirmado ya tiene su
       * CashMovement correspondiente.
       */
      const expectedAmount = new Prisma.Decimal(session.openingAmount).add(
        movementBalance,
      );

      /**
       * ------------------------------------------------
       * Difference
       * ------------------------------------------------
       */
      const difference = closingAmount.sub(expectedAmount);

      /**
       * ------------------------------------------------
       * Cerrar sesión
       * ------------------------------------------------
       */
      const closed = await tx.cashSession.updateMany({
        where: { id: session.id, status: CashSessionStatus.OPEN },
        data: {
          status: CashSessionStatus.CLOSED,

          closedBy: user.userId,

          closedAt: new Date(),

          closingAmount,

          expectedAmount,

          difference,
        },
      });
      if (closed.count !== 1) {
        throw new ConflictException('La sesión de caja ya fue cerrada');
      }
      const closedSession = await tx.cashSession.findUniqueOrThrow({
        where: { id: session.id },
      });

      await this.audit.record(tx, {
        businessId: user.businessId,
        locationId: session.locationId,
        userId: user.userId,
        action: 'CASH_SESSION_CLOSED',
        entityType: 'CashSession',
        entityId: session.id,
        metadata: {
          closingAmount: closingAmount.toString(),
          expectedAmount: expectedAmount.toString(),
          difference: difference.toString(),
        },
      });

      return closedSession;
    });
  }
}
