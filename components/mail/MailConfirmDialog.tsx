"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, X as CloseIcon } from "lucide-react";

export type MailConfirmTone = "danger" | "warning" | "cyan";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: MailConfirmTone;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const TONE_STYLES: Record<
  MailConfirmTone,
  { border: string; title: string; icon: string; confirm: string; close: string }
> = {
  danger: {
    border: "border-rose-500/60 shadow-[0_0_40px_rgba(244,63,94,0.22)]",
    title: "text-rose-200",
    icon: "text-rose-300",
    confirm:
      "border-rose-400 bg-rose-500 text-white hover:bg-rose-600",
    close: "border-rose-500/60 text-rose-300 hover:bg-rose-500 hover:text-black",
  },
  warning: {
    border: "border-amber-400/60 shadow-[0_0_40px_rgba(251,191,36,0.2)]",
    title: "text-amber-200",
    icon: "text-amber-300",
    confirm:
      "border-amber-400 bg-amber-400 text-black hover:bg-amber-300",
    close: "border-amber-400/60 text-amber-300 hover:bg-amber-400 hover:text-black",
  },
  cyan: {
    border: "border-cyan-400/60 shadow-[0_0_40px_rgba(45,226,230,0.2)]",
    title: "text-cyan-200",
    icon: "text-cyan-300",
    confirm:
      "border-cyan-400 bg-cyan-400 text-black hover:bg-white",
    close: "border-cyan-400/60 text-cyan-300 hover:bg-cyan-400 hover:text-black",
  },
};

export function MailConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  tone = "danger",
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, busy, onCancel]);

  if (typeof document === "undefined") return null;
  const styles = TONE_STYLES[tone];

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="mail-confirm-dialog"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          onClick={() => !busy && onCancel()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="mail-confirm-title"
            initial={{ y: 20, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 20, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", damping: 24, stiffness: 280 }}
            className={`relative w-full max-w-md rounded-2xl border bg-black/92 p-6 ${styles.border}`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              aria-label="关闭"
              className={`absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border bg-black/80 transition disabled:cursor-not-allowed disabled:opacity-40 ${styles.close}`}
            >
              <CloseIcon className="h-4 w-4" />
            </button>

            <div className="mb-2 flex items-center gap-2 pr-8">
              <AlertTriangle className={`h-5 w-5 shrink-0 ${styles.icon}`} strokeWidth={2} />
              <div
                id="mail-confirm-title"
                className={`font-['Orbitron',sans-serif] text-sm font-bold tracking-[0.1em] ${styles.title}`}
              >
                {title}
              </div>
            </div>

            <p className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-gray-200">
              {description}
            </p>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={onCancel}
                className="rounded-lg border border-gray-600/70 bg-black/60 px-4 py-1.5 font-mono text-xs text-gray-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onConfirm}
                className={`rounded-lg border px-4 py-1.5 font-mono text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${styles.confirm}`}
              >
                {busy ? "处理中…" : confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
