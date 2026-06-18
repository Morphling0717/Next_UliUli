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

const lockKey = (req: Request) => `admin:${getClientIp(req)}`;

export async function GET(req: Request) {
  return NextResponse.json({ authenticated: await verifyAdminSession(req, 'admin') });
}

export async function POST(req: Request) {
  const expected = getExpectedPassword('admin');
  if (!expected) {
    return NextResponse.json(
      { success: false, message: '服务器未配置 ADMIN_PASSWORD 环境变量' },
      { status: 500 },
    );
  }

  const key = lockKey(req);
  const lock = await checkLoginLock(key);
  if (lock.locked) {
    const retryAfterSec = Math.ceil(lock.retryAfterMs / 1000);
    return NextResponse.json(
      {
        success: false,
        message: `尝试次数过多，请在 ${Math.ceil(retryAfterSec / 60)} 分钟后再试`,
      },
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
        {
          success: false,
          message: `尝试次数过多，已锁定 ${Math.ceil(retryAfterSec / 60)} 分钟`,
        },
        { status: 429, headers: { 'retry-after': String(retryAfterSec) } },
      );
    }
    return NextResponse.json(
      { success: false, message: '密码错误，拒绝访问' },
      { status: 401 },
    );
  }

  await clearLoginFailure(key);
  const session = await createAdminSession('admin', req);
  const res = NextResponse.json({ success: true, authenticated: true });
  res.cookies.set(
    getSessionCookieName('admin'),
    session.token,
    sessionCookieOptions('admin', session.maxAge),
  );
  return res;
}

export async function DELETE(req: Request) {
  await destroyAdminSession(req, 'admin');
  const res = NextResponse.json({ success: true, authenticated: false });
  res.cookies.set(getSessionCookieName('admin'), '', expiredSessionCookieOptions());
  return res;
}
