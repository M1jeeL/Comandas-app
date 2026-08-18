import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectCashHandoverDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reason: string;
}
