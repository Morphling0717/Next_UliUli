import crypto from 'crypto';
import { all, get, getConfig, run } from '@/lib/db';

export const GACHA_TOTAL_ITEMS = 136;
export const GACHA_COIN_COST = 1;
export const GACHA_DAILY_REWARD = 3;
export const GACHA_INITIAL_COINS = 5;
const MAX_IMPORTED_COINS = 1_000_000;

type JsonObject = Record<string, unknown>;

type UserRow = {
  id: number;
  username: string;
  gacha_data: string | null;
};

type ProfileRow = {
  user_id: number;
  coins: number;
  pity_count: number;
  last_daily_claim: string | null;
  migrated_from_legacy_at: string | null;
};

type InventoryRow = {
  item_id: number;
  quantity: number;
};

type GiftCodeRow = {
  code: string;
  item_id: number;
  status: string;
  created_at: string | null;
  owner_user_id: number | null;
  claimed_by_user_id: number | null;
  claimed_at: string | null;
};

export type GachaHistoryItem = {
  code: string;
  itemId: number;
  createdAt: string;
  status: string;
};

export type GachaState = {
  collection: number[];
  coins: number;
  history: GachaHistoryItem[];
  lastDailyClaim: string | null;
  pityCount: number;
  totalItems: number;
  coinCost: number;
  dailyReward: number;
};

export class GachaError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'GachaError';
    this.status = status;
  }
}

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const todayKey = () => new Date().toISOString().slice(0, 10);

const normalizeItemId = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > GACHA_TOTAL_ITEMS) return null;
  return parsed;
};

const normalizeCoins = (value: unknown, fallback = GACHA_INITIAL_COINS): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_IMPORTED_COINS, Math.max(0, Math.floor(parsed)));
};

const normalizeLegacyDate = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
};

const parseJsonObject = (raw: string | null): JsonObject => {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const normalizeCode = (code: unknown): string | null => {
  if (typeof code !== 'string') return null;
  const normalized = code.trim().toUpperCase();
  if (!/^GIFT-[A-Z0-9-]{4,40}$/.test(normalized)) return null;
  return normalized;
};

function parseLegacyGachaData(raw: string | null) {
  const parsed = parseJsonObject(raw);
  const collection = Array.isArray(parsed.collection) ? parsed.collection : [];
  const inventory = new Map<number, number>();

  for (const value of collection) {
    const itemId = normalizeItemId(value);
    if (!itemId) continue;
    inventory.set(itemId, (inventory.get(itemId) ?? 0) + 1);
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
            status: typeof item.status === 'string' ? item.status : 'active',
            createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
          };
        })
        .filter((item): item is GachaHistoryItem => item !== null)
    : [];

  return {
    coins: normalizeCoins(parsed.coins),
    lastDailyClaim: normalizeLegacyDate(parsed.lastLogin) ?? normalizeLegacyDate(parsed.lastDailyClaim),
    inventory,
    history,
    hasData: inventory.size > 0 || history.length > 0 || Number.isFinite(Number(parsed.coins)),
  };
}

function expandInventory(rows: InventoryRow[]): number[] {
  const collection: number[] = [];
  for (const row of rows) {
    const itemId = normalizeItemId(row.item_id);
    const quantity = Math.max(0, Math.floor(Number(row.quantity) || 0));
    if (!itemId || quantity <= 0) continue;
    for (let i = 0; i < quantity; i += 1) collection.push(itemId);
  }
  return collection;
}

function mapHistory(row: GiftCodeRow): GachaHistoryItem {
  return {
    code: row.code,
    itemId: row.item_id,
    createdAt: row.created_at ?? '',
    status: row.status,
  };
}

