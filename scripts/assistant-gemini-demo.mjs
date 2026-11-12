import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { AssistantService } from '../dist/src/modules/assistant/assistant.service.js';
import { GeminiAssistantService } from '../dist/src/modules/assistant/gemini-assistant.service.js';

/** Live model + synthetic restaurant data; no connection to the real database. */
export async function checkAssistantGemini() {
  const locationId = '11111111-1111-4111-8111-111111111111';
  const businessId = '22222222-2222-4222-8222-222222222222';
  const user = {
    userId: businessId,
    businessId,
    locationId,
    role: 'CASHIER',
    sessionId: 'synthetic-demo',
  };
  const orders = ['Juan', 'Ana'].map((customerName, index) => ({
    id: `33333333-3333-4333-8333-333333abc12${index}`,
    locationId,
    customerName,
    type: 'TAKEAWAY',
    status: 'SENT',
    waiterId: null,
    items: [
      {
        quantity: 2,
        productNameSnapshot: 'Hamburguesa de prueba',
        unitPrice: 3000,
        status: 'SENT',
        modifiers: [],
      },
    ],
    billOrders: [
      { bill: { status: 'PAID', total: 6000, payments: [{ amount: 6000 }] } },
    ],
  }));
  let reads = 0;
  const prisma = {
    location: {
      findFirst: async () => ({ id: locationId, timezone: 'America/Santiago' }),
    },
    order: {
      findMany: async ({ where }) => {
        reads++;
        assert.equal(where.locationId, locationId);
        assert.equal(where.location.businessId, businessId);
        return orders.filter(
          (order) =>
            !where.customerName ||
            order.customerName
              .toLowerCase()
              .includes(where.customerName.contains.toLowerCase()),
        );
      },
      findFirst: async ({ where }) => {
        reads++;
        assert.equal(where.locationId, locationId);
        return orders.find((order) => order.id === where.id) ?? null;
      },
    },
  };
  const service = new AssistantService(
    prisma,
    new GeminiAssistantService(new ConfigService(process.env)),
  );
  const history = [];
  let orderId;
  for (const message of [
    'Muéstrame los pedidos para llevar pagados que faltan por entregar',
    'Muéstrame el de Juan',
    '¿Qué falta para completarlo?',
  ]) {
    const reply = await service.answer(user, {
      message,
      locationId,
      orderId,
      page: '/pedidos',
      history: history.slice(-8),
    });
    console.log(
      JSON.stringify({
        question: message,
        mode: reply.mode,
        text: reply.text,
        notice: reply.notice,
        actions: reply.actions.map((action) => action.label),
      }),
    );
    assert.equal(reply.mode, 'gemini');
    assert.equal(reply.source, 'live');
    history.push(
      { role: 'user', text: message },
      { role: 'assistant', text: reply.text.slice(0, 2500) },
    );
    orderId = reply.orderId;
  }
  assert.ok(reads >= 3, 'Each turn must consult current data');
  console.log(
    JSON.stringify({
      demo: 'passed',
      turns: 3,
      scopedDatabaseReads: reads,
      realRestaurantDataSent: false,
    }),
  );
}
