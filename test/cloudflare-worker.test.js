import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../cloudflare/src/worker.js';

const order = {
  id: 42,
  public_token: 'public-order-token',
  customer_name: 'Анна Покупатель',
  phone: '+79001234567',
  total: 890,
  payment_status: 'pending',
  payment_method: 'seller_contact',
  items: JSON.stringify([
    { name: 'Полотенце хлопковое', quantity: 2, unitPrice: 220, lineTotal: 440 },
    { name: 'Плед', quantity: 1, unitPrice: 450, lineTotal: 450 }
  ])
};

function createDb({ alreadyNotified = false } = {}) {
  const insertedEvents = [];
  return {
    insertedEvents,
    prepare(sql) {
      return {
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async first() {
          if (sql.includes('SELECT id, public_token')) {
            return {
              id: order.id,
              public_token: order.public_token,
              payment_status: order.payment_status,
              payment_method: order.payment_method
            };
          }
          if (sql.includes('SELECT * FROM orders')) return order;
          if (sql.includes('FROM payment_logs')) return alreadyNotified ? { id: 7 } : null;
          return null;
        },
        async run() {
          insertedEvents.push({ sql, values: this.values });
          return { meta: { changes: 1 } };
        }
      };
    }
  };
}

test('buyer payment report sends Fami only the buyer and item details', async () => {
  const db = createDb();
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return Response.json({});
  };

  try {
    const response = await worker.fetch(
      new Request('https://shop.test/api/orders/42/paid-notice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicToken: order.public_token })
      }),
      {
        DB: db,
        BUYER_BOT_TOKEN: 'buyer-bot-token',
        BUYER_WEBHOOK_SECRET: 'buyer-webhook-secret',
        MAX_BOT_TOKEN: 'fami-bot-token',
        MAX_BOT_OWNER_ID: 'seller-user-id'
      },
      {}
    );

    assert.equal(response.status, 200);
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /platform-api2\.max\.ru\/messages\?user_id=seller-user-id$/);
    assert.equal(requests[0].options.headers.Authorization, 'fami-bot-token');
    const message = JSON.parse(requests[0].options.body).text;
    assert.match(message, /Анна Покупатель/);
    assert.match(message, /\+79001234567/);
    assert.match(message, /Полотенце хлопковое × 2/);
    assert.match(message, /Плед × 1/);
    assert.match(message, /890 ₽/);
    assert.match(message, /Проверьте поступление/);
    assert.equal(db.insertedEvents.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a repeated buyer payment report does not send Fami another notification', async () => {
  const originalFetch = globalThis.fetch;
  let sendCount = 0;
  globalThis.fetch = async () => {
    sendCount += 1;
    return Response.json({});
  };

  try {
    const response = await worker.fetch(
      new Request('https://shop.test/api/orders/42/paid-notice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicToken: order.public_token })
      }),
      {
        DB: createDb({ alreadyNotified: true }),
        BUYER_BOT_TOKEN: 'buyer-bot-token',
        MAX_BOT_TOKEN: 'fami-bot-token',
        MAX_BOT_OWNER_ID: 'seller-user-id'
      },
      {}
    );

    assert.equal(response.status, 200);
    assert.equal(sendCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Fami webhook updates are acknowledged but not handled after the buyer bot is connected', async () => {
  let queued = false;
  const response = await worker.fetch(
    new Request('https://shop.test/webhook', {
      method: 'POST',
      headers: { 'X-Max-Bot-Api-Secret': 'fami-webhook-secret' },
      body: JSON.stringify({ update_type: 'message_created' })
    }),
    {
      DB: {},
      BUYER_BOT_TOKEN: 'buyer-bot-token',
      BUYER_WEBHOOK_SECRET: 'buyer-webhook-secret',
      MAX_BOT_TOKEN: 'fami-bot-token',
      MAX_WEBHOOK_SECRET: 'fami-webhook-secret'
    },
    { waitUntil() { queued = true; } }
  );

  assert.equal(response.status, 200);
  assert.equal(queued, false);
});

test('unknown webhook secrets cannot trigger the buyer bot', async () => {
  let queued = false;
  const response = await worker.fetch(
    new Request('https://shop.test/webhook', {
      method: 'POST',
      headers: { 'X-Max-Bot-Api-Secret': 'invalid-secret' },
      body: JSON.stringify({ update_type: 'message_created' })
    }),
    {
      DB: {},
      BUYER_BOT_TOKEN: 'buyer-bot-token',
      BUYER_WEBHOOK_SECRET: 'buyer-webhook-secret',
      MAX_BOT_TOKEN: 'fami-bot-token',
      MAX_WEBHOOK_SECRET: 'fami-webhook-secret'
    },
    { waitUntil() { queued = true; } }
  );

  assert.equal(response.status, 401);
  assert.equal(queued, false);
});
