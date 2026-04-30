import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CalendarClock, Sparkles } from "lucide-react";
import { listTopics, type Topic } from "@/lib/mail-topics";
import { formatBeijing } from "@/components/mail/mail-time";

// 必须每次请求都重新执行 listTopics，否则 Next.js 会在 build 时静态预渲染一次，
// 生产环境（Docker 镜像构建时 DB 可能为空或不可达）将永久返回空列表。
export const dynamic = "force-dynamic";

/**
 * 活动聚合页（方案 §6 / §8 PR3b）。
 *
 * 展示所有"此刻可投信"的活动主题（非归档、启用、在时间窗内）。
 * 主要给全站 banner 的多活动文案"查看全部 →"做落地页。
 *
 * 单活动 / 多活动 / 无活动都展示同一张卡片网格（统一体验）；列表为空
 * 时给个友好提示 + noindex（防止搜索引擎把空页面收录）。
 */

export async function generateMetadata(): Promise<Metadata> {
  const topics = await listTopics({ onlyPublicActive: true });
  const count = topics.length;
  const title =
    count > 0 ? `${count} 个活动进行中 · UliUli` : "活动信箱 · UliUli";
  const description =
    count > 0
      ? `UliUli 的活动信箱聚合页，当前有 ${count} 个活动可参与投信`
      : "UliUli 当前没有进行中的活动";
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    robots: { index: false, follow: false },
  };
}

export default async function TopicListPage() {
  const topics = await listTopics({ onlyPublicActive: true });

  return (
    <main className="relative min-h-screen overflow-hidden bg-linear-to-br from-black via-[#0a0616] to-[#050508] text-white">
      {/* 背景装饰 */}
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
        className="pointer-events-none absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-cyan-500/10 blur-3xl"
      />

      <div className="relative z-10 mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
        {/* 顶部导航 */}
        <div className="mb-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-black/40 px-3 py-1.5 font-mono text-[11px] text-cyan-200 transition hover:bg-cyan-400/10"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回主站
          </Link>
        </div>

        {/* 页面标题 */}
        <header className="mb-8">
          <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.25em] text-cyan-300/80">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
            <span>EVENTS · 活动信箱</span>
          </div>
          <h1 className="mt-2 font-['Orbitron',sans-serif] text-3xl font-bold tracking-wide text-white sm:text-4xl">
            {topics.length > 0
              ? `${topics.length} 个活动进行中`
              : "当前没有进行中的活动"}
          </h1>
          <p className="mt-3 font-sans text-sm leading-relaxed text-gray-400">
            {topics.length > 0
              ? "选一个你想参与的活动，匿名写下想说的话 ~"
              : "下次来可能就有惊喜了。你也可以从主站左下角给常规信箱投信。"}
          </p>
        </header>

        {/* 卡片网格 / 空态 */}
        {topics.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {topics.map((t) => (
              <TopicCard key={t.id} topic={t} />
            ))}
          </div>
        ) : (
          <EmptyState />
        )}

        {/* 页脚 */}
        <div className="mt-12 text-center font-mono text-[11px] tracking-[0.2em] text-gray-500">
          UliUli · MAIL_TOPICS
        </div>
      </div>
    </main>
  );
}

function TopicCard({ topic }: { topic: Topic }) {
  return (
    <Link
      href={`/m/${topic.slug}`}
      className="group flex flex-col gap-3 rounded-2xl border border-cyan-400/30 bg-black/60 p-5 shadow-[0_0_30px_rgba(45,226,230,0.08)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-cyan-400/60 hover:shadow-[0_0_30px_rgba(45,226,230,0.2)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] tracking-[0.25em] text-cyan-300/80">
            EVENT
          </div>
          <h2 className="mt-1 truncate font-['Orbitron',sans-serif] text-lg font-bold text-white group-hover:text-cyan-200">
            {topic.title}
          </h2>
        </div>
        <span
          className="shrink-0 font-mono text-lg text-cyan-300 transition group-hover:translate-x-0.5"
          aria-hidden
        >
          →
        </span>
      </div>

      {topic.description && (
        <p className="line-clamp-3 font-sans text-sm leading-relaxed text-gray-300">
          {topic.description}
        </p>
      )}

      {topic.endsAt && (
        <div className="mt-auto inline-flex w-fit items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-500/10 px-2.5 py-1 font-mono text-[10px] text-amber-200">
          <CalendarClock className="h-3 w-3" />
          截止 · {formatBeijing(topic.endsAt)}
        </div>
      )}
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-cyan-400/20 bg-black/40 p-10 text-center backdrop-blur-xl">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-500/5">
        <Sparkles
          className="h-6 w-6 text-cyan-300/70"
          strokeWidth={1.6}
          aria-hidden
        />
      </div>
      <p className="font-mono text-sm text-gray-300">
        当前暂无进行中的活动
      </p>
      <p className="mt-2 font-mono text-xs text-gray-500">
        主站左下角仍可给 Uli 投一封常规来信 ~
      </p>
    </div>
  );
}
