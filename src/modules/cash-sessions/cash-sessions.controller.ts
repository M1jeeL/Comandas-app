import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CashSessionsService } from './cash-sessions.service.js';

import { OpenCashSessionDto } from './dto/open-cash-session.dto.js';
import { CloseCashSessionDto } from './dto/close-cash-session.dto.js';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

import { CurrentUser } from '../../common/decorators/current-user.decorators.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

@Controller('cash-sessions')
@UseGuards(JwtAuthGuard)
export class CashSessionsController {
  constructor(private readonly cashSessionsService: CashSessionsService) {}

  @Post('locations/:locationId')
  open(
    @CurrentUser() user: JwtUser,

    @Param('locationId', ParseUUIDPipe)
    locationId: string,

    @Body()
    dto: OpenCashSessionDto,
  ) {
    return this.cashSessionsService.open(user, locationId, dto);
  }

  @Get('locations/:locationId/current')
  getCurrent(
    @CurrentUser() user: JwtUser,

    @Param('locationId', ParseUUIDPipe)
    locationId: string,
  ) {
    return this.cashSessionsService.getCurrent(user, locationId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtUser,

    @Param('id', ParseUUIDPipe)
    id: string,
  ) {
    return this.cashSessionsService.findOne(user, id);
  }

  @Post(':id/close')
  close(
    @CurrentUser() user: JwtUser,

    @Param('id', ParseUUIDPipe)
    id: string,

    @Body()
    dto: CloseCashSessionDto,
  ) {
    return this.cashSessionsService.close(user, id, dto);
  }
}
