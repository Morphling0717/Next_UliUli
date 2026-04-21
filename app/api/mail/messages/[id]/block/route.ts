import { NextResponse } from 'next/server';
import { run, get } from '@/lib/db';
import { verifyMailAdmin } from '@/lib/mail-auth';
import { getTopicById, getTopicBySlug } from '@/lib/mail-topics';

/**
 * 管理端：把某条留言的发送者加入**全局黑名单**，并把这个发送者历史上的
 * 所有留言（跨主题）软删除。
 *
 * 为什么是跨主题：黑名单按 `sender_hash` 作为全局 id（单个主播场景下
 * 主播的意图就是"以后哪个主题都不要收 TA"）。但**触发拉黑的那条留言 id
 * 必须属于指定的 topicId**（跨主题防呆，方案 §5.5）——防止 tab 切换
 * 时前端状态错乱，把别的主题的留言 id 混进当前主题的拉黑操作。
 *
 * 跨主题防呆用查询参数 `?topicId=xxx`（不传默认 'default'）。
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await verifyMailAdmin(req);
  if (auth) return auth;
  try {
    const { id } = await ctx.params;

    // 主题定位（防呆）
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

    const msg = (await get(
      `SELECT id, sender_hash, sender_label, text FROM mail_messages
       WHERE id = ? AND topic_id = ? AND deleted_at IS NULL`,
      [id, topic.id],
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
    // 跨主题软删：这个 sender 在任何主题发过的未删信件统一埋掉
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
