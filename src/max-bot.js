import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const API_URL = 'https://platform-api2.max.ru';
const LEGACY_API_URL = 'https://platform-api.max.ru';
const POLL_TIMEOUT_SECONDS = 30;
const PAGE_SIZE = 8;
const MAX_IMAGES_PER_MESSAGE = 12;
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE_URL = 'https://family-soft-max-bot.a28526710.workers.dev';

function messageButton(text, payload) {
  return { type: 'message', text, payload };
}

function siteButton() {
  return { type: 'link', text: '🌐 Сайт Family Soft', url: SITE_URL };
}

function menuKeyboard() {
  return [
    [messageButton('Каталог', 'каталог'), messageButton('Вопросы', 'вопросы')],
    [messageButton('Найти товар', 'найти товар')],
    [messageButton('Доставка', 'доставка'), messageButton('Оплата', 'оплата')],
    [messageButton('Сшить на заказ', 'сшить на заказ')],
    [messageButton('Мои заказы', 'мои заказы'), messageButton('Контакты', 'контакты')],
    [siteButton()]
  ];
}

function sellerKeyboard() {
  return [
    [messageButton('🔔 Новые заказы', '/новые заказы')],
    [messageButton('📦 Активные заказы', '/активные заказы')],
    [messageButton('🧵 Заявки', '/заявки'), messageButton('✉️ Сообщения', '/сообщения')],
    [messageButton('ℹ️ Помощь', '/помощь продавцу')],
    [messageButton('🏠 Панель продавца', '/панель')],
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

function catalogKeyboard(products, page) {
  const pages = Math.ceil(products.length / PAGE_SIZE);
  const start = (Math.min(Math.max(1, page), pages) - 1) * PAGE_SIZE;
  const buttons = products.slice(start, start + PAGE_SIZE).map(product =>
    [messageButton(`Товар ${product.id}`, `товар ${product.id}`)]
  );
  if (pages > 1) {
    const nextPage = page < pages ? page + 1 : 1;
    const label = page < pages
      ? `Следующая страница (${nextPage}/${pages})`
      : `Первая страница (1/${pages})`;
    buttons.push([messageButton(label, `каталог ${nextPage}`)]);
  }
  buttons.push(...menuKeyboard());
  return buttons;
}

function productKeyboard(productId) {
  return [[messageButton('Оформить заказ', `оплатить товар ${productId}`)], ...menuKeyboard()];
}

export function formatProductList(products, page, pageSize = 8) {
  if (products.length === 0) return 'Пока в каталоге нет товаров.';

  const pages = Math.ceil(products.length / pageSize);
  const currentPage = Math.min(Math.max(1, page), pages);
  const start = (currentPage - 1) * pageSize;
  const lines = products.slice(start, start + pageSize).map(product =>
    `Товар ${product.id} — ${product.name} — ${new Intl.NumberFormat('ru-RU').format(product.price)} ₽${product.in_stock && product.stock_qty > 0 ? ` (в наличии: ${product.stock_qty} шт.)` : ' (нет в наличии)'}`
  );

  return [
    `Каталог (${currentPage}/${pages})`,
    '',
    ...lines,
    '',
    'Нажмите кнопку нужного товара, чтобы увидеть описание и фотографии.',
    ...(pages > 1 ? ['Вернуться к началу каталога: каталог 1'] : [])
  ].join('\n');
}

function parsePage(text) {
  const match = text.match(/^(?:каталог|товары)(?:\s+(\d+))?$|^(?:следующая|первая) страница\s+\((\d+)\/\d+\)$/i);
  return match ? Math.max(1, Number(match[1] || match[2] || 1)) : null;
}

function parseProductId(text) {
  const match = text.match(/^(?:товар|карточка)\s+(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function money(value) {
  return `${new Intl.NumberFormat('ru-RU').format(value)} ₽`;
}

function productDetails(product) {
  let variants = [];
  try {
    const parsed = JSON.parse(product.variants || '[]');
    if (Array.isArray(parsed)) variants = parsed.filter(item => typeof item === 'string');
  } catch (error) {
    console.warn('MAX bot: could not read product variants:', error.message);
  }

  return [
    product.name,
    `Цена: ${money(product.price)}`,
    product.in_stock && product.stock_qty > 0 ? `В наличии: ${product.stock_qty} шт.` : 'Сейчас нет в наличии',
    product.description,
    `Материал: ${product.material}`,
    `Размеры: ${product.dimensions}`,
    `Уход: ${product.care}`,
    ...(variants.length ? [`Варианты: ${variants.join(', ')}`] : [])
  ].join('\n');
}

function helpText() {
  return [
    'Хелпи — служба поддержки Family Soft 🎧💛',
    'Помогу выбрать товар, оформить заказ и узнать, как оплатить через СБП. Всё можно сделать прямо в этом чате.',
    `Выберите кнопку ниже, напишите «каталог» или найдите товар командой «найти плед». Для заказа пошива нажмите «Сшить на заказ».\nСайт Family Soft: ${SITE_URL}`
  ].join('\n');
}

function settingValue(db, key, fallback = '') {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? fallback;
}

function normalizedText(text) {
  return text.toLowerCase().replace(/ё/g, 'е');
}

function searchTerms(query) {
  return normalizedText(query).match(/[\p{L}\p{N}]+/gu)?.filter(term => term.length > 1).slice(0, 6) || [];
}

function findProducts(products, query) {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  return products.filter(product => {
    const details = normalizedText([
      product.name, product.description, product.material, product.dimensions, product.care, product.variants
    ].join(' '));
    return terms.every(term => details.includes(term));
  }).slice(0, 8);
}

function formatProductSearch(products, query) {
  if (!searchTerms(query).length) return 'Напишите, что ищете, например: «найти плед» или «найти детский хлопок».';
  const matches = findProducts(products, query);
  if (!matches.length) return `По запросу «${query}» ничего не нашёл. Попробуйте другое слово или откройте каталог.`;
  return [
    `Нашёл по запросу «${query}»:`,
    '',
    ...matches.map(product =>
      `Товар ${product.id} — ${product.name} — ${money(product.price)}${product.in_stock && product.stock_qty > 0 ? '' : ' (нет в наличии)'}`
    ),
    '',
    'Нажмите товар, чтобы посмотреть фото и описание.'
  ].join('\n');
}

function deliveryAnswer(db) {
  const price = Number(settingValue(db, 'delivery_price', '450'));
  const threshold = Number(settingValue(db, 'free_delivery_threshold', '10000'));
  const pickup = settingValue(db, 'pickup_address', 'Адрес самовывоза уточняется после оформления заказа.');
  const lines = [
    `Доставка курьером стоит ${money(price)}; при сумме товаров от ${money(threshold)} она бесплатна. Точная стоимость рассчитывается при оформлении с учётом скидки.`,
    `Самовывоз бесплатный. ${pickup}`
  ];
  return lines.join('\n');
}

function findFaqAnswer(db, text) {
  const input = normalizedText(text);
  const topics = [
    { pattern: /(возврат|вернуть|обмен)/, terms: ['вернуть', 'возврат'] },
    { pattern: /(уход|стирать|стирка|гладить)/, terms: ['уход', 'текстилем'] },
    { pattern: /(материал|состав|ткань)/, terms: ['материал', 'изделия'] },
    { pattern: /(пошив|индивидуальн|свои размеры|своим размерам)/, terms: ['заказать изделие', 'размерам'] },
    { pattern: /\b(оформить заказ|как заказать)\b/, terms: ['оформить заказ'] }
  ];
  const topic = topics.find(item => item.pattern.test(input));
  if (!topic) return '';

  const items = db.prepare(`SELECT question, answer FROM faq_items
    WHERE published = 1 ORDER BY sort_order, id`).all();
  const match = items.find(item => {
    const question = normalizedText(item.question);
    return topic.terms.every(term => question.includes(normalizedText(term)));
  }) || items.find(item => topic.terms.some(term => normalizedText(item.question).includes(normalizedText(term))));
  return match ? `${match.answer}\n\nЕсли останутся вопросы, позвоните: ${settingValue(db, 'owner_phone_display', '+7 (901) 826-77-81')}.` : '';
}

function loadChatState(db, userId) {
  const raw = settingValue(db, `max_chat_state_${userId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn('MAX bot: could not read chat state:', error.message);
    return null;
  }
}

function storeChatState(db, userId, state) {
  db.prepare(`INSERT INTO settings(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(`max_chat_state_${userId}`, JSON.stringify(state));
}

function deleteChatState(db, userId) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(`max_chat_state_${userId}`);
}

function normalizeRussianPhone(text) {
  const digits = text.replace(/\D/g, '');
  if (digits.length === 10) return `+7${digits}`;
  if (digits.length === 11 && ['7', '8'].includes(digits[0])) return `+7${digits.slice(1)}`;
  return '';
}

function chatOrderTotals(db, state) {
  const product = db.prepare(`SELECT id, name, price, in_stock, stock_qty, variants
    FROM products WHERE id = ?`).get(state.productId);
  if (!product || !product.in_stock || product.stock_qty < state.quantity) {
    throw new Error('Товар закончился или нужного количества больше нет. Откройте каталог и выберите другой товар.');
  }
  const subtotal = product.price * state.quantity;
  const deliveryPrice = state.deliveryType === 'pickup'
    ? 0
    : subtotal >= Number(settingValue(db, 'free_delivery_threshold', '10000'))
      ? 0
      : Number(settingValue(db, 'delivery_price', '450'));
  return { product, subtotal, deliveryPrice, total: subtotal + deliveryPrice };
}

function uniqueChatPayAmount(db, amountKopecks) {
  const used = new Set(db.prepare(`SELECT pay_amount_unique FROM orders
    WHERE payment_status = 'pending' AND payment_method = 'manual'
      AND created_at > datetime('now', '-24 hours')`).all().map(row => row.pay_amount_unique));
  for (let extra = 1; extra < 100; extra += 1) {
    if (!used.has(amountKopecks + extra)) return amountKopecks + extra;
  }
  throw new Error('Не удалось подготовить уникальную сумму перевода. Попробуйте позже.');
}

function createChatOrder(db, userId, state) {
  const { product, subtotal, deliveryPrice, total } = chatOrderTotals(db, state);
  const payAmount = uniqueChatPayAmount(db, total * 100);
  const publicToken = crypto.randomBytes(32).toString('hex');
  const item = {
    productId: product.id,
    name: product.name,
    variant: state.variant || '',
    quantity: state.quantity,
    unitPrice: product.price,
    lineTotal: subtotal
  };
  return db.transaction(() => {
    const reserved = db.prepare(`UPDATE products SET stock_qty = stock_qty - ?,
      in_stock = CASE WHEN stock_qty - ? > 0 THEN 1 ELSE 0 END
      WHERE id = ? AND in_stock = 1 AND stock_qty >= ?`)
      .run(state.quantity, state.quantity, product.id, state.quantity);
    if (reserved.changes !== 1) throw new Error('Товар только что закончился. Откройте каталог и попробуйте ещё раз.');
    const inserted = db.prepare(`INSERT INTO orders
      (public_token, customer_name, phone, email, delivery_type, address, items, subtotal,
       delivery_price, total, pay_amount_unique, status, payment_status, payment_method, idempotence_key)
      VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, 'new', 'pending', 'manual', ?)`)
      .run(publicToken, state.name, state.phone, state.deliveryType,
        state.address || settingValue(db, 'pickup_address', 'Самовывоз'), JSON.stringify([item]),
        subtotal, deliveryPrice, total, payAmount, `max-${crypto.randomUUID()}`);
    const orderId = Number(inserted.lastInsertRowid);
    db.prepare('INSERT INTO max_chat_orders(order_id, user_id) VALUES(?, ?)')
      .run(orderId, String(userId));
    db.prepare(`INSERT INTO payment_logs(order_id, event, payload)
      VALUES (?, 'max_chat_order_created', ?)`).run(orderId, JSON.stringify({ user_id: String(userId) }));
    return {
      id: orderId,
      customer_name: state.name,
      phone: state.phone,
      delivery_type: state.deliveryType,
      address: state.address || settingValue(db, 'pickup_address', 'Самовывоз'),
      items: [item],
      total,
      pay_amount_unique: payAmount
    };
  })();
}

function moneyKopecks(value) {
  return `${new Intl.NumberFormat('ru-RU').format(Math.floor(value / 100))},${String(value % 100).padStart(2, '0')} ₽`;
}

function orderActionButtons(order) {
  const id = order.id;
  let actions = [];
  if (order.payment_status === 'pending') {
    actions = [
      [messageButton('Отметить оплату', `/оплачен ${id}`)],
      [messageButton('Отменить заказ', `/отменить заказ ${id}`)]
    ];
  } else if (order.payment_status === 'paid' && order.status === 'new') {
    actions = [[messageButton('Начать сборку', `/собирается ${id}`)]];
  } else if (order.payment_status === 'paid' && order.status === 'in_progress') {
    actions = order.delivery_type === 'pickup'
      ? [[messageButton('Готов к выдаче', `/готов к выдаче ${id}`)]]
      : [[messageButton('Отправлен', `/отправлен ${id}`)]];
  } else if (order.payment_status === 'paid' && ['ready', 'shipped'].includes(order.status)) {
    actions = [[messageButton('Завершить заказ', `/завершён ${id}`)]];
  }
  return [...actions, ...sellerKeyboard()];
}

function orderNotification(order, source) {
  const giftWrapPrice = Number(order.total) - Number(order.subtotal)
    + Number(order.discount || 0) - Number(order.delivery_price);
  let items = [];
  try {
    const parsed = JSON.parse(order.items || '[]');
    if (Array.isArray(parsed)) items = parsed;
  } catch (error) {
    console.warn('MAX bot: could not read order items:', error.message);
  }
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
    ...(items.length ? items.map(item =>
      `• ${item.name}${item.variant ? ` (${item.variant})` : ''} × ${item.quantity} — ${money(item.lineTotal ?? item.unitPrice * item.quantity)}`
    ) : ['• Состав не указан']),
    `Товары: ${money(order.subtotal)}`,
    ...(order.discount ? [`Скидка: −${money(order.discount)}`] : []),
    ...(order.gift_wrap ? [`Подарочная упаковка: ${money(giftWrapPrice)}`] : []),
    `Доставка: ${money(order.delivery_price)}`,
    `Итого: ${money(order.total)}`,
    `Оплата: ${order.payment_method === 'manual' ? 'перевод через СБП' : order.payment_method}; ${paymentStatus}`,
    `Сумма перевода: ${moneyKopecks(order.pay_amount_unique)}`,
    ...(order.promo_code ? [`Промокод: ${order.promo_code}`] : []),
    ...(order.comment ? [`Комментарий: ${order.comment}`] : []),
    order.payment_status === 'pending' ? 'Проверьте поступление в банковском приложении перед подтверждением оплаты.' : ''
  ].filter(Boolean).join('\n');
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

function chatOrderStatus(order) {
  const payment = { pending: 'ожидается', paid: 'оплачено', canceled: 'отменено', refunded: 'возврат оформлен' };
  const status = {
    new: order.payment_status === 'paid' ? 'оплачен, ожидает сборки' : 'принят',
    on_hold: 'проверяется',
    in_progress: 'собирается',
    ready: 'готов к выдаче',
    shipped: 'отправлен',
    done: 'завершён',
    canceled: 'отменён'
  };
  return `Заказ №${order.id}: ${status[order.status] || order.status}; оплата — ${payment[order.payment_status] || order.payment_status}.${order.payment_status === 'pending' ? ` Для отмены: /отмена заказа ${order.id}.` : ''}`;
}

function cancelChatOrder(db, orderId) {
  const order = db.prepare(`SELECT o.* FROM orders o JOIN max_chat_orders c ON c.order_id = o.id
    WHERE o.id = ? AND o.payment_method = 'manual' AND o.payment_status = 'pending'`).get(orderId);
  if (!order) return false;
  return db.transaction(() => {
    for (const item of JSON.parse(order.items)) {
      db.prepare('UPDATE products SET stock_qty = stock_qty + ?, in_stock = 1 WHERE id = ?')
        .run(item.quantity, item.productId);
    }
    const result = db.prepare(`UPDATE orders SET status = 'canceled', payment_status = 'canceled'
      WHERE id = ? AND payment_status = 'pending'`).run(orderId);
    if (result.changes !== 1) return false;
    db.prepare(`INSERT INTO payment_logs(order_id, event, payload)
      VALUES (?, 'max_chat_order_canceled', '{}')`).run(orderId);
    return true;
  })();
}

async function processChatState(text, normalized, userId, {
  db, sendMessage, buttons, ownerUserId, sbpPhone, sbpBank, sbpReceiverName
}, state) {
  const askName = async () => {
    state.step = 'name';
    storeChatState(db, userId, state);
    await sendMessage(userId, 'Как к вам обращаться? Введите имя.');
  };
  const askSummary = async () => {
    let totals;
    try {
      totals = chatOrderTotals(db, state);
    } catch (error) {
      deleteChatState(db, userId);
      await sendMessage(userId, error.message, { buttons });
      return;
    }
    state.step = 'confirm';
    storeChatState(db, userId, state);
    await sendMessage(userId, [
      'Проверьте заказ:',
      `${totals.product.name}${state.variant ? ` (${state.variant})` : ''} × ${state.quantity} — ${money(totals.subtotal)}`,
      `Доставка: ${money(totals.deliveryPrice)}`,
      `Итого: ${money(totals.total)}`,
      `Получение: ${state.deliveryType === 'pickup' ? 'самовывоз' : state.address}`,
      `Покупатель: ${state.name}, ${state.phone}`
    ].join('\n'), {
      buttons: [[messageButton('Подтвердить заказ', 'подтвердить заказ')], [messageButton('Отмена', 'отмена')]]
    });
  };

  if (state.step === 'consent') {
    if (!/^(?:согласен, продолжить|продолжить оформление)$/i.test(normalized)) {
      await sendMessage(userId, 'Нажмите «Согласен, продолжить» для обработки данных, нужных для заказа, или «Отмена».', {
        buttons: [[messageButton('Согласен, продолжить', 'согласен, продолжить')], [messageButton('Отмена', 'отмена')]]
      });
      return true;
    }
    if (state.kind === 'checkout') {
      state.step = 'quantity';
      storeChatState(db, userId, state);
      await sendMessage(userId, 'Сколько штук оформить? Введите число от 1 до 20.');
    } else await askName();
    return true;
  }

  if (state.kind === 'checkout') {
    if (state.step === 'quantity') {
      const quantity = Number(normalized);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) {
        await sendMessage(userId, 'Введите количество целым числом от 1 до 20.');
        return true;
      }
      state.quantity = quantity;
      const product = db.prepare('SELECT variants FROM products WHERE id = ?').get(state.productId);
      let variants = [];
      try {
        const parsed = JSON.parse(product?.variants || '[]');
        if (Array.isArray(parsed)) variants = parsed.filter(value => typeof value === 'string');
      } catch (error) {
        console.warn('MAX bot: could not read product variants:', error.message);
      }
      if (variants.length) {
        state.step = 'variant';
        storeChatState(db, userId, state);
        await sendMessage(userId, 'Выберите вариант товара или нажмите «Без варианта».', {
          buttons: [...variants.map(variant => [messageButton(variant, `вариант ${variant}`)]),
            [messageButton('Без варианта', 'без варианта')]]
        });
      } else await askName();
      return true;
    }
    if (state.step === 'variant') {
      const product = db.prepare('SELECT variants FROM products WHERE id = ?').get(state.productId);
      const variants = JSON.parse(product?.variants || '[]');
      const selected = text.replace(/^вариант\s+/i, '').trim();
      if (normalized !== 'без варианта' && (!Array.isArray(variants) || !variants.includes(selected))) {
        await sendMessage(userId, 'Выберите вариант кнопкой ниже.', {
          buttons: [...variants.map(variant => [messageButton(variant, `вариант ${variant}`)]),
            [messageButton('Без варианта', 'без варианта')]]
        });
        return true;
      }
      state.variant = normalized === 'без варианта' ? '' : selected;
      await askName();
      return true;
    }
    if (state.step === 'name') {
      if (text.length < 2 || text.length > 100) {
        await sendMessage(userId, 'Введите имя длиной от 2 до 100 символов.');
        return true;
      }
      state.name = text;
      state.step = 'phone';
      storeChatState(db, userId, state);
      await sendMessage(userId, 'Укажите российский номер телефона для связи.');
      return true;
    }
    if (state.step === 'phone') {
      state.phone = normalizeRussianPhone(text);
      if (!state.phone) {
        await sendMessage(userId, 'Не распознал российский номер. Введите номер из 10 или 11 цифр.');
        return true;
      }
      state.step = 'delivery';
      storeChatState(db, userId, state);
      await sendMessage(userId, 'Как получить заказ?', {
        buttons: [[messageButton('Доставка', 'доставка заказа')], [messageButton('Самовывоз', 'самовывоз заказа')]]
      });
      return true;
    }
    if (state.step === 'delivery') {
      if (normalized === 'самовывоз заказа' || normalized === 'самовывоз') {
        state.deliveryType = 'pickup';
        state.address = '';
        await askSummary();
      } else if (normalized === 'доставка заказа' || normalized === 'доставка') {
        state.deliveryType = 'delivery';
        state.step = 'address';
        storeChatState(db, userId, state);
        await sendMessage(userId, 'Напишите полный адрес доставки.');
      } else {
        await sendMessage(userId, 'Выберите «Доставка» или «Самовывоз».', {
          buttons: [[messageButton('Доставка', 'доставка заказа')], [messageButton('Самовывоз', 'самовывоз заказа')]]
        });
      }
      return true;
    }
    if (state.step === 'address') {
      if (text.length < 8 || text.length > 300) {
        await sendMessage(userId, 'Укажите адрес длиной от 8 до 300 символов.');
        return true;
      }
      state.address = text;
      await askSummary();
      return true;
    }
    if (state.step === 'confirm') {
      if (normalized !== 'подтвердить заказ') {
        await sendMessage(userId, 'Проверьте данные и нажмите «Подтвердить заказ» или отмените оформление.', {
          buttons: [[messageButton('Подтвердить заказ', 'подтвердить заказ')], [messageButton('Отмена', 'отмена')]]
        });
        return true;
      }
      let order;
      try {
        order = createChatOrder(db, userId, state);
      } catch (error) {
        deleteChatState(db, userId);
        await sendMessage(userId, error.message, { buttons });
        return true;
      }
      deleteChatState(db, userId);
      const paymentConfigured = Boolean(sbpPhone && sbpBank && sbpReceiverName);
      const message = paymentConfigured
        ? [
          `Заказ №${order.id} принят.`,
          `Переведите ровно ${moneyKopecks(order.pay_amount_unique)} через СБП по номеру ${sbpPhone} в ${sbpBank}.`,
          `Получатель: ${sbpReceiverName}. В комментарии укажите заказ №${order.id}.`,
          'Не отправляйте боту коды подтверждения или данные карты. После перевода напишите «Мои заказы».'
        ].join('\n')
        : `Заказ №${order.id} принят, но магазин ещё не настроил реквизиты СБП. Позвоните ${settingValue(db, 'owner_phone_display', '+7 (901) 826-77-81')} — товар зарезервирован, переводите деньги только после подтверждения магазина.`;
      await sendMessage(userId, message, { buttons });
      if (ownerUserId) {
        const fullOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
        await sendMessage(ownerUserId, orderNotification(fullOrder, 'из MAX'), {
          buttons: orderActionButtons(fullOrder)
        });
      }
      return true;
    }
  }

  if (state.kind === 'custom') {
    if (state.step === 'name') {
      if (text.length < 2 || text.length > 100) {
        await sendMessage(userId, 'Введите имя длиной от 2 до 100 символов.');
        return true;
      }
      state.name = text;
      state.step = 'contact';
      storeChatState(db, userId, state);
      await sendMessage(userId, 'Укажите телефон или другой способ связи.');
      return true;
    }
    if (state.step === 'contact') {
      if (text.length < 5 || text.length > 150) {
        await sendMessage(userId, 'Укажите контакт длиной от 5 до 150 символов.');
        return true;
      }
      state.contact = text;
      state.step = 'itemType';
      storeChatState(db, userId, state);
      await sendMessage(userId, 'Какое изделие хотите заказать?');
      return true;
    }
    if (state.step === 'itemType') {
      if (text.length < 2 || text.length > 100) {
        await sendMessage(userId, 'Опишите тип изделия (от 2 до 100 символов).');
        return true;
      }
      state.itemType = text;
      state.step = 'details';
      storeChatState(db, userId, state);
      await sendMessage(userId, 'Укажите размеры, ткань, цвет и пожелания к изделию.');
      return true;
    }
    if (state.step === 'details') {
      if (text.length < 10 || text.length > 2000) {
        await sendMessage(userId, 'Добавьте подробности: от 10 до 2000 символов.');
        return true;
      }
      state.details = text;
      state.step = 'deadline';
      storeChatState(db, userId, state);
      await sendMessage(userId, 'К какому сроку нужно изделие? Напишите срок или нажмите «Без срока».', {
        buttons: [[messageButton('Без срока', 'без срока')]]
      });
      return true;
    }
    if (state.step === 'deadline') {
      state.deadline = normalized === 'без срока' ? '' : text.slice(0, 100);
      const publicToken = crypto.randomBytes(32).toString('hex');
      const requestId = db.transaction(() => {
        const inserted = db.prepare(`INSERT INTO custom_requests
          (public_token, name, contact, item_type, details, deadline) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(publicToken, state.name, state.contact, state.itemType, state.details, state.deadline);
        const id = Number(inserted.lastInsertRowid);
        db.prepare('INSERT INTO max_chat_custom_requests(request_id, user_id) VALUES(?, ?)')
          .run(id, String(userId));
        return id;
      })();
      deleteChatState(db, userId);
      await sendMessage(userId, `Заявка на пошив №${requestId} принята. Магазин свяжется с вами, чтобы согласовать стоимость и срок.`, {
        buttons, imagePaths: ['/img/custom-sewing.jpg']
      });
      if (ownerUserId) {
        await sendMessage(ownerUserId, [
          `Новая заявка на пошив №${requestId}`,
          `Имя: ${state.name}`,
          `Контакт: ${state.contact}`,
          `Изделие: ${state.itemType}`,
          `Описание: ${state.details}`,
          `Срок: ${state.deadline || 'не указан'}`
        ].join('\n'));
      }
      return true;
    }
  }
  return false;
}

export async function replyToUpdate(update, {
  db,
  sendMessage,
  sbpPhone = '',
  sbpBank = '',
  sbpReceiverName = '',
  ownerUserId = ''
}) {
  const userId = update.message?.sender?.user_id ?? update.user?.user_id;
  if (!Number.isSafeInteger(userId) || userId < 1) return;
  const buttons = menuKeyboard();
  const owner = ownerUserId && String(userId) === String(ownerUserId);

  if (update.update_type === 'bot_started') {
    await sendMessage(userId, owner ? sellerWelcome() : helpText(), {
      buttons: owner ? sellerKeyboard() : buttons
    });
    return;
  }
  if (update.update_type !== 'message_created') return;

  const text = String(update.message?.body?.text || '').trim().slice(0, 300);
  if (!text) return;
  const normalized = normalizedText(text);

  if (/^(?:\/?мой id|\/?мой айди)$/i.test(normalized)) {
    await sendMessage(userId, `Ваш MAX ID: ${userId}. Он нужен, чтобы бот присылал владельцу уведомления о новых заказах.`);
    return;
  }

  if (/^\/?(?:start|help)(?:@\w+)?$/i.test(text)) {
    deleteChatState(db, userId);
    await sendMessage(userId, owner ? sellerWelcome() : helpText(), {
      buttons: owner ? sellerKeyboard() : buttons
    });
    return;
  }

  if (/^(?:отмена|\/cancel)$/i.test(normalized)) {
    deleteChatState(db, userId);
    await sendMessage(userId, 'Оформление отменено. Вы можете начать снова из каталога.', { buttons });
    return;
  }

  const cancelOrderMatch = normalized.match(/^\/?отмена заказа\s+(\d+)$/);
  if (cancelOrderMatch) {
    const orderId = Number(cancelOrderMatch[1]);
    const mapping = db.prepare('SELECT 1 FROM max_chat_orders WHERE order_id = ? AND user_id = ?')
      .get(orderId, String(userId));
    if (!mapping) {
      await sendMessage(userId, 'Не нашёл ожидающий оплаты заказ с таким номером.');
      return;
    }
    const canceled = cancelChatOrder(db, orderId);
    await sendMessage(userId, canceled
      ? `Заказ №${orderId} отменён, зарезервированный товар снова доступен в каталоге.`
      : 'Этот заказ нельзя отменить: он уже оплачен или его статус изменён.', { buttons });
    if (canceled && ownerUserId) await sendMessage(ownerUserId, `Покупатель отменил заказ №${orderId}.`);
    return;
  }

  if (owner) {
    if (/^(?:\/?панель|\/?меню)$/i.test(normalized)) {
      await sendMessage(userId, sellerWelcome(), { buttons: sellerKeyboard() });
      return;
    }
    if (/^\/?помощь продавцу$/i.test(normalized)) {
      await sendMessage(userId, [
        'Помощник продавца Fami',
        '🔔 «Новые заказы» — ожидают оплаты или проверки поступления.',
        '📦 «Активные заказы» — все заказы, которые ещё не завершены.',
        'Откройте заказ кнопкой, чтобы посмотреть покупателя, товары, доставку и оплату.',
        'После проверки банка подтвердите оплату, затем отмечайте сборку, готовность или отправку.',
        'Для возврата в меню нажмите «Панель продавца».'
      ].join('\n'), {
        buttons: [...sellerKeyboard(), [messageButton('Панель продавца', '/панель')]]
      });
      return;
    }
    const paidMatch = normalized.match(/^\/?оплачен\s+(\d+)$/);
    if (paidMatch) {
      const orderId = Number(paidMatch[1]);
      const order = db.prepare(`SELECT * FROM orders
        WHERE id = ? AND payment_method = 'manual' AND payment_status = 'pending'`).get(orderId);
      if (!order) {
        await sendMessage(userId, 'Не нашёл ожидающий оплаты заказ с таким номером.');
        return;
      }
      db.transaction(() => {
        db.prepare(`UPDATE orders SET payment_status = 'paid',
          status = CASE WHEN status = 'on_hold' THEN status ELSE 'new' END,
          paid_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status = 'pending'`).run(orderId);
        db.prepare(`INSERT INTO payment_logs(order_id, event, payload)
          VALUES (?, 'max_owner_manual_confirmation', '{}')`).run(orderId);
      })();
      const buyer = db.prepare('SELECT user_id FROM max_chat_orders WHERE order_id = ?').get(orderId);
      if (buyer) await sendMessage(Number(buyer.user_id), `Оплата заказа №${orderId} проверена и подтверждена. Спасибо!`);
      const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      await sendMessage(userId, `Заказ №${orderId} отмечен оплаченным. Подтверждайте только после проверки поступления в банке.`, {
        buttons: orderActionButtons(updatedOrder)
      });
      return;
    }
    const statusMatch = normalized.match(/^\/?(собирается|готов к выдаче|отправлен|завершен)\s+(\d+)$/);
    if (statusMatch) {
      const orderId = Number(statusMatch[2]);
      const transitions = {
        собирается: { status: 'in_progress', condition: "status = 'new' AND payment_status = 'paid'" },
        'готов к выдаче': { status: 'ready', condition: "status = 'in_progress' AND payment_status = 'paid' AND delivery_type = 'pickup'" },
        отправлен: { status: 'shipped', condition: "status = 'in_progress' AND payment_status = 'paid' AND delivery_type = 'delivery'" },
        завершен: { status: 'done', condition: "status IN ('ready', 'shipped') AND payment_status = 'paid'" }
      };
      const transition = transitions[statusMatch[1]];
      const result = db.prepare(`UPDATE orders SET status = ?
        WHERE id = ? AND ${transition.condition}`).run(transition.status, orderId);
      if (result.changes !== 1) {
        await sendMessage(userId, `Не удалось изменить заказ №${orderId}: проверьте оплату, способ получения и текущий статус.`);
        return;
      }
      db.prepare(`INSERT INTO payment_logs(order_id, event, payload)
        VALUES (?, 'max_owner_order_status', ?)`).run(orderId, JSON.stringify({ status: transition.status }));
      const buyer = db.prepare('SELECT user_id FROM max_chat_orders WHERE order_id = ?').get(orderId);
      if (buyer) await sendMessage(Number(buyer.user_id), orderStatusMessage(orderId, transition.status));
      const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      const nextButtons = orderActionButtons(updatedOrder);
      await sendMessage(userId, `Статус заказа №${orderId}: ${transition.status}.`,
        nextButtons.length ? { buttons: nextButtons } : {});
      return;
    }
    if (/^\/?(?:новые заказы|ожидают оплаты)$/i.test(normalized)) {
      const orders = db.prepare(`SELECT o.id, o.customer_name, o.phone, o.pay_amount_unique,
        o.payment_status, o.status,
        CASE WHEN c.order_id IS NULL THEN 'сайт' ELSE 'MAX' END AS source
        FROM orders o LEFT JOIN max_chat_orders c ON c.order_id = o.id
        WHERE o.payment_status = 'pending' AND o.status NOT IN ('canceled', 'done')
        ORDER BY o.id DESC LIMIT 5`).all();
      const orderButtons = orders.map(order =>
        [messageButton(`Заказ №${order.id} · ${order.customer_name}`, `/заказ ${order.id}`)]
      );
      await sendMessage(userId, orders.length
        ? orders.map(order => `№${order.id} (${order.source}) — ${order.customer_name}, ${order.phone}; ожидает оплаты ${moneyKopecks(order.pay_amount_unique)}`).join('\n')
        : 'Новых заказов, ожидающих оплаты, нет.', {
        buttons: [...orderButtons, ...sellerKeyboard()]
      });
      return;
    }
    if (/^(?:\/?заказы|\/?активные заказы)$/i.test(normalized)) {
      const orders = db.prepare(`SELECT o.id, o.customer_name, o.phone, o.pay_amount_unique,
        o.payment_status, o.status,
        CASE WHEN c.order_id IS NULL THEN 'сайт' ELSE 'MAX' END AS source
        FROM orders o LEFT JOIN max_chat_orders c ON c.order_id = o.id
        WHERE o.status NOT IN ('done', 'canceled') AND o.payment_status NOT IN ('canceled', 'refunded')
        ORDER BY o.id DESC LIMIT 5`).all();
      const orderButtons = orders.map(order =>
        [messageButton(`Заказ №${order.id} · ${order.customer_name}`, `/заказ ${order.id}`)]
      );
      await sendMessage(userId, orders.length
        ? orders.map(order => `№${order.id} (${order.source}) — ${order.customer_name}, ${order.phone}; ${order.payment_status === 'pending' ? `ожидает оплату ${moneyKopecks(order.pay_amount_unique)} — /оплачен ${order.id}` : `оплачено, статус: ${order.status}`} — /заказ ${order.id}`).join('\n')
        : 'Активных заказов нет.', {
        buttons: [...orderButtons, ...sellerKeyboard()]
      });
      return;
    }
    const orderDetailsMatch = normalized.match(/^\/?заказ\s+(\d+)$/);
    if (orderDetailsMatch) {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(orderDetailsMatch[1]));
      if (!order) {
        await sendMessage(userId, 'Не нашёл заказ с таким номером.');
        return;
      }
      const actions = orderActionButtons(order);
      await sendMessage(userId, orderNotification(order, 'подробности'), { buttons: actions });
      return;
    }
    const ownerCancelMatch = normalized.match(/^\/?отменить заказ\s+(\d+)$/);
    if (ownerCancelMatch) {
      const orderId = Number(ownerCancelMatch[1]);
      const canceled = cancelChatOrder(db, orderId);
      await sendMessage(userId, canceled
        ? `Заказ №${orderId} отменён, товар возвращён в остатки.`
        : 'Не нашёл неоплаченный заказ с таким номером.');
      if (canceled) {
        const buyer = db.prepare('SELECT user_id FROM max_chat_orders WHERE order_id = ?').get(orderId);
        if (buyer) await sendMessage(Number(buyer.user_id), `Магазин отменил заказ №${orderId}. Для уточнения свяжитесь с магазином.`);
      }
      return;
    }
    if (/^(?:\/?заявки)$/i.test(normalized)) {
      const requests = db.prepare(`SELECT r.id, r.name, r.contact, r.item_type, r.details
        FROM custom_requests r JOIN max_chat_custom_requests c ON c.request_id = r.id
        WHERE r.status = 'new' ORDER BY r.id DESC LIMIT 10`).all();
      await sendMessage(userId, requests.length
        ? requests.map(request => `Заявка №${request.id}: ${request.name}, ${request.contact}; ${request.item_type}. ${request.details}`).join('\n\n')
        : 'Новых заявок на пошив нет.', { buttons: sellerKeyboard() });
      return;
    }
    if (/^(?:\/?сообщения)$/i.test(normalized)) {
      const messages = db.prepare(`SELECT id, name, contact, message FROM contact_messages
        WHERE status = 'new' ORDER BY id DESC LIMIT 10`).all();
      await sendMessage(userId, messages.length
        ? messages.map(item => `Сообщение №${item.id}: ${item.name}, ${item.contact}. ${item.message}`).join('\n\n')
        : 'Новых сообщений с сайта нет.', { buttons: sellerKeyboard() });
      return;
    }
  }

  if (/^(?:мои заказы|мои покупки|статус заказа)$/i.test(normalized)) {
    const orders = db.prepare(`SELECT o.id, o.status, o.payment_status
      FROM orders o JOIN max_chat_orders c ON c.order_id = o.id
      WHERE c.user_id = ? ORDER BY o.id DESC LIMIT 10`).all(String(userId));
    await sendMessage(userId, orders.length
      ? orders.map(chatOrderStatus).join('\n')
      : 'В этом чате пока нет заказов. Напишите «каталог», чтобы выбрать товар.', { buttons });
    return;
  }

  const state = loadChatState(db, userId);
  if (state) {
    const handled = await processChatState(text, normalized, userId, {
      db, sendMessage, buttons, ownerUserId, sbpPhone, sbpBank, sbpReceiverName
    }, state);
    if (handled) return;
  }

  const purchaseMatch = normalized.match(/^оплатить товар\s+(\d+)$/);
  if (purchaseMatch) {
    const productId = Number(purchaseMatch[1]);
    if (!ownerUserId || !sbpPhone || !sbpBank || !sbpReceiverName) {
      await sendMessage(userId, 'Оформление заказа в чате пока не настроено. Магазину нужно подключить уведомления владельцу и реквизиты СБП. Позвоните: ' + settingValue(db, 'owner_phone_display', '+7 (901) 826-77-81'), { buttons });
      return;
    }
    const product = db.prepare(`SELECT id, name, price, in_stock, stock_qty
      FROM products WHERE id = ?`).get(productId);
    if (!product || !product.in_stock || product.stock_qty < 1) {
      await sendMessage(userId, 'Не нашёл товар или его нет в наличии. Напишите «каталог», чтобы выбрать другой.', { buttons });
      return;
    }
    storeChatState(db, userId, { kind: 'checkout', step: 'consent', productId });
    await sendMessage(userId, `Оформление заказа «${product.name}» происходит в этом чате. Бот сохранит имя, телефон и данные доставки для оформления заказа. Нажмите «Согласен, продолжить», чтобы начать.`, {
      buttons: [[messageButton('Согласен, продолжить', 'согласен, продолжить')], [messageButton('Отмена', 'отмена')]]
    });
    return;
  }

  if (/^(?:доставка|доставка и оплата|сколько стоит доставка|самовывоз)$/i.test(normalized)
    || ['доставка', 'самовывоз', 'курьер', 'трек-номер', 'трек номер'].some(term => normalized.includes(term))) {
    await sendMessage(userId, deliveryAnswer(db), { buttons });
    return;
  }

  if (/^(?:сшить на заказ|пошив на заказ|индивидуальный заказ|работа на заказ)$/i.test(normalized)) {
    if (!ownerUserId) {
      await sendMessage(userId, 'Приём заявок на пошив в чате пока не настроен. Позвоните в магазин: ' + settingValue(db, 'owner_phone_display', '+7 (901) 826-77-81'), { buttons });
      return;
    }
    storeChatState(db, userId, { kind: 'custom', step: 'consent' });
    await sendMessage(userId, 'Заявку на пошив можно оформить здесь, в чате. Для связи и обработки заявки бот попросит имя, контакт и описание изделия. Нажмите «Согласен, продолжить», чтобы начать.', {
      buttons: [[messageButton('Согласен, продолжить', 'согласен, продолжить')], [messageButton('Отмена', 'отмена')]],
      imagePaths: ['/img/custom-sewing.jpg']
    });
    return;
  }

  if (/^(?:оплата|как оплатить|оплатить заказ|сбп)$/i.test(normalized)
    || ['оплатить', 'оплата', 'сбп', 'перевод', 'платеж', 'платёж'].some(term => normalized.includes(term))) {
    await sendMessage(userId, 'Заказ и оплата оформляются прямо в чате. Откройте каталог, выберите товар и нажмите «Оформить заказ». После подтверждения заказа бот покажет точную сумму и СБП-реквизиты, если магазин их настроил. Не отправляйте данные карты и коды.', { buttons });
    return;
  }

  const search = normalized.match(/^\/?(?:найти|поиск)\s+(.+)$/);
  if (/^(?:найти товар|поиск товара)$/i.test(normalized)) {
    await sendMessage(userId, formatProductSearch([], ''), { buttons });
    return;
  }
  if (search) {
    const products = db.prepare(`SELECT id, name, description, material, dimensions, care,
      price, variants, in_stock, stock_qty FROM products ORDER BY id`).all();
    const matches = findProducts(products, search[1]);
    const searchButtons = matches.map(product => [messageButton(`Товар ${product.id}`, `товар ${product.id}`)]);
    searchButtons.push(...buttons);
    await sendMessage(userId, formatProductSearch(products, search[1]), { buttons: searchButtons });
    return;
  }

  const faqAnswer = findFaqAnswer(db, normalized);
  if (faqAnswer) {
    await sendMessage(userId, faqAnswer, { buttons });
    return;
  }

  const page = parsePage(text.toLowerCase());
  if (page !== null) {
    const products = db.prepare(`SELECT id, name, price, in_stock, stock_qty
      FROM products ORDER BY id`).all();
    await sendMessage(userId, formatProductList(products, page), {
      buttons: products.length ? catalogKeyboard(products, page) : buttons
    });
    return;
  }

  const productId = parseProductId(text.toLowerCase());
  if (productId !== null && Number.isSafeInteger(productId)) {
    const product = db.prepare(`SELECT id, name, description, material, dimensions, care, price,
      images, variants, in_stock, stock_qty FROM products WHERE id = ?`).get(productId);
    await sendMessage(userId, product ? productDetails(product) : 'Не нашёл товар с таким номером. Напишите «каталог», чтобы посмотреть товары.', {
      buttons: product ? productKeyboard(product.id) : buttons,
      imagePaths: product ? parseProductImages(product.images) : []
    });
    return;
  }

  if (/^(?:вопросы|faq|частые вопросы)$/i.test(text)) {
    const items = db.prepare(`SELECT question, answer FROM faq_items
      WHERE published = 1 ORDER BY sort_order, id`).all();
    const response = items.length
      ? items.map(item => `${item.question}\n${item.answer}`).join('\n\n').slice(0, 3500)
      : 'Пока частых вопросов нет.';
    await sendMessage(userId, response, { buttons });
    return;
  }

  if (/^(?:контакты|телефон|связаться)$/i.test(text)) {
    const phone = settingValue(db, 'owner_phone_display', '+7 (901) 826-77-81');
    await sendMessage(userId, `Связаться с магазином: ${phone}`, { buttons });
    return;
  }

  const phone = settingValue(db, 'owner_phone_display', '+7 (901) 826-77-81');
  await sendMessage(userId, `Я пока не смог подобрать точный ответ. Попробуйте написать «каталог», «доставка», «оплата» или «статус заказа». Если вопрос требует проверки сотрудником, позвоните: ${phone}.`, { buttons });
}

async function maxApiRequest(token, endpoint, options = {}) {
  const requestOptions = {
    ...options,
    headers: {
      Authorization: token,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    },
    signal: AbortSignal.timeout(40000)
  };
  let response = await fetch(`${API_URL}${endpoint}`, requestOptions);
  if (response.status === 526) {
    console.warn('MAX API returned HTTP 526 on platform-api2.max.ru; retrying platform-api.max.ru.');
    response = await fetch(`${LEGACY_API_URL}${endpoint}`, requestOptions);
  }

  if (!response.ok) {
    let errorCode = '';
    try {
      const result = await response.json();
      const description = typeof result.message === 'string' ? result.message
        : typeof result.description === 'string' ? result.description
          : '';
      const code = typeof result.code === 'string' ? result.code
        : typeof result.error_code === 'string' ? result.error_code
          : description.match(/\bKey:\s*([A-Za-z0-9_.-]{1,80})/)?.[1];
      if (typeof code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(code)) errorCode = code;
    } catch (error) {
      if (error.name !== 'SyntaxError') throw error;
    }
    const failure = new Error(`MAX API request ${endpoint.split('?')[0]} failed with HTTP ${response.status}${errorCode ? ` (${errorCode})` : ''}.`);
    failure.status = response.status;
    throw failure;
  }

  return response.json();
}

function parseProductImages(value) {
  let images;
  try {
    images = JSON.parse(value || '[]');
  } catch (error) {
    console.warn('MAX bot: could not read product image list:', error.message);
    return [];
  }
  if (!Array.isArray(images)) return [];
  return [...new Set(images.filter(image => typeof image === 'string'
    && (image.startsWith('/img/') || image.startsWith('/uploads/'))))]
    .slice(0, MAX_IMAGES_PER_MESSAGE);
}

export function extractUploadedImageToken(uploaded) {
  const photos = uploaded?.photos;
  if (!photos || typeof photos !== 'object') return '';
  return Object.values(photos)
    .find(photo => typeof photo?.token === 'string')?.token || '';
}

async function resolveProductImage(imagePath) {
  if (!imagePath) return null;
  const relativePath = imagePath.startsWith('/img/')
    ? path.join('public', imagePath.slice(1))
    : imagePath.startsWith('/uploads/')
      ? imagePath.slice(1)
      : '';
  if (!relativePath) return null;

  const filePath = path.resolve(PROJECT_ROOT, relativePath);
  if (!filePath.startsWith(`${PROJECT_ROOT}${path.sep}`)) return null;
  const source = await fs.readFile(filePath);
  const buffer = await sharp(source)
    .rotate()
    .resize({ width: 7680, height: 7680, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  if (buffer.length > 50 * 1024 * 1024) throw new Error('Product image exceeds the MAX 50 MB limit after conversion.');
  return { buffer, contentType: 'image/jpeg', filename: `${path.parse(filePath).name}.jpg` };
}

async function uploadProductImage(token, image, setting, setSetting) {
  const imageHash = crypto.createHash('sha256').update(image.buffer).digest('hex');
  const settingKey = `max_image_${imageHash}`;
  const cachedToken = setting(settingKey);
  if (cachedToken) return cachedToken;

  const uploadResult = await maxApiRequest(token, '/uploads?type=image', { method: 'POST' });
  if (typeof uploadResult.url !== 'string') throw new Error('MAX did not return an image upload URL.');

  const form = new FormData();
  form.append('data', new Blob([image.buffer], { type: image.contentType }), image.filename);
  const uploadResponse = await fetch(uploadResult.url, {
    method: 'POST',
    headers: { Authorization: token },
    body: form,
    signal: AbortSignal.timeout(30000)
  });
  if (!uploadResponse.ok) throw new Error(`MAX image upload failed with HTTP ${uploadResponse.status}.`);
  const uploaded = await uploadResponse.json();
  const mediaToken = extractUploadedImageToken(uploaded);
  if (!mediaToken) throw new Error('MAX did not return a media token for the image.');

  setSetting(settingKey, mediaToken);
  await new Promise(resolve => setTimeout(resolve, 1000));
  return mediaToken;
}

export async function runLongPollingBot({
  token, db, setting, setSetting, signal,
  sbpPhone = '', sbpBank = '', sbpReceiverName = '', ownerUserId = ''
}) {
  if (!token) throw new Error('MAX_BOT_TOKEN is required.');
  if (ownerUserId && !/^\d{1,20}$/.test(String(ownerUserId))) {
    throw new Error('MAX_BOT_OWNER_ID must contain the numeric MAX user ID.');
  }
  const bot = await maxApiRequest(token, '/me');
  if (!bot || typeof bot !== 'object') throw new Error('MAX API did not return bot information.');
  console.info(`Connected to MAX bot${bot.username ? ` @${bot.username}` : ''}.`);
  if (!ownerUserId) console.warn('MAX_BOT_OWNER_ID is not set; orders and custom sewing requests are disabled.');
  if (!sbpPhone || !sbpBank || !sbpReceiverName) console.warn('SBP recipient settings are incomplete; product checkout is disabled.');
  let marker = setting('max_bot_marker') || '';
  let consecutiveErrors = 0;

  const sendMessage = async (userId, text, options = {}) => {
    const attachments = [];
    let messageText = text;
    let imageFailures = 0;
    for (const imagePath of options.imagePaths || []) {
      try {
        const image = await resolveProductImage(imagePath);
        if (image) {
          const mediaToken = await uploadProductImage(token, image, setting, setSetting);
          attachments.push({
            type: 'image',
            text: path.basename(imagePath, path.extname(imagePath)),
            payload: { token: mediaToken }
          });
        }
      } catch (error) {
        console.error('MAX bot could not prepare product photo:', error.message);
        imageFailures += 1;
      }
    }
    if (imageFailures) messageText = `${text}\n\nНе удалось отправить фото: ${imageFailures}.`;
    if (options.buttons) {
      attachments.push({ type: 'inline_keyboard', payload: { buttons: options.buttons } });
    }
    const query = new URLSearchParams({ user_id: String(userId) });
    const request = {
      method: 'POST',
      body: JSON.stringify({
        text: messageText,
        ...(attachments.length ? { attachments } : {})
      })
    };
    try {
      await maxApiRequest(token, `/messages?${query}`, request);
    } catch (error) {
      if (!attachments.some(attachment => attachment.type === 'image')) throw error;
      console.error('MAX bot could not send product photos; retrying the message without photos:', error.message);
      await maxApiRequest(token, `/messages?${query}`, {
        method: 'POST',
        body: JSON.stringify({
          text: `${messageText}\n\nФото временно не удалось прикрепить.`,
          attachments: options.buttons
            ? [{ type: 'inline_keyboard', payload: { buttons: options.buttons } }]
            : []
        })
      });
    }
  };

  console.info('MAX chat bot is ready; no shop website is required.');
  while (!signal?.aborted) {
    try {
      const query = new URLSearchParams({
        timeout: String(POLL_TIMEOUT_SECONDS),
        types: 'message_created,bot_started'
      });
      if (marker) query.set('marker', marker);

      query.set('limit', '100');
      const result = await maxApiRequest(token, `/updates?${query}`);
      for (const update of result.updates || []) {
        try {
          await replyToUpdate(update, { db, sendMessage, sbpPhone, sbpBank, sbpReceiverName, ownerUserId });
        } catch (error) {
          console.error('MAX bot could not handle an update:', error.message);
        }
      }

      if (result.marker !== undefined && result.marker !== null) {
        marker = String(result.marker);
        setSetting('max_bot_marker', marker);
      }
      consecutiveErrors = 0;
    } catch (error) {
      if (signal?.aborted) break;
      if ([401, 403, 409].includes(error.status)) throw error;
      consecutiveErrors += 1;
      console.error('MAX bot polling failed:', error.message);
      await new Promise(resolve => setTimeout(resolve, Math.min(1000 * 2 ** Math.min(consecutiveErrors, 5), 30000)));
    }
  }
}
