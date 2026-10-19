import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateLocationDto } from './create-location.dto.js';
import { LocationStatus } from '../../../generated/prisma/enums.js';

export class UpdateLocationDto extends PartialType(CreateLocationDto) {
  @IsOptional()
  @IsEnum(LocationStatus)
  status?: LocationStatus;
}
