import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ScopedJwtAuthGuard } from '../../common/guards/scoped-jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorators.js';
import { Role } from '../../generated/prisma/enums.js';
import { CurrentUser } from '../../common/decorators/current-user.decorators.js';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';
import { AuditService } from './audit.service.js';

@Controller('audit-logs')
@UseGuards(ScopedJwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  findRecent(
    @CurrentUser() user: JwtUser,
    @Query('locationId') locationId?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.audit.findRecent(user.businessId, {
      locationId: locationId ?? (user.role === Role.MANAGER ? user.locationId : undefined),
      entityType,
      entityId,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
    });
  }
}
