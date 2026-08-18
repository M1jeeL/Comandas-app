import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { BillsService } from './bills.service.js';

import { CreateBillDto } from './dto/create-bill.dto.js';
import { UpdateBillTipDto } from './dto/update-bill-tip.dto.js';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

import { CurrentUser } from '../../common/decorators/current-user.decorators.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

@Controller('bills')
@UseGuards(JwtAuthGuard)
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateBillDto) {
    return this.billsService.create(user, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtUser,
    @Query('locationId') locationId?: string,
  ) {
    return this.billsService.findAll(user, locationId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.billsService.findOne(user, id);
  }

  @Patch(':id/tip')
  updateTip(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBillTipDto,
  ) {
    return this.billsService.updateTip(user, id, dto);
  }

  @Patch(':id/void')
  void(@CurrentUser() user: JwtUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.billsService.void(user, id);
  }
}
