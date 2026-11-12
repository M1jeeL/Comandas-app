import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MaxLength,
} from 'class-validator';

export class UpdateOrderItemDto {
  @IsInt()
  @Min(1)
  @Max(999_999_999)
  @IsOptional()
  quantity?: number;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  notes?: string;

  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @IsOptional()
  modifierIds?: string[];
}
