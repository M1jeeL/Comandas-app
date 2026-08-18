import { PartialType } from '@nestjs/mapped-types';
import { CreatePreparationTicketDto } from './create-preparation-ticket.dto.js';

export class UpdatePreparationTicketDto extends PartialType(
  CreatePreparationTicketDto,
) {}
