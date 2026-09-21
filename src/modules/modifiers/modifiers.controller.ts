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

import { ModifiersService } from './modifiers.service.js';

import { CreateModifierDto } from './dto/create-modifier.dto.js';
import { UpdateModifierDto } from './dto/update-modifier.dto.js';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

import { CurrentUser } from '../../common/decorators/current-user.decorators.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

@Controller('modifiers')
@UseGuards(JwtAuthGuard)
export class ModifiersController {
  constructor(private readonly modifiersService: ModifiersService) {}

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateModifierDto) {
    return this.modifiersService.create(user, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtUser,

    @Query('productId', new ParseUUIDPipe({ optional: true }))
    productId?: string,

    @Query('groupId', new ParseUUIDPipe({ optional: true }))
    groupId?: string,
  ) {
    return this.modifiersService.findAll(user, productId, groupId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.modifiersService.findOne(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateModifierDto,
  ) {
    return this.modifiersService.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.modifiersService.remove(user, id);
  }
}
