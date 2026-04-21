import { NextResponse } from 'next/server';
import { verifyMailAdmin } from '@/lib/mail-auth';
import {
  MailTopicError,
  getDefaultTopic,
  updateTopic,
} from '@/lib/mail-topics';

export const dynamic = 'force-dynamic';

/**
 * **语义透明切换**（方案 §5.4）：
 *
 * 此端点保留但内部实现改为 default 主题 `is_enabled` 字段的**透传**：
 * - GET 返回 default 主题的 `isEnabled`
 * - PUT 代写 default 主题的 `isEnabled`
 *
 * 响应形状和旧版**完全一致**（`{ enabled: boolean }`），目的是让
 * `MailSpeedDial` / `MailSendModal` 的现有轮询代码 0 改动就能工作。
 *
 * 新代码应直接走 `PATCH /api/mail/topics/{id}`；此端点仅作兼容层保留。
 */

/** 公开：读取 default 主题的开关状态（供浮动按钮轮询）。 */
export async function GET() {
  try {
    const topic = await getDefaultTopic();
    // 理论上 default 主题由 db.ts 启动时自举；未拿到时按开启兜底，避免
    // 前端因偶发启动时序问题误显示为"关闭"
    const enabled = topic ? topic.isEnabled : true;
    return NextResponse.json({ enabled });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '读取失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** 管理端：切换 default 主题的开关。 */
export async function PUT(req: Request) {
  const auth = await verifyMailAdmin(req);
  if (auth) return auth;
  try {
    const body = (await req.json()) as { enabled?: boolean };
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled 字段必须是布尔值' },
        { status: 400 },
      );
    }
    const topic = await getDefaultTopic();
    if (!topic) {
      return NextResponse.json(
        { error: '默认主题未初始化，请稍后重试' },
        { status: 503 },
      );
    }
    const updated = await updateTopic(topic.id, { isEnabled: body.enabled });
    return NextResponse.json({ enabled: updated.isEnabled });
  } catch (e) {
    if (e instanceof MailTopicError) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.status },
      );
    }
    const msg = e instanceof Error ? e.message : '保存失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
