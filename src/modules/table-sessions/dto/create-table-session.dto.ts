import {
  IsNotEmpty,
  IsUUID,
} from 'class-validator';

export class CreateTableSessionDto {
  @IsUUID()
  @IsNotEmpty()
  tableId: string;

  @IsUUID()
  @IsNotEmpty()
  waiterId: string;
}