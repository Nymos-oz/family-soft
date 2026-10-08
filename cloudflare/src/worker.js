const API_URL = 'https://platform-api2.max.ru';
const LEGACY_API_URL = 'https://platform-api.max.ru';
const PAGE_SIZE = 8;
const SITE_URL = 'https://family-soft-max-bot.a28526710.workers.dev';

function button(text, payload) {
  return { type: 'message', text, payload };
}

function siteButton() {
  return { type: 'link', text: '🌐 Сайт Family Soft', url: SITE_URL };
}

function keyboard() {
  return [
    [button('Каталог', 'каталог'), button('Вопросы', 'вопросы')],
    [button('Найти товар', 'найти товар')],
    [button('Доставка', 'доставка'), button('Оплата', 'оплата')],
    [button('Сшить на заказ', 'сшить на заказ')],
    [button('Мои заказы', 'мои заказы'), button('Контакты', 'контакты')],
    [siteButton()]
  ];
}

function sellerKeyboard() {
  return [
    [button('🔔 Новые заказы', '/новые заказы')],
    [button('📦 Активные заказы', '/активные заказы')],
    [button('🧵 Заявки', '/заявки'), button('✉️ Сообщения', '/сообщения')],
    [button('ℹ️ Помощь', '/помощь продавцу')],
    [button('🏠 Панель продавца', '/панель')],
    [siteButton()]
  ];
}

function sellerWelcome() {
  return [
    '📦 Fami | Заказы — помощник продавца Family Soft',
    'Получайте новые заказы клиентов быстро и удобно.',
    '🔔 Уведомления о новых заказах',
    '👤 Данные покупателя',
    '🛍️ Состав и детали заказа',
    '💳 Информация об оплате',
    '🚚 Обработка и контроль заказов',
    'Fami — чтобы каждый заказ был под контролем 💗',
    `Сайт Family Soft: ${SITE_URL}`
  ].join('\n');
}

function money(value) {
  return `${new Intl.NumberFormat('ru-RU').format(value)} ₽`;
}

function moneyKopecks(value) {
  return `${new Intl.NumberFormat('ru-RU').format(Math.floor(value / 100))},${String(value % 100).padStart(2, '0')} ₽`;
}

function orderActionButtons(order) {
  const id = order.id;
  let actions = [];
  if (order.payment_status === 'pending') {
    actions = [
      [button('Подтвердить оплату', `/оплачен ${id}`)],
      [button('Отменить заказ', `/отменить заказ ${id}`)]
    ];
  } else if (order.payment_status === 'paid' && order.status === 'new') {
    actions = [[button('Начать сборку', `/собирается ${id}`)]];
  } else if (order.payment_status === 'paid' && order.status === 'in_progress') {
    actions = order.delivery_type === 'pickup'
      ? [[button('Готов к выдаче', `/готов к выдаче ${id}`)]]
      : [[button('Отправлен', `/отправлен ${id}`)]];
  } else if (order.payment_status === 'paid' && ['ready', 'shipped'].includes(order.status)) {
    actions = [[button('Завершить заказ', `/завершён ${id}`)]];
  }
  return [...actions, ...sellerKeyboard()];
}

function orderNotification(order, source) {
  const giftWrapPrice = Number(order.total) - Number(order.subtotal)
    + Number(order.discount || 0) - Number(order.delivery_price);
  const items = parseJsonColumn(order.items).map(item =>
    `• ${item.name}${item.variant ? ` (${item.variant})` : ''} × ${item.quantity} — ${money(item.lineTotal ?? item.unitPrice * item.quantity)}`
  );
  const paymentStatus = {
    pending: 'ожидает проверки',
    paid: 'подтверждена',
    canceled: 'отменена',
    refunded: 'возвращена'
  }[order.payment_status] || order.payment_status;
  return [
    `Новый заказ №${order.id} · ${source}`,
    `Покупатель: ${order.customer_name}`,
    `Телефон: ${order.phone}`,
    ...(order.email ? [`Email: ${order.email}`] : []),
    `Получение: ${order.delivery_type === 'pickup' ? 'самовывоз' : `доставка, ${order.address}`}`,
    'Состав заказа:',
    ...(items.length ? items : ['• Состав не указан']),
    `Товары: ${money(order.subtotal)}`,
    ...(order.discount ? [`Скидка: −${money(order.discount)}`] : []),
    ...(order.gift_wrap ? [`Подарочная упаковка: ${money(giftWrapPrice)}`] : []),
    `Доставка: ${money(order.delivery_price)}`,
    `Итого: ${money(order.total)}`,
    `Оплата: ${order.payment_method === 'manual'
      ? `перевод через СБП; ${paymentStatus}`
      : order.payment_method === 'seller_contact' ? 'по согласованию с продавцом' : `${order.payment_method}; ${paymentStatus}`}`,
    ...(order.payment_method === 'manual' ? [`Сумма перевода: ${moneyKopecks(order.pay_amount_unique)}`] : []),
    ...(order.promo_code ? [`Промокод: ${order.promo_code}`] : []),
    ...(order.comment ? [`Комментарий: ${order.comment}`] : []),
    order.payment_status === 'pending' && order.payment_method === 'manual'
      ? 'Проверьте поступление в банковском приложении перед подтверждением оплаты.'
      : order.payment_status === 'pending' && order.payment_method === 'seller_contact'
        ? 'Свяжитесь с покупателем и согласуйте оплату перед началом сборки.'
        : ''
  ].filter(Boolean).join('\n');
}

function paymentReportNotification(order) {
  const items = parseJsonColumn(order.items).map(item =>
    `• ${item.name}${item.variant ? ` (${item.variant})` : ''} × ${item.quantity}`
  );
  return [
    `Покупатель сообщил об оплате заказа №${order.id}.`,
    `Покупатель: ${order.customer_name}`,
    `Телефон: ${order.phone}`,
    'Товары:',
    ...(items.length ? items : ['• Состав заказа не указан']),
    `Сумма заказа: ${money(order.total)}`,
    'Проверьте поступление денег перед подтверждением оплаты.'
  ].join('\n');
}

function orderStatusMessage(orderId, status) {
  const messages = {
    in_progress: 'Магазин начал собирать ваш заказ.',
    ready: 'Ваш заказ готов к самовывозу.',
    shipped: 'Ваш заказ отправлен.',
    done: 'Заказ завершён. Спасибо за покупку!'
  };
  return `Заказ №${orderId}: ${messages[status] || 'Статус обновлён.'}`;
}

function normalize(text) {
  return text.toLowerCase().replace(/ё/g, 'е');
}

function safeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function eventKey(update) {
  const messageId = update.message?.body?.mid;
  if (messageId) return `message:${messageId}`;
  const content = JSON.stringify(update);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return `update:${[...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

async function maxRequest(env, endpoint, options = {}, botToken = env.BUYER_BOT_TOKEN || env.MAX_BOT_TOKEN) {
  if (!botToken) throw new Error('No MAX bot token is configured.');
  const requestOptions = {
    ...options,
    headers: {
      Authorization: botToken,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    },
    signal: AbortSignal.timeout(25000)
  };
  let response = await fetch(`${API_URL}${endpoint}`, requestOptions);
  if (response.status === 526) {
    console.warn('MAX API returned HTTP 526 on platform-api2.max.ru; retrying platform-api.max.ru.');
    response = await fetch(`${LEGACY_API_URL}${endpoint}`, requestOptions);
  }
  if (!response.ok) throw new Error(`MAX API ${endpoint.split('?')[0]} returned HTTP ${response.status}.`);
  return response.json();
}

async function imageToken(env, imagePath, origin, botToken) {
  if (!env.ASSETS || !/^\/img\/[A-Za-z0-9._-]+$/.test(imagePath)) return '';
  const asset = await env.ASSETS.fetch(new Request(new URL(imagePath, origin)));
  if (!asset.ok) throw new Error(`Image asset ${imagePath} returned HTTP ${asset.status}.`);
  const image = await asset.arrayBuffer();
  const upload = await maxRequest(env, '/uploads?type=image', { method: 'POST' }, botToken);
  if (typeof upload.url !== 'string') throw new Error('MAX did not provide an image upload URL.');
  const form = new FormData();
  form.append('data', new Blob([image], { type: asset.headers.get('content-type') || 'image/jpeg' }), imagePath.split('/').at(-1));
  const uploadedResponse = await fetch(upload.url, {
    method: 'POST',
    headers: { Authorization: botToken },
    body: form,
    signal: AbortSignal.timeout(25000)
  });
  if (!uploadedResponse.ok) throw new Error(`MAX image upload returned HTTP ${uploadedResponse.status}.`);
  const uploaded = await uploadedResponse.json();
  return Object.values(uploaded.photos || {}).find(photo => typeof photo?.token === 'string')?.token || '';
}

async function sendMessage(
  env,
  userId,
  text,
  { buttons, imagePaths = [] } = {},
  origin = 'https://workers.dev',
  botToken = env.BUYER_BOT_TOKEN || env.MAX_BOT_TOKEN
) {
  const attachments = [];
  let bodyText = text;
  for (const imagePath of imagePaths) {
    try {
      const token = await imageToken(env, imagePath, origin, botToken);
      if (token) attachments.push({
        type: 'image',
        text: imagePath.split('/').at(-1).replace(/\.[^.]+$/, ''),
        payload: { token }
      });
    } catch (error) {
      console.error('Could not attach bot image:', error.message);
      bodyText += '\n\nФото временно не удалось прикрепить.';
    }
  }
  if (buttons) attachments.push({ type: 'inline_keyboard', payload: { buttons } });
  const query = new URLSearchParams({ user_id: String(userId) });
  await maxRequest(env, `/messages?${query}`, {
    method: 'POST',
    body: JSON.stringify({ text: bodyText, ...(attachments.length ? { attachments } : {}) })
  }, botToken);
}

async function setting(db, key, fallback = '') {
  return (await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first())?.value ?? fallback;
}

async function saveState(db, userId, value) {
  if (value) {
    await db.prepare(`INSERT INTO chat_states(user_id, state_json) VALUES(?, ?)
      ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = CURRENT_TIMESTAMP`)
      .bind(String(userId), JSON.stringify(value)).run();
  } else {
    await db.prepare('DELETE FROM chat_states WHERE user_id = ?').bind(String(userId)).run();
  }
}

async function getState(db, userId) {
  const row = await db.prepare('SELECT state_json FROM chat_states WHERE user_id = ?').bind(String(userId)).first();
  if (!row) return null;
  try {
    return JSON.parse(row.state_json);
  } catch (error) {
    console.error('Invalid chat state in D1:', error.message);
    await saveState(db, userId, null);
    return null;
  }
}

async function products(db) {
  return db.prepare(`SELECT id, name, description, material, dimensions, care, price,
    images, variants, in_stock, stock_qty FROM products ORDER BY id`).all().then(result => result.results);
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function clean(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseJsonColumn(value, fallback = []) {
  try {
    const parsed = JSON.parse(value || JSON.stringify(fallback));
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function requestBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

async function siteConfig(env, db) {
  const manualReady = Boolean(env.MAX_BOT_OWNER_ID && env.SBP_PHONE && env.SBP_BANK && env.SBP_RECEIVER_NAME);
  return {
    shopName: 'Family Soft',
    phone: await setting(db, 'owner_phone_display', '+7 (901) 826-77-81'),
    metrikaId: '',
    paymentMode: 'manual',
    paymentAvailable: manualReady,
    orderAvailable: Boolean(env.MAX_BOT_OWNER_ID),
    deliveryPrice: Number(await setting(db, 'delivery_price', '450')),
    freeDeliveryThreshold: Number(await setting(db, 'free_delivery_threshold', '10000')),
    giftWrapPrice: Number(await setting(db, 'gift_wrap_price', '350')),
    pickupAddress: await setting(db, 'pickup_address', 'Адрес самовывоза уточняется после оформления заказа.'),
    accountLoginAvailable: false,
    accountEmailReady: false,
    accountSessionReady: false
  };
}

async function listSiteProducts(db, url) {
  const page = Math.max(1, Math.min(1000, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1));
  const conditions = [];
  const values = [];
  const category = clean(url.searchParams.get('category'), 80);
  if (category) {
    conditions.push('c.slug = ?');
    values.push(category);
  }
  const query = clean(url.searchParams.get('q'), 100);
  if (query) {
    conditions.push('(p.name LIKE ? OR p.description LIKE ? OR p.material LIKE ? OR p.dimensions LIKE ?)');
    const term = `%${query}%`;
    values.push(term, term, term, term);
  }
  for (const [key, operator, label] of [['min', '>=', 'минимальную'], ['max', '<=', 'максимальную']]) {
    const raw = url.searchParams.get(key);
    if (raw === null || raw === '') continue;
    const amount = Number(raw);
    if (!Number.isSafeInteger(amount) || amount < 0) return json({ error: `Укажите корректную ${label} цену.` }, 400);
    conditions.push(`p.price ${operator} ?`);
    values.push(amount);
  }
  const min = url.searchParams.get('min');
  const max = url.searchParams.get('max');
  if (min !== null && min !== '' && max !== null && max !== '' && Number(min) > Number(max)) {
    return json({ error: 'Минимальная цена не должна превышать максимальную.' }, 400);
  }
  if (url.searchParams.get('stock') === '1') conditions.push('p.in_stock = 1 AND p.stock_qty > 0');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sort = url.searchParams.get('sort') === 'price_asc' ? 'p.price ASC, p.id DESC'
    : url.searchParams.get('sort') === 'price_desc' ? 'p.price DESC, p.id DESC'
      : 'p.created_at DESC, p.id DESC';
  const total = await db.prepare(`SELECT COUNT(*) AS count FROM products p
    JOIN categories c ON c.id = p.category_id ${where}`).bind(...values).first();
  const rows = await db.prepare(`SELECT p.id, p.category_id, c.name AS category_name,
    c.slug AS category_slug, p.name, p.description, p.material, p.dimensions, p.care,
    p.price, p.images, p.variants, p.in_stock, p.stock_qty, p.created_at
    FROM products p JOIN categories c ON c.id = p.category_id ${where}
    ORDER BY ${sort} LIMIT 12 OFFSET ?`).bind(...values, (page - 1) * 12).all();
  return json({
    products: rows.results.map(product => ({
      ...product,
      images: parseJsonColumn(product.images),
      variants: parseJsonColumn(product.variants)
    })),
    total: total.count,
    page,
    pages: Math.ceil(total.count / 12)
  });
}

async function calculateSiteOrder(db, body) {
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 40) {
    return { error: 'Корзина пуста или содержит слишком много товаров.', status: 400 };
  }
  const merged = new Map();
  for (const item of body.items) {
    const productId = Number(item?.productId);
    const quantity = Number(item?.quantity);
    if (!Number.isSafeInteger(productId) || productId < 1 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) {
      return { error: 'Проверьте товары и количество в корзине.', status: 400 };
    }
    const variant = clean(item.variant, 80);
    const key = `${productId}:${variant}`;
    const current = merged.get(key);
    const totalQuantity = (current?.quantity || 0) + quantity;
    if (totalQuantity > 20) return { error: 'Количество одного варианта товара не может превышать 20.', status: 400 };
    merged.set(key, { productId, quantity: totalQuantity, variant });
  }
  const result = [];
  for (const item of merged.values()) {
    const product = await db.prepare(`SELECT p.id, p.name, p.price, p.images, p.in_stock,
      p.stock_qty, p.variants FROM products p WHERE p.id = ?`).bind(item.productId).first();
    if (!product) return { error: 'Один из товаров больше не доступен.', status: 400 };
    if (!product.in_stock || product.stock_qty < item.quantity) {
      return { error: `Недостаточно товара «${product.name}» в наличии.`, status: 409 };
    }
    const variants = parseJsonColumn(product.variants);
    if (item.variant && !variants.includes(item.variant)) {
      return { error: `Выбранный вариант товара «${product.name}» больше не доступен.`, status: 400 };
    }
    result.push({
      ...item,
      name: product.name,
      unitPrice: product.price,
      lineTotal: product.price * item.quantity,
      image: parseJsonColumn(product.images)[0] || ''
    });
  }
  const totals = new Map();
  for (const item of result) totals.set(item.productId, (totals.get(item.productId) || 0) + item.quantity);
  for (const [productId, quantity] of totals) {
    const product = await db.prepare('SELECT name, in_stock, stock_qty FROM products WHERE id = ?').bind(productId).first();
    if (!product?.in_stock || product.stock_qty < quantity) {
      return { error: `Недостаточно товара «${product?.name || 'в корзине'}» в наличии.`, status: 409 };
    }
  }
  const subtotal = result.reduce((sum, item) => sum + item.lineTotal, 0);
  let discount = 0;
  const promoCode = clean(body.promoCode, 40).toUpperCase();
  if (promoCode) {
    const promo = await db.prepare('SELECT * FROM promo_codes WHERE code = ? AND active = 1').bind(promoCode).first();
    if (!promo || (promo.expires_at && Date.parse(promo.expires_at) < Date.now())
      || (promo.usage_limit !== null && promo.usage_limit !== undefined && promo.used_count >= promo.usage_limit)
      || subtotal < promo.min_total) {
      return { error: 'Промокод недействителен или условия его применения не выполнены.', status: 400 };
    }
    discount = promo.type === 'percent'
      ? Math.min(subtotal, Math.floor(subtotal * promo.value / 100))
      : Math.min(subtotal, promo.value);
  }
  const giftWrap = body.giftWrap === true;
  const wrapPrice = giftWrap ? Number(await setting(db, 'gift_wrap_price', '350')) : 0;
  const deliveryType = body.deliveryType === 'pickup' ? 'pickup' : 'delivery';
  const deliveryPrice = deliveryType === 'pickup' || subtotal - discount >= Number(await setting(db, 'free_delivery_threshold', '10000'))
    ? 0 : Number(await setting(db, 'delivery_price', '450'));
  const address = deliveryType === 'pickup'
    ? await setting(db, 'pickup_address', 'Адрес самовывоза уточняется после оформления заказа.')
    : clean(body.address, 300);
  if (deliveryType === 'delivery' && address.length < 8) {
    return { error: 'Укажите полный адрес доставки.', status: 400 };
  }
  return {
    items: result, subtotal, discount, giftWrap, wrapPrice, deliveryPrice,
    total: subtotal - discount + wrapPrice + deliveryPrice, promoCode,
    deliveryType, address
  };
}

async function createSiteOrder(request, env, db, url) {
  const body = await requestBody(request);
  if (!body) return json({ error: 'Некорректные данные заказа.' }, 400);
  const name = clean(body.name, 100);
  const phone = clean(body.phone, 30).replace(/[\s()-]/g, '');
  const email = clean(body.email, 254).toLowerCase();
  if (!name || !phone || !email) return json({ error: 'Заполните имя, телефон и email.' }, 400);
  if (!/^\+7\d{10}$/.test(phone)) return json({ error: 'Введите телефон в формате +7XXXXXXXXXX.' }, 400);
  if (!validEmail(email)) return json({ error: 'Введите корректный email.' }, 400);
  if (body.consentData !== true || body.consentOffer !== true) {
    return json({ error: 'Подтвердите согласие с политикой конфиденциальности и офертой.' }, 400);
  }
  if (!env.MAX_BOT_OWNER_ID) {
    return json({ error: 'Приём заказов временно недоступен. Свяжитесь с магазином.' }, 503);
  }
  const paymentMethod = env.SBP_PHONE && env.SBP_BANK && env.SBP_RECEIVER_NAME
    ? 'manual'
    : 'seller_contact';
  const idempotenceKey = clean(request.headers.get('Idempotency-Key'), 80);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotenceKey)) {
    return json({ error: 'Не удалось подтвердить запрос заказа. Обновите страницу и попробуйте ещё раз.' }, 400);
  }
  const existing = await db.prepare(`SELECT id, public_token, total, pay_amount_unique,
    payment_status, payment_method FROM orders WHERE idempotence_key = ?`).bind(idempotenceKey).first();
  if (existing) {
    if (existing.payment_status !== 'pending' || !['manual', 'seller_contact'].includes(existing.payment_method)) {
      return json({ error: 'Этот запрос уже завершён. Проверьте статус предыдущего заказа.' }, 409);
    }
    return json({
      id: existing.id,
      publicToken: existing.public_token,
      total: existing.total,
      ...(existing.payment_method === 'manual' ? { payAmount: existing.pay_amount_unique } : {}),
      statusUrl: `/order/${existing.id}/status?t=${encodeURIComponent(existing.public_token)}`
    });
  }
  const calculated = await calculateSiteOrder(db, body);
  if (calculated.error) return json({ error: calculated.error }, calculated.status);
  const rawUnique = request.headers.get('Idempotency-Key');
  const pending = await db.prepare(`SELECT pay_amount_unique FROM orders
    WHERE payment_status = 'pending'`).all();
  const used = new Set(pending.results.map(row => row.pay_amount_unique));
  let uniqueAmount = 0;
  for (let kopecks = 1; kopecks < 100; kopecks += 1) {
    const candidate = calculated.total * 100 + kopecks;
    if (!used.has(candidate)) {
      uniqueAmount = candidate;
      break;
    }
  }
  if (!uniqueAmount) return json({ error: 'Не удалось подобрать уникальную сумму перевода. Попробуйте позже.' }, 503);
  const publicToken = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const items = JSON.stringify(calculated.items);
  const inserted = await db.prepare(`INSERT INTO orders
    (public_token, customer_name, phone, email, delivery_type, address, comment, items,
      subtotal, discount, gift_wrap, gift_card_text, delivery_price, total, pay_amount_unique,
      promo_code, status, payment_status, payment_method, idempotence_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 'pending', ?, ?)`)
    .bind(publicToken, name, phone, email, calculated.deliveryType, calculated.address,
      clean(body.comment, 500), items, calculated.subtotal, calculated.discount,
      calculated.giftWrap ? 1 : 0, clean(body.giftCardText, 300), calculated.deliveryPrice,
      calculated.total, uniqueAmount, calculated.promoCode, paymentMethod, idempotenceKey).run();
  const orderId = inserted.meta.last_row_id;
  const quantities = new Map();
  for (const item of calculated.items) quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity);
  const reservations = await db.batch([...quantities].map(([productId, quantity]) =>
    db.prepare(`UPDATE products SET stock_qty = stock_qty - ?,
      in_stock = CASE WHEN stock_qty - ? > 0 THEN 1 ELSE 0 END
      WHERE id = ? AND in_stock = 1 AND stock_qty >= ?`).bind(quantity, quantity, productId, quantity)
  ));
  if (reservations.some(result => result.meta.changes !== 1)) {
    await db.batch([...quantities].filter((_, index) => reservations[index].meta.changes === 1).map(([productId, quantity]) =>
      db.prepare('UPDATE products SET stock_qty = stock_qty + ?, in_stock = 1 WHERE id = ?')
        .bind(quantity, productId)
    ));
    await db.prepare('DELETE FROM orders WHERE id = ?').bind(orderId).run();
    return json({ error: 'Один из товаров только что закончился. Обновите корзину и попробуйте снова.' }, 409);
  }
  if (calculated.promoCode) {
    await db.prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ?')
      .bind(calculated.promoCode).run();
  }
  await db.prepare(`INSERT INTO payment_logs(order_id, event, payload)
    VALUES (?, ?, '{}')`).bind(orderId,
    paymentMethod === 'manual' ? 'website_manual_order_created' : 'website_seller_contact_order_created').run();
  try {
    const order = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
    await notifyOwner(env, orderNotification(order, 'с сайта'), url.origin, {
      buttons: orderActionButtons(order)
    });
  } catch (error) {
    console.error('Could not notify owner about website order:', error.message);
  }
  return json({
    id: orderId,
    publicToken,
    total: calculated.total,
    ...(paymentMethod === 'manual' ? { payAmount: uniqueAmount } : {}),
    statusUrl: `/order/${orderId}/status?t=${encodeURIComponent(publicToken)}`
  }, 201);
}

async function handleSiteApi(request, env, url) {
  const db = env.DB;
  const path = url.pathname;
  if (path === '/api/config' && request.method === 'GET') return json(await siteConfig(env, db));
  if (path === '/api/categories' && request.method === 'GET') {
    const rows = await db.prepare('SELECT id, name, slug, image, sort_order FROM categories ORDER BY sort_order, id').all();
    return json(rows.results);
  }
  if (path === '/api/products' && request.method === 'GET') return listSiteProducts(db, url);
  const productReviews = path.match(/^\/api\/products\/(\d+)\/reviews$/);
  if (productReviews && request.method === 'GET') return json([]);
  const product = path.match(/^\/api\/products\/(\d+)$/);
  if (product && request.method === 'GET') {
    const row = await db.prepare(`SELECT p.*, c.name AS category_name, c.slug AS category_slug
      FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ?`)
      .bind(Number(product[1])).first();
    return row
      ? json({ ...row, images: parseJsonColumn(row.images), variants: parseJsonColumn(row.variants) })
      : json({ error: 'Товар не найден.' }, 404);
  }
  if (path === '/api/faq' && request.method === 'GET') {
    const rows = await db.prepare(`SELECT question, answer FROM faq_items
      WHERE published = 1 ORDER BY sort_order, id`).all();
    return json(rows.results);
  }
  if (path === '/api/blog' && request.method === 'GET') {
    const rows = await db.prepare(`SELECT slug, title, cover, content_md, created_at
      FROM blog_posts WHERE published = 1 ORDER BY created_at DESC`).all();
    return json(rows.results);
  }
  const page = path.match(/^\/api\/pages\/([a-z0-9-]+)$/i);
  if (page && request.method === 'GET') {
    const row = await db.prepare('SELECT slug, title, content FROM pages WHERE slug = ?').bind(page[1]).first();
    return row ? json(row) : json({ error: 'Страница не найдена.' }, 404);
  }
  if (path === '/api/account/session' && request.method === 'GET') {
    return json({ authenticated: false, loginAvailable: false });
  }
  if (path === '/api/promo/check' && request.method === 'POST') {
    const body = await requestBody(request);
    if (!body) return json({ error: 'Некорректные данные промокода.' }, 400);
    const calculation = await calculateSiteOrder(db, { ...body, deliveryType: 'pickup', address: '' });
    if (calculation.error) return json({ error: calculation.error }, calculation.status);
    if (!calculation.promoCode) return json({ error: 'Введите промокод.' }, 400);
    return json({ code: calculation.promoCode, discount: calculation.discount, subtotal: calculation.subtotal });
  }
  if (path === '/api/orders' && request.method === 'POST') return createSiteOrder(request, env, db, url);
  const orderStatus = path.match(/^\/api\/orders\/(\d+)\/status$/);
  if (orderStatus && request.method === 'GET') {
    const row = await db.prepare(`SELECT id, public_token, customer_name, delivery_type, address,
      items, gift_wrap, gift_card_text, subtotal, discount, delivery_price, total, pay_amount_unique,
      promo_code, status, payment_status, payment_method, paid_at, created_at
      FROM orders WHERE id = ?`).bind(Number(orderStatus[1])).first();
    if (!row || !safeEqual(url.searchParams.get('t') || '', row.public_token)) {
      return json({ error: 'Заказ не найден или ссылка устарела.' }, 404);
    }
    return json({
      ...row,
      items: parseJsonColumn(row.items),
      manualPayment: row.payment_method === 'manual'
        ? { phone: env.SBP_PHONE || '', bank: env.SBP_BANK || '', receiver: env.SBP_RECEIVER_NAME || '' }
        : null
    });
  }
  const paidNotice = path.match(/^\/api\/orders\/(\d+)\/paid-notice$/);
  if (paidNotice && request.method === 'POST') {
    const body = await requestBody(request);
    const row = await db.prepare('SELECT id, public_token, payment_status, payment_method FROM orders WHERE id = ?')
      .bind(Number(paidNotice[1])).first();
    if (!row || !body || !safeEqual(body.publicToken || '', row.public_token)) return json({ error: 'Заказ не найден.' }, 404);
    if (!['manual', 'seller_contact'].includes(row.payment_method)) {
      return json({ error: 'Сообщить об оплате можно только для заказа с оплатой по договорённости.' }, 400);
    }
    if (row.payment_status !== 'pending') return json({ error: 'Статус оплаты уже изменён.' }, 409);
    try {
      const order = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(row.id).first();
      const duplicate = await db.prepare(`SELECT id FROM payment_logs
        WHERE order_id = ? AND event = 'website_payment_reported_to_fami' LIMIT 1`)
        .bind(row.id).first();
      if (duplicate) return json({ message: 'Продавец уже получил сообщение об оплате. Спасибо!' });
      const sellerToken = env.MAX_BOT_TOKEN;
      if (!sellerToken || !env.MAX_BOT_OWNER_ID) {
        console.error('Fami payment notification is not configured.');
        return json({ error: 'Не удалось сообщить продавцу. Позвоните в магазин по телефону на странице контактов.' }, 503);
      }
      await sendMessage(env, env.MAX_BOT_OWNER_ID, paymentReportNotification(order), {}, url.origin, sellerToken);
      await db.prepare(`INSERT INTO payment_logs(order_id, event, payload)
        VALUES (?, 'website_payment_reported_to_fami', '{}')`).bind(row.id).run();
    } catch (error) {
      console.error('Could not notify Fami about reported payment:', error.message);
      return json({ error: 'Не удалось отправить сообщение продавцу. Попробуйте ещё раз или позвоните в магазин.' }, 503);
    }
    return json({ message: 'Сообщение отправлено продавцу. Он проверит поступление оплаты.' });
  }
  if (path === '/api/custom-requests' && request.method === 'POST') {
    const body = await requestBody(request);
    if (!body) return json({ error: 'Заполните данные заявки.' }, 400);
    const name = clean(body.name, 100);
    const contact = clean(body.contact, 150);
    const itemType = clean(body.itemType, 100);
    const details = clean(body.details, 2000);
    if (!name || !contact || !itemType || details.length < 10) {
      return json({ error: 'Заполните имя, контакт, тип изделия и описание (не менее 10 символов).' }, 400);
    }
    const publicToken = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
    const inserted = await db.prepare(`INSERT INTO custom_requests
      (public_token, name, contact, item_type, details, deadline) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(publicToken, name, contact, itemType, details, clean(body.deadline, 100)).run();
    try {
      await notifyOwner(env, `Новая заявка с сайта №${inserted.meta.last_row_id}: ${name}, ${contact}; ${itemType}. ${details}`, url.origin);
    } catch (error) {
      console.error('Could not notify owner about custom request:', error.message);
    }
    return json({
      id: inserted.meta.last_row_id,
      statusUrl: `/custom/request/${inserted.meta.last_row_id}?t=${encodeURIComponent(publicToken)}`,
      message: 'Заявка сохранена. Мы свяжемся с вами по оставленному контакту.'
    }, 201);
  }
  const customStatus = path.match(/^\/api\/custom-requests\/(\d+)\/status$/);
  if (customStatus && request.method === 'GET') {
    const row = await db.prepare(`SELECT id, public_token, item_type, details, status, created_at
      FROM custom_requests WHERE id = ?`).bind(Number(customStatus[1])).first();
    if (!row || !safeEqual(url.searchParams.get('t') || '', row.public_token)) {
      return json({ error: 'Заявка не найдена или ссылка устарела.' }, 404);
    }
    return json({ id: row.id, item_type: row.item_type, details: row.details, status: row.status, created_at: row.created_at });
  }
  if (path === '/api/contact' && request.method === 'POST') {
    const body = await requestBody(request);
    if (!body) return json({ error: 'Некорректное сообщение.' }, 400);
    const name = clean(body.name, 100);
    const contact = clean(body.contact, 150);
    const message = clean(body.message, 1000);
    if (!name || !contact || message.length < 3) return json({ error: 'Заполните имя, контакт и сообщение.' }, 400);
    const inserted = await db.prepare(`INSERT INTO contact_messages(name, contact, message)
      VALUES (?, ?, ?)`).bind(name, contact, message).run();
    try {
      await notifyOwner(env, `Новое сообщение с сайта №${inserted.meta.last_row_id}: ${name}, ${contact}. ${message}`, url.origin);
    } catch (error) {
      console.error('Could not notify owner about contact message:', error.message);
    }
    return json({ message: 'Сообщение отправлено. Спасибо!' }, 201);
  }
  return null;
}

