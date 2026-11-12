import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from 'class-validator';
import { AssistantService } from '../dist/src/modules/assistant/assistant.service.js';
import { AssistantMessageDto } from '../dist/src/modules/assistant/dto/assistant-message.dto.js';
import { ScopedJwtAuthGuard } from '../dist/src/common/guards/scoped-jwt-auth.guard.js';
import { LocationScopeGuard } from '../dist/src/common/guards/location-scope.guard.js';

const ids = { location: '11111111-1111-4111-8111-111111111111', user: '22222222-2222-4222-8222-222222222222', order: '33333333-3333-4333-8333-333333abc123', business: '44444444-4444-4444-8444-444444444444' };
const user = { userId: ids.user, role: 'CASHIER', locationId: ids.location, businessId: ids.business };
const dto = (message, extra = {}) => ({ message, locationId: ids.location, page: '/pedidos', ...extra });
function fixture() {
  const calls = [];
  const order = {
    id: ids.order, type: 'TAKEAWAY', status: 'DRAFT', customerName: 'José', waiterId: null,
    items: [{ quantity: 2, productNameSnapshot: 'Hamburguesa', unitPrice: 3000, status: 'PENDING', modifiers: [{priceDelta: 500}] }], billOrders: [],
  };
  const prisma = {
    location: { findFirst: async args => { calls.push(['location', args]); return {id: ids.location}; } },
    order: {
      findFirst: async args => { calls.push(['one', args]); return order; },
      findMany: async args => { calls.push(['many', args]); return [order]; },
    },
    $queryRaw: async sql => { calls.push(['sql', sql]); return [{id: ids.order}]; },
  };
  return { service: new AssistantService(prisma), prisma, calls, order };
}

