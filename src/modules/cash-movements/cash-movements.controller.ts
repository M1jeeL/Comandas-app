import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CashMovementsService } from './cash-movements.service.js';

import { CreateCashMovementDto } from './dto/create-cash-movement.dto.js';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

import { CurrentUser } from '../../common/decorators/current-user.decorators.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

@Controller('cash-sessions/:cashSessionId/movements')
@UseGuards(JwtAuthGuard)
export class CashMovementsController {
  constructor(private readonly cashMovementsService: CashMovementsService) {}

  @Post()
  create(
    @CurrentUser() user: JwtUser,

    @Param('cashSessionId', ParseUUIDPipe)
    cashSessionId: string,

    @Body()
    dto: CreateCashMovementDto,
  ) {
    return this.cashMovementsService.create(user, cashSessionId, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtUser,

    @Param('cashSessionId', ParseUUIDPipe)
    cashSessionId: string,
  ) {
    return this.cashMovementsService.findAll(user, cashSessionId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtUser,

    @Param('id', ParseUUIDPipe)
    id: string,
  ) {
    return this.cashMovementsService.findOne(user, id);
  }
}
