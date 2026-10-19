import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma.service.js';

import { CreateRestaurantTableDto } from './dto/create-restaurant-table.dto.js';
import { UpdateRestaurantTableDto } from './dto/update-restaurant-table.dto.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';
import { Role, TableOperationalStatus } from '../../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { serializableTransaction } from '../../common/database/serializable-transaction.js';
import { UpdateTableOperationalStatusDto } from './dto/update-table-operational-status.dto.js';

@Injectable()
export class RestaurantTablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private present<
    T extends {
      operationalStatus: TableOperationalStatus;
      sessions: unknown[];
    },
  >(table: T) {
    const occupied = table.sessions?.length > 0;
    const { sessions: _sessions, ...data } = table;
    return {
      ...data,
      operationalStatus: occupied ? 'OCCUPIED' : table.operationalStatus,
    };
  }

  /**
   * Verifica que la Location pertenezca al Business
   * del usuario autenticado.
   */
  private async validateLocationOwnership(
    locationId: string,
    businessId: string,
  ) {
    const location = await this.prisma.location.findFirst({
      where: {
        id: locationId,
        businessId,
        status: 'ACTIVE',
      },
    });

    if (!location) {
      throw new ForbiddenException(
        'La ubicación no pertenece a tu negocio o no está activa',
      );
    }

    return location;
  }

  /**
   * Crear mesa
   */
  async create(user: JwtUser, dto: CreateRestaurantTableDto) {
    await this.validateLocationOwnership(dto.locationId, user.businessId);

    // Validación amigable antes de que Prisma lance P2002.
    const existingTable = await this.prisma.restaurantTable.findFirst({
      where: {
        locationId: dto.locationId,
        name: dto.name,
      },
    });

    if (existingTable) {
      throw new ConflictException(
        'Ya existe una mesa con ese nombre en esta ubicación',
      );
    }

    return this.prisma.restaurantTable.create({
      data: {
        locationId: dto.locationId,
        name: dto.name,
        capacity: dto.capacity,
      },
    });
  }

  /**
   * Obtener mesas de una ubicación.
   */
  async findAll(user: JwtUser, locationId: string) {
    await this.validateLocationOwnership(locationId, user.businessId);

    const tables = await this.prisma.restaurantTable.findMany({
      where: {
        locationId,
        status: 'ACTIVE',
      },
      orderBy: {
        name: 'asc',
      },
      include: {
        sessions: {
          where: { status: { in: ['OPEN', 'CLOSING'] } },
          select: { id: true },
          take: 1,
        },
      },
    });
    return tables.map((table) => this.present(table));
  }

  /**
   * Obtener una mesa.
   */
  async findOne(user: JwtUser, id: string) {
    const table = await this.prisma.restaurantTable.findFirst({
      where: {
        id,
        location: {
          businessId: user.businessId,
        },
      },
      include: {
        sessions: {
          where: { status: { in: ['OPEN', 'CLOSING'] } },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!table) {
      throw new NotFoundException('Mesa no encontrada');
    }

    return this.present(table);
  }

  /**
   * Actualizar mesa.
   */
  async update(user: JwtUser, id: string, dto: UpdateRestaurantTableDto) {
    const existingTable = await this.prisma.restaurantTable.findFirst({
      where: {
        id,
        location: {
          businessId: user.businessId,
        },
      },
    });

    if (!existingTable) {
      throw new NotFoundException('Mesa no encontrada');
    }

    if (dto.locationId && dto.locationId !== existingTable.locationId) {
      const openSession = await this.prisma.tableSession.findFirst({
        where: { tableId: id, status: { in: ['OPEN', 'CLOSING'] } },
      });
      if (openSession)
        throw new ConflictException(
          'No se puede mover una mesa con una sesión activa',
        );
    }

    // Si se intenta mover la mesa a otra ubicación,
    // debemos verificar que esa ubicación pertenezca
    // al mismo negocio.
    if (dto.locationId) {
      await this.validateLocationOwnership(dto.locationId, user.businessId);
    }

    const targetLocationId = dto.locationId ?? existingTable.locationId;

    // Evitar nombres duplicados dentro de la misma ubicación.
    if (dto.name) {
      const duplicate = await this.prisma.restaurantTable.findFirst({
        where: {
          locationId: targetLocationId,
          name: dto.name,
          NOT: {
            id,
          },
        },
      });

      if (duplicate) {
        throw new ConflictException(
          'Ya existe una mesa con ese nombre en esta ubicación',
        );
      }
    }

    return this.prisma.restaurantTable.update({
      where: {
        id,
      },
      data: {
        ...(dto.locationId !== undefined && {
          locationId: dto.locationId,
        }),

        ...(dto.name !== undefined && {
          name: dto.name,
        }),

        ...(dto.capacity !== undefined && {
          capacity: dto.capacity,
        }),
      },
    });
  }

  async updateOperationalStatus(
    user: JwtUser,
    id: string,
    dto: UpdateTableOperationalStatusDto,
  ) {
    if (
      !([Role.OWNER, Role.ADMIN, Role.MANAGER] as Role[]).includes(user.role)
    ) {
      throw new ForbiddenException(
        'Solo administración puede cambiar la disponibilidad de una mesa',
      );
    }
    const table = await this.prisma.restaurantTable.findFirst({
      where: {
        id,
        status: 'ACTIVE',
        location: { businessId: user.businessId },
      },
      select: { id: true, locationId: true, operationalStatus: true },
    });
    if (!table) throw new NotFoundException('Mesa activa no encontrada');
    return serializableTransaction(this.prisma, async (tx) => {
      const activeSession = await tx.tableSession.findFirst({
        where: { tableId: id, status: { in: ['OPEN', 'CLOSING'] } },
        select: { id: true },
      });
      if (activeSession)
        throw new ConflictException(
          'Cierra la atención antes de cambiar la disponibilidad de la mesa',
        );
      const changed = await tx.restaurantTable.updateMany({
        where: {
          id,
          status: 'ACTIVE',
          operationalStatus: table.operationalStatus,
        },
        data: { operationalStatus: dto.operationalStatus },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          'La mesa cambió durante la actualización; actualiza la vista',
        );
      await this.audit.record(tx, {
        businessId: user.businessId,
        locationId: table.locationId,
        userId: user.userId,
        action: 'STATUS_CHANGE',
        entityType: 'RestaurantTable',
        entityId: id,
        metadata: {
          event: 'OPERATIONAL_STATUS_CHANGED',
          from: table.operationalStatus,
          to: dto.operationalStatus,
        },
      });
      return tx.restaurantTable.findUniqueOrThrow({ where: { id } });
    });
  }

  /**
   * Eliminación lógica.
   */
  async remove(user: JwtUser, id: string) {
    const existingTable = await this.prisma.restaurantTable.findFirst({
      where: {
        id,
        location: {
          businessId: user.businessId,
        },
      },
    });

    if (!existingTable) {
      throw new NotFoundException('Mesa no encontrada');
    }

    return serializableTransaction(this.prisma, async (tx) => {
      const activeSession = await tx.tableSession.findFirst({
        where: { tableId: id, status: { in: ['OPEN', 'CLOSING'] } },
        select: { id: true },
      });
      if (activeSession)
        throw new ConflictException(
          'No puedes desactivar una mesa con una sesión activa',
        );
      return tx.restaurantTable.update({
        where: { id },
        data: { status: 'INACTIVE' },
      });
    });
  }
}
