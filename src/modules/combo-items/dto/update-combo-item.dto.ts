import { PartialType } from '@nestjs/mapped-types';
import { CreateComboItemDto } from './create-combo-item.dto.js';

export class UpdateComboItemDto extends PartialType(CreateComboItemDto) {}
