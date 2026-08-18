import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { CreateBusinessDto } from './dto/create-business.dto.js';
import { UpdateBusinessDto } from './dto/update-business.dto.js';

@Injectable()
export class BusinessService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBusinessDto) {
    return this.prisma.business.create({
      data: dto,
    });
  }

  async findAll() {
    return this.prisma.business.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const business = await this.prisma.business.findUnique({
      where: { id },
    });

    if (!business) {
      throw new NotFoundException('Business not found');
    }

    return business;
  }

  async update(id: string, dto: UpdateBusinessDto) {
    await this.findOne(id);

    return this.prisma.business.update({
      where: { id },
      data: dto,
    });
  }
}
