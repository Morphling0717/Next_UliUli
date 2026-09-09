"use client";

import { validateWindChimeTopicCreate, validateWindChimeTopicPatch } from '@windchime/embed/core';
import { useWindChimeTopics } from '@windchime/embed/react';
import type { WindChimeTopicCreateInput } from '@windchime/embed/core';
import { mailClient } from '@/lib/windchime-client';
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X as CloseIcon } from "lucide-react";
import type { Topic } from "./mail-topic-types";
import {
  beijingLocalToUtcIso,
  nowAsBeijingLocal,
  plusDaysAsBeijingLocal,
} from "./mail-time";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (topic: Topic) => void;
};

function validateSlugClient(slug: string): string | null {
  try { validateWindChimeTopicCreate({slug, title:'preview'}); return null; }
  catch (error) { return error instanceof Error ? error.message : 'slug 无效'; }
}

/**
 * 新建主题模态。
 *
 * 表单默认勾选时间窗（开始=当前北京时间，结束=+7 天）。
 * 取消勾选 → 弹气泡警告，因为等价"永久活动"≈ 常规信箱平行版（方案 §9 Q3）。
 *
 * 提交流程：
 * 1. 前端先做 slug 正则 + 保留字校验（阻止无效请求打到服务端）
 * 2. 时间窗勾选时转 UTC ISO 后提交
 * 3. 服务端报 409 SLUG_DUPLICATE / 400 SLUG_RESERVED 等错误码时，展示服务端的 error 文案
 */
