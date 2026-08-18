import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma.service.js';

import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  private async validateLocation(user: JwtUser, locationId: string) {
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

    return location;
  }

  async create(user: JwtUser, locationId: string, dto: CreateCategoryDto) {
    await this.validateLocation(user, locationId);

    const existingCategory = await this.prisma.category.findFirst({
      where: {
        locationId,
        name: dto.name,
      },
    });

    if (existingCategory) {
      throw new ConflictException(
        'Ya existe una categoría con ese nombre en esta ubicación',
      );
    }

    return this.prisma.category.create({
      data: {
        locationId,
        name: dto.name,
      },
    });
  }

  async findAll(user: JwtUser, locationId: string) {
    await this.validateLocation(user, locationId);

    return this.prisma.category.findMany({
      where: {
        locationId,
        status: 'ACTIVE',
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  async findOne(user: JwtUser, locationId: string, id: string) {
    await this.validateLocation(user, locationId);

    const category = await this.prisma.category.findFirst({
      where: {
        id,
        locationId,
      },
    });

    if (!category) {
      throw new NotFoundException('Categoría no encontrada');
    }

    return category;
  }

  async update(
    user: JwtUser,
    locationId: string,
    id: string,
    dto: UpdateCategoryDto,
  ) {
    await this.validateLocation(user, locationId);

    const category = await this.prisma.category.findFirst({
      where: {
        id,
        locationId,
      },
    });

    if (!category) {
      throw new NotFoundException('Categoría no encontrada');
    }

    if (dto.name) {
      const existingCategory = await this.prisma.category.findFirst({
        where: {
          locationId,
          name: dto.name,
          NOT: {
            id,
          },
        },
      });

      if (existingCategory) {
        throw new ConflictException(
          'Ya existe una categoría con ese nombre en esta ubicación',
        );
      }
    }

    return this.prisma.category.update({
      where: {
        id,
      },
      data: dto,
    });
  }

  async remove(user: JwtUser, locationId: string, id: string) {
    await this.validateLocation(user, locationId);

    const category = await this.prisma.category.findFirst({
      where: {
        id,
        locationId,
      },
    });

    if (!category) {
      throw new NotFoundException('Categoría no encontrada');
    }

    return this.prisma.category.update({
      where: {
        id,
      },
      data: {
        status: 'INACTIVE',
      },
    });
  }
}
