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
