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

import { MembershipsService } from './memberships.service.js';
import { CreateMembershipDto } from './dto/create-membership.dto.js';
import { UpdateMembershipDto } from './dto/update-membership.dto.js';

import { ScopedJwtAuthGuard } from '../../common/guards/scoped-jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorators.js';

import { CurrentUser } from '../../common/decorators/current-user.decorators.js';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

import { Role } from '../../generated/prisma/enums.js';

@Controller('memberships')
@UseGuards(ScopedJwtAuthGuard, RolesGuard)
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Post()
  @Roles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateMembershipDto) {
    return this.membershipsService.create(user, dto);
  }

  @Get()
  @Roles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  findAll(@CurrentUser() user: JwtUser) {
    return this.membershipsService.findAll(user);
  }

  @Get(':id')
  @Roles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.membershipsService.findOne(user, id);
  }

  @Patch(':id')
  @Roles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  update(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateMembershipDto,
  ) {
    return this.membershipsService.update(user, id, dto);
  }

  @Delete(':id')
  @Roles(Role.OWNER, Role.ADMIN)
  remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.membershipsService.remove(user, id);
  }
}
