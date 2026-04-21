"use client";

import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';

// ==============================================================
// ⚠️ 注意：以下组件是我们下一步需要迁移的！
// 它们目前的路径是指向上一级的 components 文件夹。
// 如果你在本地运行，可能会因为缺少这些文件而报错。
// 请在报错后把这些组件的代码发给我继续转换。
// ==============================================================
import ErrorBoundary from '../components/ErrorBoundary';
import { ThreeBackground, CustomCursor } from '../components/Effects';
import { Dashboard, HorizontalVideoGallery } from '../components/Dashboard';
import { SongSystem } from '../components/SongSystem';
import { GameModal } from '../components/GameModal';
import { ToastContainer, GoldenLuckModal } from '../components/UI';
import { MailSpeedDial } from '../components/mail/MailSpeedDial';

// --- Types ---
interface NotificationItem {
  id: number;
  message: string;
}

// --- 本地背景视频播放器组件 (独立底部区块) ---
const LocalVideoPlayer: React.FC<{ isUnlocked: boolean; config?: any; configVersion?: number }> = ({
  isUnlocked,
  config,
  configVersion,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isMuted, setIsMuted] = useState(!isUnlocked);
  const currentVideoBase = isUnlocked ? "/video/2.mp4" : "/video/1.mp4";
  const currentVideo = configVersion ? `${currentVideoBase}?v=${configVersion}` : currentVideoBase;

  useEffect(() => {
    if (isUnlocked && videoRef.current) {
      const v = videoRef.current;
      v.currentTime = 56;
      v.muted = false;
      setIsMuted(false);
      v.play().catch(e => console.warn("Video play failed:", e));
    }
  }, [isUnlocked]);

  return (
    <section className="relative w-full max-w-6xl mx-auto px-4 md:px-6 my-10 md:my-20 z-10">
      {/* 赛博朋克风格标题装饰 */}
      <div className="flex items-center gap-4 mb-6">
        <div className="h-px bg-linear-to-r from-transparent to-(--neon-blue) flex-1 opacity-50"></div>
        <h2 className="text-(--neon-blue) font-tech tracking-widest text-sm md:text-xl font-bold flex items-center gap-2">
          {isUnlocked ? (config?.videos?.hiddenTitle || "🔓 HIDDEN_ARCHIVE_UNLOCKED") : (config?.videos?.unlockedTitle || "📺 SYSTEM_VIDEO_FEED")}
        </h2>
        <div className="h-px bg-linear-to-l from-transparent to-(--neon-blue) flex-1 opacity-50"></div>
      </div>

      <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-[0_0_30px_rgba(45,226,230,0.1)] group bg-black">
        {/* 边角装饰 */}
        <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-(--neon-blue) z-10 opacity-50 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-(--neon-blue) z-10 opacity-50 group-hover:opacity-100 transition-opacity pointer-events-none"></div>

        <video
          ref={videoRef}
          key={currentVideo}
          src={currentVideo}
          controls
          autoPlay
          loop
          muted={isMuted}
          playsInline
          className="w-full h-auto aspect-video object-cover relative z-0 opacity-80 group-hover:opacity-100 transition-opacity duration-500"
        />
      </div>
    </section>
  );
};

