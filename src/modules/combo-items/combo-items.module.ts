import { Module } from '@nestjs/common';
import { ComboItemsService } from './combo-items.service.js';
import { ComboItemsController } from './combo-items.controller.js';

@Module({
  controllers: [ComboItemsController],
  providers: [ComboItemsService],
})
export class ComboItemsModule {}
