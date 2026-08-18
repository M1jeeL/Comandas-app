import { PartialType } from '@nestjs/mapped-types';
import { CreateCashHandoverDto } from './create-cash-handover.dto.js';

export class UpdateCashHandoverDto extends PartialType(CreateCashHandoverDto) {}
