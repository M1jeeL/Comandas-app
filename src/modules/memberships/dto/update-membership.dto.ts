import { PartialType } from '@nestjs/mapped-types';
import { CreateMembershipDto } from './create-membership.dto.js';

export class UpdateMembershipDto extends PartialType(CreateMembershipDto) {}
