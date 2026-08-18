import { Module } from '@nestjs/common';
import { ProductWorkstationsService } from './product-workstations.service.js';
import { ProductWorkstationsController } from './product-workstations.controller.js';

@Module({
  controllers: [ProductWorkstationsController],
  providers: [ProductWorkstationsService],
})
export class ProductWorkstationsModule {}
