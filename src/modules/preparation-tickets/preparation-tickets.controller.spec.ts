import { Test, TestingModule } from '@nestjs/testing';
import { PreparationTicketsController } from './preparation-tickets.controller';
import { PreparationTicketsService } from './preparation-tickets.service';

describe('PreparationTicketsController', () => {
  let controller: PreparationTicketsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PreparationTicketsController],
      providers: [PreparationTicketsService],
    }).compile();

    controller = module.get<PreparationTicketsController>(PreparationTicketsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
