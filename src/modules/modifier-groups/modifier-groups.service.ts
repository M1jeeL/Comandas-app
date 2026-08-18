import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma.service.js';
import { CreateModifierGroupDto } from './dto/create-modifier-group.dto.js';
import { UpdateModifierGroupDto } from './dto/update-modifier-group.dto.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
@Injectable()
export class ModifierGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  private async validateLocationAccess(user: JwtUser, locationId: string) {
    const location = await this.prisma.location.findFirst({
      where: {
        id: locationId,
        businessId: user.businessId,
        status: 'ACTIVE',
      },
    });

    if (!location) {
      throw new NotFoundException(
        'Location not found or does not belong to your business',
      );
    }

    return location;
  }

  // ============================================================
  // VALIDAR REGLAS MIN / MAX
  // ============================================================

  private validateSelectionRules(
    minSelections: number,
    maxSelections: number | null,
  ) {
    if (maxSelections !== null && minSelections > maxSelections) {
      throw new BadRequestException(
        'minSelections cannot be greater than maxSelections',
      );
    }
  }

  // ============================================================
  // CREATE
  // ============================================================

  async create(user: JwtUser, dto: CreateModifierGroupDto) {
    await this.validateLocationAccess(user, dto.locationId);

    const minSelections = dto.minSelections ?? 0;

    const maxSelections = dto.maxSelections ?? null;

    this.validateSelectionRules(minSelections, maxSelections);

    try {
      return await this.prisma.modifierGroup.create({
        data: {
          locationId: dto.locationId,
          name: dto.name,
          minSelections,
          maxSelections,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ya existe un grupo de modificadores con ese nombre en esta ubicación',
        );
      }

      throw error;
    }
  }

  // ============================================================
  // FIND ALL
  // ============================================================

  async findAll(user: JwtUser, locationId?: string) {
    if (locationId) {
      await this.validateLocationAccess(user, locationId);
    }

    return this.prisma.modifierGroup.findMany({
      where: {
        location: {
          businessId: user.businessId,
        },
        ...(locationId && {
          locationId,
        }),
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  // ============================================================
  // FIND ONE
  // ============================================================

  async findOne(user: JwtUser, id: string) {
    const modifierGroup = await this.prisma.modifierGroup.findFirst({
      where: {
        id,
        location: {
          businessId: user.businessId,
        },
      },
    });

    if (!modifierGroup) {
      throw new NotFoundException('Modifier group not found');
    }

    return modifierGroup;
  }

  // ============================================================
  // UPDATE
  // ============================================================

  async update(user: JwtUser, id: string, dto: UpdateModifierGroupDto) {
    const modifierGroup = await this.prisma.modifierGroup.findFirst({
      where: {
        id,
        location: {
          businessId: user.businessId,
        },
      },
    });

    if (!modifierGroup) {
      throw new NotFoundException('Modifier group not found');
    }

    // Si cambia de location, validar que la nueva
    // location pertenezca al mismo business.
    if (dto.locationId && dto.locationId !== modifierGroup.locationId) {
      await this.validateLocationAccess(user, dto.locationId);
    }

    const minSelections = dto.minSelections ?? modifierGroup.minSelections;

    const maxSelections =
      dto.maxSelections !== undefined
        ? dto.maxSelections
        : modifierGroup.maxSelections;

    this.validateSelectionRules(minSelections, maxSelections);

    try {
      return await this.prisma.modifierGroup.update({
        where: {
          id,
        },
        data: dto,
      });
    } catch (error) {
      if (
        error instanceof PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ya existe un grupo de modificadores con ese nombre en esta ubicación',
        );
      }

      throw error;
    }
  }

  async remove(user: JwtUser, id: string) {
    const modifierGroup = await this.prisma.modifierGroup.findFirst({
      where: {
        id,
        location: {
          businessId: user.businessId,
        },
      },
    });

    if (!modifierGroup) {
      throw new NotFoundException('Modifier group not found');
    }

    return this.prisma.modifierGroup.update({
      where: {
        id,
      },
      data: {
        status: 'INACTIVE',
      },
    });
  }
}
