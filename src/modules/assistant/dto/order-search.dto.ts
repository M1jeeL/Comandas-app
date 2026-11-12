import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

/** Only these filters may be supplied by the model. Scope always comes from JWT. */
export class OrderSearchDto {
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  customerName?: string;

  @IsOptional()
  @Matches(/^[a-f0-9]{6}$/i)
  pickupCode?: string;

  @IsOptional()
  @IsIn(['DINE_IN', 'TAKEAWAY'])
  type?: 'DINE_IN' | 'TAKEAWAY';

  @IsOptional()
  @IsIn(['PAID', 'UNPAID', 'PENDING'])
  paymentStatus?: 'PAID' | 'UNPAID' | 'PENDING';

  @IsOptional()
  @IsBoolean()
  pendingDelivery?: boolean;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  createdOn?: string;
}
