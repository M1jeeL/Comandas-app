import { PartialType } from '@nestjs/mapped-types';
import { CreateModifierGroupDto } from './create-modifier-group.dto.js';

export class UpdateModifierGroupDto extends PartialType(
  CreateModifierGroupDto,
) {}
