CREATE TABLE IF NOT EXISTS gift_codes (
  code TEXT PRIMARY KEY,
  item_id INTEGER,
  status TEXT DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS global_config (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO global_config (key, value) VALUES ('pityCount', '0');

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password_hash TEXT,
  salt TEXT,
  token TEXT,
  gacha_data TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS site_config (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS site_config_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_version INTEGER NOT NULL UNIQUE,
  snapshot_updated_at TEXT,
  snapshot_updated_by TEXT,
  backed_up_at TEXT NOT NULL,
  site_config_value TEXT NOT NULL,
  songs_value TEXT NOT NULL,
  hidden_songs_value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_site_config_history_backed_up_at
  ON site_config_history (backed_up_at DESC);

CREATE TABLE IF NOT EXISTS songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  artist TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hidden_songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mail_messages (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  text TEXT NOT NULL,
  nickname TEXT,
  link_url TEXT,
  deleted_at TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  is_favorited INTEGER NOT NULL DEFAULT 0,
  is_flagged INTEGER NOT NULL DEFAULT 0,
  sender_hash TEXT,
  sender_label TEXT,
  topic_id TEXT NOT NULL DEFAULT 'default'
);

CREATE INDEX IF NOT EXISTS idx_mail_messages_created_at
  ON mail_messages (created_at);

CREATE INDEX IF NOT EXISTS idx_mail_messages_topic_created
  ON mail_messages (topic_id, deleted_at, created_at);

CREATE INDEX IF NOT EXISTS idx_mail_messages_topic_unread
  ON mail_messages (topic_id, is_read) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS mail_blocklist (
  hash TEXT PRIMARY KEY NOT NULL,
  label TEXT,
  blocked_at TEXT NOT NULL,
  sample_text TEXT
);

CREATE TABLE IF NOT EXISTS mail_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_topics (
  id          TEXT PRIMARY KEY NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  note        TEXT,
  is_default  INTEGER NOT NULL DEFAULT 0,
  is_enabled  INTEGER NOT NULL DEFAULT 1,
  starts_at   TEXT,
  ends_at     TEXT,
  archived_at TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_topics_one_default
  ON mail_topics (is_default) WHERE is_default = 1;
