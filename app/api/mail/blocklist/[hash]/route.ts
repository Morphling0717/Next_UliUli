import { NextResponse } from 'next/server';
import { run } from '@/lib/db';
import { verifyMailAdmin } from '@/lib/mail-auth';

/** 管理端：解除某个发送者的拉黑。 */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ hash: string }> },
) {
  const auth = await verifyMailAdmin(req);
  if (auth) return auth;
  try {
    const { hash } = await ctx.params;
    await run('DELETE FROM mail_blocklist WHERE hash = ?', [hash]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '解除失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
