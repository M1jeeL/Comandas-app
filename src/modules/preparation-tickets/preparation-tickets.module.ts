import { Module } from '@nestjs/common';
import { PreparationTicketsService } from './preparation-tickets.service.js';
import { PreparationTicketsController } from './preparation-tickets.controller.js';

@Module({
  controllers: [PreparationTicketsController],
  providers: [PreparationTicketsService],
})
export class PreparationTicketsModule {}
