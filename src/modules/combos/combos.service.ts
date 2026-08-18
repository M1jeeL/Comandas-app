import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma.service.js';

import { CreateComboDto } from './dto/create-combo.dto.js';
import { UpdateComboDto } from './dto/update-combo.dto.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

@Injectable()
export class CombosService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verifica que una Location pertenezca al Business
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
   * Crear combo
   */
  async create(user: JwtUser, dto: CreateComboDto) {
    await this.validateLocationOwnership(dto.locationId, user.businessId);

    // Validación explícita para entregar un error amigable
    // en lugar de dejar que Prisma devuelva P2002.
    const existingCombo = await this.prisma.combo.findFirst({
      where: {
        locationId: dto.locationId,
        name: dto.name,
      },
    });

    if (existingCombo) {
      throw new ConflictException(
        'Ya existe un combo con ese nombre en esta ubicación',
      );
    }

    return this.prisma.combo.create({
      data: {
        locationId: dto.locationId,
        name: dto.name,
        description: dto.description,
        price: dto.price,
      },
    });
  }

  /**
   * Obtener combos de una ubicación
   */
  async findAll(user: JwtUser, locationId: string) {
    await this.validateLocationOwnership(locationId, user.businessId);

    return this.prisma.combo.findMany({
      where: {
        locationId,
        status: 'ACTIVE',
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  /**
   * Obtener un combo
   */
  async findOne(user: JwtUser, id: string) {
    const combo = await this.prisma.combo.findFirst({
      where: {
        id,
        location: {
          businessId: user.businessId,
        },
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!combo) {
      throw new NotFoundException('Combo no encontrado');
    }

    return combo;
  }

  /**
   * Actualizar combo
   */
  async update(user: JwtUser, id: string, dto: UpdateComboDto) {
    const existingCombo = await this.prisma.combo.findFirst({
      where: {
        id,
        location: {
          businessId: user.businessId,
        },
      },
    });

    if (!existingCombo) {
      throw new NotFoundException('Combo no encontrado');
    }

    // Si se cambia locationId, debemos validar que la nueva
    // ubicación también pertenezca al negocio.
    if (dto.locationId) {
      await this.validateLocationOwnership(dto.locationId, user.businessId);
    }

    const targetLocationId = dto.locationId ?? existingCombo.locationId;

    // Evitamos duplicar nombres dentro de la misma ubicación.
    if (dto.name) {
      const duplicate = await this.prisma.combo.findFirst({
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
          'Ya existe un combo con ese nombre en esta ubicación',
        );
      }
    }

    return this.prisma.combo.update({
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
        ...(dto.description !== undefined && {
          description: dto.description,
        }),
        ...(dto.price !== undefined && {
          price: dto.price,
        }),
      },
    });
  }

  /**
   * Eliminación lógica
   */
  async remove(user: JwtUser, id: string) {
    const existingCombo = await this.prisma.combo.findFirst({
      where: {
        id,
        location: {
          businessId: user.businessId,
        },
      },
    });

    if (!existingCombo) {
      throw new NotFoundException('Combo no encontrado');
    }

    return this.prisma.combo.update({
      where: {
        id,
      },
      data: {
        status: 'INACTIVE',
      },
    });
  }
}
