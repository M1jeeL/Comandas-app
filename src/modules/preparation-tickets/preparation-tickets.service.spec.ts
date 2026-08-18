import { Test, TestingModule } from '@nestjs/testing';
import { PreparationTicketsService } from './preparation-tickets.service';

describe('PreparationTicketsService', () => {
  let service: PreparationTicketsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PreparationTicketsService],
    }).compile();

    service = module.get<PreparationTicketsService>(PreparationTicketsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
