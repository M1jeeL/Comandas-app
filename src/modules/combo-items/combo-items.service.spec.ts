import { Test, TestingModule } from '@nestjs/testing';
import { ComboItemsService } from './combo-items.service';

describe('ComboItemsService', () => {
  let service: ComboItemsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ComboItemsService],
    }).compile();

    service = module.get<ComboItemsService>(ComboItemsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
