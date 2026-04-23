import { NextResponse } from 'next/server';
import { verifyMailAdmin } from '@/lib/mail-auth';
import {
  MailTopicError,
  deleteArchivedTopic,
  getTopicById,
  getTopicBySlug,
  type Topic,
} from '@/lib/mail-topics';

export const dynamic = 'force-dynamic';

function errorResponse(e: unknown, fallbackStatus = 500, fallbackMsg = '服务器错误') {
  if (e instanceof MailTopicError) {
    return NextResponse.json(
      { error: e.message, code: e.code },
      { status: e.status },
    );
  }
  const msg = e instanceof Error ? e.message : fallbackMsg;
  return NextResponse.json({ error: msg }, { status: fallbackStatus });
}

async function resolveTopic(idOrSlug: string): Promise<Topic | null> {
  const byId = await getTopicById(idOrSlug);
  if (byId) return byId;
  return await getTopicBySlug(idOrSlug);
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await verifyMailAdmin(req);
  if (auth) return auth;
  try {
    const { id } = await ctx.params;
    const topic = await resolveTopic(id);
    if (!topic) {
      return NextResponse.json({ error: '主题不存在' }, { status: 404 });
    }

    const deleted = await deleteArchivedTopic(topic.id);
    return NextResponse.json({ ok: true, topic: deleted });
  } catch (e) {
    return errorResponse(e, 500, '删除主题失败');
  }
}
