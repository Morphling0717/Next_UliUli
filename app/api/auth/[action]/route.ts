import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { run, get, hashPassword } from '@/lib/db';

export async function POST(request: NextRequest) {
  const action = request.nextUrl.pathname.split('/').pop();
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (action === 'register') {
    const { username, password, initialData } = body;
    if (!username || !password) return NextResponse.json({ error: "请输入用户名和密码" }, { status: 400 });

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    const token = crypto.randomBytes(32).toString('hex');
    const dataStr = JSON.stringify(initialData || {});

    try {
      await run(
        'INSERT INTO users (username, password_hash, salt, token, gacha_data) VALUES (?, ?, ?, ?, ?)',
        [username, hash, salt, token, dataStr]
      );
      return NextResponse.json({ success: true, token, username });
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) return NextResponse.json({ error: "用户名已存在" }, { status: 400 });
      return NextResponse.json({ error: "数据库错误" }, { status: 500 });
    }
  }

  if (action === 'login') {
    const { username, password } = body;
    try {
      const user = await get('SELECT * FROM users WHERE username = ?', [username]);
      if (!user) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

      const hash = hashPassword(password, user.salt);
      if (hash !== user.password_hash) return NextResponse.json({ error: "密码错误" }, { status: 401 });

      const newToken = crypto.randomBytes(32).toString('hex');
      await run('UPDATE users SET token = ? WHERE id = ?', [newToken, user.id]);

      let cloudData = {};
      try { cloudData = JSON.parse(user.gacha_data); } catch(e) {}

      return NextResponse.json({ success: true, token: newToken, username: user.username, data: cloudData });
    } catch (err) {
      return NextResponse.json({ error: "数据库错误" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}