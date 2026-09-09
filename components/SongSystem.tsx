"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import type { SiteConfig } from '@/app/admin/types';
import { GlassCard, Icons } from './UI';

export interface SongItem {
  name: string;
  artist: string;
  category: string;
  isHidden?: boolean;
}

export interface SongCategory {
  id: string;
  label: string;
}

export interface SongSystemProps {
  onUnlockHidden: (showGoldenModal?: boolean) => void;
  addNotification: (msg: string) => void;
  isUnlocked: boolean;
  config?: SiteConfig;
  songs?: SongItem[];
  hiddenSongs?: SongItem[];
  /** 强制跳过列表的桌面 stagger 动画。/app 入口里 SongSystem 嵌在小屏 panel 中，
   * 即使浏览器宽度 ≥ 768 也不应该走 ~9 秒的桌面 stagger 动画。 */
  disableAnimation?: boolean;
}

const DEFAULT_SONG_CATEGORIES: SongCategory[] = [
  { id: "all", label: "ALL" },
  { id: "gufeng", label: "ANCIENT" },
  { id: "liuxing", label: "POP" },
  { id: "yingyu", label: "ENGLISH" },
  { id: "riyu", label: "JAPANESE" },
];

const DEFAULT_SONG_UI: NonNullable<SiteConfig["song_ui"]> & { categories: SongCategory[] } = {
  titlePrefix: "SONG",
  titleSuffix: "_DATABASE",
  categories: DEFAULT_SONG_CATEGORIES,
};

function pickRandomSong(songs: SongItem[]): SongItem {
  return songs[Math.floor(Math.random() * songs.length)];
}

