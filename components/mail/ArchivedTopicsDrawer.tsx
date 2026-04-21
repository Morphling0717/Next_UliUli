"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Archive, RotateCcw, X as CloseIcon } from "lucide-react";
import type { Topic } from "./mail-topic-types";
import { formatBeijing } from "./mail-time";

type Props = {
  open: boolean;
  onClose: () => void;
  authHeader: Record<string, string>;
  onRestored: (topic: Topic) => void;
};

async function readError(res: Response): Promise<string> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    return j?.error ?? res.statusText;
  }
  return (await res.text().catch(() => "")) || res.statusText;
}

/**
 * 往期活动抽屉：打开时请求 `/api/mail/topics?include=archived` 拿全部主题，
 * 过滤出归档项展示；支持按 title/slug 搜索 + 一键恢复。
 *
 * v1 不实现"原位查看归档信件"——主播如果要看，恢复后在主 tab 栏切入即可。
 */
export function ArchivedTopicsDrawer({
  open,
  onClose,
  authHeader,
  onRestored,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Topic[]>([]);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/mail/topics?include=archived", {
        headers: authHeader,
        cache: "no-store",
      });
      if (!r.ok) throw new Error(await readError(r));
      const j = (await r.json()) as { items: Topic[] };
      setItems(j.items.filter((t) => t.state === "archived"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [authHeader]);

  // 打开时拉；关闭时清搜索
  useEffect(() => {
    if (open) void load();
    else setSearch("");
  }, [open, load]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (t) =>
        t.title.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q),
    );
  }, [items, search]);

  const onRestore = useCallback(
    async (topic: Topic) => {
      setBusyId(topic.id);
      try {
        const r = await fetch(
          `/api/mail/topics/${encodeURIComponent(topic.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...authHeader },
            body: JSON.stringify({ archivedAt: null }),
          },
        );
        if (!r.ok) throw new Error(await readError(r));
        const restored = (await r.json()) as Topic;
        setItems((xs) => xs.filter((x) => x.id !== topic.id));
        onRestored(restored);
      } catch (e) {
        alert(e instanceof Error ? e.message : "恢复失败");
      } finally {
        setBusyId(null);
      }
    },
    [authHeader, onRestored],
  );

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[1100] flex items-stretch justify-end bg-black/70 backdrop-blur-md"
          onClick={onClose}
        >
          <motion.div
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: "spring", damping: 26, stiffness: 260 }}
            className="relative flex h-full w-full max-w-lg flex-col border-l border-cyan-400/40 bg-black/90 shadow-[-10px_0_40px_rgba(45,226,230,0.2)]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-cyan-400/60 bg-black/80 text-cyan-300 transition hover:bg-cyan-400 hover:text-black"
            >
              <CloseIcon className="h-4 w-4" />
            </button>

            <div className="border-b border-cyan-400/20 px-5 py-4">
              <div className="flex items-center gap-2">
                <Archive className="h-5 w-5 text-cyan-300" strokeWidth={2} />
                <div className="font-['Orbitron',sans-serif] text-sm font-bold tracking-[0.12em] text-cyan-200">
                  ARCHIVE · 往期活动
                </div>
              </div>
              <div className="mt-1 font-mono text-[11px] text-gray-400">
                点「恢复」后主题会重新出现在主 tab 栏（状态按当前时间重新判定）
              </div>
              <div className="mt-3">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="🔍 按标题 / slug 搜索…"
                  className="w-full rounded-lg border border-cyan-500/30 bg-black/60 px-3 py-2 font-mono text-xs text-white placeholder:text-gray-500 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {loading && (
                <div className="py-10 text-center font-mono text-sm text-cyan-300/70">
                  LOADING…
                </div>
              )}
              {error && (
                <div className="rounded border border-rose-500/50 bg-rose-500/10 px-3 py-2 font-mono text-xs text-rose-300">
                  {error}
                </div>
              )}
              {!loading && !error && filtered.length === 0 && (
                <div className="py-10 text-center font-mono text-sm text-gray-500">
                  {items.length === 0
                    ? "EMPTY · 暂无归档主题"
                    : `NO MATCH · "${search}" 无匹配`}
                </div>
              )}
              {!loading && !error && filtered.length > 0 && (
                <ul className="space-y-2">
                  {filtered.map((t) => (
                    <li
                      key={t.id}
                      className="rounded-lg border border-gray-600/50 bg-gray-500/5 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-sans text-sm font-bold text-gray-200">
                            {t.title}
                          </div>
                          <div className="mt-0.5 truncate font-mono text-[11px] text-gray-500">
                            /m/{t.slug}
                          </div>
                          <div className="mt-1 font-mono text-[11px] text-gray-500">
                            归档于 {formatBeijing(t.archivedAt)}
                          </div>
                          {t.startsAt && t.endsAt && (
                            <div className="font-mono text-[11px] text-gray-500">
                              活动期: {formatBeijing(t.startsAt)} ~{" "}
                              {formatBeijing(t.endsAt)}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={busyId === t.id}
                          onClick={() => onRestore(t)}
                          className="flex shrink-0 items-center gap-1 rounded-lg border border-cyan-400/60 bg-cyan-500/10 px-3 py-1.5 font-mono text-xs text-cyan-200 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {busyId === t.id ? "…" : "恢复"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
