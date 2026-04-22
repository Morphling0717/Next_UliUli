"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  PauseCircle,
} from "lucide-react";
import { formatBeijing } from "./mail-time";

type Variant = "ended" | "disabled" | "scheduled";

type Props = {
  variant: Variant;
  topicTitle: string;
  topicDescription?: string | null;
  /** scheduled 需要；其它 variant 会忽略 */
  startsAt?: string | null;
  /** ended 时展示结束时间（可选） */
  endsAt?: string | null;
};

/**
 * 访客访问 `/m/{slug}` 时，主题非 active 状态下展示的通用提示页。
 *
 * 方案 §9 Q2：归档/结束/暂停都返回 **HTTP 200 + 友好页**（防外链404），
 * 配合 `<meta name="robots" content="noindex, nofollow">` 防搜索引擎
 * 把这些临时页面收录成永久结果。
 *
 * 视觉沿用主站 `Orbitron + neon-blue` 赛博朋克基调，但独立渲染，不依赖
 * 主站的 Three 背景（页面级独立使用）。
 */
export function TopicStatePage({
  variant,
  topicTitle,
  topicDescription,
  startsAt,
  endsAt,
}: Props) {
  const { icon, badge, heading, body } = resolveCopy(
    variant,
    topicTitle,
    startsAt,
    endsAt,
  );

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-linear-to-br from-black via-[#0a0616] to-[#050508] px-4 py-10 text-white">
      {/* 背景装饰：霓虹网格 + 模糊光斑 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(rgba(45,226,230,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(45,226,230,0.08) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-cyan-500/10 blur-3xl"
      />

      <div className="relative z-10 w-full max-w-xl text-center">
        <div className="mb-4 flex items-center justify-center">{icon}</div>

        <div className="mb-2 font-mono text-[11px] tracking-[0.3em] text-cyan-300/80">
          {badge}
        </div>
        <h1 className="font-['Orbitron',sans-serif] text-2xl font-bold tracking-wide text-white sm:text-3xl">
          {heading}
        </h1>

        <div className="mx-auto mt-6 max-w-md rounded-2xl border border-cyan-400/30 bg-black/60 p-6 shadow-[0_0_30px_rgba(45,226,230,0.12)] backdrop-blur-xl">
          <p className="font-sans text-sm leading-relaxed text-gray-200">
            {body}
          </p>
          {topicDescription && (
            <p className="mt-3 font-mono text-xs italic text-gray-400">
              「{topicDescription}」
            </p>
          )}
          {variant === "scheduled" && startsAt && (
            <Countdown targetIso={startsAt} />
          )}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/m"
            className="flex items-center gap-2 rounded-lg border border-cyan-400/60 bg-black/60 px-5 py-2.5 font-mono text-sm text-cyan-200 transition hover:bg-cyan-400/10"
          >
            <ArrowLeft className="h-4 w-4" />
            返回活动列表
          </Link>
        </div>

        <div className="mt-8 font-mono text-[11px] tracking-[0.2em] text-gray-500">
          UliUli · MAIL_TOPICS
        </div>
      </div>
    </main>
  );
}

function resolveCopy(
  variant: Variant,
  topicTitle: string,
  startsAt?: string | null,
  endsAt?: string | null,
): {
  icon: React.ReactNode;
  badge: string;
  heading: string;
  body: string;
} {
  if (variant === "ended") {
    return {
      icon: (
        <CheckCircle2
          className="h-14 w-14 text-cyan-300 drop-shadow-[0_0_16px_rgba(45,226,230,0.6)]"
          strokeWidth={1.6}
          aria-hidden
        />
      ),
      badge: "EVENT · ENDED",
      heading: "活动已结束",
      body: endsAt
        ? `「${topicTitle}」已于 ${formatBeijing(endsAt)} 结束，感谢每一位留言的小伙伴。期待下次相遇 ~`
        : `「${topicTitle}」已结束，感谢每一位留言的小伙伴。期待下次相遇 ~`,
    };
  }
  if (variant === "disabled") {
    return {
      icon: (
        <PauseCircle
          className="h-14 w-14 text-amber-300 drop-shadow-[0_0_16px_rgba(251,191,36,0.55)]"
          strokeWidth={1.6}
          aria-hidden
        />
      ),
      badge: "EVENT · PAUSED",
      heading: "活动暂停中",
      body: `「${topicTitle}」暂时关闭了，主播稍后会重新开启。你可以晚一点再来看看 ~`,
    };
  }
  // scheduled
  return {
    icon: (
      <CalendarClock
        className="h-14 w-14 text-cyan-300 drop-shadow-[0_0_16px_rgba(45,226,230,0.6)]"
        strokeWidth={1.6}
        aria-hidden
      />
    ),
    badge: "EVENT · COMING SOON",
    heading: "活动即将开始",
    body: startsAt
      ? `「${topicTitle}」将于 ${formatBeijing(startsAt)} 开始，别忘了收藏这个链接 ~`
      : `「${topicTitle}」即将开始，敬请期待 ~`,
  };
}

/**
 * 倒计时（显示到开始时间还有多少天/时/分/秒）。
 * 目标时间过了之后页面不会自动刷新——访客需要手动重新打开，由服务端
 * 重新渲染成 `active` 状态的投信页。这样避免客户端状态分发的复杂度。
 */
function Countdown({ targetIso }: { targetIso: string }) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const target = new Date(targetIso).getTime();
  const diff = Math.max(0, target - now);
  const sec = Math.floor(diff / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;

  if (diff === 0) {
    return (
      <div className="mt-4 rounded-lg border border-cyan-400/50 bg-cyan-500/10 px-4 py-3 font-mono text-sm text-cyan-200">
        🎉 活动已经开始了！刷新页面即可投信 →
      </div>
    );
  }

  return (
    <div className="mt-4 grid grid-cols-4 gap-2">
      <TimeCell value={d} unit="天" />
      <TimeCell value={h} unit="时" />
      <TimeCell value={m} unit="分" />
      <TimeCell value={s} unit="秒" />
    </div>
  );
}

function TimeCell({ value, unit }: { value: number; unit: string }) {
  return (
    <div className="rounded-lg border border-cyan-500/30 bg-black/60 py-2 text-center shadow-[0_0_12px_rgba(45,226,230,0.1)]">
      <div className="font-['Orbitron',sans-serif] text-xl font-bold text-cyan-200 tabular-nums">
        {String(value).padStart(2, "0")}
      </div>
      <div className="mt-0.5 font-mono text-[10px] text-gray-400">{unit}</div>
    </div>
  );
}
