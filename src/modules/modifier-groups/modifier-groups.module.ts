import { Module } from '@nestjs/common';
import { ModifierGroupsService } from './modifier-groups.service.js';
import { ModifierGroupsController } from './modifier-groups.controller.js';

@Module({
  controllers: [ModifierGroupsController],
  providers: [ModifierGroupsService],
})
export class ModifierGroupsModule {}
