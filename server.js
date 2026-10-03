import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import sharp from 'sharp';
import nodemailer from 'nodemailer';
import { authenticator } from 'otplib';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isIP } from 'node:net';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { db, setting, setSetting } from './src/database.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const siteUrl = (process.env.SITE_URL || `http://localhost:${port}`).replace(/\/$/, '');
const paymentMode = process.env.PAYMENT_MODE === 'yookassa' ? 'yookassa' : 'manual';
const paymentReady = Boolean(process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY);
const mailReady = Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
const adminPassword = process.env.ADMIN_PASSWORD || '';
const sessionSecret = process.env.SESSION_SECRET || '';
const ipHashSecret = sessionSecret || crypto.randomBytes(32).toString('hex');
const adminConfigReady = adminPassword.length >= 12 && sessionSecret.length >= 32;
const adminAllowlist = (process.env.ADMIN_IP_ALLOWLIST || '').split(',').map(value => value.trim()).filter(Boolean);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});
const databaseDir = path.join(root, 'data');

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ['https://max.ru', 'https://*.max.ru'],
      connectSrc: ["'self'", 'https://mc.yandex.ru'],
      scriptSrc: ["'self'", 'https://mc.yandex.ru', 'https://st.max.ru'],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use('/uploads', express.static(path.join(root, 'uploads'), { maxAge: '7d', immutable: true }));
app.use(express.static(path.join(root, 'public'), { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 180,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Попробуйте ещё раз через минуту.' }
});
const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Не удалось оформить заказ слишком часто. Попробуйте позже.' }
});
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут.' }
});
const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Слишком много запросов для входа. Попробуйте через 15 минут.' }
});
app.use('/api', apiLimiter);

const mailer = mailReady ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT || 587) === 465,
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
  connectionTimeout: 5000,
  greetingTimeout: 5000,
  socketTimeout: 10000
}) : null;

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const money = value => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
const token = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const timingSafeTextEqual = (left, right) => {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
    this.status = 400;
  }
}
class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
    this.status = 409;
  }
}
const jsonParse = (value, fallback) => {
  try { return JSON.parse(value); } catch { return fallback; }
};

function logAdmin(action, target = '', details = {}) {
  db.prepare('INSERT INTO admin_log(action, target, details) VALUES (?, ?, ?)')
    .run(action, String(target), JSON.stringify(details));
}

function logPayment(orderId, event, payload = {}) {
  db.prepare('INSERT INTO payment_logs(order_id, event, payload) VALUES (?, ?, ?)')
    .run(orderId, event, JSON.stringify(payload));
}

function sendMail({ to, subject, text, html, eventKey }) {
  if (!mailer || !to) return false;
  const key = eventKey || `mail-${hash(`${to}\n${subject}\n${text}`)}`;
  db.prepare(`INSERT OR IGNORE INTO email_outbox(event_key, to_address, subject, text_body, html_body)
    VALUES (?, ?, ?, ?, ?)`).run(key, to, subject, text, html);
  return true;
}

function notifyOwner(subject, text, eventKey = '') {
  if (process.env.OWNER_EMAIL && mailer) {
    sendMail({
      to: process.env.OWNER_EMAIL,
      subject,
      text,
      html: `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`,
      eventKey: eventKey ? `owner-${eventKey}` : undefined
    });
  }
}

async function processEmailQueue() {
  if (!mailer) return;
  const messages = db.prepare(`SELECT * FROM email_outbox WHERE status = 'queued'
    AND next_attempt <= CURRENT_TIMESTAMP ORDER BY id LIMIT 5`).all();
  for (const message of messages) {
    try {
      await mailer.sendMail({
        from: process.env.SMTP_FROM,
        to: message.to_address,
        subject: message.subject,
        text: message.text_body,
        html: message.html_body
      });
      if (message.event_key.startsWith('account-login-')) {
        db.prepare('DELETE FROM email_outbox WHERE id = ?').run(message.id);
      } else db.prepare(`UPDATE email_outbox SET status = 'sent', sent_at = CURRENT_TIMESTAMP,
        last_error = '' WHERE id = ? AND status = 'queued'`).run(message.id);
    } catch (error) {
      const attempts = message.attempts + 1;
      const delaySeconds = 5 * 2 ** attempts;
      const isLoginCode = message.event_key.startsWith('account-login-');
      if (isLoginCode && attempts >= 3) {
        db.prepare('DELETE FROM email_outbox WHERE id = ?').run(message.id);
      } else db.prepare(`UPDATE email_outbox SET attempts = ?,
        status = ?, next_attempt = datetime('now', '+' || ? || ' seconds'), last_error = ?
        WHERE id = ? AND status = 'queued'`).run(
        attempts, attempts >= 3 ? 'failed' : 'queued', delaySeconds, String(error.code || 'SMTP_ERROR').slice(0, 80), message.id
      );
      console.warn(`Email delivery attempt ${attempts} failed (${error.code || 'SMTP_ERROR'}).`);
    }
  }

  async function createEncryptedBackup() {
    const backupKey = process.env.BACKUP_KEY;
    if (!backupKey || backupKey.length < 32) return;
    const backupDir = path.join(databaseDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    if (fs.readdirSync(backupDir).some(name => name.startsWith(`family-soft-${today}-`) && name.endsWith('.enc'))) return;
    const temporary = path.join(databaseDir, `backup-${crypto.randomUUID()}.sqlite`);
    const filename = path.join(backupDir, `family-soft-${today}-${Date.now()}.sqlite.enc`);
    try {
      await db.backup(temporary);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update(backupKey).digest(), iv);
      let started = false;
      const encryptor = new Transform({
        transform(chunk, encoding, callback) {
          try {
            if (!started) {
              this.push(iv);
              started = true;
            }
            this.push(cipher.update(chunk));
            callback();
          } catch (error) { callback(error); }
        },
        flush(callback) {
          try {
            this.push(cipher.final());
            this.push(cipher.getAuthTag());
            callback();
          } catch (error) { callback(error); }
        }
      });
      await pipeline(fs.createReadStream(temporary), encryptor, fs.createWriteStream(filename, { flags: 'wx' }));
      const backups = fs.readdirSync(backupDir).filter(name => name.endsWith('.sqlite.enc'))
        .sort((a, b) => b.localeCompare(a));
      for (const old of backups.slice(7)) fs.unlinkSync(path.join(backupDir, old));
    } catch (error) {
      console.error('Encrypted database backup failed:', error.message);
      if (fs.existsSync(filename)) fs.unlinkSync(filename);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
}

function formatOrderMessage(order) {
  return `Заказ №${order.id}\nСумма: ${money(order.total)}\nОплата переводом: ${formatKopecks(order.pay_amount_unique)}\nПолучатель: ${order.customer_name}\nСостав: ${jsonParse(order.items, []).map(item => `${item.name} × ${item.quantity}`).join(', ')}`;
}

function formatKopecks(kopecks) {
  return `${new Intl.NumberFormat('ru-RU').format(Math.floor(kopecks / 100))},${String(kopecks % 100).padStart(2, '0')} ₽`;
}

function requestIpHash(req) {
  return hash(`${ipHashSecret}:${req.ip}`);
}

function clientError(res, status, message) {
  return res.status(status).json({ error: message });
}

function requireText(value, label, max = 500) {
  const result = clean(value, max);
  if (!result) throw new InputError(`Заполните поле «${label}».`);
  return result;
}

function loadCartItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 40) {
    throw new InputError('Корзина пуста или содержит слишком много товаров.');
  }
  const merged = new Map();
  for (const raw of rawItems) {
    const productId = Number(raw?.productId);
    const quantity = Number(raw?.quantity);
    if (!Number.isSafeInteger(productId) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new InputError('Проверьте товары и количество в корзине.');
    }
    const variant = clean(raw.variant, 80);
    const key = `${productId}:${variant}`;
    merged.set(key, { productId, quantity: (merged.get(key)?.quantity || 0) + quantity, variant });
  }
  if ([...merged.values()].some(item => item.quantity > 20)) throw new InputError('Количество одного варианта товара не может превышать 20.');
  const getProduct = db.prepare(`SELECT p.*, c.name AS category_name
    FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ?`);
  const items = [...merged.values()].map(({ productId, quantity, variant }) => {
    const product = getProduct.get(productId);
    if (!product) throw new InputError('Один из товаров больше не доступен.');
    if (!product.in_stock || product.stock_qty < quantity) throw new ConflictError(`Недостаточно товара «${product.name}» в наличии.`);
    return {
      productId,
      name: product.name,
      quantity,
      unitPrice: product.price,
      lineTotal: product.price * quantity,
      variant,
      image: jsonParse(product.images, [])[0] || ''
    };
  });
  const totalsByProduct = new Map();
  for (const item of items) totalsByProduct.set(item.productId, (totalsByProduct.get(item.productId) || 0) + item.quantity);
  for (const item of items) {
    const product = getProduct.get(item.productId);
    if (totalsByProduct.get(item.productId) > product.stock_qty) throw new ConflictError(`Недостаточно товара «${product.name}» в наличии.`);
  }
  return items;
}

function requestItemFingerprint(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 40) {
    throw new InputError('Корзина пуста или содержит слишком много товаров.');
  }
  const items = new Map();
  for (const raw of rawItems) {
    const productId = Number(raw?.productId);
    const quantity = Number(raw?.quantity);
    if (!Number.isSafeInteger(productId) || productId < 1 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new InputError('Проверьте товары и количество в корзине.');
    }
    const variant = clean(raw.variant, 80);
    const key = `${productId}:${variant}`;
    items.set(key, { productId, quantity: (items.get(key)?.quantity || 0) + quantity, variant });
  }
  if ([...items.values()].some(item => item.quantity > 20)) throw new InputError('Количество одного варианта товара не может превышать 20.');
  return [...items.values()].sort((left, right) =>
    left.productId - right.productId || left.variant.localeCompare(right.variant)
  );
}

