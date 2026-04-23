/**
 * Mail Topics 领域模块
 * ---------------------------------------------------------------
 * 集中主题收件箱（mail_topics 表）的 CRUD、校验、派生状态计算与
 * 跨主题黑/白字段保护。API 路由和管理台都走这里，保证行为一致。
 *
 * 关键约定（详见 MAIL_TOPICS_PROPOSAL.md）：
 * - 没有全局总闸：每个主题独立 is_enabled
 * - 保护字段：API 永不接受外部写入 id / is_default / created_at
 * - default 主题由 db.ts 启动时自举，是唯一 is_default=1 的行
 * - 时间字段对外一律用 ISO 8601 UTC Z 串
 */

import { randomUUID } from 'node:crypto';
import { all, get, run } from './db';

// ==============================================================
// 常量 & 校验规则
// ==============================================================

/** slug 允许 a-z 0-9 短横；1-64 长度；首尾必须字母数字 */
const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

/** slug 保留字黑名单——避免和系统路径冲突 */
export const RESERVED_SLUGS = new Set([
  'default', // 系统默认主题
  'new',     // 预留给"新建主题"的 admin 跳转页
  'admin',   // 管理台
  'api',     // API 路由
  'm',       // 访客入口 /m
]);

/** 标题长度约束 */
export const TITLE_MAX = 64;
/** 描述长度约束 */
export const DESCRIPTION_MAX = 500;
/** 备注长度约束 */
export const NOTE_MAX = 500;

// ==============================================================
// 错误类型（API 路由 catch 后映射为 HTTP 状态码）
// ==============================================================

/**
 * 主题层抛出的有语义错误。API 路由 catch 到后直接用 .status 和 .code
 * 构造 HTTP 响应，不需要再手动拆错误字符串。
 */
export class MailTopicError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'MailTopicError';
  }
}

/** 预设错误工厂。文案与 MAIL_TOPICS_PROPOSAL.md §5.1 错误码速查表一致。 */
export const MailTopicErrors = {
  slugInvalid: () =>
    new MailTopicError(
      'SLUG_INVALID',
      400,
      'slug 只能包含 a-z、0-9、短横；长度 1~64，首尾必须是字母数字',
    ),
  slugReserved: (slug: string) =>
    new MailTopicError(
      'SLUG_RESERVED',
      400,
      `slug "${slug}" 是保留字（default / new / admin / api / m），不能使用`,
    ),
  slugDuplicate: (slug: string) =>
    new MailTopicError('SLUG_DUPLICATE', 409, `slug "${slug}" 已被占用`),
  titleEmpty: () =>
    new MailTopicError('TITLE_EMPTY', 400, `标题必需 1~${TITLE_MAX} 字符`),
  titleTooLong: () =>
    new MailTopicError('TITLE_TOO_LONG', 400, `标题超过 ${TITLE_MAX} 字符`),
  descriptionTooLong: () =>
    new MailTopicError(
      'DESCRIPTION_TOO_LONG',
      400,
      `说明超过 ${DESCRIPTION_MAX} 字符`,
    ),
  noteTooLong: () =>
    new MailTopicError('NOTE_TOO_LONG', 400, `备注超过 ${NOTE_MAX} 字符`),
  timeInvalid: (field: string) =>
    new MailTopicError(
      'TIME_INVALID',
      400,
      `${field} 格式不合法（需 ISO 8601 格式，建议带 Z 或 +08:00）`,
    ),
  timeRangeInvalid: () =>
    new MailTopicError(
      'TIME_RANGE_INVALID',
      400,
      '开始时间不能晚于结束时间',
    ),
  notFound: () => new MailTopicError('NOT_FOUND', 404, '主题不存在'),
  defaultNotArchivable: () =>
    new MailTopicError('DEFAULT_NOT_ARCHIVABLE', 400, '默认主题不可归档'),
  defaultFieldsLimited: () =>
    new MailTopicError(
      'DEFAULT_FIELDS_LIMITED',
      400,
      '默认主题只能修改 title / description / is_enabled',
    ),
  archivedNotEditable: () =>
    new MailTopicError(
      'ARCHIVED_NOT_EDITABLE',
      409,
      '已归档主题请先恢复再编辑',
    ),
  slugNotEditable: () =>
    new MailTopicError(
      'SLUG_NOT_EDITABLE',
      400,
      'slug 创建后不可修改（避免已分享的链接 / 二维码失效）',
    ),
};

