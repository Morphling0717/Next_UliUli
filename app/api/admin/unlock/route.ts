import { NextRequest, NextResponse } from 'next/server';

const DEV_UNLOCK_PASSWORD = process.env.DEV_UNLOCK_PASSWORD;

export async function POST(request: NextRequest) {
  try {
    if (!DEV_UNLOCK_PASSWORD) {
      return NextResponse.json(
        { success: false, message: '服务器未配置 DEV_UNLOCK_PASSWORD 环境变量' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const password = body?.password;

    if (typeof password !== 'string' || !password) {
      return NextResponse.json({ success: false, message: '密码不能为空' }, { status: 400 });
    }

    if (password !== DEV_UNLOCK_PASSWORD) {
      return NextResponse.json({ success: false, message: '密码错误' }, { status: 401 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: '服务器错误: ' + error.message },
      { status: 500 }
    );
  }
}
