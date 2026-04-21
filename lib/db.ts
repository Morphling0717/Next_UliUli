import sqlite3 from 'sqlite3';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';

// 防止开发环境下热更新导致数据库连接被多次实例化锁死
const globalForDb = global as unknown as { __db?: sqlite3.Database };

const configuredDbPath = (process.env.DATABASE_PATH || 'codes.db').trim();
const dbPath = path.isAbsolute(configuredDbPath)
  ? configuredDbPath
  : path.resolve(/* turbopackIgnore: true */ process.cwd(), configuredDbPath);
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = globalForDb.__db ?? new sqlite3.Database(dbPath);

if (process.env.NODE_ENV !== 'production') globalForDb.__db = db;

// 初始化表结构
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS gift_codes (
      code TEXT PRIMARY KEY,
      item_id INTEGER,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS global_config (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  db.run(`INSERT OR IGNORE INTO global_config (key, value) VALUES ('pityCount', '0')`);
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password_hash TEXT,
      salt TEXT,
      token TEXT,
      gacha_data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ===== SITE CONFIG TABLE =====
  db.run(`
    CREATE TABLE IF NOT EXISTS site_config (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ===== SONGS TABLE =====
  db.run(`
    CREATE TABLE IF NOT EXISTS songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      artist TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ===== HIDDEN SONGS TABLE =====
  db.run(`
    CREATE TABLE IF NOT EXISTS hidden_songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ===== MAIL TABLES（发信箱） =====
  db.run(`
    CREATE TABLE IF NOT EXISTS mail_messages (
      id TEXT PRIMARY KEY NOT NULL,
      created_at TEXT NOT NULL,
      text TEXT NOT NULL,
      nickname TEXT,
      link_url TEXT,
      deleted_at TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      is_favorited INTEGER NOT NULL DEFAULT 0,
      is_replied INTEGER NOT NULL DEFAULT 0,
      is_flagged INTEGER NOT NULL DEFAULT 0,
      reply_text TEXT,
      sender_hash TEXT,
      sender_label TEXT
    )
  `);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_mail_messages_created_at ON mail_messages (created_at)`
  );
  db.run(
    `ALTER TABLE mail_messages ADD COLUMN is_flagged INTEGER NOT NULL DEFAULT 0`,
    (err) => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.warn('[mail_messages] ADD COLUMN is_flagged:', err.message);
      }
    },
  );
  db.run(`
    CREATE TABLE IF NOT EXISTS mail_blocklist (
      hash TEXT PRIMARY KEY NOT NULL,
      label TEXT,
      blocked_at TEXT NOT NULL,
      sample_text TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS mail_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
});

// 封装 Promise 版本的常用方法，替代原先的回调地狱
export const get = (query: string, params: any[] = []): Promise<any> => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err); else resolve(row);
    });
  });
};

export const all = (query: string, params: any[] = []): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err); else resolve(rows);
    });
  });
};

export const run = (query: string, params: any[] = []): Promise<any> => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) reject(err); else resolve(this);
    });
  });
};

export const getConfig = async (key: string) => {
  const row = await get("SELECT value FROM global_config WHERE key = ?", [key]);
  return row ? row.value : null;
};

export const setConfig = async (key: string, value: string | number) => {
  await run("UPDATE global_config SET value = ? WHERE key = ?", [String(value), key]);
};

export const hashPassword = (password: string, salt: string) => {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
};

// ==============================================================
// Mail（发信箱）专用 helpers
// ==============================================================

/**
 * 从请求头中提取客户端 IP，尽量防 `X-Forwarded-For` 伪造。
 *
 * XFF 是链式追加：`原始客户端, 代理1, 代理2`。**最右**一段由离服务器最近
 * 的反向代理写入，客户端无法伪造；最左一段最容易被攻击者随意填。
 * 所以我们改成读 XFF 最右一段，并优先使用平台提供的专用 header。
 *
 * 优先顺序：
 *   1. `CF-Connecting-IP`（Cloudflare 前置时自动注入）
 *   2. `X-Real-IP`（Vercel / Nginx 常见）
 *   3. `X-Forwarded-For` 最右一段
 *   4. `0.0.0.0`（fallback，让限流能继续工作）
 */
export function getClientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip');
  if (cf) {
    const v = cf.trim();
    if (v) return v;
  }
  const real = req.headers.get('x-real-ip');
  if (real) {
    const v = real.trim();
    if (v) return v;
  }
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return '0.0.0.0';
}

/**
 * 根据 IP / UA / 客户端指纹生成稳定的发送者 hash + 短标签。
 * salt 来自 `WINDCHIME_HASH_SALT`（向后兼容 KAKIMU），fallback 为固定值。
 */
export function computeMailSenderIdentity(
  req: Request,
  fingerprint: string | null | undefined,
): { hash: string; label: string } {
  const ip = getClientIp(req);
  const ua = req.headers.get('user-agent') ?? '';
  const fp = (fingerprint ?? '').trim();
  const salt = process.env.WINDCHIME_HASH_SALT ?? 'uliuli-mail-default-salt';
  const raw = `${ip}\n${ua}\n${fp}\n${salt}`;
  const full = crypto.createHash('sha256').update(raw).digest('hex');
  const label = `User-${full.slice(0, 4).toUpperCase()}`;
  return { hash: full, label };
}

/** 标准 setting key */
export const MAIL_ENABLED_KEY = 'mail.enabled';

/** 读取布尔型 mail setting，默认 true */
export async function getMailBoolSetting(
  key: string,
  defaultValue = true,
): Promise<boolean> {
  const row = await get('SELECT value FROM mail_settings WHERE key = ?', [key]);
  if (!row) return defaultValue;
  return row.value === '1' || row.value === 'true';
}

/** 写入布尔型 mail setting */
export async function setMailBoolSetting(
  key: string,
  value: boolean,
): Promise<void> {
  await run(
    `INSERT INTO mail_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
    [key, value ? '1' : '0', new Date().toISOString()],
  );
}

