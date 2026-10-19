import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma.service.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

import { RejectCashHandoverDto } from './dto/reject-cash-handover.dto.js';
import { AuditService } from '../audit/audit.service.js';

import {
  CashHandoverStatus,
  CashMovementType,
  CashSessionStatus,
} from '../../generated/prisma/enums.js';
import { serializableTransaction } from '../../common/database/serializable-transaction.js';

@Injectable()
export class CashHandoversService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /**
   * Verifica que una sesión de caja
   * pertenezca al business del usuario.
   */
  private async findSessionForUser(user: JwtUser, cashSessionId: string) {
    const session = await this.prisma.cashSession.findFirst({
      where: {
        id: cashSessionId,
        location: {
          businessId: user.businessId,
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Sesión de caja no encontrada');
    }

    return session;
  }

  /**
   * Verifica que el usuario tenga permisos
   * para recibir/rechazar dinero en caja.
   */
  private async validateCashierRole(user: JwtUser) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId: user.userId,
        businessId: user.businessId,
        status: 'ACTIVE',
        role: {
          in: ['CASHIER', 'ADMIN', 'OWNER'],
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException(
        'No tienes permisos para realizar esta operación de caja',
      );
    }

    return membership;
  }

  /**
   * Obtener todas las entregas de una sesión.
   */
  async findAll(user: JwtUser, cashSessionId: string) {
    await this.findSessionForUser(user, cashSessionId);

    return this.prisma.cashHandover.findMany({
      where: {
        cashSessionId,
      },

      include: {
        waiter: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },

        receiver: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },

        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },

      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Obtener una entrega individual.
   */
  async findOne(user: JwtUser, id: string) {
    const handover = await this.prisma.cashHandover.findFirst({
      where: {
        id,

        cashSession: {
          location: {
            businessId: user.businessId,
          },
        },
      },

      include: {
        waiter: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },

        receiver: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },

        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },

        cashSession: true,
      },
    });

    if (!handover) {
      throw new NotFoundException('Entrega de efectivo no encontrada');
    }

    return handover;
  }

  /**
   * Confirmar entrega.
   *
   * TRANSACCIÓN:
   *
   * 1. PENDING -> CONFIRMED
   * 2. Registrar receivedBy
   * 3. Registrar confirmedAt
   * 4. Crear CashMovement(HANDOVER)
   *
   * El movimiento contable solamente existe
   * después de esta confirmación.
   */
  async confirm(user: JwtUser, id: string) {
    await this.validateCashierRole(user);

    return serializableTransaction(this.prisma, async (tx) => {
      const handover = await tx.cashHandover.findFirst({
        where: {
          id,

          cashSession: {
            location: {
              businessId: user.businessId,
            },
          },
        },

        include: {
          cashSession: true,
        },
      });

      if (!handover) {
        throw new NotFoundException('Entrega de efectivo no encontrada');
      }

      if (handover.status === CashHandoverStatus.CONFIRMED) return handover;

      if (handover.cashSession.status !== CashSessionStatus.OPEN) {
        throw new ConflictException(
          'No se puede confirmar una entrega con la sesión de caja cerrada',
        );
      }

      const sessionLock = await tx.cashSession.updateMany({
        where: { id: handover.cashSessionId, status: CashSessionStatus.OPEN },
        data: { status: CashSessionStatus.OPEN },
      });
      if (sessionLock.count !== 1) {
        throw new ConflictException('La sesión de caja dejó de estar abierta');
      }

      if (handover.status !== CashHandoverStatus.PENDING) {
        throw new ConflictException(
          `La entrega ya se encuentra en estado ${handover.status}`,
        );
      }

      const confirmedAt = new Date();

      const changed = await tx.cashHandover.updateMany({
        where: { id: handover.id, status: CashHandoverStatus.PENDING },
        data: {
          status: CashHandoverStatus.CONFIRMED,
          receivedBy: user.userId,
          confirmedAt,
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException('La entrega ya fue procesada por otra solicitud');
      }
      const confirmed = await tx.cashHandover.findUniqueOrThrow({
        where: { id: handover.id },
      });

      await tx.cashMovement.create({
        data: {
          cashSessionId: handover.cashSessionId,
          type: CashMovementType.HANDOVER,
          amount: handover.amount,
          reason: 'Entrega de efectivo confirmada',
          reference: handover.id,
          createdBy: user.userId,
        },
      });

      await this.audit.record(tx, {
        businessId: user.businessId, locationId: handover.cashSession.locationId, userId: user.userId,
        action: 'CASH_HANDOVER_ACCEPTED', entityType: 'CashHandover', entityId: handover.id,
        metadata: { amount: handover.amount.toString(), paymentId: handover.paymentId },
      });

      return confirmed;
    });
  }

  /**
   * Rechazar entrega.
   *
   * Un rechazo NO genera CashMovement.
   */
  async reject(user: JwtUser, id: string, dto: RejectCashHandoverDto) {
    await this.validateCashierRole(user);

    return serializableTransaction(this.prisma, async (tx) => {
      const handover = await tx.cashHandover.findFirst({
        where: {
          id,

          cashSession: {
            location: {
              businessId: user.businessId,
            },
          },
        },

        include: {
          cashSession: true,
        },
      });

      if (!handover) {
        throw new NotFoundException('Entrega de efectivo no encontrada');
      }

      if (handover.status === CashHandoverStatus.REJECTED) return handover;

      if (handover.cashSession.status !== CashSessionStatus.OPEN) {
        throw new ConflictException(
          'No se puede rechazar una entrega con la sesión de caja cerrada',
        );
      }

      const sessionLock = await tx.cashSession.updateMany({
        where: { id: handover.cashSessionId, status: CashSessionStatus.OPEN },
        data: { status: CashSessionStatus.OPEN },
      });
      if (sessionLock.count !== 1) {
        throw new ConflictException('La sesión de caja dejó de estar abierta');
      }

      if (handover.status !== CashHandoverStatus.PENDING) {
        throw new ConflictException(
          `La entrega ya se encuentra en estado ${handover.status}`,
        );
      }

      const changed = await tx.cashHandover.updateMany({
        where: { id: handover.id, status: CashHandoverStatus.PENDING },
        data: {
          status: CashHandoverStatus.REJECTED,
          rejectReason: dto.reason.trim(),
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException('La entrega ya fue procesada por otra solicitud');
      }
      const rejected = await tx.cashHandover.findUniqueOrThrow({
        where: { id: handover.id },
      });
      await this.audit.record(tx, {
        businessId: user.businessId, locationId: handover.cashSession.locationId, userId: user.userId,
        action: 'CASH_HANDOVER_REJECTED', entityType: 'CashHandover', entityId: handover.id,
        metadata: { amount: handover.amount.toString(), reason: dto.reason.trim(), paymentId: handover.paymentId },
      });
      return rejected;
    });
  }
}
