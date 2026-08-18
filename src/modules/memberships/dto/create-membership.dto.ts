import { IsEnum, IsUUID } from 'class-validator';
import { Role } from '../../../generated/prisma/enums.js';

export class CreateMembershipDto {
  @IsUUID()
  userId: string;

  @IsUUID()
  businessId: string;

  @IsEnum(Role)
  role: Role;
}
