import { IsNumber, Min } from 'class-validator';

export class UpdateBillTipDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  tipAmount: number;
}
