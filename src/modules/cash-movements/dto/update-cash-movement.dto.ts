import { PartialType } from '@nestjs/mapped-types';
import { CreateCashMovementDto } from './create-cash-movement.dto.js';

export class UpdateCashMovementDto extends PartialType(CreateCashMovementDto) {}
