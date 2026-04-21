import { NextResponse } from 'next/server';
import { run, get } from '@/lib/db';
import { verifyMailAdmin } from '@/lib/mail-auth';

/** 管理端：把某条留言的发送者加入黑名单，并将该发送者已有留言软删除。 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await verifyMailAdmin(req);
  if (auth) return auth;
  try {
    const { id } = await ctx.params;
    const msg = (await get(
      'SELECT id, sender_hash, sender_label, text FROM mail_messages WHERE id = ? AND deleted_at IS NULL',
      [id],
    )) as
      | {
          id: string;
          sender_hash: string | null;
          sender_label: string | null;
          text: string;
        }
      | undefined;
    if (!msg) return NextResponse.json({ error: '未找到留言' }, { status: 404 });
    if (!msg.sender_hash) {
      return NextResponse.json(
        { error: '该留言缺少发送者指纹，无法拉黑' },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    await run(
      `INSERT INTO mail_blocklist (hash, label, blocked_at, sample_text)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(hash) DO UPDATE SET
         label = excluded.label,
         blocked_at = excluded.blocked_at,
         sample_text = excluded.sample_text`,
      [msg.sender_hash, msg.sender_label, now, msg.text.slice(0, 80)],
    );
    await run(
      `UPDATE mail_messages SET deleted_at = ?
       WHERE sender_hash = ? AND deleted_at IS NULL`,
      [now, msg.sender_hash],
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    const err = e instanceof Error ? e.message : '拉黑失败';
    return NextResponse.json({ error: err }, { status: 500 });
  }
}
