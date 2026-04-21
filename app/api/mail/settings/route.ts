import { NextResponse } from 'next/server';
import {
  MAIL_ENABLED_KEY,
  getMailBoolSetting,
  setMailBoolSetting,
} from '@/lib/db';
import { verifyMailAdmin } from '@/lib/mail-auth';

export const dynamic = 'force-dynamic';

/** 公开：读取发信箱开关状态（供浮动按钮轮询）。 */
export async function GET() {
  try {
    const enabled = await getMailBoolSetting(MAIL_ENABLED_KEY, true);
    return NextResponse.json({ enabled });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '读取失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** 管理端：切换发信箱开关。 */
export async function PUT(req: Request) {
  const auth = await verifyMailAdmin(req);
  if (auth) return auth;
  try {
    const body = (await req.json()) as { enabled?: boolean };
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled 字段必须是布尔值' },
        { status: 400 },
      );
    }
    await setMailBoolSetting(MAIL_ENABLED_KEY, body.enabled);
    return NextResponse.json({ enabled: body.enabled });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '保存失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
