import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma.service.js';

import { CreateWorkstationDto } from './dto/create-workstation.dto.js';
import { UpdateWorkstationDto } from './dto/update-workstation.dto.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

@Injectable()
export class WorkstationsService {
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

  async create(user: JwtUser, locationId: string, dto: CreateWorkstationDto) {
    await this.validateLocation(user, locationId);

    const existing = await this.prisma.workstation.findFirst({
      where: {
        locationId,
        name: dto.name,
      },
    });

    if (existing) {
      throw new ConflictException(
        'Ya existe una estación con ese nombre en esta ubicación',
      );
    }

    return this.prisma.workstation.create({
      data: {
        locationId,
        name: dto.name,
      },
    });
  }

  async findAll(user: JwtUser, locationId: string) {
    await this.validateLocation(user, locationId);

    return this.prisma.workstation.findMany({
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

    const workstation = await this.prisma.workstation.findFirst({
      where: {
        id,
        locationId,
      },
    });

    if (!workstation) {
      throw new NotFoundException('Estación no encontrada');
    }

    return workstation;
  }

  async update(
    user: JwtUser,
    locationId: string,
    id: string,
    dto: UpdateWorkstationDto,
  ) {
    await this.validateLocation(user, locationId);

    const workstation = await this.prisma.workstation.findFirst({
      where: {
        id,
        locationId,
      },
    });

    if (!workstation) {
      throw new NotFoundException('Estación no encontrada');
    }

    if (dto.name) {
      const existing = await this.prisma.workstation.findFirst({
        where: {
          locationId,
          name: dto.name,
          NOT: {
            id,
          },
        },
      });

      if (existing) {
        throw new ConflictException(
          'Ya existe una estación con ese nombre en esta ubicación',
        );
      }
    }

    return this.prisma.workstation.update({
      where: {
        id,
      },
      data: dto,
    });
  }

  async remove(user: JwtUser, locationId: string, id: string) {
    await this.validateLocation(user, locationId);

    const workstation = await this.prisma.workstation.findFirst({
      where: {
        id,
        locationId,
      },
    });

    if (!workstation) {
      throw new NotFoundException('Estación no encontrada');
    }

    return this.prisma.workstation.update({
      where: {
        id,
      },
      data: {
        status: 'INACTIVE',
      },
    });
  }
}
