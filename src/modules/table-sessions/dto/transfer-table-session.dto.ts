import { IsUUID } from 'class-validator';

export class TransferTableSessionDto {
  @IsUUID()
  waiterId: string;
}
