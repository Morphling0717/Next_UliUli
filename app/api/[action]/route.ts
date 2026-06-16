import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { run, get, all, getConfig, setConfig } from '@/lib/db';

type GiftCodeRow = {
  code: string;
  status: string;
  item_id: number;
};

type SiteConfigRow = {
  value: string;
};

type JsonObject = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJsonObject = (value: string): JsonObject => {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export async function POST(request: NextRequest) {
  const action = request.nextUrl.pathname.split('/').pop();
  let body: JsonObject = {};

  if (action !== 'increment') {
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }

  if (action === 'generate') {
    const { itemId } = body;
    if (typeof itemId !== "number" && typeof itemId !== "string") {
      return NextResponse.json({ error: "Missing itemId" }, { status: 400 });
    }
    const code = 'GIFT-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    try {
      await run('INSERT INTO gift_codes (code, item_id) VALUES (?, ?)', [code, itemId]);
      return NextResponse.json({ success: true, code });
    } catch {
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
  }

  if (action === 'redeem') {
    const { code } = body;
    if (typeof code !== "string" || !code.trim()) {
      return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }
    try {
      const row = await get<GiftCodeRow>('SELECT * FROM gift_codes WHERE code = ?', [code]);
      if (!row) return NextResponse.json({ error: "无效的兑换码" }, { status: 404 });
      if (row.status === 'used') return NextResponse.json({ error: "该兑换码已被使用" }, { status: 400 });
      
      await run('UPDATE gift_codes SET status = ? WHERE code = ?', ['used', code]);
      return NextResponse.json({ success: true, itemId: row.item_id });
    } catch {
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
  }

  if (action === 'check_status') {
    const { codes } = body;
    if (!Array.isArray(codes) || codes.length === 0) return NextResponse.json({ results: [] });
    const safeCodes = codes.filter((code): code is string => typeof code === "string" && code.length > 0);
    if (safeCodes.length === 0) return NextResponse.json({ results: [] });
    const placeholders = safeCodes.map(() => '?').join(',');
    try {
      const rows = await all<GiftCodeRow>(
        `SELECT code, status, item_id FROM gift_codes WHERE code IN (${placeholders})`,
        safeCodes,
      );
      return NextResponse.json({ results: rows });
    } catch {
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
  }

  if (action === 'increment') {
    try {
      const DEFAULT_GACHA = {
        pityThreshold: 8000,
        softPityStart: 5000,
        baseRate: 1 / 10000,
        maxRate: 0.6,
      };
      const toFiniteNumber = (val: unknown, fallback: number) => {
        const parsed = Number(val);
        return Number.isFinite(parsed) ? parsed : fallback;
      };
      const configRow = await get<SiteConfigRow>(
        'SELECT value FROM site_config WHERE key = ?',
        ['site_config'],
      );
      const parsedConfig = configRow?.value ? parseJsonObject(configRow.value) : {};
      const gachaConfig = isRecord(parsedConfig.gacha) ? parsedConfig.gacha : {};

      const PITY_THRESHOLD = Math.max(1, Math.round(toFiniteNumber(gachaConfig.pityThreshold, DEFAULT_GACHA.pityThreshold)));
      const SOFT_PITY_START = Math.max(0, Math.round(toFiniteNumber(gachaConfig.softPityStart, DEFAULT_GACHA.softPityStart)));
      const BASE_RATE = Math.min(1, Math.max(0, toFiniteNumber(gachaConfig.baseRate, DEFAULT_GACHA.baseRate)));
      const MAX_RATE = Math.min(1, Math.max(BASE_RATE, toFiniteNumber(gachaConfig.maxRate, DEFAULT_GACHA.maxRate)));

      const currentCountStr = await getConfig('pityCount');
      let currentCount = parseInt(currentCountStr ?? '0', 10) || 0;
      currentCount++;

      const isPity = currentCount >= PITY_THRESHOLD;
      let currentRate = BASE_RATE;
      if (currentCount > SOFT_PITY_START && currentCount < PITY_THRESHOLD) {
          const softPitySpan = Math.max(1, PITY_THRESHOLD - 1 - SOFT_PITY_START);
          const progressInSoftPity = (currentCount - SOFT_PITY_START) / softPitySpan;
          currentRate = BASE_RATE + (MAX_RATE - BASE_RATE) * progressInSoftPity;
      }

      const isRandomLuck = Math.random() < currentRate;
      let triggeredGoldenLuck = false;

      if (isPity || isRandomLuck) {
          triggeredGoldenLuck = true;
          await setConfig('pityCount', 0);
      } else {
          await setConfig('pityCount', currentCount);
      }

      return NextResponse.json({
          newCount: triggeredGoldenLuck ? 0 : currentCount,
          triggeredGoldenLuck: triggeredGoldenLuck
      });
    } catch (e) {
      console.error("Increment Error:", e);
      return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}

export async function GET(request: NextRequest) {
  const action = request.nextUrl.pathname.split('/').pop();
  if (action === 'getCount') {
    try {
      const countStr = await getConfig('pityCount');
      return NextResponse.json({ count: parseInt(countStr ?? '0', 10) || 0 });
    } catch {
      return NextResponse.json({ error: "Database Error" }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}
