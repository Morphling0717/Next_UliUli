"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Copy as CopyIcon,
  PencilLine,
  Power,
} from "lucide-react";
import {
  DEFAULT_POSTER_CONFIG,
  WindChimeAdminPanel,
  WindChimeBlocklistPanel,
  WindChimeQrCard,
  WindChimeQrPosterEditor,
} from "@windchime/embed";
import type {
  WindChimeBlockedSender,
  WindChimeInboxFilter,
  WindChimeQrPosterConfig,
} from "@windchime/embed";
import "@windchime/embed/styles/windchime.css";
import {
  mailAdminTheme,
  mailBlocklistTheme,
  mailPosterEditorTheme,
  mailQrTheme,
} from "@/components/mail/mail-theme";
import { BlockedTermsPanel } from "@/components/mail/BlockedTermsPanel";
import {
  FlaggedMailPanel,
  type FlaggableRecord,
} from "@/components/mail/FlaggedMailPanel";
import { MailTopicTabs } from "@/components/mail/MailTopicTabs";
import { NewTopicModal } from "@/components/mail/NewTopicModal";
import { EditTopicModal } from "@/components/mail/EditTopicModal";
import { ArchivedTopicsDrawer } from "@/components/mail/ArchivedTopicsDrawer";
import { ArchiveConfirmModal } from "@/components/mail/ArchiveConfirmModal";
import type { Topic } from "@/components/mail/mail-topic-types";
import { formatBeijing } from "@/components/mail/mail-time";

const PWD_STORAGE_KEY = "uliuli:mail:pwd";

