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

import { OrdersService } from './orders.service.js';

import { CreateOrderDto } from './dto/create-order.dto.js';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto.js';

import { ScopedJwtAuthGuard } from '../../common/guards/scoped-jwt-auth.guard.js';

import { CurrentUser } from '../../common/decorators/current-user.decorators.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';
import { AddOrderItemDto } from './dto/add-order-item.dto.js';
import { UpdateOrderItemDto } from './dto/update-order-item.dto.js';
import { RequestItemCancellationDto } from './dto/request-item-cancellation.dto.js';

@Controller('orders')
@UseGuards(ScopedJwtAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(user, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtUser,
    @Query('locationId', ParseUUIDPipe)
    locationId: string,
  ) {
    return this.ordersService.findAll(user, locationId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.findOne(user, id);
  }

  @Post(':orderId/items')
  addItem(
    @CurrentUser() user: JwtUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: AddOrderItemDto,
  ) {
    return this.ordersService.addItem(user, orderId, dto);
  }

  @Patch(':orderId/items/:itemId')
  updateItem(
    @CurrentUser() user: JwtUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateOrderItemDto,
  ) {
    return this.ordersService.updateItem(user, orderId, itemId, dto);
  }

  @Delete(':orderId/items/:itemId')
  removeItem(
    @CurrentUser() user: JwtUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.ordersService.removeItem(user, orderId, itemId);
  }

  @Post(':orderId/items/:itemId/cancellation-request')
  requestItemCancellation(
    @CurrentUser() user: JwtUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: RequestItemCancellationDto,
  ) {
    return this.ordersService.requestItemCancellation(user, orderId, itemId, dto);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(user, id, dto);
  }

  @Patch(':id/cancel')
  cancel(@CurrentUser() user: JwtUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.cancel(user, id);
  }
}
