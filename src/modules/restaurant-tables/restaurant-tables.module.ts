import { Module } from '@nestjs/common';
import { RestaurantTablesService } from './restaurant-tables.service.js';
import { RestaurantTablesController } from './restaurant-tables.controller.js';

@Module({
  controllers: [RestaurantTablesController],
  providers: [RestaurantTablesService],
})
export class RestaurantTablesModule {}
