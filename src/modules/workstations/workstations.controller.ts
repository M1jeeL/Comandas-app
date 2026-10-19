import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { WorkstationsService } from './workstations.service.js';

import { CreateWorkstationDto } from './dto/create-workstation.dto.js';
import { UpdateWorkstationDto } from './dto/update-workstation.dto.js';

import { ScopedJwtAuthGuard } from '../../common/guards/scoped-jwt-auth.guard.js';

import { CurrentUser } from '../../common/decorators/current-user.decorators.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

@Controller('locations/:locationId/workstations')
@UseGuards(ScopedJwtAuthGuard)
export class WorkstationsController {
  constructor(private readonly workstationsService: WorkstationsService) {}

  @Post()
  create(
    @CurrentUser() user: JwtUser,
    @Param('locationId', ParseUUIDPipe)
    locationId: string,
    @Body() dto: CreateWorkstationDto,
  ) {
    return this.workstationsService.create(user, locationId, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtUser,
    @Param('locationId', ParseUUIDPipe)
    locationId: string,
  ) {
    return this.workstationsService.findAll(user, locationId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtUser,
    @Param('locationId', ParseUUIDPipe)
    locationId: string,
    @Param('id', ParseUUIDPipe)
    id: string,
  ) {
    return this.workstationsService.findOne(user, locationId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtUser,
    @Param('locationId', ParseUUIDPipe)
    locationId: string,
    @Param('id', ParseUUIDPipe)
    id: string,
    @Body() dto: UpdateWorkstationDto,
  ) {
    return this.workstationsService.update(user, locationId, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: JwtUser,
    @Param('locationId', ParseUUIDPipe)
    locationId: string,
    @Param('id', ParseUUIDPipe)
    id: string,
  ) {
    return this.workstationsService.remove(user, locationId, id);
  }
}
