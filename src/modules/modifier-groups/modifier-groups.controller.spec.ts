import { Test, TestingModule } from '@nestjs/testing';
import { ModifierGroupsController } from './modifier-groups.controller';
import { ModifierGroupsService } from './modifier-groups.service';

describe('ModifierGroupsController', () => {
  let controller: ModifierGroupsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ModifierGroupsController],
      providers: [ModifierGroupsService],
    }).compile();

    controller = module.get<ModifierGroupsController>(ModifierGroupsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
