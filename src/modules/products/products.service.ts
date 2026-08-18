import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async create(user: JwtUser, dto: CreateProductDto) {
    const location = await this.prisma.location.findFirst({
      where: {
        id: dto.locationId,
        businessId: user.businessId,
        status: 'ACTIVE',
      },
    });

    if (!location) {
      throw new NotFoundException('Location no encontrada');
    }

    if (dto.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: {
          id: dto.categoryId,
          locationId: dto.locationId,
          status: 'ACTIVE',
        },
      });

      if (!category) {
        throw new NotFoundException(
          'Category no encontrada para esta Location',
        );
      }
    }

    return this.prisma.product.create({
      data: {
        locationId: dto.locationId,
        categoryId: dto.categoryId,
        name: dto.name,
        description: dto.description,
        price: dto.price,
      },
    });
  }

  async findAll(user: JwtUser, locationId?: string) {
    if (locationId) {
      const location = await this.prisma.location.findFirst({
        where: {
          id: locationId,
          businessId: user.businessId,
          status: 'ACTIVE',
        },
      });

      if (!location) {
        throw new NotFoundException('Location no encontrada');
      }
    }

    return this.prisma.product.findMany({
      where: {
        location: {
          businessId: user.businessId,
        },
        ...(locationId && {
          locationId,
        }),
        status: 'ACTIVE',
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  async findOne(user: JwtUser, id: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        location: {
          businessId: user.businessId,
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    return product;
  }

  async update(user: JwtUser, id: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        location: {
          businessId: user.businessId,
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    if (dto.locationId) {
      const location = await this.prisma.location.findFirst({
        where: {
          id: dto.locationId,
          businessId: user.businessId,
          status: 'ACTIVE',
        },
      });

      if (!location) {
        throw new NotFoundException('Location no encontrada');
      }
    }

    if (dto.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: {
          id: dto.categoryId,
          locationId: dto.locationId ?? product.locationId,
          status: 'ACTIVE',
        },
      });

      if (!category) {
        throw new NotFoundException(
          'Category no encontrada para esta Location',
        );
      }
    }

    return this.prisma.product.update({
      where: {
        id: product.id,
      },
      data: dto,
    });
  }

  async remove(user: JwtUser, id: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        location: {
          businessId: user.businessId,
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    return this.prisma.product.update({
      where: {
        id: product.id,
      },
      data: {
        status: 'INACTIVE',
      },
    });
  }
}
