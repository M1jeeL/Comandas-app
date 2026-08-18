import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';

import { PreparationTicketsService } from './preparation-tickets.service.js';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

import { CurrentUser } from '../../common/decorators/current-user.decorators.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

import { UpdatePreparationTicketStatusDto } from './dto/update-preparation-ticket-status.dto.js';

@Controller('preparation-tickets')
@UseGuards(JwtAuthGuard)
export class PreparationTicketsController {
  constructor(
    private readonly preparationTicketsService: PreparationTicketsService,
  ) {}

  @Get()
  findAll(
    @CurrentUser() user: JwtUser,
    @Query('locationId') locationId?: string,
  ) {
    return this.preparationTicketsService.findAll(user, locationId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.preparationTicketsService.findOne(user, id);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePreparationTicketStatusDto,
  ) {
    return this.preparationTicketsService.updateStatus(user, id, dto.status);
  }
}
