"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useWindChimeReview } from '@windchime/embed/react';
import { mailClient } from '@/lib/windchime-client';

/** 从 URL 里解析出 hostname 做警示展示；解析失败返回空字符串。 */
function safeHost(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    return u.hostname;
  } catch {
    return "";
  }
}

/**
 * 「待审核」区：集中展示所有命中敏感词的留言（列表只显示发信人标签 +
 * 时间）。主播点击"查看原文"才会拉取并弹出完整内容的 modal，避免在
 * 后台列表默认页就被敏感词糊脸（比如直播时不小心拉到了后台）。
 */
export function FlaggedMailPanel({topicId = 'default'}: {topicId?: string}) {
  const review = useWindChimeReview(mailClient, {topicId});
  const {closeDetail} = review;
  const flagged = review.items;
  const [openId, setOpenId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const openData = review.detail;
  const openLoading = review.detailLoading;
  const openError = review.detailError?.message || actionError;
  const acting = review.pending;
  const closeModal = useCallback(() => {
    setOpenId(null); setActionError(null); closeDetail();
  }, [closeDetail]);
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId, closeModal]);
  const act = async (operation: () => Promise<unknown>, confirmation?: string) => {
    if (!openId || (confirmation && !window.confirm(confirmation))) return;
    setActionError(null);
    try { await operation(); closeModal(); }
    catch (error) { setActionError(error instanceof Error ? error.message : '操作失败'); }
  };
  const markRead = () => act(() => review.update(openId!, {isRead: true}));
  const approveItem = () => act(() => review.approve(openId!));
  const deleteItem = () => act(() => review.deleteMessage(openId!), '确认删除这条留言？此操作会软删除，无法在当前界面恢复。');
  const blockSender = () => act(() => review.blockSender(openId!), '拉黑这名发信人？其在常规信箱及所有活动主题的历史信件会被删除，之后的投稿会被静默丢弃。');

  return (
    <div className="rounded-2xl border border-rose-400/40 bg-black/60 p-5 shadow-[0_0_30px_rgba(244,63,94,0.12)] backdrop-blur-xl sm:p-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <div className="font-['Orbitron',sans-serif] text-sm font-bold tracking-[0.12em] text-rose-300">
            ⚠ FLAGGED_INBOX · 待审核留言
          </div>
          <div className="mt-1 font-mono text-xs text-gray-400">
            共 {flagged.length} 条命中敏感词。默认只显示发信人与时间，
            点击<span className="text-rose-300">「查看原文」</span>才会弹出完整内容。
          </div>
        </div>
      </div>

      {review.error && <p role="alert">{review.error.message}</p>}
      {review.isLoading && <p role="status">加载中…</p>}
      {!review.isLoading && flagged.length === 0 ? (
        <div className="py-8 text-center font-mono text-sm text-gray-500">
          EMPTY · 当前无待审核留言
        </div>
      ) : (
        <ul className="divide-y divide-rose-400/15">
          {flagged.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="flex flex-col">
                <span className="font-mono text-sm font-bold text-rose-200">
                  {m.senderLabel ?? "Unknown"}
                </span>
                <span className="font-mono text-[11px] text-gray-500">
                  {new Date(m.createdAt).toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                    hour12: false,
                  })}
                </span>
              </div>
              <button
                type="button"
                onClick={() => { setOpenId(m.id); setActionError(null); review.openDetail(m.id); }}
                className="rounded-lg border border-rose-400/60 bg-rose-500/10 px-4 py-1.5 font-mono text-xs text-rose-200 transition hover:bg-rose-500 hover:text-white"
              >
                查看原文 →
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 原文 Modal */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {openId && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
                onClick={closeModal}
              >
                <motion.div
                  initial={{ y: 24, opacity: 0, scale: 0.98 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  exit={{ y: 24, opacity: 0, scale: 0.98 }}
                  transition={{ type: "spring", damping: 22, stiffness: 260 }}
                  className="relative w-full max-w-xl rounded-2xl border border-rose-400/60 bg-black/90 p-6 shadow-[0_0_40px_rgba(244,63,94,0.25)]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={closeModal}
                    aria-label="关闭"
                    className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-rose-400/60 bg-black/80 text-rose-300 transition hover:bg-rose-400 hover:text-black"
                  >
                    ×
                  </button>
                  <div className="mb-1 font-mono text-[11px] tracking-[0.25em] text-rose-300/80">
                    FLAGGED · 待审核
                  </div>
                  <div className="font-['Orbitron',sans-serif] text-lg font-bold tracking-wide text-rose-200">
                    {openData?.senderLabel ?? "Unknown"}
                  </div>
                  {openData?.createdAt && (
                    <div className="mt-1 font-mono text-[11px] text-gray-500">
                      {new Date(openData.createdAt).toLocaleString("zh-CN", {
                        timeZone: "Asia/Shanghai",
                        hour12: false,
                      })}
                    </div>
                  )}

                  <div className="mt-4 min-h-[120px] rounded-xl border border-rose-400/30 bg-black/60 p-4">
                    {openLoading && (
                      <div className="py-6 text-center font-mono text-sm text-rose-300/70">
                        LOADING…
                      </div>
                    )}
                    {openError && (
                      <div className="rounded border border-rose-500/50 bg-rose-500/10 px-3 py-2 font-mono text-xs text-rose-300">
                        {openError}
                      </div>
                    )}
                    {openData && !openLoading && (
                      <div className="space-y-3">
                        {openData.nickname && (
                          <div className="font-mono text-xs text-gray-400">
                            称呼：
                            <span className="text-gray-200">{openData.nickname}</span>
                          </div>
                        )}
                        <div className="whitespace-pre-wrap break-words font-sans text-[15px] leading-relaxed text-gray-100">
                          {openData.text}
                        </div>
                        {openData.linkUrl && (
                          <div className="mt-2 space-y-1 font-mono text-xs">
                            <div className="text-gray-400">链接：</div>
                            <a
                              href={openData.linkUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="group inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-md border border-amber-400/50 bg-amber-400/5 px-2 py-1.5 text-amber-100 transition hover:border-amber-400 hover:bg-amber-400/15"
                            >
                              <span className="shrink-0 text-amber-300" aria-hidden>
                                ⚠
                              </span>
                              <span className="shrink-0 font-bold tracking-wide text-amber-200">
                                {safeHost(openData.linkUrl) || "外站链接"}
                              </span>
                              <span className="break-all text-amber-200/70 group-hover:text-amber-100">
                                {openData.linkUrl}
                              </span>
                            </a>
                            <div className="text-[10px] leading-relaxed text-gray-500">
                              匿名访客填入，已强制 <code>noopener/noreferrer</code>
                              新窗口打开。点击前请确认域名，谨防钓鱼。
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={approveItem}
                      disabled={!openData || acting}
                      className="rounded-lg border border-emerald-400/60 bg-black/60 px-3 py-1.5 font-mono text-xs text-emerald-200 transition hover:bg-emerald-400 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      审核通过
                    </button>
                    <button
                      type="button"
                      onClick={markRead}
                      disabled={!openData || acting}
                      className="rounded-lg border border-cyan-400/50 bg-black/60 px-3 py-1.5 font-mono text-xs text-cyan-200 transition hover:bg-cyan-400 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      标为已读
                    </button>
                    <button
                      type="button"
                      onClick={blockSender}
                      disabled={!openData || acting}
                      className="rounded-lg border border-amber-400/60 bg-black/60 px-3 py-1.5 font-mono text-xs text-amber-200 transition hover:bg-amber-500 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      拉黑发信人
                    </button>
                    <button
                      type="button"
                      onClick={deleteItem}
                      disabled={!openData || acting}
                      className="rounded-lg border border-rose-400 bg-rose-500 px-3 py-1.5 font-mono text-xs font-bold text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      删除
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
