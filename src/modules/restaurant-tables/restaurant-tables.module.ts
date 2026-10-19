import { Module } from '@nestjs/common';
import { RestaurantTablesService } from './restaurant-tables.service.js';
import { RestaurantTablesController } from './restaurant-tables.controller.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  controllers: [RestaurantTablesController],
  providers: [RestaurantTablesService],
  imports: [AuditModule],
})
export class RestaurantTablesModule {}
