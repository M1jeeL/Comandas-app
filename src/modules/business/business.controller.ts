import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorators.js';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorators.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { Role } from '../../generated/prisma/enums.js';
import { BusinessService } from './business.service.js';
import { UpdateBusinessDto } from './dto/update-business.dto.js';

@Controller('businesses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BusinessController {
  constructor(private readonly businessesService: BusinessService) {}

  @Get('current')
  @Roles(Role.OWNER, Role.ADMIN)
  getCurrent(@CurrentUser() user: JwtUser) {
    return this.businessesService.getCurrent(user);
  }

  @Patch('current')
  @Roles(Role.OWNER, Role.ADMIN)
  updateCurrent(@CurrentUser() user: JwtUser, @Body() dto: UpdateBusinessDto) {
    return this.businessesService.updateCurrent(user, dto);
  }
}
