CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  material TEXT NOT NULL,
  dimensions TEXT NOT NULL,
  care TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  images TEXT NOT NULL DEFAULT '[]',
  variants TEXT NOT NULL DEFAULT '[]',
  in_stock INTEGER NOT NULL DEFAULT 1,
  stock_qty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_token TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  delivery_type TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  items TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  delivery_price INTEGER NOT NULL,
  total INTEGER NOT NULL,
  pay_amount_unique INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  payment_method TEXT NOT NULL DEFAULT 'manual',
  idempotence_key TEXT NOT NULL UNIQUE,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS orders_pending_sbp_amount_idx
  ON orders(pay_amount_unique) WHERE payment_status = 'pending';

CREATE TABLE IF NOT EXISTS max_chat_orders (
  order_id INTEGER PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS max_chat_orders_user_idx ON max_chat_orders(user_id, order_id);

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

CREATE TABLE IF NOT EXISTS max_chat_custom_requests (
  request_id INTEGER PRIMARY KEY REFERENCES custom_requests(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS max_chat_custom_requests_user_idx ON max_chat_custom_requests(user_id, request_id);

CREATE TABLE IF NOT EXISTS chat_states (
  user_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER REFERENCES orders(id),
  event TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS faq_items (
  id INTEGER PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_key TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'processing',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
