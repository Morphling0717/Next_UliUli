import { NextRequest, NextResponse } from 'next/server';
import { GachaError, getGachaState, getGachaUserByToken } from '@/lib/gacha';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const user = await getGachaUserByToken(body.token);
    const state = await getGachaState(user.id);
    return NextResponse.json({ success: true, username: user.username, data: state });
  } catch (error) {
    const status = error instanceof GachaError ? error.status : 500;
    const message = error instanceof Error ? error.message : '服务器错误';
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
