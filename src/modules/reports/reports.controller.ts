import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorators.js';
import { Role } from '../../generated/prisma/enums.js';
import { CurrentUser } from '../../common/decorators/current-user.decorators.js';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';
import { ReportsService } from './reports.service.js';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('daily-close')
  @Roles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  dailyClose(
    @CurrentUser() user: JwtUser,
    @Query('locationId') locationId: string,
    @Query('date') date: string,
  ) {
    return this.reports.dailyClose(user, locationId, date);
  }
}
