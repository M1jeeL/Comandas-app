import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { CreateMembershipDto } from './dto/create-membership.dto.js';
import { UpdateMembershipDto } from './dto/update-membership.dto.js';

@Injectable()
export class MembershipsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateMembershipDto) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: dto.userId,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const business = await this.prisma.business.findUnique({
      where: {
        id: dto.businessId,
      },
    });

    if (!business) {
      throw new NotFoundException('Business not found');
    }

    return this.prisma.membership.create({
      data: dto,
    });
  }

  async findAll() {
    return this.prisma.membership.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const membership = await this.prisma.membership.findUnique({
      where: {
        id,
      },
    });

    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    return membership;
  }

  async update(id: string, dto: UpdateMembershipDto) {
    await this.findOne(id);

    if (dto.userId) {
      const user = await this.prisma.user.findUnique({
        where: {
          id: dto.userId,
        },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }
    }

    if (dto.businessId) {
      const business = await this.prisma.business.findUnique({
        where: {
          id: dto.businessId,
        },
      });

      if (!business) {
        throw new NotFoundException('Business not found');
      }
    }

    return this.prisma.membership.update({
      where: {
        id,
      },
      data: dto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.membership.delete({
      where: {
        id,
      },
    });
  }
}