export const SongSystem: React.FC<SongSystemProps> = ({ onUnlockHidden, addNotification, isUnlocked, config, songs, hiddenSongs, disableAnimation = false }) => {
  const uiConfig = useMemo(() => {
    const configuredCategories = config?.song_ui?.categories;
    return {
      ...DEFAULT_SONG_UI,
      ...config?.song_ui,
      categories: configuredCategories?.length ? configuredCategories : DEFAULT_SONG_CATEGORIES,
    };
  }, [config?.song_ui]);
  
  const [activeTab, setActiveTab] = useState<string>(uiConfig.categories[0]?.id || "all");
  const [searchTerm, setSearchTerm] = useState("");
  const [copiedSong, setCopiedSong] = useState<string | null>(null);
  const [pityCount, setPityCount] = useState<string | number>("...");
  const [isOnline, setIsOnline] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  // 首页会服务端渲染，首次客户端渲染必须使用相同的动画分支。
  // 挂载后再检测屏幕宽度，让手机及时切换到无 stagger 的列表。
  const [isMobile, setIsMobile] = useState(false);

  // 任一为真即跳过桌面动画
  const skipStagger = isMobile || disableAnimation;
  
  const WORKER_URL = "/api"; 
  
  const baseSongs = useMemo(() => songs ?? [], [songs]);
  const hiddenSongsRaw = useMemo(() => hiddenSongs ?? [], [hiddenSongs]);

  const categories = useMemo(() => {
    const cats: SongCategory[] = [...uiConfig.categories];
    if (isUnlocked && !cats.find(c => c.id === 'hidden')) {
      cats.push({ id: 'hidden', label: 'CLASSIFIED' });
    }
    return cats;
  }, [uiConfig.categories, isUnlocked]);

  const songData = useMemo(() => {
    if (isUnlocked) {
      const formattedHidden: SongItem[] = hiddenSongsRaw.map(s => ({
        name: s.name,
        artist: s.artist || "UNKNOWN_ENTITY",
        category: "hidden",
        isHidden: true 
      }));
      return [...baseSongs, ...formattedHidden];
    }
    return baseSongs;
  }, [baseSongs, hiddenSongsRaw, isUnlocked]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    const frame = window.requestAnimationFrame(handleResize);
    window.addEventListener("resize", handleResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    fetch(`${WORKER_URL}/getCount`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setPityCount(d.count);
        setIsOnline(true);
      })
      .catch(() => {
        setIsOnline(false);
        setPityCount("OFFLINE");
      });
  }, []);

  const handleRandom = async () => {
    if (songData.length === 0) return;
    setIsLoading(true);

    const s = pickRandomSong(songData);
    const copyText = s.isHidden && s.artist === "UNKNOWN_ENTITY" 
      ? `点歌 ${s.name}` 
      : `点歌 ${s.name} ${s.artist}`;
    
    handleCopy(copyText, s.name);

    try {
      const res = await fetch(`${WORKER_URL}/increment`, {
        method: "POST",
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.newCount !== undefined) {
          setPityCount(data.newCount); 
          if (data.triggeredGoldenLuck) {
             console.log("Golden Luck Triggered!");
             onUnlockHidden(true); 
          }
        }
      }
    } catch (e) {
      console.warn("Sync Failed:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = (text: string, name: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedSong(name);
      addNotification(`${uiConfig.copiedPrefix || "COPIED:"} ${name}`);
      setTimeout(() => setCopiedSong(null), 2000);
    });
  };

  const filteredSongs = useMemo(
    () =>
      songData.filter((s) => {
          const matchCategory = activeTab === 'all' || s.category === activeTab;
          const matchSearch = s.name.includes(searchTerm) || s.artist.includes(searchTerm);
          return matchCategory && matchSearch;
      }),
    [activeTab, searchTerm, songData]
  );

  const listVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.03, when: "beforeChildren" },
    },
    exit: { opacity: 0, filter: "blur(10px)", transition: { duration: 0.2 } },
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, x: -20, filter: "blur(5px)" },
    visible: {
      opacity: 1,
      x: 0,
      filter: "blur(0px)",
      transition: { type: "spring" as const, stiffness: 300, damping: 24 },
    },
  };

  return (
    <section id="song-system" className="container mx-auto px-6 mb-16 md:mb-32 relative z-10">
      <h2 className="text-[7vw] md:text-4xl font-cyber font-bold text-center mb-10 text-white whitespace-nowrap">
        {uiConfig.titlePrefix}<span className="text-(--neon-blue)">{uiConfig.titleSuffix}</span>
      </h2>

      <GlassCard className="w-full max-w-6xl mx-auto p-4 md:p-8 min-h-[500px] md:min-h-175" disableAnimation={skipStagger}>
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4 md:gap-6">
          <div className="text-sm font-mono text-(--neon-blue) text-center md:text-left">
            {uiConfig.serverText || "SERVER:"} {isOnline ? (uiConfig.serverOnline || "ONLINE") : (uiConfig.serverOffline || "OFFLINE")} <span aria-hidden>{"//"}</span> {uiConfig.pityText || "PITY:"} {pityCount}
          </div>
          <div className="flex gap-4 w-full md:w-auto">
            <input
              type="text"
              placeholder={uiConfig.searchPlaceholder || "SEARCH..."}
              className="bg-black/40 border border-(--neon-blue)/30 rounded px-4 py-2 text-white w-full md:w-64 focus:border-(--neon-blue) outline-none font-tech text-sm"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button
              onClick={handleRandom}
              disabled={isLoading}
              className={`px-6 py-2 bg-(--neon-blue) text-black font-bold font-tech text-sm hover:bg-white transition-colors whitespace-nowrap ${
                isLoading ? "opacity-50 cursor-not-allowed" : ""
              }`}
            >
              {isLoading ? (uiConfig.syncingBtn || "SYNC...") : (uiConfig.randomizeBtn || "RANDOMIZE")}
            </button>
          </div>
        </div>

        <div className="flex justify-between md:justify-start gap-2 md:gap-8 border-b border-gray-800 mb-6 overflow-x-auto no-scrollbar">
          {categories.map((t) => {
            const isHiddenTab = t.id === 'hidden';
            const isActive = activeTab === t.id;
            
            const activeColorClass = isHiddenTab 
                ? "text-purple-400 border-b-2 border-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.8)]" 
                : "text-(--neon-blue) border-b-2 border-(--neon-blue)";
                
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`pb-4 font-tech text-xs md:text-sm tracking-wider md:tracking-widest transition-colors whitespace-nowrap ${
                  isActive ? activeColorClass : "text-gray-500 hover:text-white"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="h-125 overflow-y-auto pr-2 custom-scrollbar relative">
          {skipStagger ? (
            // 无动画路径：用普通 div 直接渲染，避免 framer-motion 子级隐式继承
            // 父级 variants 状态导致 opacity 卡在 0。
            <div key={activeTab + searchTerm}>
              {filteredSongs.length === 0 ? (
                <div className="text-center text-gray-500 mt-20 font-mono tracking-widest">
                  {uiConfig.emptyText || "/// DATA NOT FOUND ///"}
                </div>
              ) : (
                filteredSongs.map((s, i) => (
                  <div
                    key={`${s.name}-${i}`}
                    className={`flex justify-between items-center p-4 border-b border-white/5 transition-colors group cursor-pointer ${
                        s.isHidden ? 'hover:bg-purple-900/20' : 'hover:bg-(--neon-blue)/10'
                    }`}
                    onClick={() => {
                      const copyText = s.isHidden && s.artist === "UNKNOWN_ENTITY"
                        ? `点歌 ${s.name}`
                        : `点歌 ${s.name} ${s.artist}`;
                      handleCopy(copyText, s.name);
                    }}
                  >
                    <div>
                      <div className={`font-medium transition-colors flex items-center gap-2 ${
                          s.isHidden
                            ? 'text-purple-300 group-hover:text-purple-100'
                            : 'text-white group-hover:text-(--neon-blue)'
                      }`}>
                        {s.name}
                        {s.isHidden && (
                            <span className="text-[9px] font-tech tracking-widest bg-purple-600/20 border border-purple-500/50 text-purple-400 px-1.5 py-0.5 rounded">
                                {uiConfig.secretTag || "SECRET"}
                            </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 font-mono mt-1">
                        {s.artist}
                      </div>
                    </div>
                    <div className={`opacity-0 group-hover:opacity-100 transition-opacity ${
                        s.isHidden ? 'text-purple-400' : 'text-(--neon-blue)'
                    }`}>
                      {copiedSong === s.name ? (
                        uiConfig.copiedTag || "COPIED"
                      ) : (
                        <Icons.Copy size={16} />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab + searchTerm}
              variants={listVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {filteredSongs.length === 0 ? (
                <motion.div
                  variants={itemVariants}
                  className="text-center text-gray-500 mt-20 font-mono tracking-widest"
                >
                  {uiConfig.emptyText || "/// DATA NOT FOUND ///"}
                </motion.div>
              ) : (
                filteredSongs.map((s, i) => (
                  <motion.div
                    key={`${s.name}-${i}`}
                    variants={itemVariants}
                    className={`flex justify-between items-center p-4 border-b border-white/5 transition-colors group cursor-pointer ${
                        s.isHidden ? 'hover:bg-purple-900/20' : 'hover:bg-(--neon-blue)/10'
                    }`}
                    onClick={() => {
                      const copyText = s.isHidden && s.artist === "UNKNOWN_ENTITY" 
                        ? `点歌 ${s.name}` 
                        : `点歌 ${s.name} ${s.artist}`;
                      handleCopy(copyText, s.name);
                    }}
                  >
                    <div>
                      <div className={`font-medium transition-colors flex items-center gap-2 ${
                          s.isHidden 
                            ? 'text-purple-300 group-hover:text-purple-100' 
                            : 'text-white group-hover:text-(--neon-blue)'
                      }`}>
                        {s.name}
                        {s.isHidden && (
                            <span className="text-[9px] font-tech tracking-widest bg-purple-600/20 border border-purple-500/50 text-purple-400 px-1.5 py-0.5 rounded">
                                {uiConfig.secretTag || "SECRET"}
                            </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 font-mono mt-1">
                        {s.artist}
                      </div>
                    </div>
                    <div className={`opacity-0 group-hover:opacity-100 transition-opacity ${
                        s.isHidden ? 'text-purple-400' : 'text-(--neon-blue)'
                    }`}>
                      {copiedSong === s.name ? (
                        uiConfig.copiedTag || "COPIED"
                      ) : (
                        <Icons.Copy size={16} />
                      )}
                    </div>
                  </motion.div>
                ))
              )}
            </motion.div>
          </AnimatePresence>
          )}
        </div>
      </GlassCard>
    </section>
  );
};
