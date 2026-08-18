import { Test, TestingModule } from '@nestjs/testing';
import { WorkstationsService } from './workstations.service';

describe('WorkstationsService', () => {
  let service: WorkstationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkstationsService],
    }).compile();

    service = module.get<WorkstationsService>(WorkstationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
