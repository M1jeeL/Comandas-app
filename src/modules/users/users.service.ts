import {
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

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
   * El usuario todavía no pertenece al Business.
   * La Membership se crea posteriormente.
   */
  async create(user: JwtUser, dto: CreateUserDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: {
        email: dto.email,
      },
    });

    if (existingUser) {
      throw new ConflictException('Ya existe un usuario con ese email');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);

    return this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        firstName: dto.firstName,
        lastName: dto.lastName,
      },

      select: this.publicUserSelect,
    });
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
            status: 'ACTIVE',
          },
        },
      },

      select: {
        ...this.publicUserSelect,

        memberships: {
          where: {
            businessId: user.businessId,
          },

          select: {
            id: true,
            role: true,
            status: true,
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
          },
        },
      },

      select: {
        ...this.publicUserSelect,

        memberships: {
          where: {
            businessId: user.businessId,
          },

          select: {
            id: true,
            role: true,
            status: true,
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
     * Un MANAGER no puede modificar
     * usuarios ADMIN u OWNER.
     */
    if (
      user.role === Role.MANAGER &&
      (targetMembership.role === Role.OWNER ||
        targetMembership.role === Role.ADMIN)
    ) {
      throw new ForbiddenException('No puedes modificar a este usuario');
    }

    /**
     * No permitimos que un ADMIN modifique
     * al OWNER.
     */
    if (user.role === Role.ADMIN && targetMembership.role === Role.OWNER) {
      throw new ForbiddenException('No puedes modificar al OWNER del negocio');
    }

    const data: {
      email?: string;
      password?: string;
      firstName?: string;
      lastName?: string;
    } = {};

    if (dto.email !== undefined) {
      if (dto.email !== targetUser.email) {
        const existingUser = await this.prisma.user.findUnique({
          where: {
            email: dto.email,
          },
        });

        if (existingUser) {
          throw new ConflictException('Ya existe un usuario con ese email');
        }
      }

      data.email = dto.email;
    }

    if (dto.firstName !== undefined) {
      data.firstName = dto.firstName;
    }

    if (dto.lastName !== undefined) {
      data.lastName = dto.lastName;
    }

    /**
     * Nunca guardamos una contraseña
     * sin hashear.
     */
    if (dto.password !== undefined) {
      data.password = await bcrypt.hash(dto.password, 12);
    }

    return this.prisma.user.update({
      where: {
        id: targetUser.id,
      },

      data,

      select: this.publicUserSelect,
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
