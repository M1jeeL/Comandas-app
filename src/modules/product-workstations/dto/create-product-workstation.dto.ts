import { IsUUID } from 'class-validator';

export class CreateProductWorkstationDto {
  @IsUUID()
  productId: string;

  @IsUUID()
  workstationId: string;
}
