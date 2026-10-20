import { Global, Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaService } from './prisma.service.js';
import { HealthModule } from './modules/health/health.module.js';
import { ConfigModule } from '@nestjs/config';
import { ProductsModule } from './modules/products/products.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { BusinessModule } from './modules/business/business.module.js';
import { LocationsModule } from './modules/locations/locations.module.js';
import { MembershipsModule } from './modules/memberships/memberships.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CategoriesModule } from './modules/categories/categories.module.js';
import { WorkstationsModule } from './modules/workstations/workstations.module.js';
import { ProductWorkstationsModule } from './modules/product-workstations/product-workstations.module.js';
import { ModifierGroupsModule } from './modules/modifier-groups/modifier-groups.module.js';
import { ModifiersModule } from './modules/modifiers/modifiers.module.js';
import { CombosModule } from './modules/combos/combos.module.js';
import { ComboItemsModule } from './modules/combo-items/combo-items.module.js';
import { RestaurantTablesModule } from './modules/restaurant-tables/restaurant-tables.module.js';
import { TableSessionsModule } from './modules/table-sessions/table-sessions.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { BillsModule } from './modules/bills/bills.module.js';
import { DiscountsModule } from './modules/discounts/discounts.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { CashSessionsModule } from './modules/cash-sessions/cash-sessions.module.js';
import { CashMovementsModule } from './modules/cash-movements/cash-movements.module.js';
import { CashHandoversModule } from './modules/cash-handovers/cash-handovers.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { LocationScopeGuard } from './common/guards/location-scope.guard.js';
import { ScopedJwtAuthGuard } from './common/guards/scoped-jwt-auth.guard.js';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    HealthModule,
    ProductsModule,
    UsersModule,
    BusinessModule,
    LocationsModule,
    MembershipsModule,
    AuthModule,
    CategoriesModule,
    WorkstationsModule,
    ProductWorkstationsModule,
    ModifierGroupsModule,
    ModifiersModule,
    CombosModule,
    ComboItemsModule,
    RestaurantTablesModule,
    TableSessionsModule,
    OrdersModule,
    BillsModule,
    DiscountsModule,
    PaymentsModule,
    CashSessionsModule,
    CashMovementsModule,
    CashHandoversModule,
    AuditModule,
    ReportsModule,
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService, LocationScopeGuard, ScopedJwtAuthGuard],
  exports: [PrismaService, AppService, LocationScopeGuard, ScopedJwtAuthGuard],
})
export class AppModule {}