function calculateOrder({ rawItems, deliveryType, address, promoCode, giftWrap }) {
  const items = loadCartItems(rawItems);
  const subtotal = items.reduce((total, item) => total + item.lineTotal, 0);
  let discount = 0;
  let normalizedPromo = '';
  const code = clean(promoCode, 40).toUpperCase();
  if (code) {
    const promo = db.prepare('SELECT * FROM promo_codes WHERE code = ? AND active = 1').get(code);
    if (!promo || (promo.expires_at && Date.parse(promo.expires_at) < Date.now())
      || (promo.usage_limit != null && promo.used_count >= promo.usage_limit)
      || subtotal < promo.min_total) {
      throw new InputError('Промокод недействителен или условия его применения не выполнены.');
    }
    discount = promo.type === 'percent'
      ? Math.min(subtotal, Math.floor(subtotal * promo.value / 100))
      : Math.min(subtotal, promo.value);
    normalizedPromo = promo.code;
  }
  const wrap = giftWrap === true;
  const wrapPrice = wrap ? Number(setting('gift_wrap_price', '350')) : 0;
  const deliveryPrice = deliveryType === 'pickup'
    ? 0
    : subtotal - discount >= Number(setting('free_delivery_threshold', '10000'))
      ? 0
      : Number(setting('delivery_price', '450'));
  const total = subtotal - discount + wrapPrice + deliveryPrice;
  if (!Number.isSafeInteger(total) || total < 0) throw new InputError('Не удалось рассчитать сумму заказа.');
  return {
    items, subtotal, discount, wrap, wrapPrice, deliveryPrice, total, normalizedPromo,
    deliveryType: deliveryType === 'pickup' ? 'pickup' : 'delivery',
    address: deliveryType === 'pickup' ? clean(setting('pickup_address'), 300) : clean(address, 300)
  };
}

function reserveStock(items) {
  const update = db.prepare(`UPDATE products SET stock_qty = stock_qty - ?,
    in_stock = CASE WHEN stock_qty - ? > 0 THEN 1 ELSE 0 END
    WHERE id = ? AND in_stock = 1 AND stock_qty >= ?`);
  const totals = new Map();
  for (const item of items) totals.set(item.productId, (totals.get(item.productId) || 0) + item.quantity);
  for (const [productId, quantity] of totals) {
    const result = update.run(quantity, quantity, productId, quantity);
    if (result.changes !== 1) {
      const name = items.find(item => item.productId === productId)?.name || 'Выбранный товар';
      throw new ConflictError(`Товар «${name}» закончился. Обновите корзину.`);
    }
  }
}

function restoreStock(order) {
  const items = jsonParse(order.items, []);
  const totals = new Map();
  for (const item of items) totals.set(item.productId, (totals.get(item.productId) || 0) + item.quantity);
  const restore = db.prepare('UPDATE products SET stock_qty = stock_qty + ?, in_stock = 1 WHERE id = ?');
  for (const [productId, quantity] of totals) restore.run(quantity, productId);
}

function encryptSecret(plainText) {
  const key = crypto.createHash('sha256').update(sessionSecret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

function decryptSecret(encoded) {
  const packed = Buffer.from(encoded, 'base64');
  const key = crypto.createHash('sha256').update(sessionSecret).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8');
}

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge
  };
}

function readCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').map(pair => {
    const separator = pair.indexOf('=');
    return separator < 0 ? ['', ''] : [pair.slice(0, separator).trim(), decodeURIComponent(pair.slice(separator + 1).trim())];
  }).filter(([key]) => key));
}

function adminSession(req, res, next) {
  const sessionToken = readCookies(req).fs_admin;
  if (!sessionToken) return clientError(res, 401, 'Войдите в панель управления.');
  const session = db.prepare(`SELECT * FROM admin_sessions
    WHERE token_hash = ? AND expires_at > datetime('now')`).get(hash(sessionToken));
  if (!session || (session.ip_hash && session.ip_hash !== requestIpHash(req))) {
    res.clearCookie('fs_admin', cookieOptions(0));
    return clientError(res, 401, 'Сессия завершена. Войдите снова.');
  }
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) return clientError(res, 403, 'Запрос отклонён.');
    } catch {
      return clientError(res, 403, 'Запрос отклонён.');
    }
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    && !timingSafeTextEqual(req.get('x-csrf-token') || '', session.csrf_token)) {
    return clientError(res, 403, 'Обновите страницу и повторите действие.');
  }
  req.adminSession = session;
  next();
}

function customerSession(req, res, next) {
  const sessionToken = readCookies(req).fs_customer;
  if (!sessionToken) return clientError(res, 401, 'Войдите в личный кабинет.');
  const session = db.prepare(`SELECT customer_sessions.*, customers.email, customers.name
    FROM customer_sessions JOIN customers ON customers.id = customer_sessions.customer_id
    WHERE customer_sessions.token_hash = ? AND customer_sessions.expires_at > datetime('now')
      AND customers.blocked = 0`).get(hash(sessionToken));
  if (!session) {
    res.clearCookie('fs_customer', cookieOptions(0));
    return clientError(res, 401, 'Сессия завершена. Запросите новый код для входа.');
  }
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) return clientError(res, 403, 'Запрос отклонён.');
    } catch {
      return clientError(res, 403, 'Запрос отклонён.');
    }
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    && !timingSafeTextEqual(req.get('x-csrf-token') || '', session.csrf_token)) {
    return clientError(res, 403, 'Обновите страницу и повторите действие.');
  }
  req.customerSession = session;
  next();
}

async function createYooKassaPayment(order) {
  if (!paymentReady) throw new Error('ЮKassa не настроена. Временно недоступна оплата картой и СБП.');
  const payment = {
    amount: { value: `${order.total}.00`, currency: 'RUB' },
    payment_method_data: { type: 'sbp' },
    confirmation: { type: 'redirect', return_url: `${siteUrl}/order/${order.id}/status?t=${encodeURIComponent(order.public_token)}` },
    capture: true,
    description: `Заказ №${order.id}`,
    metadata: { order_id: String(order.id) }
  };
  const receiptMode = process.env.RECEIPT_MODE === 'yookassa';
  if (receiptMode) {
    const receiptItems = [];
    const discountedTotal = order.subtotal - order.discount;
    let assigned = 0;
    const lineAmounts = order.items.map((item, index) => {
      const gross = item.unitPrice * item.quantity;
      const line = index === order.items.length - 1
        ? discountedTotal - assigned
        : Math.round(discountedTotal * gross / order.subtotal);
      assigned += line;
      return { item, amount: line };
    });
    for (const { item, amount } of lineAmounts) {
      receiptItems.push({
        description: `${item.name}${item.variant ? ` (${item.variant})` : ''}`.slice(0, 128),
        quantity: String(item.quantity),
        amount: { value: `${amount.toFixed(2)}`, currency: 'RUB' },
        vat_code: Number(process.env.RECEIPT_VAT_CODE || 1),
        payment_subject: 'commodity',
        payment_mode: 'full_payment'
      });
    }
    if (Number(setting('gift_wrap_price', '350')) > 0 && order.wrap) {
      receiptItems.push({
        description: 'Подарочная упаковка',
        quantity: '1',
        amount: { value: `${Number(setting('gift_wrap_price', '350')).toFixed(2)}`, currency: 'RUB' },
        vat_code: Number(process.env.RECEIPT_VAT_CODE || 1),
        payment_subject: 'service',
        payment_mode: 'full_payment'
      });
    }
    if (order.delivery_price > 0) {
      receiptItems.push({
        description: 'Доставка',
        quantity: '1',
        amount: { value: `${order.delivery_price.toFixed(2)}`, currency: 'RUB' },
        vat_code: Number(process.env.RECEIPT_VAT_CODE || 1),
        payment_subject: 'service',
        payment_mode: 'full_payment'
      });
    }
    const receiptCents = receiptItems.reduce((sum, item) => sum + Math.round(Number(item.amount.value) * 100 * Number(item.quantity)), 0);
    if (receiptCents !== order.total * 100) throw new Error('Сумма позиций в чеке не совпала с суммой заказа. Оплата не создана.');
    payment.receipt = {
      customer: { email: order.email, phone: order.phone },
      items: receiptItems,
      ...(process.env.RECEIPT_TAX_SYSTEM_CODE ? { tax_system_code: Number(process.env.RECEIPT_TAX_SYSTEM_CODE) } : {})
    };
  }

  const idempotenceKey = order.idempotence_key;
  const response = await fetch('https://api.yookassa.ru/v3/payments', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`).toString('base64')}`,
      'Idempotence-Key': idempotenceKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payment),
    signal: AbortSignal.timeout(10000)
  });
  const result = await response.json();
  if (!response.ok || !result.confirmation?.confirmation_url || !result.id) {
    logPayment(order.id, 'payment_create_error', { status: response.status, code: result.code || '' });
    throw new Error('Не удалось создать платёж. Попробуйте позже или свяжитесь с магазином.');
  }
  db.prepare('UPDATE orders SET payment_id = ?, payment_method = ? WHERE id = ?')
    .run(result.id, 'yookassa_sbp', order.id);
  logPayment(order.id, 'payment_created', { payment_id: result.id, status: result.status });
  return result.confirmation.confirmation_url;
}

