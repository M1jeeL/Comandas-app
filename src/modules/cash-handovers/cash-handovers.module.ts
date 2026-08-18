import { Module } from '@nestjs/common';
import { CashHandoversService } from './cash-handovers.service.js';
import { CashHandoversController } from './cash-handovers.controller.js';

@Module({
  controllers: [CashHandoversController],
  providers: [CashHandoversService],
})
export class CashHandoversModule {}
