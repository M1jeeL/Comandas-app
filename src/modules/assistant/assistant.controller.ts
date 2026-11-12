import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ScopedJwtAuthGuard } from '../../common/guards/scoped-jwt-auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorators.js';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';
import { AssistantService } from './assistant.service.js';
import { AssistantMessageDto } from './dto/assistant-message.dto.js';

@Controller('assistant')
@UseGuards(ScopedJwtAuthGuard)
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('messages')
  answer(@CurrentUser() user: JwtUser, @Body() dto: AssistantMessageDto) {
    return this.assistant.answer(user, dto);
  }
}
