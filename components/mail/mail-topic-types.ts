/**
 * 客户端（浏览器）用的 Mail Topics 类型。
 *
 * **不从 `@/lib/mail-topics` 导入**，因为那个模块会把 sqlite3 的代码路径
 * 牵进客户端 bundle（即便只 `import type` 也可能出 bundler warning）。
 * 这里独立声明一套与 server 对齐的纯类型，通过 `/api/mail/topics` 响应
 * 传递的结构保持一致即可。
 */

export type TopicState =
  | "default"
  | "active"
  | "scheduled"
  | "ended"
  | "archived";

export type Topic = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  note?: string | null; // 公开接口不返回 note；管理端才有
  isDefault: boolean;
  isEnabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  archivedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  state: TopicState;
  isEnabledNow: boolean;
  unreadCount?: number;
  flaggedCount?: number;
};

export type TopicListResponse = {
  items: Topic[];
};

export type ActiveTopicSummary = {
  slug: string;
  title: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
};

/** 归档 (DELETE) 的响应 */
export type TopicArchiveResponse = {
  topic: Topic;
  unreadCount: number;
  flaggedCount: number;
};

/** 状态 → 中文短标签（tab、统计面板复用） */
export function stateLabel(state: TopicState): string {
  switch (state) {
    case "default":
      return "常规";
    case "active":
      return "进行中";
    case "scheduled":
      return "未开始";
    case "ended":
      return "已结束";
    case "archived":
      return "已归档";
  }
}
