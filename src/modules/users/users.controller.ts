import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { UsersService } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorators.js';

import { CurrentUser } from '../../common/decorators/current-user.decorators.js';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

import { Role } from '../../generated/prisma/enums.js';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Crear usuario dentro del Business actual.
   */
  @Post()
  @Roles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateUserDto) {
    return this.usersService.create(user, dto);
  }

  /**
   * Obtener usuarios del Business actual.
   */
  @Get()
  @Roles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  findAll(@CurrentUser() user: JwtUser) {
    return this.usersService.findAll(user);
  }

  /**
   * Obtener un usuario del Business actual.
   */
  @Get(':id')
  @Roles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.usersService.findOne(user, id);
  }

  /**
   * Actualizar usuario.
   */
  @Patch(':id')
  @Roles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  update(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(user, id, dto);
  }

  /**
   * Eliminar usuario.
   */
  @Delete(':id')
  @Roles(Role.OWNER, Role.ADMIN)
  remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.usersService.remove(user, id);
  }
}