async function transaction<T>(work: () => Promise<T>): Promise<T> {
  await run('BEGIN IMMEDIATE TRANSACTION');
  try {
    const result = await work();
    await run('COMMIT');
    return result;
  } catch (error) {
    await run('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function ensureProfileInCurrentTx(userId: number, markLegacyMigrated = true): Promise<ProfileRow> {
  const existing = await get<ProfileRow>(
    `SELECT user_id, coins, pity_count, last_daily_claim, migrated_from_legacy_at
       FROM gacha_profiles
      WHERE user_id = ?`,
    [userId],
  );
  if (existing) return existing;

  const now = new Date().toISOString();
  await run(
    `INSERT INTO gacha_profiles
       (user_id, coins, pity_count, last_daily_claim, migrated_from_legacy_at, created_at, updated_at)
     VALUES (?, ?, 0, NULL, ?, ?, ?)`,
    [userId, GACHA_INITIAL_COINS, markLegacyMigrated ? now : null, now, now],
  );

  return {
    user_id: userId,
    coins: GACHA_INITIAL_COINS,
    pity_count: 0,
    last_daily_claim: null,
    migrated_from_legacy_at: markLegacyMigrated ? now : null,
  };
}

async function insertTransaction(params: {
  userId: number;
  type: string;
  itemId?: number | null;
  quantity?: number;
  coinsDelta?: number;
  code?: string | null;
  metadata?: JsonObject;
  createdAt?: string;
}) {
  await run(
    `INSERT INTO gacha_transactions
       (id, user_id, type, item_id, quantity, coins_delta, code, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      params.userId,
      params.type,
      params.itemId ?? null,
      params.quantity ?? 0,
      params.coinsDelta ?? 0,
      params.code ?? null,
      params.metadata ? JSON.stringify(params.metadata) : null,
      params.createdAt ?? new Date().toISOString(),
    ],
  );
}

export async function getGachaUserByToken(token: unknown): Promise<UserRow> {
  if (typeof token !== 'string' || !token.trim()) {
    throw new GachaError('未登录', 401);
  }
  const user = await get<UserRow>(
    'SELECT id, username, gacha_data FROM users WHERE token = ?',
    [token.trim()],
  );
  if (!user) throw new GachaError('登录已过期，请重新登录', 401);
  await migrateLegacyGachaForUser(user.id, user.gacha_data);
  return user;
}

export async function initializeFreshGachaProfile(userId: number) {
  await transaction(async () => {
    const now = new Date().toISOString();
    await run(
      `INSERT INTO gacha_profiles
         (user_id, coins, pity_count, last_daily_claim, migrated_from_legacy_at, created_at, updated_at)
       VALUES (?, ?, 0, NULL, ?, ?, ?)
       ON CONFLICT(user_id) DO NOTHING`,
      [userId, GACHA_INITIAL_COINS, now, now, now],
    );
  });
}

export async function migrateLegacyGachaForUser(userId: number, rawLegacyData: string | null) {
  return transaction(async () => {
    const existing = await get<ProfileRow>(
      `SELECT user_id, coins, pity_count, last_daily_claim, migrated_from_legacy_at
         FROM gacha_profiles
        WHERE user_id = ?`,
      [userId],
    );
    if (existing?.migrated_from_legacy_at) {
      return { migrated: false, reason: 'already_migrated' };
    }

    const legacy = parseLegacyGachaData(rawLegacyData);
    const now = new Date().toISOString();
    const coins = existing ? Math.max(Number(existing.coins) || 0, legacy.coins) : legacy.coins;
    const lastDailyClaim = existing?.last_daily_claim ?? legacy.lastDailyClaim;

    await run(
      `INSERT INTO gacha_profiles
         (user_id, coins, pity_count, last_daily_claim, migrated_from_legacy_at, created_at, updated_at)
       VALUES (?, ?, 0, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         coins = excluded.coins,
         last_daily_claim = COALESCE(gacha_profiles.last_daily_claim, excluded.last_daily_claim),
         migrated_from_legacy_at = excluded.migrated_from_legacy_at,
         updated_at = excluded.updated_at`,
      [userId, coins, lastDailyClaim, now, now, now],
    );

    let importedItems = 0;
    for (const [itemId, quantity] of legacy.inventory.entries()) {
      if (quantity <= 0) continue;
      importedItems += quantity;
      await run(
        `INSERT INTO gacha_inventory (user_id, item_id, quantity, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, item_id) DO UPDATE SET
           quantity = gacha_inventory.quantity + excluded.quantity,
           updated_at = excluded.updated_at`,
        [userId, itemId, quantity, now],
      );
    }

    for (const item of legacy.history) {
      await run(
        `INSERT OR IGNORE INTO gift_codes
           (code, item_id, status, created_at, owner_user_id, source, updated_at)
         VALUES (?, ?, ?, ?, ?, 'legacy_import', ?)`,
        [item.code, item.itemId, item.status === 'used' ? 'used' : 'active', item.createdAt, userId, now],
      );
      await run(
        `UPDATE gift_codes
            SET owner_user_id = COALESCE(owner_user_id, ?),
                updated_at = ?
          WHERE code = ?`,
        [userId, now, item.code],
      );
    }

    await insertTransaction({
      userId,
      type: 'legacy_migration',
      quantity: importedItems,
      coinsDelta: coins,
      metadata: {
        legacyHistoryCount: legacy.history.length,
        legacyHadData: legacy.hasData,
      },
      createdAt: now,
    });

    return {
      migrated: true,
      importedItems,
      importedCodes: legacy.history.length,
      coins,
    };
  });
}

export async function getGachaState(userId: number): Promise<GachaState> {
  await transaction(async () => {
    await ensureProfileInCurrentTx(userId);
  });

  const [profile, inventory, history] = await Promise.all([
    get<ProfileRow>(
      `SELECT user_id, coins, pity_count, last_daily_claim, migrated_from_legacy_at
         FROM gacha_profiles
        WHERE user_id = ?`,
      [userId],
    ),
    all<InventoryRow>(
      `SELECT item_id, quantity
         FROM gacha_inventory
        WHERE user_id = ? AND quantity > 0
        ORDER BY item_id ASC`,
      [userId],
    ),
    all<GiftCodeRow>(
      `SELECT code, item_id, status, created_at, owner_user_id, claimed_by_user_id, claimed_at
         FROM gift_codes
        WHERE owner_user_id = ?
        ORDER BY created_at DESC, code DESC
        LIMIT 200`,
      [userId],
    ),
  ]);

  return {
    collection: expandInventory(inventory),
    coins: Math.max(0, Number(profile?.coins ?? GACHA_INITIAL_COINS)),
    history: history.map(mapHistory),
    lastDailyClaim: profile?.last_daily_claim ?? null,
    pityCount: Math.max(0, Number(profile?.pity_count ?? 0)),
    totalItems: GACHA_TOTAL_ITEMS,
    coinCost: GACHA_COIN_COST,
    dailyReward: GACHA_DAILY_REWARD,
  };
}

export async function claimDailyReward(userId: number) {
  const today = todayKey();
  const result = await transaction(async () => {
    const profile = await ensureProfileInCurrentTx(userId);
    if (profile.last_daily_claim === today) {
      return { claimed: false };
    }

    const now = new Date().toISOString();
    await run(
      `UPDATE gacha_profiles
          SET coins = coins + ?,
              last_daily_claim = ?,
              updated_at = ?
        WHERE user_id = ?`,
      [GACHA_DAILY_REWARD, today, now, userId],
    );
    await insertTransaction({
      userId,
      type: 'daily_reward',
      coinsDelta: GACHA_DAILY_REWARD,
      createdAt: now,
    });
    return { claimed: true };
  });

  return { ...result, state: await getGachaState(userId) };
}

async function readGachaConfig() {
  const fallback = {
    pityThreshold: 8000,
    softPityStart: 5000,
    baseRate: 1 / 10000,
    maxRate: 0.6,
  };
  const raw = await getConfig('site_config');
  const parsed = parseJsonObject(raw);
  const gacha = isRecord(parsed.gacha) ? parsed.gacha : {};
  const finite = (value: unknown, defaultValue: number) => {
    const next = Number(value);
    return Number.isFinite(next) ? next : defaultValue;
  };
  return {
    pityThreshold: Math.max(1, Math.round(finite(gacha.pityThreshold, fallback.pityThreshold))),
    softPityStart: Math.max(0, Math.round(finite(gacha.softPityStart, fallback.softPityStart))),
    baseRate: Math.min(1, Math.max(0, finite(gacha.baseRate, fallback.baseRate))),
    maxRate: Math.min(1, Math.max(0, finite(gacha.maxRate, fallback.maxRate))),
  };
}

function rollGoldenLuck(nextPityCount: number, config: Awaited<ReturnType<typeof readGachaConfig>>) {
  const isPity = nextPityCount >= config.pityThreshold;
  let currentRate = config.baseRate;

  if (nextPityCount > config.softPityStart && nextPityCount < config.pityThreshold) {
    const span = Math.max(1, config.pityThreshold - 1 - config.softPityStart);
    const progress = (nextPityCount - config.softPityStart) / span;
    currentRate = config.baseRate + (config.maxRate - config.baseRate) * progress;
  }

  const triggeredGoldenLuck = isPity || Math.random() < currentRate;
  return { triggeredGoldenLuck, currentRate };
}

export async function spinGacha(userId: number) {
  const config = await readGachaConfig();
  const result = await transaction(async () => {
    const profile = await ensureProfileInCurrentTx(userId);
    if (profile.coins < GACHA_COIN_COST) {
      throw new GachaError(`硬币不足，每日登录可领 ${GACHA_DAILY_REWARD} 枚硬币`, 400);
    }

    const itemId = crypto.randomInt(1, GACHA_TOTAL_ITEMS + 1);
    const nextPityCount = Math.max(0, Number(profile.pity_count) || 0) + 1;
    const { triggeredGoldenLuck, currentRate } = rollGoldenLuck(nextPityCount, config);
    const storedPityCount = triggeredGoldenLuck ? 0 : nextPityCount;
    const now = new Date().toISOString();

    await run(
      `UPDATE gacha_profiles
          SET coins = coins - ?,
              pity_count = ?,
              updated_at = ?
        WHERE user_id = ? AND coins >= ?`,
      [GACHA_COIN_COST, storedPityCount, now, userId, GACHA_COIN_COST],
    );
    await run(
      `INSERT INTO gacha_inventory (user_id, item_id, quantity, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(user_id, item_id) DO UPDATE SET
         quantity = gacha_inventory.quantity + 1,
         updated_at = excluded.updated_at`,
      [userId, itemId, now],
    );
    await insertTransaction({
      userId,
      type: 'spin',
      itemId,
      quantity: 1,
      coinsDelta: -GACHA_COIN_COST,
      metadata: {
        triggeredGoldenLuck,
        pityCountBefore: profile.pity_count,
        pityCountAfter: storedPityCount,
        rate: currentRate,
      },
      createdAt: now,
    });

    return { itemId, triggeredGoldenLuck };
  });

  return { ...result, state: await getGachaState(userId) };
}

async function generateUniqueGiftCode(): Promise<string> {
  for (let i = 0; i < 20; i += 1) {
    const code = `GIFT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const existing = await get<{ code: string }>('SELECT code FROM gift_codes WHERE code = ?', [code]);
    if (!existing) return code;
  }
  throw new GachaError('兑换码生成失败，请稍后再试', 500);
}

export async function packageGachaItem(userId: number, rawItemId: unknown) {
  const itemId = normalizeItemId(rawItemId);
  if (!itemId) throw new GachaError('无效的表情包编号', 400);

  const result = await transaction(async () => {
    await ensureProfileInCurrentTx(userId);
    const inventory = await get<InventoryRow>(
      `SELECT item_id, quantity
         FROM gacha_inventory
        WHERE user_id = ? AND item_id = ?`,
      [userId, itemId],
    );
    if (!inventory || inventory.quantity <= 0) {
      throw new GachaError('库存不足，无法打包这个表情包', 400);
    }

    const now = new Date().toISOString();
    const code = await generateUniqueGiftCode();

    await run(
      `UPDATE gacha_inventory
          SET quantity = quantity - 1,
              updated_at = ?
        WHERE user_id = ? AND item_id = ? AND quantity > 0`,
      [now, userId, itemId],
    );
    await run(
      `DELETE FROM gacha_inventory
        WHERE user_id = ? AND item_id = ? AND quantity <= 0`,
      [userId, itemId],
    );
    await run(
      `INSERT INTO gift_codes
         (code, item_id, status, created_at, owner_user_id, source, updated_at)
       VALUES (?, ?, 'active', ?, ?, 'gacha', ?)`,
      [code, itemId, now, userId, now],
    );
    await insertTransaction({
      userId,
      type: 'package',
      itemId,
      quantity: -1,
      code,
      createdAt: now,
    });

    return { code, itemId };
  });

  return { ...result, state: await getGachaState(userId) };
}

export async function redeemGachaCode(userId: number, rawCode: unknown) {
  const code = normalizeCode(rawCode);
  if (!code) throw new GachaError('请输入有效的兑换码', 400);

  const result = await transaction(async () => {
    await ensureProfileInCurrentTx(userId);
    const row = await get<GiftCodeRow>(
      `SELECT code, item_id, status, created_at, owner_user_id, claimed_by_user_id, claimed_at
         FROM gift_codes
        WHERE code = ?`,
      [code],
    );
    if (!row) throw new GachaError('无效的兑换码', 404);
    if (row.status !== 'active') throw new GachaError('该兑换码已被使用', 400);
    if (row.owner_user_id === userId) throw new GachaError('不能兑换自己打包的兑换码', 400);

    const itemId = normalizeItemId(row.item_id);
    if (!itemId) throw new GachaError('兑换码数据异常，请联系管理员', 500);

    const now = new Date().toISOString();
    await run(
      `UPDATE gift_codes
          SET status = 'used',
              claimed_by_user_id = ?,
              claimed_at = ?,
              updated_at = ?
        WHERE code = ? AND status = 'active'`,
      [userId, now, now, code],
    );
    await run(
      `INSERT INTO gacha_inventory (user_id, item_id, quantity, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(user_id, item_id) DO UPDATE SET
         quantity = gacha_inventory.quantity + 1,
         updated_at = excluded.updated_at`,
      [userId, itemId, now],
    );
    await insertTransaction({
      userId,
      type: 'redeem',
      itemId,
      quantity: 1,
      code,
      createdAt: now,
    });

    return { itemId, code };
  });

  return { ...result, state: await getGachaState(userId) };
}

export async function checkOwnedGachaCodes(userId: number, rawCodes: unknown) {
  if (!Array.isArray(rawCodes) || rawCodes.length === 0) return [];
  const codes = Array.from(
    new Set(rawCodes.map(normalizeCode).filter((code): code is string => Boolean(code))),
  ).slice(0, 100);
  if (codes.length === 0) return [];

  const placeholders = codes.map(() => '?').join(',');
  const rows = await all<GiftCodeRow>(
    `SELECT code, item_id, status, created_at, owner_user_id, claimed_by_user_id, claimed_at
       FROM gift_codes
      WHERE owner_user_id = ? AND code IN (${placeholders})`,
    [userId, ...codes],
  );
  return rows.map(mapHistory);
}

export async function resetGachaState(userId: number) {
  await transaction(async () => {
    await ensureProfileInCurrentTx(userId);
    const now = new Date().toISOString();
    await run('DELETE FROM gacha_inventory WHERE user_id = ?', [userId]);
    await run(
      `UPDATE gift_codes
          SET owner_user_id = NULL,
              updated_at = ?
        WHERE owner_user_id = ?`,
      [now, userId],
    );
    await run(
      `UPDATE gacha_profiles
          SET coins = ?,
              pity_count = 0,
              last_daily_claim = ?,
              updated_at = ?
        WHERE user_id = ?`,
      [GACHA_INITIAL_COINS, todayKey(), now, userId],
    );
    await insertTransaction({
      userId,
      type: 'reset',
      metadata: { resetAt: now },
      createdAt: now,
    });
  });

  return getGachaState(userId);
}