export function NewTopicModal({ open, onClose, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [useTimeWindow, setUseTimeWindow] = useState(true);
  const [startsLocal, setStartsLocal] = useState(() => nowAsBeijingLocal());
  const [endsLocal, setEndsLocal] = useState(() => plusDaysAsBeijingLocal(7));
  const [showPermanentWarn, setShowPermanentWarn] = useState(false);
  const topicsApi = useWindChimeTopics(mailClient, {enabled: false});
  const submitting = topicsApi.pending;
  const [serverError, setServerError] = useState<string | null>(null);

  // 打开时重置（避免上次的 state 残留）
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setTitle("");
      setSlug("");
      setDescription("");
      setNote("");
      setUseTimeWindow(true);
      setStartsLocal(nowAsBeijingLocal());
      setEndsLocal(plusDaysAsBeijingLocal(7));
      setShowPermanentWarn(false);
      setServerError(null);
    });
  }, [open]);

  // ESC 关闭 + 锁滚
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  const slugError = useMemo(() => (slug ? validateSlugClient(slug) : null), [slug]);
  const titleError = useMemo(() => {
    const t = title.trim();
    if (!t) return null; // 先不报，submit 时才拦
    try { validateWindChimeTopicPatch({title:t}); return null; }
    catch(error) { return error instanceof Error ? error.message : '标题无效'; }
  }, [title]);

  // 时间窗范围提示
  const timeRangeError = useMemo(() => {
    if (!useTimeWindow) return null;
    if (!startsLocal || !endsLocal) return null;
    try { validateWindChimeTopicPatch({startsAt:beijingLocalToUtcIso(startsLocal), endsAt:beijingLocalToUtcIso(endsLocal)}); return null; }
    catch(error) { return error instanceof Error ? error.message : '时间范围无效'; }
  }, [useTimeWindow, startsLocal, endsLocal]);

  const canSubmit =
    !!title.trim() &&
    !!slug &&
    !slugError &&
    !titleError &&
    !timeRangeError &&
    !submitting;

  const onToggleTimeWindow = (next: boolean) => {
    if (!next && useTimeWindow) {
      // 主播尝试取消勾选 → 先弹警告气泡
      setShowPermanentWarn(true);
      return;
    }
    setUseTimeWindow(next);
  };

  const confirmPermanent = () => {
    setUseTimeWindow(false);
    setShowPermanentWarn(false);
  };

  const cancelPermanent = () => {
    setShowPermanentWarn(false);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setServerError(null);
    try {
      const body: WindChimeTopicCreateInput = {
        title: title.trim(),
        slug,
        description: description.trim() || null,
        note: note.trim() || null,
      };
      if (useTimeWindow) {
        body.startsAt = beijingLocalToUtcIso(startsLocal);
        body.endsAt = beijingLocalToUtcIso(endsLocal);
      } else {
        body.startsAt = null;
        body.endsAt = null;
      }

      const topic = await topicsApi.create(validateWindChimeTopicCreate(body));
      onCreated(topic);
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "创建失败");
    } finally {

    }
  };

  if (typeof document === "undefined") return null;
  if (!open) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
        onClick={onClose}
      >
        <motion.form
          onSubmit={onSubmit}
          initial={{ y: 24, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 24, opacity: 0, scale: 0.98 }}
          transition={{ type: "spring", damping: 22, stiffness: 260 }}
          className="relative w-full max-w-xl rounded-2xl border border-cyan-400/60 bg-black/90 p-6 shadow-[0_0_40px_rgba(45,226,230,0.2)]"
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

          <div className="mb-1 font-mono text-[11px] tracking-[0.25em] text-cyan-300/80">
            NEW TOPIC · 新建主题
          </div>
          <h2 className="font-['Orbitron',sans-serif] text-lg font-bold tracking-wide text-cyan-100">
            创建一个活动收件箱
          </h2>

          <div className="mt-5 space-y-4">
            {/* Title */}
            <Field label="主题标题 *" hint="活动期间顶部横幅里会显示，可以带 emoji">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={64}
                placeholder="🎂 Uli 生日快乐来信 2026"
                className="w-full rounded-lg border border-cyan-500/30 bg-black/60 px-3 py-2 font-sans text-sm text-white placeholder:text-gray-500 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
              />
              {titleError && <ErrLine msg={titleError} />}
            </Field>

            {/* Slug */}
            <Field
              label="URL slug *"
              hint={`访客链接为 /m/${slug || "your-slug"}；创建后不可修改`}
            >
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                maxLength={64}
                placeholder="birthday-2026"
                className={
                  "w-full rounded-lg border bg-black/60 px-3 py-2 font-mono text-sm text-white placeholder:text-gray-500 outline-none transition focus:ring-2 " +
                  (slugError
                    ? "border-rose-400/60 focus:border-rose-400 focus:ring-rose-400/20"
                    : "border-cyan-500/30 focus:border-cyan-400 focus:ring-cyan-400/20")
                }
              />
              {slugError && <ErrLine msg={slugError} />}
            </Field>

            {/* Description */}
            <Field label="说明（访客可见）" hint="出现在投信页的副标题，简短提示">
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                placeholder="活动期间写下你的祝福"
                className="w-full rounded-lg border border-cyan-500/30 bg-black/60 px-3 py-2 font-sans text-sm text-white placeholder:text-gray-500 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
              />
            </Field>

            {/* Note */}
            <Field label="备注（仅主播可见）" hint="给自己记笔记，访客看不到">
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                className="w-full rounded-lg border border-cyan-500/30 bg-black/60 px-3 py-2 font-sans text-sm text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
              />
            </Field>

            {/* Time window */}
            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/[0.03] p-3">
              <label className="flex items-center gap-2 font-mono text-xs text-cyan-200">
                <input
                  type="checkbox"
                  checked={useTimeWindow}
                  onChange={(e) => onToggleTimeWindow(e.target.checked)}
                  className="h-4 w-4 accent-cyan-400"
                />
                启用时间窗（按 <strong className="mx-0.5 text-cyan-100">北京时间</strong> 理解）
              </label>

              {useTimeWindow && (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <TimeField label="开始时间" value={startsLocal} onChange={setStartsLocal} />
                  <TimeField label="结束时间" value={endsLocal} onChange={setEndsLocal} />
                </div>
              )}
              {timeRangeError && (
                <div className="mt-2">
                  <ErrLine msg={timeRangeError} />
                </div>
              )}
              {!useTimeWindow && (
                <div className="mt-2 font-mono text-[11px] text-amber-300/80">
                  ⚠ 无时间窗 = 只要开关开着就一直可投信（≈ 常规信箱）
                </div>
              )}
            </div>
          </div>

          {serverError && (
            <div className="mt-4 rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-2 font-mono text-xs text-rose-300">
              {serverError}
            </div>
          )}

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-500/40 bg-black/60 px-4 py-2 font-mono text-xs text-gray-300 transition hover:bg-gray-500/20"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-lg border border-cyan-400 bg-cyan-400 px-4 py-2 font-['Orbitron',sans-serif] text-xs font-bold tracking-[0.15em] text-black shadow-[0_0_14px_rgba(45,226,230,0.5)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? "CREATING..." : "CREATE"}
            </button>
          </div>

          {/* 取消时间窗的二次确认气泡 */}
          {showPermanentWarn && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/80 p-6">
              <div className="max-w-sm rounded-xl border border-amber-400/60 bg-black/90 p-5 text-center shadow-[0_0_30px_rgba(251,191,36,0.35)]">
                <div className="mb-2 font-['Orbitron',sans-serif] text-sm font-bold tracking-wide text-amber-200">
                  ⚠ 永久活动
                </div>
                <p className="mb-4 font-mono text-xs leading-relaxed text-amber-100/80">
                  不设时间窗 ≈ 常规信箱的平行版，除非你清楚想要这样，否则建议保留时间窗。
                </p>
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={cancelPermanent}
                    className="rounded-lg border border-cyan-400/50 bg-black/60 px-3 py-1.5 font-mono text-xs text-cyan-200 transition hover:bg-cyan-400/10"
                  >
                    保留时间窗
                  </button>
                  <button
                    type="button"
                    onClick={confirmPermanent}
                    className="rounded-lg border border-amber-400 bg-amber-400 px-3 py-1.5 font-mono text-xs font-bold text-black transition hover:bg-amber-300"
                  >
                    我确定要永久活动
                  </button>
                </div>
              </div>
            </div>
          )}
        </motion.form>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-cyan-400/80">
        {label}
      </div>
      {children}
      {hint && (
        <div className="mt-1 font-mono text-[11px] text-gray-500">{hint}</div>
      )}
    </label>
  );
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 font-mono text-[11px] text-cyan-300/80">{label}</div>
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-cyan-500/30 bg-black/60 px-3 py-2 font-mono text-xs text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
      />
    </label>
  );
}

function ErrLine({ msg }: { msg: string }) {
  return (
    <div className="mt-1 font-mono text-[11px] text-rose-300">✕ {msg}</div>
  );
}