async function catalog(env, userId, requestedPage, origin) {
  const rows = await products(env.DB);
  if (!rows.length) {
    await sendMessage(env, userId, 'Пока в каталоге нет товаров.', { buttons: keyboard() }, origin);
    return;
  }
  const pages = Math.ceil(rows.length / PAGE_SIZE);
  const page = Math.max(1, Math.min(Number(requestedPage) || 1, pages));
  const start = (page - 1) * PAGE_SIZE;
  const text = [
    `Каталог (${page}/${pages})`,
    '',
    ...rows.slice(start, start + PAGE_SIZE).map(product =>
      `Товар ${product.id} — ${product.name} — ${money(product.price)}${product.in_stock && product.stock_qty > 0 ? ` (в наличии: ${product.stock_qty} шт.)` : ' (нет в наличии)'}`
    ),
    '',
    'Нажмите кнопку товара, чтобы посмотреть описание и фото.'
  ].join('\n');
  const buttons = rows.slice(start, start + PAGE_SIZE).map(product => [button(`Товар ${product.id}`, `товар ${product.id}`)]);
  if (pages > 1) {
    const next = page < pages ? page + 1 : 1;
    buttons.push([button(page < pages ? `Следующая страница (${next}/${pages})` : `Первая страница (1/${pages})`, `каталог ${next}`)]);
  }
  buttons.push(...keyboard());
  await sendMessage(env, userId, text, { buttons }, origin);
}

