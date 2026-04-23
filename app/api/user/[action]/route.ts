import { NextRequest, NextResponse } from 'next/server';
import { run, get } from '@/lib/db';

type UserProfileRow = {
  username: string;
  gacha_data: string | null;
};

export async function POST(request: NextRequest) {
  const action = request.nextUrl.pathname.split('/').pop();
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (action === 'sync') {
    const { token, data } = body;
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const dataStr = JSON.stringify(data);
    try {
      const result = await run('UPDATE users SET gacha_data = ? WHERE token = ?', [dataStr, token]);
      // Note: sqlite3 wrapper this.changes equivalent, might be omitted in basic wraps, assuming success
      if (result && result.changes === 0) return NextResponse.json({ error: "Token 无效或过期" }, { status: 401 });
      return NextResponse.json({ success: true });
    } catch (err) {
      return NextResponse.json({ error: "同步失败" }, { status: 500 });
    }
  }

  if (action === 'me') {
    const { token } = body;
    try {
      const user = await get<UserProfileRow>('SELECT username, gacha_data FROM users WHERE token = ?', [token]);
      if (!user) return NextResponse.json({ error: "无效 Token" }, { status: 401 });
      
      let cloudData = {};
      try { cloudData = JSON.parse(user.gacha_data ?? '{}'); } catch(e) {}
      return NextResponse.json({ success: true, username: user.username, data: cloudData });
    } catch (err) {
      return NextResponse.json({ error: "数据库错误" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}