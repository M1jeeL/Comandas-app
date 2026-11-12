import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from 'class-validator';
import { OrdersService } from '../dist/src/modules/orders/orders.service.js';
import { BillsService } from '../dist/src/modules/bills/bills.service.js';
import { AddOrderItemDto } from '../dist/src/modules/orders/dto/add-order-item.dto.js';
import { UpdateOrderItemDto } from '../dist/src/modules/orders/dto/update-order-item.dto.js';
import { Prisma } from '../dist/src/generated/prisma/client.js';

const user = { role: 'CASHIER', userId: 'cashier', businessId: 'business' };
const audit = { record: async () => {} };
function fixture() {
  const item = { id: 'item', productNameSnapshot: 'Cafe', quantity: new Prisma.Decimal(2), unitPrice: new Prisma.Decimal(1000), status: 'PENDING', cancellationStatus: 'NONE', notes: null, modifiers: [], product: { productWorkstations: [{ workstationId: 'kitchen', workstation: { name: 'Cocina', locationId: 'location', status: 'ACTIVE' } }] } };
  const order = { id: 'order-123456', locationId: 'location', type: 'TAKEAWAY', status: 'DRAFT', waiterId: null, billOrders: [], items: [item] };
  const tx = {
    location: { findFirst: async () => ({ id: 'location' }) },
    order: { findFirst: async () => order, findMany: async () => [order], update: async ({data}) => Object.assign(order, data) },
    orderItem: { findMany: async ({where}) => order.items.filter(i => i.status === where.status || typeof where.status === 'object'), findFirst: async () => item, updateMany: async ({data}) => { Object.assign(item, data); return {count: 1}; } },
    billOrder: { findFirst: async () => order.billOrders[0] ?? null },
    bill: { create: async ({data}) => { const bill = {id: 'bill', ...data}; order.billOrders.push({billId: bill.id, bill}); return bill; } },
  };
  tx.$transaction = async fn => fn(tx);
  return { order, item, tx, orders: new OrdersService(tx, audit), bills: new BillsService(tx, audit) };
}

test('cantidades enteras en altas y ediciones', async () => {
  for (const Dto of [AddOrderItemDto, UpdateOrderItemDto]) {
    for (const quantity of [0, -1, 0.5, 1.5, 1000000000]) {
      const dto = Object.assign(new Dto(), { productId: '11111111-1111-4111-8111-111111111111', quantity });
      assert.ok((await validate(dto)).some(error => error.property === 'quantity'));
    }
    assert.equal((await validate(Object.assign(new Dto(), {productId: '11111111-1111-4111-8111-111111111111', quantity: 2}))).length, 0);
  }
});
test('para llevar: cobrar antes de cocina y cerrar al retirar', async () => {
  const f = fixture();
  await assert.rejects(f.orders.dispatchForPrinting(user, f.order.id), /cobrar el total/);
  const bill = await f.bills.create(user, {orderIds: [f.order.id]});
  assert.equal(bill.total.toString(), '2000');
  assert.equal(bill.tipAmount.toString(), '0');
  assert.equal(f.order.status, 'DRAFT');
  await assert.rejects(f.orders.dispatchForPrinting(user, f.order.id), /cobrar el total/);
  bill.status = 'PARTIALLY_PAID';
  await assert.rejects(f.orders.dispatchForPrinting(user, f.order.id), /cobrar el total/);
  bill.status = 'PAID';
  const ticket = await f.orders.dispatchForPrinting(user, f.order.id);
  assert.equal(ticket.orderCode, '123456');
  assert.equal(ticket.stations[0].items[0].quantity, '2');
  assert.equal(f.order.status, 'SENT');
  assert.equal(f.item.status, 'SENT');
  await f.orders.dispatchForPrinting(user, f.order.id, true);
  await f.orders.markItemDelivered(user, f.order.id, f.item.id);
  assert.equal(f.order.status, 'CLOSED');
});
test('no cobrar productos sin estacion valida', async () => {
  const f = fixture(); f.item.product.productWorkstations = [];
  await assert.rejects(f.bills.create(user, {orderIds: [f.order.id]}), /estacion activa/);
  assert.equal(f.order.billOrders.length, 0);
});
test('cuenta bloquea editar, quitar y cancelar productos', async () => {
  const f = fixture(); await f.bills.create(user, {orderIds: [f.order.id]});
  await assert.rejects(f.orders.updateItem(user, f.order.id, f.item.id, {quantity: 3}), /no se pueden editar/);
  await assert.rejects(f.orders.removeItem(user, f.order.id, f.item.id), /no se pueden quitar/);
  await assert.rejects(f.orders.cancel(user, f.order.id), /No se puede cancelar/);
});
test('mesa conserva cobro despues de entregar y permisos', async () => {
  const f = fixture(); f.order.type = 'DINE_IN';
  await assert.rejects(f.bills.create(user, {orderIds: [f.order.id]}), /no puede ser facturada/);
  await assert.rejects(f.orders.dispatchForPrinting(user, f.order.id), /no puede operar/);
  f.order.status = 'DELIVERED';
  const bill = await f.bills.create({...user, role: 'MANAGER'}, {orderIds: [f.order.id]});
  assert.equal(bill.total.toString(), '2200');
});
