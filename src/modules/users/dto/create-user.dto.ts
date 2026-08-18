import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  email: string;

  @IsString()
  password: string;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  firstName: string;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  lastName: string;
}
