import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateLocationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
}
