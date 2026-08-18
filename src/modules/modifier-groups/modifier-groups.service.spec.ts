import { Test, TestingModule } from '@nestjs/testing';
import { ModifierGroupsService } from './modifier-groups.service';

describe('ModifierGroupsService', () => {
  let service: ModifierGroupsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ModifierGroupsService],
    }).compile();

    service = module.get<ModifierGroupsService>(ModifierGroupsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
