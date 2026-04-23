import { NextResponse } from 'next/server';
import { run, get } from '@/lib/db';
import { verifyMailAdmin } from '@/lib/mail-auth';
import { getTopicById, getTopicBySlug } from '@/lib/mail-topics';

type FullRow = {
  id: string;
  created_at: string;
  text: string;
  nickname: string | null;
  link_url: string | null;
  is_read: number;
  is_favorited: number;
  is_flagged: number;
  sender_hash: string | null;
  sender_label: string | null;
};

/**
 * 解析 ?topicId= 参数为实际的 topic_id（UUID）。
 * - 不传：默认 'default'（向后兼容；方案 §7 的零破坏保证）
 * - 传了：按 id / slug 都可，解析失败返回 null（handler 应返回 404）
 */
async function resolveTopicIdFromQuery(
  url: URL,
): Promise<{ topicId: string } | { error: 'TOPIC_NOT_FOUND' }> {
  const param = url.searchParams.get('topicId') ?? 'default';
  const byId = await getTopicById(param);
  const topic = byId ?? (await getTopicBySlug(param));
  if (!topic) return { error: 'TOPIC_NOT_FOUND' };
  return { topicId: topic.id };
}

function topicNotFoundResponse() {
  return NextResponse.json(
    { error: '主题不存在', code: 'TOPIC_NOT_FOUND' },
    { status: 404 },
  );
}

/**
 * 管理端：读单条留言原文（不做遮盖，用于审核敏感词命中的留言）。
 *
 * 跨主题防呆：WHERE 条件带 `AND topic_id = ?`。不传 `?topicId=` 默认
 * 锁定到 default 主题，防止从某个主题 tab 误请求到别的主题的 id。
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await verifyMailAdmin(req);
  if (auth) return auth;
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const scope = await resolveTopicIdFromQuery(url);
    if ('error' in scope) return topicNotFoundResponse();

    const row = (await get(
      `SELECT id, created_at, text, nickname, link_url,
              is_read, is_favorited, is_flagged,
              sender_hash, sender_label
       FROM mail_messages
       WHERE id = ? AND topic_id = ? AND deleted_at IS NULL`,
      [id, scope.topicId],
    )) as FullRow | undefined;
    if (!row) {
      return NextResponse.json({ error: '未找到留言' }, { status: 404 });
    }
    return NextResponse.json({
      id: row.id,
      createdAt: row.created_at,
      text: row.text,
      nickname: row.nickname,
      linkUrl: row.link_url,
      isRead: !!row.is_read,
      isFavorited: !!row.is_favorited,
      isFlagged: !!row.is_flagged,
      senderLabel: row.sender_label,
      senderHash: row.sender_hash,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '读取失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * 管理端：更新单条。跨主题防呆同 GET。
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await verifyMailAdmin(req);
  if (auth) return auth;
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const scope = await resolveTopicIdFromQuery(url);
    if ('error' in scope) return topicNotFoundResponse();

    const body = (await req.json()) as {
      isRead?: boolean;
      isFavorited?: boolean;
      isFlagged?: boolean;
    };

    const sets: string[] = [];
    const params: unknown[] = [];
    if (typeof body.isRead === 'boolean') {
      sets.push('is_read = ?');
      params.push(body.isRead ? 1 : 0);
    }
    if (typeof body.isFavorited === 'boolean') {
      sets.push('is_favorited = ?');
      params.push(body.isFavorited ? 1 : 0);
    }
    if (typeof body.isFlagged === 'boolean') {
      sets.push('is_flagged = ?');
      params.push(body.isFlagged ? 1 : 0);
    }
    if (sets.length === 0) {
      return NextResponse.json({ error: '无更新字段' }, { status: 400 });
    }
    params.push(id);
    params.push(scope.topicId);
    await run(
      `UPDATE mail_messages SET ${sets.join(', ')}
       WHERE id = ? AND topic_id = ? AND deleted_at IS NULL`,
      params,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '更新失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * 管理端：软删单条。跨主题防呆同 GET。
 */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await verifyMailAdmin(req);
  if (auth) return auth;
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const scope = await resolveTopicIdFromQuery(url);
    if ('error' in scope) return topicNotFoundResponse();

    const existing = (await get(
      `SELECT id FROM mail_messages
       WHERE id = ? AND topic_id = ? AND deleted_at IS NULL`,
      [id, scope.topicId],
    )) as { id: string } | undefined;
    if (!existing) {
      return NextResponse.json({ error: '未找到留言' }, { status: 404 });
    }
    await run(
      'UPDATE mail_messages SET deleted_at = ? WHERE id = ? AND topic_id = ?',
      [new Date().toISOString(), id, scope.topicId],
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '删除失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