async function completePayment(orderId, payment, source) {
  const update = db.transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw new Error('Заказ не найден.');
    if (order.payment_status === 'paid') return { order, duplicate: true };
    const amountKopecks = Math.round(Number(payment.amount?.value) * 100);
    if (payment.amount?.currency !== 'RUB' || amountKopecks !== order.total * 100) {
      logPayment(order.id, 'payment_amount_mismatch', {
        received_currency: payment.amount?.currency || '',
        received_kopecks: amountKopecks,
        expected_kopecks: order.total * 100
      });
      return { order, mismatch: true };
    }
    db.prepare(`UPDATE orders SET payment_status = 'paid',
      status = CASE WHEN status = 'on_hold' THEN status ELSE 'in_progress' END,
      paid_at = CURRENT_TIMESTAMP WHERE id = ?`).run(order.id);
    if (order.promo_code) db.prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ?').run(order.promo_code);
    logPayment(order.id, 'payment_succeeded', { source, payment_id: payment.id });
    return { order: db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id), duplicate: false };
  });
  const result = update();
  if (result.mismatch) {
    await notifyOwner(`Проверка платежа: заказ №${orderId}`, 'Обнаружено расхождение суммы или валюты. Заказ не подтверждён. Проверьте платёж вручную в кабинете ЮKassa.');
    return result;
  }
  if (!result.duplicate) {
    await notifyOwner(`Оплата получена — заказ №${result.order.id}`, `Заказ №${result.order.id} оплачен. Сумма: ${money(result.order.total)}.`);
    await sendMail({
      to: result.order.email,
      eventKey: `order-${result.order.id}-paid`,
      subject: `Оплата получена — заказ №${result.order.id} | Family Soft`,
      text: `Спасибо за оплату заказа №${result.order.id} на сумму ${money(result.order.total)}.\nВопросы по заказу: ${setting('owner_phone_display', '+7 (901) 826-77-81')}`,
      html: `<h1>Спасибо за оплату!</h1><p>Заказ №${result.order.id} на сумму ${money(result.order.total)} оплачен.</p><p>Кассовый чек придёт отдельным письмом от платёжного сервиса.</p><p>Вопросы по заказу: ${escapeHtml(setting('owner_phone_display', '+7 (901) 826-77-81'))}</p>`
    });
  }
  return result;
}

app.get('/healthz', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});

app.get('/api/config', (req, res) => {
  const manualReady = Boolean(process.env.SBP_PHONE && process.env.SBP_BANK && process.env.SBP_RECEIVER_NAME);
  res.json({
    shopName: 'Family Soft',
    phone: setting('owner_phone_display', '+7 (901) 826-77-81'),
    metrikaId: /^\d+$/.test(process.env.METRIKA_ID || '') ? process.env.METRIKA_ID : '',
    paymentMode,
    paymentAvailable: paymentMode === 'manual' ? manualReady : paymentReady,
    deliveryPrice: Number(setting('delivery_price', '450')),
    freeDeliveryThreshold: Number(setting('free_delivery_threshold', '10000')),
    giftWrapPrice: Number(setting('gift_wrap_price', '350')),
    pickupAddress: setting('pickup_address'),
    accountLoginAvailable: mailReady && sessionSecret.length >= 32,
    accountEmailReady: mailReady,
    accountSessionReady: sessionSecret.length >= 32,
  });
});

app.get('/api/categories', (req, res) => {
  res.json(db.prepare('SELECT id, name, slug, image, sort_order FROM categories ORDER BY sort_order, id').all());
});

