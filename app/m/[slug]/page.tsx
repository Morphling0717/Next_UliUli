import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTopicBySlug, type Topic } from "@/lib/mail-topics";
import { TopicMailForm } from "@/components/mail/TopicMailForm";
import { TopicStatePage } from "@/components/mail/TopicStatePage";

// 必须每次请求都重新读库，主题的开关 / 时间窗状态需要实时反映。
// 即使是动态路由（[slug]），没有 generateStaticParams 时 Next 默认按需渲染，
// 但在某些部署形态下数据仍可能被缓存，这里显式声明更稳妥。
export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ slug: string }>;
};

/**
 * 访客侧活动投信页（方案 §5.3 / §8 PR3）。
 *
 * 状态分发（在服务端判断，保证 SSR 准确 & SEO 友好）：
 * - `isDefault` 主题 → 重定向到 `/`（常规信箱的正确入口是首页左下角）
 * - `archivedAt` 非空 → "活动已结束"页（HTTP 200 + noindex）
 * - `!isEnabled` → "活动暂停中"页（noindex）
 * - `now < startsAt` → "活动即将开始"倒计时页（noindex）
 * - `now > endsAt` → "活动已结束"页（noindex）
 * - 其余 → 渲染 `<TopicMailForm>` 投信页面（indexable）
 *
 * slug **不存在**（db 根本没查到）→ `notFound()` 走 Next 默认 404 页
 * （区别于上面各种"已结束/暂停/未开始"的 200 友好页）。
 */

/** 派生访客视角的呈现变体（对应 TopicStatePage 的 variant / 或 active 投信页） */
type Variant = "redirect-home" | "active" | "ended" | "disabled" | "scheduled";

function resolveVariant(topic: Topic, nowMs: number = Date.now()): Variant {
  if (topic.isDefault) return "redirect-home";
  if (topic.archivedAt) return "ended";
  if (!topic.isEnabled) return "disabled";
  if (topic.startsAt && nowMs < Date.parse(topic.startsAt)) return "scheduled";
  if (topic.endsAt && nowMs > Date.parse(topic.endsAt)) return "ended";
  return "active";
}

export async function generateMetadata(
  { params }: RouteProps,
): Promise<Metadata> {
  const { slug } = await params;
  const topic = await getTopicBySlug(slug);
  if (!topic) {
    // 未知 slug：Next 会走 not-found；这里的 meta 不会最终渲染，简单给个保险
    return {
      title: "找不到该活动 · UliUli",
      robots: { index: false, follow: false },
    };
  }
  if (topic.isDefault) {
    // 会被 redirect 拦掉，meta 也无所谓，防一手
    return { title: "UliUli", robots: { index: false, follow: false } };
  }

  const variant = resolveVariant(topic);
  const siteName = "UliUli";
  const titleMap: Record<Variant, string> = {
    "redirect-home": siteName,
    active: `${topic.title} · ${siteName}`,
    ended: `${topic.title}（活动已结束） · ${siteName}`,
    disabled: `${topic.title}（暂停中） · ${siteName}`,
    scheduled: `${topic.title}（即将开始） · ${siteName}`,
  };
  const description =
    topic.description ||
    (variant === "active"
      ? `活动进行中 · 欢迎给 Uli 投一封信`
      : "UliUli 的活动信箱");

  return {
    title: titleMap[variant],
    description,
    openGraph: {
      title: titleMap[variant],
      description,
      type: "website",
    },
    robots: { index: false, follow: false },
  };
}

export default async function TopicPage({ params }: RouteProps) {
  const { slug } = await params;
  const topic = await getTopicBySlug(slug);
  if (!topic) notFound();

  const variant = resolveVariant(topic);

  if (variant === "redirect-home") {
    redirect("/");
  }

  if (variant === "active") {
    return <TopicMailForm topic={topic} />;
  }

  return (
    <TopicStatePage
      variant={variant}
      topicTitle={topic.title}
      topicDescription={topic.description}
      startsAt={topic.startsAt}
      endsAt={topic.endsAt}
    />
  );
}
