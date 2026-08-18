import { IsEnum, IsNotEmpty } from 'class-validator';

import { PreparationTicketStatus } from '../../../generated/prisma/client.js';

export class UpdatePreparationTicketStatusDto {
  @IsEnum(PreparationTicketStatus)
  @IsNotEmpty()
  status: PreparationTicketStatus;
}
