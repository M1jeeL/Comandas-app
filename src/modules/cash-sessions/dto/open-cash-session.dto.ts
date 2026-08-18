import {
  IsNumber,
  Min,
} from 'class-validator';

export class OpenCashSessionDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  openingAmount: number;
}