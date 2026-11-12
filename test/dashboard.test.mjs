import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from 'class-validator';
import { DashboardService, percentageChange } from '../dist/src/modules/dashboard/dashboard.service.js';
import { DashboardQueryDto } from '../dist/src/modules/dashboard/dashboard.dto.js';
import { Prisma } from '../dist/src/generated/prisma/client.js';

const locationId = '11111111-1111-4111-8111-111111111111';
const businessId = '22222222-2222-4222-8222-222222222222';
const user = {userId: businessId, businessId, locationId, role: 'OWNER'};
const now = new Date('2026-11-12T16:30:00Z');
const D = value => new Prisma.Decimal(value);
function fixture() {
  const calls = [];
  const wrap = (name, result) => async args => {calls.push({name, args}); return typeof result === 'function' ? result(args) : result;};
  const bills = [
    {createdAt: new Date('2026-11-12T04:00:00Z'), subtotal: D(10000), discountTotal: D(1000), tipAmount: D(900)},
    {createdAt: new Date('2026-11-12T05:00:00Z'), subtotal: D(5000), discountTotal: D(0), tipAmount: D(500)},
    {createdAt: new Date('2026-11-05T04:00:00Z'), subtotal: D(6000), discountTotal: D(0), tipAmount: D(600)},
  ];
  const unpaid = [{total: D(10000), payments: [{amount: D(4000)}]}, {total: D(1000), payments: [{amount: D(1100)}]}];
  const prisma = {
    location: {findFirst: wrap('location', {id: locationId, name: 'Centro', timezone: 'America/Santiago', currency: 'CLP'})},
    order: {
      findMany: wrap('orders', args => args.where.createdAt ? [
        {createdAt: now, type: 'TAKEAWAY', status: 'DRAFT'}, {createdAt: now, type: 'DINE_IN', status: 'CLOSED'}, {createdAt: now, type: 'TAKEAWAY', status: 'CANCELLED'},
      ] : [{id: '33333333-3333-4333-8333-333333abc123', type: 'TAKEAWAY', status: 'SENT', createdAt: new Date(now.getTime() - 90 * 60000), customerName: 'Juan', billOrders: [{bill: {status: 'PAID'}}]}]),
      groupBy: wrap('statuses', [{status: 'DRAFT', _count: {_all: 2}}, {status: 'SENT', _count: {_all: 3}}, {status: 'DELIVERED', _count: {_all: 1}}]),
      count: wrap('paidTakeaway', 2),
    },
    restaurantTable: {groupBy: wrap('tables', ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'OUT_OF_SERVICE'].map((operationalStatus, i) => ({operationalStatus, _count: {_all: [3,4,1,2][i]}})))},
    tableSession: {count: wrap('sessions', 4)},
    payment: {
      count: wrap('pendingPayments', 1),
      groupBy: wrap('payments', args => args.where.reversedAt ? [{method: 'CASH', _sum: {amount: D(2000)}}] : [{method: 'CASH', _sum: {amount: D(10000)}, _count: {_all: 2}}, {method: 'CARD', _sum: {amount: D(5000)}, _count: {_all: 1}}]),
    },
    orderItem: {count: wrap('cancellations', 1), groupBy: wrap('products', [{productId: 'p1', productNameSnapshot: 'Café', _sum: {quantity: D(3)}}, {productId: 'p1', productNameSnapshot: 'Café nuevo', _sum: {quantity: D(2)}}, {productId: 'p2', productNameSnapshot: 'Té', _sum: {quantity: D(4)}}])},
    cashSession: {findFirst: wrap('cash', {id: 'cash', openedAt: now, openingAmount: D(10000), opener: {firstName: 'Ana', lastName: 'Caja'}, movements: [{type: 'SALE', amount: D(3000)}, {type: 'HANDOVER', amount: D(2000)}, {type: 'REFUND', amount: D(1000)}, {type: 'WITHDRAWAL', amount: D(500)}, {type: 'ADJUSTMENT', amount: D(-100)}]})},
    cashHandover: {aggregate: wrap('handovers', {_count: {_all: 1}, _sum: {amount: D(900)}})},
    product: {count: wrap('invalidProducts', 2)},
    bill: {findMany: wrap('bills', args => args.where.status === 'PAID' ? bills : unpaid)},
  };
  return {service: new DashboardService(prisma), prisma, calls};
}

