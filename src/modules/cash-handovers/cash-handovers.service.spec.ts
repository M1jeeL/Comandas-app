import { Test, TestingModule } from '@nestjs/testing';
import { CashHandoversService } from './cash-handovers.service';

describe('CashHandoversService', () => {
  let service: CashHandoversService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CashHandoversService],
    }).compile();

    service = module.get<CashHandoversService>(CashHandoversService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
