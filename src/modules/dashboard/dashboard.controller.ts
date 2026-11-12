import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorators.js';
import { ScopedJwtAuthGuard } from '../../common/guards/scoped-jwt-auth.guard.js';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';
import { DashboardQueryDto } from './dashboard.dto.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
@UseGuards(ScopedJwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  overview(@CurrentUser() user: JwtUser, @Query() query: DashboardQueryDto) {
    return this.dashboard.overview(user, query);
  }
}
