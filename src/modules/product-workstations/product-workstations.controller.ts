import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { ProductWorkstationsService } from './product-workstations.service.js';

import { CreateProductWorkstationDto } from './dto/create-product-workstation.dto.js';

import { ScopedJwtAuthGuard } from '../../common/guards/scoped-jwt-auth.guard.js';

import { CurrentUser } from '../../common/decorators/current-user.decorators.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

@Controller('product-workstations')
@UseGuards(ScopedJwtAuthGuard)
export class ProductWorkstationsController {
  constructor(
    private readonly productWorkstationsService: ProductWorkstationsService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateProductWorkstationDto,
  ) {
    return this.productWorkstationsService.create(user, dto);
  }

  @Get('product/:productId')
  findByProduct(
    @CurrentUser() user: JwtUser,
    @Param('productId', ParseUUIDPipe)
    productId: string,
  ) {
    return this.productWorkstationsService.findByProduct(user, productId);
  }

  @Get('workstation/:workstationId')
  findByWorkstation(
    @CurrentUser() user: JwtUser,
    @Param('workstationId', ParseUUIDPipe)
    workstationId: string,
  ) {
    return this.productWorkstationsService.findByWorkstation(
      user,
      workstationId,
    );
  }

  @Delete('product/:productId/workstation/:workstationId')
  remove(
    @CurrentUser() user: JwtUser,
    @Param('productId', ParseUUIDPipe)
    productId: string,
    @Param('workstationId', ParseUUIDPipe)
    workstationId: string,
  ) {
    return this.productWorkstationsService.remove(
      user,
      productId,
      workstationId,
    );
  }
}