app.get('/api/products', (req, res) => {
  const page = Math.max(1, Math.min(1000, Number.parseInt(req.query.page, 10) || 1));
  const limit = 12;
  const filters = [];
  const params = [];
  if (req.query.category) { filters.push('c.slug = ?'); params.push(clean(req.query.category, 80)); }
  if (req.query.q) {
    filters.push('(p.name LIKE ? OR p.description LIKE ? OR p.material LIKE ?)');
    const term = `%${clean(req.query.q, 100)}%`;
    params.push(term, term, term);
  }
  const hasMin = req.query.min !== undefined && req.query.min !== '';
  const hasMax = req.query.max !== undefined && req.query.max !== '';
  const min = hasMin ? Number(req.query.min) : undefined;
  const max = hasMax ? Number(req.query.max) : undefined;
  if (hasMin && (!Number.isSafeInteger(min) || min < 0)) return clientError(res, 400, 'Укажите корректную минимальную цену.');
  if (hasMax && (!Number.isSafeInteger(max) || max < 0)) return clientError(res, 400, 'Укажите корректную максимальную цену.');
  if (min !== undefined) { filters.push('p.price >= ?'); params.push(min); }
  if (max !== undefined) { filters.push('p.price <= ?'); params.push(max); }
  if (min !== undefined && max !== undefined && min > max) return clientError(res, 400, 'Минимальная цена не должна превышать максимальную.');
  if (req.query.stock === '1') filters.push('p.in_stock = 1 AND p.stock_qty > 0');
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const sort = req.query.sort === 'price_asc' ? 'p.price ASC, p.id DESC'
    : req.query.sort === 'price_desc' ? 'p.price DESC, p.id DESC'
      : 'p.created_at DESC, p.id DESC';
  const total = db.prepare(`SELECT COUNT(*) AS count FROM products p JOIN categories c ON c.id = p.category_id ${where}`).get(...params).count;
  const products = db.prepare(`SELECT p.id, p.category_id, c.name AS category_name, c.slug AS category_slug,
    p.name, p.description, p.material, p.dimensions, p.care, p.price, p.images, p.variants,
    p.in_stock, p.stock_qty, p.created_at
    FROM products p JOIN categories c ON c.id = p.category_id ${where}
    ORDER BY ${sort} LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit)
    .map(product => ({ ...product, images: jsonParse(product.images, []), variants: jsonParse(product.variants, []) }));
  res.json({ products, total, page, pages: Math.ceil(total / limit) });
});

app.get('/api/products/:id', (req, res) => {
  const row = db.prepare(`SELECT p.*, c.name AS category_name, c.slug AS category_slug
    FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ?`).get(Number(req.params.id));
  if (!row) return clientError(res, 404, 'Товар не найден.');
  res.json({ ...row, images: jsonParse(row.images, []), variants: jsonParse(row.variants, []) });
});

app.get('/api/products/:id/reviews', (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isSafeInteger(productId) || productId < 1) return clientError(res, 400, 'Некорректный товар.');
  res.json(db.prepare(`SELECT product_reviews.rating, product_reviews.body, product_reviews.created_at,
    COALESCE(NULLIF(customers.name, ''), 'Покупатель') AS author
    FROM product_reviews JOIN customers ON customers.id = product_reviews.customer_id
    WHERE product_reviews.product_id = ? AND product_reviews.status = 'published'
    ORDER BY product_reviews.created_at DESC LIMIT 100`).all(productId));
});

app.get('/api/faq', (req, res) => {
  res.json(db.prepare('SELECT question, answer FROM faq_items WHERE published = 1 ORDER BY sort_order, id').all());
});

app.get('/api/blog', (req, res) => {
  res.json(db.prepare('SELECT slug, title, cover, content_md, created_at FROM blog_posts WHERE published = 1 ORDER BY created_at DESC').all());
});

app.get('/api/pages/:slug', (req, res) => {
  const page = db.prepare('SELECT slug, title, content FROM pages WHERE slug = ?').get(clean(req.params.slug, 80));
  if (!page) return clientError(res, 404, 'Страница не найдена.');
  res.json(page);
});

app.post('/api/promo/check', (req, res, next) => {
  try {
    const order = calculateOrder({ ...req.body, giftWrap: false });
    res.json({ code: order.normalizedPromo, discount: order.discount, subtotal: order.subtotal });
  } catch (error) {
    if (error instanceof InputError || error instanceof ConflictError) return clientError(res, error.status, error.message);
    next(error);
  }
});

app.post('/api/orders', orderLimiter, async (req, res, next) => {
  try {
    const name = requireText(req.body.name, 'Имя', 100);
    const phone = requireText(req.body.phone, 'Телефон', 30);
    const email = requireText(req.body.email, 'Email', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return clientError(res, 400, 'Введите корректный email.');
    if (!/^\+7\d{10}$/.test(phone.replace(/[\s()-]/g, ''))) return clientError(res, 400, 'Введите телефон в формате +7XXXXXXXXXX.');
    if (!req.body.consentData || !req.body.consentOffer) return clientError(res, 400, 'Подтвердите согласие с политикой конфиденциальности и офертой.');
    const deliveryType = req.body.deliveryType === 'pickup' ? 'pickup' : 'delivery';
    const giftText = clean(req.body.giftCardText, 300);
    const requestedKey = clean(req.get('idempotency-key'), 80);
    const idempotenceKey = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedKey)
      ? requestedKey
      : crypto.randomUUID();
    const existingOrder = db.prepare('SELECT * FROM orders WHERE idempotence_key = ?').get(idempotenceKey);
    if (existingOrder) {
      const savedItems = jsonParse(existingOrder.items, []).map(item => ({
        productId: item.productId, quantity: item.quantity, variant: item.variant
      })).sort((left, right) => left.productId - right.productId || left.variant.localeCompare(right.variant));
      const matchesRequest = existingOrder.email === email && existingOrder.phone === phone.replace(/[\s()-]/g, '')
        && existingOrder.customer_name === name
        && JSON.stringify(savedItems) === JSON.stringify(requestItemFingerprint(req.body.items))
        && (deliveryType === 'pickup' || existingOrder.address === clean(req.body.address, 300))
        && existingOrder.delivery_type === deliveryType
        && existingOrder.gift_wrap === (req.body.giftWrap === true ? 1 : 0)
        && existingOrder.gift_card_text === giftText
        && existingOrder.comment === clean(req.body.comment, 500)
        && existingOrder.promo_code === clean(req.body.promoCode, 40).toUpperCase();
      if (!matchesRequest) return clientError(res, 409, 'Этот запрос оформления уже использован. Обновите страницу и проверьте заказ.');
      if (existingOrder.payment_status !== 'pending') return clientError(res, 409, 'Этот запрос уже завершён. Откройте статус предыдущего заказа.');
      if (existingOrder.payment_method === 'manual') {
        return res.status(200).json({
          id: existingOrder.id, publicToken: existingOrder.public_token, total: existingOrder.total,
          payAmount: existingOrder.pay_amount_unique,
          statusUrl: `/order/${existingOrder.id}/status?t=${encodeURIComponent(existingOrder.public_token)}`
        });
      }
      if (existingOrder.payment_id) {
        const payment = await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(existingOrder.payment_id)}`, {
          headers: { Authorization: `Basic ${Buffer.from(`${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`).toString('base64')}` },
          signal: AbortSignal.timeout(8000)
        });
        const paymentData = await payment.json();
        if (payment.ok && paymentData.confirmation?.confirmation_url) {
          return res.status(200).json({
            id: existingOrder.id, publicToken: existingOrder.public_token, total: existingOrder.total,
            confirmationUrl: paymentData.confirmation.confirmation_url
          });
        }
      }
      return clientError(res, 409, 'Платёж по этому заказу больше нельзя повторить. Обратитесь в магазин.');
    }
    const calculated = calculateOrder({
      rawItems: req.body.items,
      deliveryType,
      address: req.body.address,
      promoCode: req.body.promoCode,
      giftWrap: req.body.giftWrap
    });
    if (deliveryType === 'delivery' && calculated.address.length < 8) return clientError(res, 400, 'Укажите полный адрес доставки.');
    if (paymentMode === 'yookassa' && !paymentReady) return clientError(res, 503, 'Оплата через ЮKassa пока не настроена. Попробуйте позже или свяжитесь с магазином.');
    if (paymentMode === 'manual' && !(process.env.SBP_PHONE && process.env.SBP_BANK && process.env.SBP_RECEIVER_NAME)) {
      return clientError(res, 503, 'Магазин пока не настроил реквизиты для оплаты. Попробуйте оформить заказ позже.');
    }

    const publicToken = token(32);
    const payAmount = calculated.total * 100;
    const existingAmounts = new Set(db.prepare(`SELECT pay_amount_unique FROM orders
      WHERE payment_status = 'pending' AND payment_method = 'manual'
      AND created_at > datetime('now', '-24 hours')`).all().map(row => row.pay_amount_unique));
    let uniqueAmount = payAmount;
    if (paymentMode === 'manual') {
      let found = false;
      for (let kopecks = 1; kopecks < 100; kopecks += 1) {
        if (!existingAmounts.has(payAmount + kopecks)) {
          uniqueAmount = payAmount + kopecks;
          found = true;
          break;
        }
      }
      if (!found) return clientError(res, 503, 'Сейчас не удалось подобрать уникальную сумму перевода. Попробуйте оформить заказ чуть позже.');
    }

    const riskReasons = [];
    if (calculated.total >= 50000) riskReasons.push('Сумма заказа выше обычного порога');
    const recentOrders = db.prepare(`SELECT COUNT(*) AS count FROM orders
      WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')`).get(requestIpHash(req)).count;
    if (recentOrders >= 3) riskReasons.push('Несколько заказов с одного источника за короткое время');
    const blocklisted = db.prepare(`SELECT 1 FROM blocklist WHERE
      (type = 'email' AND value = ?) OR (type = 'phone' AND value = ?) OR (type = 'ip' AND value = ?)
      OR (type = 'domain' AND value = ?) LIMIT 1`).get(email, phone.replace(/[\s()-]/g, ''), requestIpHash(req), email.split('@')[1]);
    if (blocklisted) {
      logAdmin('blocklist_hit', '', { ip_hash: requestIpHash(req) });
      await notifyOwner('Заблокирована попытка оформления заказа', 'Система остановила заказ по совпадению с blocklist. Подробности доступны в журнале безопасности.');
      return clientError(res, 403, 'Оформление заказа с этими данными недоступно. Свяжитесь с магазином, если считаете это ошибкой.');
    }
    const riskScore = Math.min(100, riskReasons.length * 35);
    const status = riskScore >= Number(setting('risk_threshold', '70')) ? 'on_hold' : 'new';
    const savedItems = calculated.items.map(item => ({ ...item, lineTotal: item.lineTotal }));
    const createOrder = db.transaction(() => {
      reserveStock(savedItems);
      const inserted = db.prepare(`INSERT INTO orders
        (public_token, customer_name, phone, email, delivery_type, address, comment, items, gift_wrap,
         gift_card_text, subtotal, discount, delivery_price, total, pay_amount_unique, promo_code,
         status, payment_status, payment_method, idempotence_key, risk_score, risk_reasons, ip_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`)
        .run(publicToken, name, phone.replace(/[\s()-]/g, ''), email, calculated.deliveryType,
          calculated.address, clean(req.body.comment, 500), JSON.stringify(savedItems), calculated.wrap ? 1 : 0,
          giftText, calculated.subtotal, calculated.discount, calculated.deliveryPrice, calculated.total,
          uniqueAmount, calculated.normalizedPromo, status, paymentMode === 'manual' ? 'manual' : 'yookassa_sbp',
          idempotenceKey, riskScore, JSON.stringify(riskReasons), requestIpHash(req));
      return db.prepare('SELECT * FROM orders WHERE id = ?').get(inserted.lastInsertRowid);
    });
    const order = createOrder();

    if (paymentMode === 'yookassa') {
      try {
        const confirmationUrl = await createYooKassaPayment({
          ...order,
          items: jsonParse(order.items, []),
          wrap: Boolean(order.gift_wrap)
        });
        res.status(201).json({ id: order.id, publicToken, confirmationUrl, total: order.total });
      } catch (error) {
        const release = db.transaction(() => {
          restoreStock(order);
          db.prepare("UPDATE orders SET status = 'canceled', payment_status = 'canceled' WHERE id = ?").run(order.id);
        });
        release();
        return clientError(res, 502, error.message);
      }
    } else {
      logPayment(order.id, 'manual_order_created', { mode: 'manual' });
      notifyOwner(`Новый заказ №${order.id}`, formatOrderMessage(order), `order-${order.id}-created`);
      await sendMail({
        to: order.email,
        eventKey: `order-${order.id}-created`,
        subject: `Заказ №${order.id} — Family Soft`,
        text: `Заказ №${order.id} принят. Сумма: ${money(order.total)}. Статус и реквизиты оплаты: ${siteUrl}/order/${order.id}/status?t=${encodeURIComponent(publicToken)}\nВопросы по заказу: ${setting('owner_phone_display', '+7 (901) 826-77-81')}`,
        html: `<h1>Заказ принят</h1><p>Спасибо, ${escapeHtml(order.customer_name)}! Номер заказа: <b>№${order.id}</b>.</p><p>${escapeHtml(formatOrderMessage(order)).replace(/\n/g, '<br>')}</p><p><a href="${siteUrl}/order/${order.id}/status?t=${encodeURIComponent(publicToken)}">Открыть статус заказа</a></p><p>Вопросы по заказу: ${escapeHtml(setting('owner_phone_display', '+7 (901) 826-77-81'))}</p>`
      });
      res.status(201).json({ id: order.id, publicToken, total: order.total, payAmount: uniqueAmount, statusUrl: `/order/${order.id}/status?t=${encodeURIComponent(publicToken)}` });
    }
  } catch (error) {
    if (error instanceof InputError || error instanceof ConflictError) return clientError(res, error.status, error.message);
    next(error);
  }
});

app.get('/api/orders/:id/status', (req, res) => {
  const order = db.prepare(`SELECT id, public_token, customer_name, delivery_type, address, items, gift_wrap,
    gift_card_text, subtotal, discount, delivery_price, total, pay_amount_unique, promo_code, status,
    payment_status, payment_method, paid_at, created_at FROM orders WHERE id = ?`).get(Number(req.params.id));
  if (!order || !timingSafeTextEqual(req.query.t || '', order.public_token)) return clientError(res, 404, 'Заказ не найден или ссылка устарела.');
  res.json({
    ...order,
    items: jsonParse(order.items, []),
    manualPayment: order.payment_method === 'manual' ? {
      phone: process.env.SBP_PHONE || '',
      bank: process.env.SBP_BANK || '',
      receiver: process.env.SBP_RECEIVER_NAME || ''
    } : null
  });
});

app.post('/api/orders/:id/paid-notice', orderLimiter, async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order || !timingSafeTextEqual(req.body.publicToken || '', order.public_token)) return clientError(res, 404, 'Заказ не найден.');
  if (order.payment_method !== 'manual') return clientError(res, 400, 'Этот заказ оплачивается через платёжный сервис.');
  if (order.payment_status !== 'pending') return clientError(res, 409, 'Статус оплаты уже изменён.');
  logPayment(order.id, 'manual_payment_notice', { received: true });
  await notifyOwner(`Покупатель сообщил об оплате — заказ №${order.id}`, `Покупатель нажал «Я оплатил». Сумма перевода: ${formatKopecks(order.pay_amount_unique)}. Проверьте поступление в банке до подтверждения в админке.`);
  res.json({ message: 'Спасибо! Мы проверим поступление платежа и обновим статус заказа.' });
});

app.post('/api/payments/webhook', async (req, res) => {
  try {
    const paymentId = clean(req.body?.object?.id, 100);
    if (paymentMode !== 'yookassa' || !paymentReady) return res.sendStatus(503);
    if (!paymentId) return res.sendStatus(400);
    const order = db.prepare('SELECT * FROM orders WHERE payment_id = ?').get(paymentId);
    if (!order) {
      logPayment(null, 'webhook_unknown_payment', { payment_id: paymentId });
      return res.sendStatus(200);
    }
    const response = await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`).toString('base64')}` },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return res.sendStatus(503);
    const payment = await response.json();
    if (payment.status === 'succeeded') await completePayment(order.id, payment, 'yookassa_webhook');
    else if (payment.status === 'canceled' && order.payment_status === 'pending') {
      const cancel = db.transaction(() => {
        restoreStock(order);
        db.prepare("UPDATE orders SET payment_status = 'canceled', status = 'canceled' WHERE id = ?").run(order.id);
        logPayment(order.id, 'payment_canceled', { payment_id: payment.id });
      });
      cancel();
    } else logPayment(order.id, 'payment_status_checked', { status: payment.status });
    res.sendStatus(200);
  } catch (error) {
    console.error('Payment webhook processing failed:', error.message);
    res.sendStatus(503);
  }
});

