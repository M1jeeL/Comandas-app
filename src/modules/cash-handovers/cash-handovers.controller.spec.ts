import { Test, TestingModule } from '@nestjs/testing';
import { CashHandoversController } from './cash-handovers.controller';
import { CashHandoversService } from './cash-handovers.service';

describe('CashHandoversController', () => {
  let controller: CashHandoversController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CashHandoversController],
      providers: [CashHandoversService],
    }).compile();

    controller = module.get<CashHandoversController>(CashHandoversController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
