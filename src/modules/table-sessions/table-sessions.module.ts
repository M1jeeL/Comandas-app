import { Module } from '@nestjs/common';
import { TableSessionsService } from './table-sessions.service.js';
import { TableSessionsController } from './table-sessions.controller.js';

@Module({
  controllers: [TableSessionsController],
  providers: [TableSessionsService],
})
export class TableSessionsModule {}
