import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';

import { TableSessionsService } from './table-sessions.service.js';

import { CreateTableSessionDto } from './dto/create-table-session.dto.js';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

import { CurrentUser } from '../../common/decorators/current-user.decorators.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

@Controller('table-sessions')
@UseGuards(JwtAuthGuard)
export class TableSessionsController {
  constructor(
    private readonly tableSessionsService: TableSessionsService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateTableSessionDto,
  ) {
    return this.tableSessionsService.create(
      user,
      dto,
    );
  }

  @Get()
  findOpenByLocation(
    @CurrentUser() user: JwtUser,
    @Query('locationId', ParseUUIDPipe)
    locationId: string,
  ) {
    return this.tableSessionsService.findOpenByLocation(
      user,
      locationId,
    );
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tableSessionsService.findOne(
      user,
      id,
    );
  }

  @Patch(':id/close')
  close(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tableSessionsService.close(
      user,
      id,
    );
  }
}