app.post('/api/custom-requests', orderLimiter, async (req, res, next) => {
  try {
    const name = requireText(req.body.name, 'Имя', 100);
    const contact = requireText(req.body.contact, 'Контакт для связи', 150);
    const itemType = requireText(req.body.itemType, 'Тип изделия', 100);
    const details = requireText(req.body.details, 'Описание заказа', 2000);
    const publicToken = token();
    const result = db.prepare(`INSERT INTO custom_requests(public_token, name, contact, item_type, details, deadline)
      VALUES (?, ?, ?, ?, ?, ?)`).run(publicToken, name, contact, itemType, details, clean(req.body.deadline, 100));
    await notifyOwner(`Новая заявка на пошив №${result.lastInsertRowid}`, `${name}: ${itemType}. ${details}`);
    res.status(201).json({
      id: result.lastInsertRowid,
      statusUrl: `/custom/request/${result.lastInsertRowid}?t=${encodeURIComponent(publicToken)}`,
      message: 'Заявка сохранена. Мы свяжемся с вами по оставленному контакту.'
    });
  } catch (error) {
    if (error instanceof InputError) return clientError(res, error.status, error.message);
    next(error);
  }
});

app.get('/api/custom-requests/:id/status', (req, res) => {
  const request = db.prepare(`SELECT id, public_token, item_type, details, status, created_at
    FROM custom_requests WHERE id = ?`).get(Number(req.params.id));
  if (!request || !timingSafeTextEqual(req.query.t || '', request.public_token)) {
    return clientError(res, 404, 'Заявка не найдена или ссылка устарела.');
  }
  res.json({
    id: request.id,
    item_type: request.item_type,
    details: request.details,
    status: request.status,
    created_at: request.created_at
  });
});

app.post('/api/contact', orderLimiter, async (req, res, next) => {
  try {
    const name = requireText(req.body.name, 'Имя', 100);
    const contact = requireText(req.body.contact, 'Контакт', 150);
    const message = requireText(req.body.message, 'Сообщение', 1000);
    const created = db.prepare('INSERT INTO contact_messages(name, contact, message) VALUES (?, ?, ?)')
      .run(name, contact, message);
    await notifyOwner(`Сообщение с сайта от ${name}`, `${contact}\n${message}`);
    res.status(201).json({ id: created.lastInsertRowid, message: 'Сообщение сохранено. Спасибо, мы свяжемся с вами.' });
  } catch (error) {
    if (error instanceof InputError) return clientError(res, error.status, error.message);
    next(error);
  }
});

app.post('/api/account/request-code', accountLimiter, (req, res) => {
  if (!mailReady || sessionSecret.length < 32) {
    return clientError(res, 503, 'Вход по email пока не настроен. Магазину нужны работающая почта и SESSION_SECRET длиной не менее 32 символов.');
  }
  const email = clean(req.body.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return clientError(res, 400, 'Введите корректный email.');
  db.prepare('DELETE FROM account_login_codes WHERE expires_at <= datetime(\'now\', \'-1 day\')').run();
  const customer = db.prepare('SELECT blocked FROM customers WHERE email = ?').get(email);
  const previous = db.prepare('SELECT requested_at FROM account_login_codes WHERE email = ?').get(email);
  if (previous && Date.parse(`${previous.requested_at.replace(' ', 'T')}Z`) > Date.now() - 60_000) {
    return res.status(202).json({ message: 'Если адрес подходит для входа, код придёт на почту. Проверьте входящие и папку «Спам».' });
  }
  if (!customer?.blocked) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = crypto.createHmac('sha256', sessionSecret).update(`${email}:${code}`).digest('hex');
    db.prepare(`INSERT INTO account_login_codes(email, code_hash, expires_at, attempts, requested_at)
      VALUES (?, ?, datetime('now', '+10 minutes'), 0, CURRENT_TIMESTAMP)
      ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
        attempts = 0, requested_at = CURRENT_TIMESTAMP`).run(email, codeHash);
    sendMail({
      to: email,
      eventKey: `account-login-${hash(`${email}:${Date.now()}`)}`,
      subject: 'Код входа в Family Soft',
      text: `Код для входа в личный кабинет Family Soft: ${code}\nКод действует 10 минут. Если вы не запрашивали вход, просто проигнорируйте это письмо.`,
      html: `<p>Код для входа в личный кабинет Family Soft:</p><p style="font-size:28px;font-weight:bold;letter-spacing:8px">${code}</p><p>Код действует 10 минут. Если вы не запрашивали вход, просто проигнорируйте это письмо.</p>`
    });
  }
  res.status(202).json({ message: 'Если адрес подходит для входа, код придёт на почту. Проверьте входящие и папку «Спам».' });
});

app.post('/api/account/verify-code', accountLimiter, (req, res) => {
  const email = clean(req.body.email, 254).toLowerCase();
  const code = clean(req.body.code, 6);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) {
    return clientError(res, 400, 'Введите email и шестизначный код из письма.');
  }
  const loginCode = db.prepare(`SELECT * FROM account_login_codes
    WHERE email = ? AND expires_at > datetime('now') AND attempts < 5`).get(email);
  const codeHash = crypto.createHmac('sha256', sessionSecret).update(`${email}:${code}`).digest('hex');
  if (!loginCode || !timingSafeTextEqual(codeHash, loginCode.code_hash)) {
    if (loginCode) {
      const attempts = loginCode.attempts + 1;
      if (attempts >= 5) db.prepare('DELETE FROM account_login_codes WHERE email = ?').run(email);
      else db.prepare('UPDATE account_login_codes SET attempts = ? WHERE email = ?').run(attempts, email);
    }
    return clientError(res, 401, 'Неверный или просроченный код. Запросите новый код и попробуйте ещё раз.');
  }
  const existing = db.prepare('SELECT blocked FROM customers WHERE email = ?').get(email);
  if (existing?.blocked) return clientError(res, 403, 'Вход в этот личный кабинет недоступен. Свяжитесь с магазином.');
  const latestOrder = db.prepare(`SELECT customer_name FROM orders WHERE email = ? ORDER BY id DESC LIMIT 1`).get(email);
  const customer = db.prepare(`INSERT INTO customers(name, email, email_verified)
    VALUES (?, ?, 1)
    ON CONFLICT(email) DO UPDATE SET email_verified = 1,
      name = CASE WHEN excluded.name != '' THEN excluded.name ELSE customers.name END
    RETURNING id`).get(latestOrder?.customer_name || '', email);
  db.prepare(`UPDATE account_login_codes SET code_hash = '', attempts = 5, expires_at = datetime('now')
    WHERE email = ?`).run(email);
  db.prepare(`DELETE FROM customer_sessions WHERE customer_id = ? AND expires_at <= datetime('now')`).run(customer.id);
  const sessionToken = token();
  const csrf = token(24);
  db.prepare(`INSERT INTO customer_sessions(token_hash, customer_id, csrf_token, expires_at)
    VALUES (?, ?, ?, datetime('now', '+30 days'))`).run(hash(sessionToken), customer.id, csrf);
  res.cookie('fs_customer', sessionToken, cookieOptions(30 * 24 * 60 * 60 * 1000));
  res.json({ csrf, message: 'Вы вошли в личный кабинет.' });
});

app.get('/api/account/session', (req, res) => {
  const sessionToken = readCookies(req).fs_customer;
  if (!sessionToken) return res.json({ authenticated: false });
  const session = db.prepare(`SELECT customer_sessions.csrf_token, customers.email
    FROM customer_sessions JOIN customers ON customers.id = customer_sessions.customer_id
    WHERE customer_sessions.token_hash = ? AND customer_sessions.expires_at > datetime('now')
      AND customers.blocked = 0`).get(hash(sessionToken));
  if (!session) {
    res.clearCookie('fs_customer', cookieOptions(0));
    return res.json({ authenticated: false });
  }
  res.json({ authenticated: true, email: session.email, csrf: session.csrf_token });
});

app.get('/api/account', customerSession, (req, res) => {
  const orders = db.prepare(`SELECT id, customer_name, items, total, payment_status, payment_method,
    status, paid_at, created_at FROM orders WHERE email = ? ORDER BY id DESC`).all(req.customerSession.email)
    .map(order => ({ ...order, items: jsonParse(order.items, []) }));
  const reviews = db.prepare(`SELECT id, order_id, product_id, rating, body, status, created_at
    FROM product_reviews WHERE customer_id = ? ORDER BY created_at DESC`).all(req.customerSession.customer_id);
  const refunds = db.prepare(`SELECT id, order_id, reason, status, created_at, updated_at
    FROM refund_requests WHERE customer_id = ? ORDER BY id DESC`).all(req.customerSession.customer_id);
  const profile = db.prepare(`SELECT customers.name, customers.email, customers.phone,
    (SELECT phone FROM orders WHERE email = customers.email ORDER BY id DESC LIMIT 1) AS latest_order_phone
    FROM customers WHERE id = ?`).get(req.customerSession.customer_id);
  res.json({ profile, orders, reviews, refunds });
});

app.post('/api/account/logout', customerSession, (req, res) => {
  db.prepare('DELETE FROM customer_sessions WHERE token_hash = ?').run(req.customerSession.token_hash);
  res.clearCookie('fs_customer', cookieOptions(0));
  res.json({ message: 'Вы вышли из личного кабинета.' });
});

