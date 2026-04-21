"use client";

import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { GachaSystem } from "../Gacha";
import { MailSendModal, type MailTexts } from "./MailSendModal";

/**
 * 可从 admin 后台编辑的访客侧 mail 文案。
 * entry* 三字段由 SpeedDial 自用，其余透传给 MailSendModal。
 */
export type MailEntryTexts = {
  entryLabel?: string;
  entryHint?: string;
  entryHintDisabled?: string;
};

type MailSpeedDialProps = {
  texts?: MailEntryTexts & MailTexts;
};

/**
 * 左下角收纳式 speed dial：
 * - 主按钮（✕/+）点击展开/收起
 * - 展开后竖直向上弹出两个子按钮：扭蛋机、发信箱
 * - 任意子按钮打开对应弹窗，关闭弹窗时 speed dial 自动收起
 */
export function MailSpeedDial({ texts }: MailSpeedDialProps = {}) {
  const [expanded, setExpanded] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [gachaOpen, setGachaOpen] = useState(false);
  const [mailEnabled, setMailEnabled] = useState<boolean | null>(null);

  // 轮询发信箱开关，用于子按钮禁用态
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const r = await fetch("/api/mail/settings", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { enabled?: boolean };
        if (!cancelled && typeof j.enabled === "boolean") setMailEnabled(j.enabled);
      } catch {
        /* noop */
      }
    };
    void refresh();
    const id = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // ESC 收起
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const onOpenMail = () => {
    setExpanded(false);
    setMailOpen(true);
  };
  const onOpenGacha = () => {
    setExpanded(false);
    setGachaOpen(true);
  };

  const mailDisabled = mailEnabled === false;

  return (
    <>
      {/* 主按钮 + 子按钮层 */}
      <div className="pointer-events-none fixed bottom-6 left-6 z-50 flex flex-col-reverse items-center gap-3">
        {/* 主按钮（收纳态） */}
        <motion.button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          aria-label={expanded ? "收起菜单" : "展开菜单"}
          aria-expanded={expanded}
          className="pointer-events-auto relative flex h-16 w-16 items-center justify-center rounded-full border-2 border-(--neon-blue) bg-black/70 text-(--neon-blue) shadow-[0_0_20px_rgba(45,226,230,0.35)] backdrop-blur-md transition-colors hover:bg-(--neon-blue) hover:text-black"
        >
          <motion.span
            animate={{ rotate: expanded ? 45 : 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 22 }}
            className="block"
            aria-hidden
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-7 w-7"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </motion.span>
        </motion.button>

        {/* 子按钮：扭蛋机 + 发信箱（展开后竖向排列） */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              key="speeddial-items"
              initial="collapsed"
              animate="expanded"
              exit="collapsed"
              variants={{
                collapsed: { transition: { staggerChildren: 0.04, staggerDirection: -1 } },
                expanded: { transition: { staggerChildren: 0.06, delayChildren: 0.02 } },
              }}
              className="pointer-events-auto flex flex-col-reverse items-center gap-3"
            >
              <SpeedDialItem
                label={texts?.entryLabel || "发信箱"}
                hint={
                  mailDisabled
                    ? (texts?.entryHintDisabled || "发信箱暂时关闭")
                    : (texts?.entryHint || "匿名投信给 Uli")
                }
                disabled={mailDisabled}
                onClick={onOpenMail}
                icon={
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    className="h-6 w-6"
                  >
                    <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                    <path d="m3.5 7.5 8.5 6.5 8.5-6.5" />
                  </svg>
                }
              />
              <SpeedDialItem
                label="扭蛋机"
                hint="随机一张表情包"
                onClick={onOpenGacha}
                icon={
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    className="h-6 w-6"
                  >
                    <path d="M12 2a10 10 0 0 1 10 10v4a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6v-4A10 10 0 0 1 12 2z" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 12v10" />
                  </svg>
                }
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 展开时的半透明遮罩（点击空白处收起） */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            key="speeddial-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
            onClick={() => setExpanded(false)}
          />
        )}
      </AnimatePresence>

      {/* 实际弹窗 */}
      <MailSendModal open={mailOpen} onOpenChange={setMailOpen} texts={texts} />
      <GachaSystem hideLauncher open={gachaOpen} onOpenChange={setGachaOpen} />
    </>
  );
}

type ItemProps = {
  label: string;
  hint: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
};

function SpeedDialItem({ label, hint, icon, onClick, disabled }: ItemProps) {
  return (
    <motion.div
      variants={{
        collapsed: { opacity: 0, y: 12, scale: 0.85 },
        expanded: { opacity: 1, y: 0, scale: 1 },
      }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
      className="relative flex items-center gap-3"
    >
      {/* 右侧标签 */}
      <span className="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-md border border-(--neon-blue)/40 bg-black/80 px-3 py-1.5 font-mono text-xs text-(--neon-blue) shadow-[0_0_14px_rgba(45,226,230,0.2)] backdrop-blur-md">
        <span className="font-bold">{label}</span>
        <span className="ml-2 text-gray-400">{hint}</span>
      </span>

      <motion.button
        type="button"
        onClick={disabled ? undefined : onClick}
        whileHover={disabled ? undefined : { scale: 1.08 }}
        whileTap={disabled ? undefined : { scale: 0.92 }}
        aria-label={`${label} · ${hint}`}
        aria-disabled={disabled}
        className={
          disabled
            ? "flex h-12 w-12 items-center justify-center rounded-full border-2 border-gray-600/60 bg-black/60 text-gray-500 shadow-[0_0_10px_rgba(45,226,230,0.08)] backdrop-blur-md cursor-not-allowed"
            : "flex h-12 w-12 items-center justify-center rounded-full border-2 border-(--neon-blue) bg-black/70 text-(--neon-blue) shadow-[0_0_16px_rgba(45,226,230,0.3)] backdrop-blur-md transition-colors hover:bg-(--neon-blue) hover:text-black"
        }
      >
        {icon}
      </motion.button>
    </motion.div>
  );
}
