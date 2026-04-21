import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * B 站图片（头像/直播封面等）同源代理。
 * 背景：`WindChimeQrCard` 在画海报时用 `img.crossOrigin = 'anonymous'`
 * 加载头像，而 `*.hdslb.com` CDN 不返回 CORS 头，导致头像加载失败。
 * 本路由把图片取回后以同源方式透传，`canvas.drawImage` 就不会被跨域限制。
 *
 * 为防 SSRF，只允许 B 站官方图片 CDN。
 */
const ALLOWED_HOSTS = new Set([
  'i0.hdslb.com',
  'i1.hdslb.com',
  'i2.hdslb.com',
  'i3.hdslb.com',
  's1.hdslb.com',
  's2.hdslb.com',
]);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const src = searchParams.get('src');
    if (!src) {
      return NextResponse.json({ error: 'missing src' }, { status: 400 });
    }

    let target: URL;
    try {
      target = new URL(src);
    } catch {
      return NextResponse.json({ error: 'invalid src' }, { status: 400 });
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return NextResponse.json({ error: 'invalid protocol' }, { status: 400 });
    }
    if (!ALLOWED_HOSTS.has(target.hostname)) {
      return NextResponse.json(
        { error: 'host not allowed' },
        { status: 400 },
      );
    }

    const upstream = await fetch(target.toString(), {
      cache: 'no-store',
      headers: {
        // 某些 B 站 CDN 对无 referer 请求会 403
        referer: 'https://www.bilibili.com/',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `upstream ${upstream.status}` },
        { status: 502 },
      );
    }

    const buf = await upstream.arrayBuffer();
    const contentType =
      upstream.headers.get('content-type') ?? 'application/octet-stream';

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'content-type': contentType,
        'cache-control': 'public, max-age=86400, s-maxage=86400',
        'access-control-allow-origin': '*',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'proxy error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