function searchTerms(query) {
  return normalize(query).match(/[\p{L}\p{N}]+/gu)?.filter(term => term.length > 1).slice(0, 6) || [];
}

async function searchCatalog(env, userId, query, origin) {
  const terms = searchTerms(query);
  if (!terms.length) {
    await sendMessage(env, userId, 'Напишите, что ищете, например: «найти плед» или «найти детский хлопок».', {
      buttons: keyboard()
    }, origin);
    return;
  }
  const rows = await products(env.DB);
  const matches = rows.filter(product => {
    const details = normalize([
      product.name, product.description, product.material, product.dimensions, product.care, product.variants
    ].join(' '));
    return terms.every(term => details.includes(term));
  }).slice(0, PAGE_SIZE);
  const text = matches.length
    ? `Нашёл по запросу «${query}»:\n\n${matches.map(product =>
      `Товар ${product.id} — ${product.name} — ${money(product.price)}${product.in_stock && product.stock_qty > 0 ? ` (в наличии: ${product.stock_qty} шт.)` : ' (нет в наличии)'}`
    ).join('\n')}\n\nНажмите товар, чтобы посмотреть фото и описание.`
    : `По запросу «${query}» ничего не нашёл. Попробуйте другое слово или откройте каталог.`;
  const buttons = matches.map(product => [button(`Товар ${product.id}`, `товар ${product.id}`)]);
  buttons.push(...keyboard());
  await sendMessage(env, userId, text, { buttons }, origin);
}

async function productCard(env, userId, productId, origin) {
  const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(productId).first();
  if (!product) {
    await sendMessage(env, userId, 'Не нашёл такой товар. Напишите «каталог».', { buttons: keyboard() }, origin);
    return;
  }
  const variants = JSON.parse(product.variants || '[]');
  const images = JSON.parse(product.images || '[]');
  const text = [
    product.name,
    `Цена: ${money(product.price)}`,
    product.in_stock && product.stock_qty > 0 ? `В наличии: ${product.stock_qty} шт.` : 'Сейчас нет в наличии',
    product.description,
    `Материал: ${product.material}`,
    `Размеры: ${product.dimensions}`,
    `Уход: ${product.care}`,
    ...(variants.length ? [`Варианты: ${variants.join(', ')}`] : [])
  ].join('\n');
  await sendMessage(env, userId, text, {
    buttons: [[button('Оформить заказ', `оплатить товар ${product.id}`)], ...keyboard()],
    imagePaths: images
  }, origin);
}

