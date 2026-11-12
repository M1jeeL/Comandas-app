import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller.js';
import { AssistantService } from './assistant.service.js';
import { GeminiAssistantService } from './gemini-assistant.service.js';

@Module({
  controllers: [AssistantController],
  providers: [AssistantService, GeminiAssistantService],
})
export class AssistantModule {}
