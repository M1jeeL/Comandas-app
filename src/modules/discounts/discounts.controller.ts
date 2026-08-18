import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { DiscountsService } from './discounts.service.js';

import { CreateDiscountDto } from './dto/create-discount.dto.js';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

import { CurrentUser } from '../../common/decorators/current-user.decorators.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

@Controller('bills/:billId/discounts')
@UseGuards(JwtAuthGuard)
export class DiscountsController {
  constructor(private readonly discountsService: DiscountsService) {}

  @Post()
  create(
    @CurrentUser() user: JwtUser,

    @Param('billId', ParseUUIDPipe)
    billId: string,

    @Body()
    dto: CreateDiscountDto,
  ) {
    return this.discountsService.create(user, billId, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtUser,

    @Param('billId', ParseUUIDPipe)
    billId: string,
  ) {
    return this.discountsService.findAll(user, billId);
  }

  @Delete(':discountId')
  remove(
    @CurrentUser() user: JwtUser,

    @Param('billId', ParseUUIDPipe)
    billId: string,

    @Param('discountId', ParseUUIDPipe)
    discountId: string,
  ) {
    return this.discountsService.remove(user, billId, discountId);
  }
}
