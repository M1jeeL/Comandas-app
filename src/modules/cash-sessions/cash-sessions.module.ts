import { Module } from '@nestjs/common';
import { CashSessionsService } from './cash-sessions.service.js';
import { CashSessionsController } from './cash-sessions.controller.js';

@Module({
  controllers: [CashSessionsController],
  providers: [CashSessionsService],
})
export class CashSessionsModule {}
