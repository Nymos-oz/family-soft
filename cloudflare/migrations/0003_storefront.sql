CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  image TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO categories (id, name, slug, image, sort_order) VALUES
  (1, 'Семейные комплекты', 'family-sets', '/img/cat-family.jpg', 0),
  (2, 'Детские комплекты', 'kids-sets', '/img/cat-kids.jpg', 1),
  (3, 'Пледы', 'plaids', '/img/hero-day.jpg', 2),
  (4, 'Одеяла', 'blankets', '/img/cat-blankets.jpg', 3),
  (5, 'Подушки-думки', 'pillows', '/img/cat-pillows.jpg', 4),
  (6, 'Детский текстиль', 'kids-textile', '/img/cat-baby.jpg', 5),
  (7, 'Кухонные полотенца', 'kitchen-towels', '/img/cat-towels.jpg', 6),
  (8, 'Шопперы', 'shoppers', '/img/cat-shoppers.jpg', 7),
  (9, 'Шарфы', 'scarves', '/img/cat-scarves.jpg', 8),
  (10, 'Приятные мелочи', 'small-things', '', 9),
  (11, 'Работа на заказ', 'custom', '/img/label.jpg', 10);

ALTER TABLE products ADD COLUMN category_id INTEGER NOT NULL DEFAULT 10;
ALTER TABLE products ADD COLUMN created_at TEXT;

UPDATE products SET category_id = CASE id
  WHEN 1 THEN 1 WHEN 2 THEN 1
  WHEN 3 THEN 2 WHEN 4 THEN 2
  WHEN 5 THEN 3 WHEN 6 THEN 3
  WHEN 7 THEN 4 WHEN 8 THEN 4
  WHEN 9 THEN 5 WHEN 10 THEN 6
  WHEN 11 THEN 7 WHEN 12 THEN 8
  WHEN 13 THEN 9 ELSE 10 END,
  created_at = COALESCE(created_at, CURRENT_TIMESTAMP);

ALTER TABLE orders ADD COLUMN comment TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN gift_wrap INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN gift_card_text TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN discount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN promo_code TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS promo_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK(type IN ('percent', 'fixed')),
  value INTEGER NOT NULL,
  min_total INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  usage_limit INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pages (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL
);

INSERT OR IGNORE INTO pages (slug, title, content) VALUES
  ('about', 'О нас', 'Family Soft — домашний текстиль ручной работы, созданный с нежностью и заботой. Мы выбираем уютные фактуры и спокойные цвета для дома.'),
  ('contacts', 'Контакты', 'Позвоните нам: +7 (901) 826-77-81. По вопросам заказа напишите через форму обратной связи или на email, указанный владельцем магазина.'),
  ('safe-shopping', 'Безопасные покупки', 'Оплачивайте заказ только по реквизитам на странице вашего заказа. Мы никогда не просим коды из SMS и писем, данные карт и оплату вне сайта. Телефон магазина: +7 (901) 826-77-81.'),
  ('delivery', 'Доставка и оплата', 'Доступны доставка по адресу и самовывоз. Способ и стоимость доставки выберите при оформлении. На данный момент используется ручная оплата через СБП.'),
  ('privacy', 'Политика конфиденциальности', 'Контактные данные используются для оформления и сопровождения заказа. По email можно войти в личный кабинет одноразовым кодом, посмотреть историю своих заказов и платежей, оставить отзыв о купленном товаре или запросить возврат. Для запроса на удаление данных или вопросов об их обработке свяжитесь с магазином по телефону +7 (901) 826-77-81. Перед публикацией владелец магазина должен проверить и дополнить эту страницу в соответствии с фактической обработкой данных.'),
  ('offer', 'Публичная оферта', 'Заказ оформляется на сайте Family Soft. Договор считается заключённым после подтверждения заказа продавцом. Условия оплаты, доставки и возврата сообщаются покупателю на сайте и при оформлении заказа.');

CREATE TABLE IF NOT EXISTS blog_posts (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  cover TEXT NOT NULL DEFAULT '',
  content_md TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO blog_posts (id, slug, title, cover, content_md, published, created_at) VALUES
  (1, 'uhod-za-tekstilem', 'Как сохранить мягкость домашнего текстиля', '/img/cat-family.jpg',
   'Нежные ткани любят бережный уход. Перед стиркой проверьте рекомендации на ярлыке, сортируйте вещи по цвету и не перегружайте барабан.\n\nИспользуйте мягкое средство и деликатный отжим. Так фактура и цвет дольше останутся красивыми.', 1, '2026-09-30 07:55:52'),
  (2, 'kak-vybrat-pled', 'Как выбрать плед для дома и в подарок', '/img/hero-day.jpg',
   'Начните с места, где будет жить плед: для кресла подойдёт компактный размер, а для дивана — модель побольше.\n\nВыбирайте оттенок, который поддерживает настроение комнаты, и сверяйтесь с материалом и рекомендациями по уходу в карточке товара.', 1, '2026-09-30 07:55:52');

CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
