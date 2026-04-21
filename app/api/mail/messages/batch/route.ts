import { NextResponse } from 'next/server';
import { run } from '@/lib/db';
import { verifyMailAdmin } from '@/lib/mail-auth';
import { getTopicById, getTopicBySlug } from '@/lib/mail-topics';

/**
 * 管理端批量操作：action = 'delete' | 'markRead'
 *
 * 跨主题防呆：`?topicId=xxx`（不传默认 'default'）。SQL 条件带
 * `AND topic_id = ?`，防止"在 A 主题 tab 下点批量删除，却把 B 主题的信也
 * 一刀切"的状态错乱事故（方案 §5.5）。
 */
export async function POST(req: Request) {
  const auth = await verifyMailAdmin(req);
  if (auth) return auth;
  try {
    // 主题定位
    const url = new URL(req.url);
    const topicParam = url.searchParams.get('topicId') ?? 'default';
    const byId = await getTopicById(topicParam);
    const topic = byId ?? (await getTopicBySlug(topicParam));
    if (!topic) {
      return NextResponse.json(
        { error: '主题不存在', code: 'TOPIC_NOT_FOUND' },
        { status: 404 },
      );
    }

    const body = (await req.json()) as { action?: string; ids?: string[] };
    const action = body.action;
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((x) => typeof x === 'string')
      : [];
    if (!ids.length) {
      return NextResponse.json({ error: '未选择留言' }, { status: 400 });
    }

    const placeholders = ids.map(() => '?').join(', ');
    if (action === 'delete') {
      await run(
        `UPDATE mail_messages SET deleted_at = ?
         WHERE id IN (${placeholders}) AND topic_id = ? AND deleted_at IS NULL`,
        [new Date().toISOString(), ...ids, topic.id],
      );
      return NextResponse.json({ ok: true });
    }
    if (action === 'markRead') {
      await run(
        `UPDATE mail_messages SET is_read = 1
         WHERE id IN (${placeholders}) AND topic_id = ? AND deleted_at IS NULL`,
        [...ids, topic.id],
      );
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: '不支持的 action' }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '批量操作失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
