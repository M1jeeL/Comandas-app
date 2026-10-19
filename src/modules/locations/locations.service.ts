import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { CreateLocationDto } from './dto/create-location.dto.js';
import { UpdateLocationDto } from './dto/update-location.dto.js';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async create(user: JwtUser, dto: CreateLocationDto) {
    const business = await this.prisma.business.findUnique({
      where: {
        id: user.businessId,
      },
    });

    if (!business) {
      throw new NotFoundException('Business not found');
    }

    const name = dto.name.trim();
    if (name.length < 2 || name.length > 150) {
      throw new BadRequestException('El nombre de la sucursal debe tener entre 2 y 150 caracteres');
    }
    if (dto.timezone) {
      try { new Intl.DateTimeFormat('es-CL', { timeZone: dto.timezone }).format(); }
      catch { throw new BadRequestException('La zona horaria no es válida'); }
    }

    return this.prisma.location.create({
      data: {
        ...dto,
        name,
        ...(dto.address !== undefined && { address: dto.address?.trim() || null }),
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
    const current = await this.findOne(user, id);
    const name = typeof dto.name === 'string' ? dto.name.trim() : undefined;
    if (dto.name !== undefined && (name === undefined || name.length < 2 || name.length > 150)) {
      throw new BadRequestException('El nombre de la sucursal debe tener entre 2 y 150 caracteres');
    }
    if (dto.timezone !== undefined) {
      try { new Intl.DateTimeFormat('es-CL', { timeZone: dto.timezone }).format(); }
      catch { throw new BadRequestException('La zona horaria no es válida'); }
    }
    if (dto.currency !== undefined && !/^[A-Z]{3}$/.test(dto.currency)) {
      throw new BadRequestException('La moneda debe ser un código de tres letras mayúsculas');
    }
    if (current.status === 'ACTIVE' && dto.status === 'INACTIVE') {
      const [openCashSession, openTableSession] = await Promise.all([
        this.prisma.cashSession.findFirst({ where: { locationId: id, status: 'OPEN' }, select: { id: true } }),
        this.prisma.tableSession.findFirst({ where: { status: { in: ['OPEN', 'CLOSING'] }, table: { locationId: id } }, select: { id: true } }),
      ]);
      if (openCashSession || openTableSession) {
        throw new ConflictException('Cierra primero las cajas y sesiones de mesa activas para desactivar esta sucursal');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.location.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(dto.address !== undefined && { address: dto.address?.trim() || null }),
          ...(dto.timezone !== undefined && { timezone: dto.timezone }),
          ...(dto.currency !== undefined && { currency: dto.currency }),
          ...(dto.status !== undefined && { status: dto.status }),
        },
      });
      await this.audit.record(tx, {
        businessId: user.businessId, locationId: id, userId: user.userId,
        action: 'LOCATION_UPDATED', entityType: 'Location', entityId: id,
        metadata: {
          ...(dto.name !== undefined && { name: { from: current.name, to: updated.name } }),
          ...(dto.address !== undefined && { addressChanged: current.address !== updated.address }),
          ...(dto.timezone !== undefined && { timezone: { from: current.timezone, to: updated.timezone } }),
          ...(dto.currency !== undefined && { currency: { from: current.currency, to: updated.currency } }),
          ...(dto.status !== undefined && { status: { from: current.status, to: updated.status } }),
        },
      });
      return updated;
    });
  }
}
