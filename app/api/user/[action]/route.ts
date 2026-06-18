import { NextRequest, NextResponse } from 'next/server';
import { GachaError, getGachaState, getGachaUserByToken } from '@/lib/gacha';

type JsonObject = Record<string, unknown>;

export async function POST(request: NextRequest) {
  const action = request.nextUrl.pathname.split('/').pop();
  let body: JsonObject = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (action === 'sync') {
    const { token } = body;
    if (typeof token !== "string" || !token) return NextResponse.json({ error: "未登录" }, { status: 401 });

    try {
      await getGachaUserByToken(token);
      return NextResponse.json({ success: true, ignored: true });
    } catch (error) {
      const status = error instanceof GachaError ? error.status : 500;
      return NextResponse.json({ error: error instanceof Error ? error.message : "同步失败" }, { status });
    }
  }

  if (action === 'me') {
    const { token } = body;
    if (typeof token !== "string" || !token) return NextResponse.json({ error: "未登录" }, { status: 401 });

    try {
      const user = await getGachaUserByToken(token);
      const state = await getGachaState(user.id);
      return NextResponse.json({ success: true, username: user.username, data: state });
    } catch (error) {
      const status = error instanceof GachaError ? error.status : 500;
      return NextResponse.json({ error: error instanceof Error ? error.message : "数据库错误" }, { status });
    }
  }

  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}