async function calculate(db, state) {
  const product = await db.prepare(`SELECT id, name, price, in_stock, stock_qty, variants
    FROM products WHERE id = ?`).bind(state.productId).first();
  if (!product || !product.in_stock || product.stock_qty < state.quantity) {
    throw new Error('Товар закончился или нужного количества больше нет. Выберите другой товар в каталоге.');
  }
  const subtotal = product.price * state.quantity;
  const freeThreshold = Number(await setting(db, 'free_delivery_threshold', '10000'));
  const deliveryPrice = state.deliveryType === 'pickup'
    ? 0
    : subtotal >= freeThreshold ? 0 : Number(await setting(db, 'delivery_price', '450'));
  return { product, subtotal, deliveryPrice, total: subtotal + deliveryPrice };
}

function phoneNumber(text) {
  const digits = text.replace(/\D/g, '');
  if (digits.length === 10) return `+7${digits}`;
  if (digits.length === 11 && ['7', '8'].includes(digits[0])) return `+7${digits.slice(1)}`;
  return '';
}

async function persistOrder(db, userId, state, calculated) {
  const { product, subtotal, deliveryPrice, total } = calculated;
  const pending = await db.prepare(`SELECT pay_amount_unique FROM orders WHERE payment_status = 'pending'`).all();
  const used = new Set(pending.results.map(row => row.pay_amount_unique));
  let uniqueAmount = 0;
  for (let extra = 1; extra < 100; extra += 1) {
    if (!used.has(total * 100 + extra)) {
      uniqueAmount = total * 100 + extra;
      break;
    }
  }
  if (!uniqueAmount) throw new Error('Не удалось подобрать сумму перевода. Попробуйте оформить заказ позже.');
  const publicToken = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const idempotenceKey = crypto.randomUUID();
  const item = JSON.stringify([{
    productId: product.id,
    name: product.name,
    variant: state.variant || '',
    quantity: state.quantity,
    unitPrice: product.price,
    lineTotal: subtotal
  }]);
  const results = await db.batch([
    db.prepare(`UPDATE products SET stock_qty = stock_qty - ?,
      in_stock = CASE WHEN stock_qty - ? > 0 THEN 1 ELSE 0 END
      WHERE id = ? AND in_stock = 1 AND stock_qty >= ?`)
      .bind(state.quantity, state.quantity, product.id, state.quantity),
    db.prepare(`INSERT INTO orders
      (public_token, customer_name, phone, delivery_type, address, items, subtotal,
       delivery_price, total, pay_amount_unique, status, payment_status, payment_method, idempotence_key)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 'pending', 'manual', ?
      WHERE changes() = 1`)
      .bind(publicToken, state.name, state.phone, state.deliveryType,
        state.address || await setting(db, 'pickup_address', 'Адрес самовывоза уточняется после оформления заказа.'),
        item, subtotal, deliveryPrice, total, uniqueAmount, idempotenceKey),
    db.prepare(`INSERT INTO max_chat_orders(order_id, user_id)
      SELECT last_insert_rowid(), ? WHERE changes() = 1`).bind(String(userId)),
    db.prepare(`INSERT INTO payment_logs(order_id, event, payload)
      SELECT last_insert_rowid(), 'max_chat_order_created', ? WHERE changes() = 1`).bind(JSON.stringify({ user_id: String(userId) }))
  ]);
  if (results[1].meta.changes !== 1) throw new Error('Товар только что закончился или сумма СБП занята. Попробуйте ещё раз.');
  return {
    id: results[1].meta.last_row_id,
    customer_name: state.name,
    phone: state.phone,
    delivery_type: state.deliveryType,
    address: state.address,
    total,
    pay_amount_unique: uniqueAmount,
    product_name: product.name,
    quantity: state.quantity,
    variant: state.variant || ''
  };
}

async function orderStatus(db, userId) {
  const result = await db.prepare(`SELECT o.id, o.status, o.payment_status
    FROM orders o JOIN max_chat_orders c ON c.order_id = o.id
    WHERE c.user_id = ? ORDER BY o.id DESC LIMIT 10`).bind(String(userId)).all();
  if (!result.results.length) return 'В этом чате пока нет заказов. Напишите «каталог», чтобы выбрать товар.';
  const payment = { pending: 'ожидается', paid: 'оплачено', canceled: 'отменено', refunded: 'возврат оформлен' };
  const status = {
    new: order => order.payment_status === 'paid' ? 'оплачен, ожидает сборки' : 'принят',
    on_hold: 'проверяется',
    in_progress: 'собирается',
    ready: 'готов к выдаче',
    shipped: 'отправлен',
    done: 'завершён',
    canceled: 'отменён'
  };
  return result.results.map(order =>
    `Заказ №${order.id}: ${typeof status[order.status] === 'function' ? status[order.status](order) : status[order.status] || order.status}; оплата — ${payment[order.payment_status] || order.payment_status}.${order.payment_status === 'pending' ? ` Для отмены: /отмена заказа ${order.id}.` : ''}`
  ).join('\n');
}

async function cancelOrder(db, orderId, userId = '') {
  const existing = userId
    ? await db.prepare(`SELECT o.id, o.items FROM orders o JOIN max_chat_orders c ON c.order_id = o.id
      WHERE o.id = ? AND c.user_id = ? AND o.payment_status = 'pending'
        AND o.payment_method IN ('manual', 'seller_contact')`)
      .bind(orderId, String(userId)).first()
    : await db.prepare(`SELECT o.id, o.items FROM orders o
      WHERE o.id = ? AND o.payment_status = 'pending'
        AND o.payment_method IN ('manual', 'seller_contact')`)
      .bind(orderId).first();
  if (!existing) return false;
  const items = JSON.parse(existing.items);
  const statements = items.map(item => db.prepare(`UPDATE products SET stock_qty = stock_qty + ?,
    in_stock = 1 WHERE id = ?`).bind(item.quantity, item.productId));
  statements.push(db.prepare(`UPDATE orders SET status = 'canceled', payment_status = 'canceled'
    WHERE id = ? AND payment_status = 'pending'`).bind(orderId));
  statements.push(db.prepare(`INSERT INTO payment_logs(order_id, event, payload)
    VALUES (?, 'max_chat_order_canceled', '{}')`).bind(orderId));
  const results = await db.batch(statements);
  return results[statements.length - 2].meta.changes === 1;
}

