import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { LocationsService } from './locations.service.js';
import { CreateLocationDto } from './dto/create-location.dto.js';
import { UpdateLocationDto } from './dto/update-location.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorators.js';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorators.js';
import { Role } from '../../generated/prisma/enums.js';

@Controller('locations')
@UseGuards(JwtAuthGuard)
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.OWNER, Role.ADMIN)
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateLocationDto) {
    return this.locationsService.create(user, dto);
  }

  @Get()
  findAll(@CurrentUser() user: JwtUser) {
    return this.locationsService.findAll(user);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.locationsService.findOne(user, id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.OWNER, Role.ADMIN)
  update(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.locationsService.update(user, id, dto);
  }
}
