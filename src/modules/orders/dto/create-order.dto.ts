import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

import { OrderType } from '../../../generated/prisma/enums.js';

export class CreateOrderDto {
  @IsUUID()
  @IsNotEmpty()
  locationId: string;

  @IsEnum(OrderType)
  type: OrderType;

  @IsUUID()
  @IsOptional()
  tableSessionId?: string;

  /**
   * Opcional:
   *
   * - DINE_IN -> obligatorio a nivel de negocio
   * - TAKEAWAY -> opcional
   *
   * No confiamos en este valor para saber quién creó
   * la orden. createdBy siempre viene del JWT.
   */
  @IsUUID()
  @IsOptional()
  waiterId?: string;

  @IsString()
  @IsOptional()
  customerName?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
