"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ChevronRight, Gift, Mail, Music2, Swords, Trophy } from "lucide-react";
import type { SiteConfig } from "@/app/admin/types";
import ErrorBoundary from "@/components/ErrorBoundary";
import { GoldenLuckModal, ToastContainer } from "@/components/UI";
import type { SongItem as SongSystemSongItem } from "@/components/SongSystem";
import { MailSendModal, type MailTexts } from "@/components/mail/MailSendModal";
import type { ActiveTopicSummary } from "@/components/mail/mail-topic-types";

const SongSystem = dynamic(() => import("@/components/SongSystem").then((m) => ({ default: m.SongSystem })), {
  ssr: false,
  loading: () => <FeatureLoading label="Loading Song System..." />,
});

const GachaSystem = dynamic(() => import("@/components/Gacha").then((m) => ({ default: m.GachaSystem })), {
  ssr: false,
  loading: () => null,
});

const NameArenaGame = dynamic(() => import("@/components/namearena/NameArenaGame").then((m) => ({ default: m.NameArenaGame })), {
  ssr: false,
  loading: () => <FeatureLoading label="Loading Arena..." />,
});

const DgpGame = dynamic(() => import("@/components/dgp/DgpGame").then((m) => ({ default: m.DgpGame })), {
  ssr: false,
  loading: () => <FeatureLoading label="Loading DGP..." />,
});

type AppSiteConfig = SiteConfig & {
  activeTopics?: ActiveTopicSummary[];
  mailEnabled?: boolean;
};

type ConfigResponse = {
  success?: boolean;
  site_config?: AppSiteConfig;
  songs?: SongSystemSongItem[];
  hidden_songs?: Array<{ name: string; artist?: string }>;
  config_version?: number;
};

type NotificationItem = { id: number; message: string };
type FeaturePanelId = "songs" | "namerena" | "dgp" | null;

