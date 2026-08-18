import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { CreateLocationDto } from './dto/create-location.dto.js';
import { UpdateLocationDto } from './dto/update-location.dto.js';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: JwtUser, dto: CreateLocationDto) {
    const business = await this.prisma.business.findUnique({
      where: {
        id: user.businessId,
      },
    });

    if (!business) {
      throw new NotFoundException('Business not found');
    }

    return this.prisma.location.create({
      data: {
        ...dto,
        businessId: user.businessId,
      },
    });
  }

  // Traer todos los Location asociados al BusinessID del usuario logeado
  async findAll(user: JwtUser) {
    return this.prisma.location.findMany({
      where: {
        businessId: user.businessId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(user: JwtUser, id: string) {
    const location = await this.prisma.location.findUnique({
      where: {
        id,
        businessId: user.businessId,
      },
    });

    if (!location) {
      throw new NotFoundException('Location not found');
    }

    return location;
  }

  async update(user: JwtUser, id: string, dto: UpdateLocationDto) {
    await this.findOne(user, id);

    if (user.businessId) {
      const business = await this.prisma.business.findUnique({
        where: {
          id: user.businessId,
        },
      });

      if (!business) {
        throw new NotFoundException('Business not found');
      }
    }

    return this.prisma.location.update({
      where: {
        id,
      },
      data: dto,
    });
  }
}
