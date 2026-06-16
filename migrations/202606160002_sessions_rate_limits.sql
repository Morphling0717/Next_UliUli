CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_scope_expires
  ON admin_sessions (scope, expires_at);

CREATE TABLE IF NOT EXISTS rate_limit_hits (
  scope_key TEXT NOT NULL,
  hit_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_key_time
  ON rate_limit_hits (scope_key, hit_at);

CREATE TABLE IF NOT EXISTS login_failures (
  ip TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL,
  first_fail_at INTEGER NOT NULL,
  locked_until INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_failures_locked_until
  ON login_failures (locked_until);
