"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Copy as CopyIcon,
  PencilLine,
  Power,
} from "lucide-react";
import { useWindChimeTopics, useWindChimePosterConfig } from '@windchime/embed/react';
import { mailClient } from '@/lib/windchime-client';
import { MailInbox } from '@/components/mail/MailInbox';
import { MailBlocklist } from '@/components/mail/MailBlocklist';
import { MailShare } from '@/components/mail/MailShare';
import { BlockedTermsPanel } from "@/components/mail/BlockedTermsPanel";
import {
  FlaggedMailPanel,
} from "@/components/mail/FlaggedMailPanel";
import { MailTopicTabs } from "@/components/mail/MailTopicTabs";
import { NewTopicModal } from "@/components/mail/NewTopicModal";
import { EditTopicModal } from "@/components/mail/EditTopicModal";
import { ArchivedTopicsDrawer } from "@/components/mail/ArchivedTopicsDrawer";
import { ArchiveConfirmModal } from "@/components/mail/ArchiveConfirmModal";
import type { Topic } from "@/components/mail/mail-topic-types";
import { formatBeijing } from "@/components/mail/mail-time";

export default function MailPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [sessionChecking, setSessionChecking] = useState(true);
  const [pwdInput, setPwdInput] = useState("");
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdChecking, setPwdChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/mail/session", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { authenticated?: boolean }) => {
        if (!cancelled) setAuthenticated(!!data.authenticated);
      })
      .catch(() => {
        if (!cancelled) setAuthenticated(false);
      })
      .finally(() => {
        if (!cancelled) setSessionChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmitPwd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwdInput) return;
    setPwdChecking(true);
    setPwdError(null);
    try {
      const res = await fetch("/api/mail/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwdInput }),
      });
      if (res.ok) {
        setAuthenticated(true);
        setPwdInput("");
      } else {
        setPwdError(`ACCESS_DENIED · ${await readError(res)}`);
      }
    } finally {
      setPwdChecking(false);
    }
  };

  const onLogout = async () => {
    await fetch("/api/mail/session", { method: "DELETE" }).catch(() => {});
    setAuthenticated(false);
    setPwdInput("");
  };

  return (
    <>
      {/* 赛博朋克背景 */}
      <div className="fixed inset-0 -z-10 overflow-hidden bg-[#050508]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(45,226,230,0.18),transparent_45%),radial-gradient(circle_at_85%_85%,rgba(139,92,246,0.15),transparent_50%)]" />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(45,226,230,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(45,226,230,0.5) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
      </div>

      <main className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-10 px-4 py-12 sm:px-6">
        <header className="flex flex-col items-center text-center">
          <div className="mb-2 font-mono text-[11px] tracking-[0.4em] text-cyan-400/80">
            ULIULI · MAIL · CONSOLE
          </div>
          <h1 className="font-['Orbitron',sans-serif] text-4xl font-black tracking-[0.15em] text-white drop-shadow-[0_0_20px_rgba(45,226,230,0.55)] sm:text-5xl">
            MAIL_BOX
          </h1>
          <p className="mt-3 font-mono text-sm text-gray-400">
            Uli 的匿名来信都挂在这里
          </p>
          {authenticated && (
            <button
              type="button"
              onClick={onLogout}
              className="mt-5 rounded-md border border-cyan-500/40 bg-black/60 px-4 py-1.5 font-mono text-xs text-cyan-300 transition hover:bg-cyan-400/10"
            >
              [ LOGOUT ]
            </button>
          )}
        </header>

        {sessionChecking ? (
          <div className="mx-auto font-mono text-sm tracking-[0.2em] text-cyan-300/70">
            VERIFYING SESSION...
          </div>
        ) : !authenticated ? (
          <PasswordGate
            value={pwdInput}
            onChange={setPwdInput}
            onSubmit={onSubmitPwd}
            error={pwdError}
            loading={pwdChecking}
          />
        ) : (
          <MailContent onUnauthorized={onLogout} />
        )}
      </main>
    </>
  );
}

