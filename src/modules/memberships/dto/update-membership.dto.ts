import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { MembershipStatus, Role } from '../../../generated/prisma/enums.js';

export class UpdateMembershipDto {
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;

  @IsOptional()
  @IsUUID()
  locationId?: string;
}
