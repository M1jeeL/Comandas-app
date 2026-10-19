import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma.service.js';

import { CreateTableSessionDto } from './dto/create-table-session.dto.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';
import { Prisma } from '../../generated/prisma/client.js';
import { Role, OrderStatus } from '../../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { serializableTransaction } from '../../common/database/serializable-transaction.js';
import { TransferTableSessionDto } from './dto/transfer-table-session.dto.js';

@Injectable()
export class TableSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Crear una nueva sesión.
   */
  async create(user: JwtUser, dto: CreateTableSessionDto) {
    try {
      return await serializableTransaction(this.prisma, async (tx) => {
        const table = await tx.restaurantTable.findFirst({
          where: { id: dto.tableId, location: { businessId: user.businessId } },
        });
        if (!table)
          throw new ForbiddenException('La mesa no pertenece a tu negocio');
        if (table.status !== 'ACTIVE') {
          throw new ConflictException(
            'No se puede abrir una sesión para una mesa inactiva',
          );
        }
        if (table.operationalStatus !== 'AVAILABLE') {
          throw new ConflictException(
            table.operationalStatus === 'RESERVED'
              ? 'La mesa está reservada y no se puede abrir desde la operación normal'
              : 'La mesa está fuera de servicio y no se puede abrir',
          );
        }
        const membership = await tx.membership.findFirst({
          where: {
            userId: dto.waiterId,
            businessId: user.businessId,
            locationId: table.locationId,
            role: Role.WAITER,
            status: 'ACTIVE',
          },
        });
        if (!membership)
          throw new ForbiddenException(
            'El mesero no pertenece a tu negocio o no está activo',
          );
        const existingSession = await tx.tableSession.findFirst({
          where: { tableId: dto.tableId, status: { in: ['OPEN', 'CLOSING'] } },
        });
        if (existingSession)
          throw new ConflictException('La mesa ya tiene una sesión abierta');
        return tx.tableSession.create({
          data: {
            tableId: dto.tableId,
            waiterId: dto.waiterId,
            status: 'OPEN',
          },
        });
      });
    } catch (error) {
      // La restricción única de PostgreSQL cubre la carrera entre solicitudes.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('La mesa ya tiene una sesión activa');
      }

      throw error;
    }
  }

  /**
   * Obtener sesiones abiertas de una ubicación.
   */
  async findOpenByLocation(user: JwtUser, locationId: string) {
    const location = await this.prisma.location.findFirst({
      where: {
        id: locationId,
        businessId: user.businessId,
        status: 'ACTIVE',
      },
    });

    if (!location) {
      throw new ForbiddenException(
        'La ubicación no pertenece a tu negocio o no está activa',
      );
    }

    return this.prisma.tableSession.findMany({
      where: {
        status: { in: ['OPEN', 'CLOSING'] },
        table: {
          locationId,
        },
      },
      include: {
        table: true,
        waiter: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
      orderBy: {
        openedAt: 'asc',
      },
    });
  }

  /**
   * Obtener una sesión.
   */
  async findOne(user: JwtUser, id: string) {
    const session = await this.prisma.tableSession.findFirst({
      where: {
        id,
        table: {
          location: {
            businessId: user.businessId,
          },
        },
      },
      include: {
        table: true,
        waiter: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Sesión de mesa no encontrada');
    }

    return session;
  }

  /**
   * Cerrar una sesión.
   */
  async close(user: JwtUser, id: string) {
    const session = await this.prisma.tableSession.findFirst({
      where: {
        id,
        status: 'OPEN',
        table: {
          location: {
            businessId: user.businessId,
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Sesión abierta no encontrada');
    }

    return this.prisma.tableSession.update({
      where: {
        id,
      },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
      },
    });
  }

  async transfer(user: JwtUser, id: string, dto: TransferTableSessionDto) {
    if (
      user.role !== Role.OWNER &&
      user.role !== Role.ADMIN &&
      user.role !== Role.MANAGER
    ) {
      throw new ForbiddenException(
        'Solo administración puede transferir la responsabilidad de una mesa',
      );
    }
    return serializableTransaction(this.prisma, async (tx) => {
      const session = await tx.tableSession.findFirst({
        where: {
          id,
          status: 'OPEN',
          table: { location: { businessId: user.businessId } },
        },
        include: {
          waiter: { select: { id: true, firstName: true, lastName: true } },
          table: true,
        },
      });
      if (!session)
        throw new NotFoundException(
          'Sesión abierta no encontrada en el local asignado',
        );
      const target = await tx.membership.findFirst({
        where: {
          userId: dto.waiterId,
          businessId: user.businessId,
          locationId: session.table.locationId,
          role: Role.WAITER,
          status: 'ACTIVE',
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      if (!target)
        throw new NotFoundException(
          'El mesero destino no está activo en este local',
        );
      if (target.userId === session.waiterId) return session;

      const changed = await tx.tableSession.updateMany({
        where: { id: session.id, waiterId: session.waiterId, status: 'OPEN' },
        data: { waiterId: target.userId },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          'La sesión cambió durante la transferencia',
        );
      const affectedOrders = await tx.order.updateMany({
        where: {
          tableSessionId: session.id,
          status: { notIn: [OrderStatus.CLOSED, OrderStatus.CANCELLED] },
        },
        data: { waiterId: target.userId },
      });
      await this.audit.record(tx, {
        businessId: user.businessId,
        locationId: session.table.locationId,
        userId: user.userId,
        action: 'TABLE_SESSION_UPDATED',
        entityType: 'TableSession',
        entityId: session.id,
        metadata: {
          event: 'WAITER_TRANSFERRED',
          tableId: session.tableId,
          fromWaiterId: session.waiterId,
          fromWaiterName: `${session.waiter.firstName} ${session.waiter.lastName}`,
          toWaiterId: target.userId,
          toWaiterName: `${target.user.firstName} ${target.user.lastName}`,
          affectedActiveOrders: affectedOrders.count,
        },
      });
      return tx.tableSession.findUniqueOrThrow({
        where: { id: session.id },
        include: {
          table: true,
          waiter: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });
    });
  }
}
