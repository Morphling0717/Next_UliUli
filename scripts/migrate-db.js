/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3');

const projectRoot = path.resolve(__dirname, '..');
const configuredDbPath = (process.env.DATABASE_PATH || 'data/codes.db').trim();
const dbPath = path.isAbsolute(configuredDbPath)
  ? configuredDbPath
  : path.resolve(projectRoot, configuredDbPath);
const dbDir = path.dirname(dbPath);
const migrationsDir = path.resolve(projectRoot, 'migrations');

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

function run(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function all(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function exec(query) {
  return new Promise((resolve, reject) => {
    db.exec(query, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function columnExists(table, column) {
  const rows = await all(`PRAGMA table_info(${table})`);
  return rows.some((row) => row.name === column);
}

async function ensureColumn(table, column, definition) {
  if (await columnExists(table, column)) return;
  await run(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

async function runLegacyColumnBackfill(migrationId) {
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
    await run(
      `CREATE INDEX IF NOT EXISTS idx_gift_codes_owner_created
         ON gift_codes (owner_user_id, created_at DESC)`,
    );
    await run(
      `CREATE INDEX IF NOT EXISTS idx_gift_codes_claimed_by
         ON gift_codes (claimed_by_user_id)`,
    );
  }
}

async function bootstrapDefaultTopic() {
  const existing = await all(`SELECT id FROM mail_topics WHERE id = 'default' LIMIT 1`);
  if (existing.length > 0) return;

  const rows = await all(`SELECT value FROM mail_settings WHERE key = ? LIMIT 1`, [
    'mail.enabled',
  ]);
  const value = rows[0]?.value;
  const initialEnabled =
    value === '1' || value === 'true' ? 1 :
    value === '0' || value === 'false' ? 0 :
    1;
  const now = new Date().toISOString();
  await run(
    `INSERT OR IGNORE INTO mail_topics
       (id, slug, title, description, note, is_default, is_enabled,
        starts_at, ends_at, archived_at, sort_order, created_at, updated_at)
     VALUES ('default', 'default', '常规信箱', NULL, NULL, 1, ?,
             NULL, NULL, NULL, 0, ?, ?)`,
    [initialEnabled, now, now],
  );
}

async function main() {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  await run('PRAGMA foreign_keys = ON');
  await run('PRAGMA journal_mode = WAL').catch(() => {});
  await run('PRAGMA busy_timeout = 5000').catch(() => {});
  await run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    (await all('SELECT id FROM schema_migrations')).map((row) => row.id),
  );
  const files = fs.readdirSync(migrationsDir)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();

  let appliedCount = 0;
  for (const file of files) {
    const id = file.replace(/\.sql$/, '');
    if (applied.has(id)) {
      console.log(`- ${id} already applied`);
      continue;
    }

    console.log(`+ applying ${id}`);
    await run('BEGIN IMMEDIATE TRANSACTION');
    try {
      await exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
      await runLegacyColumnBackfill(id);
      await run('INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)', [
        id,
        new Date().toISOString(),
      ]);
      await run('COMMIT');
      appliedCount += 1;
    } catch (error) {
      await run('ROLLBACK').catch(() => {});
      throw error;
    }
  }

  await bootstrapDefaultTopic();
  console.log(`\nDatabase migrated: ${dbPath}`);
  console.log(`Applied this run: ${appliedCount}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close();
  });
