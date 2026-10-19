import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma.service.js';

import { CreateMembershipDto } from './dto/create-membership.dto.js';
import { UpdateMembershipDto } from './dto/update-membership.dto.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

import { MembershipStatus, Role } from '../../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class MembershipsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /**
   * Valida que el usuario objetivo pueda recibir
   * el rol solicitado.
   */
  private validateRoleAssignment(actorRole: Role, targetRole: Role) {
    /**
     * OWNER puede administrar todos los roles.
     */
    if (actorRole === Role.OWNER) {
      return;
    }

    /**
     * ADMIN puede administrar roles operativos,
     * pero no puede crear OWNER.
     */
    if (actorRole === Role.ADMIN) {
      if (targetRole === Role.OWNER) {
        throw new ForbiddenException('Un ADMIN no puede asignar el rol OWNER');
      }

      return;
    }

    /**
     * MANAGER solamente puede asignar
     * roles operativos.
     */
    if (actorRole === Role.MANAGER) {
      const allowedRoles: Role[] = [Role.WAITER, Role.KITCHEN, Role.CASHIER];

      if (!allowedRoles.includes(targetRole)) {
        throw new ForbiddenException(
          'Un MANAGER solamente puede asignar roles operativos',
        );
      }

      return;
    }

    throw new ForbiddenException(
      'No tienes permisos para administrar membresías',
    );
  }

  /**
   * Crear Membership dentro del Business actual.
   */
  async create(user: JwtUser, dto: CreateMembershipDto) {
    const targetUser = await this.prisma.user.findUnique({
      where: {
        id: dto.userId,
      },
    });

    if (!targetUser) {
      throw new NotFoundException('Usuario no encontrado');
    }

    /**
     * Validar que el actor pueda asignar este rol.
     */
    this.validateRoleAssignment(user.role, dto.role);

    const location = await this.prisma.location.findFirst({
      where: { id: dto.locationId, businessId: user.businessId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!location) throw new NotFoundException('La sucursal seleccionada no pertenece al negocio o está inactiva');

    /**
     * Verificar si ya existe una membership
     * para este usuario dentro del Business.
     */
    const existingMembership = await this.prisma.membership.findFirst({
      where: {
        userId: dto.userId,
        businessId: user.businessId,
      },
    });

    if (existingMembership) {
      throw new ConflictException(
        'El usuario ya tiene una membresía en este negocio',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const membership = await tx.membership.create({
        data: {
          userId: dto.userId,
          businessId: user.businessId,
          locationId: location.id,
          role: dto.role,
          status: MembershipStatus.ACTIVE,
        },
        include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        location: { select: { id: true, name: true } },
      },
      });
      await this.audit.record(tx, {
        businessId: user.businessId, locationId: location.id, userId: user.userId,
        action: 'MEMBERSHIP_CREATED', entityType: 'Membership', entityId: membership.id,
        metadata: { userId: dto.userId, role: membership.role, status: membership.status },
      });
      return membership;
    });
  }

  /**
   * Obtener memberships del Business actual.
   */
  async findAll(user: JwtUser) {
    return this.prisma.membership.findMany({
      where: {
        businessId: user.businessId,
      },

      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        location: { select: { id: true, name: true } },
      },

      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Obtener una Membership del Business actual.
   */
  async findOne(user: JwtUser, id: string) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        id,
        businessId: user.businessId,
      },

      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        location: { select: { id: true, name: true } },
      },
    });

    if (!membership) {
      throw new NotFoundException('Membership no encontrada');
    }

    return membership;
  }

  /**
   * Actualizar Membership.
   */
  async update(user: JwtUser, id: string, dto: UpdateMembershipDto) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        id,
        businessId: user.businessId,
      },
    });

    if (!membership) {
      throw new NotFoundException('Membership no encontrada');
    }

    const operationalRoles: Role[] = [Role.WAITER, Role.KITCHEN, Role.CASHIER];
    const privilegedRoles: Role[] = [Role.OWNER, Role.ADMIN];
    if (user.role === Role.MANAGER && !operationalRoles.includes(membership.role)) {
      throw new ForbiddenException('Un MANAGER solo puede modificar usuarios operativos');
    }
    if (user.role === Role.ADMIN && privilegedRoles.includes(membership.role)) {
      throw new ForbiddenException('Un ADMIN no puede modificar a otro ADMIN ni al OWNER');
    }
    if (membership.userId === user.userId && (dto.status === MembershipStatus.INACTIVE || (dto.role && dto.role !== membership.role))) {
      throw new ForbiddenException('No puedes desactivar tu propia cuenta ni cambiar tu propio rol');
    }

    /**
     * Nunca permitimos modificar al OWNER
     * desde una cuenta inferior.
     */
    if (membership.role === Role.OWNER && user.role !== Role.OWNER) {
      throw new ForbiddenException(
        'No puedes modificar la membresía del OWNER',
      );
    }

    /**
     * Si cambia el rol, validar permisos.
     */
    if (dto.role !== undefined && dto.role !== membership.role) {
      this.validateRoleAssignment(user.role, dto.role);
    }

    if (dto.locationId !== undefined) {
      const location = await this.prisma.location.findFirst({
        where: { id: dto.locationId, businessId: user.businessId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!location) throw new NotFoundException('La sucursal seleccionada no pertenece al negocio o está inactiva');
    }

    /**
     * Un ADMIN no puede modificar otro ADMIN.
     */
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.membership.update({
        where: { id: membership.id },
        data: {
        ...(dto.role !== undefined && {
          role: dto.role,
        }),

        ...(dto.status !== undefined && {
          status: dto.status,
        }),
        ...(dto.locationId !== undefined && { locationId: dto.locationId }),
        },
        include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        location: { select: { id: true, name: true } },
      },
      });
      if (dto.role !== undefined || dto.status !== undefined || dto.locationId !== undefined) {
        await this.audit.record(tx, {
          businessId: user.businessId, locationId: dto.locationId ?? membership.locationId, userId: user.userId,
          action: dto.role && dto.role !== membership.role ? 'MEMBERSHIP_ROLE_CHANGED' : 'MEMBERSHIP_UPDATED',
          entityType: 'Membership', entityId: membership.id,
          metadata: {
            ...(dto.role !== undefined && { role: { from: membership.role, to: dto.role } }),
            ...(dto.status !== undefined && { status: { from: membership.status, to: dto.status } }),
            ...(dto.locationId !== undefined && { locationId: { from: membership.locationId, to: dto.locationId } }),
          },
        });
      }
      return updated;
    });
  }

  /**
   * Eliminar Membership.
   */
  async remove(user: JwtUser, id: string) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        id,
        businessId: user.businessId,
      },
    });

    if (!membership) {
      throw new NotFoundException('Membership no encontrada');
    }

    /**
     * El OWNER nunca puede ser eliminado.
     */
    if (membership.role === Role.OWNER) {
      throw new ForbiddenException(
        'La membresía del OWNER no puede eliminarse',
      );
    }

    /**
     * ADMIN no puede eliminar otro ADMIN.
     */
    if (user.role === Role.ADMIN && membership.role === Role.ADMIN) {
      throw new ForbiddenException('Un ADMIN no puede eliminar a otro ADMIN');
    }

    return this.prisma.membership.delete({
      where: {
        id: membership.id,
      },
    });
  }
}