// ==============================================================
// 类型
// ==============================================================

/** 数据库行（原始 snake_case + 0/1 整数） */
export type TopicRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  note: string | null;
  is_default: number;
  is_enabled: number;
  starts_at: string | null;
  ends_at: string | null;
  archived_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

/** 派生状态（不存 DB，运行时计算） */
export type TopicState =
  | 'default'   // is_default=1
  | 'active'    // 启用 + 在时间窗内 + 未归档
  | 'scheduled' // 启用 + now < starts_at
  | 'ended'     // 启用 + now > ends_at，或 is_enabled=0
  | 'archived'; // archived_at 非空

/** 对外 API 结构（camelCase） */
export type Topic = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  note: string | null;
  isDefault: boolean;
  isEnabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  archivedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  state: TopicState;
  /** 综合开关+时间窗+归档，表示"此刻能否接受投信" */
  isEnabledNow: boolean;
  /** 管理端可选填充：该主题的未读留言数 */
  unreadCount?: number;
  /** 管理端可选填充：该主题的待审核留言数 */
  flaggedCount?: number;
};

export type TopicCreateInput = {
  slug: string;
  title: string;
  description?: string | null;
  note?: string | null;
  isEnabled?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  sortOrder?: number;
};

export type TopicUpdateInput = {
  title?: string;
  description?: string | null;
  note?: string | null;
  isEnabled?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  sortOrder?: number;
  /** 仅用于"恢复归档"：传 null 清空 archived_at；其它值一律拒绝 */
  archivedAt?: null;
};

export type ListTopicsOptions = {
  /** true = 包含已归档（管理端用）；默认 false */
  includeArchived?: boolean;
  /** true = 只返回 is_enabled=1 AND 在时间窗内 AND 未归档 AND 非 default（公开端用） */
  onlyPublicActive?: boolean;
  /** true = 附带 unreadCount / flaggedCount（管理端开销更大） */
  withCounts?: boolean;
};

// ==============================================================
// 校验工具
// ==============================================================

/**
 * 校验 slug 格式 + 保留字；不通过抛 MailTopicError。
 * 创建主题时调用；不校验唯一性（由 DB 约束）。
 */
export function validateSlug(slug: string): void {
  if (typeof slug !== 'string' || !SLUG_REGEX.test(slug)) {
    throw MailTopicErrors.slugInvalid();
  }
  if (RESERVED_SLUGS.has(slug)) {
    throw MailTopicErrors.slugReserved(slug);
  }
}

function validateTitle(title: unknown): string {
  if (typeof title !== 'string') throw MailTopicErrors.titleEmpty();
  const trimmed = title.trim();
  if (!trimmed) throw MailTopicErrors.titleEmpty();
  if (trimmed.length > TITLE_MAX) throw MailTopicErrors.titleTooLong();
  return trimmed;
}

function validateOptionalText(
  value: unknown,
  max: number,
  errorFactory: () => MailTopicError,
): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw errorFactory();
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw errorFactory();
  return trimmed;
}

function validateIsoTime(
  value: unknown,
  field: string,
): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw MailTopicErrors.timeInvalid(field);
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw MailTopicErrors.timeInvalid(field);
  // 统一序列化为 UTC Z 串存库，避免 +08:00 / Z 形式不一
  return new Date(t).toISOString();
}

function validateTimeRange(
  startsAt: string | null,
  endsAt: string | null,
): void {
  if (startsAt && endsAt && Date.parse(startsAt) > Date.parse(endsAt)) {
    throw MailTopicErrors.timeRangeInvalid();
  }
}

// ==============================================================
// 行 → API 结构转换 + 状态派生
// ==============================================================

/** 派生 state：根据 is_default / archived_at / is_enabled / 时间窗 */
export function deriveTopicState(
  row: TopicRow,
  nowMs: number = Date.now(),
): TopicState {
  if (row.is_default === 1) return 'default';
  if (row.archived_at) return 'archived';
  if (!row.is_enabled) return 'ended';
  const starts = row.starts_at ? Date.parse(row.starts_at) : -Infinity;
  const ends = row.ends_at ? Date.parse(row.ends_at) : Infinity;
  if (nowMs < starts) return 'scheduled';
  if (nowMs > ends) return 'ended';
  return 'active';
}

