import { PartialType } from '@nestjs/mapped-types';
import { CreateDiscountDto } from './create-discount.dto.js';

export class UpdateDiscountDto extends PartialType(CreateDiscountDto) {}
