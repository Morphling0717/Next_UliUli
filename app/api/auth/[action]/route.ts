import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { run, get, hashPassword } from '@/lib/db';
import { getGachaState, initializeFreshGachaProfile, migrateLegacyGachaForUser } from '@/lib/gacha';

type UserAuthRow = {
  id: number;
  username: string;
  password_hash: string;
  salt: string;
  gacha_data: string | null;
  token: string;
};

type JsonObject = Record<string, unknown>;

const isSqliteUniqueError = (error: unknown) =>
  error instanceof Error && error.message.includes('UNIQUE');

export async function POST(request: NextRequest) {
  const action = request.nextUrl.pathname.split('/').pop();
  let body: JsonObject = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (action === 'register') {
    const { username, password } = body;
    if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
      return NextResponse.json({ error: "请输入用户名和密码" }, { status: 400 });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    const token = crypto.randomBytes(32).toString('hex');
    const dataStr = JSON.stringify({});

    try {
      const result = await run(
        'INSERT INTO users (username, password_hash, salt, token, gacha_data) VALUES (?, ?, ?, ?, ?)',
        [username, hash, salt, token, dataStr]
      );
      await initializeFreshGachaProfile(result.lastID);
      const state = await getGachaState(result.lastID);
      return NextResponse.json({ success: true, token, username, data: state });
    } catch (error) {
      if (isSqliteUniqueError(error)) return NextResponse.json({ error: "用户名已存在" }, { status: 400 });
      return NextResponse.json({ error: "数据库错误" }, { status: 500 });
    }
  }

  if (action === 'login') {
    const { username, password } = body;
    if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
      return NextResponse.json({ error: "请输入用户名和密码" }, { status: 400 });
    }

    try {
      const user = await get<UserAuthRow>('SELECT * FROM users WHERE username = ?', [username]);
      if (!user) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

      const hash = hashPassword(password, user.salt);
      if (hash !== user.password_hash) return NextResponse.json({ error: "密码错误" }, { status: 401 });

      const newToken = crypto.randomBytes(32).toString('hex');
      await run('UPDATE users SET token = ? WHERE id = ?', [newToken, user.id]);

      await migrateLegacyGachaForUser(user.id, user.gacha_data);
      const state = await getGachaState(user.id);

      return NextResponse.json({ success: true, token: newToken, username: user.username, data: state });
    } catch {
      return NextResponse.json({ error: "数据库错误" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}
