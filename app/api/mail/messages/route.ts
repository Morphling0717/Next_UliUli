import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  MAIL_ENABLED_KEY,
  all,
  computeMailSenderIdentity,
  get,
  getClientIp,
  getMailBlockedTerms,
  getMailBoolSetting,
  matchBlockedTerm,
  run,
} from '@/lib/db';
import { verifyMailAdmin } from '@/lib/mail-auth';
import { rateLimit } from '@/lib/mail-rate-limit';
import { verifyTurnstile } from '@/lib/mail-turnstile';

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
  is_replied: number;
  is_flagged: number;
  reply_text: string | null;
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
    isReplied: !!r.is_replied,
    isFlagged: flagged,
    replyText: r.reply_text,
    senderLabel: r.sender_label,
    senderHash: r.sender_hash,
  };
}

/** 列出留言（管理端）。支持 ?filter=all|unread|favorited|replied */
export async function GET(req: Request) {
  const auth = await verifyMailAdmin(req);
  if (auth) return auth;
  try {
    const url = new URL(req.url);
    const filter = url.searchParams.get('filter') ?? 'all';

    const where: string[] = ['deleted_at IS NULL'];
    if (filter === 'unread') where.push('is_read = 0');
    else if (filter === 'favorited') where.push('is_favorited = 1');
    else if (filter === 'replied') where.push('is_replied = 1');

    const rows = (await all(
      `SELECT id, created_at, text, nickname, link_url,
              is_read, is_favorited, is_replied, is_flagged, reply_text,
              sender_hash, sender_label
       FROM mail_messages
       WHERE ${where.join(' AND ')}
       ORDER BY datetime(created_at) DESC`,
    )) as Row[];

    const counts = (await get(
      `SELECT
         COUNT(*) AS all_cnt,
         COALESCE(SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END), 0) AS unread_cnt,
         COALESCE(SUM(is_favorited), 0) AS favorited_cnt,
         COALESCE(SUM(is_replied), 0) AS replied_cnt,
         COALESCE(SUM(is_flagged), 0) AS flagged_cnt
       FROM mail_messages
       WHERE deleted_at IS NULL`,
    )) as {
      all_cnt: number;
      unread_cnt: number;
      favorited_cnt: number;
      replied_cnt: number;
      flagged_cnt: number;
    };

    return NextResponse.json({
      items: rows.map(rowToApi),
      counts: {
        all: Number(counts.all_cnt),
        unread: Number(counts.unread_cnt),
        favorited: Number(counts.favorited_cnt),
        replied: Number(counts.replied_cnt),
        flagged: Number(counts.flagged_cnt),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '数据库错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** 公开：新增一条留言。关闭时返回 423。 */
export async function POST(req: Request) {
  try {
    if (!(await getMailBoolSetting(MAIL_ENABLED_KEY, true))) {
      return NextResponse.json(
        { error: '发信箱暂时关闭，稍后再来投递吧 ~' },
        { status: 423 },
      );
    }

    // IP 维度限流（在解析 body 之前就拒绝，节省处理成本）
    const ip = getClientIp(req);
    const ipMin = rateLimit({ key: `mail:ip:min:${ip}`, ...RL_IP_PER_MIN });
    if (!ipMin.allowed) return rateLimitResponse(ipMin.retryAfterMs);
    const ipHour = rateLimit({ key: `mail:ip:hour:${ip}`, ...RL_IP_PER_HOUR });
    if (!ipHour.allowed) return rateLimitResponse(ipHour.retryAfterMs);

    const body = (await req.json()) as {
      text?: string;
      nickname?: string | null;
      linkUrl?: string | null;
      senderFingerprint?: string | null;
      turnstileToken?: string | null;
    };

    // fingerprint 维度限流（防换 IP 绕开）
    const fp = (body.senderFingerprint ?? '').trim();
    if (fp) {
      const fpHour = rateLimit({
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
         (id, created_at, text, nickname, link_url, is_flagged, sender_hash, sender_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, createdAt, text, nickname, linkUrl, isFlagged ? 1 : 0, hash, label],
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
        is_replied: 0,
        is_flagged: isFlagged ? 1 : 0,
        reply_text: null,
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
