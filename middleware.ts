import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * 统一给发信箱后台相关路径加上：
 *   X-Robots-Tag: noindex, nofollow, noarchive, nosnippet
 * 确保即使 robots.txt 被忽略，搜索引擎也不会索引 `/mail` 登录页或 API。
 */
export function middleware(_req: NextRequest) {
  const res = NextResponse.next();
  res.headers.set(
    'x-robots-tag',
    'noindex, nofollow, noarchive, nosnippet',
  );
  return res;
}

export const config = {
  matcher: ['/mail', '/mail/:path*', '/api/mail/:path*'],
};
