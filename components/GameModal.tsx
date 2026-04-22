"use client";

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import type { SiteConfig } from '@/app/admin/types';
import { Icons } from './UI';

const NameArenaGame = dynamic(
  () => import('@/components/namearena/NameArenaGame').then((m) => ({ default: m.NameArenaGame })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-50 items-center justify-center bg-black font-mono text-sm text-slate-500">
        加载名字大乱斗…
      </div>
    ),
  },
);

const DgpGame = dynamic(
  () => import('@/components/dgp/DgpGame').then((m) => ({ default: m.DgpGame })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-50 items-center justify-center bg-black font-mono text-sm text-slate-500">
        加载欲望大奖赛…
      </div>
    ),
  },
);

export interface GameModalProps {
  isOpen: boolean;
  onClose: () => void;
  config?: SiteConfig;
}

export const GameModal: React.FC<GameModalProps> = ({ isOpen, onClose, config }) => {
  const [activeGame, setActiveGame] = useState<string | null>(null);
  const gameCfg = config?.games || {};

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-10000 flex items-center justify-center p-0 md:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* 背景遮罩 */}
          <div
            className="absolute inset-0 bg-black/95 backdrop-blur-xl"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative flex h-full min-h-0 w-full flex-col overflow-hidden border border-(--neon-blue) bg-black md:h-[90vh] md:w-[95vw] md:rounded-xl rounded-none"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 z-50 text-red-500 hover:text-white transition-colors"
            >
              <Icons.X size={24} />
            </button>

            {!activeGame ? (
              // --- 游戏选择大厅 ---
              <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center p-8">
                <h2 className="text-4xl font-cyber font-bold text-white mb-2">
                  {gameCfg.lobbyTitlePrefix || "SELECT"} <span className="text-(--neon-blue)">{gameCfg.lobbyTitleSuffix || "MODULE"}</span>
                </h2>
                <p className="text-gray-500 font-mono text-sm mb-12 tracking-widest">
                  {gameCfg.lobbySubtitle || "/// PLEASE SELECT A GAME TO INITIALIZE ///"}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl">
                  {/* 名字大乱斗入口 */}
                  <div 
                    onClick={() => setActiveGame('namerena')}
                    className="group relative h-64 border-2 border-white/10 hover:border-(--neon-blue) rounded-2xl p-6 cursor-pointer overflow-hidden transition-all duration-300 bg-gray-900"
                  >
                    <div className="absolute inset-0 bg-linear-to-br from-(--neon-blue)/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="relative z-10 h-full flex flex-col justify-between">
                      <div>
                        <h3 className="text-2xl font-bold text-white mb-2 group-hover:text-(--neon-blue) transition-colors">
                          {gameCfg.arenaTitle || "名字大乱斗 V4"}
                        </h3>
                        <p className="text-gray-400 text-sm">
                          {gameCfg.arenaDesc || "输入名字，生成属性，决出最强王者。"}
                        </p>
                      </div>
                      <div className="text-(--neon-blue) font-mono text-xs flex items-center justify-between">
                        <span>{gameCfg.arenaStatus || "STATUS: ONLINE"}</span>
                        <Icons.Swords size={20} />
                      </div>
                    </div>
                  </div>

                  {/* 欲望大奖赛入口 */}
                  <div 
                    onClick={() => setActiveGame('dgp')}
                    className="group relative h-64 border-2 border-white/10 hover:border-pink-500 rounded-2xl p-6 cursor-pointer overflow-hidden transition-all duration-300 bg-gray-900"
                  >
                    <div className="absolute inset-0 bg-linear-to-br from-pink-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="relative z-10 h-full flex flex-col justify-between">
                      <div>
                        <h3 className="text-2xl font-bold text-white mb-2 group-hover:text-pink-400 transition-colors">
                          {gameCfg.dgpTitle || "欲望大奖赛 (DGP)"}
                        </h3>
                        <p className="text-gray-400 text-sm">
                          {gameCfg.dgpDesc || "基于核心硬币与欲望的生存游戏模拟器。"}
                        </p>
                      </div>
                      <div className="text-pink-400 font-mono text-xs flex items-center justify-between">
                        <span>{gameCfg.dgpStatus || "STATUS: ONLINE"}</span>
                        <Icons.Sparkles size={20} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              // --- 具体的游戏渲染区 ---
              <div className="relative flex min-h-0 flex-1 flex-col">
                <div className="z-50 flex shrink-0 justify-between border-b border-white/10 bg-gray-900 p-4">
                   <button 
                     onClick={() => setActiveGame(null)}
                     className="text-gray-400 hover:text-white flex items-center gap-2 text-sm font-bold font-tech"
                   >
                     <Icons.ArrowLeft size={16} /> {gameCfg.returnText || "RETURN TO LOBBY"}
                   </button>
                </div>
                
                <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
                    {/* 名字大乱斗：内嵌 React 模块 */}
                    {activeGame === 'namerena' && (
                        <div className="h-full w-full min-h-0">
                            <NameArenaGame />
                        </div>
                    )}
                    
                    {activeGame === 'dgp' && (
                        <div className="h-full w-full min-h-0">
                            <DgpGame />
                        </div>
                    )}
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};