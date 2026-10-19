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

@Injectable()
export class TableSessionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verifica que la mesa pertenezca al negocio
   * del usuario autenticado.
   */
  private async validateTableOwnership(tableId: string, businessId: string) {
    const table = await this.prisma.restaurantTable.findFirst({
      where: {
        id: tableId,
        location: {
          businessId,
        },
      },
    });

    if (!table) {
      throw new ForbiddenException('La mesa no pertenece a tu negocio');
    }

    return table;
  }

  /**
   * Verifica que el usuario exista y pertenezca
   * al mismo negocio.
   */
  private async validateWaiter(waiterId: string, businessId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId: waiterId,
        businessId,
        status: 'ACTIVE',
      },
    });

    if (!membership) {
      throw new ForbiddenException(
        'El mesero no pertenece a tu negocio o no está activo',
      );
    }

    return membership;
  }

  /**
   * Crear una nueva sesión.
   */
  async create(user: JwtUser, dto: CreateTableSessionDto) {
    // 1. Verificar que la mesa pertenece al negocio.
    const table = await this.validateTableOwnership(
      dto.tableId,
      user.businessId,
    );

    // 2. Verificar que la mesa esté activa.
    if (table.status !== 'ACTIVE') {
      throw new ConflictException(
        'No se puede abrir una sesión para una mesa inactiva',
      );
    }

    // 3. Verificar que el waiter pertenezca
    //    al mismo negocio.
    await this.validateWaiter(dto.waiterId, user.businessId);

    // 4. Verificar que la mesa no tenga
    //    otra sesión abierta.
    const existingSession = await this.prisma.tableSession.findFirst({
      where: {
        tableId: dto.tableId,
        status: { in: ['OPEN', 'CLOSING'] },
      },
    });

    if (existingSession) {
      throw new ConflictException('La mesa ya tiene una sesión abierta');
    }

    // 5. Crear sesión.
    try {
      return await this.prisma.tableSession.create({
        data: {
          tableId: dto.tableId,
          waiterId: dto.waiterId,
          status: 'OPEN',
        },
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
}
