import { Test, TestingModule } from '@nestjs/testing';
import { RestaurantTablesController } from './restaurant-tables.controller';
import { RestaurantTablesService } from './restaurant-tables.service';

describe('RestaurantTablesController', () => {
  let controller: RestaurantTablesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RestaurantTablesController],
      providers: [RestaurantTablesService],
    }).compile();

    controller = module.get<RestaurantTablesController>(RestaurantTablesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
