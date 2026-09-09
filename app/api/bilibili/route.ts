import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { get, run } from '@/lib/db';
import { normalizeBilibiliPayload } from '@/lib/bilibili-payload';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const DEFAULT_UPSTREAM =
  'https://api.uliuli.cn/api?mid=3546779356235807&section=profile,videos&page_size=15&order=pubdate';
const UPSTREAM_URL = process.env.BILIBILI_API_URL?.trim() || DEFAULT_UPSTREAM;
// Keep credentials out of persisted cache metadata if a private upstream is configured.
const SOURCE_KEY = createHash('sha256').update(UPSTREAM_URL).digest('hex');
const LAST_SUCCESS_KEY = 'bilibili.last_success.v2';
const CACHE_TTL_MS = Math.max(60_000, Number(process.env.BILIBILI_CACHE_TTL_SECONDS || 180) * 1000);
const FETCH_TIMEOUT_MS = Math.max(2_000, Number(process.env.BILIBILI_FETCH_TIMEOUT_MS || 8_000));
const REFRESH_ERROR_BACKOFF_MS = Math.max(15_000, Number(process.env.BILIBILI_REFRESH_ERROR_BACKOFF_SECONDS || 60) * 1000);

type Payload = ReturnType<typeof normalizeBilibiliPayload>;
type CacheState = { data: Payload; fetchedAt: number; sourceKey: string };
type ConfigRow = { value: string };
const G = globalThis as unknown as {
  __bilibiliCache?: CacheState;
  __bilibiliRefresh?: { sourceKey: string; promise: Promise<CacheState> };
  __bilibiliRefreshBlockedUntil?: { sourceKey: string; until: number };
};

function usableCache(value: unknown): CacheState | null {
  if (!value || typeof value !== 'object') return null;
  const cached = value as Partial<CacheState>;
  if (cached.sourceKey !== SOURCE_KEY || typeof cached.fetchedAt !== 'number' ||
      !Number.isFinite(cached.fetchedAt) || cached.fetchedAt <= 0) return null;
  try {
    return { data: normalizeBilibiliPayload(cached.data), fetchedAt: cached.fetchedAt, sourceKey: SOURCE_KEY };
  } catch { return null; }
}

async function fetchUpstream(): Promise<Payload> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(UPSTREAM_URL, {
        cache: 'no-store', signal: controller.signal,
        headers: { accept: 'application/json', 'user-agent': 'UliUliSite/1.0 (+https://uliuli.cn)' },
      });
      if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
      return normalizeBilibiliPayload(await response.json());
    } catch (error) { lastError = error; }
    finally { clearTimeout(timer); }
  }
  throw lastError instanceof Error ? lastError : new Error('Bilibili upstream failed');
}

async function saveLastSuccess(cache: CacheState): Promise<void> {
  // One atomic row keeps the payload, source identity and timestamp consistent.
  await run(
    `INSERT INTO global_config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [LAST_SUCCESS_KEY, JSON.stringify(cache)],
  );
}

async function readLastSuccess(): Promise<CacheState | null> {
  const row = await get<ConfigRow>('SELECT value FROM global_config WHERE key = ?', [LAST_SUCCESS_KEY]);
  if (!row?.value) return null;
  try { return usableCache(JSON.parse(row.value)); }
  catch { return null; }
}

function refreshCache(): Promise<CacheState> {
  if (G.__bilibiliRefresh?.sourceKey === SOURCE_KEY) return G.__bilibiliRefresh.promise;
  const promise: Promise<CacheState> = fetchUpstream().then(async (data) => {
    const cache = { data, fetchedAt: Date.now(), sourceKey: SOURCE_KEY };
    // An older in-flight request from a replaced module must not replace a newer source.
    if (G.__bilibiliRefresh?.promise === promise) {
      G.__bilibiliCache = cache;
      await saveLastSuccess(cache).catch((error) => {
        console.warn('[api/bilibili] failed to persist last success:', error);
      });
    }
    return cache;
  }).finally(() => {
    if (G.__bilibiliRefresh?.promise === promise) G.__bilibiliRefresh = undefined;
  });
  G.__bilibiliRefresh = { sourceKey: SOURCE_KEY, promise };
  return promise;
}

function triggerBackgroundRefresh() {
  const blocked = G.__bilibiliRefreshBlockedUntil;
  if (blocked?.sourceKey === SOURCE_KEY && Date.now() < blocked.until) return;
  void refreshCache().catch((error) => {
    G.__bilibiliRefreshBlockedUntil = { sourceKey: SOURCE_KEY, until: Date.now() + REFRESH_ERROR_BACKOFF_MS };
    console.warn('[api/bilibili] background refresh failed:', error);
  });
}

function respond(cache: CacheState, cacheHeader: 'memory-hit' | 'memory-stale' | 'db-stale' | 'upstream') {
  const stale = cacheHeader.endsWith('-stale');
  return NextResponse.json(
    { ...cache.data, ...(stale ? { stale: true, staleAt: new Date(cache.fetchedAt).toISOString() } : {}) },
    { headers: {
      'Cache-Control': stale ? 'public, max-age=30, stale-while-revalidate=300' : 'public, max-age=60, stale-while-revalidate=240',
      'x-uliuli-cache': cacheHeader,
    } },
  );
}

export async function GET() {
  const cached = usableCache(G.__bilibiliCache);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return respond(cached, 'memory-hit');
  if (cached) {
    triggerBackgroundRefresh();
    return respond(cached, 'memory-stale');
  }
  const lastSuccess = await readLastSuccess().catch(() => null);
  if (lastSuccess) {
    G.__bilibiliCache = lastSuccess;
    triggerBackgroundRefresh();
    return respond(lastSuccess, 'db-stale');
  }
  try { return respond(await refreshCache(), 'upstream'); }
  catch {
    return NextResponse.json({ success: false, error: 'Bilibili upstream unavailable' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
