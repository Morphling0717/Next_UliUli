"use client";

import { useState } from "react";
import { downloadWindChimeCsv } from "@windchime/embed/client";
import { useWindChimeInbox } from "@windchime/embed/react";
import { mailClient } from "@/lib/windchime-client";
import { mailAdminTheme as t } from "./mail-theme";
import {
  Inbox,
  Mail,
  Heart,
  Ban,
  Trash2,
  CheckCheck,
  Link as LinkIcon,
} from "lucide-react";

/** 网站拥有全部 JSX、图标和交互文案；数据、选择、批量及刷新由风铃维护。 */
export function MailInbox({
  topicId,
  title,
  emptyText,
}: {
  topicId: string;
  title: string;
  emptyText: string;
}) {
  const inbox = useWindChimeInbox(mailClient, { topicId });
  const [error, setError] = useState<string | null>(null);
  const act = async (
    operation: () => Promise<unknown>,
    confirmation?: string,
  ) => {
    if (confirmation && !window.confirm(confirmation)) return;
    setError(null);
    try {
      await operation();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    }
  };
  const exportCsv = () => {
    const rows = inbox.selectedIds.size
      ? inbox.items.filter((m) => inbox.selectedIds.has(m.id))
      : inbox.items;
    downloadWindChimeCsv(rows, `uliuli-mail-${topicId}.csv`);
  };
  const actions = (m: (typeof inbox.items)[number]) => (
    <>
      <button
        type="button"
        title={m.isFavorited ? "取消收藏" : "收藏"}
        aria-pressed={!!m.isFavorited}
        className={`inline-flex h-7 w-7 items-center justify-center transition hover:scale-110 ${m.isFavorited ? "text-rose-400" : "text-slate-400"}`}
        disabled={inbox.pending}
        onClick={() =>
          void act(() => inbox.update(m.id, { isFavorited: !m.isFavorited }))
        }
      >
        <Heart
          className="h-5 w-5"
          style={{ fill: m.isFavorited ? "currentColor" : "none" }}
        />
      </button>
      <button
        type="button"
        className={t.button}
        disabled={inbox.pending}
        onClick={() =>
          void act(() => inbox.update(m.id, { isRead: !m.isRead }))
        }
      >
        <CheckCheck className="h-3.5 w-3.5" />
        {m.isRead ? "标未读" : "标已读"}
      </button>
      <button
        type="button"
        title="将该发送者加入黑名单"
        className={t.button}
        disabled={inbox.pending}
        onClick={() =>
          void act(
            () => inbox.blockSender(m.id),
            "屏蔽这个发送者，并删除其全部历史信件？",
          )
        }
      >
        <Ban className="h-3.5 w-3.5" />
        拉黑
      </button>
      <button
        type="button"
        className={`ml-auto ${t.dangerButton}`}
        disabled={inbox.pending}
        onClick={() =>
          void act(() => inbox.deleteMessage(m.id), "删除这条留言？")
        }
      >
        <Trash2 className="h-3.5 w-3.5" />
        删除
      </button>
    </>
  );
  return (
    <div className={t.root} data-mail-inbox>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="bg-gradient-to-br from-violet-600 to-fuchsia-600 bg-clip-text text-2xl font-bold tracking-tight text-transparent dark:from-violet-300 dark:to-fuchsia-300">
          {title}
        </h2>
        <div className={t.toolbar}>
          <button
            type="button"
            className={t.button}
            disabled={inbox.isLoading}
            onClick={() => void inbox.reload()}
          >
            {inbox.isLoading ? "加载中…" : "刷新"}
          </button>
          <button
            type="button"
            className={t.button}
            disabled={!inbox.items.length}
            onClick={exportCsv}
          >
            导出 CSV
          </button>
        </div>
      </div>
      <div
        className="mb-6 inline-flex flex-wrap items-center gap-1.5 rounded-full border border-white/40 bg-white/30 p-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/40"
        role="tablist"
        aria-label="收件箱分类"
      >
        {(["all", "unread", "favorited"] as const).map((filter, i) => (
          <button
            key={filter}
            type="button"
            role="tab"
            aria-selected={inbox.filter === filter}
            className={`rounded-full px-5 py-2.5 text-[15px] font-semibold text-slate-600 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-white ${inbox.filter === filter ? t.tabActive : ""}`}
            onClick={() => inbox.setFilter(filter)}
          >
            {["全部信笺", "未读", "红心收藏"][i]}
            <span className="ml-1.5 text-xs opacity-70">
              {inbox.counts[filter]}
            </span>
          </button>
        ))}
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          aria-label="全选可见"
          type="checkbox"
          className={`${t.checkbox} h-5 w-5 rounded-md`}
          checked={inbox.allSelected}
          disabled={!inbox.items.length}
          onChange={() => inbox.toggleAll()}
        />
        <span className={t.muted}>
          已选 {inbox.selectedIds.size} / {inbox.items.length}
        </span>
        <button
          type="button"
          className={t.button}
          disabled={!inbox.selectedIds.size || inbox.pending}
          onClick={() =>
            void act(() => inbox.batch("markRead", [...inbox.selectedIds]))
          }
        >
          批量已读
        </button>
        <button
          type="button"
          className={t.dangerButton}
          disabled={!inbox.selectedIds.size || inbox.pending}
          onClick={() =>
            void act(
              () => inbox.batch("delete", [...inbox.selectedIds]),
              `批量删除 ${inbox.selectedIds.size} 条留言？`,
            )
          }
        >
          批量删除
        </button>
      </div>
      {(error || inbox.error || inbox.mutationError) && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-900 dark:text-red-100"
        >
          {error || inbox.error?.message || inbox.mutationError?.message}
        </p>
      )}
      {!inbox.items.length && !inbox.isLoading ? (
        <div className="flex min-h-[300px] items-center justify-center rounded-[2rem] border border-white/20 bg-white/10 backdrop-blur-md dark:border-white/5 dark:bg-slate-900/20">
          <p className={`${t.muted} text-center text-[15px]`}>{emptyText}</p>
        </div>
      ) : (
        <div className={t.cardGrid}>
          {inbox.items.map((m) => (
            <article
              key={m.id}
              className={`${t.card} ${!m.isRead ? t.cardUnread : ""} ${m.isFavorited ? t.cardFavorited : ""} ${inbox.selectedIds.has(m.id) ? "ring-2 ring-violet-500/70 ring-offset-2 ring-offset-transparent" : ""}`}
            >
              <div
                aria-hidden
                className="h-1.5 w-full"
                style={{
                  background: m.isFavorited
                    ? "linear-gradient(90deg,#fb7185,#f43f5e,#e11d48)"
                    : "linear-gradient(90deg,#2de2e6,#0891b2,#6366f1)",
                }}
              />
              <input
                aria-label="选中该条留言"
                type="checkbox"
                checked={inbox.selectedIds.has(m.id)}
                onChange={() => inbox.toggleSelected(m.id)}
                className={`absolute left-3 top-4 z-10 ${t.checkbox}`}
              />
              <div className="flex flex-1 flex-col px-6 pb-4 pt-5 pl-10">
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <h3 className="inline-flex items-center gap-1.5 font-['Orbitron',sans-serif] text-sm font-bold tracking-[.12em] text-cyan-200">
                    <Inbox className="h-4 w-4" />
                    TRANSMISSION · 来信
                  </h3>
                  <time
                    dateTime={m.createdAt}
                    className="shrink-0 font-serif text-xs text-slate-200/90"
                  >
                    {new Date(m.createdAt).toLocaleString("zh-CN", {
                      timeZone: "Asia/Shanghai",
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                  {m.nickname?.trim() && (
                    <span className="font-serif text-sm text-slate-200/90">
                      {m.nickname}
                    </span>
                  )}
                  {m.senderLabel && (
                    <span className={t.badge}>{m.senderLabel}</span>
                  )}
                  {!m.isRead && (
                    <span
                      className={`inline-flex items-center gap-1 ${t.badge}`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      未读
                    </span>
                  )}
                </div>
                <div
                  aria-hidden
                  className="mb-4 flex items-center gap-2 text-cyan-200"
                >
                  <span
                    className="h-px flex-1"
                    style={{
                      background:
                        "linear-gradient(to right,transparent,rgba(45,226,230,.35))",
                    }}
                  />
                  <Mail className="h-3 w-3 opacity-60" />
                  <span
                    className="h-px flex-1"
                    style={{
                      background:
                        "linear-gradient(to left,transparent,rgba(45,226,230,.35))",
                    }}
                  />
                </div>
                <p className="flex-1 whitespace-pre-wrap break-words font-serif text-[15px] leading-[1.9] text-gray-100">
                  {m.text}
                </p>
                {m.linkUrl && (
                  <a
                    href={m.linkUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className={`mt-3 inline-flex max-w-full items-center gap-1.5 truncate font-serif text-xs underline underline-offset-2 ${t.link}`}
                  >
                    <LinkIcon className="h-3.5 w-3.5 shrink-0" />
                    {m.linkUrl}
                  </a>
                )}
                <div className="mt-5 flex items-end justify-between border-t border-dashed border-cyan-400/30 pt-3">
                  <span className="font-['Orbitron',sans-serif] text-[10px] uppercase tracking-[.3em] text-cyan-200">
                    MAIL_BOX
                  </span>
                  <span className="font-['Orbitron',sans-serif] text-xs tracking-[.1em] text-slate-200/90">
                    — VIA MAIL_BOX
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 border-t border-cyan-400/25 bg-black/50 px-5 py-2.5">
                {actions(m)}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