export default function MailPage() {
  const [password, setPassword] = useState<string | null>(null);
  const [pwdInput, setPwdInput] = useState("");
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdChecking, setPwdChecking] = useState(false);

  useEffect(() => {
    const stored = window.sessionStorage.getItem(PWD_STORAGE_KEY);
    if (stored) {
      void verifyPassword(stored).then((ok) => {
        if (ok) setPassword(stored);
        else window.sessionStorage.removeItem(PWD_STORAGE_KEY);
      });
    }
  }, []);

  const onSubmitPwd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwdInput) return;
    setPwdChecking(true);
    setPwdError(null);
    try {
      const ok = await verifyPassword(pwdInput);
      if (ok) {
        window.sessionStorage.setItem(PWD_STORAGE_KEY, pwdInput);
        setPassword(pwdInput);
      } else {
        setPwdError("ACCESS_DENIED · 密码错误");
      }
    } finally {
      setPwdChecking(false);
    }
  };

  const onLogout = () => {
    window.sessionStorage.removeItem(PWD_STORAGE_KEY);
    setPassword(null);
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
          {password && (
            <button
              type="button"
              onClick={onLogout}
              className="mt-5 rounded-md border border-cyan-500/40 bg-black/60 px-4 py-1.5 font-mono text-xs text-cyan-300 transition hover:bg-cyan-400/10"
            >
              [ LOGOUT ]
            </button>
          )}
        </header>

        {!password ? (
          <PasswordGate
            value={pwdInput}
            onChange={setPwdInput}
            onSubmit={onSubmitPwd}
            error={pwdError}
            loading={pwdChecking}
          />
        ) : (
          <MailContent password={password} onUnauthorized={onLogout} />
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

async function verifyPassword(pwd: string): Promise<boolean> {
  try {
    const r = await fetch("/api/mail/messages", {
      method: "GET",
      headers: { "x-mail-password": pwd },
      cache: "no-store",
    });
    return r.ok;
  } catch {
    return false;
  }
}

type ListResponse = {
  items: FlaggableRecord[];
  counts: Record<WindChimeInboxFilter, number>;
};

function MailContent({
  password,
  onUnauthorized,
}: {
  password: string;
  onUnauthorized: () => void;
}) {
  // ===== 主题 state =====
  const [topics, setTopics] = useState<Topic[]>([]);
  const [activeTopicId, setActiveTopicId] = useState<string>("default");
  const [topicsError, setTopicsError] = useState<string | null>(null);

  // ===== 留言列表 state（跟随 activeTopicId） =====
  const [items, setItems] = useState<FlaggableRecord[]>([]);
  const [counts, setCounts] = useState<Record<WindChimeInboxFilter, number>>({
    all: 0,
    unread: 0,
    favorited: 0,
  });
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // ===== 全局黑名单 state（跨主题共享） =====
  const [blocklist, setBlocklist] = useState<WindChimeBlockedSender[]>([]);
  const [blLoading, setBlLoading] = useState(false);
  const [blError, setBlError] = useState<string | null>(null);

  // ===== 主题开关 state（操作当前 activeTopic 的 isEnabled） =====
  const [enabledSaving, setEnabledSaving] = useState(false);
  const [enabledError, setEnabledError] = useState<string | null>(null);

  // ===== 模态 / 抽屉 state =====
  const [showNewTopicModal, setShowNewTopicModal] = useState(false);
  const [showArchivedDrawer, setShowArchivedDrawer] = useState(false);
  const [archiveConfirmTopic, setArchiveConfirmTopic] = useState<Topic | null>(
    null,
  );
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);

  const authHeader = useMemo(
    () => ({ "x-mail-password": password }),
    [password],
  );

  const handleAuthError = useCallback(
    (res: Response): boolean => {
      if (res.status === 401) {
        onUnauthorized();
        return true;
      }
      return false;
    },
    [onUnauthorized],
  );

  const activeTopic = useMemo(
    () => topics.find((t) => t.id === activeTopicId) ?? null,
    [topics, activeTopicId],
  );
  const editingTopic = useMemo(
    () => topics.find((t) => t.id === editingTopicId) ?? null,
    [topics, editingTopicId],
  );

  // ===== 拉主题列表（管理端带 unreadCount / flaggedCount） =====
  const reloadTopics = useCallback(async () => {
    setTopicsError(null);
    try {
      const r = await fetch("/api/mail/topics", {
        headers: authHeader,
        cache: "no-store",
      });
      if (handleAuthError(r)) return;
      if (!r.ok) throw new Error(await readError(r));
      const j = (await r.json()) as { items: Topic[] };
      setTopics(j.items);
      // 如果当前选中的 tab 已经被归档或被删，退回 default
      if (!j.items.some((t) => t.id === activeTopicId)) {
        setActiveTopicId("default");
      }
    } catch (e) {
      setTopicsError(e instanceof Error ? e.message : "主题列表加载失败");
    }
  }, [authHeader, handleAuthError, activeTopicId]);

  // ===== 拉当前主题的留言列表 =====
  const reload = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const r = await fetch(
        `/api/mail/messages?topicId=${encodeURIComponent(activeTopicId)}`,
        { headers: authHeader, cache: "no-store" },
      );
      if (handleAuthError(r)) return;
      if (!r.ok) throw new Error(await readError(r));
      const j = (await r.json()) as ListResponse;
      setItems(j.items);
      setCounts(j.counts);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [authHeader, activeTopicId, handleAuthError]);

  const reloadBlocklist = useCallback(async () => {
    setBlLoading(true);
    setBlError(null);
    try {
      const r = await fetch("/api/mail/blocklist", {
        headers: authHeader,
        cache: "no-store",
      });
      if (handleAuthError(r)) return;
      if (!r.ok) throw new Error(await readError(r));
      const j = (await r.json()) as WindChimeBlockedSender[];
      setBlocklist(j);
    } catch (e) {
      setBlError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setBlLoading(false);
    }
  }, [authHeader, handleAuthError]);

  // ===== 切换当前主题的开关 =====
  const toggleCurrentTopicEnabled = useCallback(
    async (next: boolean) => {
      if (!activeTopic) return;
      setEnabledSaving(true);
      setEnabledError(null);
      // 乐观更新（失败时回滚）
      setTopics((xs) =>
        xs.map((t) => (t.id === activeTopic.id ? { ...t, isEnabled: next } : t)),
      );
      try {
        const r = await fetch(
          `/api/mail/topics/${encodeURIComponent(activeTopic.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...authHeader },
            body: JSON.stringify({ isEnabled: next }),
          },
        );
        if (handleAuthError(r)) return;
        if (!r.ok) throw new Error(await readError(r));
        const updated = (await r.json()) as Topic;
        setTopics((xs) =>
          xs.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)),
        );
      } catch (e) {
        // 回滚
        setTopics((xs) =>
          xs.map((t) =>
            t.id === activeTopic.id ? { ...t, isEnabled: !next } : t,
          ),
        );
        setEnabledError(e instanceof Error ? e.message : "保存失败");
      } finally {
        setEnabledSaving(false);
      }
    },
    [authHeader, activeTopic, handleAuthError],
  );

  // 挂载：拉主题 + 黑名单
  useEffect(() => {
    void reloadTopics();
    void reloadBlocklist();
  }, [reloadTopics, reloadBlocklist]);

  // activeTopicId 变化时重新拉留言列表（也适用于首次挂载）
  useEffect(() => {
    void reload();
  }, [reload]);

  // ===== 留言级操作：全部带 ?topicId= 做跨主题防呆 =====
  const patch = useCallback(
    async (id: string, body: { isRead?: boolean; isFavorited?: boolean }) => {
      const r = await fetch(
        `/api/mail/messages/${encodeURIComponent(id)}?topicId=${encodeURIComponent(activeTopicId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify(body),
        },
      );
      if (handleAuthError(r)) return;
      if (!r.ok) throw new Error(await readError(r));
      await Promise.all([reload(), reloadTopics()]);
    },
    [authHeader, activeTopicId, handleAuthError, reload, reloadTopics],
  );

  const onDelete = useCallback(
    async (id: string) => {
      const r = await fetch(
        `/api/mail/messages/${encodeURIComponent(id)}?topicId=${encodeURIComponent(activeTopicId)}`,
        { method: "DELETE", headers: authHeader },
      );
      if (handleAuthError(r)) return;
      if (!r.ok) throw new Error(await readError(r));
      await Promise.all([reload(), reloadTopics()]);
    },
    [authHeader, activeTopicId, handleAuthError, reload, reloadTopics],
  );

  const onToggleRead = useCallback(
    (id: string, isRead: boolean) => patch(id, { isRead }),
    [patch],
  );
  const onToggleFavorite = useCallback(
    (id: string, isFavorited: boolean) => patch(id, { isFavorited }),
    [patch],
  );

  const onBlockSender = useCallback(
    async (id: string) => {
      const r = await fetch(
        `/api/mail/messages/${encodeURIComponent(id)}/block?topicId=${encodeURIComponent(activeTopicId)}`,
        { method: "POST", headers: authHeader },
      );
      if (handleAuthError(r)) return;
      if (!r.ok) throw new Error(await readError(r));
      // 拉黑会跨主题软删该 sender 所有留言 → 刷新所有相关列表
      await Promise.all([reload(), reloadBlocklist(), reloadTopics()]);
    },
    [
      authHeader,
      activeTopicId,
      handleAuthError,
      reload,
      reloadBlocklist,
      reloadTopics,
    ],
  );

  const batchOp = useCallback(
    async (op: "delete" | "markRead", ids: string[]) => {
      const r = await fetch(
        `/api/mail/messages/batch?topicId=${encodeURIComponent(activeTopicId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ action: op, ids }),
        },
      );
      if (handleAuthError(r)) return;
      if (!r.ok) throw new Error(await readError(r));
      await Promise.all([reload(), reloadTopics()]);
    },
    [authHeader, activeTopicId, handleAuthError, reload, reloadTopics],
  );

  const onBatchDelete = useCallback(
    (ids: string[]) => batchOp("delete", ids),
    [batchOp],
  );
  const onBatchMarkRead = useCallback(
    (ids: string[]) => batchOp("markRead", ids),
    [batchOp],
  );

  const onUnblock = useCallback(
    async (hash: string) => {
      const r = await fetch(
        `/api/mail/blocklist/${encodeURIComponent(hash)}`,
        { method: "DELETE", headers: authHeader },
      );
      if (handleAuthError(r)) return;
      if (!r.ok) throw new Error(await readError(r));
      await reloadBlocklist();
    },
    [authHeader, handleAuthError, reloadBlocklist],
  );

  // ===== 主题管理：新建 / 编辑 / 归档 / 恢复 / 复制分享链接 =====
  const onCreatedTopic = useCallback((topic: Topic) => {
    setTopics((xs) => [...xs, topic]);
    setActiveTopicId(topic.id);
  }, []);

  const onUpdatedTopic = useCallback((topic: Topic) => {
    setTopics((xs) =>
      xs.map((x) => (x.id === topic.id ? { ...x, ...topic } : x)),
    );
  }, []);

  const onRestoredTopic = useCallback((topic: Topic) => {
    setTopics((xs) => {
      const without = xs.filter((x) => x.id !== topic.id);
      return [...without, topic];
    });
    setActiveTopicId(topic.id);
    setShowArchivedDrawer(false);
  }, []);

  // 真正归档（DELETE），不问二次确认
  const performArchive = useCallback(
    async (topic: Topic, markReadFirst: boolean) => {
      setArchiveBusy(true);
      try {
        if (markReadFirst) {
          // 先把未读批量 markRead
          const unreadIds = items
            .filter((m) => !m.isRead && !m.isFlagged)
            .map((m) => m.id);
          if (unreadIds.length > 0) {
            await fetch(
              `/api/mail/messages/batch?topicId=${encodeURIComponent(topic.id)}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeader },
                body: JSON.stringify({ action: "markRead", ids: unreadIds }),
              },
            );
          }
        }
        const r = await fetch(
          `/api/mail/topics/${encodeURIComponent(topic.id)}`,
          { method: "DELETE", headers: authHeader },
        );
        if (handleAuthError(r)) return;
        if (!r.ok) throw new Error(await readError(r));
        // 归档成功：切回 default，刷新
        setActiveTopicId("default");
        await reloadTopics();
      } catch (e) {
        alert(e instanceof Error ? e.message : "归档失败");
      } finally {
        setArchiveBusy(false);
        setArchiveConfirmTopic(null);
      }
    },
    [authHeader, handleAuthError, items, reloadTopics],
  );

  // 点"归档"按钮（主内容区 或 tab 上的小图标）
  const handleArchiveIntent = useCallback(
    (topic: Topic) => {
      if (topic.isDefault) return; // 默认主题不可归档（按钮本来就会隐藏）
      const hasBlockers =
        (topic.unreadCount ?? 0) + (topic.flaggedCount ?? 0) > 0;
      if (hasBlockers) {
        setArchiveConfirmTopic(topic);
      } else {
        void performArchive(topic, false);
      }
    },
    [performArchive],
  );

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

  const [shareUrl, setShareUrl] = useState("");
  useEffect(() => {
    if (!activeTopic) {
      setShareUrl("");
      return;
    }
    const origin = window.location.origin;
    setShareUrl(
      activeTopic.isDefault ? origin : `${origin}/m/${activeTopic.slug}`,
    );
  }, [activeTopic]);

  const [poster, setPoster] = useState<WindChimeQrPosterConfig>(() => ({
    ...DEFAULT_POSTER_CONFIG,
    heading: "给 Uli 匿名投一封信",
    body: "扫码发信，你的留言可能会在直播里被读到哦 ~",
  }));

  // 首次挂载时从 B 站 API 拉头像作为默认值（PosterEditor 已有 storageKey，
  // 会优先读 localStorage，所以这里仅在用户还没自定义头像时才填充）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 优先读 site_config 里的 bili API 地址，fallback 到主站默认
        let biliUrl = "https://api.uliuli.cc/api";
        try {
          const c = await fetch("/api/config", { cache: "no-store" });
          if (c.ok) {
            const cj = (await c.json()) as {
              site_config?: { api?: { bilibili?: string } };
            };
            if (cj.site_config?.api?.bilibili) {
              biliUrl = cj.site_config.api.bilibili;
            }
          }
        } catch {
          /* 用 fallback */
        }

        const r = await fetch(biliUrl, { cache: "no-store" });
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
  }, []);

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

      {/* 收件箱（跟随当前主题） */}
      <section>
        <WindChimeAdminPanel
          title={inboxTitle}
          emptyText={
            activeTopic?.isDefault
              ? "暂无来信。"
              : "该主题暂无来信。"
          }
          items={items}
          counts={counts}
          autoClientFilter
          isLoading={loading}
          error={listError}
          onReload={() => void reload()}
          onDelete={onDelete}
          onToggleRead={onToggleRead}
          onToggleFavorite={onToggleFavorite}
          onBlockSender={onBlockSender}
          onBatchDelete={onBatchDelete}
          onBatchMarkRead={onBatchMarkRead}
          theme={mailAdminTheme}
        />
      </section>

      {/* 待审核（命中敏感词的留言，默认折叠，点击查看原文） */}
      <section>
        <FlaggedMailPanel
          items={items}
          authHeader={authHeader}
          topicId={activeTopicId}
          onUnauthorized={onUnauthorized}
          onAfterAction={() => {
            void reload();
            void reloadTopics();
          }}
        />
      </section>

      {/* 黑名单（全局，跨主题共享） */}
      <section>
        <WindChimeBlocklistPanel
          title="BLOCKLIST · 黑名单（全局）"
          emptyText="尚未拉黑任何发送者。"
          items={blocklist}
          isLoading={blLoading}
          error={blError}
          onReload={() => void reloadBlocklist()}
          onUnblock={onUnblock}
          theme={mailBlocklistTheme}
        />
      </section>

      {/* 分享二维码 + 海报编辑（URL 跟随当前主题） */}
      {shareUrl && (
        <section className="flex flex-col gap-6">
          <WindChimeQrCard
            url={shareUrl}
            title={
              activeTopic?.isDefault
                ? "SHARE · MAIL_BOX"
                : `SHARE · ${activeTopic?.title ?? "TOPIC"}`
            }
            subtitle={`扫码前往 ${shareUrl.replace(/^https?:\/\//, "")} 给 Uli 投信`}
            size={260}
            foreground="#2de2e6"
            background="#050508"
            downloadName={
              activeTopic?.isDefault
                ? "uliuli-mail-qr"
                : `uliuli-topic-${activeTopic?.slug ?? "topic"}-qr`
            }
            theme={mailQrTheme}
            poster={{
              enabled: true,
              heading: poster.heading,
              body: poster.body,
              footer: poster.footer || shareUrl.replace(/^https?:\/\//, ""),
              gradient: ["#050508", "#1a1033"],
              backgroundImageSrc: "/Background.webp",
              backgroundImageOverlay: "rgba(5,5,8,0.55)",
              avatarSrc: avatarSrcForCanvas(poster.avatarSrc) || undefined,
            }}
          />

          <WindChimeQrPosterEditor
            value={poster}
            onChange={setPoster}
            storageKey="uliuli:mail:poster"
            theme={mailPosterEditorTheme}
            placeholders={{
              heading: "给 Uli 匿名投一封信",
              body: "扫码后匿名留言，Uli 直播时会念出来 ~",
              footer: "—— UliUli",
            }}
          />
        </section>
      )}

      {/* 全局设置：敏感词（跨主题共享，低频配置） */}
      <section id="global-settings">
        <BlockedTermsPanel
          authHeader={authHeader}
          onUnauthorized={onUnauthorized}
        />
      </section>

      {/* ===== 模态 / 抽屉 ===== */}
      <NewTopicModal
        open={showNewTopicModal}
        onClose={() => setShowNewTopicModal(false)}
        authHeader={authHeader}
        onCreated={onCreatedTopic}
      />
      <EditTopicModal
        open={!!editingTopicId && !!editingTopic}
        topic={editingTopic}
        authHeader={authHeader}
        onClose={() => setEditingTopicId(null)}
        onUpdated={onUpdatedTopic}
      />
      <ArchivedTopicsDrawer
        open={showArchivedDrawer}
        onClose={() => setShowArchivedDrawer(false)}
        authHeader={authHeader}
        onRestored={onRestoredTopic}
      />
      <ArchiveConfirmModal
        open={!!archiveConfirmTopic}
        topic={archiveConfirmTopic}
        busy={archiveBusy}
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
 * `<WindChimeQrCard>` 用 `crossOrigin='anonymous'` 跨域加载失败。
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
