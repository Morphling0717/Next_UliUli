import { get, run } from './db';

/**
 * SQLite-backed sliding window rate limit + login lockout.
 *
 * The previous in-memory maps worked for one long-lived Node process, but lost
 * state on restart and diverged across instances. This table-backed version is
 * still small and local-first, while making limits durable enough for the
 * mailbox/admin workflows.
 */

type CountRow = { count: number };
type HitRow = { hit_at: number };
type LoginFailureRow = {
  count: number;
  first_fail_at: number;
  locked_until: number;
};

const G = globalThis as unknown as { __mailRlSqliteGcAt?: number };

async function maybeGc(now: number): Promise<void> {
  if (G.__mailRlSqliteGcAt && now - G.__mailRlSqliteGcAt < 5 * 60_000) return;
  G.__mailRlSqliteGcAt = now;
  const cutoff = now - 24 * 60 * 60_000;
  await run('DELETE FROM rate_limit_hits WHERE hit_at < ?', [cutoff]).catch(() => {});
  await run(
    'DELETE FROM login_failures WHERE locked_until < ? AND first_fail_at < ?',
    [now, now - 60 * 60_000],
  ).catch(() => {});
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** 允许被下一次请求时的时间戳（ms）；仅在 allowed=false 时有意义 */
  resetAt: number;
  /** 距离可用的剩余毫秒（便于构造 Retry-After） */
  retryAfterMs: number;
};

export type RateLimitOptions = {
  /** 限流 key，建议 `{scope}:{identifier}`，避免不同场景互相污染 */
  key: string;
  /** 窗口内允许的最大命中数 */
  max: number;
  /** 滑动窗口长度（ms） */
  windowMs: number;
};

export async function rateLimit(opts: RateLimitOptions): Promise<RateLimitResult> {
  const now = Date.now();
  await maybeGc(now);

  const { key, max, windowMs } = opts;
  const cutoff = now - windowMs;
  await run('DELETE FROM rate_limit_hits WHERE scope_key = ? AND hit_at <= ?', [
    key,
    cutoff,
  ]);

  const countRow = await get<CountRow>(
    'SELECT COUNT(*) AS count FROM rate_limit_hits WHERE scope_key = ?',
    [key],
  );
  const count = Number(countRow?.count ?? 0);

  if (count >= max) {
    const earliest = await get<HitRow>(
      'SELECT hit_at FROM rate_limit_hits WHERE scope_key = ? ORDER BY hit_at ASC LIMIT 1',
      [key],
    );
    const resetAt = Number(earliest?.hit_at ?? now) + windowMs;
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfterMs: Math.max(0, resetAt - now),
    };
  }

  await run('INSERT INTO rate_limit_hits (scope_key, hit_at) VALUES (?, ?)', [
    key,
    now,
  ]);
  return {
    allowed: true,
    remaining: Math.max(0, max - count - 1),
    resetAt: now + windowMs,
    retryAfterMs: 0,
  };
}

export type LoginLockStatus =
  | { locked: false }
  | { locked: true; retryAfterMs: number };

const LOGIN_FAIL_MAX = 10;
const LOGIN_FAIL_WINDOW_MS = 10 * 60_000;
const LOGIN_LOCK_DURATION_MS = 30 * 60_000;

export async function checkLoginLock(ip: string): Promise<LoginLockStatus> {
  const now = Date.now();
  await maybeGc(now);
  const rec = await get<LoginFailureRow>(
    'SELECT count, first_fail_at, locked_until FROM login_failures WHERE ip = ?',
    [ip],
  );
  if (!rec) return { locked: false };
  if (rec.locked_until > now) {
    return { locked: true, retryAfterMs: rec.locked_until - now };
  }
  return { locked: false };
}

export async function recordLoginFailure(ip: string): Promise<LoginLockStatus> {
  const now = Date.now();
  await maybeGc(now);
  const rec = await get<LoginFailureRow>(
    'SELECT count, first_fail_at, locked_until FROM login_failures WHERE ip = ?',
    [ip],
  );

  if (!rec || now - rec.first_fail_at > LOGIN_FAIL_WINDOW_MS) {
    await run(
      `INSERT INTO login_failures (ip, count, first_fail_at, locked_until)
       VALUES (?, 1, ?, 0)
       ON CONFLICT(ip) DO UPDATE SET
         count = 1,
         first_fail_at = excluded.first_fail_at,
         locked_until = 0`,
      [ip, now],
    );
    return { locked: false };
  }

  const count = rec.count + 1;
  if (count >= LOGIN_FAIL_MAX) {
    const lockedUntil = now + LOGIN_LOCK_DURATION_MS;
    await run(
      `UPDATE login_failures
       SET count = ?, locked_until = ?
       WHERE ip = ?`,
      [count, lockedUntil, ip],
    );
    return { locked: true, retryAfterMs: LOGIN_LOCK_DURATION_MS };
  }

  await run('UPDATE login_failures SET count = ?, locked_until = 0 WHERE ip = ?', [
    count,
    ip,
  ]);
  return { locked: false };
}

export async function clearLoginFailure(ip: string): Promise<void> {
  await run('DELETE FROM login_failures WHERE ip = ?', [ip]);
}

export async function getRateLimitHealth(): Promise<{
  hitRows: number;
  lockedLoginRows: number;
}> {
  const [hitRows, lockedRows] = await Promise.all([
    get<CountRow>('SELECT COUNT(*) AS count FROM rate_limit_hits'),
    get<CountRow>(
      'SELECT COUNT(*) AS count FROM login_failures WHERE locked_until > ?',
      [Date.now()],
    ),
  ]);
  return {
    hitRows: Number(hitRows?.count ?? 0),
    lockedLoginRows: Number(lockedRows?.count ?? 0),
  };
}