app.post('/api/account/reviews', customerSession, (req, res, next) => {
  try {
    const orderId = Number(req.body.orderId);
    const productId = Number(req.body.productId);
    const rating = Number(req.body.rating);
    const body = requireText(req.body.body, 'Текст отзыва', 1000);
    if (!Number.isSafeInteger(orderId) || orderId < 1 || !Number.isSafeInteger(productId) || productId < 1
      || !Number.isInteger(rating) || rating < 1 || rating > 5 || body.length < 10) {
      return clientError(res, 400, 'Укажите оценку от 1 до 5 и отзыв длиной не менее 10 символов.');
    }
    const order = db.prepare(`SELECT items FROM orders WHERE id = ? AND email = ?
      AND payment_status = 'paid'`).get(orderId, req.customerSession.email);
    if (!order || !jsonParse(order.items, []).some(item => item.productId === productId)) {
      return clientError(res, 403, 'Отзыв можно оставить только о товаре из оплаченного заказа.');
    }
    const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
    if (!product) return clientError(res, 404, 'Товар не найден.');
    try {
      const review = db.prepare(`INSERT INTO product_reviews(customer_id, order_id, product_id, rating, body)
        VALUES (?, ?, ?, ?, ?)`).run(req.customerSession.customer_id, orderId, productId, rating, body);
      res.status(201).json({ id: review.lastInsertRowid, status: 'pending', message: 'Спасибо! Отзыв появится на странице товара после проверки.' });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return clientError(res, 409, 'Вы уже оставили отзыв об этом товаре из данного заказа.');
      throw error;
    }
  } catch (error) {
    if (error instanceof InputError) return clientError(res, error.status, error.message);
    next(error);
  }
});

app.post('/api/account/refunds', customerSession, (req, res, next) => {
  try {
    const orderId = Number(req.body.orderId);
    const reason = requireText(req.body.reason, 'Причина возврата', 1000);
    if (!Number.isSafeInteger(orderId) || orderId < 1 || reason.length < 10) {
      return clientError(res, 400, 'Укажите причину возврата длиной не менее 10 символов.');
    }
    const order = db.prepare(`SELECT id FROM orders WHERE id = ? AND email = ? AND payment_status = 'paid'`)
      .get(orderId, req.customerSession.email);
    if (!order) return clientError(res, 403, 'Запросить возврат можно только по оплаченному заказу из вашего аккаунта.');
    const active = db.prepare(`SELECT id FROM refund_requests WHERE customer_id = ? AND order_id = ?
      AND status IN ('requested','processing')`).get(req.customerSession.customer_id, orderId);
    if (active) return clientError(res, 409, 'По этому заказу уже есть открытый запрос на возврат.');
    const result = db.prepare(`INSERT INTO refund_requests(customer_id, order_id, reason)
      VALUES (?, ?, ?)`).run(req.customerSession.customer_id, orderId, reason);
    notifyOwner(`Запрос возврата — заказ №${orderId}`, `Покупатель просит рассмотреть возврат. Причина: ${reason}`);
    res.status(201).json({ id: result.lastInsertRowid, status: 'requested', message: 'Запрос принят. Магазин свяжется с вами для его рассмотрения.' });
  } catch (error) {
    if (error instanceof InputError) return clientError(res, error.status, error.message);
    next(error);
  }
});

app.get('/api/admin/setup-status', (req, res) => {
  res.json({ configured: Boolean(setting('admin_totp_enc')), enabled: adminConfigReady });
});

app.post('/api/admin/setup', adminLimiter, (req, res) => {
  if (!adminConfigReady) return clientError(res, 503, 'Для настройки админки задайте ADMIN_PASSWORD длиной от 12 символов и SESSION_SECRET длиной от 32 символов.');
  if (setting('admin_totp_enc')) return clientError(res, 409, 'Двухфакторный вход уже настроен.');
  if (!timingSafeTextEqual(req.body.password || '', adminPassword)) return clientError(res, 401, 'Неверный пароль администратора.');
  const secret = authenticator.generateSecret();
  setSetting('admin_totp_enc', encryptSecret(secret));
  logAdmin('admin_totp_setup', '', { completed: true });
  res.status(201).json({
    secret,
    otpauth: authenticator.keyuri('admin', 'Family Soft', secret),
    message: 'Добавьте аккаунт в приложение-аутентификатор и сохраните секрет. Он показывается только один раз.'
  });
});

app.post('/api/admin/login', adminLimiter, (req, res) => {
  if (!adminConfigReady || !setting('admin_totp_enc')) return clientError(res, 503, 'Админка ещё не настроена. Установите пароль длиной от 12 символов, секрет сессии длиной от 32 символов и настройте TOTP.');
  if (adminAllowlist.length && !adminAllowlist.includes(req.ip)) return clientError(res, 403, 'Вход с этого IP-адреса запрещён.');
  const passwordOk = timingSafeTextEqual(req.body.password || '', adminPassword);
  let totpOk = false;
  try { totpOk = authenticator.verify({ token: clean(req.body.code, 8), secret: decryptSecret(setting('admin_totp_enc')) }); }
  catch { totpOk = false; }
  if (!passwordOk || !totpOk) {
    logAdmin('admin_login_failed', '', { ip_hash: requestIpHash(req) });
    return clientError(res, 401, 'Неверный пароль или код подтверждения.');
  }
  const sessionToken = token();
  const csrf = token(24);
  db.prepare(`INSERT INTO admin_sessions(token_hash, csrf_token, ip_hash, expires_at)
    VALUES (?, ?, ?, datetime('now', '+8 hours'))`).run(hash(sessionToken), csrf, requestIpHash(req));
  res.cookie('fs_admin', sessionToken, cookieOptions(8 * 60 * 60 * 1000));
  logAdmin('admin_login', '', { ip_hash: requestIpHash(req) });
  res.json({ csrf, message: 'Вход выполнен.' });
});

app.post('/api/admin/logout', adminSession, (req, res) => {
  db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(req.adminSession.token_hash);
  res.clearCookie('fs_admin', cookieOptions(0));
  res.json({ message: 'Вы вышли из панели управления.' });
});

app.use('/api/admin', adminSession);

app.get('/api/admin/summary', (req, res) => {
  const orderCounts = db.prepare(`SELECT
    SUM(CASE WHEN created_at >= datetime('now', 'start of day') THEN 1 ELSE 0 END) AS today_orders,
    SUM(CASE WHEN payment_status = 'paid' AND paid_at >= datetime('now', 'start of day') THEN total ELSE 0 END) AS today_revenue,
    SUM(CASE WHEN status = 'on_hold' THEN 1 ELSE 0 END) AS on_hold
    FROM orders`).get();
  res.json({
    ...orderCounts,
    totalOrders: db.prepare('SELECT COUNT(*) AS count FROM orders').get().count,
    products: db.prepare('SELECT COUNT(*) AS count FROM products').get().count,
    warnings: [
      ...(!mailReady ? ['SMTP не настроен: письма не отправляются.'] : []),
      ...(paymentMode === 'yookassa' && !paymentReady ? ['ЮKassa выбрана, но не настроена.'] : []),
      ...(!process.env.SBP_PHONE ? ['Не задан SBP_PHONE: реквизиты ручного перевода не показываются.'] : []),
      ...(!process.env.SBP_BANK ? ['Не задан SBP_BANK: реквизиты ручного перевода не показываются.'] : []),
      ...(!process.env.SBP_RECEIVER_NAME ? ['Не задан SBP_RECEIVER_NAME: реквизиты ручного перевода не показываются.'] : []),
      ...(!process.env.OWNER_EMAIL ? ['OWNER_EMAIL не задан: уведомления владельцу отключены.'] : []),
      ...(!process.env.BACKUP_KEY || process.env.BACKUP_KEY.length < 32 ? ['BACKUP_KEY отсутствует или короче 32 символов: резервные копии отключены.'] : [])
    ]
  });
});

app.get('/api/admin/orders', (req, res) => {
  const orders = db.prepare(`SELECT id, customer_name, phone, email, delivery_type, total, pay_amount_unique,
    status, payment_status, payment_method, risk_score, risk_reasons, created_at
    FROM orders ORDER BY id DESC LIMIT 200`).all().map(order => ({
    ...order, risk_reasons: jsonParse(order.risk_reasons, [])
  }));
  res.json(orders);
});

app.get('/api/admin/custom-requests', (req, res) => {
  res.json(db.prepare(`SELECT id, name, contact, item_type, details, deadline, status, created_at
    FROM custom_requests ORDER BY id DESC LIMIT 200`).all());
});

app.get('/api/admin/reviews', (req, res) => {
  res.json(db.prepare(`SELECT product_reviews.id, product_reviews.order_id, product_reviews.product_id,
    product_reviews.rating, product_reviews.body, product_reviews.status, product_reviews.created_at,
    products.name AS product_name, customers.name AS customer_name, customers.email
    FROM product_reviews JOIN products ON products.id = product_reviews.product_id
    JOIN customers ON customers.id = product_reviews.customer_id
    ORDER BY CASE product_reviews.status WHEN 'pending' THEN 0 ELSE 1 END, product_reviews.id DESC LIMIT 300`).all());
});

app.patch('/api/admin/reviews/:id/status', (req, res) => {
  const status = clean(req.body.status, 20);
  if (!['published', 'rejected'].includes(status)) return clientError(res, 400, 'Выберите публикацию или отклонение отзыва.');
  const result = db.prepare('UPDATE product_reviews SET status = ? WHERE id = ?').run(status, Number(req.params.id));
  if (!result.changes) return clientError(res, 404, 'Отзыв не найден.');
  logAdmin('product_review_moderated', req.params.id, { status });
  res.json({ message: status === 'published' ? 'Отзыв опубликован.' : 'Отзыв отклонён.' });
});

