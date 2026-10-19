import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

import { CashMovementType } from '../../../generated/prisma/enums.js';

export class CreateCashMovementDto {
  @IsUUID()
  idempotencyKey: string;

  @IsEnum(CashMovementType)
  type: CashMovementType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reference?: string;
}
