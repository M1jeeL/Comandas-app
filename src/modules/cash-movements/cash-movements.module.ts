import { Module } from '@nestjs/common';
import { CashMovementsService } from './cash-movements.service.js';
import { CashMovementsController } from './cash-movements.controller.js';

@Module({
  controllers: [CashMovementsController],
  providers: [CashMovementsService],
})
export class CashMovementsModule {}
