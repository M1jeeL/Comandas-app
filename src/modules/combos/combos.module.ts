import { Module } from '@nestjs/common';
import { CombosService } from './combos.service.js';
import { CombosController } from './combos.controller.js';

@Module({
  controllers: [CombosController],
  providers: [CombosService],
})
export class CombosModule {}
