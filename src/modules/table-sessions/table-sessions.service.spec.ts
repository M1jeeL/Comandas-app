import { Test, TestingModule } from '@nestjs/testing';
import { TableSessionsService } from './table-sessions.service';

describe('TableSessionsService', () => {
  let service: TableSessionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TableSessionsService],
    }).compile();

    service = module.get<TableSessionsService>(TableSessionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
