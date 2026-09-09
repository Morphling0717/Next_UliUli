import type { WindChimeAdminTopic, WindChimePublicTopic, WindChimeTopicState } from '@windchime/embed/core';
export type Topic = WindChimeAdminTopic;
export type PublicTopic = WindChimePublicTopic;
export type TopicState = WindChimeTopicState;
export type TopicListResponse = { items: Topic[] };
export type ActiveTopicSummary = Pick<PublicTopic, 'slug' | 'title' | 'description' | 'startsAt' | 'endsAt'>;
export type TopicArchiveResponse = { topic: Topic; unreadCount: number; flaggedCount: number };

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
