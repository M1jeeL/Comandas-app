import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateWorkstationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}
