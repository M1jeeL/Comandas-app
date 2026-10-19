import { IsEmail, IsEnum, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Role } from '../../../generated/prisma/enums.js';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  firstName: string;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  lastName: string;

  @IsUUID()
  locationId: string;

  @IsEnum(Role)
  role: Role;
}
