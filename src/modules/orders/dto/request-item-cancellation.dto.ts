import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RequestItemCancellationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
