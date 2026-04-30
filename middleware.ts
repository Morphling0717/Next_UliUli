import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const ALLOWED_INDEXABLE_PATHS = new Set([
  '/',
  '/robots.txt',
  '/sitemap.xml',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/og-image.jpg',
  '/app.jpg',
]);

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const { pathname } = req.nextUrl;
  const isNextStatic = pathname.startsWith('/_next/');
  const isAllowed = ALLOWED_INDEXABLE_PATHS.has(pathname) || isNextStatic;

  if (!isAllowed) {
    res.headers.set(
      'x-robots-tag',
      'noindex, nofollow, noarchive, nosnippet, noimageindex',
    );
  }

  return res;
}

export const config = {
  matcher: ['/((?!.*\\..*).*)', '/favicon.ico', '/og-image.jpg', '/app.jpg', '/robots.txt', '/sitemap.xml', '/manifest.webmanifest'],
};