test('dashboard valida local y períodos permitidos', async () => {
  for (const input of [{locationId: 'no', period: '7d'}, {locationId, period: '365d'}]) assert.ok((await validate(Object.assign(new DashboardQueryDto(), input))).length);
  assert.equal((await validate(Object.assign(new DashboardQueryDto(), {locationId}))).length, 0);
});
test('ventas, cobros y saldos no se mezclan ni duplican entregas de efectivo', async () => {
  const f = fixture(); const result = await f.service.overview(user, {locationId, period: '7d'}, now);
  assert.equal(result.finance.sales, 14000);
  assert.equal(result.finance.previousSales, 6000);
  assert.equal(result.finance.change, 133.3);
  assert.equal(result.finance.tickets, 2);
  assert.equal(result.finance.averageTicket, 7000);
  assert.equal(result.finance.tips, 1400);
  assert.equal(result.finance.discounts, 1000);
  assert.equal(result.finance.collections, 13000);
  assert.equal(result.finance.reversals, 2000);
  assert.equal(result.finance.outstanding, 6000);
  assert.equal(result.finance.outstandingBills, 1);
  assert.equal(result.cash.expected, 13400);
  assert.equal(result.cash.pendingHandoverAmount, 900);
  assert.equal(result.finance.topProducts[0].units, 5);
  assert.equal(result.timeline.reduce((sum, day) => sum + day.sales, 0), 14000);
});
test('período respeta hora local y diferencia datos actuales', async () => {
  const f = fixture(); const result = await f.service.overview(user, {locationId, period: '7d'}, now);
  assert.equal(result.period.from, '2026-11-06');
  assert.equal(result.timeline.length, 7);
  assert.equal(f.calls.find(call => call.name === 'orders').args.where.createdAt.gte.toISOString(), '2026-11-06T03:00:00.000Z');
  assert.equal(result.live.active, 6);
  assert.equal(result.live.awaitingDelivery, 3);
  assert.equal(result.tables.total, 10);
  assert.equal(result.attentionOrders[0].ageMinutes, 90);
  assert.equal(result.orders.total, 3);
  assert.equal(result.orders.cancelled, 1);
});
test('mesero solo consulta sus pedidos y no ejecuta consultas financieras o de caja', async () => {
  const f = fixture(); const waiter = {...user, role: 'WAITER'};
  const result = await f.service.overview(waiter, {locationId, period: 'today'}, now);
  assert.equal(result.scope, 'own');
  assert.equal(result.finance, null);
  assert.equal(result.cash, null);
  assert.equal(result.live.invalidProducts, null);
  for (const call of f.calls.filter(call => ['orders', 'statuses', 'paidTakeaway', 'sessions'].includes(call.name))) assert.equal(call.args.where.waiterId, user.userId);
  assert.ok(!f.calls.some(call => ['bills', 'payments', 'products', 'cash', 'handovers', 'invalidProducts'].includes(call.name)));
});
test('cajero ve caja y operación, sin reportes financieros globales', async () => {
  const f = fixture(); const result = await f.service.overview({...user, role: 'CASHIER'}, {locationId, period: '30d'}, now);
  assert.ok(result.cash.open);
  assert.equal(result.finance, null);
  assert.equal(result.timeline.length, 30);
  assert.ok(!f.calls.some(call => ['bills', 'payments', 'products'].includes(call.name)));
});
test('rechaza cocina, locales ajenos y sucursales de otro negocio antes de agregar datos', async () => {
  const f = fixture();
  await assert.rejects(f.service.overview({...user, role: 'KITCHEN'}, {locationId, period: '7d'}, now));
  await assert.rejects(f.service.overview({...user, role: 'MANAGER'}, {locationId: businessId, period: '7d'}, now));
  assert.equal(f.calls.length, 0);
  f.prisma.location.findFirst = async () => null;
  await assert.rejects(f.service.overview(user, {locationId, period: '7d'}, now));
  assert.equal(f.calls.length, 0);
});
test('comparación sin base no produce infinito ni un porcentaje engañoso', () => {
  assert.equal(percentageChange(1000, 0), null);
  assert.equal(percentageChange(0, 0), null);
  assert.equal(percentageChange(0, 1000), -100);
});
