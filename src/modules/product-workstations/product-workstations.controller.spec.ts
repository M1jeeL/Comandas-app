import { Test, TestingModule } from '@nestjs/testing';
import { ProductWorkstationsController } from './product-workstations.controller';
import { ProductWorkstationsService } from './product-workstations.service';

describe('ProductWorkstationsController', () => {
  let controller: ProductWorkstationsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductWorkstationsController],
      providers: [ProductWorkstationsService],
    }).compile();

    controller = module.get<ProductWorkstationsController>(ProductWorkstationsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
