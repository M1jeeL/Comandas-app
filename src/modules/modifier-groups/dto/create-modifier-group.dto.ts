import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateModifierGroupDto {
  @IsUUID()
  locationId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  minSelections?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  maxSelections?: number;
}
