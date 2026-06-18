import sqlite3 from 'sqlite3';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';

// 防止开发环境下热更新导致数据库连接被多次实例化锁死
const globalForDb = global as unknown as { __db?: sqlite3.Database };

const configuredDbPath = (process.env.DATABASE_PATH || 'data/codes.db').trim();
const dbPath = path.isAbsolute(configuredDbPath)
  ? configuredDbPath
  : path.resolve(/*turbopackIgnore: true*/ process.cwd(), configuredDbPath);
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(/*turbopackIgnore: true*/ dbDir)) {
  fs.mkdirSync(/*turbopackIgnore: true*/ dbDir, { recursive: true });
}

export const db = globalForDb.__db ?? new sqlite3.Database(dbPath);
export const databasePath = dbPath;
export const databaseDir = dbDir;

if (process.env.NODE_ENV !== 'production') globalForDb.__db = db;

const rawRun = <T = sqlite3.RunResult>(query: string, params: unknown[] = []): Promise<T> => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) reject(err);
      else resolve(this as T);
    });
  });
};

const rawGet = <T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T | undefined> => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err); else resolve(row as T | undefined);
    });
  });
};

const rawAll = <T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err); else resolve(rows as T[]);
    });
  });
};

const rawExec = (query: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    db.exec(query, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

type MigrationRow = { id: string };
type TableInfoRow = { name: string };

export const MIGRATION_FILES = [
  '202606160001_core_schema.sql',
  '202606160002_sessions_rate_limits.sql',
  '202606160003_bilibili_proxy_config.sql',
  '202606180001_gacha_server_state.sql',
] as const;

export const EXPECTED_MIGRATION_IDS = MIGRATION_FILES.map((file) => file.replace(/\.sql$/, ''));

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await rawAll<TableInfoRow>(`PRAGMA table_info(${table})`);
  return rows.some((row) => row.name === column);
}

async function ensureColumn(
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  if (await columnExists(table, column)) return;
  await rawRun(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

async function runLegacyColumnBackfill(migrationId: string): Promise<void> {
  if (migrationId === '202606160001_core_schema') {
    await ensureColumn('site_config', 'version', 'version INTEGER NOT NULL DEFAULT 1');
    await ensureColumn('site_config', 'updated_by', 'updated_by TEXT');
    await ensureColumn('mail_messages', 'is_flagged', 'is_flagged INTEGER NOT NULL DEFAULT 0');
    await ensureColumn('mail_messages', 'topic_id', "topic_id TEXT NOT NULL DEFAULT 'default'");
  }
  if (migrationId === '202606180001_gacha_server_state') {
    await ensureColumn('gift_codes', 'owner_user_id', 'owner_user_id INTEGER');
    await ensureColumn('gift_codes', 'claimed_by_user_id', 'claimed_by_user_id INTEGER');
    await ensureColumn('gift_codes', 'claimed_at', 'claimed_at TEXT');
    await ensureColumn('gift_codes', 'expires_at', 'expires_at TEXT');
    await ensureColumn('gift_codes', 'source', "source TEXT NOT NULL DEFAULT 'legacy'");
    await ensureColumn('gift_codes', 'updated_at', 'updated_at TEXT');
    await rawRun(
      `CREATE INDEX IF NOT EXISTS idx_gift_codes_owner_created
         ON gift_codes (owner_user_id, created_at DESC)`,
    );
    await rawRun(
      `CREATE INDEX IF NOT EXISTS idx_gift_codes_claimed_by
         ON gift_codes (claimed_by_user_id)`,
    );
  }
}

async function bootstrapDefaultTopic(): Promise<void> {
  const existing = await rawGet<{ id: string }>(
    `SELECT id FROM mail_topics WHERE id = 'default'`,
  );
  if (existing) return;

  const row = await rawGet<{ value: string }>(
    `SELECT value FROM mail_settings WHERE key = ?`,
    ['mail.enabled'],
  );
  const initialEnabled =
    row && (row.value === '1' || row.value === 'true') ? 1 :
    row && (row.value === '0' || row.value === 'false') ? 0 :
    1;

  const now = new Date().toISOString();
  await rawRun(
    `INSERT OR IGNORE INTO mail_topics
       (id, slug, title, description, note, is_default, is_enabled,
        starts_at, ends_at, archived_at, sort_order, created_at, updated_at)
     VALUES ('default', 'default', '常规信箱', NULL, NULL, 1, ?,
             NULL, NULL, NULL, 0, ?, ?)`,
    [initialEnabled, now, now],
  );
  console.info(
    `[mail_topics] default topic bootstrapped, migrated is_enabled=${initialEnabled} from mail_settings.mail.enabled`,
  );
}

async function applyDbMigrations(): Promise<void> {
  await rawRun('PRAGMA foreign_keys = ON');
  await rawRun('PRAGMA journal_mode = WAL').catch(() => {});
  await rawRun('PRAGMA busy_timeout = 5000').catch(() => {});
  await rawRun(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const migrationsDir = path.join(/*turbopackIgnore: true*/ process.cwd(), 'migrations');
  const applied = new Set(
    (await rawAll<MigrationRow>('SELECT id FROM schema_migrations')).map((row) => row.id),
  );

  for (const file of MIGRATION_FILES) {
    const id = file.replace(/\.sql$/, '');
    if (applied.has(id)) continue;
    const sql = fs.readFileSync(/*turbopackIgnore: true*/ path.join(migrationsDir, file), 'utf8');
    await rawRun('BEGIN IMMEDIATE TRANSACTION');
    try {
      await rawExec(sql);
      await runLegacyColumnBackfill(id);
      await rawRun(
        'INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)',
        [id, new Date().toISOString()],
      );
      await rawRun('COMMIT');
    } catch (error) {
      await rawRun('ROLLBACK').catch(() => {});
      throw error;
    }
  }

  await bootstrapDefaultTopic();
}

export const dbReady = applyDbMigrations().catch((error) => {
  console.error('[db] migration failed:', error);
  throw error;
});

// 封装 Promise 版本的常用方法，替代原先的回调地狱
export const get = async <T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T | undefined> => {
  await dbReady;
  return rawGet<T>(query, params);
};

export const all = async <T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T[]> => {
  await dbReady;
  return rawAll<T>(query, params);
};

export const run = async <T = sqlite3.RunResult>(
  query: string,
  params: unknown[] = [],
): Promise<T> => {
  await dbReady;
  return rawRun<T>(query, params);
};

export const getConfig = async (key: string) => {
  const row = await get<{ value: string }>(
    "SELECT value FROM global_config WHERE key = ?",
    [key],
  );
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
  const row = await get<{ value: string }>(
    'SELECT value FROM mail_settings WHERE key = ?',
    [key],
  );
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
  const row = await get<{ value: string }>(
    'SELECT value FROM mail_settings WHERE key = ?',
    [MAIL_BLOCKED_TERMS_KEY],
  );
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
