import { NextResponse } from 'next/server';
import { get, run } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DEFAULT_UPSTREAM =
  'https://1377297588-5v9c60xnw1.ap-guangzhou.tencentscf.com/?mid=3546779356235807';
const CACHE_TTL_MS = Math.max(
  60_000,
  Number(process.env.BILIBILI_CACHE_TTL_SECONDS || 180) * 1000,
);
const FETCH_TIMEOUT_MS = Math.max(
  2_000,
  Number(process.env.BILIBILI_FETCH_TIMEOUT_MS || 8_000),
);
const REFRESH_ERROR_BACKOFF_MS = Math.max(
  15_000,
  Number(process.env.BILIBILI_REFRESH_ERROR_BACKOFF_SECONDS || 60) * 1000,
);

type CacheState = {
  data: unknown;
  fetchedAt: number;
};

type ConfigRow = { value: string };

const G = globalThis as unknown as {
  __bilibiliCache?: CacheState;
  __bilibiliRefresh?: Promise<void>;
  __bilibiliRefreshBlockedUntil?: number;
};

function upstreamUrl(): string {
  return process.env.BILIBILI_API_URL?.trim() || DEFAULT_UPSTREAM;
}

function isUsablePayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const maybe = payload as { success?: unknown };
  return maybe.success !== false;
}

async function fetchUpstream(): Promise<unknown> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(upstreamUrl(), {
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'user-agent': 'UliUliSite/1.0 (+https://www.uliuli.cc)',
        },
      });
      if (!res.ok) {
        throw new Error(`Upstream HTTP ${res.status}`);
      }
      const payload = await res.json();
      if (!isUsablePayload(payload)) {
        throw new Error('Upstream returned an unusable payload');
      }
      return payload;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Bilibili upstream failed');
}

async function saveLastSuccess(data: unknown): Promise<void> {
  const now = new Date().toISOString();
  await run(
    `INSERT INTO global_config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ['bilibili.last_success', JSON.stringify(data)],
  );
  await run(
    `INSERT INTO global_config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ['bilibili.last_success_at', now],
  );
}

async function readLastSuccess(): Promise<{ data: unknown; at: string | null } | null> {
  const row = await get<ConfigRow>(
    'SELECT value FROM global_config WHERE key = ?',
    ['bilibili.last_success'],
  );
  if (!row?.value) return null;
  const atRow = await get<ConfigRow>(
    'SELECT value FROM global_config WHERE key = ?',
    ['bilibili.last_success_at'],
  );
  try {
    const data: unknown = JSON.parse(row.value);
    return isUsablePayload(data) ? { data, at: atRow?.value ?? null } : null;
  } catch {
    return null;
  }
}

async function refreshCache(fetchedAt = Date.now()): Promise<unknown> {
  const data = await fetchUpstream();
  G.__bilibiliCache = { data, fetchedAt };
  await saveLastSuccess(data).catch((error) => {
    console.warn('[api/bilibili] failed to persist last success:', error);
  });
  return data;
}

function triggerBackgroundRefresh() {
  if (G.__bilibiliRefresh) return;
  const now = Date.now();
  if (G.__bilibiliRefreshBlockedUntil && now < G.__bilibiliRefreshBlockedUntil) return;

  G.__bilibiliRefresh = refreshCache()
    .then(() => undefined)
    .catch((error) => {
      G.__bilibiliRefreshBlockedUntil = Date.now() + REFRESH_ERROR_BACKOFF_MS;
      console.warn('[api/bilibili] background refresh failed:', error);
    })
    .finally(() => {
      G.__bilibiliRefresh = undefined;
    });
}

function staleResponse(
  data: unknown,
  staleAt: string | null,
  cacheHeader: 'memory-stale' | 'db-stale',
) {
  return NextResponse.json(
    {
      ...(data as Record<string, unknown>),
      stale: true,
      staleAt,
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=300',
        'x-uliuli-cache': cacheHeader,
      },
    },
  );
}

export async function GET() {
  const now = Date.now();
  const cached = G.__bilibiliCache;
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(cached.data, {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=240',
        'x-uliuli-cache': 'memory-hit',
      },
    });
  }

  if (cached) {
    triggerBackgroundRefresh();
    return staleResponse(cached.data, new Date(cached.fetchedAt).toISOString(), 'memory-stale');
  }

  const lastSuccess = await readLastSuccess().catch(() => null);
  if (lastSuccess) {
    triggerBackgroundRefresh();
    return staleResponse(lastSuccess.data, lastSuccess.at, 'db-stale');
  }

  try {
    const data = await refreshCache(now);
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=240',
        'x-uliuli-cache': 'upstream',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Bilibili upstream failed',
      },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
