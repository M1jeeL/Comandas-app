import { PartialType } from '@nestjs/mapped-types';
import { CreateWorkstationDto } from './create-workstation.dto.js';

export class UpdateWorkstationDto extends PartialType(CreateWorkstationDto) {}