test('valida mensajes, sucursal, contexto y ruta', async () => {
  const valid = Object.assign(new AssistantMessageDto(), dto('¿Cómo hago una venta para llevar?'));
  assert.equal((await validate(valid)).length, 0);
  for (const change of [{message: ''}, {message: 'a'.repeat(501)}, {locationId: 'no'}, {orderId: 'no'}, {page: 'https://example.com'}]) {
    assert.ok((await validate(Object.assign(new AssistantMessageDto(), valid, change))).length > 0);
  }
});
test('guía de venta para llevar sin consultar pedidos', async () => {
  const f = fixture();
  const reply = await f.service.answer(user, dto('¿Cómo hago una venta para llevar?'));
  assert.match(reply.text, /pago completo/);
  assert.match(reply.text, /cantidades enteras/);
  assert.equal(reply.source, 'manual');
  assert.equal(f.calls.filter(([kind]) => kind !== 'location').length, 0);
});
test('rechaza cocina, sucursales ajenas y locales de otro negocio', async () => {
  const f = fixture();
  await assert.rejects(f.service.answer({...user, role: 'KITCHEN'}, dto('ayuda')), /rol/);
  await assert.rejects(f.service.answer(user, dto('ayuda', {locationId: ids.business})), /local/);
  assert.equal(f.calls.length, 0);
  f.prisma.location.findFirst = async () => null;
  await assert.rejects(f.service.answer({...user, role: 'OWNER'}, dto('ayuda')), /negocio/);
});
test('diagnostica saldo y ofrece navegación al cobro, sin escribir datos', async () => {
  const f = fixture();
  const reply = await f.service.answer(user, dto('¿Qué falta para completar este pedido?', {orderId: ids.order}));
  assert.match(reply.text, /7.000/);
  assert.match(reply.text, /confirmar el pago completo/);
  assert.equal(reply.source, 'live');
  assert.ok(reply.actions.some(action => action.href.endsWith('&focus=billing')));
  const where = f.calls.find(([kind]) => kind === 'one')[1].where;
  assert.equal(where.locationId, ids.location);
  assert.equal(where.location.businessId, ids.business);
});
test('no confunde pago parcial con pago completo', async () => {
  const f = fixture();
  f.order.billOrders = [{bill: {status: 'PARTIALLY_PAID', total: 7000, payments: [{amount: 2000}]}}];
  const reply = await f.service.answer(user, dto('¿Por qué no puedo imprimir este pedido?', {orderId: ids.order}));
  assert.match(reply.text, /5.000/);
  assert.match(reply.text, /pago completo/);
  assert.ok(!reply.actions.some(action => /reimprimir/.test(action.label)));
});
test('pedido pagado ofrece reimpresión sin volver a cobrar', async () => {
  const f = fixture();
  f.order.billOrders = [{bill: {status: 'PAID', total: 7000, payments: [{amount: 7000}]}}];
  const reply = await f.service.answer(user, dto('¿Cómo reimprimo el vale de este pedido?', {orderId: ids.order}));
  assert.match(reply.text, /Pago completo confirmado/);
  assert.match(reply.text, /no vuelvas a cobrar/);
  assert.ok(reply.actions.some(action => /reimprimir/.test(action.label)));
});
test('pedidos pendientes y contexto de mesero filtran por asignación', async () => {
  const f = fixture(); const waiter = {...user, role: 'WAITER'};
  await f.service.answer(waiter, dto('¿Qué pedidos tengo pendientes de entrega?'));
  await f.service.answer(waiter, dto('¿Qué falta para este pedido?', {orderId: ids.order}));
  for (const [kind, args] of f.calls) if (['one', 'many'].includes(kind)) assert.equal(args.where.waiterId, user.userId);
  f.prisma.order.findFirst = async () => null;
  const denied = await f.service.answer(waiter, dto('Estado de este pedido', {orderId: ids.order}));
  assert.match(denied.text, /No encuentro/);
  assert.equal(denied.orderId, undefined);
});
test('busca código con SQL parametrizado y alcance de mesero', async () => {
  const f = fixture();
  const reply = await f.service.answer({...user, role: 'WAITER'}, dto('Busca el pedido ABC123'));
  const sql = f.calls.find(([kind]) => kind === 'sql')[1];
  assert.ok(sql.values.includes('abc123'));
  assert.ok(sql.values.includes(ids.user));
  assert.ok(sql.values.includes(ids.location));
  assert.ok(sql.values.includes(ids.business));
  assert.match(sql.strings.join(''), /waiterId/);
  assert.equal(reply.orderId, ids.order);
});
test('búsqueda por cliente preserva acentos y limita resultados', async () => {
  const f = fixture();
  await f.service.answer(user, dto('Busca pedidos del cliente José'));
  const args = f.calls.find(([kind]) => kind === 'many')[1];
  assert.equal(args.where.customerName.contains, 'José');
  assert.equal(args.take, 11);
});
test('un código explícito tiene prioridad sobre el pedido abierto', async () => {
  const f = fixture();
  await f.service.answer(user, dto('Busca este pedido ABC123', {orderId: ids.business}));
  assert.ok(f.calls.some(([kind]) => kind === 'sql'));
  assert.ok(!f.calls.some(([kind]) => kind === 'one'));
});
test('no ejecuta cobros ni expone reportes a cajero o mesero', async () => {
  const f = fixture();
  const blocked = await f.service.answer(user, dto('Cobra este pedido', {orderId: ids.order}));
  assert.match(blocked.text, /controles de confirmación/);
  const reports = await f.service.answer(user, dto('¿Cuánto vendimos hoy?'));
  assert.equal(reports.actions.length, 0);
  assert.equal(f.calls.filter(([kind]) => kind !== 'location').length, 0);
});
test('pregunta sugerida de búsqueda pide los datos que faltan', async () => {
  const f = fixture();
  const reply = await f.service.answer(user, dto('Buscar un pedido por código o cliente'));
  assert.match(reply.text, /Escribe el código/);
  assert.equal(f.calls.filter(([kind]) => kind !== 'location').length, 0);
});
test('guard reconoce assistant en rutas con prefijo y rechaza cocina', () => {
  const guard = new ScopedJwtAuthGuard({});
  const request = { originalUrl: '/api/assistant/messages', method: 'POST', user };
  assert.doesNotThrow(() => guard.authorizeOperation(request));
  assert.throws(() => guard.authorizeOperation({...request, user: {...user, role: 'KITCHEN'}}), /cocina/);
});
test('guard de sucursal valida el local del cuerpo y rechaza otro local', async () => {
  const f = fixture();
  const guard = new LocationScopeGuard(f.prisma);
  const request = { originalUrl: '/api/assistant/messages', method: 'POST', user, params: {}, query: {}, body: dto('ayuda') };
  const context = { switchToHttp: () => ({getRequest: () => request}) };
  assert.equal(await guard.canActivate(context), true);
  request.body.locationId = ids.business;
  await assert.rejects(guard.canActivate(context), /No tienes acceso/);
});
