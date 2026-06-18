/* eslint-disable @typescript-eslint/no-require-imports */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3');

const projectRoot = path.resolve(__dirname, '..');
const configuredDbPath = (process.env.DATABASE_PATH || 'data/codes.db').trim();
const dbPath = path.isAbsolute(configuredDbPath)
  ? configuredDbPath
  : path.resolve(projectRoot, configuredDbPath);

if (!fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

const db = new sqlite3.Database(dbPath);
const TOTAL_ITEMS = 136;
const INITIAL_COINS = 5;
const MAX_IMPORTED_COINS = 1_000_000;

function run(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
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

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeItemId(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > TOTAL_ITEMS) return null;
  return parsed;
}

function normalizeCoins(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return INITIAL_COINS;
  return Math.min(MAX_IMPORTED_COINS, Math.max(0, Math.floor(parsed)));
}

function normalizeDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function normalizeCode(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return /^GIFT-[A-Z0-9-]{4,40}$/.test(normalized) ? normalized : null;
}

function parseLegacy(raw) {
  const parsed = parseJsonObject(raw);
  const inventory = new Map();
  const collection = Array.isArray(parsed.collection) ? parsed.collection : [];

  for (const value of collection) {
    const itemId = normalizeItemId(value);
    if (!itemId) continue;
    inventory.set(itemId, (inventory.get(itemId) || 0) + 1);
  }

  const history = Array.isArray(parsed.history)
    ? parsed.history
        .filter(isRecord)
        .map((item) => {
          const code = normalizeCode(item.code);
          const itemId = normalizeItemId(item.itemId);
          if (!code || !itemId) return null;
          return {
            code,
            itemId,
            status: item.status === 'used' ? 'used' : 'active',
            createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
          };
        })
        .filter(Boolean)
    : [];

  return {
    coins: normalizeCoins(parsed.coins),
    lastDailyClaim: normalizeDate(parsed.lastLogin) || normalizeDate(parsed.lastDailyClaim),
    inventory,
    history,
    hasData: inventory.size > 0 || history.length > 0 || Number.isFinite(Number(parsed.coins)),
  };
}

async function insertTransaction({ userId, quantity, coins, historyCount, hasData, now }) {
  await run(
    `INSERT INTO gacha_transactions
       (id, user_id, type, item_id, quantity, coins_delta, code, metadata, created_at)
     VALUES (?, ?, 'legacy_migration', NULL, ?, ?, NULL, ?, ?)`,
    [
      crypto.randomUUID(),
      userId,
      quantity,
      coins,
      JSON.stringify({ legacyHistoryCount: historyCount, legacyHadData: hasData }),
      now,
    ],
  );
}

async function migrateUser(user) {
  const existing = await get(
    `SELECT migrated_from_legacy_at, coins
       FROM gacha_profiles
      WHERE user_id = ?`,
    [user.id],
  );
  if (existing && existing.migrated_from_legacy_at) {
    return { migrated: false, reason: 'already_migrated' };
  }

  const legacy = parseLegacy(user.gacha_data);
  const now = new Date().toISOString();
  const coins = existing ? Math.max(Number(existing.coins) || 0, legacy.coins) : legacy.coins;

  await run('BEGIN IMMEDIATE TRANSACTION');
  try {
    await run(
      `INSERT INTO gacha_profiles
         (user_id, coins, pity_count, last_daily_claim, migrated_from_legacy_at, created_at, updated_at)
       VALUES (?, ?, 0, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         coins = excluded.coins,
         last_daily_claim = COALESCE(gacha_profiles.last_daily_claim, excluded.last_daily_claim),
         migrated_from_legacy_at = excluded.migrated_from_legacy_at,
         updated_at = excluded.updated_at`,
      [user.id, coins, legacy.lastDailyClaim, now, now, now],
    );

    let importedItems = 0;
    for (const [itemId, quantity] of legacy.inventory.entries()) {
      importedItems += quantity;
      await run(
        `INSERT INTO gacha_inventory (user_id, item_id, quantity, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, item_id) DO UPDATE SET
           quantity = gacha_inventory.quantity + excluded.quantity,
           updated_at = excluded.updated_at`,
        [user.id, itemId, quantity, now],
      );
    }

    for (const item of legacy.history) {
      await run(
        `INSERT OR IGNORE INTO gift_codes
           (code, item_id, status, created_at, owner_user_id, source, updated_at)
         VALUES (?, ?, ?, ?, ?, 'legacy_import', ?)`,
        [item.code, item.itemId, item.status, item.createdAt, user.id, now],
      );
      await run(
        `UPDATE gift_codes
            SET owner_user_id = COALESCE(owner_user_id, ?),
                updated_at = ?
          WHERE code = ?`,
        [user.id, now, item.code],
      );
    }

    await insertTransaction({
      userId: user.id,
      quantity: importedItems,
      coins,
      historyCount: legacy.history.length,
      hasData: legacy.hasData,
      now,
    });

    await run('COMMIT');
    return {
      migrated: true,
      importedItems,
      importedCodes: legacy.history.length,
      coins,
    };
  } catch (error) {
    await run('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function main() {
  await run('PRAGMA foreign_keys = ON');
  await run('PRAGMA busy_timeout = 5000').catch(() => {});

  const users = await all('SELECT id, username, gacha_data FROM users ORDER BY id ASC');
  let migrated = 0;
  let skipped = 0;
  let importedItems = 0;
  let importedCodes = 0;

  for (const user of users) {
    const result = await migrateUser(user);
    if (!result.migrated) {
      skipped += 1;
      console.log(`- ${user.username}: skipped (${result.reason})`);
      continue;
    }
    migrated += 1;
    importedItems += result.importedItems;
    importedCodes += result.importedCodes;
    console.log(
      `+ ${user.username}: ${result.importedItems} items, ${result.importedCodes} codes, ${result.coins} coins`,
    );
  }

  console.log(`\nGacha data migrated: ${dbPath}`);
  console.log(`Users: ${users.length}, migrated: ${migrated}, skipped: ${skipped}`);
  console.log(`Imported items: ${importedItems}, imported codes: ${importedCodes}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close();
  });