export default function AppFeatureHub() {
  const configVersionRef = useRef(0);
  const [siteConfig, setSiteConfig] = useState<AppSiteConfig>({});
  const [configVersion, setConfigVersion] = useState(0);
  const [songs, setSongs] = useState<SongSystemSongItem[]>([]);
  const [hiddenSongs, setHiddenSongs] = useState<SongSystemSongItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isGoldenModalOpen, setIsGoldenModalOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<FeaturePanelId>(null);
  const [mailOpen, setMailOpen] = useState(false);
  const [gachaOpen, setGachaOpen] = useState(false);

  const notifs = siteConfig.notifications || {};
  const activeTopics = useMemo(() => siteConfig.activeTopics ?? [], [siteConfig.activeTopics]);
  const mailOnline = siteConfig.mailEnabled !== false;
  const mailTexts = siteConfig.mail as MailTexts | undefined;

  const addNotification = (message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setNotifications((prev) => [...prev, { id, message }]);
    window.setTimeout(() => setNotifications((prev) => prev.filter((item) => item.id !== id)), 3000);
  };

  const unlockHidden = (showGoldenModal = false) => {
    if (!isUnlocked) {
      setIsUnlocked(true);
      addNotification(notifs.unlocked || "SYSTEM OVERRIDE: HIDDEN PROTOCOL ACTIVATED");
    }
    if (showGoldenModal) setIsGoldenModalOpen(true);
  };

  useEffect(() => {
    let isActive = true;
    const loadConfig = async (announceUpdate = false) => {
      try {
        const res = await fetch("/api/config", { cache: "no-store" });
        const data = (await res.json()) as ConfigResponse;
        if (!data.success || !isActive) return;

        const nextVersion = Number(data.config_version || 0);
        const prev = configVersionRef.current;
        const hasUpdated = announceUpdate && prev > 0 && nextVersion > 0 && prev !== nextVersion;

        setSiteConfig(data.site_config || {});
        setSongs(data.songs || []);
        setHiddenSongs((data.hidden_songs || []).map((s) => ({ name: s.name, artist: s.artist || "", category: "hidden" })));
        setConfigVersion(nextVersion);
        configVersionRef.current = nextVersion;

        if (typeof window !== "undefined") {
          (window as Window & { SITE_CONFIG?: AppSiteConfig }).SITE_CONFIG = data.site_config || {};
        }
        if (hasUpdated) addNotification("站点数据已更新，页面已刷新");
      } catch (error) {
        console.error("Failed to load app hub config:", error);
      }
    };

    loadConfig(false);
    const timer = window.setInterval(() => loadConfig(true), 15000);
    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!activePanel) return;
    const previousOverflow = document.body.style.overflow;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setActivePanel(null); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [activePanel]);

  // PWA 系统返回键 / 手势返回拦截：当任一层（panel / 模态）打开时
  // push 一条 history 记录，按返回会触发 popstate，被我们捕获后关闭这一层
  // 而不是直接退出 PWA。
  useBackButtonClose(activePanel !== null, () => setActivePanel(null));
  useBackButtonClose(mailOpen, () => setMailOpen(false));
  useBackButtonClose(gachaOpen, () => setGachaOpen(false));
  useBackButtonClose(isGoldenModalOpen, () => setIsGoldenModalOpen(false));

  const signalText = useMemo(() => {
    if (!mailOnline) return mailTexts?.disabledBanner || "信箱暂时关闭";
    if (activeTopics.length === 0) return "匿名写下想对 Uli 说的话";
    if (activeTopics.length === 1) return `${activeTopics[0].title} · 投信中`;
    return `${activeTopics.length} 个活动进行中`;
  }, [activeTopics, mailOnline, mailTexts]);

  return (
    <ErrorBoundary>
      <div className="relative min-h-screen bg-black text-white font-sans selection:bg-cyan-500/30 overflow-hidden">
        {/* Sleek Deep Space Background Effects */}
        <div className="pointer-events-none fixed inset-0 z-0">
          <div className="absolute -top-[10%] -left-[10%] w-[60%] h-[40%] bg-cyan-600/10 blur-[120px] rounded-full" />
          <div className="absolute top-[40%] -right-[20%] w-[50%] h-[50%] bg-fuchsia-600/10 blur-[120px] rounded-full" />
          <div className="absolute -bottom-[10%] left-[20%] w-[60%] h-[30%] bg-indigo-600/10 blur-[120px] rounded-full" />
          {/* Very subtle noise texture */}
          <div className="absolute inset-0 opacity-[0.02]" style={{ backgroundImage: "url('data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E')" }}></div>
        </div>

        <ToastContainer notifications={notifications} />

        <div className="relative z-10 flex flex-col h-[100dvh]">
          {/* App-like Header */}
          <header
            className="flex items-center justify-center px-5 shrink-0 border-b border-white/5 bg-black/30 backdrop-blur-xl"
            style={{
              paddingTop: "calc(env(safe-area-inset-top) + 0.875rem)",
              paddingBottom: "0.875rem",
              paddingLeft: "calc(env(safe-area-inset-left) + 1.25rem)",
              paddingRight: "calc(env(safe-area-inset-right) + 1.25rem)",
            }}
          >
            <h1 className="font-['Orbitron',sans-serif] text-[11px] font-bold tracking-[0.25em] text-cyan-300">
              ULIULI APP
            </h1>
          </header>

          {/* Main Scrollable Content */}
          <main
            className="flex-1 overflow-y-auto custom-scrollbar"
            style={{
              paddingTop: "1.5rem",
              paddingBottom: "calc(env(safe-area-inset-bottom) + 4rem)",
              paddingLeft: "calc(env(safe-area-inset-left) + 1.25rem)",
              paddingRight: "calc(env(safe-area-inset-right) + 1.25rem)",
            }}
          >
            {/* Hero / Avatar Section */}
            <motion.section 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-5 mb-10"
            >
              <div className="relative w-16 h-16 shrink-0">
                <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-cyan-400 to-fuchsia-500 animate-spin-slow opacity-70 blur-[6px]"></div>
                <div className="relative w-full h-full rounded-full p-[2px] bg-gradient-to-tr from-cyan-400 to-fuchsia-500">
                  <div className="w-full h-full rounded-full overflow-hidden bg-black border-2 border-black">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/app.jpg${configVersion ? `?v=${configVersion}` : ''}`}
                      className="w-full h-full object-cover"
                      alt="Uli"
                      onError={(e) => (e.currentTarget.style.display = 'none')}
                    />
                  </div>
                </div>
              </div>
              <div>
                <h2 className="text-xl font-bold text-white tracking-wide">
                  Welcome Back.
                </h2>
                <p className="text-xs text-cyan-400/80 font-mono mt-1 tracking-widest uppercase flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                  </span>
                  Terminal Connected
                </p>
              </div>
            </motion.section>

            {/* Main Features List */}
            <motion.section 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="mb-8"
            >
              <h3 className="text-[10px] font-mono tracking-[0.2em] text-gray-500 mb-3 px-1">
                SYSTEM MODULES
              </h3>
              <div className="flex flex-col gap-3">
                <AppListItem 
                  title="风铃信箱" 
                  subtitle={signalText}
                  icon={<Mail className="w-5 h-5 text-fuchsia-300" />}
                  bg="bg-fuchsia-500/10"
                  borderColor="border-fuchsia-500/20"
                  onClick={() => setMailOpen(true)}
                  disabled={!mailOnline}
                />
                <AppListItem 
                  title="点歌机" 
                  subtitle="浏览歌单库与随机点歌"
                  icon={<Music2 className="w-5 h-5 text-cyan-300" />}
                  bg="bg-cyan-500/10"
                  borderColor="border-cyan-500/20"
                  onClick={() => setActivePanel("songs")}
                />
                <AppListItem 
                  title="扭蛋机" 
                  subtitle="每日签到抽取专属表情包"
                  icon={<Gift className="w-5 h-5 text-amber-300" />}
                  bg="bg-amber-500/10"
                  borderColor="border-amber-500/20"
                  onClick={() => setGachaOpen(true)}
                />
              </div>
            </motion.section>

            {/* Games Grid */}
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <h3 className="text-[10px] font-mono tracking-[0.2em] text-gray-500 mb-3 px-1">
                MINI GAMES
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <AppGridItem 
                  title="名字大乱斗" 
                  icon={<Swords className="w-6 h-6 text-indigo-400" />}
                  bg="bg-indigo-500/10"
                  borderColor="border-indigo-500/20"
                  onClick={() => setActivePanel("namerena")}
                />
                <AppGridItem 
                  title="DGP 模拟器" 
                  icon={<Trophy className="w-6 h-6 text-red-400" />}
                  bg="bg-red-500/10"
                  borderColor="border-red-500/20"
                  onClick={() => setActivePanel("dgp")}
                />
              </div>
            </motion.section>
            
            <div className="mt-12 text-center text-[10px] font-mono text-gray-600 tracking-widest opacity-50">
              V {configVersion || '1.0.0'} · ALL RIGHTS RESERVED
            </div>
          </main>
        </div>

        {/* Feature Bottom Sheets / Full Screen Overlays */}
        <FeaturePanel open={activePanel === "songs"} onClose={() => setActivePanel(null)}>
          <div className="h-full bg-[#050508] overflow-y-auto">
            <SongSystem onUnlockHidden={() => unlockHidden(true)} addNotification={addNotification} isUnlocked={isUnlocked} config={siteConfig} songs={songs} hiddenSongs={hiddenSongs} disableAnimation />
          </div>
        </FeaturePanel>

        <FeaturePanel open={activePanel === "namerena"} onClose={() => setActivePanel(null)}>
          <NameArenaGame />
        </FeaturePanel>

        <FeaturePanel open={activePanel === "dgp"} onClose={() => setActivePanel(null)}>
          <DgpGame />
        </FeaturePanel>

        {/* Floating Modals */}
        <MailSendModal open={mailOpen} onOpenChange={setMailOpen} texts={mailTexts} enabled={siteConfig.mailEnabled} />
        <GachaSystem hideLauncher open={gachaOpen} onOpenChange={setGachaOpen} />
        <GoldenLuckModal isOpen={isGoldenModalOpen} onClose={() => setIsGoldenModalOpen(false)} config={siteConfig} />
      </div>
    </ErrorBoundary>
  );
}

// --- UI Components for the Native App Look ---

type AppListItemProps = {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  bg: string;
  borderColor: string;
  onClick: () => void;
  disabled?: boolean;
};

function AppListItem({ title, subtitle, icon, bg, borderColor, onClick, disabled }: AppListItemProps) {
  return (
    <button 
      onClick={disabled ? undefined : onClick}
      className={`w-full group flex items-center justify-between p-4 rounded-2xl border bg-white/[0.03] backdrop-blur-md transition-all duration-200 
        ${disabled ? 'opacity-50 cursor-not-allowed border-white/5' : 'hover:bg-white/[0.06] active:scale-[0.98] border-white/10 hover:border-white/20'}`}
    >
      <div className="flex items-center gap-4 min-w-0">
        <div className={`w-12 h-12 shrink-0 rounded-2xl flex items-center justify-center border ${bg} ${borderColor}`}>
          {icon}
        </div>
        <div className="text-left min-w-0 flex-1">
          <h4 className="text-base font-bold text-white truncate">{title}</h4>
          <p className="text-xs text-gray-400 mt-0.5 truncate">{subtitle}</p>
        </div>
      </div>
      <div className="w-8 h-8 shrink-0 flex items-center justify-center text-gray-600 group-hover:text-white transition-colors">
        <ChevronRight className="w-5 h-5" />
      </div>
    </button>
  );
}

type AppGridItemProps = {
  title: string;
  icon: React.ReactNode;
  bg: string;
  borderColor: string;
  onClick: () => void;
};

function AppGridItem({ title, icon, bg, borderColor, onClick }: AppGridItemProps) {
  return (
    <button 
      onClick={onClick}
      className="w-full flex flex-col items-center justify-center p-6 gap-4 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-md transition-all duration-200 hover:bg-white/[0.06] active:scale-[0.96] hover:border-white/20"
    >
      <div className={`w-14 h-14 rounded-full flex items-center justify-center border ${bg} ${borderColor}`}>
        {icon}
      </div>
      <h4 className="text-sm font-bold text-white text-center">{title}</h4>
    </button>
  );
}

type FeaturePanelProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

// Modern iOS-like Bottom Sheet / Full Cover Overlay
function FeaturePanel({ open, onClose, children }: FeaturePanelProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%", opacity: 0.5 }}
          transition={{ type: "spring", damping: 28, stiffness: 280 }}
          className="fixed inset-0 z-[1400] flex flex-col bg-black"
        >
          {/* Top Drag/Close Area - 支持下拉关闭 */}
          <motion.div
            className="shrink-0 bg-[#0a0a0c] border-b border-white/5 flex items-center justify-between relative z-50 select-none cursor-grab active:cursor-grabbing"
            style={{
              paddingTop: "calc(env(safe-area-inset-top) + 0.5rem)",
              paddingBottom: "0.5rem",
              paddingLeft: "calc(env(safe-area-inset-left) + 1rem)",
              paddingRight: "calc(env(safe-area-inset-right) + 1rem)",
              touchAction: "none",
            }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 80 || info.velocity.y > 600) {
                onClose();
              }
            }}
          >
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white px-2 py-1 flex items-center gap-1 active:opacity-50 transition-opacity text-sm font-medium"
            >
              <ArrowLeft className="w-4 h-4" /> 返回
            </button>
            <div
              className="w-12 h-1.5 bg-white/20 rounded-full absolute left-1/2 -translate-x-1/2"
              style={{ top: "calc(env(safe-area-inset-top) + 0.5rem)" }}
            />
            <div className="w-12" />
          </motion.div>
          {/* Main Content */}
          <div
            className="flex-1 min-h-0 relative"
            style={{
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function FeatureLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-[#050508] font-mono text-sm tracking-[0.2em] text-cyan-500/60 animate-pulse">
      {label}
    </div>
  );
}

/**
 * 当 `open` 为 true 时往 history 里 push 一条标记，监听 popstate：
 *  - 用户按系统返回键 / 手势返回 → 触发 popstate → 调用 onClose 关闭这一层
 *  - 用户点关闭按钮 / Esc 等主动关闭 → cleanup 中 history.back() 把标记弹掉，避免历史栈污染
 *
 * 这样在 PWA 中按返回不会直接退出 App，而是依次关闭打开的层。
 */
function useBackButtonClose(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;

    window.history.pushState({ uliuliLayer: Date.now() }, "");

    let closedByPop = false;
    const handlePop = () => {
      closedByPop = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", handlePop);

    return () => {
      window.removeEventListener("popstate", handlePop);
      // 主动关闭时，把刚才 push 的 history 标记 back 掉
      if (!closedByPop) {
        try {
          window.history.back();
        } catch {
          /* ignore */
        }
      }
    };
  }, [open]);
}