// --- 主 APP 组件 ---
export default function HomePage() {
  // 全局状态管理
  const [isMounted, setIsMounted] = useState(false);
  const [stats, setStats] = useState<string | number>("SYNCING...");
  const [liveStatus, setLiveStatus] = useState(false);
  const [videos, setVideos] = useState([]);
  
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isGoldenModalOpen, setIsGoldenModalOpen] = useState(false);
  const [isGameOpen, setIsGameOpen] = useState(false);

  const clickCountRef = useRef(0);
  const configVersionRef = useRef<number>(0);
  const [siteConfig, setSiteConfig] = useState<any>({});
  const [configVersion, setConfigVersion] = useState<number>(0);
  const [songs, setSongs] = useState<any[]>([]);
  const [hiddenSongs, setHiddenSongs] = useState<any[]>([]);

  const notifs = siteConfig?.notifications || {};
  // 安全获取 siteConfig
  const footerText = siteConfig?.footer?.text || "© 2024 BLUE MORPHO TERMINAL. ALL RIGHTS RESERVED.";

  // 0. 从数据库加载网站配置和歌曲数据
  useEffect(() => {
    let isActive = true;

    const loadConfig = async (announceUpdate = false) => {
      try {
        const res = await fetch("/api/config", { cache: "no-store" });
        const data = await res.json();
        if (data.success && isActive) {
          const nextVersion = Number(data.config_version || 0);
          const previousVersion = configVersionRef.current;
          const hasUpdated =
            announceUpdate &&
            previousVersion > 0 &&
            nextVersion > 0 &&
            previousVersion !== nextVersion;

          setSiteConfig(data.site_config);
          setSongs(data.songs || []);
          setHiddenSongs(data.hidden_songs || []);
          setConfigVersion(nextVersion);
          configVersionRef.current = nextVersion;

          if (hasUpdated) {
            const id = Date.now();
            setNotifications((prev) => [
              ...prev,
              { id, message: "站点数据已更新，内容已自动刷新" },
            ]);
            setTimeout(() => {
              setNotifications((prev) => prev.filter((n) => n.id !== id));
            }, 3000);
          }
        }
      } catch (error) {
        console.error("Failed to load config:", error);
      }
    };

    loadConfig(false);
    const timer = setInterval(() => {
      loadConfig(true);
    }, 15000);

    return () => {
      isActive = false;
      clearInterval(timer);
    };
  }, []);

  // 1. 初始化预加载核心资源
  useEffect(() => {
    setIsMounted(true);
    
    const versionQuery = configVersion ? `?v=${configVersion}` : "";
    const preloadAssets = [`Model.webp${versionQuery}`, `Model2.webp${versionQuery}`];
    preloadAssets.forEach(src => {
      const img = new Image();
      img.src = "/" + src;
    });

    const preloadVideos = [`/video/1.mp4${versionQuery}`, `/video/2.mp4${versionQuery}`];
    preloadVideos.forEach(src => {
      const vid = document.createElement('video');
      vid.src = src;
      vid.preload = "auto";
    });
  }, [configVersion]);

  // 2. 真实 API 数据获取 (B站爬虫)
  useEffect(() => {
    const fetchData = async () => {
      try {
        const apiUrl = siteConfig?.api?.bilibili || "https://api.uliuli.cc/api"; 
        
        const response = await fetch(apiUrl);
        if (response.ok) {
          const data = await response.json();
          
          if (data.success) {
            if (data.user) {
              setStats(data.user.fans);
              setLiveStatus(data.user.is_live);
            }
            if (data.videos) {
              setVideos(data.videos);
            }
          } else {
            console.error("API 业务错误:", data.error);
            setStats("ERROR");
          }
        } else {
            console.error("Failed to fetch Bilibili data");
            setStats("ERROR");
        }
      } catch (error) {
        console.error("API Fetch Error:", error);
        setStats("OFFLINE");
      }
    };

    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3. 通用功能函数
  const addNotification = (message: string) => {
    const id = Date.now();
    setNotifications((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 3000);
  };

  const unlockHidden = (showGoldenModal = false) => {
    if (!isUnlocked) {
      setIsUnlocked(true);
      addNotification(notifs.unlocked || "SYSTEM OVERRIDE: HIDDEN PROTOCOL ACTIVATED");
    }
    if (showGoldenModal) {
      setIsGoldenModalOpen(true);
    }
  };

  const handleAvatarClick = () => {
    if (isUnlocked) {
      addNotification(notifs.alreadyUnlocked || "MODEL ARCHIVE ALREADY UNLOCKED");
      return;
    }

    clickCountRef.current += 1;
    const count = clickCountRef.current;

    if (count >= 10) {
      unlockHidden(false);
      clickCountRef.current = 0;
    } else if (count >= 7) {
      const warningText = (notifs.clickWarning || "WARNING: {count} CLICKS TO OVERRIDE").replace('{count}', 10 - count);
      addNotification(warningText);
    } else {
      addNotification(notifs.modelClicked || "MODEL CLICKED");
    }
  };

  const assetVersionQuery = configVersion ? `?v=${configVersion}` : "";

  // 4. 隐藏秘籍监听 (复活彩蛋键盘输入)
  useEffect(() => {
    if (isUnlocked) return;

    let cheatBuffer = "";
    const handleCheat = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      let key = e.key.toLowerCase();
      if (key === "arrowup") key = "u";
      else if (key === "arrowdown") key = "d";
      else if (key === "arrowleft") key = "l";
      else if (key === "arrowright") key = "r";

      cheatBuffer = (cheatBuffer + key).slice(-20);
      
      if (cheatBuffer.includes("uuddlrlrba")) {
        unlockHidden(false);
        cheatBuffer = "";
      }
    };

    window.addEventListener("keydown", handleCheat);
    return () => window.removeEventListener("keydown", handleCheat);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUnlocked]);

  // 修复2：在服务端和首次客户端渲染时，先返回加载动画，避免读 window 导致的水合 DOM 不匹配
  if (!isMounted) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-black">
        <h1 className="font-tech text-white text-xl tracking-[5px] animate-pulse">
          {notifs.systemInitializing || "SYSTEM INITIALIZING..."}
        </h1>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="relative min-h-screen">
        <CustomCursor />
        <ThreeBackground />
        <ToastContainer notifications={notifications} />

        <main className="relative z-10 w-full block">
          <Dashboard
            stats={stats}
            liveStatus={liveStatus}
            onOpenGame={() => setIsGameOpen(true)}
            avatarSrc={`${isUnlocked ? "Model2.webp" : "Model.webp"}${assetVersionQuery}`}
            onAvatarClick={handleAvatarClick}
            config={siteConfig}
            assetVersion={configVersion}
          />

          <div className="w-full py-20 relative">
            <SongSystem 
              onUnlockHidden={() => unlockHidden(true)} 
              addNotification={addNotification} 
              isUnlocked={isUnlocked}
              config={siteConfig}
              songs={songs}
              hiddenSongs={hiddenSongs}
            />
          </div>

          <div className="w-full relative block">
            {videos.length > 0 && (
              <HorizontalVideoGallery videos={videos} config={siteConfig} />
            )}
          </div>

          <LocalVideoPlayer
            isUnlocked={isUnlocked}
            config={siteConfig}
            configVersion={configVersion}
          />

          <footer className="w-full py-10 border-t border-gray-900 text-center relative mt-10">
            <div className="absolute top-0 left-0 w-full h-px bg-linear-to-r from-transparent via-(--neon-blue) to-transparent"></div>
            <p className="text-gray-600 font-mono text-xs tracking-widest">
              {footerText}
            </p>
          </footer>
        </main>

        <div id="modal-container" className="relative z-[9999]">
          <AnimatePresence>
            {isGoldenModalOpen && (
              <GoldenLuckModal
                key="golden-modal"
                isOpen={isGoldenModalOpen}
                onClose={() => setIsGoldenModalOpen(false)}
                config={siteConfig}
              />
            )}
            {isGameOpen && (
              <GameModal
                key="game-modal"
                isOpen={isGameOpen}
                onClose={() => setIsGameOpen(false)}
                config={siteConfig}
              />
            )}
          </AnimatePresence>
        </div>

        <MailSpeedDial texts={siteConfig?.mail} />
      </div>
    </ErrorBoundary>
  );
}