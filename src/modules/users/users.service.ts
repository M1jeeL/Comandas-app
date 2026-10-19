import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma.service.js';

import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

import { Role } from '../../generated/prisma/enums.js';

import * as bcrypt from 'bcrypt';
import { MembershipStatus } from '../../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /**
   * Campos públicos de User.
   *
   * Nunca exponemos password.
   */
  private readonly publicUserSelect = {
    id: true,
    email: true,
    firstName: true,
    lastName: true,
    createdAt: true,
    updatedAt: true,
  };

  /**
   * Crear un usuario.
   *
   * Crea la identidad y su membresía de sucursal en una operación atómica.
   */
  async create(user: JwtUser, dto: CreateUserDto) {
    this.validateRoleAssignment(user.role, dto.role);
    if (user.role === Role.MANAGER && dto.locationId !== user.locationId) {
      throw new ForbiddenException('Un MANAGER solo puede crear personal para su local asignado');
    }
    const email = dto.email.trim().toLowerCase();
    if (dto.firstName.trim().length < 2 || dto.lastName.trim().length < 2) {
      throw new BadRequestException('Nombre y apellido deben tener al menos 2 caracteres');
    }
    const location = await this.prisma.location.findFirst({
      where: { id: dto.locationId, businessId: user.businessId, status: 'ACTIVE' },
      select: { id: true, name: true },
    });
    if (!location) throw new NotFoundException('La sucursal seleccionada no pertenece al negocio o está inactiva');

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('Ya existe un usuario con ese email');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);

    return this.prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
        },
      });
      const membership = await tx.membership.create({
        data: {
          userId: createdUser.id,
          businessId: user.businessId,
          locationId: location.id,
          role: dto.role,
          status: MembershipStatus.ACTIVE,
        },
      });
      await this.audit.record(tx, {
        businessId: user.businessId, locationId: location.id, userId: user.userId,
        action: 'USER_CREATED', entityType: 'User', entityId: createdUser.id,
        metadata: { email: createdUser.email },
      });
      await this.audit.record(tx, {
        businessId: user.businessId, locationId: location.id, userId: user.userId,
        action: 'MEMBERSHIP_CREATED', entityType: 'Membership', entityId: membership.id,
        metadata: { userId: createdUser.id, role: membership.role, status: membership.status },
      });
      return {
        ...this.publicFields(createdUser),
        memberships: [{ ...membership, location }],
      };
    });
  }

  private publicFields(user: { id: string; email: string; firstName: string; lastName: string; createdAt: Date; updatedAt: Date }) {
    return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, createdAt: user.createdAt, updatedAt: user.updatedAt };
  }

  private validateRoleAssignment(actorRole: Role, targetRole: Role) {
    if (actorRole === Role.OWNER) return;
    if (actorRole === Role.ADMIN && targetRole !== Role.OWNER) return;
    const operationalRoles: Role[] = [Role.WAITER, Role.KITCHEN, Role.CASHIER];
    if (actorRole === Role.MANAGER && operationalRoles.includes(targetRole)) return;
    throw new ForbiddenException('No tienes permisos para asignar este rol');
  }

  /**
   * Obtener todos los usuarios que pertenecen
   * al Business actual mediante una Membership.
   */
  async findAll(user: JwtUser) {
    return this.prisma.user.findMany({
      where: {
        memberships: {
          some: {
            businessId: user.businessId,
            ...(user.role === Role.MANAGER ? { locationId: user.locationId } : {}),
            ...(user.role === Role.MANAGER ? { locationId: user.locationId } : {}),
          },
        },
      },

      select: {
        ...this.publicUserSelect,

        memberships: {
          where: {
            businessId: user.businessId,
            ...(user.role === Role.MANAGER ? { locationId: user.locationId } : {}),
            ...(user.role === Role.MANAGER ? { locationId: user.locationId } : {}),
          },

          select: {
            id: true,
            role: true,
            status: true,
            locationId: true,
            location: { select: { id: true, name: true } },
            createdAt: true,
            updatedAt: true,
          },
        },
      },

      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Obtener un usuario perteneciente
   * al Business actual.
   */
  async findOne(user: JwtUser, id: string) {
    const targetUser = await this.prisma.user.findFirst({
      where: {
        id,

        memberships: {
          some: {
            businessId: user.businessId,
            ...(user.role === Role.MANAGER ? { locationId: user.locationId } : {}),
          },
        },
      },

      select: {
        ...this.publicUserSelect,

        memberships: {
          where: {
            businessId: user.businessId,
            ...(user.role === Role.MANAGER ? { locationId: user.locationId } : {}),
          },

          select: {
            id: true,
            role: true,
            status: true,
            locationId: true,
            location: { select: { id: true, name: true } },
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!targetUser) {
      throw new NotFoundException('Usuario no encontrado en este negocio');
    }

    return targetUser;
  }

  /**
   * Actualizar usuario.
   */
  async update(user: JwtUser, id: string, dto: UpdateUserDto) {
    const targetUser = await this.prisma.user.findFirst({
      where: {
        id,

        memberships: {
          some: {
            businessId: user.businessId,
            ...(user.role === Role.MANAGER ? { locationId: user.locationId } : {}),
          },
        },
      },

      include: {
        memberships: {
          where: {
            businessId: user.businessId,
            ...(user.role === Role.MANAGER ? { locationId: user.locationId } : {}),
          },
        },
      },
    });

    if (!targetUser) {
      throw new NotFoundException('Usuario no encontrado en este negocio');
    }

    const targetMembership = targetUser.memberships[0];

    /**
     * Un MANAGER no puede modificar
     * usuarios ADMIN u OWNER.
     */
    const operationalRoles: Role[] = [Role.WAITER, Role.KITCHEN, Role.CASHIER];
    if (user.role === Role.MANAGER && !operationalRoles.includes(targetMembership.role)) {
      throw new ForbiddenException('No puedes modificar a este usuario');
    }

    /**
     * No permitimos que un ADMIN modifique
     * al OWNER.
     */
    const privilegedRoles: Role[] = [Role.OWNER, Role.ADMIN];
    if (user.role === Role.ADMIN && privilegedRoles.includes(targetMembership.role)) {
      throw new ForbiddenException('Un ADMIN no puede modificar a otro ADMIN ni al OWNER');
    }
    if (targetUser.id === user.userId && (dto.status === MembershipStatus.INACTIVE || (dto.role && dto.role !== targetMembership.role))) {
      throw new ForbiddenException('No puedes desactivar tu propia cuenta ni cambiar tu propio rol');
    }
    if (dto.role !== undefined && dto.role !== targetMembership.role) {
      this.validateRoleAssignment(user.role, dto.role);
    }
    if (dto.locationId !== undefined) {
      if (user.role === Role.MANAGER && dto.locationId !== user.locationId) {
        throw new ForbiddenException('Un MANAGER no puede mover personal a otro local');
      }
      const location = await this.prisma.location.findFirst({
        where: { id: dto.locationId, businessId: user.businessId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!location) throw new NotFoundException('La sucursal seleccionada no pertenece al negocio o está inactiva');
    }

    const data: {
      email?: string;
      password?: string;
      firstName?: string;
      lastName?: string;
    } = {};

    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      if (!email) throw new BadRequestException('El correo es obligatorio');
      if (email !== targetUser.email) {
        const existingUser = await this.prisma.user.findUnique({
          where: { email },
        });

        if (existingUser) {
          throw new ConflictException('Ya existe un usuario con ese email');
        }
      }

      data.email = email;
    }

    if (dto.firstName !== undefined) {
      if (dto.firstName.trim().length < 2) throw new BadRequestException('El nombre debe tener al menos 2 caracteres');
      data.firstName = dto.firstName.trim();
    }

    if (dto.lastName !== undefined) {
      if (dto.lastName.trim().length < 2) throw new BadRequestException('El apellido debe tener al menos 2 caracteres');
      data.lastName = dto.lastName.trim();
    }

    /**
     * Nunca guardamos una contraseña
     * sin hashear.
     */
    if (dto.password !== undefined) {
      data.password = await bcrypt.hash(dto.password, 12);
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({ where: { id: targetUser.id }, data });
      const membershipData = {
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.locationId !== undefined && { locationId: dto.locationId }),
        ...(dto.status !== undefined && { status: dto.status }),
      };
      const updatedMembership = Object.keys(membershipData).length
        ? await tx.membership.update({
            where: { id: targetMembership.id }, data: membershipData,
            include: { location: { select: { id: true, name: true } } },
          })
        : { ...targetMembership, location: await tx.location.findUniqueOrThrow({ where: { id: targetMembership.locationId }, select: { id: true, name: true } }) };
      if (Object.keys(data).length) {
        await this.audit.record(tx, {
          businessId: user.businessId, locationId: targetMembership.locationId, userId: user.userId,
          action: 'USER_UPDATED', entityType: 'User', entityId: targetUser.id,
          metadata: { changedFields: Object.keys(data) },
        });
      }
      if (Object.keys(membershipData).length) {
        await this.audit.record(tx, {
          businessId: user.businessId, locationId: dto.locationId ?? targetMembership.locationId, userId: user.userId,
          action: dto.role && dto.role !== targetMembership.role ? 'MEMBERSHIP_ROLE_CHANGED' : 'MEMBERSHIP_UPDATED',
          entityType: 'Membership', entityId: targetMembership.id,
          metadata: {
            ...(dto.role !== undefined && { role: { from: targetMembership.role, to: dto.role } }),
            ...(dto.locationId !== undefined && { locationId: { from: targetMembership.locationId, to: dto.locationId } }),
            ...(dto.status !== undefined && { status: { from: targetMembership.status, to: dto.status } }),
          },
        });
      }
      return {
        ...this.publicFields(updatedUser),
        memberships: [{ ...updatedMembership }],
      };
    });
  }

  /**
   * Eliminar usuario.
   */
  async remove(user: JwtUser, id: string) {
    const targetUser = await this.prisma.user.findFirst({
      where: {
        id,

        memberships: {
          some: {
            businessId: user.businessId,
          },
        },
      },

      include: {
        memberships: {
          where: {
            businessId: user.businessId,
          },
        },
      },
    });

    if (!targetUser) {
      throw new NotFoundException('Usuario no encontrado en este negocio');
    }

    const targetMembership = targetUser.memberships[0];

    /**
     * Nadie puede eliminar al OWNER.
     */
    if (targetMembership.role === Role.OWNER) {
      throw new ForbiddenException('El OWNER no puede ser eliminado');
    }

    /**
     * ADMIN tampoco puede eliminar otro ADMIN.
     */
    if (user.role === Role.ADMIN && targetMembership.role === Role.ADMIN) {
      throw new ForbiddenException('Un ADMIN no puede eliminar a otro ADMIN');
    }

    /**
     * MANAGER no debería llegar aquí por el controller,
     * pero mantenemos la protección en el service.
     */
    if (user.role === Role.MANAGER) {
      throw new ForbiddenException('Un MANAGER no puede eliminar usuarios');
    }

    return this.prisma.user.delete({
      where: {
        id: targetUser.id,
      },

      select: this.publicUserSelect,
    });
  }
}
