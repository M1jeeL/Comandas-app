import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateUserDto } from './create-user.dto.js';
import { MembershipStatus } from '../../../generated/prisma/enums.js';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;
}
