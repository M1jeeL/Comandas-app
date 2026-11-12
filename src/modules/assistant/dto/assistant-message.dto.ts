import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class AssistantHistoryMessageDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @MinLength(1)
  @MaxLength(2500)
  text: string;
}

export class AssistantMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  message: string;

  @IsUUID()
  locationId: string;

  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsIn([
    '/dashboard',
    '/pedidos',
    '/mesas',
    '/caja',
    '/productos',
    '/reportes',
    '/usuarios',
    '/configuracion',
  ])
  page?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => AssistantHistoryMessageDto)
  history?: AssistantHistoryMessageDto[];
}
