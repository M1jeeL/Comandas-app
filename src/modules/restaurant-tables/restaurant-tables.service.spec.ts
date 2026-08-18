import { Test, TestingModule } from '@nestjs/testing';
import { RestaurantTablesService } from './restaurant-tables.service';

describe('RestaurantTablesService', () => {
  let service: RestaurantTablesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RestaurantTablesService],
    }).compile();

    service = module.get<RestaurantTablesService>(RestaurantTablesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
