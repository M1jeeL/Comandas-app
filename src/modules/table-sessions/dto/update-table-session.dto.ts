import { PartialType } from '@nestjs/mapped-types';
import { CreateTableSessionDto } from './create-table-session.dto.js';

export class UpdateTableSessionDto extends PartialType(CreateTableSessionDto) {}
