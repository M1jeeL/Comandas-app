import {
  IsEnum,
  IsNumber,
  IsString,
  IsNotEmpty,
  Max,
  Min,
} from 'class-validator';

import { DiscountType } from '../../../generated/prisma/enums.js';

export class CreateDiscountDto {
  @IsEnum(DiscountType)
  type: DiscountType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  value: number;

  @IsString()
  @IsNotEmpty()
  reason: string;
}
