"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Archive, X as CloseIcon } from "lucide-react";
import type { Topic } from "./mail-topic-types";

type Props = {
  open: boolean;
  topic: Topic | null;
  onCancel: () => void;
  onMarkReadThenArchive: () => void;
  onArchiveAnyway: () => void;
  busy?: boolean;
  error?: string | null;
};

/**
 * 归档前的二次确认（方案 §6.1.1）。
 *
 * 主播点某主题的"归档"按钮时，如果该主题还有未读 / 待审核留言，先弹这个
 * modal 让主播有机会：
 * - 取消：放弃归档
 * - 先标已读再归档：由风铃在同一事务中标记该话题普通未读信件并归档
 * - 仍然归档：直接 DELETE（未读信件会进入"往期活动"抽屉，主播日后还能恢复查看）
 *
 * counts 从 `topic.unreadCount` / `topic.flaggedCount` 读（管理端列表已带）。
 */
export function ArchiveConfirmModal({
  open,
  topic,
  onCancel,
  onMarkReadThenArchive,
  onArchiveAnyway,
  busy,
  error,
}: Props) {
  // ESC 取消
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, busy]);

  if (typeof document === "undefined") return null;

  const unread = topic?.unreadCount ?? 0;
  const flagged = topic?.flaggedCount ?? 0;

  return createPortal(
    <AnimatePresence>
      {open && topic && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[1150] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          onClick={() => !busy && onCancel()}
        >
          <motion.div
            initial={{ y: 24, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", damping: 22, stiffness: 260 }}
            className="relative w-full max-w-md rounded-2xl border border-amber-400/60 bg-black/90 p-6 shadow-[0_0_40px_rgba(251,191,36,0.25)]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onCancel}
              aria-label="关闭"
              disabled={busy}
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-amber-400/60 bg-black/80 text-amber-300 transition hover:bg-amber-400 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CloseIcon className="h-4 w-4" />
            </button>

            <div className="mb-2 flex items-center gap-2">
              <Archive className="h-5 w-5 text-amber-300" strokeWidth={2} />
              <div className="font-['Orbitron',sans-serif] text-sm font-bold tracking-[0.12em] text-amber-200">
                CONFIRM · 归档前提醒
              </div>
            </div>

            <p className="mt-3 font-sans text-[14px] leading-relaxed text-amber-50">
              <span className="font-bold">「{topic.title}」</span>
              还有
              {unread > 0 && (
                <span className="mx-1 rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-rose-200">
                  {unread} 封未读
                </span>
              )}
              {unread > 0 && flagged > 0 && <span> / </span>}
              {flagged > 0 && (
                <span className="mx-1 rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-amber-200">
                  {flagged} 封待审核
                </span>
              )}
              ，归档后需去
              <strong className="mx-1 text-amber-200">【往期活动】</strong>
              才能查看。确定归档吗？
            </p>

            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={onMarkReadThenArchive}
                disabled={busy}
                className="rounded-lg border border-cyan-400/60 bg-cyan-500/10 px-4 py-2.5 text-left font-mono text-xs text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <div className="font-bold text-cyan-200">✓ 先标为已读再归档</div>
                <div className="mt-1 text-[11px] text-cyan-300/70">
                  先标记普通未读信件，再归档；待审核信件保留原状态
                </div>
              </button>
              <button
                type="button"
                onClick={onArchiveAnyway}
                disabled={busy}
                className="rounded-lg border border-amber-400/60 bg-amber-500/10 px-4 py-2.5 text-left font-mono text-xs text-amber-100 transition hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <div className="font-bold text-amber-200">⚡ 仍然归档</div>
                <div className="mt-1 text-[11px] text-amber-300/70">
                  未读状态保留；往期活动抽屉里还能看到
                </div>
              </button>
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="rounded-lg border border-gray-500/40 bg-black/60 px-4 py-2.5 text-left font-mono text-xs text-gray-300 transition hover:bg-gray-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <div className="font-bold text-gray-200">× 取消</div>
                <div className="mt-1 text-[11px] text-gray-400">
                  放弃归档，主题保持原状态
                </div>
              </button>
            </div>

            {error && <p role="alert" className="mt-3 text-center text-sm text-rose-400">{error}</p>}
            {busy && (
              <div className="mt-3 text-center font-mono text-[11px] text-cyan-300/80">
                处理中…
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
