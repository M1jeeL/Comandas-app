import { PartialType } from '@nestjs/mapped-types';
import { CreateProductWorkstationDto } from './create-product-workstation.dto.js';

export class UpdateProductWorkstationDto extends PartialType(
  CreateProductWorkstationDto,
) {}
