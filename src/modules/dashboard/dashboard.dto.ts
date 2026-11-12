import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class DashboardQueryDto {
  @IsUUID()
  locationId: string;

  @IsOptional()
  @IsIn(['today', '7d', '30d'])
  period: 'today' | '7d' | '30d' = '7d';
}
