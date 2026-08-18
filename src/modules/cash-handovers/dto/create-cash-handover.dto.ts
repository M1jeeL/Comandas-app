import { IsNumber, Min } from 'class-validator';

export class CreateCashHandoverDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;
}
