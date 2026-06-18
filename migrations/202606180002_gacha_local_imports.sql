CREATE TABLE IF NOT EXISTS gacha_local_imports (
  user_id INTEGER PRIMARY KEY NOT NULL,
  fingerprint TEXT NOT NULL,
  imported_items INTEGER NOT NULL DEFAULT 0,
  imported_coins INTEGER NOT NULL DEFAULT 0,
  imported_codes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gacha_local_imports_created
  ON gacha_local_imports (created_at DESC);