app.get('/api/admin/refunds', (req, res) => {
  res.json(db.prepare(`SELECT refund_requests.id, refund_requests.order_id, refund_requests.reason,
    refund_requests.status, refund_requests.created_at, refund_requests.updated_at,
    customers.name AS customer_name, customers.email, orders.total, orders.payment_method
    FROM refund_requests JOIN customers ON customers.id = refund_requests.customer_id
    JOIN orders ON orders.id = refund_requests.order_id
    ORDER BY CASE refund_requests.status WHEN 'requested' THEN 0 WHEN 'processing' THEN 1 ELSE 2 END,
      refund_requests.id DESC LIMIT 300`).all());
});

app.patch('/api/admin/refunds/:id/status', (req, res) => {
  const status = clean(req.body.status, 20);
  if (!['processing', 'rejected', 'completed'].includes(status)) {
    return clientError(res, 400, 'Выберите проверку, отклонение или завершение возврата.');
  }
  const refund = db.prepare('SELECT status FROM refund_requests WHERE id = ?').get(Number(req.params.id));
  if (!refund) return clientError(res, 404, 'Запрос возврата не найден.');
  const transitions = {
    requested: ['processing', 'rejected'],
    processing: ['rejected', 'completed'],
    rejected: ['processing'],
    completed: []
  };
  if (!transitions[refund.status].includes(status)) return clientError(res, 409, 'Этот запрос возврата уже обработан. Создайте новый запрос, если решение изменилось.');
  const current = db.prepare(`SELECT refund_requests.order_id, orders.payment_status FROM refund_requests
    JOIN orders ON orders.id = refund_requests.order_id WHERE refund_requests.id = ?`).get(Number(req.params.id));
  if (status === 'completed' && current.payment_status !== 'paid') {
    return clientError(res, 409, 'Завершить полный возврат можно только для заказа со статусом «Оплачено».');
  }
  const update = db.transaction(() => {
    db.prepare(`UPDATE refund_requests SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`).run(status, Number(req.params.id));
    if (status === 'completed') {
      db.prepare("UPDATE orders SET payment_status = 'refunded' WHERE id = ? AND payment_status = 'paid'").run(current.order_id);
      logPayment(current.order_id, 'manual_refund_completed', { refund_request_id: Number(req.params.id) });
    }
  });
  update();
  logAdmin('refund_request_status_changed', req.params.id, { status });
  res.json({ message: 'Статус запроса возврата обновлён. Денежный возврат выполняется отдельно через банк или платёжный сервис.' });
});

app.patch('/api/admin/custom-requests/:id/status', (req, res) => {
  const allowed = ['new', 'consultation', 'in_progress', 'ready', 'delivered'];
  const status = clean(req.body.status, 30);
  if (!allowed.includes(status)) return clientError(res, 400, 'Недопустимый статус заявки.');
  const result = db.prepare('UPDATE custom_requests SET status = ? WHERE id = ?')
    .run(status, Number(req.params.id));
  if (!result.changes) return clientError(res, 404, 'Заявка не найдена.');
  logAdmin('custom_request_status_changed', req.params.id, { status });
  res.json({ message: 'Статус заявки обновлён.' });
});

app.get('/api/admin/contact-messages', (req, res) => {
  res.json(db.prepare(`SELECT id, name, contact, message, status, created_at
    FROM contact_messages ORDER BY id DESC LIMIT 200`).all());
});

app.patch('/api/admin/contact-messages/:id/status', (req, res) => {
  const status = clean(req.body.status, 20);
  if (!['new', 'read', 'resolved'].includes(status)) return clientError(res, 400, 'Недопустимый статус сообщения.');
  const result = db.prepare('UPDATE contact_messages SET status = ? WHERE id = ?')
    .run(status, Number(req.params.id));
  if (!result.changes) return clientError(res, 404, 'Сообщение не найдено.');
  logAdmin('contact_message_status_changed', req.params.id, { status });
  res.json({ message: 'Статус сообщения обновлён.' });
});

app.patch('/api/admin/orders/:id/status', (req, res) => {
  const status = clean(req.body.status, 30);
  if (!['new', 'on_hold', 'in_progress', 'done', 'canceled'].includes(status)) return clientError(res, 400, 'Недопустимый статус заказа.');
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) return clientError(res, 404, 'Заказ не найден.');
  if (status === 'canceled' && order.payment_status === 'paid') return clientError(res, 409, 'Сначала оформите возврат оплаченного заказа.');
  if (status === 'canceled' && order.payment_status === 'pending' && order.payment_method !== 'manual') {
    return clientError(res, 409, 'Сначала отмените платёж в ЮKassa, затем обновите заказ.');
  }
  if (['in_progress', 'done'].includes(status) && order.payment_status !== 'paid') {
    return clientError(res, 409, 'Заказ можно передать в работу только после подтверждения оплаты.');
  }
  const change = db.transaction(() => {
    if (status === 'canceled' && order.payment_status === 'pending') {
      restoreStock(order);
      db.prepare("UPDATE orders SET status = ?, payment_status = 'canceled' WHERE id = ?").run(status, order.id);
    } else db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);
    logAdmin('order_status_changed', order.id, { from: order.status, to: status });
  });
  change();
  res.json({ message: 'Статус заказа обновлён.' });
});

app.post('/api/admin/orders/:id/confirm-payment', async (req, res, next) => {
  try {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) return clientError(res, 404, 'Заказ не найден.');
  if (order.payment_method !== 'manual') return clientError(res, 400, 'Ручное подтверждение доступно только для перевода.');
  if (order.payment_status !== 'pending') return clientError(res, 409, 'Заказ уже не ожидает оплаты.');
  if (req.body.bankChecked !== true) return clientError(res, 400, 'Подтвердите проверку суммы, отправителя и комментария в банке.');
  const payment = {
    id: `manual-${order.id}`,
    amount: { value: `${order.total}.00`, currency: 'RUB' }
  };
  await completePayment(order.id, payment, 'admin_manual_confirmation');
  logAdmin('manual_payment_confirmed', order.id, { bankChecked: true });
  res.json({ message: 'Оплата подтверждена.' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/orders.csv', (req, res) => {
  const rows = db.prepare('SELECT id, customer_name, phone, email, total, status, payment_status, created_at FROM orders ORDER BY id DESC').all();
  const csvEscape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = ['id,name,phone,email,total,status,payment_status,created_at',
    ...rows.map(row => [row.id, row.customer_name, row.phone, row.email, row.total, row.status, row.payment_status, row.created_at].map(csvEscape).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="family-soft-orders.csv"');
  res.send(`\uFEFF${csv}`);
});

app.get('/api/admin/products', (req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY id DESC').all().map(product => ({
    ...product, images: jsonParse(product.images, []), variants: jsonParse(product.variants, [])
  })));
});

app.post('/api/admin/products/image', upload.single('image'), async (req, res, next) => {
  if (!req.file) return clientError(res, 400, 'Выберите изображение.');
  let optimized;
  try {
    const metadata = await sharp(req.file.buffer, { failOn: 'error' }).metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format)) return clientError(res, 400, 'Поддерживаются только JPEG, PNG и WebP.');
    optimized = await sharp(req.file.buffer, { failOn: 'error' }).rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84 }).toBuffer();
  } catch {
    return clientError(res, 400, 'Файл не является корректным изображением.');
  }
  const uploadDir = path.join(root, 'uploads');
  const filename = `${crypto.randomUUID()}.webp`;
  try {
    await fs.promises.mkdir(uploadDir, { recursive: true });
    await fs.promises.writeFile(path.join(uploadDir, filename), optimized, { flag: 'wx' });
  } catch (error) {
    next(error);
    return;
  }
  res.status(201).json({ url: `/uploads/${filename}` });
});

