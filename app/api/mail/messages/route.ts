import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  all,
  computeMailSenderIdentity,
  get,
  getClientIp,
  getMailBlockedTerms,
  matchBlockedTerm,
  run,
} from '@/lib/db';
import { verifyMailAdmin } from '@/lib/mail-auth';
import { rateLimit } from '@/lib/mail-rate-limit';
import { verifyTurnstile } from '@/lib/mail-turnstile';
import { getTopicBySlug, getTopicById } from '@/lib/mail-topics';

const MAX_TEXT = 1000;
const MAX_NICK = 32;
const MAX_LINK = 500;

/**
 * 服务端限流阈值。客户端也有一层滑动窗，但客户端是可被绕过的，
 * 真正兜底靠服务端。
 *
 * - 同 IP: 5 条 / 分钟，20 条 / 小时
 * - 同 fingerprint（即使换 IP）: 30 条 / 小时
 */
const RL_IP_PER_MIN = { max: 5, windowMs: 60_000 };
const RL_IP_PER_HOUR = { max: 20, windowMs: 60 * 60_000 };
const RL_FP_PER_HOUR = { max: 30, windowMs: 60 * 60_000 };

function rateLimitResponse(retryAfterMs: number) {
  const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return NextResponse.json(
    { error: `发信过于频繁，请 ${retryAfterSec} 秒后再试` },
    {
      status: 429,
      headers: { 'retry-after': String(retryAfterSec) },
    },
  );
}

/** 列表里命中敏感词的留言统一用这段占位文案替换原文 */
const FLAGGED_PLACEHOLDER = '⚠️ 此留言命中敏感词 · 在下方「待审核」区点击查看原文';

