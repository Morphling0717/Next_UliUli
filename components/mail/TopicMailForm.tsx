"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarClock, Sparkles } from "lucide-react";
import { MailComposer } from "./MailComposer";
import { playSentSfx } from "@/lib/mail-sfx";
import { formatBeijing } from "./mail-time";
import type { PublicTopic as Topic } from "./mail-topic-types";

type Props = {
  topic: Topic;
  /** 从 `/api/config` 读到的 siteConfig.mail；传 undefined 则全部走默认。 */
  texts?: {
    placeholderText?: string;
    placeholderNickname?: string;
    placeholderLink?: string;
    successMessage?: string;
  };
};



/** 活动页面与成功音效由网站设计；投稿校验、身份、限流及请求由 MailComposer 的风铃 Hook 处理。 */
export function TopicMailForm({ topic, texts }: Props) {
  const onSent = useCallback(() => playSentSfx(), []);

  const turnstileSiteKey =
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || undefined;

  const endsHint = useMemo(() => {
    if (!topic.endsAt) return null;
    return `活动截止 · ${formatBeijing(topic.endsAt)}`;
  }, [topic.endsAt]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-linear-to-br from-black via-[#0a0616] to-[#050508] text-white">
      {/* 背景装饰：霓虹网格 + 两团模糊光斑 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "linear-gradient(rgba(45,226,230,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(45,226,230,0.08) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-20 h-[28rem] w-[28rem] rounded-full bg-cyan-500/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -right-20 h-[28rem] w-[28rem] rounded-full bg-fuchsia-500/10 blur-3xl"
      />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-8 sm:py-12">
        {/* 顶部导航：返回活动列表（/m），而非直接跳回主站。
            在 /m 页面里还有一个「返回主站」按钮负责最后一跳，形成
            /  ←  /m  ←  /m/{slug} 的三级层级。 */}
        <div className="mb-6">
          <Link
            href="/m"
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-black/40 px-3 py-1.5 font-mono text-[11px] text-cyan-200 transition hover:bg-cyan-400/10"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回活动列表
          </Link>
        </div>

        {/* 活动 Banner */}
        <section className="mb-6 rounded-2xl border border-cyan-400/40 bg-black/60 p-6 shadow-[0_0_30px_rgba(45,226,230,0.15)] backdrop-blur-xl">
          <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.25em] text-cyan-300/80">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
            <span>EVENT · 活动进行中</span>
          </div>
          <h1 className="mt-2 font-['Orbitron',sans-serif] text-2xl font-bold tracking-wide text-white sm:text-3xl">
            {topic.title}
          </h1>
          {topic.description && (
            <p className="mt-3 font-sans text-sm leading-relaxed text-gray-300">
              {topic.description}
            </p>
          )}
          {endsHint && (
            <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 font-mono text-[11px] text-amber-200">
              <CalendarClock className="h-3 w-3" />
              {endsHint}
            </div>
          )}
        </section>

        {/* MailComposer 表单 */}
        <section className="flex-1">
          <MailComposer
            title={`MAIL · ${topic.title}`}
            tagline="在这里匿名写下你想说的话 ~"
            statusOpenLabel="ONLINE"
            statusPausedLabel="OFFLINE"
            pausedMessage="活动暂停中，稍后再来吧 ~"


            placeholder={
              texts?.placeholderText || "在这里写下你想说的话…"
            }
            nicknamePlaceholder={
              texts?.placeholderNickname || "称呼（可选）"
            }
            linkPlaceholder={
              texts?.placeholderLink || "B站 / X / 外站链接（可选）"
            }
            successMessage={
              texts?.successMessage ||
              "SIGNAL SENT · 信号已送达，Uli 会在直播时读到 ~"
            }
            rateLimit={{
              max: 3,
              windowMs: 60_000,
              storageKey: `uliuli:mail:rl:${topic.slug}`,
            }}
            turnstileSiteKey={turnstileSiteKey}


            onSent={onSent}
            topicSlug={topic.slug}
          />
        </section>

        {/* 页脚小字 */}
        <div className="mt-8 text-center font-mono text-[11px] tracking-[0.2em] text-gray-500">
          UliUli · MAIL_TOPICS · /m/{topic.slug}
        </div>
      </div>
    </main>
  );
}
