import { IsInt, IsNotEmpty, IsUUID, Min } from 'class-validator';

export class CreateComboItemDto {
  @IsUUID()
  @IsNotEmpty()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}
