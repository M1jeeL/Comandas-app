import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma.service.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

import { CreateCashMovementDto } from './dto/create-cash-movement.dto.js';

import {
  CashMovementType,
  CashSessionStatus,
} from '../../generated/prisma/enums.js';

import { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class CashMovementsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /**
   * Verifica que la sesión pertenezca
   * al negocio del usuario autenticado.
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
   * Crea un movimiento manual de caja.
   */
  async create(
    user: JwtUser,
    cashSessionId: string,
    dto: CreateCashMovementDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.cashSession.findFirst({
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

      /**
       * Nunca permitimos movimientos sobre
       * una sesión cerrada.
       */
      if (session.status !== CashSessionStatus.OPEN) {
        throw new ConflictException(
          'No se pueden registrar movimientos en una sesión de caja cerrada',
        );
      }

      /**
       * SALE y HANDOVER no deberían ser creados
       * manualmente.
       *
       * Posteriormente serán generados por los flujos
       * correspondientes.
       */
      if (
        dto.type === CashMovementType.SALE ||
        dto.type === CashMovementType.HANDOVER
      ) {
        throw new BadRequestException(
          'Los movimientos SALE y HANDOVER son generados por sus respectivos flujos',
        );
      }

      /**
       * Validaciones específicas.
       */
      if (dto.type === CashMovementType.WITHDRAWAL && !dto.reason?.trim()) {
        throw new BadRequestException('Un retiro de caja requiere un motivo');
      }

      if (dto.type === CashMovementType.DEPOSIT && !dto.reason?.trim()) {
        throw new BadRequestException('Un depósito de caja requiere un motivo');
      }

      if (dto.type === CashMovementType.ADJUSTMENT && !dto.reason?.trim()) {
        throw new BadRequestException('Un ajuste de caja requiere un motivo');
      }

      const amount = new Prisma.Decimal(dto.amount);

      const movement = await tx.cashMovement.create({
        data: {
          cashSessionId: session.id,

          type: dto.type,

          amount,

          reason: dto.reason?.trim() || null,

          reference: dto.reference?.trim() || null,

          createdBy: user.userId,
        },
      });

      await this.audit.record(tx, {
        businessId: user.businessId, locationId: session.locationId, userId: user.userId,
        action: dto.type === CashMovementType.ADJUSTMENT ? 'CASH_ADJUSTMENT' : 'CASH_MOVEMENT_CREATED',
        entityType: 'CashMovement', entityId: movement.id,
        metadata: { type: movement.type, amount: movement.amount.toString(), reason: movement.reason, reference: movement.reference },
      });

      return movement;
    });
  }

  /**
   * Obtener los movimientos de una sesión.
   */
  async findAll(user: JwtUser, cashSessionId: string) {
    const session = await this.findSessionForUser(user, cashSessionId);

    return this.prisma.cashMovement.findMany({
      where: {
        cashSessionId: session.id,
      },

      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },

      orderBy: {
        createdAt: 'asc',
      },
    });
  }
  /**
   * Obtener movimiento individual.
   */
  async findOne(user: JwtUser, id: string) {
    const movement = await this.prisma.cashMovement.findFirst({
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
        user: true,
      },
    });

    if (!movement) {
      throw new NotFoundException('Movimiento de caja no encontrado');
    }

    return movement;
  }
}
