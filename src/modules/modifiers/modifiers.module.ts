import { Module } from '@nestjs/common';
import { ModifiersService } from './modifiers.service.js';
import { ModifiersController } from './modifiers.controller.js';

@Module({
  controllers: [ModifiersController],
  providers: [ModifiersService],
})
export class ModifiersModule {}
