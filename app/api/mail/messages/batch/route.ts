import { NextResponse } from 'next/server';
import { run } from '@/lib/db';
import { verifyMailAdmin } from '@/lib/mail-auth';

/** 管理端批量操作：action = 'delete' | 'markRead' */
export async function POST(req: Request) {
  const auth = await verifyMailAdmin(req);
  if (auth) return auth;
  try {
    const body = (await req.json()) as { action?: string; ids?: string[] };
    const action = body.action;
    const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string') : [];
    if (!ids.length) {
      return NextResponse.json({ error: '未选择留言' }, { status: 400 });
    }

    const placeholders = ids.map(() => '?').join(', ');
    if (action === 'delete') {
      await run(
        `UPDATE mail_messages SET deleted_at = ?
         WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
        [new Date().toISOString(), ...ids],
      );
      return NextResponse.json({ ok: true });
    }
    if (action === 'markRead') {
      await run(
        `UPDATE mail_messages SET is_read = 1
         WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
        ids,
      );
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: '不支持的 action' }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '批量操作失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
