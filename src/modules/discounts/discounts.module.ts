import { Module } from '@nestjs/common';
import { DiscountsService } from './discounts.service.js';
import { DiscountsController } from './discounts.controller.js';

@Module({
  controllers: [DiscountsController],
  providers: [DiscountsService],
})
export class DiscountsModule {}
