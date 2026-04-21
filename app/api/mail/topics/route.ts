import { NextResponse } from 'next/server';
import { isMailAdminHeader, verifyMailAdmin } from '@/lib/mail-auth';
import {
  MailTopicError,
  createTopic,
  listTopics,
  type TopicCreateInput,
} from '@/lib/mail-topics';

export const dynamic = 'force-dynamic';

/**
 * 工具：把 MailTopicError / 其它异常统一映射为 JSON 响应。
 */
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
 * GET /api/mail/topics
 *
 * - 公开（不带密码）：只返回可投信的活动主题（is_enabled=1 AND 未归档 AND
 *   在时间窗内 AND is_default=0）
 * - 管理端（带 `x-mail-password` 且正确）：返回全部主题；
 *   `?include=archived` 控制是否包含已归档；默认**不含**归档，归档走另一次
 *   独立请求供抽屉用
 *
 * 管理端返回的每个主题带 `unreadCount` / `flaggedCount`（用于主 tab 栏 badge）。
 */
export async function GET(req: Request) {
  try {
    const isAdmin = isMailAdminHeader(req);
    if (isAdmin) {
      const url = new URL(req.url);
      const includeArchived = url.searchParams.get('include') === 'archived';
      const topics = await listTopics({
        includeArchived,
        withCounts: true,
      });
      return NextResponse.json({ items: topics });
    }

    // 公开端：只有可投信的活动主题
    const topics = await listTopics({ onlyPublicActive: true });
    return NextResponse.json({ items: topics });
  } catch (e) {
    return errorResponse(e, 500, '读取主题列表失败');
  }
}

/**
 * POST /api/mail/topics
 * 管理端：创建新主题。
 *
 * 写入保护：请求体里的 `id` / `is_default` / `isDefault` / `created_at` /
 * `createdAt` 一律被剥离，服务端自己生成。
 */
export async function POST(req: Request) {
  const auth = await verifyMailAdmin(req);
  if (auth) return auth;
  try {
    const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object') {
      return NextResponse.json(
        { error: '请求体必须是 JSON 对象' },
        { status: 400 },
      );
    }

    // 写入保护：剥离不允许外部赋值的字段
    const input: TopicCreateInput = {
      slug: typeof raw.slug === 'string' ? raw.slug : '',
      title: typeof raw.title === 'string' ? raw.title : '',
      description: (raw.description as string | null | undefined) ?? null,
      note: (raw.note as string | null | undefined) ?? null,
      isEnabled:
        typeof raw.isEnabled === 'boolean' ? raw.isEnabled : undefined,
      startsAt: (raw.startsAt as string | null | undefined) ?? null,
      endsAt: (raw.endsAt as string | null | undefined) ?? null,
      sortOrder:
        typeof raw.sortOrder === 'number' ? raw.sortOrder : undefined,
    };

    const topic = await createTopic(input);
    return NextResponse.json(topic, { status: 201 });
  } catch (e) {
    return errorResponse(e, 500, '创建主题失败');
  }
}
