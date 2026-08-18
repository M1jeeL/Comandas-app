import { Test, TestingModule } from '@nestjs/testing';
import { TableSessionsController } from './table-sessions.controller';
import { TableSessionsService } from './table-sessions.service';

describe('TableSessionsController', () => {
  let controller: TableSessionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TableSessionsController],
      providers: [TableSessionsService],
    }).compile();

    controller = module.get<TableSessionsController>(TableSessionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
