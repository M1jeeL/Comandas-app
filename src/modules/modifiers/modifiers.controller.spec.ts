import { Test, TestingModule } from '@nestjs/testing';
import { ModifiersController } from './modifiers.controller';
import { ModifiersService } from './modifiers.service';

describe('ModifiersController', () => {
  let controller: ModifiersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ModifiersController],
      providers: [ModifiersService],
    }).compile();

    controller = module.get<ModifiersController>(ModifiersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