/** 综合判定：此刻能否接受投信（开关 + 时间窗 + 未归档） */
export function isTopicEnabledNow(
  row: TopicRow,
  nowMs: number = Date.now(),
): boolean {
  if (row.archived_at) return false;
  if (!row.is_enabled) return false;
  const starts = row.starts_at ? Date.parse(row.starts_at) : -Infinity;
  const ends = row.ends_at ? Date.parse(row.ends_at) : Infinity;
  return nowMs >= starts && nowMs <= ends;
}

export function rowToTopic(row: TopicRow, nowMs: number = Date.now()): Topic {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    note: row.note,
    isDefault: row.is_default === 1,
    isEnabled: row.is_enabled === 1,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    archivedAt: row.archived_at,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    state: deriveTopicState(row, nowMs),
    isEnabledNow: isTopicEnabledNow(row, nowMs),
  };
}

// ==============================================================
// 查询
// ==============================================================

const TOPIC_COLUMNS = `
  id, slug, title, description, note,
  is_default, is_enabled, starts_at, ends_at, archived_at,
  sort_order, created_at, updated_at
`.trim();

export async function getTopicById(id: string): Promise<Topic | null> {
  const row = (await get(
    `SELECT ${TOPIC_COLUMNS} FROM mail_topics WHERE id = ?`,
    [id],
  )) as TopicRow | undefined;
  return row ? rowToTopic(row) : null;
}

export async function getTopicBySlug(slug: string): Promise<Topic | null> {
  const row = (await get(
    `SELECT ${TOPIC_COLUMNS} FROM mail_topics WHERE slug = ?`,
    [slug],
  )) as TopicRow | undefined;
  return row ? rowToTopic(row) : null;
}

export async function getDefaultTopic(): Promise<Topic | null> {
  const row = (await get(
    `SELECT ${TOPIC_COLUMNS} FROM mail_topics WHERE is_default = 1 LIMIT 1`,
  )) as TopicRow | undefined;
  return row ? rowToTopic(row) : null;
}

/**
 * 获取某主题的 unread / flagged 计数。行为和 mail_messages 表配合：
 * - 只算未软删（deleted_at IS NULL）
 * - unread = is_read=0
 * - flagged = is_flagged=1
 * 返回值永远是整数；主题不存在时两项都 0。
 */
export async function getTopicCounts(
  topicId: string,
): Promise<{ unreadCount: number; flaggedCount: number }> {
  const row = (await get(
    `SELECT
       COALESCE(SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END), 0) AS unread_cnt,
       COALESCE(SUM(is_flagged), 0) AS flagged_cnt
     FROM mail_messages
     WHERE topic_id = ? AND deleted_at IS NULL`,
    [topicId],
  )) as { unread_cnt: number; flagged_cnt: number } | undefined;
  return {
    unreadCount: Number(row?.unread_cnt ?? 0),
    flaggedCount: Number(row?.flagged_cnt ?? 0),
  };
}

/**
 * 列出主题。默认只返回非归档；onlyPublicActive=true 时只返回"此刻能投信"的
 * 非默认主题（给 /api/config.activeTopics 和 /m 列表页用）。
 */
