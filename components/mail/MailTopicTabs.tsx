"use client";

import { Archive, Plus, Settings2 } from "lucide-react";
import type { Topic } from "./mail-topic-types";

type Props = {
  topics: Topic[];
  activeTopicId: string;
  onSwitch: (topicId: string) => void;
  onOpenNewTopic: () => void;
  onOpenArchivedDrawer: () => void;
  onScrollToGlobalSettings: () => void;
  /** 归档按钮处理（针对已结束状态的 tab 上的小图标） */
  onQuickArchive?: (topicId: string) => void;
};

/**
 * 主 Tab 栏：常规信箱 + 活动主题 + 固定动作按钮（往期 / 新建 / 全局设置）。
 *
 * - 参考 `app/admin/components/AdminTabsNav.tsx` 的 `flex-wrap` 风格
 * - 每个主题 tab：title + 未读 badge + 状态染色 + "待归档"快捷图标（仅 ended）
 * - 归档主题不进主 tab 栏（方案 §6.1.1）
 * - 当有 ≥ 3 个"已结束"主题时，末尾显示"一键归档全部"提示（v1 暂只提示，
 *   不自动归档；主播手动点每个 tab 的"待归档"图标）
 */
export function MailTopicTabs({
  topics,
  activeTopicId,
  onSwitch,
  onOpenNewTopic,
  onOpenArchivedDrawer,
  onScrollToGlobalSettings,
  onQuickArchive,
}: Props) {
  // 排序：default 最左；然后 active → scheduled → ended；组内按 sort_order、
  // 其次 created_at 倒序
  const visible = topics
    .filter((t) => t.state !== "archived")
    .sort((a, b) => {
      const priority = (s: Topic["state"]) =>
        s === "default" ? 0 : s === "active" ? 1 : s === "scheduled" ? 2 : 3;
      const pa = priority(a.state);
      const pb = priority(b.state);
      if (pa !== pb) return pa - pb;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return b.createdAt.localeCompare(a.createdAt);
    });

  const endedCount = visible.filter((t) => t.state === "ended").length;
  const archivedCount = topics.filter((t) => t.state === "archived").length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {visible.map((t) => (
        <TopicTabButton
          key={t.id}
          topic={t}
          active={activeTopicId === t.id}
          onClick={() => onSwitch(t.id)}
          onQuickArchive={onQuickArchive}
        />
      ))}

      {/* 分隔符 */}
      <span className="mx-1 h-6 w-px bg-cyan-400/20" aria-hidden />

      <ActionButton
        onClick={onOpenArchivedDrawer}
        icon={<Archive className="h-3.5 w-3.5" />}
        label={`往期活动${archivedCount > 0 ? ` (${archivedCount})` : ""}`}
      />
      <ActionButton
        onClick={onOpenNewTopic}
        icon={<Plus className="h-3.5 w-3.5" />}
        label="新建主题"
      />
      <ActionButton
        onClick={onScrollToGlobalSettings}
        icon={<Settings2 className="h-3.5 w-3.5" />}
        label="全局设置"
      />

      {/* 一键归档提示（≥ 3 个已结束） */}
      {endedCount >= 3 && (
        <div className="ml-auto font-mono text-[11px] text-amber-300/80">
          ⚠ 有 {endedCount} 个已结束的主题，建议逐个点击归档
        </div>
      )}
    </div>
  );
}

function TopicTabButton({
  topic,
  active,
  onClick,
  onQuickArchive,
}: {
  topic: Topic;
  active: boolean;
  onClick: () => void;
  onQuickArchive?: (topicId: string) => void;
}) {
  const { title, unreadCount = 0, state } = topic;

  // 状态 → 样式映射
  const stateClasses =
    active
      ? "border-cyan-400 bg-cyan-400/15 text-cyan-100 shadow-[0_0_18px_rgba(45,226,230,0.25)]"
      : state === "default"
        ? "border-cyan-500/40 bg-black/60 text-cyan-200 hover:bg-cyan-400/10"
        : state === "active"
          ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-400/20"
          : state === "scheduled"
            ? "border-dashed border-violet-400/60 bg-violet-500/5 text-violet-200 hover:bg-violet-500/15"
            : /* ended */ "border-gray-600/60 bg-gray-500/10 text-gray-400 hover:bg-gray-500/20";

  const stateLabel =
    state === "active"
      ? "进行中"
      : state === "scheduled"
        ? "未开始"
        : state === "ended"
          ? "已结束"
          : null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        className={
          "rounded-lg border px-3 py-2 font-mono text-xs font-bold tracking-wide transition " +
          stateClasses
        }
      >
        <span className="max-w-[180px] truncate align-middle">{title}</span>
        {stateLabel && (
          <span className="ml-1.5 text-[10px] opacity-70">· {stateLabel}</span>
        )}
        {unreadCount > 0 && (
          <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* 已结束态的"待归档"快捷图标（不进入主题内部，一键归档） */}
      {state === "ended" && onQuickArchive && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onQuickArchive(topic.id);
          }}
          title="一键归档该主题"
          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-amber-400/80 bg-black/90 text-[9px] text-amber-300 shadow-[0_0_6px_rgba(251,191,36,0.6)] transition hover:bg-amber-400 hover:text-black"
          aria-label="归档"
        >
          📁
        </button>
      )}
    </div>
  );
}

function ActionButton({
  onClick,
  icon,
  label,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-lg border border-cyan-500/30 bg-black/40 px-3 py-2 font-mono text-xs text-cyan-300/80 transition hover:border-cyan-400 hover:bg-cyan-400/10 hover:text-cyan-100"
    >
      {icon}
      {label}
    </button>
  );
}
