import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { ModifierGroupsService } from './modifier-groups.service.js';

import { CreateModifierGroupDto } from './dto/create-modifier-group.dto.js';
import { UpdateModifierGroupDto } from './dto/update-modifier-group.dto.js';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

import { CurrentUser } from '../../common/decorators/current-user.decorators.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

@Controller('modifier-groups')
@UseGuards(JwtAuthGuard)
export class ModifierGroupsController {
  constructor(private readonly modifierGroupsService: ModifierGroupsService) {}

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateModifierGroupDto) {
    return this.modifierGroupsService.create(user, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtUser,
    @Query('locationId', ParseUUIDPipe)
    locationId: string,
  ) {
    return this.modifierGroupsService.findAll(user, locationId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe)
    id: string,
  ) {
    return this.modifierGroupsService.findOne(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe)
    id: string,
    @Body() dto: UpdateModifierGroupDto,
  ) {
    return this.modifierGroupsService.update(user, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe)
    id: string,
  ) {
    return this.modifierGroupsService.remove(user, id);
  }
}
