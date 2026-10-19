import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';

import { PrismaService } from '../../prisma.service.js';

import { CreateModifierDto } from './dto/create-modifier.dto.js';
import { UpdateModifierDto } from './dto/update-modifier.dto.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

@Injectable()
export class ModifiersService {
  constructor(private readonly prisma: PrismaService) {}

  // ============================================================
  // CREATE
  // ============================================================

  async create(user: JwtUser, dto: CreateModifierDto) {
    // ----------------------------------------------------------
    // 1. Verificar que el ModifierGroup pertenece
    //    al business del usuario
    // ----------------------------------------------------------

    const group = await this.prisma.modifierGroup.findFirst({
      where: {
        id: dto.groupId,

        location: {
          businessId: user.businessId,
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Modifier group not found');
    }

    // ----------------------------------------------------------
    // 2. Verificar que el Product pertenece
    //    al business del usuario
    // ----------------------------------------------------------

    const product = await this.prisma.product.findFirst({
      where: {
        id: dto.productId,

        location: {
          businessId: user.businessId,
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // ----------------------------------------------------------
    // 3. El grupo y el producto deben pertenecer
    //    a la misma Location
    // ----------------------------------------------------------

    if (group.locationId !== product.locationId) {
      throw new ConflictException(
        'Modifier group and product must belong to the same location',
      );
    }

    // ----------------------------------------------------------
    // 4. Crear Modifier
    // ----------------------------------------------------------

    try {
      return await this.prisma.modifier.create({
        data: {
          groupId: dto.groupId,
          productId: dto.productId,
          name: dto.name,
          priceDelta: dto.priceDelta ?? 0,
        },
      });
    } catch (error) {
      // --------------------------------------------------------
      // PostgreSQL:
      //
      // @@unique([productId, groupId, name])
      //
      // Prisma:
      //
      // P2002
      // --------------------------------------------------------

      if (
        error instanceof PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A modifier with this name already exists for this product and modifier group',
        );
      }

      throw error;
    }
  }

  // ============================================================
  // FIND ALL
  // ============================================================

  async findAll(user: JwtUser, productId?: string, groupId?: string, locationId?: string) {
    const scopedLocationId = locationId ?? (user.role === 'OWNER' || user.role === 'ADMIN' ? undefined : user.locationId);
    return this.prisma.modifier.findMany({
      where: {
        active: true,

        ...(productId && {
          productId,
        }),

        ...(groupId && {
          groupId,
        }),

        product: {
          ...(scopedLocationId ? { locationId: scopedLocationId } : {}),
          location: {
            businessId: user.businessId,
          },
        },
      },

      orderBy: {
        name: 'asc',
      },
    });
  }

  // ============================================================
  // FIND ONE
  // ============================================================

  async findOne(user: JwtUser, id: string) {
    const modifier = await this.prisma.modifier.findFirst({
      where: {
        id,

        product: {
          location: {
            businessId: user.businessId,
          },
        },
      },
    });

    if (!modifier) {
      throw new NotFoundException('Modifier not found');
    }

    return modifier;
  }

  // ============================================================
  // UPDATE
  // ============================================================

  async update(user: JwtUser, id: string, dto: UpdateModifierDto) {
    // ----------------------------------------------------------
    // 1. Buscar Modifier dentro del business
    // ----------------------------------------------------------

    const modifier = await this.prisma.modifier.findFirst({
      where: {
        id,

        product: {
          location: {
            businessId: user.businessId,
          },
        },
      },
    });

    if (!modifier) {
      throw new NotFoundException('Modifier not found');
    }

    // ----------------------------------------------------------
    // 2. Determinar los valores finales
    // ----------------------------------------------------------

    const finalGroupId = dto.groupId ?? modifier.groupId;

    const finalProductId = dto.productId ?? modifier.productId;

    // ----------------------------------------------------------
    // 3. Validar ModifierGroup
    // ----------------------------------------------------------

    const group = await this.prisma.modifierGroup.findFirst({
      where: {
        id: finalGroupId,

        location: {
          businessId: user.businessId,
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Modifier group not found');
    }

    // ----------------------------------------------------------
    // 4. Validar Product
    // ----------------------------------------------------------

    const product = await this.prisma.product.findFirst({
      where: {
        id: finalProductId,

        location: {
          businessId: user.businessId,
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // ----------------------------------------------------------
    // 5. Group y Product deben pertenecer
    //    a la misma Location
    // ----------------------------------------------------------

    if (group.locationId !== product.locationId) {
      throw new ConflictException(
        'Modifier group and product must belong to the same location',
      );
    }

    // ----------------------------------------------------------
    // 6. Actualizar
    // ----------------------------------------------------------

    try {
      return await this.prisma.modifier.update({
        where: {
          id,
        },

        data: {
          ...(dto.groupId !== undefined && {
            groupId: dto.groupId,
          }),

          ...(dto.productId !== undefined && {
            productId: dto.productId,
          }),

          ...(dto.name !== undefined && {
            name: dto.name,
          }),

          ...(dto.priceDelta !== undefined && {
            priceDelta: dto.priceDelta,
          }),

          ...(dto.active !== undefined && {
            active: dto.active,
          }),
        },
      });
    } catch (error) {
      // --------------------------------------------------------
      // Ejemplo:
      //
      // Queso
      // Tocino
      //
      // PATCH Tocino -> Queso
      //
      // PostgreSQL detecta:
      //
      // productId + groupId + name
      //
      // duplicado.
      // --------------------------------------------------------

      if (
        error instanceof PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A modifier with this name already exists for this product and modifier group',
        );
      }

      throw error;
    }
  }

  // ============================================================
  // REMOVE
  // ============================================================

  async remove(user: JwtUser, id: string) {
    const modifier = await this.prisma.modifier.findFirst({
      where: {
        id,

        product: {
          location: {
            businessId: user.businessId,
          },
        },
      },
    });

    if (!modifier) {
      throw new NotFoundException('Modifier not found');
    }

    // Soft delete
    return this.prisma.modifier.update({
      where: {
        id,
      },

      data: {
        active: false,
      },
    });
  }
}
