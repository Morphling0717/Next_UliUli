"use client";

 

import React, { useState } from 'react';
import { motion, AnimatePresence, useMotionTemplate, useMotionValue } from 'framer-motion';
import type { SiteConfig } from '@/app/admin/types';

// --- Types ---
export interface IconProps {
  path?: React.ReactNode;
  className?: string;
  size?: number | string;
}

export interface ToastNotificationProps {
  id: string | number;
  message: string;
}

export interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export interface GoldenLuckModalProps {
  isOpen: boolean;
  onClose: () => void;
  config?: SiteConfig;
}

// --- 1. 图标系统 ---
const Icon: React.FC<IconProps> = ({ path, className = "", size = 20 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {path}
  </svg>
);

export const Icons = {
  Music: (p: IconProps) => <Icon {...p} path={<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>} />,
  Calendar: (p: IconProps) => <Icon {...p} path={<><rect width="18" height="18" x="3" y="4" rx="2" ry="2" /><line x1="16" x2="16" y1="2" y2="6" /><line x1="8" x2="8" y1="2" y2="6" /><line x1="3" x2="21" y1="10" y2="10" /></>} />,
  Search: (p: IconProps) => <Icon {...p} path={<><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>} />,
  Dices: (p: IconProps) => <Icon {...p} path={<><rect width="12" height="12" x="2" y="10" rx="2" ry="2" /><path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6" /><path d="M6 18h.01" /><path d="M10 14h.01" /><path d="M15 6h.01" /><path d="M18 9h.01" /></>} />,
  Sparkles: (p: IconProps) => <Icon {...p} path={<><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L12 3Z" /><path d="M5 3v4" /><path d="M9 5H5" /><path d="M19 17v4" /><path d="M21 19h-4" /></>} />,
  ExternalLink: (p: IconProps) => <Icon {...p} path={<><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" x2="21" y1="14" y2="3" /></>} />,
  Copy: (p: IconProps) => <Icon {...p} path={<><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>} />,
  Check: (p: IconProps) => <Icon {...p} path={<polyline points="20 6 9 17 4 12" />} />,
  ArrowLeft: (p: IconProps) => <Icon {...p} path={<><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></>} />,
  WifiOff: (p: IconProps) => <Icon {...p} path={<><line x1="1" x2="23" y1="1" y2="23" /><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" /><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" /><path d="M10.71 5.05A16 16 0 0 1 22.58 9" /><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><line x1="12" x2="12.01" y1="20" y2="20" /></>} />,
  Info: (p: IconProps) => <Icon {...p} path={<><circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="16" y2="12" /><line x1="12" x2="12.01" y1="8" y2="8" /></>} />,
  Video: (p: IconProps) => <Icon {...p} path={<><path d="m22 8-6 4 6 4V8Z" /><rect width="14" height="12" x="2" y="6" rx="2" ry="2" /></>} />,
  Volume2: (p: IconProps) => <Icon {...p} path={<><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></>} />,
  VolumeX: (p: IconProps) => <Icon {...p} path={<><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" x2="17" y1="9" y2="15" /><line x1="17" x2="23" y1="9" y2="15" /></>} />,
  X: (p: IconProps) => <Icon {...p} path={<><line x1="18" x2="6" y1="6" y2="18" /><line x1="6" x2="18" y1="6" y2="18" /></>} />,
  Swords: (p: IconProps) => <Icon {...p} path={<><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" /><line x1="13" x2="19" y1="19" y2="13" /><line x1="16" x2="20" y1="16" y2="20" /><line x1="19" x2="21" y1="21" y2="19" /><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" /><line x1="5" x2="9" y1="14" y2="18" /><line x1="7" x2="4" y1="17" y2="20" /><line x1="3" x2="5" y1="19" y2="21" /></>} />
};

// --- 2. Toast 通知组件 ---
export const ToastContainer: React.FC<{ notifications: ToastNotificationProps[] }> = ({ notifications }) => (
  <div className="fixed top-24 right-4 z-11000 flex flex-col gap-3 pointer-events-none">
    <AnimatePresence>
      {notifications.map((n) => (
        <motion.div
          key={n.id}
          initial={{ x: 50 }}
          animate={{ x: 0 }}
          exit={{ opacity: 0 }}
          className="bg-black/80 backdrop-blur-md border-l-4 border-(--neon-blue) text-white px-6 py-4 rounded shadow-[0_0_15px_rgba(45,226,230,0.2)] flex items-center gap-3 min-w-60"
        >
          <Icons.Check size={18} className="text-(--neon-blue)" />
          <div className="text-sm font-bold tracking-wider font-tech">
            {n.message}
          </div>
        </motion.div>
      ))}
    </AnimatePresence>
  </div>
);

// --- 3. 玻璃拟态卡片组件 ---
export const GlassCard: React.FC<GlassCardProps> = ({ children, className = "", onClick }) => {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const bgGlow = useMotionTemplate`
    radial-gradient(
      400px circle at ${mouseX}px ${mouseY}px,
      rgba(45, 226, 230, 0.15),
      transparent 80%
    )
  `;

  const borderGlow = useMotionTemplate`
    radial-gradient(
      250px circle at ${mouseX}px ${mouseY}px,
      rgba(45, 226, 230, 0.2),
      transparent 60%
    )
  `;

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const { left, top } = e.currentTarget.getBoundingClientRect();
    mouseX.set(e.clientX - left);
    mouseY.set(e.clientY - top);
  }

  return (
    <motion.div
      whileInView={{ opacity: [0, 1], y: [20, 0] }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      className={`
        relative overflow-hidden rounded-xl group
        bg-(--glass-bg,rgba(0,0,0,0.6)) backdrop-blur-xl border border-white/10
        hover:border-transparent hover:shadow-[0_0_20px_rgba(45,226,230,0.15)]
        transition-all duration-300
        ${className}
      `}
    >
      <motion.div
        className="pointer-events-none absolute -inset-px rounded-xl opacity-0 transition-opacity duration-500 group-hover:opacity-100 z-0"
        style={{ background: bgGlow }}
      />
      <motion.div
        className="pointer-events-none absolute inset-0 rounded-xl opacity-0 transition-opacity duration-300 group-hover:opacity-100 z-10"
        style={{
          boxShadow: "inset 0 0 1px 1px rgba(45, 226, 230, 0.3)",
          background: borderGlow
        }}
      />
      <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-(--neon-blue) opacity-50 group-hover:opacity-100 transition-opacity z-20"></div>
      <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-(--neon-blue) opacity-50 group-hover:opacity-100 transition-opacity z-20"></div>
      
      <div className="relative z-30 h-full">{children}</div>
    </motion.div>
  );
};

const formatGoldenLuckTime = () =>
  new Date().toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });

// --- 4. 欧皇弹窗组件 ---
export const GoldenLuckModal: React.FC<GoldenLuckModalProps> = ({ isOpen, onClose, config }) => {
  const [timeStr] = useState(formatGoldenLuckTime);
  const notifCfg = config?.notifications || {};

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-10000 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" />

          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            className="relative bg-[#0f172a] border-2 border-(--neon-blue) p-8 rounded-2xl max-w-md w-full text-center shadow-[0_0_50px_rgba(45,226,230,0.2)] overflow-hidden"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors cursor-pointer"
            >
              <Icons.X size={24} />
            </button>

            <h3 className="text-3xl font-bold text-(--neon-blue) mb-2 font-tech tracking-widest">
              {notifCfg.goldenAlertTitle || "SYSTEM ALERT"}
            </h3>
            <div className="text-xs text-(--neon-blue)/60 font-mono mb-6 tracking-widest">
              {notifCfg.goldenAlertSubtitle || "HIDDEN EVENT TRIGGERED"}
            </div>

            <div className="bg-white/5 rounded-xl p-6 mb-6 border border-white/10 text-left relative overflow-hidden">
              <div className="absolute top-0 right-0 w-20 h-20 bg-yellow-400/10 blur-2xl rounded-full pointer-events-none"></div>

              <div className="flex justify-center mb-4">
                <Icons.Sparkles
                  size={40}
                  className="text-yellow-300 animate-pulse"
                />
              </div>

              <h4 className="text-xl font-bold text-white text-center mb-4">
                {notifCfg.goldenCongratsTitle || "✨ 恭喜出金！✨"}
              </h4>

              <p className="text-gray-300 mb-4 leading-relaxed text-sm">
                {notifCfg.goldenBody ||
                  "如果你是舰长，截图发到群里便可以免费领取一首隐藏歌单。如果不是，两个心动盲盒就能领取！"}
              </p>

              <div className="h-px w-full bg-white/10 my-3"></div>

              <p className="text-(--neon-blue) text-xs font-mono text-center">
                {notifCfg.timestampPrefix || "TIMESTAMP:"} {timeStr}
              </p>
            </div>

            <button
              onClick={onClose}
              className="w-full bg-(--neon-blue) text-black font-bold font-tech py-3 rounded-lg hover:bg-white transition-all hover:shadow-[0_0_20px_var(--neon-blue)] active:scale-95 cursor-pointer"
            >
              {notifCfg.acknowledgeText || "ACKNOWLEDGE"}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};