app.post('/api/admin/products', (req, res, next) => {
  try {
    const name = requireText(req.body.name, 'Название товара', 150);
    const categoryId = Number(req.body.categoryId);
    const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId);
    const price = Number(req.body.price);
    const stockQty = Number(req.body.stockQty);
    if (!category || !Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(stockQty) || stockQty < 0 || stockQty > 10000) {
      return clientError(res, 400, 'Проверьте категорию, цену и остаток.');
    }
    const images = Array.isArray(req.body.images) ? req.body.images.filter(url => typeof url === 'string' && url.startsWith('/uploads/')).slice(0, 5) : [];
    const variants = Array.isArray(req.body.variants) ? req.body.variants.map(value => clean(value, 80)).filter(Boolean).slice(0, 20) : [];
    const result = db.prepare(`INSERT INTO products(category_id, name, description, material, dimensions, care, price, images, variants, in_stock, stock_qty)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(categoryId, name, clean(req.body.description, 3000),
      clean(req.body.material, 200), clean(req.body.dimensions, 300), clean(req.body.care, 500), price,
      JSON.stringify(images), JSON.stringify(variants), req.body.inStock === false ? 0 : 1,
      stockQty);
    logAdmin('product_created', result.lastInsertRowid, { name });
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    if (error instanceof InputError) return clientError(res, error.status, error.message);
    next(error);
  }
});

app.put('/api/admin/products/:id', (req, res) => {
  const id = Number(req.params.id);
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
  if (!product) return clientError(res, 404, 'Товар не найден.');
  const price = Number(req.body.price);
  const categoryId = Number(req.body.categoryId);
  const stockQty = Number(req.body.stockQty);
  if (!Number.isSafeInteger(price) || price < 0 || !db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId)
    || !Number.isSafeInteger(stockQty) || stockQty < 0 || stockQty > 10000) {
    return clientError(res, 400, 'Проверьте категорию, цену и остаток.');
  }
  const images = Array.isArray(req.body.images) ? req.body.images.filter(url => typeof url === 'string' && (url.startsWith('/uploads/') || url.startsWith('/img/'))).slice(0, 5) : [];
  db.prepare(`UPDATE products SET category_id = ?, name = ?, description = ?, material = ?, dimensions = ?,
    care = ?, price = ?, images = ?, variants = ?, in_stock = ?, stock_qty = ? WHERE id = ?`).run(
    categoryId, requireText(req.body.name, 'Название товара', 150), clean(req.body.description, 3000),
    clean(req.body.material, 200), clean(req.body.dimensions, 300), clean(req.body.care, 500), price,
    JSON.stringify(images), JSON.stringify(Array.isArray(req.body.variants) ? req.body.variants.map(value => clean(value, 80)).filter(Boolean).slice(0, 20) : []),
    req.body.inStock === false ? 0 : 1, stockQty, id
  );
  logAdmin('product_updated', id);
  res.json({ message: 'Товар обновлён.' });
});

app.delete('/api/admin/products/:id', (req, res) => {
  const id = Number(req.params.id);
  const hasOrders = db.prepare("SELECT 1 FROM orders WHERE items LIKE ? LIMIT 1").get(`%"productId":${id}%`);
  if (hasOrders) {
    db.prepare('UPDATE products SET in_stock = 0, stock_qty = 0 WHERE id = ?').run(id);
    logAdmin('product_archived', id);
  } else {
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    logAdmin('product_deleted', id);
  }
  res.json({ message: hasOrders ? 'Товар скрыт из продажи, история заказов сохранена.' : 'Товар удалён.' });
});

app.get('/api/admin/settings', (req, res) => {
  const allowed = ['owner_phone_display', 'delivery_price', 'free_delivery_threshold', 'gift_wrap_price', 'pickup_address', 'risk_threshold'];
  res.json(Object.fromEntries(allowed.map(key => [key, setting(key)])));
});

app.put('/api/admin/settings', (req, res) => {
  const allowed = {
    owner_phone_display: value => clean(value, 40),
    delivery_price: value => String(Math.max(0, Math.min(100000, Number(value)))),
    free_delivery_threshold: value => String(Math.max(0, Math.min(10000000, Number(value)))),
    gift_wrap_price: value => String(Math.max(0, Math.min(100000, Number(value)))),
    pickup_address: value => clean(value, 300),
    risk_threshold: value => String(Math.max(0, Math.min(100, Number(value))))
  };
  for (const [key, value] of Object.entries(req.body)) {
    if (!allowed[key]) continue;
    if (['delivery_price', 'free_delivery_threshold', 'gift_wrap_price', 'risk_threshold'].includes(key)
      && (!Number.isSafeInteger(Number(value)) || Number(value) < 0 || Number(value) > 10000000)) {
      return clientError(res, 400, `Некорректное числовое значение для настройки ${key}.`);
    }
    setSetting(key, allowed[key](value));
  }
  logAdmin('settings_changed', '', { keys: Object.keys(req.body).filter(key => key in allowed) });
  res.json({ message: 'Настройки сохранены.' });
});

app.get('/api/admin/log', (req, res) => {
  res.json(db.prepare('SELECT action, target, details, created_at FROM admin_log ORDER BY id DESC LIMIT 200').all()
    .map(row => ({ ...row, details: jsonParse(row.details, {}) })));
});

app.get('/api/admin/blocklist', (req, res) => {
  res.json(db.prepare('SELECT id, type, value, reason, created_at FROM blocklist ORDER BY id DESC').all());
});

app.post('/api/admin/blocklist', (req, res) => {
  const type = clean(req.body.type, 20);
  const value = clean(req.body.value, 254).toLowerCase();
  const reason = clean(req.body.reason, 300);
  if (!['email', 'phone', 'domain', 'ip'].includes(type) || !value) {
    return clientError(res, 400, 'Выберите тип блокировки и укажите значение.');
  }
  let storedValue = value;
  if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return clientError(res, 400, 'Укажите корректный email.');
  if (type === 'domain' && !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(value)) {
    return clientError(res, 400, 'Укажите корректный домен.');
  }
  if (type === 'phone') {
    storedValue = value.replace(/[\s()-]/g, '');
    if (!/^\+7\d{10}$/.test(storedValue)) return clientError(res, 400, 'Укажите телефон в формате +7XXXXXXXXXX.');
  }
  if (type === 'ip') {
    if (!isIP(value)) return clientError(res, 400, 'Укажите корректный IP-адрес.');
    storedValue = requestIpHash({ ip: value });
  }
  try {
    const result = db.prepare('INSERT INTO blocklist(type, value, reason) VALUES (?, ?, ?)').run(type, storedValue, reason);
    logAdmin('blocklist_entry_added', result.lastInsertRowid, { type });
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return clientError(res, 409, 'Такая запись уже есть в списке.');
    throw error;
  }
});

app.delete('/api/admin/blocklist/:id', (req, res) => {
  const result = db.prepare('DELETE FROM blocklist WHERE id = ?').run(Number(req.params.id));
  if (!result.changes) return clientError(res, 404, 'Запись блокировки не найдена.');
  logAdmin('blocklist_entry_removed', req.params.id);
  res.json({ message: 'Запись удалена из списка.' });
});

async function expireUnpaidOrders() {
  const expiredManual = db.prepare(`SELECT * FROM orders WHERE payment_status = 'pending'
    AND payment_method = 'manual' AND created_at < datetime('now', '-24 hours')`).all();
  if (expiredManual.length) {
    const expire = db.transaction(() => {
      for (const order of expiredManual) {
        restoreStock(order);
        db.prepare("UPDATE orders SET payment_status = 'canceled', status = 'canceled' WHERE id = ? AND payment_status = 'pending'")
          .run(order.id);
        logPayment(order.id, 'manual_payment_expired', {});
      }
    });
    expire();
  }

  if (paymentMode !== 'yookassa' || !paymentReady) return;
  const expiredYooKassa = db.prepare(`SELECT * FROM orders WHERE payment_status = 'pending'
    AND payment_method = 'yookassa_sbp' AND created_at < datetime('now', '-24 hours') AND payment_id IS NOT NULL`).all();
  for (const order of expiredYooKassa) {
    try {
      const response = await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(order.payment_id)}`, {
        headers: { Authorization: `Basic ${Buffer.from(`${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`).toString('base64')}` },
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error(`YooKassa returned HTTP ${response.status}`);
      const payment = await response.json();
      if (payment.status === 'succeeded') {
        await completePayment(order.id, payment, 'expiry_reconciliation');
      } else if (payment.status === 'canceled') {
        const cancel = db.transaction(() => {
          restoreStock(order);
          db.prepare("UPDATE orders SET payment_status = 'canceled', status = 'canceled' WHERE id = ? AND payment_status = 'pending'").run(order.id);
          logPayment(order.id, 'payment_expired', { payment_id: payment.id });
        });
        cancel();
      }
    } catch (error) {
      console.error(`Could not reconcile expired payment for order ${order.id}:`, error.message);
    }
  }
}

setInterval(() => {
  try { expireUnpaidOrders().catch(error => console.error('Order expiry job failed:', error.message)); }
  catch (error) { console.error('Order expiry job failed:', error.message); }
}, 10 * 60 * 1000).unref();

app.get('/sitemap.xml', (req, res) => {
  const products = db.prepare('SELECT id FROM products').all().map(row => `/product/${row.id}`);
  const categories = db.prepare('SELECT slug FROM categories').all().map(row => `/category/${row.slug}`);
  const posts = db.prepare('SELECT slug FROM blog_posts WHERE published = 1').all().map(row => `/blog/${row.slug}`);
  const urls = ['/', '/catalog', '/faq', '/about', '/contacts', '/delivery', '/privacy', '/offer', '/safe-shopping', ...products, ...categories, ...posts];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<url><loc>${escapeHtml(siteUrl + url)}</loc></url>`).join('')}</urlset>`);
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /admin\nDisallow: /account\nDisallow: /order\nDisallow: /api\nSitemap: ' + siteUrl + '/sitemap.xml\n');
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/healthz') return next();
  res.sendFile(path.join(root, 'public', 'index.html'));
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    return clientError(res, 400, error.code === 'LIMIT_FILE_SIZE'
      ? 'Изображение должно быть не больше 5 МБ.'
      : 'Выберите один файл изображения.');
  }
  if (error.type === 'entity.too.large') return clientError(res, 413, 'Запрос слишком большой.');
  if (error instanceof SyntaxError && 'body' in error) return clientError(res, 400, 'Проверьте формат отправленных данных.');
  const status = Number(error.status || error.statusCode) || 500;
  if (status >= 500) console.error('Request failed:', error.message);
  res.status(status).json({ error: status >= 500 ? 'Не удалось выполнить запрос. Попробуйте ещё раз.' : error.message });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Family Soft работает: http://0.0.0.0:${port}`);
  if (!mailReady) console.warn('SMTP не настроен: письма и email-уведомления отключены.');
  if (!process.env.SBP_PHONE && paymentMode === 'manual') console.warn('SBP_PHONE не задан: реквизиты ручной оплаты не будут показаны.');
  if (!sessionSecret) console.warn('SESSION_SECRET не задан: вход в админку отключён.');
  if (!process.env.BACKUP_KEY || process.env.BACKUP_KEY.length < 32) console.warn('BACKUP_KEY не задан или слишком короткий: автоматические резервные копии отключены.');
  else createEncryptedBackup().catch(error => console.error('Encrypted database backup failed:', error.message));
});

setInterval(() => {
  createEncryptedBackup().catch(error => console.error('Encrypted database backup failed:', error.message));
}, 24 * 60 * 60 * 1000).unref();

setInterval(() => {
  processEmailQueue().catch(error => console.error('Email queue processing failed:', error.code || error.name));
}, 5000).unref();
