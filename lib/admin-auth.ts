import { NextResponse } from 'next/server';
import {
  getExpectedPassword,
  safeEqual,
  verifyAdminSession,
} from './admin-session';

export async function verifyAdminRequest(
  req: Request,
  legacyPassword?: string | null,
): Promise<NextResponse | null> {
  if (await verifyAdminSession(req, 'admin')) return null;

  const expected = getExpectedPassword('admin');
  if (!expected) {
    return NextResponse.json(
      { success: false, message: '服务器未配置 ADMIN_PASSWORD 环境变量' },
      { status: 500 },
    );
  }

  if (legacyPassword && safeEqual(legacyPassword, expected)) return null;

  return NextResponse.json(
    { success: false, message: '未登录或登录已过期，请重新验证管理员身份' },
    { status: 401 },
  );
}
