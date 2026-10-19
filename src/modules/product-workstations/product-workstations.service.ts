import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma.service.js';

import { CreateProductWorkstationDto } from './dto/create-product-workstation.dto.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

@Injectable()
export class ProductWorkstationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: JwtUser, dto: CreateProductWorkstationDto) {
    // 1. Verificar que el producto pertenece
    // al business del usuario
    const product = await this.prisma.product.findFirst({
      where: {
        id: dto.productId,
        location: { businessId: user.businessId, status: 'ACTIVE' },
      },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    // 2. Verificar que la workstation pertenece
    // al mismo business
    const workstation = await this.prisma.workstation.findFirst({
      where: {
        id: dto.workstationId,
        locationId: product.locationId,
        status: 'ACTIVE',
      },
    });

    if (!workstation) {
      throw new NotFoundException('Estación de trabajo no encontrada');
    }

    // La asignación es única. POST actúa como reemplazo atómico para que
    // el producto nunca quede asociado a varias estaciones simultáneamente.
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.productWorkstation.findUnique({
        where: { productId: dto.productId },
      });
      if (current?.workstationId === dto.workstationId) return current;
      await tx.productWorkstation.deleteMany({ where: { productId: dto.productId } });
      return tx.productWorkstation.create({
        data: { productId: dto.productId, workstationId: dto.workstationId },
      });
    });
  }

  async findByProduct(user: JwtUser, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        location: {
          businessId: user.businessId,
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    return this.prisma.productWorkstation.findMany({
      where: {
        productId,
        workstation: { locationId: product.locationId },
      },
      include: {
        workstation: true,
      },
      orderBy: {
        workstation: {
          name: 'asc',
        },
      },
    });
  }

  async findByWorkstation(user: JwtUser, workstationId: string) {
    const workstation = await this.prisma.workstation.findFirst({
      where: {
        id: workstationId,
        location: {
          businessId: user.businessId,
        },
      },
    });

    if (!workstation) {
      throw new NotFoundException('Estación de trabajo no encontrada');
    }

    return this.prisma.productWorkstation.findMany({
      where: {
        workstationId,
        workstation: { location: { businessId: user.businessId } },
        product: {
          locationId: workstation.locationId,
          status: 'ACTIVE',
        },
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

  async remove(user: JwtUser, productId: string, workstationId: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        location: { businessId: user.businessId },
      },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    const relation = await this.prisma.productWorkstation.findFirst({
      where: {
        productId,
        workstationId,
        workstation: { locationId: product.locationId },
      },
    });

    if (!relation) {
      throw new NotFoundException('Relación producto-estación no encontrada');
    }

    await this.prisma.productWorkstation.delete({
      where: {
        productId_workstationId: {
          productId,
          workstationId,
        },
      },
    });

    return {
      message: 'Relación eliminada correctamente',
    };
  }
}
