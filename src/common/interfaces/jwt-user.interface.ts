import { Role } from 'src/generated/prisma/enums.js';

export interface JwtUser {
  userId: string;
  businessId: string;
  membershipId: string;
  role: Role;
}
