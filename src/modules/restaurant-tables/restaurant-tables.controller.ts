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

import { RestaurantTablesService } from './restaurant-tables.service.js';

import { CreateRestaurantTableDto } from './dto/create-restaurant-table.dto.js';
import { UpdateRestaurantTableDto } from './dto/update-restaurant-table.dto.js';
import { UpdateTableOperationalStatusDto } from './dto/update-table-operational-status.dto.js';

import { ScopedJwtAuthGuard } from '../../common/guards/scoped-jwt-auth.guard.js';

import { CurrentUser } from '../../common/decorators/current-user.decorators.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

@Controller('restaurant-tables')
@UseGuards(ScopedJwtAuthGuard)
export class RestaurantTablesController {
  constructor(
    private readonly restaurantTablesService: RestaurantTablesService,
  ) {}

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateRestaurantTableDto) {
    return this.restaurantTablesService.create(user, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtUser,
    @Query('locationId', ParseUUIDPipe) locationId: string,
  ) {
    return this.restaurantTablesService.findAll(user, locationId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.restaurantTablesService.findOne(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRestaurantTableDto,
  ) {
    return this.restaurantTablesService.update(user, id, dto);
  }

  @Patch(':id/operational-status')
  updateOperationalStatus(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTableOperationalStatusDto,
  ) {
    return this.restaurantTablesService.updateOperationalStatus(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.restaurantTablesService.remove(user, id);
  }
}
