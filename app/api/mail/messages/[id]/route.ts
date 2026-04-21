import { NextResponse } from 'next/server';
import { run, get } from '@/lib/db';
import { verifyMailAdmin } from '@/lib/mail-auth';

type FullRow = {
  id: string;
  created_at: string;
  text: string;
  nickname: string | null;
  link_url: string | null;
  is_read: number;
  is_favorited: number;
  is_replied: number;
  is_flagged: number;
  reply_text: string | null;
  sender_hash: string | null;
  sender_label: string | null;
};

/** 管理端：读单条留言原文（不做遮盖，用于审核敏感词命中的留言） */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await verifyMailAdmin(req);
  if (auth) return auth;
  try {
    const { id } = await ctx.params;
    const row = (await get(
      `SELECT id, created_at, text, nickname, link_url,
              is_read, is_favorited, is_replied, is_flagged, reply_text,
              sender_hash, sender_label
       FROM mail_messages
       WHERE id = ? AND deleted_at IS NULL`,
      [id],
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
      isReplied: !!row.is_replied,
      isFlagged: !!row.is_flagged,
      replyText: row.reply_text,
      senderLabel: row.sender_label,
      senderHash: row.sender_hash,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '读取失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** 管理端：更新单条（PATCH）或软删除（DELETE）。 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await verifyMailAdmin(req);
  if (auth) return auth;
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as {
      isRead?: boolean;
      isFavorited?: boolean;
      isReplied?: boolean;
      replyText?: string | null;
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
    if (typeof body.isReplied === 'boolean') {
      sets.push('is_replied = ?');
      params.push(body.isReplied ? 1 : 0);
    }
    if (body.replyText !== undefined) {
      sets.push('reply_text = ?');
      params.push(body.replyText);
    }
    if (sets.length === 0) {
      return NextResponse.json({ error: '无更新字段' }, { status: 400 });
    }
    params.push(id);
    await run(
      `UPDATE mail_messages SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '更新失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await verifyMailAdmin(req);
  if (auth) return auth;
  try {
    const { id } = await ctx.params;
    const existing = (await get(
      'SELECT id FROM mail_messages WHERE id = ? AND deleted_at IS NULL',
      [id],
    )) as { id: string } | undefined;
    if (!existing) {
      return NextResponse.json({ error: '未找到留言' }, { status: 404 });
    }
    await run(
      'UPDATE mail_messages SET deleted_at = ? WHERE id = ?',
      [new Date().toISOString(), id],
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '删除失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
