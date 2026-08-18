import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { PaymentsService } from './payments.service.js';

import { CreatePaymentDto } from './dto/create-payment.dto.js';

import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto.js';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

import { CurrentUser } from '../../common/decorators/current-user.decorators.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

@Controller('bills/:billId/payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  create(
    @CurrentUser() user: JwtUser,

    @Param('billId', ParseUUIDPipe)
    billId: string,

    @Body()
    dto: CreatePaymentDto,
  ) {
    return this.paymentsService.create(user, billId, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtUser,

    @Param('billId', ParseUUIDPipe)
    billId: string,
  ) {
    return this.paymentsService.findAll(user, billId);
  }

  @Patch(':paymentId/status')
  updateStatus(
    @CurrentUser() user: JwtUser,

    @Param('billId', ParseUUIDPipe)
    billId: string,

    @Param('paymentId', ParseUUIDPipe)
    paymentId: string,

    @Body()
    dto: UpdatePaymentStatusDto,
  ) {
    return this.paymentsService.updateStatus(user, billId, paymentId, dto);
  }
}
