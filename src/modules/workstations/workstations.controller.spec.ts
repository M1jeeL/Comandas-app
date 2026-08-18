import { Test, TestingModule } from '@nestjs/testing';
import { WorkstationsController } from './workstations.controller';
import { WorkstationsService } from './workstations.service';

describe('WorkstationsController', () => {
  let controller: WorkstationsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkstationsController],
      providers: [WorkstationsService],
    }).compile();

    controller = module.get<WorkstationsController>(WorkstationsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
