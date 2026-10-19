import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CashHandoversService } from './cash-handovers.service.js';
import { ScopedJwtAuthGuard } from '../../common/guards/scoped-jwt-auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorators.js';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';
import { RejectCashHandoverDto } from './dto/reject-cash-handover.dto.js';

@Controller()
@UseGuards(ScopedJwtAuthGuard)
export class CashHandoversController {
  constructor(private readonly cashHandoversService: CashHandoversService) {}

  /**
   * Obtener entregas de una sesión.
   */
  @Get('cash-sessions/:cashSessionId/handovers')
  findAll(
    @CurrentUser() user: JwtUser,

    @Param('cashSessionId', ParseUUIDPipe)
    cashSessionId: string,
  ) {
    return this.cashHandoversService.findAll(user, cashSessionId);
  }

  /**
   * Obtener entrega individual.
   */
  @Get('cash-handovers/:id')
  findOne(
    @CurrentUser() user: JwtUser,

    @Param('id', ParseUUIDPipe)
    id: string,
  ) {
    return this.cashHandoversService.findOne(user, id);
  }

  /**
   * Confirmar entrega.
   */
  @Post('cash-handovers/:id/confirm')
  confirm(
    @CurrentUser() user: JwtUser,

    @Param('id', ParseUUIDPipe)
    id: string,
  ) {
    return this.cashHandoversService.confirm(user, id);
  }

  /**
   * Rechazar entrega.
   */
  @Post('cash-handovers/:id/reject')
  reject(
    @CurrentUser() user: JwtUser,

    @Param('id', ParseUUIDPipe)
    id: string,

    @Body()
    dto: RejectCashHandoverDto,
  ) {
    return this.cashHandoversService.reject(user, id, dto);
  }
}
