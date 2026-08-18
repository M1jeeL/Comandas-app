import { Test, TestingModule } from '@nestjs/testing';
import { ComboItemsController } from './combo-items.controller';
import { ComboItemsService } from './combo-items.service';

describe('ComboItemsController', () => {
  let controller: ComboItemsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ComboItemsController],
      providers: [ComboItemsService],
    }).compile();

    controller = module.get<ComboItemsController>(ComboItemsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
