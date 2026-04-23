import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getClientIp } from './db';
import {
  checkLoginLock,
  clearLoginFailure,
  recordLoginFailure,
} from './mail-rate-limit';

/**
 * 常数时间字符串比较，防时序侧信道（timing attack）。
 * 注意 `crypto.timingSafeEqual` 要求两个 Buffer 长度相同，所以先比长度再比内容。
 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // 跑一次等长假比较，避免长度信息从分支耗时上泄漏
    crypto.timingSafeEqual(ab, Buffer.alloc(ab.length));
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function getMailAdminPassword(): string | null {
  const mailPassword = process.env.MAIL_AUTH_PASSWORD?.trim();
  if (mailPassword) return mailPassword;
  const adminPassword = process.env.ADMIN_PASSWORD?.trim();
  if (adminPassword) return adminPassword;
  return null;
}

/**
 * 检查请求是否带有正确的 mail 后台密码。
 *
 * 增强点：
 * 1. 用 `crypto.timingSafeEqual` 做密码比较（防时序攻击）。
 * 2. 基于客户端 IP 做失败次数累计，达到阈值后返回 429 + `Retry-After`，
 *    避免任何人裸跑字典爆破 mail 后台口令。
 * 3. 密码正确后清掉该 IP 的失败计数。
 *
 * 优先读 `X-Mail-Password` header（便于 GET/DELETE 使用），兜底读 JSON body
 * 中的 `password` 字段。优先使用 `MAIL_AUTH_PASSWORD`，未配置时回退到
 * `ADMIN_PASSWORD`。
 */
export async function verifyMailAdmin(req: Request): Promise<NextResponse | null> {
  const expected = getMailAdminPassword();
  if (!expected) {
    return NextResponse.json(
      { error: '服务器未配置 MAIL_AUTH_PASSWORD 或 ADMIN_PASSWORD 环境变量' },
      { status: 500 },
    );
  }

  const ip = getClientIp(req);

  // 先看这个 IP 是不是已经被锁
  const lock = checkLoginLock(ip);
  if (lock.locked) {
    const retryAfterSec = Math.ceil(lock.retryAfterMs / 1000);
    return NextResponse.json(
      {
        error: `尝试次数过多，请在 ${Math.ceil(retryAfterSec / 60)} 分钟后再试`,
      },
      {
        status: 429,
        headers: { 'retry-after': String(retryAfterSec) },
      },
    );
  }

  // 收集候选密码
  const candidates: string[] = [];
  const header = req.headers.get('x-mail-password');
  if (header) candidates.push(header);
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE') {
    try {
      const cloned = req.clone();
      const body = await cloned.json();
      if (body && typeof body === 'object' && typeof body.password === 'string') {
        candidates.push(body.password);
      }
    } catch {
      /* body 不是 json 或读取失败 */
    }
  }

  // 用 timing-safe 比较
  for (const c of candidates) {
    if (safeEqual(c, expected)) {
      clearLoginFailure(ip);
      return null;
    }
  }

  // 没有任何候选通过（包括没带密码）：记失败
  const result = recordLoginFailure(ip);
  if (result.locked) {
    const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
    return NextResponse.json(
      {
        error: `尝试次数过多，已锁定 ${Math.ceil(retryAfterSec / 60)} 分钟`,
      },
      {
        status: 429,
        headers: { 'retry-after': String(retryAfterSec) },
      },
    );
  }

  return NextResponse.json({ error: '密码错误或未授权' }, { status: 401 });
}

/**
 * 静默判断是否带有管理员密码 header，**不记失败、不锁 IP**。
 *
 * 用途：公开接口想顺便检查"如果是管理员就多返回点字段"时，不应该
 * 把没带密码的公开请求当作爆破。
 *
 * 仅读 `X-Mail-Password` header；不接受 body 里的 password，避免意外消费
 * 请求体。
 */
export function isMailAdminHeader(req: Request): boolean {
  const expected = getMailAdminPassword();
  if (!expected) return false;
  const header = req.headers.get('x-mail-password');
  if (!header) return false;
  return safeEqual(header, expected);
}
