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

import { CombosService } from './combos.service.js';

import { CreateComboDto } from './dto/create-combo.dto.js';
import { UpdateComboDto } from './dto/update-combo.dto.js';

import { ScopedJwtAuthGuard } from '../../common/guards/scoped-jwt-auth.guard.js';

import { CurrentUser } from '../../common/decorators/current-user.decorators.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

@Controller('combos')
@UseGuards(ScopedJwtAuthGuard)
export class CombosController {
  constructor(private readonly combosService: CombosService) {}

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateComboDto) {
    return this.combosService.create(user, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtUser,
    @Query('locationId', ParseUUIDPipe) locationId: string,
  ) {
    return this.combosService.findAll(user, locationId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.combosService.findOne(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateComboDto,
  ) {
    return this.combosService.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.combosService.remove(user, id);
  }
}
