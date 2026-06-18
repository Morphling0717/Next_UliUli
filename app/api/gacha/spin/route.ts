import { NextRequest, NextResponse } from 'next/server';
import { GachaError, getGachaUserByToken, spinGacha } from '@/lib/gacha';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const user = await getGachaUserByToken(body.token);
    const result = await spinGacha(user.id);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const status = error instanceof GachaError ? error.status : 500;
    const message = error instanceof Error ? error.message : '服务器错误';
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
