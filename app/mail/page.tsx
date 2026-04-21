"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Power } from "lucide-react";
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
  const [items, setItems] = useState<FlaggableRecord[]>([]);
  const [counts, setCounts] = useState<Record<WindChimeInboxFilter, number>>({
    all: 0,
    unread: 0,
    favorited: 0,
  });
  const [filter, setFilter] = useState<WindChimeInboxFilter>("all");
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [blocklist, setBlocklist] = useState<WindChimeBlockedSender[]>([]);
  const [blLoading, setBlLoading] = useState(false);
  const [blError, setBlError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [enabledSaving, setEnabledSaving] = useState(false);
  const [enabledError, setEnabledError] = useState<string | null>(null);

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

  const reload = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const r = await fetch("/api/mail/messages", {
        headers: authHeader,
        cache: "no-store",
      });
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
  }, [authHeader, handleAuthError]);

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

  const reloadSettings = useCallback(async () => {
    setEnabledError(null);
    try {
      const r = await fetch("/api/mail/settings", { cache: "no-store" });
      if (!r.ok) throw new Error(await readError(r));
      const j = (await r.json()) as { enabled?: boolean };
      if (typeof j.enabled === "boolean") setEnabled(j.enabled);
    } catch (e) {
      setEnabledError(e instanceof Error ? e.message : "读取失败");
    }
  }, []);

  const toggleEnabled = useCallback(
    async (next: boolean) => {
      setEnabledSaving(true);
      setEnabledError(null);
      const prev = enabled;
      setEnabled(next);
      try {
        const r = await fetch("/api/mail/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ enabled: next }),
        });
        if (handleAuthError(r)) return;
        if (!r.ok) throw new Error(await readError(r));
        const j = (await r.json()) as { enabled?: boolean };
        if (typeof j.enabled === "boolean") setEnabled(j.enabled);
      } catch (e) {
        setEnabled(prev);
        setEnabledError(e instanceof Error ? e.message : "保存失败");
      } finally {
        setEnabledSaving(false);
      }
    },
    [authHeader, enabled, handleAuthError],
  );

  useEffect(() => {
    void reload();
    void reloadBlocklist();
    void reloadSettings();
  }, [reload, reloadBlocklist, reloadSettings]);

  const patch = useCallback(
    async (id: string, body: { isRead?: boolean; isFavorited?: boolean }) => {
      const r = await fetch(`/api/mail/messages/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify(body),
      });
      if (handleAuthError(r)) return;
      if (!r.ok) throw new Error(await readError(r));
      await reload();
    },
    [authHeader, handleAuthError, reload],
  );

  const onDelete = useCallback(
    async (id: string) => {
      const r = await fetch(`/api/mail/messages/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: authHeader,
      });
      if (handleAuthError(r)) return;
      if (!r.ok) throw new Error(await readError(r));
      await reload();
    },
    [authHeader, handleAuthError, reload],
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
        `/api/mail/messages/${encodeURIComponent(id)}/block`,
        { method: "POST", headers: authHeader },
      );
      if (handleAuthError(r)) return;
      if (!r.ok) throw new Error(await readError(r));
      await Promise.all([reload(), reloadBlocklist()]);
    },
    [authHeader, handleAuthError, reload, reloadBlocklist],
  );

  const batchOp = useCallback(
    async (op: "delete" | "markRead", ids: string[]) => {
      const r = await fetch("/api/mail/messages/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ action: op, ids }),
      });
      if (handleAuthError(r)) return;
      if (!r.ok) throw new Error(await readError(r));
      await reload();
    },
    [authHeader, handleAuthError, reload],
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

  const [shareUrl, setShareUrl] = useState("");
  useEffect(() => {
    setShareUrl(window.location.origin);
  }, []);

  const [poster, setPoster] = useState<WindChimeQrPosterConfig>(() => ({
    ...DEFAULT_POSTER_CONFIG,
    heading: "给 Uli 匿名投一封信",
    body: "扫码发信，直播时 Uli 可能会回复哦 ~",
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

  return (
    <div className="flex flex-col gap-10">
      {/* 开关 */}
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
                MAIL_BOX · STATUS
              </div>
              <div className="mt-1 font-mono text-xs text-gray-400">
                {enabled === null
                  ? "读取中…"
                  : enabled
                    ? "发信箱已开启，访客可正常投递。"
                    : "发信箱已关闭，主站入口变灰并禁止发送。"}
              </div>
              {enabledError && (
                <div className="mt-1 font-mono text-xs text-rose-300">
                  {enabledError}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!enabled}
            disabled={enabled === null || enabledSaving}
            onClick={() => toggleEnabled(!enabled)}
            className={
              "relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-60 " +
              (enabled
                ? "border-cyan-400 bg-cyan-400 shadow-[0_0_18px_rgba(45,226,230,0.6)]"
                : "border-gray-600 bg-gray-700")
            }
          >
            <span
              className={
                "inline-block h-6 w-6 transform rounded-full bg-black shadow transition " +
                (enabled ? "translate-x-7" : "translate-x-1")
              }
            />
          </button>
        </div>
      </section>

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

      {/* 收件箱 */}
      <section>
        <WindChimeAdminPanel
          title="INBOX · 收件箱"
          emptyText="暂无来信。"
          items={items}
          counts={counts}
          filter={filter}
          onFilterChange={setFilter}
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
          onUnauthorized={onUnauthorized}
          onAfterAction={() => void reload()}
        />
      </section>

      {/* 黑名单 */}
      <section>
        <WindChimeBlocklistPanel
          title="BLOCKLIST · 黑名单"
          emptyText="尚未拉黑任何发送者。"
          items={blocklist}
          isLoading={blLoading}
          error={blError}
          onReload={() => void reloadBlocklist()}
          onUnblock={onUnblock}
          theme={mailBlocklistTheme}
        />
      </section>

      {/* 分享二维码 + 海报编辑 */}
      {shareUrl && (
        <section className="flex flex-col gap-6">
          <WindChimeQrCard
            url={shareUrl}
            title="SHARE · MAIL_BOX"
            subtitle={`扫码前往 ${shareUrl.replace(/^https?:\/\//, "")} 给 Uli 投信`}
            size={260}
            foreground="#2de2e6"
            background="#050508"
            downloadName="uliuli-mail-qr"
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

      {/* 敏感词管理（低频配置，放页尾） */}
      <section>
        <BlockedTermsPanel
          authHeader={authHeader}
          onUnauthorized={onUnauthorized}
        />
      </section>
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