export async function listTopics(
  options: ListTopicsOptions = {},
): Promise<Topic[]> {
  const { includeArchived = false, onlyPublicActive = false, withCounts = false } = options;

  const where: string[] = [];
  const params: unknown[] = [];

  if (onlyPublicActive) {
    // 公开端：是 default 也排除（/m 列表只收活动主题）
    where.push('is_default = 0');
    where.push('is_enabled = 1');
    where.push('archived_at IS NULL');
    // 时间窗：NULL 视为 -∞ / +∞
    const now = new Date().toISOString();
    where.push('(starts_at IS NULL OR starts_at <= ?)');
    params.push(now);
    where.push('(ends_at IS NULL OR ends_at >= ?)');
    params.push(now);
  } else if (!includeArchived) {
    where.push('archived_at IS NULL');
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = (await all(
    `SELECT ${TOPIC_COLUMNS}
     FROM mail_topics
     ${whereSql}
     ORDER BY is_default DESC, sort_order ASC, datetime(created_at) DESC`,
    params,
  )) as TopicRow[];

  const topics = rows.map((r) => rowToTopic(r));

  if (withCounts) {
    // N+1 查询；主题数量级通常 <= 20，N+1 可接受；需要时可改成一次 group by
    for (const t of topics) {
      const counts = await getTopicCounts(t.id);
      t.unreadCount = counts.unreadCount;
      t.flaggedCount = counts.flaggedCount;
    }
  }

  return topics;
}

// ==============================================================
// 写操作
// ==============================================================

export async function createTopic(input: TopicCreateInput): Promise<Topic> {
  const slug = typeof input.slug === 'string' ? input.slug.trim() : '';
  validateSlug(slug);
  const title = validateTitle(input.title);
  const description = validateOptionalText(
    input.description,
    DESCRIPTION_MAX,
    MailTopicErrors.descriptionTooLong,
  );
  const note = validateOptionalText(
    input.note,
    NOTE_MAX,
    MailTopicErrors.noteTooLong,
  );
  const startsAt = validateIsoTime(input.startsAt, '开始时间');
  const endsAt = validateIsoTime(input.endsAt, '结束时间');
  validateTimeRange(startsAt, endsAt);

  // 先查 slug 重复（拿到明确错误码 409；否则会被 UNIQUE 触发的 SQLITE_CONSTRAINT 淹没）
  const dup = (await get(
    `SELECT id FROM mail_topics WHERE slug = ?`,
    [slug],
  )) as { id: string } | undefined;
  if (dup) throw MailTopicErrors.slugDuplicate(slug);

  const id = randomUUID();
  const now = new Date().toISOString();
  const isEnabled = input.isEnabled === false ? 0 : 1; // 默认开启
  const sortOrder =
    typeof input.sortOrder === 'number' && Number.isFinite(input.sortOrder)
      ? Math.trunc(input.sortOrder)
      : 0;

  await run(
    `INSERT INTO mail_topics
       (id, slug, title, description, note, is_default, is_enabled,
        starts_at, ends_at, archived_at, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, ?, ?, ?)`,
    [id, slug, title, description, note, isEnabled, startsAt, endsAt, sortOrder, now, now],
  );

  const created = await getTopicById(id);
  if (!created) {
    // 理论不可能——刚写入立刻就读不到
    throw new MailTopicError('INTERNAL', 500, '创建主题后读取失败');
  }
  return created;
}

/**
 * 更新主题。禁止修改的字段会被**静默忽略**（不报错，保持和 POST 一致）：
 * - id / is_default / created_at / slug（见 MailTopicErrors.slugNotEditable）
 *
 * 特殊路径：
 * - patch.archivedAt === null → 用于"恢复归档"（把 archived_at 清空）；其它值一律
 *   不接受（归档必须走 archiveTopic() 拿到 counts）
 * - default 主题只允许改 title / description / isEnabled，其它字段即使传了也拒绝
 * - 已归档主题除"恢复"外一律拒绝（409）
 */
export async function updateTopic(
  id: string,
  patch: TopicUpdateInput & { slug?: unknown; id?: unknown; isDefault?: unknown; createdAt?: unknown },
): Promise<Topic> {
  // 拒绝 slug 改动（v1 不支持，避免分享链接失效）
  if (patch.slug !== undefined) {
    throw MailTopicErrors.slugNotEditable();
  }

  const current = await getTopicById(id);
  if (!current) throw MailTopicErrors.notFound();

  const isRestoring = patch.archivedAt === null && current.archivedAt !== null;
  const isDefaultTopic = current.isDefault;

  // 已归档主题：除"恢复"外一律拒绝
  if (current.archivedAt && !isRestoring) {
    throw MailTopicErrors.archivedNotEditable();
  }

  // default 主题字段白名单
  if (isDefaultTopic) {
    const forbidden = [
      patch.startsAt,
      patch.endsAt,
      patch.sortOrder,
      patch.note,
      patch.archivedAt,
    ].some((v) => v !== undefined);
    if (forbidden) throw MailTopicErrors.defaultFieldsLimited();
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.title !== undefined) {
    sets.push('title = ?');
    params.push(validateTitle(patch.title));
  }
  if (patch.description !== undefined) {
    sets.push('description = ?');
    params.push(
      validateOptionalText(
        patch.description,
        DESCRIPTION_MAX,
        MailTopicErrors.descriptionTooLong,
      ),
    );
  }
  if (patch.note !== undefined && !isDefaultTopic) {
    sets.push('note = ?');
    params.push(
      validateOptionalText(patch.note, NOTE_MAX, MailTopicErrors.noteTooLong),
    );
  }
  if (patch.isEnabled !== undefined) {
    sets.push('is_enabled = ?');
    params.push(patch.isEnabled ? 1 : 0);
  }
  if (patch.startsAt !== undefined && !isDefaultTopic) {
    sets.push('starts_at = ?');
    params.push(validateIsoTime(patch.startsAt, '开始时间'));
  }
  if (patch.endsAt !== undefined && !isDefaultTopic) {
    sets.push('ends_at = ?');
    params.push(validateIsoTime(patch.endsAt, '结束时间'));
  }
  if (patch.sortOrder !== undefined && !isDefaultTopic) {
    sets.push('sort_order = ?');
    params.push(
      typeof patch.sortOrder === 'number' && Number.isFinite(patch.sortOrder)
        ? Math.trunc(patch.sortOrder)
        : 0,
    );
  }
  if (isRestoring) {
    sets.push('archived_at = NULL');
  }

  // 范围校验：用合并后的新值
  const startsAfter =
    patch.startsAt !== undefined
      ? validateIsoTime(patch.startsAt, '开始时间')
      : current.startsAt;
  const endsAfter =
    patch.endsAt !== undefined
      ? validateIsoTime(patch.endsAt, '结束时间')
      : current.endsAt;
  validateTimeRange(startsAfter, endsAfter);

  if (sets.length === 0) {
    // 空 patch 视为无操作；返回当前值
    return current;
  }

  sets.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);

  await run(
    `UPDATE mail_topics SET ${sets.join(', ')} WHERE id = ?`,
    params,
  );

  const updated = await getTopicById(id);
  if (!updated) throw MailTopicErrors.notFound();
  return updated;
}

