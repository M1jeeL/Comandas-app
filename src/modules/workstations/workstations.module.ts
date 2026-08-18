import { Module } from '@nestjs/common';
import { WorkstationsService } from './workstations.service.js';
import { WorkstationsController } from './workstations.controller.js';

@Module({
  controllers: [WorkstationsController],
  providers: [WorkstationsService],
})
export class WorkstationsModule {}
