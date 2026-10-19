import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { ComboItemsService } from './combo-items.service.js';

import { CreateComboItemDto } from './dto/create-combo-item.dto.js';
import { UpdateComboItemDto } from './dto/update-combo-item.dto.js';

import { ScopedJwtAuthGuard } from '../../common/guards/scoped-jwt-auth.guard.js';

import { CurrentUser } from '../../common/decorators/current-user.decorators.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

@Controller('combos/:comboId/items')
@UseGuards(ScopedJwtAuthGuard)
export class ComboItemsController {
  constructor(private readonly comboItemsService: ComboItemsService) {}

  @Post()
  create(
    @CurrentUser() user: JwtUser,
    @Param('comboId', ParseUUIDPipe) comboId: string,
    @Body() dto: CreateComboItemDto,
  ) {
    return this.comboItemsService.create(user, comboId, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtUser,
    @Param('comboId', ParseUUIDPipe) comboId: string,
  ) {
    return this.comboItemsService.findAll(user, comboId);
  }

  @Get(':itemId')
  findOne(
    @CurrentUser() user: JwtUser,
    @Param('comboId', ParseUUIDPipe) comboId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.comboItemsService.findOne(user, comboId, itemId);
  }

  @Patch(':itemId')
  update(
    @CurrentUser() user: JwtUser,
    @Param('comboId', ParseUUIDPipe) comboId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateComboItemDto,
  ) {
    return this.comboItemsService.update(user, comboId, itemId, dto);
  }

  @Delete(':itemId')
  remove(
    @CurrentUser() user: JwtUser,
    @Param('comboId', ParseUUIDPipe) comboId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.comboItemsService.remove(user, comboId, itemId);
  }
}