// --------------------------------------------------------------
// 敏感词（发信箱）
// --------------------------------------------------------------

/** 敏感词在 mail_settings 表中的 key */
export const MAIL_BLOCKED_TERMS_KEY = 'mail.blocked_terms';

/**
 * 读取敏感词列表。
 * 优先读 DB；DB 未写过时从 env `MAIL_BLOCKED_TERMS` 读取作为初始值。
 * 返回值已做 trim + 小写 + 去重。
 */
export async function getMailBlockedTerms(): Promise<string[]> {
  const row = await get('SELECT value FROM mail_settings WHERE key = ?', [
    MAIL_BLOCKED_TERMS_KEY,
  ]);
  let raw = '';
  if (row && typeof row.value === 'string') {
    try {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed)) {
        raw = parsed.filter((s) => typeof s === 'string').join(',');
      }
    } catch {
      raw = row.value;
    }
  } else {
    raw = process.env.MAIL_BLOCKED_TERMS ?? '';
  }

  const list = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(list));
}

/** 覆盖写入敏感词列表（会做归一化） */
export async function setMailBlockedTerms(terms: string[]): Promise<string[]> {
  const normalized = Array.from(
    new Set(
      terms
        .map((s) => (typeof s === 'string' ? s.trim().toLowerCase() : ''))
        .filter(Boolean),
    ),
  );
  await run(
    `INSERT INTO mail_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
    [MAIL_BLOCKED_TERMS_KEY, JSON.stringify(normalized), new Date().toISOString()],
  );
  return normalized;
}

/**
 * 检查给定文本字段里是否含有敏感词；命中则返回命中的词，否则 null。
 * 所有字段会做拼接 + 小写化后用 indexOf 子串匹配。
 */
export function matchBlockedTerm(
  terms: string[],
  ...fields: Array<string | null | undefined>
): string | null {
  if (terms.length === 0) return null;
  const joined = fields
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join('\n')
    .toLowerCase();
  if (!joined) return null;
  for (const t of terms) {
    if (joined.includes(t)) return t;
  }
  return null;
}