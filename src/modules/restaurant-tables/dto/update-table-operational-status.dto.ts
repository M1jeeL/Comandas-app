import { IsEnum } from 'class-validator';
import { TableOperationalStatus } from '../../../generated/prisma/enums.js';

export class UpdateTableOperationalStatusDto {
  @IsEnum(TableOperationalStatus)
  operationalStatus: TableOperationalStatus;
}
