import { Test, TestingModule } from '@nestjs/testing';
import { CashMovementsService } from './cash-movements.service';

describe('CashMovementsService', () => {
  let service: CashMovementsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CashMovementsService],
    }).compile();

    service = module.get<CashMovementsService>(CashMovementsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
