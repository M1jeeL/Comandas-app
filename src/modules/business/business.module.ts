import { Module } from '@nestjs/common';
import { BusinessService } from './business.service.js';
import { BusinessController } from './business.controller.js';

@Module({
  controllers: [BusinessController],
  providers: [BusinessService],
})
export class BusinessModule {}
