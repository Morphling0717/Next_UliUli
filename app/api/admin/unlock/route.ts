import { NextRequest, NextResponse } from 'next/server';
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

const lockKey = (req: Request) => `dev:${getClientIp(req)}`;

export async function GET(request: NextRequest) {
  return NextResponse.json({
    success: true,
    unlocked: await verifyAdminSession(request, 'dev'),
  });
}

export async function POST(request: NextRequest) {
  try {
    const expected = getExpectedPassword('dev');
    if (!expected) {
      return NextResponse.json(
        { success: false, message: '服务器未配置 DEV_UNLOCK_PASSWORD 环境变量' },
        { status: 500 },
      );
    }

    const body = (await request.json().catch(() => null)) as { password?: string } | null;
    const password = body?.password;

    if (typeof password !== 'string' || !password) {
      return NextResponse.json(
        { success: false, message: '密码不能为空' },
        { status: 400 },
      );
    }

    const key = lockKey(request);
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

    if (!safeEqual(password, expected)) {
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
        { success: false, message: '密码错误' },
        { status: 401 },
      );
    }

    await clearLoginFailure(key);
    const session = await createAdminSession('dev', request);
    const res = NextResponse.json({ success: true, unlocked: true });
    res.cookies.set(
      getSessionCookieName('dev'),
      session.token,
      sessionCookieOptions('dev', session.maxAge),
    );
    return res;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json(
      { success: false, message: `服务器错误: ${message}` },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  await destroyAdminSession(request, 'dev');
  const res = NextResponse.json({ success: true, unlocked: false });
  res.cookies.set(getSessionCookieName('dev'), '', expiredSessionCookieOptions());
  return res;
}
