import sqlite3 from 'sqlite3';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { windChimeSchemaReady } from './windchime-storage';

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
  '202606180002_gacha_local_imports.sql',
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

async function applyDbMigrations(): Promise<void> {
  await windChimeSchemaReady;
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

export { getWindChimeClientIp as getClientIp } from '@windchime/embed/server';
