import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATABASE_PATH
  ? path.dirname(path.resolve(process.env.DATABASE_PATH))
  : path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : path.join(dataDir, 'family-soft.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    image TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    material TEXT NOT NULL,
    dimensions TEXT NOT NULL,
    care TEXT NOT NULL,
    price INTEGER NOT NULL CHECK(price >= 0),
    images TEXT NOT NULL DEFAULT '[]',
    variants TEXT NOT NULL DEFAULT '[]',
    in_stock INTEGER NOT NULL DEFAULT 1,
    stock_qty INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS promo_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK(type IN ('percent','fixed')),
    value INTEGER NOT NULL,
    min_total INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    usage_limit INTEGER,
    used_count INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_token TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    delivery_type TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    items TEXT NOT NULL,
    gift_wrap INTEGER NOT NULL DEFAULT 0,
    gift_card_text TEXT NOT NULL DEFAULT '',
    subtotal INTEGER NOT NULL,
    discount INTEGER NOT NULL DEFAULT 0,
    delivery_price INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL,
    pay_amount_unique INTEGER NOT NULL,
    promo_code TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',
    payment_status TEXT NOT NULL DEFAULT 'pending',
    payment_method TEXT NOT NULL DEFAULT 'manual',
    payment_id TEXT UNIQUE,
    idempotence_key TEXT NOT NULL,
    paid_at TEXT,
    risk_score INTEGER NOT NULL DEFAULT 0,
    risk_reasons TEXT NOT NULL DEFAULT '[]',
    ip_hash TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS payment_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER REFERENCES orders(id),
    event TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS custom_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_token TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    item_type TEXT NOT NULL,
    details TEXT NOT NULL,
    deadline TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS max_chat_orders (
    order_id INTEGER PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS max_chat_orders_user_idx ON max_chat_orders(user_id, order_id);
  CREATE TABLE IF NOT EXISTS max_chat_custom_requests (
    request_id INTEGER PRIMARY KEY REFERENCES custom_requests(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS max_chat_custom_requests_user_idx ON max_chat_custom_requests(user_id, request_id);
  CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','read','resolved')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS faq_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    published INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS blog_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    cover TEXT NOT NULL DEFAULT '',
    content_md TEXT NOT NULL,
    published INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS pages (
    slug TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    csrf_token TEXT NOT NULL,
    ip_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS blocklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('email','phone','domain','ip','ip_range')),
    value TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(type, value)
  );
  CREATE TABLE IF NOT EXISTS email_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_key TEXT NOT NULL UNIQUE,
    to_address TEXT NOT NULL,
    subject TEXT NOT NULL,
    text_body TEXT NOT NULL,
    html_body TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sent','failed')),
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TEXT
  );
  CREATE TABLE IF NOT EXISTS admin_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    email TEXT UNIQUE,
    phone TEXT UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    phone_verified INTEGER NOT NULL DEFAULT 0,
    blocked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK(email IS NOT NULL OR phone IS NOT NULL)
  );
  CREATE TABLE IF NOT EXISTS account_login_codes (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS customer_sessions (
    token_hash TEXT PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS product_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','rejected')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(customer_id, order_id, product_id)
  );
  CREATE TABLE IF NOT EXISTS refund_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    order_id INTEGER NOT NULL REFERENCES orders(id),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','processing','rejected','completed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at);
  CREATE INDEX IF NOT EXISTS orders_email_idx ON orders(email, id);
  CREATE INDEX IF NOT EXISTS products_category_idx ON products(category_id);
  CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotence_idx ON orders(idempotence_key);
  CREATE INDEX IF NOT EXISTS customer_sessions_expiry_idx ON customer_sessions(expires_at);
  CREATE INDEX IF NOT EXISTS product_reviews_product_status_idx ON product_reviews(product_id, status, created_at);
  CREATE INDEX IF NOT EXISTS refund_requests_customer_idx ON refund_requests(customer_id, created_at);
`);

export function setting(key, fallback = '') {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? fallback;
}

export function setSetting(key, value) {
  db.prepare(`INSERT INTO settings(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
}

const categories = [
  ['Семейные комплекты', 'family-sets', '/img/cat-family.jpg'],
  ['Детские комплекты', 'kids-sets', '/img/cat-kids.jpg'],
  ['Пледы', 'plaids', '/img/hero-day.jpg'],
  ['Одеяла', 'blankets', '/img/cat-blankets.jpg'],
  ['Подушки-думки', 'pillows', '/img/cat-pillows.jpg'],
  ['Детский текстиль', 'kids-textile', '/img/cat-baby.jpg'],
  ['Кухонные полотенца', 'kitchen-towels', '/img/cat-towels.jpg'],
  ['Шопперы', 'shoppers', '/img/cat-shoppers.jpg'],
  ['Шарфы', 'scarves', '/img/cat-scarves.jpg'],
  ['Приятные мелочи', 'small-things', ''],
  ['Работа на заказ', 'custom', '/img/label.jpg']
];

const products = [
  { c: 1, name: 'Комплект «Облачное утро»', description: 'Мягкое семейное постельное бельё в спокойном молочном оттенке. Сшито небольшими партиями с вниманием к каждой детали.', material: 'Хлопок поплин', dimensions: 'Пододеяльник 200×220 см, простыня 220×240 см, 2 наволочки 50×70 см', care: 'Стирка при 40 °C, деликатный отжим', price: 8490, img: '/img/cat-family.jpg', variants: ['Евро', 'Семейный'] },
  { c: 1, name: 'Комплект «Лён и молоко»', description: 'Лаконичный комплект для уютной спальни: натуральная фактура и универсальная палитра.', material: 'Хлопок сатин', dimensions: 'Пододеяльник 200×220 см, простыня 220×240 см, 2 наволочки 50×70 см', care: 'Стирка при 40 °C, гладить с изнанки', price: 9990, img: '/img/cat-family.jpg', variants: ['Евро'] },
  { c: 2, name: 'Детский комплект «Бабочки»', description: 'Нежный цветочный рисунок и мягкие оборки для комнаты, полной историй.', material: 'Хлопок поплин', dimensions: 'Пододеяльник 147×112 см, простыня 150×100 см, наволочка 40×60 см', care: 'Стирка при 40 °C, мягкое средство', price: 5290, img: '/img/cat-kids.jpg', variants: ['Кроватка', 'Полуторный'] },
  { c: 2, name: 'Детский комплект «Лавандовый сад»', description: 'Цветочный комплект в мягких лавандовых и пудровых тонах.', material: 'Хлопок', dimensions: 'Пододеяльник 147×112 см, простыня 150×100 см, наволочка 40×60 см', care: 'Стирка при 40 °C', price: 4990, img: '/img/cat-kids.jpg', variants: ['Кроватка'] },
  { c: 3, name: 'Плед «Тихий вечер»', description: 'Воздушный уютный плед для чтения, отдыха и тёплого чая у окна.', material: 'Микрофибра, плюш', dimensions: '150×200 см', care: 'Деликатная стирка при 30 °C', price: 4290, img: '/img/hero-day.jpg', variants: ['Голубой', 'Пудровый'] },
  { c: 3, name: 'Плед «Объятие»', description: 'Плотный мягкий плед с бархатистой фактурой — для дивана или в подарок.', material: 'Велюр, плюш', dimensions: '180×200 см', care: 'Деликатная стирка при 30 °C', price: 5790, img: '/img/cat-plaids.jpg', variants: ['Голубой', 'Молочный'] },
  { c: 4, name: 'Одеяло «Нежность»', description: 'Лёгкое стёганое одеяло с равномерным наполнителем и мягким хлопковым чехлом.', material: 'Хлопок, холлофайбер', dimensions: '172×205 см', care: 'Стирка при 30 °C в деликатном режиме', price: 6490, img: '/img/cat-blankets.jpg', variants: ['Полуторное', 'Евро'] },
  { c: 4, name: 'Одеяло «Тёплое облако»', description: 'Уютное одеяло для прохладных вечеров и спокойного сна.', material: 'Микрофибра, силиконизированное волокно', dimensions: '200×220 см', care: 'Стирка при 30 °C', price: 7290, img: '/img/cat-blankets.jpg', variants: ['Евро'] },
  { c: 5, name: 'Подушка «Мягкий акцент»', description: 'Декоративная бархатистая подушка для дивана или спальни.', material: 'Велюр, полиэстер', dimensions: '45×45 см', care: 'Съёмный чехол, деликатная стирка', price: 1690, img: '/img/cat-pillows.jpg', variants: ['Пудровый', 'Синий'] },
  { c: 6, name: 'Набор для малыша «Облачко»', description: 'Мягкие нагрудники и пелёнка в спокойной пастельной гамме.', material: 'Хлопок муслин', dimensions: 'Пелёнка 80×100 см, нагрудники 25×30 см', care: 'Стирка при 40 °C', price: 2390, img: '/img/cat-baby.jpg', variants: ['Мятный', 'Пудровый'] },
  { c: 7, name: 'Набор кухонных полотенец «Лаванда»', description: 'Практичный набор полотенец с уютными принтами для кухни.', material: 'Хлопок вафельный', dimensions: '3 полотенца 40×60 см', care: 'Стирка при 40 °C', price: 1290, img: '/img/cat-towels.jpg', variants: ['Набор из 3'] },
  { c: 8, name: 'Шоппер «Цветочный квартал»', description: 'Многоразовая сумка для покупок с яркой авторской иллюстрацией.', material: 'Хлопок', dimensions: '38×42 см', care: 'Деликатная стирка при 30 °C', price: 1490, img: '/img/cat-shoppers.jpg', variants: ['Красный', 'Синий'] },
  { c: 9, name: 'Шарф «Шёлковый сад»', description: 'Лёгкий шарф с цветочным принтом и аккуратной окантовкой.', material: 'Искусственный шёлк', dimensions: '70×70 см', care: 'Ручная стирка в прохладной воде', price: 2190, img: '/img/cat-scarves.jpg', variants: ['Розовый', 'Бирюзовый'] }
];

const seed = db.transaction(() => {
  const categoryInsert = db.prepare('INSERT OR IGNORE INTO categories(name, slug, image, sort_order) VALUES (?, ?, ?, ?)');
  categories.forEach((category, index) => categoryInsert.run(...category, index));

  const productInsert = db.prepare(`INSERT INTO products
    (category_id, name, description, material, dimensions, care, price, images, variants, in_stock, stock_qty)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?
    WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = ?)`);
  products.forEach((product, index) => productInsert.run(
    product.c, product.name, product.description, product.material, product.dimensions,
    product.care, product.price, JSON.stringify([product.img]), JSON.stringify(product.variants),
    index % 4 + 2, product.name
  ));
  db.prepare(`UPDATE products SET images = ?
    WHERE name = ? AND images = ?`).run(
    JSON.stringify(['/img/cat-plaids.jpg']),
    'Плед «Объятие»',
    JSON.stringify(['/img/cat-blankets.jpg'])
  );

  const faq = [
    ['Как оформить заказ?', 'Добавьте товары в корзину, укажите контакты и адрес доставки. После оформления появится страница с подробностями заказа.'],
    ['Как оплатить заказ?', 'Сейчас доступна ручная оплата переводом через СБП по реквизитам на странице заказа. Передавайте только указанную там сумму и комментарий.'],
    ['Сколько стоит доставка?', 'Стоимость доставки и порог бесплатной доставки указаны при оформлении. Самовывоз бесплатный.'],
    ['Как ухаживать за текстилем?', 'Рекомендации по уходу указаны на странице каждого товара. Для большинства изделий подойдёт деликатная стирка при 30–40 °C.'],
    ['Можно заказать изделие по своим размерам?', 'Да, отправьте пожелания и контакт через форму индивидуального заказа — мы уточним детали.'],
    ['Можно вернуть товар?', 'Условия возврата зависят от вида товара и требований законодательства РФ. Напишите нам до отправки товара обратно, чтобы согласовать порядок действий.'],
    ['Из каких материалов сделаны изделия?', 'Состав указан в карточке каждого товара. Если нужна дополнительная информация, позвоните нам по номеру +7 (901) 826-77-81.']
  ];
  const faqInsert = db.prepare('INSERT INTO faq_items(question, answer, sort_order) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM faq_items WHERE question = ?)');
  faq.forEach(([q, a], index) => faqInsert.run(q, a, index, q));

  const postInsert = db.prepare('INSERT OR IGNORE INTO blog_posts(slug, title, cover, content_md) VALUES (?, ?, ?, ?)');
  postInsert.run('uhod-za-tekstilem', 'Как сохранить мягкость домашнего текстиля', '/img/cat-family.jpg',
    'Нежные ткани любят бережный уход. Перед стиркой проверьте рекомендации на ярлыке, сортируйте вещи по цвету и не перегружайте барабан.\\n\\nИспользуйте мягкое средство и деликатный отжим. Так фактура и цвет дольше останутся красивыми.');
  postInsert.run('kak-vybrat-pled', 'Как выбрать плед для дома и в подарок', '/img/hero-day.jpg',
    'Начните с места, где будет жить плед: для кресла подойдёт компактный размер, а для дивана — модель побольше.\\n\\nВыбирайте оттенок, который поддерживает настроение комнаты, и сверяйтесь с материалом и рекомендациями по уходу в карточке товара.');

  const pages = [
    ['about', 'О нас', 'Family Soft — домашний текстиль ручной работы, созданный с нежностью и заботой. Мы выбираем уютные фактуры и спокойные цвета для дома.'],
    ['contacts', 'Контакты', 'Позвоните нам: +7 (901) 826-77-81. По вопросам заказа напишите через форму обратной связи или на email, указанный владельцем магазина.'],
    ['safe-shopping', 'Безопасные покупки', 'Оплачивайте заказ только по реквизитам на странице вашего заказа. Мы никогда не просим коды из SMS и писем, данные карт и оплату вне сайта. Телефон магазина: +7 (901) 826-77-81.'],
    ['delivery', 'Доставка и оплата', 'Доступны доставка по адресу и самовывоз. Способ и стоимость доставки выберите при оформлении. На данный момент используется ручная оплата через СБП.'],
    ['privacy', 'Политика конфиденциальности', 'Данные, которые вы указываете, используются для оформления и сопровождения заказа, обратной связи и защиты покупок. Для запроса на удаление данных свяжитесь с магазином по телефону +7 (901) 826-77-81.'],
    ['offer', 'Публичная оферта', 'Заказ оформляется на сайте Family Soft. Договор считается заключённым после подтверждения заказа продавцом. Условия оплаты, доставки и возврата сообщаются покупателю на сайте и при оформлении заказа.']
  ];
  const pageInsert = db.prepare('INSERT OR IGNORE INTO pages(slug, title, content) VALUES (?, ?, ?)');
  pages.forEach(page => pageInsert.run(...page));
  db.prepare(`UPDATE pages SET content = ?
    WHERE slug = 'privacy' AND content = ?`).run(
    'Контактные данные используются для оформления и сопровождения заказа. По email можно войти в личный кабинет одноразовым кодом, посмотреть историю своих заказов и платежей, оставить отзыв о купленном товаре или запросить возврат. Для запроса на удаление данных или вопросов об их обработке свяжитесь с магазином по телефону +7 (901) 826-77-81. Перед публикацией владелец магазина должен проверить и дополнить эту страницу в соответствии с фактической обработкой данных.',
    'Данные, которые вы указываете, используются для оформления и сопровождения заказа, обратной связи и защиты покупок. Для запроса на удаление данных свяжитесь с магазином по телефону +7 (901) 826-77-81.'
  );

  const settings = [
    ['owner_phone_display', '+7 (901) 826-77-81'],
    ['delivery_price', '450'],
    ['free_delivery_threshold', '10000'],
    ['gift_wrap_price', '350'],
    ['pickup_address', 'Адрес самовывоза уточняется после оформления заказа.'],
    ['risk_threshold', '70']
  ];
  settings.forEach(([key, value]) => setSetting(key, value));
  db.prepare(`INSERT OR IGNORE INTO promo_codes(code, type, value, active) VALUES ('WELCOME10', 'percent', 10, 0)`).run();
});

seed();

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('База данных Family Soft подготовлена.');
  db.close();
}
