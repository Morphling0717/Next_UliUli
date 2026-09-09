"use client";

import { useMemo, useState } from "react";

import { useWindChimeBlockedTerms } from '@windchime/embed/react';
import { normalizeWindChimeTerms } from '@windchime/embed/core';
import { mailClient } from '@/lib/windchime-client';

export function BlockedTermsPanel() {
  const resource = useWindChimeBlockedTerms(mailClient);
  const {terms, isLoading: loading, pending: saving} = resource;
  const [editedDraft, setDraft] = useState<string | undefined>();
  const draft = editedDraft ?? terms.join(', ');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const error = resource.error?.message || resource.mutationError?.message;
  const parsed = useMemo(() => normalizeWindChimeTerms(draft.split(/[,，\n]+/)), [draft]);
  const dirty = JSON.stringify(parsed) !== JSON.stringify(terms);
  const save = async () => {
    try { await resource.save(parsed); setDraft(undefined); setSavedAt(Date.now()); } catch { /* Hook exposes the error. */ }
  };

  return (
    <div className="rounded-2xl border border-cyan-400/40 bg-black/60 p-5 shadow-[0_0_30px_rgba(45,226,230,0.12)] backdrop-blur-xl sm:p-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <div className="font-['Orbitron',sans-serif] text-sm font-bold tracking-[0.12em] text-white">
            BLOCKED_TERMS · 敏感词
          </div>
          <div className="mt-1 font-mono text-xs text-gray-400">
            命中任一词的留言会被<span className="text-rose-300">折叠遮盖</span>，
            主播在下方「待审核」区点击才能看到原文。不拦截发送。
          </div>
        </div>
        {loading && (
          <span className="font-mono text-[10px] text-cyan-300/60">LOADING…</span>
        )}
      </div>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="例如：色情, 赌博, 微信, 加我, 裸聊"
        rows={3}
        className="w-full resize-y rounded-lg border border-cyan-500/30 bg-black/60 px-3 py-2 font-mono text-sm leading-relaxed text-white placeholder:text-gray-500 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
      />
      <div className="mt-2 font-mono text-[11px] text-gray-500">
        用逗号或换行分隔，大小写不敏感。当前共 {parsed.length} 个词。
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 py-2 font-mono text-xs text-rose-300">
          {error}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {parsed.slice(0, 20).map((t) => (
            <span
              key={t}
              className="rounded-md border border-cyan-500/30 bg-cyan-400/5 px-2 py-0.5 font-mono text-[11px] text-cyan-200"
            >
              {t}
            </span>
          ))}
          {parsed.length > 20 && (
            <span className="font-mono text-[11px] text-gray-500">
              … 还有 {parsed.length - 20} 个
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {savedAt && !dirty && (
            <span className="font-mono text-[11px] text-emerald-300">
              已保存 ✓
            </span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving || loading || !dirty}
            className="rounded-lg border border-cyan-400 bg-cyan-400 px-4 py-1.5 font-['Orbitron',sans-serif] text-xs font-bold tracking-[0.15em] text-black shadow-[0_0_14px_rgba(45,226,230,0.4)] transition hover:bg-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "SAVING..." : "SAVE"}
          </button>
        </div>
      </div>
    </div>
  );
}
