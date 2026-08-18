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
        location: {
          businessId: user.businessId,
        },
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
        location: {
          businessId: user.businessId,
        },
      },
    });

    if (!workstation) {
      throw new NotFoundException('Estación de trabajo no encontrada');
    }

    // 3. Evitar relaciones duplicadas
    const existing = await this.prisma.productWorkstation.findUnique({
      where: {
        productId_workstationId: {
          productId: dto.productId,
          workstationId: dto.workstationId,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        'El producto ya está asociado a esta estación',
      );
    }

    // 4. Crear relación
    return this.prisma.productWorkstation.create({
      data: {
        productId: dto.productId,
        workstationId: dto.workstationId,
      },
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
        product: {
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
    const relation = await this.prisma.productWorkstation.findFirst({
      where: {
        productId,
        workstationId,
        product: {
          location: {
            businessId: user.businessId,
          },
        },
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