type Row = {
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
 * 行 → API 返回结构。
 * 当 `is_flagged=1` 时，返回给前端的 `text` / `nickname` / `linkUrl`
 * 全部被遮盖——确保 admin panel 直接渲染时不会在屏幕上上傲敏感词。
 * 如需读原文，走 `GET /api/mail/messages/[id]`。
 */
function rowToApi(r: Row) {
  const flagged = !!r.is_flagged;
  return {
    id: r.id,
    createdAt: r.created_at,
    text: flagged ? FLAGGED_PLACEHOLDER : r.text,
    nickname: flagged ? null : r.nickname,
    linkUrl: flagged ? null : r.link_url,
    isRead: !!r.is_read,
    isFavorited: !!r.is_favorited,
    isFlagged: flagged,
    senderLabel: r.sender_label,
    senderHash: r.sender_hash,
  };
}

/**
 * 列出留言（管理端）。
 *
 * 查询参数：
 * - `filter=all|unread|favorited` 既有的筛选
 * - `topicId=xxx` 主题筛选；**不传默认 `'default'`**（方案 §5.3 的设计预期：
 *   "左下角按钮 → 常规信箱 / 活动链接 → 活动主题"两条管道互不串）
 * - `topicId=all` 跨主题汇总（仅 v2 可能用到，但 API 先留好）
 *
 * counts 始终按**当前主题**统计（topicId=all 时不统计 counts，返回 0）。
 */
export async function GET(req: Request) {
  const auth = await verifyMailAdmin(req);
  if (auth) return auth;
  try {
    const url = new URL(req.url);
    const filter = url.searchParams.get('filter') ?? 'all';
    const topicIdParam = url.searchParams.get('topicId');
    const topicScope = topicIdParam ?? 'default';
    const isAllScope = topicScope === 'all';

    // 非 all 的 topicId 必须是一个存在的主题（id 或 slug 都接受）
    let resolvedTopicId: string | null = null;
    if (!isAllScope) {
      const byId = await getTopicById(topicScope);
      const topic = byId ?? (await getTopicBySlug(topicScope));
      if (!topic) {
        return NextResponse.json(
          { error: '主题不存在', code: 'TOPIC_NOT_FOUND' },
          { status: 404 },
        );
      }
      resolvedTopicId = topic.id;
    }

    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    if (resolvedTopicId !== null) {
      where.push('topic_id = ?');
      params.push(resolvedTopicId);
    }
    if (filter === 'unread') where.push('is_read = 0');
    else if (filter === 'favorited') where.push('is_favorited = 1');

    const rows = (await all(
      `SELECT id, created_at, text, nickname, link_url,
              is_read, is_favorited, is_flagged,
              sender_hash, sender_label
       FROM mail_messages
       WHERE ${where.join(' AND ')}
       ORDER BY datetime(created_at) DESC`,
      params,
    )) as Row[];

    // counts：按当前主题统计（topicId=all 时直接返回零，避免全表扫描）
    let counts = {
      all_cnt: 0,
      unread_cnt: 0,
      favorited_cnt: 0,
      flagged_cnt: 0,
    };
    if (resolvedTopicId !== null) {
      counts = (await get(
        `SELECT
           COUNT(*) AS all_cnt,
           COALESCE(SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END), 0) AS unread_cnt,
           COALESCE(SUM(is_favorited), 0) AS favorited_cnt,
           COALESCE(SUM(is_flagged), 0) AS flagged_cnt
         FROM mail_messages
         WHERE topic_id = ? AND deleted_at IS NULL`,
        [resolvedTopicId],
      )) as typeof counts;
    }

    return NextResponse.json({
      items: rows.map(rowToApi),
      counts: {
        all: Number(counts.all_cnt),
        unread: Number(counts.unread_cnt),
        favorited: Number(counts.favorited_cnt),
        flagged: Number(counts.flagged_cnt),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '数据库错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * 公开：新增一条留言。
 *
 * 主题归属由 URL / props 决定：
 * - 不传 `topicSlug` 或传 `'default'` → 落到常规信箱
 * - 传活动主题 slug → 落到对应主题
 *
 * 关闭 / 归档 / 时间窗外返回 423，带具体文案；每个主题独立开关，没有全局总闸。
 */
export async function POST(req: Request) {
  try {
    // IP 维度限流（在解析 body 之前就拒绝，节省处理成本）
    const ip = getClientIp(req);
    const ipMin = await rateLimit({ key: `mail:ip:min:${ip}`, ...RL_IP_PER_MIN });
    if (!ipMin.allowed) return rateLimitResponse(ipMin.retryAfterMs);
    const ipHour = await rateLimit({ key: `mail:ip:hour:${ip}`, ...RL_IP_PER_HOUR });
    if (!ipHour.allowed) return rateLimitResponse(ipHour.retryAfterMs);

    const body = (await req.json()) as {
      text?: string;
      nickname?: string | null;
      linkUrl?: string | null;
      senderFingerprint?: string | null;
      turnstileToken?: string | null;
      topicSlug?: string | null;
    };

    // 解析目标主题；不传视为 'default'（兼容旧前端）
    const slugInput =
      typeof body.topicSlug === 'string' && body.topicSlug.trim()
        ? body.topicSlug.trim()
        : 'default';
    const topic = await getTopicBySlug(slugInput);
    if (!topic) {
      return NextResponse.json(
        { error: '主题不存在', code: 'TOPIC_NOT_FOUND' },
        { status: 400 },
      );
    }
    // 归档 → 活动已结束
    if (topic.archivedAt) {
      return NextResponse.json(
        { error: '活动已结束，期待下次相遇', code: 'TOPIC_ARCHIVED' },
        { status: 423 },
      );
    }
    // 开关：default 和活动主题文案略有区别
    if (!topic.isEnabled) {
      return NextResponse.json(
        {
          error: topic.isDefault
            ? '发信箱暂时关闭，稍后再来投递吧 ~'
            : '活动暂停中，稍后再来投递吧 ~',
          code: 'TOPIC_DISABLED',
        },
        { status: 423 },
      );
    }
    // 时间窗（starts_at / ends_at 缺省视为无限）
    const now = Date.now();
    if (topic.startsAt && now < Date.parse(topic.startsAt)) {
      return NextResponse.json(
        { error: '活动还未开始，敬请期待 ~', code: 'TOPIC_NOT_STARTED' },
        { status: 423 },
      );
    }
    if (topic.endsAt && now > Date.parse(topic.endsAt)) {
      return NextResponse.json(
        { error: '活动已结束，期待下次相遇', code: 'TOPIC_ENDED' },
        { status: 423 },
      );
    }

    // fingerprint 维度限流（防换 IP 绕开）
    const fp = (body.senderFingerprint ?? '').trim();
    if (fp) {
      const fpHour = await rateLimit({
        key: `mail:fp:hour:${fp}`,
        ...RL_FP_PER_HOUR,
      });
      if (!fpHour.allowed) return rateLimitResponse(fpHour.retryAfterMs);
    }

    // Turnstile 人机校验：`TURNSTILE_SECRET` 未配置时此函数直接放行
    const turnstileFail = await verifyTurnstile(req, body.turnstileToken);
    if (turnstileFail) return turnstileFail;

    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return NextResponse.json({ error: '内容不能为空' }, { status: 400 });
    }
    if (text.length > MAX_TEXT) {
      return NextResponse.json(
        { error: `正文过长（最多 ${MAX_TEXT} 字）` },
        { status: 400 },
      );
    }

    const nickname: string | null =
      typeof body.nickname === 'string' ? body.nickname.trim() || null : null;
    if (nickname && nickname.length > MAX_NICK) {
      return NextResponse.json({ error: '称呼过长' }, { status: 400 });
    }

    let linkUrl: string | null = null;
    if (body.linkUrl != null && body.linkUrl !== '') {
      if (typeof body.linkUrl !== 'string') {
        return NextResponse.json({ error: '链接格式无效' }, { status: 400 });
      }
      const s = body.linkUrl.trim();
      if (s.length > MAX_LINK) {
        return NextResponse.json({ error: '链接过长' }, { status: 400 });
      }
      try {
        const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          return NextResponse.json(
            { error: '仅支持 http(s) 链接' },
            { status: 400 },
          );
        }
        linkUrl = u.toString();
      } catch {
        return NextResponse.json({ error: '链接格式无效' }, { status: 400 });
      }
    }

    // 敏感词命中：不拦截，只打标记。后续由主播在后台右侧"待审核"区
    // 手动展开查看。这样主播不会被敏感词直接糊脸，但信件本身仍然可阅。
    const blockedTerms = await getMailBlockedTerms();
    const isFlagged = matchBlockedTerm(blockedTerms, text, nickname, linkUrl) !== null;

    const { hash, label } = computeMailSenderIdentity(req, body.senderFingerprint);

    // 命中黑名单：对外假装成功，实际丢弃
    const blocked = await get(
      'SELECT hash FROM mail_blocklist WHERE hash = ?',
      [hash],
    );
    if (blocked) {
      return NextResponse.json({ ok: true }, { status: 202 });
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();

    await run(
      `INSERT INTO mail_messages
         (id, created_at, text, nickname, link_url, is_flagged,
          sender_hash, sender_label, topic_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        createdAt,
        text,
        nickname,
        linkUrl,
        isFlagged ? 1 : 0,
        hash,
        label,
        topic.id,
      ],
    );

    return NextResponse.json(
      rowToApi({
        id,
        created_at: createdAt,
        text,
        nickname,
        link_url: linkUrl,
        is_read: 0,
        is_favorited: 0,
        is_flagged: isFlagged ? 1 : 0,
        sender_hash: hash,
        sender_label: label,
      }),
      { status: 201 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : '保存失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
