import { PartialType } from '@nestjs/mapped-types';
import { CreateBillDto } from './create-bill.dto.js';

export class UpdateBillDto extends PartialType(CreateBillDto) {}
