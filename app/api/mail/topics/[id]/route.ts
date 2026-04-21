import { NextResponse } from 'next/server';
import { isMailAdminHeader, verifyMailAdmin } from '@/lib/mail-auth';
import {
  MailTopicError,
  archiveTopic,
  getTopicById,
  getTopicBySlug,
  updateTopic,
  type Topic,
  type TopicUpdateInput,
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

/**
 * 按 [id] 参数定位主题：先按 id（UUID）查，查不到再按 slug 查。
 *
 * 这样 `/api/mail/topics/default` 和 `/api/mail/topics/{uuid}` 都可以命中
 * 同一个 default 主题；也让 `/api/mail/topics/{slug}` 的公开 GET 零成本实现。
 */
async function resolveTopic(idOrSlug: string): Promise<Topic | null> {
  const byId = await getTopicById(idOrSlug);
  if (byId) return byId;
  return await getTopicBySlug(idOrSlug);
}

/**
 * GET /api/mail/topics/{idOrSlug}
 *
 * - 公开：返回主题的公开字段（title / description / state / isEnabledNow 等）
 * - 管理端（带密码）：返回全部字段（含 note）
 *
 * 用于：
 * - `/m/[slug]` SSR 预取
 * - 管理台详情面板
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const topic = await resolveTopic(id);
    if (!topic) {
      return NextResponse.json({ error: '主题不存在' }, { status: 404 });
    }

    // 非管理员不返回 note（主播的内部备注）
    if (!isMailAdminHeader(req)) {
      const { note: _note, ...publicFields } = topic;
      void _note;
      return NextResponse.json(publicFields);
    }
    return NextResponse.json(topic);
  } catch (e) {
    return errorResponse(e, 500, '读取主题失败');
  }
}

/**
 * PATCH /api/mail/topics/{idOrSlug}
 * 管理端：更新主题字段。写入保护 + default 主题字段白名单见
 * `lib/mail-topics.ts#updateTopic`。
 *
 * 特殊：`archivedAt: null` 用于恢复归档。
 */
export async function PATCH(
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

    const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object') {
      return NextResponse.json(
        { error: '请求体必须是 JSON 对象' },
        { status: 400 },
      );
    }

    // 写入保护：只接受白名单字段；id/is_default/created_at/slug 会在
    // updateTopic 内部拒绝或忽略
    const patch: TopicUpdateInput & { slug?: unknown } = {};
    if (raw.title !== undefined) patch.title = raw.title as string;
    if (raw.description !== undefined) patch.description = raw.description as string | null;
    if (raw.note !== undefined) patch.note = raw.note as string | null;
    if (raw.isEnabled !== undefined) patch.isEnabled = !!raw.isEnabled;
    if (raw.startsAt !== undefined) patch.startsAt = raw.startsAt as string | null;
    if (raw.endsAt !== undefined) patch.endsAt = raw.endsAt as string | null;
    if (raw.sortOrder !== undefined) patch.sortOrder = raw.sortOrder as number;
    // archivedAt 只接受 null（恢复语义）；其它值会被 updateTopic 当作未定义忽略
    if (raw.archivedAt === null) patch.archivedAt = null;
    // 把 slug 显式透传，让 updateTopic 抛 SLUG_NOT_EDITABLE（而不是静默忽略）
    if (raw.slug !== undefined) patch.slug = raw.slug;

    const updated = await updateTopic(topic.id, patch);
    return NextResponse.json(updated);
  } catch (e) {
    return errorResponse(e, 500, '更新主题失败');
  }
}

/**
 * DELETE /api/mail/topics/{idOrSlug}
 * 管理端：归档主题（软删）。
 *
 * 响应里带 `{ unreadCount, flaggedCount }` 让前端决定是否弹二次确认
 * （方案 §6.1.1）。
 *
 * 注：默认主题不可归档 → 返回 400（见 MailTopicErrors.defaultNotArchivable）。
 */
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

    const result = await archiveTopic(topic.id);
    return NextResponse.json({
      topic: result.topic,
      unreadCount: result.unreadCount,
      flaggedCount: result.flaggedCount,
    });
  } catch (e) {
    return errorResponse(e, 500, '归档主题失败');
  }
}