/**
 * 归档主题（软删）。返回归档时该主题的未读/待审核计数，让前端决定是否
 * 弹二次确认（方案 §6.1.1）。
 *
 * - default 主题禁止归档（400）
 * - 已归档幂等：再归档视为无操作，返回最新 counts
 */
export async function archiveTopic(
  id: string,
): Promise<{ topic: Topic; unreadCount: number; flaggedCount: number }> {
  const current = await getTopicById(id);
  if (!current) throw MailTopicErrors.notFound();
  if (current.isDefault) throw MailTopicErrors.defaultNotArchivable();

  const counts = await getTopicCounts(id);

  if (!current.archivedAt) {
    const now = new Date().toISOString();
    await run(
      `UPDATE mail_topics SET archived_at = ?, updated_at = ? WHERE id = ?`,
      [now, now, id],
    );
  }

  const topic = await getTopicById(id);
  return {
    topic: topic ?? current,
    unreadCount: counts.unreadCount,
    flaggedCount: counts.flaggedCount,
  };
}

/** 恢复归档主题（archived_at = NULL）。未归档的主题调用幂等。 */
export async function restoreTopic(id: string): Promise<Topic> {
  return updateTopic(id, { archivedAt: null });
}

export async function deleteArchivedTopic(id: string): Promise<Topic> {
  const current = await getTopicById(id);
  if (!current) throw MailTopicErrors.notFound();
  if (current.isDefault) {
    throw new MailTopicError('DEFAULT_NOT_DELETABLE', 400, '默认主题不可删除');
  }
  if (!current.archivedAt) {
    throw new MailTopicError('TOPIC_NOT_ARCHIVED', 409, '仅已归档主题可永久删除');
  }

  await run('BEGIN IMMEDIATE');
  try {
    await run('DELETE FROM mail_messages WHERE topic_id = ?', [id]);
    await run('DELETE FROM mail_topics WHERE id = ?', [id]);
    await run('COMMIT');
  } catch (e) {
    try {
      await run('ROLLBACK');
    } catch {
    }
    throw e;
  }

  return current;
}
