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

@Injectable()
export class RestaurantTablesService {
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.restaurantTable.findMany({
      where: {
        locationId,
        status: 'ACTIVE',
      },
      orderBy: {
        name: 'asc',
      },
    });
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
    });

    if (!table) {
      throw new NotFoundException('Mesa no encontrada');
    }

    return table;
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

    return this.prisma.restaurantTable.update({
      where: {
        id,
      },
      data: {
        status: 'INACTIVE',
      },
    });
  }
}