function PasswordGate({
  value,
  onChange,
  onSubmit,
  error,
  loading,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  error: string | null;
  loading: boolean;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto w-full max-w-md rounded-2xl border border-cyan-400/40 bg-black/70 p-8 shadow-[0_0_40px_rgba(45,226,230,0.2)] backdrop-blur-xl"
    >
      <label
        htmlFor="mail-pwd"
        className="mb-2 block font-mono text-xs uppercase tracking-[0.25em] text-cyan-400"
      >
        ADMIN_KEY
      </label>
      <input
        id="mail-pwd"
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="current-password"
        autoFocus
        className="w-full rounded-lg border border-cyan-500/30 bg-black/60 px-5 py-3 font-mono text-sm text-white placeholder:text-gray-500 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
        placeholder="请输入管理员密码"
      />
      {error && (
        <p className="mt-3 rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 py-2 font-mono text-xs text-rose-300">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={loading || !value}
        className="mt-5 w-full rounded-lg border border-cyan-400 bg-cyan-400 px-5 py-3 font-['Orbitron',sans-serif] text-sm font-bold tracking-[0.2em] text-black shadow-[0_0_20px_rgba(45,226,230,0.5)] transition hover:bg-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "VERIFYING..." : "ENTER"}
      </button>
    </form>
  );
}

function MailContent({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const topicsApi = useWindChimeTopics(mailClient, {includeArchived: false});
  const topics = topicsApi.items;
  const [selectedTopicId, setActiveTopicId] = useState('default');
  const activeTopicId = topics.length && !topics.some(t=>t.id===selectedTopicId) ? 'default' : selectedTopicId;
  const [showNewTopicModal, setShowNewTopicModal] = useState(false);
  const [showArchivedDrawer, setShowArchivedDrawer] = useState(false);
  const [archiveConfirmTopic, setArchiveConfirmTopic] = useState<Topic | null>(null);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [copiedToast, setCopiedToast] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const activeTopic = topics.find(t => t.id === activeTopicId) ?? null;
  const editingTopic = topics.find(t => t.id === editingTopicId) ?? null;
  const topicsError = topicsApi.error?.message || actionError;
  const enabledSaving = topicsApi.pending;
  const enabledError = topicsApi.mutationError?.message;
  const archiveBusy = topicsApi.pending;

  useEffect(() => {
    window.addEventListener('mail:unauthorized', onUnauthorized);
    return () => window.removeEventListener('mail:unauthorized', onUnauthorized);
  }, [onUnauthorized]);

  const toggleCurrentTopicEnabled = async (enabled: boolean) => {
    if (activeTopic) await topicsApi.update(activeTopic.id, {isEnabled: enabled}).catch(()=>{});
  };
  const onCreatedTopic = (topic: Topic) => setActiveTopicId(topic.id);
  const onUpdatedTopic = () => setEditingTopicId(null);
  const onRestoredTopic = (topic: Topic) => { setActiveTopicId(topic.id); setShowArchivedDrawer(false); };
  const performArchive = async (topic: Topic, markReadFirst: boolean) => {
    setActionError(null);
    try {
      await topicsApi.archive(topic.id, {markReadFirst});
      if (activeTopicId === topic.id) setActiveTopicId('default');
      setArchiveConfirmTopic(null);
    } catch (error) { setActionError(error instanceof Error ? error.message : '归档失败'); }
  };
  const handleArchiveIntent = (topic: Topic) => {
    if (topic.isDefault) return;
    if ((topic.unreadCount ?? 0) + (topic.flaggedCount ?? 0) > 0) setArchiveConfirmTopic(topic);
    else void performArchive(topic, false);
  };

  const onCopyShareLink = useCallback(async () => {
    if (!activeTopic) return;
    const origin = window.location.origin;
    const url = activeTopic.isDefault
      ? origin
      : `${origin}/m/${activeTopic.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToast(true);
      window.setTimeout(() => setCopiedToast(false), 1500);
    } catch {
      alert(`请手动复制：${url}`);
    }
  }, [activeTopic]);

  const shareUrl =
    activeTopic && typeof window !== "undefined"
      ? activeTopic.isDefault
        ? window.location.origin
        : `${window.location.origin}/m/${activeTopic.slug}`
      : "";

  const {value: poster, setValue: setPoster} = useWindChimePosterConfig({
    heading: "给 Uli 匿名投一封信",
    body: "扫码发信，你的留言可能会在直播里被读到哦 ~",
    footer: "", avatarSrc: "",
  }, {storageKey: "uliuli:mail:poster"});

  // 首次挂载时从 B 站 API 拉头像作为默认值（海报 Hook 已有 storageKey，
  // 会优先读 localStorage，所以这里仅在用户还没自定义头像时才填充）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/bilibili", { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as {
          success?: boolean;
          user?: { face?: string };
        };
        const face = d?.user?.face;
        if (!cancelled && face) {
          setPoster((p) => (p.avatarSrc ? p : { ...p, avatarSrc: face }));
        }
      } catch {
        /* 忽略：头像是增强项，不阻塞页面 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setPoster]);

  const inboxTitle = activeTopic
    ? `INBOX · ${activeTopic.title}`
    : "INBOX · 收件箱";
  const statusCaption = !activeTopic
    ? "加载中…"
    : activeTopic.isDefault
      ? activeTopic.isEnabled
        ? "常规信箱已开启，访客可正常投递。"
        : "常规信箱已关闭，主站入口变灰并禁止发送。"
      : activeTopic.isEnabled
        ? `「${activeTopic.title}」已开启，访客可通过 /m/${activeTopic.slug} 投信。`
        : `「${activeTopic.title}」暂停中，访客看到"活动暂停"提示。`;

  return (
    <div className="flex flex-col gap-10">
      {/* 主题 Tab 栏（方案 §6.1） */}
      <section>
        <MailTopicTabs
          topics={topics}
          activeTopicId={activeTopicId}
          onSwitch={setActiveTopicId}
          onOpenNewTopic={() => setShowNewTopicModal(true)}
          onOpenArchivedDrawer={() => setShowArchivedDrawer(true)}
          onScrollToGlobalSettings={() => {
            document
              .getElementById("global-settings")
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          onQuickArchive={(topicId) => {
            const t = topics.find((x) => x.id === topicId);
            if (t) handleArchiveIntent(t);
          }}
        />
        {topicsError && (
          <div className="mt-2 font-mono text-[11px] text-rose-300">
            {topicsError}
          </div>
        )}
      </section>

      {/* 当前主题 · 开关 / 归档 / 分享链接 */}
      {activeTopic && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-cyan-400/40 bg-black/60 p-5 shadow-[0_0_30px_rgba(45,226,230,0.12)] backdrop-blur-xl sm:p-6">
            <div className="flex items-center gap-3">
              <Power
                className="h-6 w-6 text-cyan-300 drop-shadow-[0_0_8px_rgba(45,226,230,0.6)]"
                strokeWidth={2.2}
                aria-hidden
              />
              <div>
                <div className="font-['Orbitron',sans-serif] text-sm font-bold tracking-[0.12em] text-white">
                  {activeTopic.title} · STATUS
                </div>
                <div className="mt-1 font-mono text-xs text-gray-400">
                  {statusCaption}
                </div>
                {!activeTopic.isDefault && activeTopic.startsAt && activeTopic.endsAt && (
                  <div className="mt-0.5 font-mono text-[11px] text-gray-500">
                    活动期: {formatBeijing(activeTopic.startsAt)} ~{" "}
                    {formatBeijing(activeTopic.endsAt)}
                  </div>
                )}
                {enabledError && (
                  <div className="mt-1 font-mono text-xs text-rose-300">
                    {enabledError}
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setEditingTopicId(activeTopic.id)}
                className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-black/60 px-3 py-1.5 font-mono text-xs text-cyan-200 transition hover:bg-cyan-400/10"
              >
                <PencilLine className="h-3.5 w-3.5" />
                编辑主题
              </button>

              <button
                type="button"
                onClick={onCopyShareLink}
                className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-black/60 px-3 py-1.5 font-mono text-xs text-cyan-200 transition hover:bg-cyan-400/10"
                title={
                  activeTopic.isDefault
                    ? "复制主站链接"
                    : `复制 /m/${activeTopic.slug} 分享链接`
                }
              >
                <CopyIcon className="h-3.5 w-3.5" />
                {copiedToast ? "已复制 ✓" : "复制分享链接"}
              </button>

              {!activeTopic.isDefault && (
                <button
                  type="button"
                  onClick={() => handleArchiveIntent(activeTopic)}
                  className="flex items-center gap-1.5 rounded-lg border border-amber-400/50 bg-black/60 px-3 py-1.5 font-mono text-xs text-amber-200 transition hover:bg-amber-500/20"
                >
                  <Archive className="h-3.5 w-3.5" />
                  归档主题
                </button>
              )}

              <button
                type="button"
                role="switch"
                aria-checked={activeTopic.isEnabled}
                disabled={enabledSaving}
                onClick={() => toggleCurrentTopicEnabled(!activeTopic.isEnabled)}
                className={
                  "relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-60 " +
                  (activeTopic.isEnabled
                    ? "border-cyan-400 bg-cyan-400 shadow-[0_0_18px_rgba(45,226,230,0.6)]"
                    : "border-gray-600 bg-gray-700")
                }
              >
                <span
                  className={
                    "inline-block h-6 w-6 transform rounded-full bg-black shadow transition " +
                    (activeTopic.isEnabled ? "translate-x-7" : "translate-x-1")
                  }
                />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 外链安全提示（匿名访客可填链接，提醒主播谨防钓鱼） */}
      <section className="rounded-xl border border-amber-400/30 bg-amber-500/5 px-4 py-3 backdrop-blur">
        <div className="flex items-start gap-2 font-mono text-xs leading-relaxed">
          <AlertTriangle
            className="h-4 w-4 shrink-0 translate-y-0.5 text-amber-300"
            strokeWidth={2}
            aria-hidden
          />
          <div className="text-amber-100/85">
            <span className="font-bold tracking-wide text-amber-200">
              SECURITY · 外链安全提醒：
            </span>
            留言里的链接由匿名访客填入，存在钓鱼站风险。所有外链已强制在新标签页打开并切断
            <code className="mx-1 rounded bg-black/40 px-1 text-amber-300">opener</code>
            引用，点击前请留意域名（例如{" "}
            <code className="rounded bg-black/40 px-1 text-amber-300">bilibili.com</code>{" "}
            被写成{" "}
            <code className="rounded bg-black/40 px-1 text-rose-300">bili-bili.com</code>
            就是伪造）。
          </div>
        </div>
      </section>

      {/* 独立私人控制台，直播软件只采集其生成的展示链接。 */}
      <p><a href="/mail/live" className="underline">打开风铃直播控制台 · 审核 / 待播 / 一键隐藏</a></p>
      {/* 收件箱（跟随当前主题） */}
      <section>
        <MailInbox topicId={activeTopicId} title={inboxTitle} emptyText={activeTopic?.isDefault ? '暂无来信。' : '该主题暂无来信。'} />
      </section>

      {/* 待审核（命中敏感词的留言，默认折叠，点击查看原文） */}
      <section>
        <FlaggedMailPanel key={activeTopicId} topicId={activeTopicId} />
      </section>

      {/* 黑名单（全局，跨主题共享） */}
      <section>
        <MailBlocklist />
      </section>

      {/* 分享二维码 + 海报编辑（URL 跟随当前主题） */}
      {shareUrl && (
        <section className="flex flex-col gap-6">
          <MailShare url={shareUrl} title={activeTopic?.isDefault ? "SHARE · MAIL_BOX" : `SHARE · ${activeTopic?.title ?? "TOPIC"}`}
            subtitle={`扫码前往 ${shareUrl.replace(/^https?:\/\//, "")} 给 Uli 投信`}
            downloadName={activeTopic?.isDefault ? "uliuli-mail-qr" : `uliuli-topic-${activeTopic?.slug ?? "topic"}-qr`}
            foreground="#2de2e6" background="#050508" value={poster} onChange={setPoster}
            posterOptions={{
              enabled: true,
              brandingText: "🎐 WindChime 匿名提问箱",
              textColor: "#ffffff",
              heading: poster.heading,
              body: poster.body,
              footer: poster.footer || shareUrl.replace(/^https?:\/\//, ""),
              gradient: ["#050508", "#1a1033"],
              backgroundImageSrc: "/Background.webp",
              backgroundImageOverlay: "rgba(5,5,8,0.55)",
              avatarSrc: avatarSrcForCanvas(poster.avatarSrc) || undefined,
            }}
          />
        </section>
      )}

      {/* 全局设置：敏感词（跨主题共享，低频配置） */}
      <section id="global-settings">
        <BlockedTermsPanel />
      </section>

      {/* ===== 模态 / 抽屉 ===== */}
      <NewTopicModal
        open={showNewTopicModal}
        onClose={() => setShowNewTopicModal(false)}

        onCreated={onCreatedTopic}
      />
      <EditTopicModal
        open={!!editingTopicId && !!editingTopic}
        topic={editingTopic}

        onClose={() => setEditingTopicId(null)}
        onUpdated={onUpdatedTopic}
      />
      <ArchivedTopicsDrawer
        key={String(showArchivedDrawer)}
        open={showArchivedDrawer}
        onClose={() => setShowArchivedDrawer(false)}

        onRestored={onRestoredTopic}
      />
      <ArchiveConfirmModal
        open={!!archiveConfirmTopic}
        topic={archiveConfirmTopic}
        busy={archiveBusy}
        error={actionError}
        onCancel={() => !archiveBusy && setArchiveConfirmTopic(null)}
        onMarkReadThenArchive={() =>
          archiveConfirmTopic && performArchive(archiveConfirmTopic, true)
        }
        onArchiveAnyway={() =>
          archiveConfirmTopic && performArchive(archiveConfirmTopic, false)
        }
      />
    </div>
  );
}

/**
 * 把 B 站 hdslb.com 域名的头像 URL 自动改写为同源代理，避免
 * `<MailShare>` 用 `crossOrigin='anonymous'` 跨域加载失败。
 * 非 B 站域名直接原样返回，便于用户手动填其它图床。
 */
function avatarSrcForCanvas(src: string | undefined | null): string {
  const s = src?.trim();
  if (!s) return "";
  if (s.startsWith("/api/mail/proxy-image")) return s;
  try {
    const u = new URL(s);
    if (u.hostname.endsWith("hdslb.com")) {
      return `/api/mail/proxy-image?src=${encodeURIComponent(s)}`;
    }
  } catch {
    /* 非合法 URL，原样返回 */
  }
  return s;
}

async function readError(res: Response): Promise<string> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    return j?.error ?? res.statusText;
  }
  return (await res.text().catch(() => "")) || res.statusText;
}
