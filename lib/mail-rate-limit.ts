/**
 * 进程级内存滑动窗口限流 + 密码门失败锁定。
 *
 * 说明：
 * - 单进程内存实现，`next start` 单实例够用；多实例/无状态部署请接 Redis。
 * - dev 模式 hot reload 会重置计数（挂 globalThis 可缓解，但副作用多，保持简单）。
 * - 所有时间单位都是毫秒。
 */

type Hit = { timestamps: number[] };

type LoginFailure = {
  count: number;
  firstFailAt: number;
  lockedUntil: number;
};

// 挂到 globalThis 以在 Next dev 的 HMR 下尽量保留状态
const G = globalThis as unknown as {
  __mailRlHits?: Map<string, Hit>;
  __mailLoginFails?: Map<string, LoginFailure>;
  __mailGcAt?: number;
};

const hitsMap: Map<string, Hit> = G.__mailRlHits ?? new Map();
const loginFailMap: Map<string, LoginFailure> =
  G.__mailLoginFails ?? new Map();
G.__mailRlHits = hitsMap;
G.__mailLoginFails = loginFailMap;

/** 每 5 分钟最多 GC 一次，避免每次请求都遍历 */
function maybeGc(now: number) {
  if (G.__mailGcAt && now - G.__mailGcAt < 5 * 60_000) return;
  G.__mailGcAt = now;
  // 清理所有超过 1 小时没动过的条目
  const cutoff = now - 60 * 60_000;
  for (const [k, v] of hitsMap) {
    const last = v.timestamps[v.timestamps.length - 1] ?? 0;
    if (last < cutoff) hitsMap.delete(k);
  }
  for (const [k, v] of loginFailMap) {
    if (v.lockedUntil < now && v.firstFailAt < cutoff) {
      loginFailMap.delete(k);
    }
  }
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

/**
 * 滑动窗口限流。返回结果里 `allowed=false` 时请直接拒绝请求并把 `retryAfterMs`
 * 塞到 `Retry-After` header（秒为单位）。
 */
export function rateLimit(opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  maybeGc(now);

  const { key, max, windowMs } = opts;
  const record = hitsMap.get(key) ?? { timestamps: [] };
  // 丢掉窗口外的旧时间戳
  const cutoff = now - windowMs;
  const kept = record.timestamps.filter((t) => t > cutoff);

  if (kept.length >= max) {
    const earliest = kept[0];
    const resetAt = earliest + windowMs;
    record.timestamps = kept;
    hitsMap.set(key, record);
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfterMs: Math.max(0, resetAt - now),
    };
  }

  kept.push(now);
  record.timestamps = kept;
  hitsMap.set(key, record);
  return {
    allowed: true,
    remaining: Math.max(0, max - kept.length),
    resetAt: now + windowMs,
    retryAfterMs: 0,
  };
}

// ==============================================================
// 密码门失败锁定
// ==============================================================

export type LoginLockStatus =
  | { locked: false }
  | { locked: true; retryAfterMs: number };

/** 默认阈值：10 次失败 → 锁 30 分钟，窗口 10 分钟滚动 */
const LOGIN_FAIL_MAX = 10;
const LOGIN_FAIL_WINDOW_MS = 10 * 60_000;
const LOGIN_LOCK_DURATION_MS = 30 * 60_000;

export function checkLoginLock(ip: string): LoginLockStatus {
  const now = Date.now();
  maybeGc(now);
  const rec = loginFailMap.get(ip);
  if (!rec) return { locked: false };
  if (rec.lockedUntil > now) {
    return { locked: true, retryAfterMs: rec.lockedUntil - now };
  }
  return { locked: false };
}

/** 密码错误时调用：累计失败并在达阈值时上锁 */
export function recordLoginFailure(ip: string): LoginLockStatus {
  const now = Date.now();
  maybeGc(now);
  const rec = loginFailMap.get(ip);

  if (!rec || now - rec.firstFailAt > LOGIN_FAIL_WINDOW_MS) {
    // 新窗口起点
    loginFailMap.set(ip, { count: 1, firstFailAt: now, lockedUntil: 0 });
    return { locked: false };
  }

  const count = rec.count + 1;
  if (count >= LOGIN_FAIL_MAX) {
    const lockedUntil = now + LOGIN_LOCK_DURATION_MS;
    loginFailMap.set(ip, {
      count,
      firstFailAt: rec.firstFailAt,
      lockedUntil,
    });
    return { locked: true, retryAfterMs: LOGIN_LOCK_DURATION_MS };
  }

  loginFailMap.set(ip, {
    count,
    firstFailAt: rec.firstFailAt,
    lockedUntil: 0,
  });
  return { locked: false };
}

/** 密码正确后调用：清掉该 IP 的失败记录 */
export function clearLoginFailure(ip: string): void {
  loginFailMap.delete(ip);
}
