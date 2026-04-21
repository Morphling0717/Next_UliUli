"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X as CloseIcon, Sparkles } from "lucide-react";
import type { Topic } from "./mail-topic-types";

/**
 * 主站顶部的活动公告条（方案 §6 / §8 PR3b）。
 *
 * 行为：
 * - 首次挂载时拉一次 `GET /api/mail/topics`（不带 admin header，只返回当前
 *   可投信的活动主题）。
 * - 无活动 → 不渲染（不占位）。
 * - 1 个活动 → `🎂 {title} · 活动进行中 →` 点击跳 `/m/{slug}`。
 * - ≥2 个活动 → `🎉 N 个活动进行中 · 查看全部 →` 点击跳 `/m`。
 *
 * 「关闭」行为：
 * - 点 × 后不再显示；localStorage 记录当前活动集合的 "signature"（所有 slug
 *   排序后拼接），一旦主播新开活动 signature 变化就会再次显示，不会永久
 *   屏蔽新活动。
 * - 不做 sticky：banner 只出现在页面顶部，滚下去就看不见，不打扰正常浏览。
 */

type ActiveTopicListResponse = { items: Topic[] };

const LS_KEY = "uliuli:mail:banner:dismissedSignature";

function signatureOf(topics: Topic[]): string {
  return topics
    .map((t) => t.slug)
    .sort()
    .join("|");
}

export function GlobalMailBanner() {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/mail/topics", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as ActiveTopicListResponse;
        if (cancelled) return;
        const items = (j.items ?? []).filter(
          // 二次保险：只展示未归档/已启用/在时间窗内的
          (t) => !t.archivedAt && t.isEnabledNow,
        );
        setTopics(items);

        // 和 localStorage 里的 signature 比对——变化就解除关闭状态
        try {
          const saved = window.localStorage.getItem(LS_KEY);
          if (saved && saved === signatureOf(items) && items.length > 0) {
            setDismissed(true);
          }
        } catch {
          /* localStorage 不可用（隐私模式等）就忽略 */
        }
      } catch {
        /* 接口失败就当没活动，banner 不显示 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!topics || topics.length === 0 || dismissed) return null;

  const onDismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(LS_KEY, signatureOf(topics));
    } catch {
      /* noop */
    }
  };

  const single = topics.length === 1 ? topics[0] : null;
  const href = single ? `/m/${single.slug}` : "/m";
  const label = single
    ? `${single.title} · 活动进行中`
    : `${topics.length} 个活动进行中 · 查看全部`;

  return (
    <div
      role="region"
      aria-label="活动公告"
      className="fixed top-0 right-0 left-0 z-40 border-b border-cyan-400/30 bg-linear-to-r from-cyan-500/15 via-fuchsia-500/10 to-cyan-500/15 backdrop-blur-md"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-2 sm:gap-3 sm:py-2.5">
        {/* 左侧占位：和右侧 × 按钮同宽，保证中间 Link 内容真正居中 */}
        <div className="h-7 w-7 shrink-0" aria-hidden />

        <Link
          href={href}
          className="flex min-w-0 flex-1 items-center justify-center gap-2 font-mono text-[12px] text-cyan-100 transition hover:text-white sm:text-sm"
        >
          <Sparkles
            className="h-4 w-4 shrink-0 text-cyan-300 drop-shadow-[0_0_6px_rgba(45,226,230,0.6)]"
            strokeWidth={2}
            aria-hidden
          />
          <span className="truncate tracking-wide">{label}</span>
          <span className="shrink-0 text-cyan-300" aria-hidden>
            →
          </span>
        </Link>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="关闭活动公告"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-cyan-300/70 transition hover:bg-white/10 hover:text-white"
        >
          <CloseIcon className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
