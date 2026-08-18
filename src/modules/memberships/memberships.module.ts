import { Module } from '@nestjs/common';
import { MembershipsService } from './memberships.service.js';
import { MembershipsController } from './memberships.controller.js';

@Module({
  controllers: [MembershipsController],
  providers: [MembershipsService],
})
export class MembershipsModule {}
