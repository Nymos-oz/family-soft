import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import test from 'node:test';
import {
  extractUploadedImageToken,
  formatProductList,
  replyToUpdate,
  runLongPollingBot
} from '../src/max-bot.js';

const products = [
  { id: 1, name: 'Плед', price: 1230, in_stock: 1, stock_qty: 2, images: '["/img/cat-blankets.jpg"]' },
  { id: 2, name: 'Одеяло', price: 4000, in_stock: 0, stock_qty: 0, images: '["/img/hero-day.jpg"]' }
];

function createChatDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE products (
      id INTEGER PRIMARY KEY, name TEXT, description TEXT, material TEXT, dimensions TEXT,
      care TEXT, price INTEGER, images TEXT, variants TEXT, in_stock INTEGER, stock_qty INTEGER
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, public_token TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL,
      delivery_type TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', items TEXT NOT NULL,
      subtotal INTEGER NOT NULL, delivery_price INTEGER NOT NULL, total INTEGER NOT NULL,
      pay_amount_unique INTEGER NOT NULL, status TEXT NOT NULL, payment_status TEXT NOT NULL,
      payment_method TEXT NOT NULL, idempotence_key TEXT NOT NULL UNIQUE,
      paid_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE payment_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, event TEXT, payload TEXT
    );
    CREATE TABLE max_chat_orders (order_id INTEGER PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE custom_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT, public_token TEXT NOT NULL,
      name TEXT NOT NULL, contact TEXT NOT NULL, item_type TEXT NOT NULL,
      details TEXT NOT NULL, deadline TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new'
    );
    CREATE TABLE max_chat_custom_requests (request_id INTEGER PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE contact_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, contact TEXT NOT NULL,
      message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new'
    );
  `);
  db.prepare(`INSERT INTO products
    (id, name, description, material, dimensions, care, price, images, variants, in_stock, stock_qty)
    VALUES (1, 'Плед', 'Мягкий плед', 'Плюш', '150×200 см', 'Стирка 30 °C',
      1230, '["/img/cat-blankets.jpg"]', '[]', 1, 3)`).run();
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?)').run('delivery_price', '450');
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?)').run('free_delivery_threshold', '10000');
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?)').run('pickup_address', 'Магазин');
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?)').run('owner_phone_display', '+7 901 826-77-81');
  return db;
}

function chatMessage(text, userId = 42) {
  return { update_type: 'message_created', message: { sender: { user_id: userId }, body: { text } } };
}

test('catalog shows stock and price and supports pages', () => {
  const pageOne = formatProductList(products, 1, 1);
  const pageTwo = formatProductList(products, 2, 1);

  assert.match(pageOne, /Каталог \(1\/2\)/);
  assert.match(pageOne, /1\s230 ₽ \(в наличии: 2 шт\.\)/);
  assert.match(pageOne, /Вернуться к началу каталога: каталог 1/);
  assert.match(pageTwo, /Одеяло.*4\s000 ₽ \(нет в наличии\)/);
});

test('catalog is empty-safe', () => {
  assert.equal(formatProductList([], 1), 'Пока в каталоге нет товаров.');
});

test('catalog page buttons advance from page one and wrap to page one', async () => {
  const sent = [];
  const pagedProducts = Array.from({ length: 9 }, (_, index) => ({
    ...products[index % products.length],
    id: index + 1
  }));
  const db = {
    prepare() {
      return {
        all: () => pagedProducts,
        get: () => undefined,
        run: () => ({ changes: 0 })
      };
    }
  };
  const sendMessage = async (userId, text, options) => sent.push({ userId, text, ...options });

  await replyToUpdate({
    update_type: 'message_created',
    message: { sender: { user_id: 42 }, body: { text: 'каталог' } }
  }, { db, sendMessage });
  assert.match(sent[0].text, /Каталог \(1\/2\)/);
  assert.ok(sent[0].buttons.some(row => row.some(button => button.text === 'Следующая страница (2/2)')));

  await replyToUpdate({
    update_type: 'message_created',
    message: { sender: { user_id: 42 }, body: { text: 'Следующая страница (2/2)' } }
  }, { db, sendMessage });
  assert.match(sent[1].text, /Каталог \(2\/2\)/);
  assert.ok(sent[1].buttons.some(row => row.some(button => button.text === 'Первая страница (1/2)')));

  await replyToUpdate({
    update_type: 'message_created',
    message: { sender: { user_id: 42 }, body: { text: 'Первая страница (1/2)' } }
  }, { db, sendMessage });
  assert.equal(sent.length, 3);
  assert.match(sent[2].text, /Каталог \(1\/2\)/);
  assert.ok(sent[2].buttons.some(row => row.some(button => button.payload === 'товар 1')));
});

test('message commands read products from the existing database', async () => {
  const sent = [];
  const db = {
    prepare(sql) {
      return {
        all: () => sql.includes('FROM products') ? products : [],
        get: id => id === 1 ? {
          id: 1,
          name: 'Плед',
          description: 'Мягкий плед',
          material: 'Плюш',
          dimensions: '150×200 см',
          care: 'Стирка 30 °C',
          price: 1230,
          images: '["/img/cat-blankets.jpg","/img/hero-day.jpg","/img/cat-blankets.jpg"]',
          variants: '["Синий"]',
          in_stock: 1,
          stock_qty: 2
        } : undefined
      };
    }
  };
  const sendMessage = async (userId, text, options) => sent.push({ userId, text, ...options });

  await replyToUpdate({
    update_type: 'message_created',
    message: { sender: { user_id: 42 }, body: { text: 'товар 1' } }
  }, { db, sendMessage });
  await replyToUpdate({
    update_type: 'message_created',
    message: { sender: { user_id: 42 }, body: { text: 'каталог' } }
  }, { db, sendMessage });

  assert.equal(sent.length, 2);
  assert.equal(sent[0].userId, 42);
  assert.match(sent[0].text, /Плед[\s\S]*Варианты: Синий/);
  assert.deepEqual(sent[0].buttons, [
    [{ type: 'message', text: 'Оформить заказ', payload: 'оплатить товар 1' }],
    [{ type: 'message', text: 'Каталог', payload: 'каталог' }, { type: 'message', text: 'Вопросы', payload: 'вопросы' }],
    [{ type: 'message', text: 'Найти товар', payload: 'найти товар' }],
    [{ type: 'message', text: 'Доставка', payload: 'доставка' }, { type: 'message', text: 'Оплата', payload: 'оплата' }],
    [{ type: 'message', text: 'Сшить на заказ', payload: 'сшить на заказ' }],
    [{ type: 'message', text: 'Мои заказы', payload: 'мои заказы' }, { type: 'message', text: 'Контакты', payload: 'контакты' }]
  ]);
  assert.deepEqual(sent[0].imagePaths, ['/img/cat-blankets.jpg', '/img/hero-day.jpg']);
  assert.match(sent[1].text, /Каталог \(1\/1\)/);
  assert.ok(sent[1].buttons.some(row => row.some(button => button.payload === 'товар 1')));
});

test('catalog search finds products by Russian words and links to product cards', async () => {
  const sent = [];
  const db = createChatDb();
  const sendMessage = async (userId, text, options) => sent.push({ userId, text, ...options });

  await replyToUpdate(chatMessage('найти ПЛЕД'), { db, sendMessage });

  assert.match(sent[0].text, /Нашёл по запросу «плед»/);
  assert.match(sent[0].text, /Товар 1 — Плед/);
  assert.ok(sent[0].buttons.some(row => row.some(button => button.payload === 'товар 1')));
  db.close();
});

test('catalog search button explains how to search', async () => {
  const sent = [];
  const db = createChatDb();
  const sendMessage = async (userId, text, options) => sent.push({ userId, text, ...options });

  await replyToUpdate(chatMessage('найти товар'), { db, sendMessage });

  assert.match(sent[0].text, /например: «найти плед»/);
  db.close();
});

test('product card has a checkout button that stays inside the MAX chat', async () => {
  const sent = [];
  const db = {
    prepare(sql) {
      return {
        get: () => sql.includes('FROM products') ? {
          id: 1,
          name: 'Плед',
          description: 'Мягкий плед',
          material: 'Плюш',
          dimensions: '150×200 см',
          care: 'Стирка 30 °C',
          price: 1230,
          images: '[]',
          variants: '[]',
          in_stock: 1,
          stock_qty: 2
        } : undefined
      };
    }
  };
  const sendMessage = async (userId, text, options) => sent.push({ userId, text, ...options });

  await replyToUpdate({
    update_type: 'message_created',
    message: { sender: { user_id: 42 }, body: { text: 'товар 1' } }
  }, { db, sendMessage });

  assert.deepEqual(sent[0].buttons[0], [{
    type: 'message',
    text: 'Оформить заказ',
    payload: 'оплатить товар 1'
  }]);
  assert.match(sent[0].text, /Плед/);
});

test('chat checkout reports missing SBP settings without collecting buyer details', async () => {
  const sent = [];
  const db = createChatDb();
  const sendMessage = async (userId, text, options) => sent.push({ userId, text, ...options });

  await replyToUpdate({
    update_type: 'message_created',
    message: { sender: { user_id: 42 }, body: { text: 'оплатить товар 1' } }
  }, { db, sendMessage, ownerUserId: 7 });

  assert.match(sent[0].text, /СБП/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 0);
  db.close();
});

test('bot start event welcomes user and ignores unrelated events', async () => {
  const sent = [];
  const sendMessage = async (userId, text, options) => sent.push({ userId, text, ...options });

  await replyToUpdate({ update_type: 'bot_started', user: { user_id: 7 } }, { db: {}, sendMessage });
  await replyToUpdate({ update_type: 'message_removed', user: { user_id: 7 } }, { db: {}, sendMessage });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].userId, 7);
  assert.match(sent[0].text, /Family Soft/);
  assert.doesNotMatch(sent[0].text, /публичный HTTPS-адрес/i);
  assert.ok(sent[0].buttons.some(row => row.some(button => button.payload === 'каталог')));
});

test('welcome menu and help text are fully chat-based', async () => {
  const sent = [];
  const sendMessage = async (userId, text, options) => sent.push({ userId, text, ...options });

  await replyToUpdate({
    update_type: 'bot_started',
    user: { user_id: 42 }
  }, { db: {}, sendMessage });

  assert.match(sent[0].text, /в этом чате/);
  assert.ok(sent[0].buttons.flat().every(button => button.type === 'message'));
});

test('seller gets Fami order dashboard and actionable menu buttons', async () => {
  const sent = [];
  const db = createChatDb();
  const sendMessage = async (userId, text, options = {}) => sent.push({ userId, text, ...options });
  await replyToUpdate({ update_type: 'bot_started', user: { user_id: 7 } }, {
    db, sendMessage, ownerUserId: 7
  });

  assert.match(sent[0].text, /Fami \| Заказы — помощник продавца Family Soft/);
  assert.match(sent[0].text, /каждый заказ был под контролем/);
  assert.deepEqual(sent[0].buttons.map(row => row.map(item => item.text)), [
    ['🔔 Новые заказы'],
    ['📦 Активные заказы'],
    ['🧵 Заявки', '✉️ Сообщения'],
    ['ℹ️ Помощь'],
    ['🏠 Панель продавца']
  ]);

  await replyToUpdate(chatMessage('/панель', 7), { db, sendMessage, ownerUserId: 7 });
  assert.match(sent.at(-1).text, /Fami \| Заказы/);
  await replyToUpdate(chatMessage('/новые заказы', 7), { db, sendMessage, ownerUserId: 7 });
  assert.match(sent.at(-1).text, /Новых заказов/);
  assert.ok(sent.at(-1).buttons.some(row => row[0].payload === '/активные заказы'));
  db.close();
});

test('custom sewing request begins an in-chat consent flow and sends the selected photo', async () => {
  const sent = [];
  const db = createChatDb();
  const sendMessage = async (userId, text, options) => sent.push({ userId, text, ...options });

  await replyToUpdate(chatMessage('Сшить на заказ'), { db, sendMessage, ownerUserId: 7 });

  assert.match(sent[0].text, /оформить здесь, в чате/);
  assert.deepEqual(sent[0].imagePaths, ['/img/custom-sewing.jpg']);
  db.close();
});

test('MAX image upload token is extracted from the generated photo id key', () => {
  assert.equal(extractUploadedImageToken({
    photos: { 'dynamic-photo-id': { token: 'media-token' } }
  }), 'media-token');
  assert.equal(extractUploadedImageToken({ photos: {} }), '');
});

test('MAX bot starts its polling loop without checking or requiring the website', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const outgoing = [];
  try {
    globalThis.fetch = async (input, options) => {
      const url = new URL(input);
      if (url.pathname === '/me') {
        return { ok: true, json: async () => ({ username: 'family_soft_test_bot' }) };
      }
      if (url.pathname === '/updates') {
        controller.abort();
        return {
          ok: true,
          json: async () => ({
            marker: 12,
            updates: [{ update_type: 'bot_started', user: { user_id: 42 } }]
          })
        };
      }
      if (url.pathname === '/messages') {
        outgoing.push(JSON.parse(options.body));
        return { ok: true, json: async () => ({ message: { body: { mid: 'test-message' } } }) };
      }
      throw new Error(`Unexpected MAX test request: ${url.pathname}`);
    };

    const stored = new Map();
    await runLongPollingBot({
      token: 'test-token',
      db: { prepare: () => ({ all: () => [] }) },
      setting: key => stored.get(key) || '',
      setSetting: (key, value) => stored.set(key, value),
      signal: controller.signal
    });

    const buttons = outgoing[0].attachments.find(item => item.type === 'inline_keyboard').payload.buttons;
    assert.ok(buttons.flat().every(button => button.type === 'message'));
    assert.equal(stored.get('max_bot_marker'), '12');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('MAX bot retries the legacy API host when the recommended host returns HTTP 526', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const messageHosts = [];
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      if (url.pathname === '/me') {
        return { ok: true, json: async () => ({ username: 'family_soft_test_bot' }) };
      }
      if (url.pathname === '/updates') {
        controller.abort();
        return {
          ok: true,
          json: async () => ({
            updates: [{ update_type: 'bot_started', user: { user_id: 42 } }]
          })
        };
      }
      if (url.pathname === '/messages') {
        messageHosts.push(url.hostname);
        return url.hostname === 'platform-api2.max.ru'
          ? { ok: false, status: 526, json: async () => ({}) }
          : { ok: true, json: async () => ({}) };
      }
      throw new Error(`Unexpected MAX test request: ${url.pathname}`);
    };

    await runLongPollingBot({
      token: 'test-token',
      db: { prepare: () => ({ all: () => [] }) },
      setting: () => '',
      setSetting: () => {},
      signal: controller.signal
    });
    assert.deepEqual(messageHosts, ['platform-api2.max.ru', 'platform-api.max.ru']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('support answers delivery and payment questions from current settings', async () => {
  const sent = [];
  const db = {
    prepare(sql) {
      return {
        get: key => {
          const values = {
            delivery_price: '500',
            free_delivery_threshold: '12000',
            pickup_address: 'Москва, улица Тестовая, 1',
            owner_phone_display: '+7 900 000-00-00'
          };
          return values[key] === undefined ? undefined : { value: values[key] };
        },
        all: () => []
      };
    }
  };
  const sendMessage = async (userId, text, options) => sent.push({ userId, text, ...options });

  await replyToUpdate({
    update_type: 'message_created',
    message: { sender: { user_id: 42 }, body: { text: 'Сколько стоит доставка?' } }
  }, { db, sendMessage });
  await replyToUpdate({
    update_type: 'message_created',
    message: { sender: { user_id: 42 }, body: { text: 'Оплата' } }
  }, { db, sendMessage });

  assert.match(sent[0].text, /500 ₽/);
  assert.match(sent[0].text, /12\s000 ₽/);
  assert.match(sent[0].text, /Москва, улица Тестовая, 1/);
  assert.match(sent[1].text, /прямо в чате/);
});

test('chat checkout creates a reserved order, sends SBP details, and notifies the owner', async () => {
  const sent = [];
  const db = createChatDb();
  const sendMessage = async (userId, text, options) => sent.push({ userId, text, ...options });
  const options = {
    db, sendMessage, ownerUserId: 7, sbpPhone: '+7 900 000-00-00',
    sbpBank: 'Тестовый банк', sbpReceiverName: 'Family Soft'
  };
  for (const text of [
    'оплатить товар 1', 'согласен, продолжить', '1', 'Анна', '89990000000',
    'самовывоз заказа', 'подтвердить заказ'
  ]) await replyToUpdate(chatMessage(text), options);

  const order = db.prepare('SELECT * FROM orders').get();
  assert.equal(order.customer_name, 'Анна');
  assert.equal(order.phone, '+79990000000');
  assert.equal(order.total, 1230);
  assert.equal(order.payment_status, 'pending');
  assert.equal(db.prepare('SELECT stock_qty FROM products WHERE id = 1').get().stock_qty, 2);
  assert.match(sent.find(item => item.userId === 42 && /1\s230,01 ₽/.test(item.text)).text, /1\s230,01 ₽/);
  const ownerNotice = sent.find(item => item.userId === 7);
  assert.match(ownerNotice.text, /Новый заказ №1/);
  assert.match(ownerNotice.text, /Покупатель: Анна/);
  assert.match(ownerNotice.text, /Плед × 1 — 1\s230 ₽/);
  assert.match(ownerNotice.text, /Сумма перевода: 1\s230,01 ₽/);
  assert.match(ownerNotice.text, /ожидает проверки/);
  assert.equal(ownerNotice.buttons[0][0].payload, '/оплачен 1');

  await replyToUpdate(chatMessage('мои заказы'), options);
  assert.match(sent.at(-1).text, /ожидается/);
  await replyToUpdate(chatMessage('/оплачен 1', 42), options);
  assert.equal(db.prepare('SELECT payment_status FROM orders WHERE id = 1').get().payment_status, 'pending');
  await replyToUpdate(chatMessage('/оплачен 1', 7), options);
  assert.equal(db.prepare('SELECT payment_status FROM orders WHERE id = 1').get().payment_status, 'paid');
  assert.match(sent.at(-1).text, /проверки поступления/);
  await replyToUpdate(chatMessage('/собирается 1', 7), options);
  await replyToUpdate(chatMessage('/готов к выдаче 1', 7), options);
  await replyToUpdate(chatMessage('/завершён 1', 7), options);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id = 1').get().status, 'done');
  assert.ok(sent.some(item => item.userId === 42 && /готов к самовывозу/.test(item.text)));
  db.close();
});

test('owner manages website and chat orders through payment and fulfillment statuses', async () => {
  const sent = [];
  const db = createChatDb();
  db.prepare(`INSERT INTO orders
    (public_token, customer_name, phone, email, delivery_type, address, items, subtotal,
     delivery_price, total, pay_amount_unique, status, payment_status, payment_method, idempotence_key)
    VALUES ('site-token', 'Ольга', '+79991112233', 'olga@example.test', 'delivery',
      'Москва, улица Тестовая, 1', ?, 2460, 450, 2910, 291001, 'new', 'pending',
      'manual', 'site-order-key')`).run(JSON.stringify([{
    productId: 1, name: 'Плед', quantity: 2, unitPrice: 1230, lineTotal: 2460
  }]));
  const options = {
    db,
    sendMessage: async (userId, text, payload) => sent.push({ userId, text, ...payload }),
    ownerUserId: 7
  };

  await replyToUpdate(chatMessage('/заказы', 7), options);
  assert.match(sent.at(-1).text, /сайт.*Ольга/);
  await replyToUpdate(chatMessage('/заказ 1', 7), options);
  assert.match(sent.at(-1).text, /olga@example\.test/);
  assert.match(sent.at(-1).text, /Плед × 2 — 2\s460 ₽/);
  await replyToUpdate(chatMessage('/оплачен 1', 7), options);
  assert.equal(db.prepare('SELECT payment_status FROM orders WHERE id = 1').get().payment_status, 'paid');
  await replyToUpdate(chatMessage('/собирается 1', 7), options);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id = 1').get().status, 'in_progress');
  await replyToUpdate(chatMessage('/отправлен 1', 7), options);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id = 1').get().status, 'shipped');
  await replyToUpdate(chatMessage('/завершён 1', 7), options);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id = 1').get().status, 'done');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM payment_logs WHERE event = 'max_owner_order_status'").get().count, 3);
  db.close();
});

test('buyer can cancel their own unpaid chat order and restore reserved stock', async () => {
  const sent = [];
  const db = createChatDb();
  const options = {
    db, sendMessage: async (userId, text) => sent.push({ userId, text }),
    ownerUserId: 7, sbpPhone: '+7 900 000-00-00', sbpBank: 'Тестовый банк', sbpReceiverName: 'Family Soft'
  };
  for (const text of [
    'оплатить товар 1', 'согласен, продолжить', '1', 'Анна', '89990000000',
    'самовывоз заказа', 'подтвердить заказ'
  ]) await replyToUpdate(chatMessage(text), options);

  await replyToUpdate(chatMessage('/отмена заказа 1'), options);
  assert.equal(db.prepare('SELECT payment_status FROM orders WHERE id = 1').get().payment_status, 'canceled');
  assert.equal(db.prepare('SELECT stock_qty FROM products WHERE id = 1').get().stock_qty, 3);
  assert.match(sent.find(item => item.userId === 42 && /товар снова доступен/.test(item.text)).text, /товар снова доступен/);
  db.close();
});

test('custom sewing request is collected and delivered to owner in the chat', async () => {
  const sent = [];
  const db = createChatDb();
  const options = { db, ownerUserId: 7, sendMessage: async (userId, text) => sent.push({ userId, text }) };
  for (const text of [
    'сшить на заказ', 'согласен, продолжить', 'Мария', '+7 901 111-22-33',
    'Детский плед', 'Размер 100 на 120 см, хлопковая ткань, светло-жёлтый цвет',
    'к 1 декабря'
  ]) await replyToUpdate(chatMessage(text), options);

  const request = db.prepare('SELECT * FROM custom_requests').get();
  assert.equal(request.name, 'Мария');
  assert.equal(request.item_type, 'Детский плед');
  assert.equal(request.deadline, 'к 1 декабря');
  assert.match(sent.find(item => item.userId === 42 && /Заявка на пошив №1 принята/.test(item.text)).text, /Заявка на пошив №1 принята/);
  assert.match(sent.find(item => item.userId === 7).text, /Новая заявка на пошив №1/);
  db.close();
});
