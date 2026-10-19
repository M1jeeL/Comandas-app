import { IsEnum } from 'class-validator';

export enum ItemCancellationDecision {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

export class ResolveItemCancellationDto {
  @IsEnum(ItemCancellationDecision)
  decision: ItemCancellationDecision;
}
