import { Module } from '@nestjs/common';
import { BillsService } from './bills.service.js';
import { BillsController } from './bills.controller.js';

@Module({
  controllers: [BillsController],
  providers: [BillsService],
})
export class BillsModule {}
