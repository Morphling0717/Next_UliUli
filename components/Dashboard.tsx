"use client";

/* eslint-disable @next/next/no-img-element */

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { SiteConfig } from '@/app/admin/types';

// 引入 UI 组件库
import { GlassCard, Icons } from './UI';

// 确保在客户端环境才注册 GSAP 插件
if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

const getConfig = (providedConfig?: SiteConfig): SiteConfig => {
  return providedConfig || {};
};

// --- Types ---
export interface VideoItem {
  url: string;
  pic: string;
  title: string;
  length: string;
  date: string;
  play: string | number;
}

export interface DetailItem {
  id: string;
  img: string;
}

export interface CreditItem {
  name: string;
  link: string;
}

export interface CreditInfo {
  label: string;
  val: CreditItem[];
}

export interface LinkItem {
  title: string;
  url: string;
  icon: string;
  color: string;
}

export interface DashboardProps {
  stats: string | number;
  liveStatus: boolean;
  avatarSrc: string;
  onAvatarClick: () => void;
  onOpenGame: () => void;
  config?: SiteConfig;
  assetVersion?: number;
}

const withAssetVersion = (src: string, assetVersion?: number) => {
  if (!src || !assetVersion) return src;
  if (/^https?:\/\//i.test(src)) return src;
  return src.includes("?") ? `${src}&v=${assetVersion}` : `${src}?v=${assetVersion}`;
};

// --- 经典 CRT 显像管故障特效文本组件 ---
const CyberGlitchText: React.FC<{ text: string; className?: string; style?: React.CSSProperties }> = ({ text, className = "", style = {} }) => {
  const [isHovered, setIsHovered] = useState(false);

  const idleClip1 = ["inset(100% 0 0% 0)", "inset(20% 0 70% 0)", "inset(100% 0 0% 0)", "inset(100% 0 0% 0)", "inset(60% 0 20% 0)", "inset(100% 0 0% 0)"];
  const idleX1 = [0, -6, 0, 0, 6, 0];
  const idleTimes = [0, 0.02, 0.05, 0.6, 0.63, 1]; 

  const idleClip2 = ["inset(100% 0 0% 0)", "inset(100% 0 0% 0)", "inset(10% 0 60% 0)", "inset(100% 0 0% 0)", "inset(30% 0 40% 0)", "inset(100% 0 0% 0)"];
  const idleX2 = [0, 0, 6, 0, -6, 0];

  const hoverClip1 = ["inset(20% 0 70% 0)", "inset(60% 0 20% 0)", "inset(40% 0 50% 0)", "inset(80% 0 10% 0)", "inset(10% 0 80% 0)", "inset(20% 0 70% 0)"];
  const hoverX1 = [-8, 8, -5, 10, -6, -8];

  const hoverClip2 = ["inset(10% 0 60% 0)", "inset(30% 0 40% 0)", "inset(70% 0 20% 0)", "inset(20% 0 50% 0)", "inset(50% 0 30% 0)", "inset(10% 0 60% 0)"];
  const hoverX2 = [8, -8, 10, -5, 8, 8];

  return (
    <div 
      className={`relative inline-block ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={style}
    >
      <div className="relative z-10 font-black">
        <motion.span 
          className="relative inline-block text-white"
          animate={{ x: isHovered ? [-1, 2, -2, 1, 0] : 0 }}
          transition={{ duration: 0.2, repeat: Infinity, repeatType: "mirror" }}
        >
          {text}
        </motion.span>
        
        <motion.span
          className="absolute top-0 left-0 w-full h-full text-white pointer-events-none bg-[#050508]"
          style={{ textShadow: "-4px 0 #ff003c, 2px 0 #00ffff" }}
          animate={{
            clipPath: isHovered ? hoverClip1 : idleClip1,
            x: isHovered ? hoverX1 : idleX1,
          }}
          transition={{
            duration: isHovered ? 0.3 : 4,
            ease: "linear",
            times: isHovered ? [0, 0.2, 0.4, 0.6, 0.8, 1] : idleTimes,
            repeat: Infinity,
          }}
          aria-hidden="true"
        >
          {text}
        </motion.span>

        <motion.span
          className="absolute top-0 left-0 w-full h-full text-white pointer-events-none bg-[#050508]"
          style={{ textShadow: "4px 0 #00ffff, -2px 0 #ff003c" }}
          animate={{
            clipPath: isHovered ? hoverClip2 : idleClip2,
            x: isHovered ? hoverX2 : idleX2,
          }}
          transition={{
            duration: isHovered ? 0.4 : 5,
            ease: "linear",
            times: isHovered ? [0, 0.2, 0.4, 0.6, 0.8, 1] : idleTimes,
            repeat: Infinity,
          }}
          aria-hidden="true"
        >
          {text}
        </motion.span>
      </div>
    </div>
  );
};

// --- 1. Hero Section ---
const HeroSection: React.FC<{ stats: string | number; config?: SiteConfig }> = ({ stats, config }) => {
  const cfg = getConfig(config).hero || {};

  const scrollToSongs = () => {
    const element = document.getElementById("song-system");
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div className="h-screen w-full flex flex-col justify-center items-center relative px-4 md:px-6 mb-12 md:mb-20 overflow-hidden">
      <div className="z-10 text-center relative w-full max-w-[90vw]">
        <div className="mb-4 font-mono text-[10px] md:text-xs lg:text-sm text-(--neon-blue) tracking-[0.15em] md:tracking-[0.3em]">
          {cfg.code || "PROJECT CODE: SIGUAULI"}
        </div>

        <div className="relative mb-6 flex justify-center cursor-default">
          <CyberGlitchText 
            text={cfg.title || "“大家好。初次入梦，幸会”"}
            className="leading-tight font-black text-[5.5vw] md:text-[6.5vw] lg:text-[5vw] xl:text-[4.5vw] 2xl:text-[4vw]"
            style={{ fontFamily: "'Noto Sans SC', sans-serif" }}
          />
        </div>

        <h1
          className="font-bold text-(--neon-blue) opacity-80 tracking-widest mt-2 text-[4vw] md:text-[2.5vw] lg:text-[2vw] xl:text-[1.5vw]"
          style={{ fontFamily: "'Ma Shan Zheng', cursive" }}
        >
          {cfg.subtitle || "蝴蝶梦中歌唱，彼方沉眠"}
        </h1>

        <div className="mt-10 max-w-xl mx-auto border-l-2 border-(--neon-blue) pl-6 text-left font-mono">
          <p className="text-white/90 text-base md:text-lg font-bold tracking-widest mb-2">
            {cfg.projectName || "“项目名称: 丝瓜ULI”"}
          </p>
          <p className="text-xs md:text-sm text-gray-500 tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
            {cfg.statusText || "项目状态: 存活"} <span aria-hidden>{"//"}</span> {cfg.followersText || "现有追随者:"}{" "}
            <span className="text-(--neon-blue)">{stats}</span>
          </p>
        </div>

        <div className="mt-12 flex gap-4 justify-center">
          <button
            onClick={scrollToSongs}
            className="px-8 py-3 border border-(--neon-blue) text-(--neon-blue) font-tech text-sm hover:bg-(--neon-blue) hover:text-black transition-all duration-300 relative group overflow-hidden"
          >
            <span className="relative z-10">{cfg.startBtn || "START_STAGE"}</span>
            <div className="absolute inset-0 bg-(--neon-blue) opacity-0 group-hover:opacity-20 translate-y-full group-hover:translate-y-0 transition-all duration-300 ease-out"></div>
          </button>
        </div>
      </div>

      <div className="absolute bottom-10 left-1/2 -translate-x-1/2">
        <div className="flex flex-col items-center gap-2 animate-bounce">
          <div className="w-px h-16 bg-linear-to-b from-(--neon-blue) to-transparent"></div>
          <span className="font-mono text-[10px] tracking-widest text-(--neon-blue)">
            {cfg.scrollText || "SCROLL"}
          </span>
        </div>
      </div>
    </div>
  );
};

// --- 2. Model Breakdown ---
const ModelBreakdown: React.FC<{ avatarSrc: string; onAvatarClick: () => void; config?: SiteConfig; assetVersion?: number }> = ({
  avatarSrc,
  onAvatarClick,
  config,
  assetVersion,
}) => {
  const cfg = getConfig(config).model || {};
  const details: DetailItem[] = cfg.details || [];
  const credits: CreditInfo[] = cfg.credits || [];

  return (
    <section id="model-section" className="min-h-auto md:min-h-[80vh] w-full pt-12 pb-6 md:py-20 relative">
      <div className="container mx-auto px-6 relative z-10">
        <div className="flex items-end justify-between mb-10 border-b border-gray-800 pb-6">
          <h2 className="text-2xl md:text-4xl font-cyber font-bold text-white">
            {cfg.titlePrefix || "PROJECT"}
            <span className="text-(--neon-blue)">
              {cfg.titleSuffix || "_DATA"}
            </span>
          </h2>
          <div className="font-mono text-[10px] md:text-xs text-gray-500 text-right">
            {cfg.syncRate || "SYNC_RATE: 100%"}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-8 h-auto lg:h-200 items-center">
          <div className="lg:col-span-3 flex flex-row lg:flex-col gap-2 lg:gap-6 h-auto lg:h-full justify-center order-3 lg:order-1 w-full">
            {details.map((item: DetailItem) => (
              <GlassCard
                key={item.id}
                className="flex-1 w-full h-24 md:h-32 lg:h-auto group interactive relative overflow-hidden bg-gray-900"
              >
                <img
                  src={`/${withAssetVersion(item.img, assetVersion)}`}
                  alt={item.id}
                  className="absolute top-1/2 left-0 w-full h-auto -translate-y-1/2 opacity-80 group-hover:opacity-100 group-hover:scale-110 transition duration-700"
                  onError={(e: React.SyntheticEvent<HTMLImageElement>) => ((e.target as HTMLImageElement).style.display = "none")}
                />
                <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/40 to-transparent opacity-90 group-hover:opacity-50 transition-opacity"></div>
                <div className="absolute inset-0 z-10 flex items-start justify-center pt-2 text-(--neon-blue) font-tech tracking-widest text-[9px] md:text-sm lg:text-xl group-hover:text-white transition-colors shadow-black drop-shadow-md text-center leading-tight">
                  {item.id}_DETAIL
                </div>
              </GlassCard>
            ))}
          </div>

          <div className="lg:col-span-6 relative h-full flex items-center justify-center group order-2 lg:order-2">
            <div className="absolute bottom-10 w-3/4 h-20 bg-(--neon-blue)/10 blur-xl rounded-full scale-x-0 group-hover:scale-x-100 transition duration-1000"></div>
            <div className="relative w-full h-full flex items-center justify-center py-4">
              <AnimatePresence mode="wait">
                <motion.img
                  key={avatarSrc}
                  src={`/${avatarSrc}`}
                  initial={{ opacity: 0, scale: 0.95, filter: "blur(8px) brightness(2) hue-rotate(90deg)" }}
                  animate={{ opacity: 1, scale: 1, filter: "blur(0px) brightness(1) hue-rotate(0deg)", x: [0, -10, 10, -5, 5, 0] }}
                  exit={{ opacity: 0, scale: 1.05, filter: "blur(10px) brightness(0.5)" }}
                  transition={{ type: "tween", duration: 0.4, ease: "easeOut" }}
                  className="max-h-[50vh] md:max-h-212.5 w-auto object-contain drop-shadow-[0_0_20px_rgba(45,226,230,0.3)] cursor-pointer hover:scale-[1.02] relative z-10"
                  alt="Model"
                  onError={(e: React.SyntheticEvent<HTMLImageElement>) => ((e.target as HTMLImageElement).style.display = "none")}
                  onClick={onAvatarClick}
                />
              </AnimatePresence>
            </div>
          </div>

          <div className="lg:col-span-3 flex flex-row lg:flex-col justify-around lg:justify-center gap-2 lg:gap-8 lg:pl-8 lg:border-l border-gray-800 h-full order-1 lg:order-3 w-full mb-4 lg:mb-0">
            {credits.map((info: CreditInfo) => (
              <div key={info.label} className="group flex flex-col items-center lg:items-start">
                <div className="text-[10px] text-(--neon-blue) font-mono mb-1 tracking-widest">
                  {"/// "} {info.label}
                </div>
                <h3 className="text-sm md:text-2xl font-bold font-serif text-white italic text-center lg:text-left leading-tight">
                  {info.val.map((item: CreditItem, i: number) => (
                    <a
                      key={i}
                      href={item.link}
                      target="_blank"
                      rel="noreferrer"
                      className="block hover:text-(--neon-blue) transition-colors cursor-pointer"
                    >
                      {item.name}
                    </a>
                  ))}
                </h3>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

// --- 3. Live Status & Shortcuts ---
const LiveStatusSection: React.FC<{ liveStatus: boolean; onOpenGame: () => void; config?: SiteConfig }> = ({ liveStatus, onOpenGame, config }) => {
  const cfg = getConfig(config).live || {};
  const links: LinkItem[] = cfg.links || [];

  const getIcon = (name: string) => {
    if (name === "Music") return <Icons.Music size={20} />;
    if (name === "Video") return <Icons.Video size={20} />;
    if (name === "Sparkles") return <Icons.Sparkles size={20} />;
    return <Icons.ExternalLink size={20} />;
  };

  const getColorClass = (color: string) => {
    if (color === "pink") return { border: "group-hover:border-pink-500", text: "text-pink-300", glow: "group-hover:shadow-[0_0_20px_rgba(236,72,153,0.3)]" };
    if (color === "cyan") return { border: "group-hover:border-cyan-500", text: "text-cyan-300", glow: "group-hover:shadow-[0_0_20px_rgba(6,182,212,0.3)]" };
    if (color === "purple") return { border: "group-hover:border-purple-500", text: "text-purple-300", glow: "group-hover:shadow-[0_0_20px_rgba(168,85,247,0.3)]" };
    return { border: "group-hover:border-white", text: "text-white", glow: "group-hover:shadow-none" };
  };

  return (
    <div className="container mx-auto px-6 mb-12 md:mb-20 mt-0 md:mt-32">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-2 gap-6">
          <GlassCard className="p-6 md:p-8 flex flex-col justify-center relative overflow-hidden group min-h-50">
            <div className="relative z-10">
              <h3 className="text-2xl md:text-3xl font-bold text-white mb-2 flex items-center gap-3">
                {cfg.title || "直播状态"}
                <span className="relative flex h-3 w-3">
                  {liveStatus && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  )}
                  <span className={`relative inline-flex rounded-full h-3 w-3 ${liveStatus ? "bg-green-500" : "bg-gray-500"}`}></span>
                </span>
              </h3>
              <p className="text-gray-400 text-sm font-mono tracking-widest mb-6 opacity-80">
                {cfg.roomPrefix || "Room:"} {cfg.roomId || "1900561793"}
              </p>
              <a
                href={`https://live.bilibili.com/${cfg.roomId || "1900561793"}`}
                target="_blank"
                rel="noreferrer"
                className={`
                  inline-block px-8 py-3 rounded-lg font-black font-tech tracking-wider transition-all shadow-lg transform
                  ${liveStatus ? "bg-[#4ff0ff] text-black hover:bg-white hover:scale-105 hover:shadow-[0_0_20px_#4ff0ff]" : "bg-white/10 text-gray-400 hover:bg-white/20 hover:text-white"}
                `}
              >
                {liveStatus ? (cfg.liveNowText || "LIVE NOW") : (cfg.offlineText || "OFFLINE")}
              </a>
            </div>
          </GlassCard>

          <GlassCard className="p-6 group hover:border-(--neon-blue)/50 transition-colors flex flex-col justify-center min-h-50">
            <div className="flex flex-col gap-3 h-full">
              <div>
                <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2 group-hover:text-(--neon-blue) transition-colors">
                  <Icons.Calendar size={18} /> {cfg.scheduleTitle || "直播时间"}
                </h3>
                <div className="text-xs text-gray-300 font-mono space-y-1 pl-1">
                  <div className="flex justify-between">
                    <span>{cfg.schedule?.morning || "早场: 10:00 - 13:00"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{cfg.schedule?.evening || "晚场: 17:00 - 20:00"}</span>{" "}
                    <span className="text-(--neon-blue) font-bold">
                      {cfg.schedule?.off || "周一休"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="h-px w-full bg-white/10 my-1"></div>

              <div>
                <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2 group-hover:text-(--neon-blue) transition-colors">
                  <Icons.Info size={18} /> {cfg.rulesTitle || "点歌规则"}
                </h3>
                <ul className="text-[10px] md:text-xs text-gray-400 space-y-1 list-disc list-inside pl-1">
                  {(cfg.rules || ["优先点歌单内的歌曲"]).map((r: string, i: number) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            </div>
          </GlassCard>
        </div>

        <div className="lg:col-span-5 grid grid-cols-2 gap-4 md:gap-6">
          {links.map((btn: LinkItem, i: number) => {
            const style = getColorClass(btn.color);
            return (
              <GlassCard
                key={i}
                onClick={() => window.open(btn.url, "_blank")}
                className={`h-full min-h-25 cursor-pointer transition-all duration-300 ${style.border} ${style.glow}`}
              >
                <div className="flex flex-col items-center justify-center w-full h-full p-4">
                  <div className={`relative z-10 mb-2 transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-110 ${style.text}`}>
                    {getIcon(btn.icon)}
                  </div>
                  <span className={`relative z-10 text-sm font-bold text-gray-300 group-hover:text-white transition-colors`}>
                    {btn.title}
                  </span>
                </div>
              </GlassCard>
            );
          })}

          <GlassCard
            onClick={onOpenGame}
            className="h-full min-h-25 cursor-pointer transition-all duration-300 hover:border-yellow-400/50 hover:shadow-[0_0_25px_rgba(250,204,21,0.25)]"
          >
            <div className="flex flex-col items-center justify-center w-full h-full p-4">
              <div className="relative z-10 text-yellow-400 mb-2 transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-110">
                <Icons.Swords size={24} />
              </div>
              <span className="relative z-10 text-sm font-bold text-yellow-100 group-hover:text-white transition-colors">
                {cfg.gamePortalText || "小游戏传送门"}
              </span>
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
};

// --- 4. Gallery (Horizontal Video Gallery) ---
export const HorizontalVideoGallery: React.FC<{ videos: VideoItem[]; config?: SiteConfig }> = ({ videos, config }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const cfg = getConfig(config).gallery || {};

  useEffect(() => {
    if (!videos || videos.length === 0 || !wrapperRef.current || !containerRef.current) return;

    const ctx = gsap.context(() => {
      gsap.to(wrapperRef.current, {
        x: () => -(wrapperRef.current!.scrollWidth - window.innerWidth),
        ease: "none",
        scrollTrigger: {
          trigger: containerRef.current,
          pin: true,
          start: "top top",
          scrub: 1,
          anticipatePin: 1,
          fastScrollEnd: true,
          end: () => "+=" + (wrapperRef.current!.scrollWidth - window.innerWidth),
          invalidateOnRefresh: true,
        },
      });
    }, containerRef);

    return () => ctx.revert();
  }, [videos]);

  if (!videos || videos.length === 0) return null;

  return (
    <section ref={containerRef} className="h-screen w-full relative overflow-hidden flex flex-col justify-center py-12 md:py-20">
      <div className="absolute top-6 right-6 md:top-10 md:right-10 z-20 text-right pointer-events-none">
        <h2 className="text-[6vw] md:text-5xl font-cyber font-bold text-white drop-shadow-lg max-w-[80vw] leading-tight">
          {cfg.titlePrefix || "VISUAL"}
          <span className="text-(--neon-blue)">
            {cfg.titleSuffix || "_ARCHIVE"}
          </span>
        </h2>
        <div className="text-xs text-gray-300 mt-2 font-mono">
          {cfg.scrollText || "SCROLL TO EXPLORE >>>"}
        </div>
      </div>

      <div ref={wrapperRef} className="flex flex-nowrap items-center h-[60vh] md:h-[70vh] pl-4 md:pl-[10vw] gap-6 md:gap-20 relative z-10">
        {videos.map((v, i) => (
          <div
            key={i}
            className="gallery-item min-w-[85vw] md:min-w-125 h-[55vh] md:h-100 relative group cursor-pointer border border-white/10 hover:border-(--neon-blue) transition-all duration-500 bg-black/40 backdrop-blur-sm rounded-xl overflow-hidden"
            onClick={() => v.url !== "#" && window.open(v.url, "_blank")}
          >
            <div className="absolute inset-0 bg-gray-900 overflow-hidden">
              <img
                src={v.pic.replace(/^http:/, "https:")}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-110 transition duration-700"
                alt={v.title}
              />
              <div className="absolute bottom-2 right-2 bg-black/80 backdrop-blur text-white text-[10px] font-mono px-2 py-1 rounded border border-white/10">
                {v.length}
              </div>
            </div>

            <div className="absolute bottom-0 left-0 w-full p-6 bg-linear-to-t from-black via-black/80 to-transparent">
              <div className="text-(--neon-blue) font-mono text-xs mb-2 tracking-widest flex items-center justify-between">
                <span>{cfg.datePrefix || "DATE //"} {v.date}</span>
                <span className="text-gray-500">#{i + 1}</span>
              </div>

              <h3 className="text-xl font-bold text-white line-clamp-2 mb-2 group-hover:text-(--neon-blue) transition-colors">
                {v.title}
              </h3>

              <div className="flex items-center gap-2 text-xs text-gray-400 font-mono">
                <span className="flex items-center gap-1">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  {v.play}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

// --- 5. 导出主 Dashboard 容器 ---
export const Dashboard: React.FC<DashboardProps> = ({
  stats,
  liveStatus,
  onAvatarClick,
  avatarSrc,
  onOpenGame,
  config,
  assetVersion,
}) => (
  <div className="w-full">
    <HeroSection stats={stats} config={config} />
    <ModelBreakdown avatarSrc={avatarSrc} onAvatarClick={onAvatarClick} config={config} assetVersion={assetVersion} />
    <LiveStatusSection liveStatus={liveStatus} onOpenGame={onOpenGame} config={config} />
  </div>
);
