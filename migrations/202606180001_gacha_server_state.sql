CREATE TABLE IF NOT EXISTS gacha_profiles (
  user_id INTEGER PRIMARY KEY NOT NULL,
  coins INTEGER NOT NULL DEFAULT 5,
  pity_count INTEGER NOT NULL DEFAULT 0,
  last_daily_claim TEXT,
  migrated_from_legacy_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gacha_inventory (
  user_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, item_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gacha_inventory_user
  ON gacha_inventory (user_id);

CREATE TABLE IF NOT EXISTS gacha_transactions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  item_id INTEGER,
  quantity INTEGER NOT NULL DEFAULT 0,
  coins_delta INTEGER NOT NULL DEFAULT 0,
  code TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gacha_transactions_user_created
  ON gacha_transactions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gacha_transactions_code
  ON gacha_transactions (code);

CREATE INDEX IF NOT EXISTS idx_gift_codes_status
  ON gift_codes (status);
