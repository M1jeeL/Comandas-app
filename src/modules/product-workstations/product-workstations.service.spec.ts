import { Test, TestingModule } from '@nestjs/testing';
import { ProductWorkstationsService } from './product-workstations.service';

describe('ProductWorkstationsService', () => {
  let service: ProductWorkstationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductWorkstationsService],
    }).compile();

    service = module.get<ProductWorkstationsService>(ProductWorkstationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
