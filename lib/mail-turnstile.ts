/**
 * Cloudflare Turnstile 服务端校验。
 *
 * - 未配置 `TURNSTILE_SECRET` env 时本模块是"空操作"，直接放行，
 *   这样本地开发/未接 Cloudflare 的部署都能跑通。
 * - 配置了 secret 就必须提交一个有效 token，否则返回 403。
 */

import { NextResponse } from 'next/server';
import { getClientIp } from './db';

const VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * 验证 Turnstile token。
 * @returns 若未配置或验证通过返回 null；否则返回应直接透传的 NextResponse。
 */
export async function verifyTurnstile(
  req: Request,
  token: string | null | undefined,
): Promise<NextResponse | null> {
  const secret = process.env.TURNSTILE_SECRET?.trim();
  if (!secret) return null; // 未配置：跳过

  const t = (token ?? '').trim();
  if (!t) {
    return NextResponse.json(
      { error: '人机校验未完成，请先完成 Turnstile' },
      { status: 403 },
    );
  }

  try {
    const form = new URLSearchParams();
    form.set('secret', secret);
    form.set('response', t);
    const ip = getClientIp(req);
    if (ip && ip !== '0.0.0.0') form.set('remoteip', ip);

    const r = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      cache: 'no-store',
    });
    if (!r.ok) {
      return NextResponse.json(
        { error: '人机校验服务暂不可用' },
        { status: 502 },
      );
    }
    const data = (await r.json()) as { success?: boolean };
    if (!data.success) {
      return NextResponse.json(
        { error: '人机校验未通过，请重试' },
        { status: 403 },
      );
    }
    return null;
  } catch {
    return NextResponse.json(
      { error: '人机校验请求失败，请稍后再试' },
      { status: 502 },
    );
  }
}
