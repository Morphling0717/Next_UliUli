import { NextResponse } from 'next/server';
import {
  createAdminSession,
  destroyAdminSession,
  expiredSessionCookieOptions,
  getExpectedPassword,
  getSessionCookieName,
  safeEqual,
  sessionCookieOptions,
  verifyAdminSession,
} from '@/lib/admin-session';
import { getClientIp } from '@/lib/db';
import {
  checkLoginLock,
  clearLoginFailure,
  recordLoginFailure,
} from '@/lib/mail-rate-limit';

export const dynamic = 'force-dynamic';

const lockKey = (req: Request) => `mail:${getClientIp(req)}`;

export async function GET(req: Request) {
  return NextResponse.json({ authenticated: await verifyAdminSession(req, 'mail') });
}

export async function POST(req: Request) {
  const expected = getExpectedPassword('mail');
  if (!expected) {
    return NextResponse.json(
      { error: '服务器未配置 MAIL_AUTH_PASSWORD 或 ADMIN_PASSWORD 环境变量' },
      { status: 500 },
    );
  }

  const key = lockKey(req);
  const lock = await checkLoginLock(key);
  if (lock.locked) {
    const retryAfterSec = Math.ceil(lock.retryAfterMs / 1000);
    return NextResponse.json(
      { error: `尝试次数过多，请在 ${Math.ceil(retryAfterSec / 60)} 分钟后再试` },
      { status: 429, headers: { 'retry-after': String(retryAfterSec) } },
    );
  }

  const body = (await req.json().catch(() => null)) as { password?: string } | null;
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!password || !safeEqual(password, expected)) {
    const result = await recordLoginFailure(key);
    if (result.locked) {
      const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
      return NextResponse.json(
        { error: `尝试次数过多，已锁定 ${Math.ceil(retryAfterSec / 60)} 分钟` },
        { status: 429, headers: { 'retry-after': String(retryAfterSec) } },
      );
    }
    return NextResponse.json({ error: '密码错误或未授权' }, { status: 401 });
  }

  await clearLoginFailure(key);
  const session = await createAdminSession('mail', req);
  const res = NextResponse.json({ authenticated: true });
  res.cookies.set(
    getSessionCookieName('mail'),
    session.token,
    sessionCookieOptions('mail', session.maxAge),
  );
  return res;
}

export async function DELETE(req: Request) {
  await destroyAdminSession(req, 'mail');
  const res = NextResponse.json({ authenticated: false });
  res.cookies.set(getSessionCookieName('mail'), '', expiredSessionCookieOptions());
  return res;
}
