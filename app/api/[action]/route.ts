import { NextRequest, NextResponse } from 'next/server';
import { get, getConfig, setConfig } from '@/lib/db';
import {
  GachaError,
  checkOwnedGachaCodes,
  getGachaUserByToken,
  packageGachaItem,
  redeemGachaCode,
} from '@/lib/gacha';

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
    const { token, itemId } = body;
    if (typeof itemId !== "number" && typeof itemId !== "string") {
      return NextResponse.json({ error: "Missing itemId" }, { status: 400 });
    }
    try {
      const user = await getGachaUserByToken(token);
      const result = await packageGachaItem(user.id, itemId);
      return NextResponse.json({ success: true, ...result });
    } catch (error) {
      const status = error instanceof GachaError ? error.status : 500;
      const message = error instanceof Error ? error.message : "Database error";
      return NextResponse.json({ error: message }, { status });
    }
  }

  if (action === 'redeem') {
    const { token, code } = body;
    if (typeof code !== "string" || !code.trim()) {
      return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }
    try {
      const user = await getGachaUserByToken(token);
      const result = await redeemGachaCode(user.id, code);
      return NextResponse.json({ success: true, ...result });
    } catch (error) {
      const status = error instanceof GachaError ? error.status : 500;
      const message = error instanceof Error ? error.message : "Database error";
      return NextResponse.json({ error: message }, { status });
    }
  }

  if (action === 'check_status') {
    const { token, codes } = body;
    if (!Array.isArray(codes) || codes.length === 0) return NextResponse.json({ results: [] });
    try {
      const user = await getGachaUserByToken(token);
      const results = await checkOwnedGachaCodes(user.id, codes);
      return NextResponse.json({ results });
    } catch (error) {
      const status = error instanceof GachaError ? error.status : 500;
      const message = error instanceof Error ? error.message : "Database error";
      return NextResponse.json({ error: message }, { status });
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