async function createCustomRequest(db, userId, state) {
  const publicToken = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const result = await db.batch([
    db.prepare(`INSERT INTO custom_requests(public_token, name, contact, item_type, details, deadline)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(publicToken, state.name, state.contact, state.itemType, state.details, state.deadline || ''),
    db.prepare(`INSERT INTO max_chat_custom_requests(request_id, user_id)
      SELECT last_insert_rowid(), ? WHERE changes() = 1`).bind(String(userId))
  ]);
  return result[0].meta.last_row_id;
}

async function notifyOwner(env, text, origin, options = {}) {
  const buyerToken = env.BUYER_BOT_TOKEN || env.MAX_BOT_TOKEN;
  if (!env.MAX_BOT_OWNER_ID) return;
  if (!buyerToken) {
    console.error('The customer bot token is missing; owner notification was not sent.');
    return;
  }
  await sendMessage(env, env.MAX_BOT_OWNER_ID, text, options, origin, buyerToken);
}

async function collectFlow(env, userId, text, origin, state) {
  const normalized = normalize(text);
  const send = (message, options = {}) => sendMessage(env, userId, message, options, origin);
  const askName = async () => {
    state.step = 'name';
    await saveState(env.DB, userId, state);
    await send('Как к вам обращаться? Введите имя.');
  };
  const summary = async () => {
    let total;
    try {
      total = await calculate(env.DB, state);
    } catch (error) {
      await saveState(env.DB, userId, null);
      await send(error.message, { buttons: keyboard() });
      return;
    }
    state.step = 'confirm';
    await saveState(env.DB, userId, state);
    await send([
      'Проверьте заказ:',
      `${total.product.name}${state.variant ? ` (${state.variant})` : ''} × ${state.quantity} — ${money(total.subtotal)}`,
      `Доставка: ${money(total.deliveryPrice)}`,
      `Итого: ${money(total.total)}`,
      `Получение: ${state.deliveryType === 'pickup' ? 'самовывоз' : state.address}`,
      `Покупатель: ${state.name}, ${state.phone}`
    ].join('\n'), {
      buttons: [[button('Подтвердить заказ', 'подтвердить заказ')], [button('Отмена', 'отмена')]]
    });
  };

  if (state.step === 'consent') {
    if (!/^(?:согласен, продолжить|продолжить оформление)$/.test(normalized)) {
      await send('Нажмите «Согласен, продолжить» для обработки данных, необходимых для заказа, или «Отмена».', {
        buttons: [[button('Согласен, продолжить', 'согласен, продолжить')], [button('Отмена', 'отмена')]]
      });
      return true;
    }
    if (state.kind === 'checkout') {
      state.step = 'quantity';
      await saveState(env.DB, userId, state);
      await send('Сколько штук оформить? Введите число от 1 до 20.');
    } else await askName();
    return true;
  }

  if (state.kind === 'checkout') {
    if (state.step === 'quantity') {
      const quantity = Number(normalized);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) {
        await send('Введите количество целым числом от 1 до 20.');
        return true;
      }
      state.quantity = quantity;
      const product = await env.DB.prepare('SELECT variants FROM products WHERE id = ?').bind(state.productId).first();
      const variants = JSON.parse(product?.variants || '[]');
      if (variants.length) {
        state.step = 'variant';
        await saveState(env.DB, userId, state);
        await send('Выберите вариант товара или нажмите «Без варианта».', {
          buttons: [...variants.map(value => [button(value, `вариант ${value}`)]), [button('Без варианта', 'без варианта')]]
        });
      } else await askName();
      return true;
    }
    if (state.step === 'variant') {
      const product = await env.DB.prepare('SELECT variants FROM products WHERE id = ?').bind(state.productId).first();
      const variants = JSON.parse(product?.variants || '[]');
      const selected = text.replace(/^вариант\s+/i, '').trim();
      if (normalized !== 'без варианта' && !variants.includes(selected)) {
        await send('Выберите вариант кнопкой ниже.', {
          buttons: [...variants.map(value => [button(value, `вариант ${value}`)]), [button('Без варианта', 'без варианта')]]
        });
        return true;
      }
      state.variant = normalized === 'без варианта' ? '' : selected;
      await askName();
      return true;
    }
    if (state.step === 'name') {
      if (text.length < 2 || text.length > 100) {
        await send('Введите имя длиной от 2 до 100 символов.');
        return true;
      }
      state.name = text;
      state.step = 'phone';
      await saveState(env.DB, userId, state);
      await send('Укажите российский номер телефона для связи.');
      return true;
    }
    if (state.step === 'phone') {
      state.phone = phoneNumber(text);
      if (!state.phone) {
        await send('Не распознал российский номер. Введите номер из 10 или 11 цифр.');
        return true;
      }
      state.step = 'delivery';
      await saveState(env.DB, userId, state);
      await send('Как получить заказ?', {
        buttons: [[button('Доставка', 'доставка заказа')], [button('Самовывоз', 'самовывоз заказа')]]
      });
      return true;
    }
    if (state.step === 'delivery') {
      if (normalized === 'самовывоз заказа' || normalized === 'самовывоз') {
        state.deliveryType = 'pickup';
        state.address = '';
        await summary();
      } else if (normalized === 'доставка заказа' || normalized === 'доставка') {
        state.deliveryType = 'delivery';
        state.step = 'address';
        await saveState(env.DB, userId, state);
        await send('Напишите полный адрес доставки.');
      } else {
        await send('Выберите «Доставка» или «Самовывоз».', {
          buttons: [[button('Доставка', 'доставка заказа')], [button('Самовывоз', 'самовывоз заказа')]]
        });
      }
      return true;
    }
    if (state.step === 'address') {
      if (text.length < 8 || text.length > 300) {
        await send('Укажите адрес длиной от 8 до 300 символов.');
        return true;
      }
      state.address = text;
      await summary();
      return true;
    }
    if (state.step === 'confirm') {
      if (normalized !== 'подтвердить заказ') {
        await send('Проверьте данные и нажмите «Подтвердить заказ» или отмените оформление.', {
          buttons: [[button('Подтвердить заказ', 'подтвердить заказ')], [button('Отмена', 'отмена')]]
        });
        return true;
      }
      try {
        const calculated = await calculate(env.DB, state);
        const order = await persistOrder(env.DB, userId, state, calculated);
        await saveState(env.DB, userId, null);
        const phone = env.SBP_PHONE || '';
        const bank = env.SBP_BANK || '';
        const receiver = env.SBP_RECEIVER_NAME || '';
        const message = phone && bank && receiver
          ? [
            `Заказ №${order.id} принят.`,
            `Переведите ровно ${moneyKopecks(order.pay_amount_unique)} через СБП по номеру ${phone} в ${bank}.`,
            `Получатель: ${receiver}. В комментарии укажите заказ №${order.id}.`,
            'Не отправляйте данные карты или коды. После перевода нажмите «Мои заказы».'
          ].join('\n')
          : `Заказ №${order.id} принят, но магазин ещё не настроил реквизиты СБП. Позвоните ${await setting(env.DB, 'owner_phone_display', '+7 (901) 826-77-81')}. Переводите только после подтверждения магазина.`;
        await send(message, { buttons: keyboard() });
        const fullOrder = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order.id).first();
        await notifyOwner(env, orderNotification(fullOrder, 'из MAX'), origin, {
          buttons: orderActionButtons(fullOrder)
        });
      } catch (error) {
        await saveState(env.DB, userId, null);
        await send(error.message, { buttons: keyboard() });
      }
      return true;
    }
  }

  if (state.kind === 'custom') {
    if (state.step === 'name') {
      if (text.length < 2 || text.length > 100) {
        await send('Введите имя длиной от 2 до 100 символов.');
        return true;
      }
      state.name = text;
      state.step = 'contact';
      await saveState(env.DB, userId, state);
      await send('Укажите телефон или другой способ связи.');
      return true;
    }
    if (state.step === 'contact') {
      if (text.length < 5 || text.length > 150) {
        await send('Укажите контакт длиной от 5 до 150 символов.');
        return true;
      }
      state.contact = text;
      state.step = 'itemType';
      await saveState(env.DB, userId, state);
      await send('Какое изделие хотите заказать?');
      return true;
    }
    if (state.step === 'itemType') {
      if (text.length < 2 || text.length > 100) {
        await send('Опишите тип изделия (от 2 до 100 символов).');
        return true;
      }
      state.itemType = text;
      state.step = 'details';
      await saveState(env.DB, userId, state);
      await send('Укажите размеры, ткань, цвет и пожелания к изделию.');
      return true;
    }
    if (state.step === 'details') {
      if (text.length < 10 || text.length > 2000) {
        await send('Добавьте подробности: от 10 до 2000 символов.');
        return true;
      }
      state.details = text;
      state.step = 'deadline';
      await saveState(env.DB, userId, state);
      await send('К какому сроку нужно изделие? Напишите срок или нажмите «Без срока».', {
        buttons: [[button('Без срока', 'без срока')]]
      });
      return true;
    }
    if (state.step === 'deadline') {
      state.deadline = normalized === 'без срока' ? '' : text.slice(0, 100);
      const requestId = await createCustomRequest(env.DB, userId, state);
      await saveState(env.DB, userId, null);
      await send(`Заявка на пошив №${requestId} принята. Магазин свяжется с вами, чтобы согласовать стоимость и срок.`, {
        buttons: keyboard(), imagePaths: ['/img/custom-sewing.jpg']
      });
      await notifyOwner(env, [
        `Новая заявка на пошив №${requestId}`,
        `Имя: ${state.name}`,
        `Контакт: ${state.contact}`,
        `Изделие: ${state.itemType}`,
        `Описание: ${state.details}`,
        `Срок: ${state.deadline || 'не указан'}`
      ].join('\n'), origin);
      return true;
    }
  }
  return false;
}

async function reply(env, update, origin) {
  const userId = update.message?.sender?.user_id ?? update.user?.user_id;
  if (!/^\d+$/.test(String(userId || ''))) return;
  const buttons = keyboard();
  const owner = env.MAX_BOT_OWNER_ID && String(userId) === String(env.MAX_BOT_OWNER_ID);
  if (update.update_type === 'bot_started') {
    await sendMessage(env, userId,
      owner ? sellerWelcome() : `Хелпи — служба поддержки Family Soft 🎧💛\nПомогу выбрать товар, оформить заказ и оплатить через СБП. Всё можно сделать прямо в этом чате.\nНажмите кнопку ниже, напишите «каталог» или найдите товар командой «найти плед».\nСайт Family Soft: ${SITE_URL}`,
      { buttons: owner ? sellerKeyboard() : buttons }, origin);
    return;
  }
  if (update.update_type !== 'message_created') return;
  const text = String(update.message?.body?.text || '').trim().slice(0, 2000);
  if (!text) return;
  const normalized = normalize(text);
  const send = (message, options = {}) => sendMessage(env, userId, message, options, origin);

  if (/^(?:\/?мой id|\/?мой айди)$/i.test(normalized)) {
    await send(`Ваш MAX ID: ${userId}.`);
    return;
  }
  if (/^\/?(?:start|help)(?:@\w+)?$/i.test(text)) {
    await saveState(env.DB, userId, null);
    await send(owner ? sellerWelcome() : `Хелпи — служба поддержки Family Soft 🎧💛\nПомогу выбрать товар, оформить заказ и оплатить через СБП. Всё можно сделать прямо в этом чате.\nНажмите кнопку ниже, напишите «каталог» или найдите товар командой «найти плед».\nСайт Family Soft: ${SITE_URL}`, {
      buttons: owner ? sellerKeyboard() : buttons
    });
    return;
  }
  if (/^(?:отмена|\/cancel)$/i.test(normalized)) {
    await saveState(env.DB, userId, null);
    await send('Оформление отменено. Вы можете начать снова из каталога.', { buttons });
    return;
  }

  const buyerCancel = normalized.match(/^\/?отмена заказа\s+(\d+)$/);
  if (buyerCancel) {
    const orderId = Number(buyerCancel[1]);
    const canceled = await cancelOrder(env.DB, orderId, userId);
    await send(canceled
      ? `Заказ №${orderId} отменён, товар снова доступен в каталоге.`
      : 'Не нашёл ожидающий оплаты заказ с таким номером.', { buttons });
    if (canceled) await notifyOwner(env, `Покупатель отменил заказ №${orderId}.`, origin);
    return;
  }

  if (owner) {
    if (/^(?:\/?панель|\/?меню)$/i.test(normalized)) {
      await send(sellerWelcome(), { buttons: sellerKeyboard() });
      return;
    }
    if (/^\/?помощь продавцу$/i.test(normalized)) {
      await send([
        'Помощник продавца Fami',
        '🔔 «Новые заказы» — ждут оплаты или согласования оплаты с покупателем.',
        '📦 «Активные заказы» — все заказы, которые ещё не завершены.',
        'Откройте заказ кнопкой, чтобы посмотреть покупателя, товары, доставку и оплату.',
        'При оплате по согласованию свяжитесь с покупателем. Подтвердите оплату только после её фактического получения, затем отмечайте сборку, готовность или отправку.',
        'Для возврата в меню нажмите «Панель продавца».'
      ].join('\n'), {
        buttons: [...sellerKeyboard(), [button('Панель продавца', '/панель')]]
      });
      return;
    }
    const paid = normalized.match(/^\/?оплачен\s+(\d+)$/);
    if (paid) {
      const orderId = Number(paid[1]);
      const result = await env.DB.batch([
        env.DB.prepare(`UPDATE orders SET payment_status = 'paid',
          status = CASE WHEN status = 'on_hold' THEN status ELSE 'new' END,
          paid_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status = 'pending'
            AND payment_method IN ('manual', 'seller_contact')`)
          .bind(orderId),
        env.DB.prepare(`INSERT INTO payment_logs(order_id, event, payload)
          SELECT id, CASE WHEN payment_method = 'seller_contact'
            THEN 'max_owner_seller_contact_payment_confirmation'
            ELSE 'max_owner_manual_confirmation' END, '{}'
          FROM orders WHERE id = ? AND payment_status = 'paid'`)
          .bind(orderId)
      ]);
      if (!result[0].meta.changes) {
        await send('Не нашёл ожидающий оплаты заказ с таким номером.');
        return;
      }
      const buyer = await env.DB.prepare('SELECT user_id FROM max_chat_orders WHERE order_id = ?').bind(orderId).first();
      if (buyer) await sendMessage(env, buyer.user_id, `Оплата заказа №${orderId} подтверждена. Спасибо!`, {}, origin);
      const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
      await send(`Заказ №${orderId} отмечен оплаченным. Подтверждайте только после фактического получения оплаты согласованным способом.`, {
        buttons: orderActionButtons(order)
      });
      return;
    }
    const statusCommand = normalized.match(/^\/?(собирается|готов к выдаче|отправлен|завершен)\s+(\d+)$/);
    if (statusCommand) {
      const orderId = Number(statusCommand[2]);
      const transitions = {
        собирается: { status: 'in_progress', condition: "status = 'new' AND payment_status = 'paid'" },
        'готов к выдаче': { status: 'ready', condition: "status = 'in_progress' AND payment_status = 'paid' AND delivery_type = 'pickup'" },
        отправлен: { status: 'shipped', condition: "status = 'in_progress' AND payment_status = 'paid' AND delivery_type = 'delivery'" },
        завершен: { status: 'done', condition: "status IN ('ready', 'shipped') AND payment_status = 'paid'" }
      };
      const transition = transitions[statusCommand[1]];
      const updated = await env.DB.prepare(`UPDATE orders SET status = ?
        WHERE id = ? AND ${transition.condition}`).bind(transition.status, orderId).run();
      if (!updated.meta.changes) {
        await send(`Не удалось изменить заказ №${orderId}: проверьте оплату, способ получения и текущий статус.`);
        return;
      }
      await env.DB.prepare(`INSERT INTO payment_logs(order_id, event, payload)
        VALUES (?, 'max_owner_order_status', ?)`)
        .bind(orderId, JSON.stringify({ status: transition.status })).run();
      const buyer = await env.DB.prepare('SELECT user_id FROM max_chat_orders WHERE order_id = ?').bind(orderId).first();
      if (buyer) await sendMessage(env, buyer.user_id, orderStatusMessage(orderId, transition.status), {}, origin);
      const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
      const nextButtons = orderActionButtons(order);
      await send(`Статус заказа №${orderId}: ${transition.status}.`,
        nextButtons.length ? { buttons: nextButtons } : {});
      return;
    }
    if (/^\/?(?:новые заказы|ожидают оплаты)$/i.test(normalized)) {
      const rows = await env.DB.prepare(`SELECT o.id, o.customer_name, o.phone, o.pay_amount_unique,
        o.payment_status, o.payment_method, o.status, o.delivery_type,
        CASE WHEN c.order_id IS NULL THEN 'сайт' ELSE 'MAX' END AS source
        FROM orders o LEFT JOIN max_chat_orders c ON c.order_id = o.id
        WHERE o.payment_status = 'pending' AND o.status NOT IN ('canceled', 'done')
        ORDER BY o.id DESC LIMIT 5`).all();
      const orderButtons = rows.results.map(order =>
        [button(`Заказ №${order.id} · ${order.customer_name}`, `/заказ ${order.id}`)]
      );
      await send(rows.results.length
        ? rows.results.map(order => `№${order.id} (${order.source}) — ${order.customer_name}, ${order.phone}; ${order.payment_method === 'seller_contact' ? 'оплата по согласованию с продавцом' : `ожидает оплаты ${moneyKopecks(order.pay_amount_unique)}`}`).join('\n')
        : 'Новых заказов, ожидающих оплаты, нет.', {
        buttons: [...orderButtons, ...sellerKeyboard()]
      });
      return;
    }
    if (/^\/?(?:заказы|активные заказы)$/i.test(normalized)) {
      const rows = await env.DB.prepare(`SELECT o.id, o.customer_name, o.phone, o.pay_amount_unique,
        o.payment_status, o.payment_method, o.status, o.delivery_type,
        CASE WHEN c.order_id IS NULL THEN 'сайт' ELSE 'MAX' END AS source
        FROM orders o LEFT JOIN max_chat_orders c ON c.order_id = o.id
        WHERE o.status NOT IN ('done', 'canceled') AND o.payment_status NOT IN ('canceled', 'refunded')
        ORDER BY o.id DESC LIMIT 5`).all();
      const orderButtons = rows.results.map(order =>
        [button(`Заказ №${order.id} · ${order.customer_name}`, `/заказ ${order.id}`)]
      );
      await send(rows.results.length
        ? rows.results.map(order => `№${order.id} (${order.source}) — ${order.customer_name}, ${order.phone}; ${order.payment_status === 'pending' ? `${order.payment_method === 'seller_contact' ? 'оплата по согласованию с продавцом' : `ожидает оплату ${moneyKopecks(order.pay_amount_unique)}`} — /оплачен ${order.id}` : `оплачено, статус: ${order.status}`} — /заказ ${order.id}`).join('\n')
        : 'Активных заказов нет.', {
        buttons: [...orderButtons, ...sellerKeyboard()]
      });
      return;
    }
    const orderDetailsMatch = normalized.match(/^\/?заказ\s+(\d+)$/);
    if (orderDetailsMatch) {
      const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(Number(orderDetailsMatch[1])).first();
      if (!order) {
        await send('Не нашёл заказ с таким номером.');
        return;
      }
      const actions = orderActionButtons(order);
      await send(orderNotification(order, 'подробности'), actions.length ? { buttons: actions } : {});
      return;
    }
    const cancel = normalized.match(/^\/?отменить заказ\s+(\d+)$/);
    if (cancel) {
      const orderId = Number(cancel[1]);
      const canceled = await cancelOrder(env.DB, orderId);
      await send(canceled ? `Заказ №${orderId} отменён, товар возвращён в остатки.` : 'Не нашёл неоплаченный заказ с таким номером.');
      if (canceled) {
        const buyer = await env.DB.prepare('SELECT user_id FROM max_chat_orders WHERE order_id = ?').bind(orderId).first();
        if (buyer) await sendMessage(env, buyer.user_id, `Магазин отменил заказ №${orderId}.`, {}, origin);
      }
      return;
    }
    if (/^\/?заявки$/i.test(normalized)) {
      const rows = await env.DB.prepare(`SELECT r.id, r.name, r.contact, r.item_type, r.details,
        CASE WHEN c.request_id IS NULL THEN 'сайт' ELSE 'MAX' END AS source
        FROM custom_requests r LEFT JOIN max_chat_custom_requests c ON c.request_id = r.id
        WHERE r.status = 'new' ORDER BY r.id DESC LIMIT 10`).all();
      await send(rows.results.length
        ? rows.results.map(row => `Заявка №${row.id} (${row.source}): ${row.name}, ${row.contact}; ${row.item_type}. ${row.details}`).join('\n\n')
        : 'Новых заявок на пошив нет.', { buttons: sellerKeyboard() });
      return;
    }
    if (/^\/?сообщения$/i.test(normalized)) {
      const rows = await env.DB.prepare(`SELECT id, name, contact, message FROM contact_messages
        WHERE status = 'new' ORDER BY id DESC LIMIT 10`).all();
      await send(rows.results.length
        ? rows.results.map(row => `Сообщение №${row.id}: ${row.name}, ${row.contact}. ${row.message}`).join('\n\n')
        : 'Новых сообщений с сайта нет.', { buttons: sellerKeyboard() });
      return;
    }
  }

  if (/^(?:мои заказы|мои покупки|статус заказа)$/i.test(normalized)) {
    await send(await orderStatus(env.DB, userId), { buttons });
    return;
  }
  const state = await getState(env.DB, userId);
  if (state && await collectFlow(env, userId, text, origin, state)) return;

  if (/^(?:найти товар|поиск товара)$/i.test(normalized)) {
    await searchCatalog(env, userId, '', origin);
    return;
  }
  const search = normalized.match(/^\/?(?:найти|поиск)\s+(.+)$/);
  if (search) {
    await searchCatalog(env, userId, search[1], origin);
    return;
  }

  const purchase = normalized.match(/^оплатить товар\s+(\d+)$/);
  if (purchase) {
    if (!env.MAX_BOT_OWNER_ID || !env.SBP_PHONE || !env.SBP_BANK || !env.SBP_RECEIVER_NAME) {
      await send('Оформление заказа пока не настроено. Магазину нужно задать MAX ID владельца и реквизиты СБП. Позвоните: ' + await setting(env.DB, 'owner_phone_display', '+7 (901) 826-77-81'), { buttons });
      return;
    }
    const product = await env.DB.prepare('SELECT id, name, in_stock, stock_qty FROM products WHERE id = ?')
      .bind(Number(purchase[1])).first();
    if (!product || !product.in_stock || product.stock_qty < 1) {
      await send('Товар не найден или закончился. Напишите «каталог», чтобы выбрать другой.', { buttons });
      return;
    }
    await saveState(env.DB, userId, { kind: 'checkout', step: 'consent', productId: product.id });
    await send(`Заказ «${product.name}» можно оформить здесь, в чате. Для этого бот сохранит имя, телефон и данные доставки. Нажмите «Согласен, продолжить», чтобы начать.`, {
      buttons: [[button('Согласен, продолжить', 'согласен, продолжить')], [button('Отмена', 'отмена')]]
    });
    return;
  }

  if (/^(?:сшить на заказ|пошив на заказ|индивидуальный заказ|работа на заказ)$/i.test(normalized)) {
    if (!env.MAX_BOT_OWNER_ID) {
      await send('Приём заявок пока не настроен. Укажите MAX ID владельца бота в настройках.');
      return;
    }
    await saveState(env.DB, userId, { kind: 'custom', step: 'consent' });
    await send('Заявку на пошив можно оформить прямо здесь. Бот попросит имя, контакт и описание изделия. Нажмите «Согласен, продолжить».', {
      buttons: [[button('Согласен, продолжить', 'согласен, продолжить')], [button('Отмена', 'отмена')]],
      imagePaths: ['/img/custom-sewing.jpg']
    });
    return;
  }

  const page = normalized.match(/^(?:каталог|товары)(?:\s+(\d+))?$|^(?:следующая|первая) страница\s+\((\d+)\/\d+\)$/);
  if (page) {
    await catalog(env, userId, Number(page[1] || page[2] || 1), origin);
    return;
  }
  const product = normalized.match(/^(?:товар|карточка)\s+(\d+)$/);
  if (product) {
    await productCard(env, userId, Number(product[1]), origin);
    return;
  }
  if (/^(?:вопросы|faq|частые вопросы)$/i.test(normalized)) {
    const rows = await env.DB.prepare(`SELECT question, answer FROM faq_items
      WHERE published = 1 ORDER BY sort_order, id`).all();
    await send(rows.results.length
      ? rows.results.map(row => `${row.question}\n${row.answer}`).join('\n\n').slice(0, 3500)
      : 'Пока частых вопросов нет.', { buttons });
    return;
  }
  if (/^(?:оплата|как оплатить|оплатить заказ|сбп)$/i.test(normalized)) {
    await send('После подтверждения заказа бот покажет точную сумму и реквизиты перевода через СБП. Магазин подтвердит оплату после проверки поступления. Не отправляйте данные карты или коды.', { buttons });
    return;
  }
  if (/^(?:доставка|доставка и оплата|сколько стоит доставка|самовывоз)$/i.test(normalized)) {
    await send(`Доставка стоит ${money(Number(await setting(env.DB, 'delivery_price', '450')))}; при заказе от ${money(Number(await setting(env.DB, 'free_delivery_threshold', '10000')))} бесплатно. Самовывоз бесплатный. ${await setting(env.DB, 'pickup_address', 'Адрес самовывоза уточняется после оформления заказа.')}`, { buttons });
    return;
  }
  if (/^(?:контакты|телефон|связаться)$/i.test(normalized)) {
    await send(`Связаться с магазином: ${await setting(env.DB, 'owner_phone_display', '+7 (901) 826-77-81')}`, { buttons });
    return;
  }
  await send('Я помогу с заказом. Попробуйте кнопки ниже или напишите «найти плед», «каталог», «доставка», «оплата», «мои заказы».', { buttons });
}

async function handleUpdate(env, update, origin) {
  try {
    await reply(env, update, origin);
    return 'done';
  } catch (error) {
    console.error('MAX webhook update failed:', error.message);
    return 'failed';
  }
}

async function claimEvent(db, key) {
  const result = await db.prepare(`INSERT INTO webhook_events(event_key, status, updated_at)
    VALUES(?, 'processing', CURRENT_TIMESTAMP)
    ON CONFLICT(event_key) DO UPDATE SET status = 'processing', updated_at = CURRENT_TIMESTAMP
    WHERE webhook_events.status = 'failed'
      OR webhook_events.updated_at < datetime('now', '-5 minutes')`)
    .bind(key).run();
  return result.meta.changes === 1;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/healthz' && request.method === 'GET') {
      return Response.json({ status: 'ok' });
    }
    if (url.pathname === '/webhook') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      const buyerToken = env.BUYER_BOT_TOKEN || env.MAX_BOT_TOKEN;
      if (!buyerToken) {
        return new Response('Bot is not configured', { status: 503 });
      }
      const webhookSecret = request.headers.get('X-Max-Bot-Api-Secret') || '';
      if (env.BUYER_BOT_TOKEN) {
        if (env.MAX_WEBHOOK_SECRET && safeEqual(webhookSecret, env.MAX_WEBHOOK_SECRET)) {
          return new Response('OK', { status: 200 });
        }
        if (!env.BUYER_WEBHOOK_SECRET) {
          return new Response('Buyer bot webhook is not configured', { status: 503 });
        }
        if (!safeEqual(webhookSecret, env.BUYER_WEBHOOK_SECRET)) {
          return new Response('Unauthorized', { status: 401 });
        }
      } else if (!env.MAX_WEBHOOK_SECRET || !safeEqual(webhookSecret, env.MAX_WEBHOOK_SECRET)) {
        return new Response('Unauthorized', { status: 401 });
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response('Invalid JSON', { status: 400 });
      }
      if (!body || typeof body !== 'object' || !body.update_type) {
        return new Response('Invalid update', { status: 400 });
      }
      const key = await eventKey(body);
      try {
        if (await claimEvent(env.DB, key)) {
          ctx.waitUntil((async () => {
            const status = await handleUpdate(env, body, url.origin);
            await env.DB.prepare('UPDATE webhook_events SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE event_key = ?')
              .bind(status, key).run();
          })());
        }
      } catch (error) {
        console.error('Could not queue MAX webhook update:', error.message);
        return new Response('Temporary error', { status: 503 });
      }
      return new Response('OK', { status: 200 });
    }
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleSiteApi(request, env, url) || json({ error: 'Страница или API-метод не найдены.' }, 404);
      } catch (error) {
        console.error('Storefront API request failed:', error.message);
        return json({ error: 'Не удалось обработать запрос. Попробуйте позже.' }, 500);
      }
    }
    if (!env.ASSETS || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404 || /\.[a-z0-9]+$/i.test(url.pathname)) return asset;
    return env.ASSETS.fetch(new Request(new URL('/index.html', url), {
      method: request.method,
      headers: request.headers
    }));
  }
};
