import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma.service.js';

import { CreateComboItemDto } from './dto/create-combo-item.dto.js';
import { UpdateComboItemDto } from './dto/update-combo-item.dto.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

@Injectable()
export class ComboItemsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Obtiene el combo verificando que pertenece
   * al negocio del usuario autenticado.
   */
  private async getAuthorizedCombo(comboId: string, businessId: string) {
    const combo = await this.prisma.combo.findFirst({
      where: {
        id: comboId,
        location: {
          businessId,
        },
      },
    });

    if (!combo) {
      throw new NotFoundException('Combo no encontrado');
    }

    return combo;
  }

  /**
   * Crear item dentro de un combo.
   */
  async create(user: JwtUser, comboId: string, dto: CreateComboItemDto) {
    const combo = await this.getAuthorizedCombo(comboId, user.businessId);

    // El producto debe pertenecer a la misma Location
    // que el combo.
    const product = await this.prisma.product.findFirst({
      where: {
        id: dto.productId,
        locationId: combo.locationId,
        status: 'ACTIVE',
      },
    });

    if (!product) {
      throw new ForbiddenException(
        'El producto no pertenece a la ubicación del combo o no está activo',
      );
    }

    // Validación amigable antes de P2002.
    const existingItem = await this.prisma.comboItem.findUnique({
      where: {
        comboId_productId: {
          comboId,
          productId: dto.productId,
        },
      },
    });

    if (existingItem) {
      throw new ConflictException('El producto ya pertenece a este combo');
    }

    return this.prisma.comboItem.create({
      data: {
        comboId,
        productId: dto.productId,
        quantity: dto.quantity,
      },
      include: {
        product: true,
      },
    });
  }

  /**
   * Obtener todos los productos del combo.
   */
  async findAll(user: JwtUser, comboId: string) {
    await this.getAuthorizedCombo(comboId, user.businessId);

    return this.prisma.comboItem.findMany({
      where: {
        comboId,
      },
      include: {
        product: true,
      },
      orderBy: {
        product: {
          name: 'asc',
        },
      },
    });
  }

  /**
   * Obtener un item.
   */
  async findOne(user: JwtUser, comboId: string, itemId: string) {
    await this.getAuthorizedCombo(comboId, user.businessId);

    const item = await this.prisma.comboItem.findFirst({
      where: {
        id: itemId,
        comboId,
      },
      include: {
        product: true,
      },
    });

    if (!item) {
      throw new NotFoundException('Item del combo no encontrado');
    }

    return item;
  }

  /**
   * Actualizar item.
   */
  async update(
    user: JwtUser,
    comboId: string,
    itemId: string,
    dto: UpdateComboItemDto,
  ) {
    const combo = await this.getAuthorizedCombo(comboId, user.businessId);

    const existingItem = await this.prisma.comboItem.findFirst({
      where: {
        id: itemId,
        comboId,
      },
    });

    if (!existingItem) {
      throw new NotFoundException('Item del combo no encontrado');
    }

    // Si cambiamos de producto, debemos comprobar
    // nuevamente que pertenezca a la misma location.
    if (dto.productId) {
      const product = await this.prisma.product.findFirst({
        where: {
          id: dto.productId,
          locationId: combo.locationId,
          status: 'ACTIVE',
        },
      });

      if (!product) {
        throw new ForbiddenException(
          'El producto no pertenece a la ubicación del combo o no está activo',
        );
      }

      const duplicate = await this.prisma.comboItem.findFirst({
        where: {
          comboId,
          productId: dto.productId,
          NOT: {
            id: itemId,
          },
        },
      });

      if (duplicate) {
        throw new ConflictException('El producto ya pertenece a este combo');
      }
    }

    return this.prisma.comboItem.update({
      where: {
        id: itemId,
      },
      data: {
        ...(dto.productId !== undefined && {
          productId: dto.productId,
        }),
        ...(dto.quantity !== undefined && {
          quantity: dto.quantity,
        }),
      },
      include: {
        product: true,
      },
    });
  }

  /**
   * Eliminar item del combo.
   */
  async remove(user: JwtUser, comboId: string, itemId: string) {
    await this.getAuthorizedCombo(comboId, user.businessId);

    const existingItem = await this.prisma.comboItem.findFirst({
      where: {
        id: itemId,
        comboId,
      },
    });

    if (!existingItem) {
      throw new NotFoundException('Item del combo no encontrado');
    }

    return this.prisma.comboItem.delete({
      where: {
        id: itemId,
      },
    });
  }
}
