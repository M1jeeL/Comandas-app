import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { UpdateBusinessDto } from './dto/update-business.dto.js';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class BusinessService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async getCurrent(user: JwtUser) {
    const business = await this.prisma.business.findUnique({
      where: { id: user.businessId },
      include: {
        locations: {
          orderBy: { createdAt: 'asc' },
          include: {
            suscription: {
              select: {
                id: true, status: true, startedAt: true,
                currentPeriodStart: true, currentPeriodEnd: true, cancelledAt: true,
                plan: { select: {
                  code: true, name: true, description: true, price: true,
                  maxLocations: true, maxUsers: true, maxProducts: true,
                } },
              },
            },
          },
        },
      },
    });

    if (!business) {
      throw new NotFoundException('Negocio no encontrado');
    }

    return business;
  }

  async updateCurrent(user: JwtUser, dto: UpdateBusinessDto) {
    const current = await this.getCurrent(user);
    const name = dto.name?.trim();
    if (name !== undefined && (name.length < 2 || name.length > 150)) {
      throw new BadRequestException('El nombre del negocio debe tener entre 2 y 150 caracteres');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.business.update({
        where: { id: user.businessId },
        data: {
          ...(name !== undefined && { name }),
          ...(dto.taxId !== undefined && { taxId: dto.taxId?.trim() || null }),
        },
      });
      await this.audit.record(tx, {
        businessId: user.businessId, userId: user.userId,
        action: 'BUSINESS_UPDATED', entityType: 'Business', entityId: user.businessId,
        metadata: {
          ...(dto.name !== undefined && { name: { from: current.name, to: updated.name } }),
          ...(dto.taxId !== undefined && { taxIdChanged: current.taxId !== updated.taxId }),
        },
      });
      return updated;
    });
  }
}
