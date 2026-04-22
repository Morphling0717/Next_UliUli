"use client";

/**
 * DgpGame - 欲望大奖赛 (DGP) UI 组件。
 *
 * 1:1 Ported from legacy public/js/dgp/5_app.js (原 window.DGP.App)。
 * 保留所有原始视觉、动画、交互逻辑，只做 React 18 / Next.js / TS 适配：
 * - 使用 useState / useEffect / useRef 钩子（原 UMD 从 React 全局取）
 * - 从 @/lib/dgp 引入引擎与数据模块（原 window.DGP.* 全局）
 * - 所有图标仍用内联 SVG 保持零外部依赖
 */

import React, { useEffect, useRef, useState } from 'react';

import { DgpEngine } from '@/lib/dgp/engine';
import { deepClone, escapeHtml, generateHash } from '@/lib/dgp/core';
import { ID_CORES, BUFF_ICONS } from '@/lib/dgp/data';
import type { DgpLogEntry, Player, StageDef } from '@/lib/dgp/types';

// --- 内置图标组件（脱离外部依赖） ---
type IconProps = {
  className?: string;
  size?: number;
  fill?: string;
  strokeWidth?: string;
};

const Icon: React.FC<IconProps & { d: string }> = ({
  d,
  className = '',
  size = 16,
  fill = 'none',
  strokeWidth = '2',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d={d} />
  </svg>
);

const Trophy = (p: IconProps) => (
  <Icon {...p} d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6 M18 9h1.5a2.5 2.5 0 0 0 0-5H18 M4 22h16 M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22 M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22 M18 2H6v7a6 6 0 0 0 12 0V2z" />
);
const RefreshCw = (p: IconProps) => (
  <Icon {...p} d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5" />
);
const UserPlus = (p: IconProps) => (
  <Icon {...p} d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M16 11h6 M19 8v6 M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
);
const Play = (p: IconProps) => <Icon {...p} fill="currentColor" d="M5 3l14 9-14 9V3z" />;
const Pause = (p: IconProps) => (
  <Icon {...p} fill="currentColor" d="M6 4h4v16H6z M14 4h4v16h-4z" />
);
const FastForward = (p: IconProps) => (
  <Icon {...p} fill="currentColor" d="M13 19L22 12 13 5V19Z M2 19L11 12 2 5V19Z" />
);
const AlertTriangle = (p: IconProps) => (
  <Icon {...p} d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01" />
);
const Cpu = (p: IconProps) => (
  <Icon {...p} d="M4 4h16v16H4z M9 9h6v6H9z M9 1v3 M15 1v3 M9 20v3 M15 20v3 M20 9h3 M20 14h3 M1 9h3 M1 14h3" />
);

type GamePhase = 'setup' | 'battle';

interface ActiveAction {
  actorId: string | null;
  targetIds: string[];
}

export const DgpGame: React.FC = () => {
  const [gamePhase, setGamePhase] = useState<GamePhase>('setup');
  const [draftPlayers, setDraftPlayers] = useState<Player[]>([]);
  const [newName, setNewName] = useState('');
  const [seedInput, setSeedInput] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [logs, setLogs] = useState<DgpLogEntry[]>([]);
  const [round, setRound] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState<Player | null>(null);
  const [playbackQueue, setPlaybackQueue] = useState<DgpLogEntry[]>([]);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);

  const engineRef = useRef<DgpEngine | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  const queuedLog = playbackQueue[0];
  const activeAction: ActiveAction = queuedLog
    ? {
        actorId: queuedLog.actorId ?? null,
        targetIds: queuedLog.targetIds || [],
      }
    : { actorId: null, targetIds: [] };
  const activeStageUI: StageDef | null = gameOver
    ? null
    : queuedLog
      ? queuedLog.activeStage ?? null
      : logs[logs.length - 1]?.activeStage ?? null;

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const calculateNextRound = () => {
    if (!engineRef.current) return;
    const roundLogs = engineRef.current.calculateNextRound();
    setPlaybackQueue((prev) => [...prev, ...roundLogs]);
  };

  useEffect(() => {
    if (gamePhase !== 'battle') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (playbackQueue.length > 0) {
      const currentLog = playbackQueue[0];
      const delay = currentLog.delay || 900;

      timer = setTimeout(() => {
        setLogs((prev) => [...prev, currentLog]);
        if (currentLog.snapshot) setPlayers(currentLog.snapshot);
        setRound(currentLog.round);
        if (currentLog.isGameOver) {
          setGameOver(true);
          setWinner(currentLog.winner || null);
          setIsAutoPlaying(false);
        }
        setPlaybackQueue((prev) => prev.slice(1));
      }, delay);
    } else if (isAutoPlaying && !gameOver) {
      calculateNextRound();
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
     
  }, [playbackQueue, isAutoPlaying, gameOver, gamePhase]);

  const handleAddPlayer = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = newName.trim();
    if (!trimmedName) return;
    if (draftPlayers.some((p) => p.name === trimmedName)) return;

    const nameHash = generateHash(trimmedName);
    const str = 20 + (nameHash % 81);
    const agi = 20 + ((nameHash >> 3) % 81);
    const int = 20 + ((nameHash >> 5) % 81);

    const fixedHp = 4800 + str * 64;
    const fixedAtk = 25 + Math.floor(str * 1.5 + agi * 0.5);
    const idCore = ID_CORES[nameHash % ID_CORES.length];

    setDraftPlayers([
      ...draftPlayers,
      {
        id: `rider_${nameHash}`,
        name: trimmedName,
        icon: idCore.icon,
        idCore: idCore,
        isJyamato: false,
        str,
        agi,
        int,
        baseHp: fixedHp,
        maxHp: fixedHp,
        hp: fixedHp,
        baseAtk: fixedAtk,
        atk: fixedAtk,
        buckles: [],
        status: 'alive',
        kills: 0,
        feverSlot: null,
        inventory: null,
        buffs: [],
        cooldowns: {},
        shield: 0,
        isBountyTarget: false,
      },
    ]);
    setNewName('');
  };

  const removeDraftPlayer = (id: string) =>
    setDraftPlayers(draftPlayers.filter((p) => p.id !== id));

  const startGame = () => {
    if (draftPlayers.length < 2) return;
    const normalizedSeed = seedInput.trim();
    const seed = normalizedSeed || undefined;
    const bootSeedHtml = seed
      ? `<br/><span class="text-xs text-cyan-500/90 font-mono tracking-widest">REPLAY_SEED : ${escapeHtml(normalizedSeed)}</span>`
      : '';
    const initialPlayers = deepClone(draftPlayers);
    setPlayers(initialPlayers);

    engineRef.current = new DgpEngine(initialPlayers, seed);

    setLogs([]);
    setRound(0);
    setGameOver(false);
    setWinner(null);
    setPlaybackQueue([
      {
        round: 0,
        htmlText: `<span class="text-cyan-400 font-black tracking-widest text-lg drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">【SYSTEM BOOT】 欲望大奖赛 (DGP) 核心系统已上线，假面骑士降临战场。</span>${bootSeedHtml}`,
        type: 'system',
        delay: 1500,
        snapshot: deepClone(initialPlayers),
      },
    ]);
    setIsAutoPlaying(true);
    setGamePhase('battle');
  };

  const manualNextRound = () => {
    if (playbackQueue.length === 0) calculateNextRound();
  };
  const returnToSetup = () => setGamePhase('setup');

  // --- 视觉样式增强体系 ---
  const getLogColor = (type: string) => {
    switch (type) {
      case 'system':
        return 'border-l-4 border-cyan-500 bg-cyan-950/20 text-cyan-300 font-bold shadow-[0_0_15px_rgba(34,211,238,0.1)]';
      case 'system_warning':
        return 'border-l-4 border-purple-500 bg-purple-950/20 text-purple-300 font-bold';
      case 'system_danger':
        return 'border-l-4 border-red-500 bg-red-950/30 text-red-400 font-black animate-pulse shadow-[0_0_20px_rgba(239,68,68,0.2)]';
      case 'loot_epic':
        return 'border-l-4 border-yellow-400 bg-yellow-950/30 text-yellow-300 font-black shadow-[0_0_20px_rgba(250,204,21,0.2)]';
      case 'sponsor_drop':
        return 'border-l-4 border-blue-400 bg-blue-950/20 text-blue-300 font-bold';
      case 'loot':
        return 'border-l-4 border-green-500 bg-green-950/20 text-green-400';
      case 'combat':
        return 'border-l-2 border-neutral-700 bg-neutral-900/40 text-neutral-300';
      case 'kill':
        return 'border-l-4 border-red-600 bg-red-950/60 text-red-100 font-bold shadow-[inset_0_0_20px_rgba(220,38,38,0.5)]';
      case 'kill_monster':
        return 'border-l-4 border-purple-600 bg-purple-900/40 text-purple-200 font-bold';
      default:
        return 'border-l-2 border-neutral-800 bg-neutral-900/30 text-neutral-400';
    }
  };

  const renderBuffs = (player: Player) => {
    const elements = player.buffs.map((b, i) => {
      const isDebuff = ['Poison', 'Stun', 'Vulnerable', 'Locked-on', 'Wet'].includes(b.type);
      return (
        <span
          key={i}
          className={`text-[10px] px-1.5 py-0.5 rounded-sm border mr-1 mb-1 font-mono tracking-tighter flex items-center gap-0.5
            ${
              isDebuff
                ? 'bg-red-950/60 border-red-500/50 text-red-400 shadow-[0_0_5px_rgba(239,68,68,0.3)] animate-pulse'
                : 'bg-green-950/60 border-green-500/50 text-green-400 shadow-[0_0_5px_rgba(34,197,94,0.3)]'
            }`}
        >
          {BUFF_ICONS[b.type] || b.type} <span className="opacity-70">{b.duration}T</span>
        </span>
      );
    });
    return elements.length > 0 ? <div className="flex flex-wrap mt-1.5">{elements}</div> : null;
  };

  // 重新设计的欲望驱动器视觉 (Desire Driver HUD)
  const renderDriverHUD = (player: Player) => {
    if (player.isJyamato) {
      return (
        <div className="w-full mt-2 bg-purple-950/40 border border-purple-800/50 rounded flex items-center justify-center py-1">
          <span className="text-xs font-bold text-purple-400 tracking-widest">
            {player.jyamatoTier === 'boss' ? '/// 灭世级躯体 ///' : '/// 邪魔徒素体 ///'}
          </span>
        </div>
      );
    }

    const buckles = player.buckles || [];
    const affinityId = player.idCore.affinity;

    // 1. 双重指挥特化驱动器
    if (buckles.some((b) => b.id === 'Command_Twin')) {
      const isJet = player.commandMode === 'Jet';
      return (
        <div className="mt-2 w-full">
          <div
            className={`text-[10px] mb-1 font-black flex items-center justify-center tracking-widest border rounded px-1
               ${
                 isJet
                   ? 'bg-orange-950/80 border-orange-500 text-orange-400 shadow-[0_0_10px_rgba(249,115,22,0.5)]'
                   : 'bg-cyan-950/80 border-cyan-400 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.5)]'
               }`}
          >
            {isJet ? 'JET MODE (喷气机)' : 'CANNON MODE (加农炮)'}
          </div>
          <div className="flex w-full h-7 rounded border-2 border-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.8)] overflow-hidden relative bg-black">
            <div className="flex-1 bg-linear-to-r from-orange-900/90 to-orange-800/80 flex items-center justify-center border-r border-cyan-400">
              <span className="text-[10px] font-black text-orange-300 drop-shadow-md">
                WING ANCHOR
              </span>
            </div>
            <div className="w-1.5 bg-cyan-300 animate-pulse shadow-[0_0_8px_#67e8f9]"></div>
            <div className="flex-1 bg-linear-to-l from-cyan-900/90 to-cyan-800/80 flex items-center justify-center">
              <span className="text-[10px] font-black text-cyan-300 drop-shadow-md">CANNON</span>
            </div>
          </div>
        </div>
      );
    }

    // 常规驱动器卡槽渲染
    const getSlotStyle = (buckle: Player['buckles'][number] | null) => {
      if (!buckle) return 'bg-neutral-900 border-neutral-800 text-neutral-600'; // 空槽
      if (buckle.id === 'Command_Raising')
        return 'bg-orange-950/80 border-orange-500 text-orange-400 shadow-[inset_0_0_15px_rgba(249,115,22,0.4)]';
      if (buckle.tier === 'legendary')
        return 'bg-yellow-950/80 border-yellow-500 text-yellow-400 shadow-[inset_0_0_15px_rgba(250,204,21,0.3)]';
      if (buckle.tier === 'large')
        return 'bg-red-950/60 border-red-600 text-red-400 shadow-[inset_0_0_10px_rgba(239,68,68,0.2)]';
      return 'bg-neutral-800 border-neutral-600 text-neutral-300'; // 小型带扣
    };

    const slot1 = buckles[0] || null;
    const slot2 = buckles[1] || null;
    const hasDualOn = slot1 && slot2;

    return (
      <div className="mt-2 w-full flex flex-col gap-1">
        <div className="flex w-full h-7 rounded bg-black border border-neutral-700 shadow-inner relative overflow-hidden">
          {/* 左槽 */}
          <div
            className={`flex-1 flex items-center justify-center border-r text-[10px] font-black tracking-wider transition-colors ${getSlotStyle(slot1)}`}
          >
            {slot1 ? slot1.name.toUpperCase() : 'EMPTY'}
            {slot1 && slot1.id === affinityId && (
              <span className="absolute top-0 left-0 text-[8px] bg-yellow-500 text-black px-1 rounded-br z-10">
                ✨契合
              </span>
            )}
          </div>

          {/* 驱动器核心 / 连接线 */}
          <div
            className={`w-2 flex items-center justify-center z-10 ${hasDualOn ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] animate-pulse' : 'bg-neutral-800'}`}
          ></div>

          {/* 右槽 */}
          <div
            className={`flex-1 flex items-center justify-center text-[10px] font-black tracking-wider transition-colors ${getSlotStyle(slot2)}`}
          >
            {slot2 ? slot2.name.toUpperCase() : 'EMPTY'}
            {slot2 && slot2.id === affinityId && (
              <span className="absolute top-0 right-0 text-[8px] bg-yellow-500 text-black px-1 rounded-bl z-10">
                ✨契合
              </span>
            )}
          </div>
        </div>

        {/* 外置挂载区 (Fever / 备用槽) */}
        <div className="flex justify-between w-full px-1">
          <div className="w-1/2 flex justify-start">
            {player.feverSlot && (
              <span className="text-[9px] bg-yellow-900/60 border border-yellow-500 text-yellow-300 px-1 rounded flex items-center animate-pulse shadow-[0_0_5px_rgba(250,204,21,0.5)]">
                🎰 FEVER: {player.feverSlot.name}
              </span>
            )}
          </div>
          <div className="w-1/2 flex justify-end">
            {player.inventory && (
              <span className="text-[9px] bg-neutral-800 border border-neutral-600 text-neutral-400 px-1 rounded flex items-center">
                🎒 {player.inventory.name}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="absolute inset-0 w-full h-full bg-neutral-950 text-neutral-100 font-sans flex flex-col items-center overflow-hidden selection:bg-cyan-900 selection:text-cyan-100">
      {/* 全局赛博朋克光晕背景 */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.03)_0%,transparent_100%)] pointer-events-none"></div>
      <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-cyan-500 via-purple-500 to-red-500 opacity-50"></div>

      {/* Header */}
      <div className="w-full max-w-350 flex justify-between items-center px-4 py-3 md:py-4 border-b border-neutral-800/80 shrink-0 bg-neutral-950/60 backdrop-blur-md z-30">
        <div>
          <h1 className="text-xl md:text-3xl font-black tracking-widest text-transparent bg-clip-text bg-linear-to-r from-red-500 via-orange-500 to-yellow-500 flex items-center gap-2 drop-shadow-[0_0_10px_rgba(239,68,68,0.3)]">
            <Trophy className="text-red-500" /> DESIRE GRAND PRIX
          </h1>
          <p className="text-neutral-500 text-[10px] md:text-xs mt-1 font-mono tracking-widest">
            {gamePhase === 'setup'
              ? '>>> RIDER_REGISTRATION_SYSTEM_ONLINE'
              : `>>> BATTLE_BROADCAST_LIVE_ROUND_${round}`}
          </p>
        </div>
        {gamePhase === 'battle' && (
          <button
            onClick={returnToSetup}
            className="flex items-center gap-2 px-3 py-1.5 md:px-4 md:py-2 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 rounded border border-neutral-700 transition-colors shrink-0 text-xs md:text-sm font-mono"
          >
            <Cpu size={14} /> <span className="hidden sm:inline">SYS_REBOOT</span>
          </button>
        )}
      </div>

      {/* Main Content Area */}
      <div className="w-full max-w-350 flex-1 min-h-0 flex flex-col relative z-10 px-2 md:px-4 py-3">
        {gamePhase === 'setup' ? (
          <div className="w-full max-w-4xl mx-auto flex flex-col flex-1 min-h-0 justify-center">
            <div className="bg-neutral-900/50 border border-cyan-500/30 rounded-xl p-5 md:p-8 w-full backdrop-blur-md shadow-[0_0_30px_rgba(34,211,238,0.05)] flex flex-col max-h-full">
              <h2 className="shrink-0 text-lg md:text-xl font-black mb-6 flex items-center gap-2 text-cyan-400 tracking-widest">
                <UserPlus /> 登记参赛者 (ENTRY)
              </h2>

              {/* 科技感输入框 */}
              <form onSubmit={handleAddPlayer} className="shrink-0 flex gap-3 mb-6 relative">
                <div className="absolute inset-0 bg-cyan-500/5 blur-md rounded-lg pointer-events-none"></div>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="输入假面骑士代号 [例如: GEATS]"
                  className="grow bg-black/60 border border-cyan-800 rounded-lg px-4 py-3 text-sm md:text-base font-mono text-cyan-100 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/50 transition-all placeholder:text-cyan-900"
                />
                <button
                  type="submit"
                  className="bg-cyan-600/20 hover:bg-cyan-500/40 text-cyan-300 border border-cyan-500/50 px-6 py-3 rounded-lg font-bold font-mono transition-all backdrop-blur-sm whitespace-nowrap text-sm md:text-base hover:shadow-[0_0_15px_rgba(34,211,238,0.4)]"
                >
                  [ 授权录入 ]
                </button>
              </form>

              {/* ID Core Wall (网格展示) */}
              <div className="shrink-0 mb-3 flex justify-between items-end border-b border-neutral-800 pb-2">
                <span className="text-neutral-500 text-xs font-mono tracking-widest">
                  ID_CORES_REGISTERED : {draftPlayers.length}
                </span>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-2 mb-6">
                {draftPlayers.length === 0 ? (
                  <div className="text-center text-neutral-700 py-12 border border-dashed border-neutral-800 rounded-lg h-full flex items-center justify-center font-mono text-sm tracking-widest bg-black/30">
                    WAITING_FOR_APPLICANTS...
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4 auto-rows-max">
                    {draftPlayers.map((p) => (
                      <div
                        key={p.id}
                        className="group relative bg-black/60 border border-neutral-800 hover:border-cyan-500/50 rounded-lg p-3 overflow-hidden transition-all animate-[hologram-scan_0.4s_ease-out]"
                      >
                        <div className="absolute inset-0 bg-linear-to-b from-cyan-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <div className="flex flex-col items-center z-10 relative w-full">
                          <span className="text-3xl mb-2 drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]">
                            {p.icon}
                          </span>
                          <span className="font-black text-sm text-neutral-200 tracking-wider truncate w-full text-center">
                            {p.name}
                          </span>
                          <span className="text-[9px] text-cyan-500/80 font-mono mt-1 border border-cyan-900/50 px-1 rounded bg-cyan-950/30 truncate w-full text-center">
                            ID: {p.idCore.name}
                          </span>

                          {/* 备战大厅：显示被动 */}
                          {p.idCore.passive && (
                            <span
                              className="text-[8px] text-cyan-600/80 font-mono mt-0.5 truncate w-full text-center"
                              title={p.idCore.passive}
                            >
                              {p.idCore.passive}
                            </span>
                          )}

                          <div className="w-full mt-3 pt-2 border-t border-neutral-800/80 flex justify-between text-[10px] text-neutral-500 font-mono">
                            <span>STR:{p.str}</span>
                            <span>AGI:{p.agi}</span>
                            <span>INT:{p.int}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => removeDraftPlayer(p.id)}
                          className="absolute top-1 right-1 text-neutral-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-black/50 rounded"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="shrink-0 mb-6">
                <div className="mb-2 text-neutral-500 text-[11px] font-mono tracking-widest">
                  SIMULATION_SEED : OPTIONAL
                </div>
                <input
                  type="text"
                  value={seedInput}
                  onChange={(e) => setSeedInput(e.target.value)}
                  placeholder="留空 = 非确定性；例如 DGP-S01-001"
                  className="w-full bg-black/60 border border-neutral-800 rounded-lg px-4 py-3 text-sm font-mono text-cyan-100 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/50 transition-all placeholder:text-neutral-700"
                />
                <div className="mt-2 text-[10px] text-neutral-600 font-mono tracking-wide">
                  SAME ROSTER + SAME SEED = REPRODUCIBLE MATCH
                </div>
              </div>

              <button
                onClick={startGame}
                disabled={draftPlayers.length < 2}
                className={`shrink-0 w-full py-4 rounded-lg font-black text-lg tracking-widest flex justify-center items-center gap-2 transition-all font-mono border ${draftPlayers.length < 2 ? 'bg-neutral-900 border-neutral-800 text-neutral-600 cursor-not-allowed' : 'bg-red-900/40 border-red-500 text-red-100 hover:bg-red-800/60 shadow-[0_0_20px_rgba(239,68,68,0.4)]'}`}
              >
                <Play size={20} /> INITIATE_DGP_BROADCAST
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 w-full relative">
            {/* 顶部环境监视器 (Stage UI) - Drop down Flash */}
            {activeStageUI && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[95%] md:w-full max-w-2xl z-50 animate-[slide-in-from-top_0.4s_ease-out]">
                <div
                  className={`px-4 py-2 md:py-3 rounded-b-xl border-x border-b shadow-2xl flex items-center justify-center gap-3 backdrop-blur-md relative overflow-hidden
                    ${
                      activeStageUI.type === 'safe'
                        ? 'bg-blue-950/80 border-blue-400 text-blue-100 shadow-[0_0_30px_rgba(59,130,246,0.4)]'
                        : activeStageUI.type === 'danger'
                          ? 'bg-red-950/90 border-red-500 text-red-100 shadow-[0_0_40px_rgba(239,68,68,0.6)] animate-pulse'
                          : 'bg-purple-950/80 border-purple-500 text-purple-100 shadow-[0_0_30px_rgba(168,85,247,0.5)]'
                    }`}
                >
                  <AlertTriangle
                    size={20}
                    className="shrink-0 animate-ping absolute left-4 opacity-50"
                  />
                  <AlertTriangle size={20} className="shrink-0 relative z-10" />
                  <span className="font-black tracking-widest text-xs md:text-sm truncate relative z-10">
                    AREA_ANOMALY: [{activeStageUI.name}]
                  </span>
                </div>
              </div>
            )}

            {/* 左侧/上半屏: 骑士阵列 (Rider HUD) */}
            <div className="w-full lg:w-[40%] flex flex-col min-h-0 flex-4 lg:flex-none lg:h-full bg-neutral-900/30 rounded-xl p-2 md:p-3 border border-neutral-800/60 backdrop-blur-sm relative z-20">
              <h2 className="shrink-0 text-xs md:text-sm font-mono tracking-widest font-bold flex items-center justify-between mb-2 pb-2 border-b border-neutral-800 text-neutral-400">
                <span>{'/// SURVIVOR_HUD'}</span>
                {playbackQueue.length > 0 && (
                  <span className="text-red-500 animate-pulse flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-500"></span> REC
                  </span>
                )}
              </h2>

              <div className="flex-1 min-h-0 overflow-y-auto pr-1 custom-scrollbar grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2 content-start auto-rows-max">
                {players
                  .filter((p) => !(p.isJyamato && p.status !== 'alive'))
                  .map((player) => {
                    const isActor = activeAction.actorId === player.id;
                    const isTarget = activeAction.targetIds.includes(player.id);
                    const isDead = player.status !== 'alive';

                    let cardClass = 'bg-black/50 border-neutral-800 hover:border-neutral-600';
                    if (isDead)
                      cardClass =
                        'bg-neutral-950/50 border-red-950/30 opacity-60 grayscale animate-[glitch_2.5s_infinite]';
                    else if (isActor)
                      cardClass =
                        'bg-neutral-900/80 border-cyan-500 ring-1 ring-cyan-500/50 shadow-[0_0_15px_rgba(34,211,238,0.3)] z-10 scale-[1.02] transition-transform';
                    else if (isTarget)
                      cardClass =
                        'bg-red-950/40 border-red-500 animate-[heavy-shake_0.4s_ease-in-out] shadow-[0_0_20px_rgba(239,68,68,0.4)] z-10';
                    else if (player.isJyamato) cardClass = 'bg-purple-950/20 border-purple-900/40';

                    return (
                      <div
                        key={player.id}
                        className={`p-2.5 rounded-lg border relative overflow-hidden backdrop-blur-sm flex flex-col shrink-0 h-fit ${cardClass}`}
                      >
                        {/* 死亡干扰覆盖层 */}
                        {isDead && (
                          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjMDAwIiBmaWxsLW9wYWNpdHk9IjAuMSIvPgo8cGF0aCBkPSJNMCAwdjRoNHYtNEgweiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utb3BhY2l0eT0iMC4wNSIvPgo8L3N2Zz4=')] z-20 pointer-events-none flex items-center justify-center">
                            <div className="bg-red-900/80 text-white font-black px-2 py-1 rotate-[-10deg] border-2 border-red-500 tracking-widest text-xs">
                              {player.isJyamato ? 'ELIMINATED' : 'RETIRED'}
                            </div>
                          </div>
                        )}

                        {player.isBountyTarget && !isDead && (
                          <div className="absolute top-0 right-0 bg-red-600/90 text-white font-black px-1.5 py-0.5 rounded-bl z-20 animate-pulse shadow-[0_0_10px_#dc2626] text-[9px] tracking-wider">
                            TARGET
                          </div>
                        )}

                        {/* 顶部：头像与基础信息 */}
                        <div className="flex items-start gap-2 relative z-10 w-full">
                          <div
                            className={`text-xl md:text-2xl p-1 rounded-md shrink-0 flex items-center justify-center bg-black/40 border border-neutral-800 ${isActor ? 'shadow-[0_0_10px_rgba(34,211,238,0.5)]' : ''}`}
                          >
                            {player.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3
                              className={`font-black text-sm md:text-base truncate tracking-wide ${player.isJyamato ? 'text-purple-400' : 'text-neutral-100'}`}
                            >
                              {player.name}
                            </h3>
                            {/* 战斗面板：恢复显示 ID 核心的被动技能 */}
                            {!player.isJyamato && player.idCore && player.idCore.passive && (
                              <div
                                className="text-[9px] text-cyan-400/80 font-mono mt-0.5 truncate"
                                title={player.idCore.passive}
                              >
                                <span className="opacity-60 text-cyan-600">被动:</span>{' '}
                                {player.idCore.passive}
                              </div>
                            )}
                            {renderBuffs(player)}
                          </div>
                        </div>

                        {/* 欲望驱动器 HUD */}
                        <div className="w-full relative z-10">{renderDriverHUD(player)}</div>

                        {/* 动态多层血条 (Dynamic HP Bar) */}
                        <div className="mt-2 w-full relative z-10">
                          <div className="flex justify-between text-[9px] md:text-[10px] mb-1 font-mono text-neutral-500">
                            <span>HP</span>
                            <span
                              className={
                                player.hp / player.maxHp < 0.3
                                  ? 'text-red-400 animate-pulse'
                                  : 'text-neutral-300'
                              }
                            >
                              {player.hp} / {player.maxHp}
                            </span>
                          </div>

                          {/* 护盾边框 */}
                          <div
                            className={`w-full bg-neutral-900 h-2 rounded-sm overflow-hidden relative border ${player.shield > 0 ? 'border-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.5)] p-px' : 'border-neutral-800'}`}
                          >
                            {/* 受击缓冲底色 (视觉欺骗层) */}
                            <div className="absolute top-0 left-0 h-full bg-red-600/30 w-full"></div>
                            {/* 真实血量层 */}
                            <div
                              className={`absolute top-0 left-0 h-full transition-all duration-500 ease-out rounded-sm
                                ${
                                  player.isJyamato
                                    ? 'bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.6)]'
                                    : player.hp / player.maxHp > 0.4
                                      ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.6)]'
                                      : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]'
                                }`}
                              style={{
                                width: `${Math.max(0, (player.hp / player.maxHp) * 100)}%`,
                              }}
                            ></div>
                          </div>
                          {player.shield > 0 && (
                            <div className="text-[8px] text-cyan-400 mt-0.5 font-mono text-right">
                              SHIELD: {player.shield}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* 右侧/下半屏: 战局转播流 (Live Log Panel) */}
            <div className="w-full lg:w-[60%] flex flex-col min-h-0 flex-5 lg:flex-none lg:h-full relative z-20">
              <h2 className="shrink-0 text-xs md:text-sm font-mono tracking-widest font-bold flex items-center justify-between mb-2 pb-2 border-b border-neutral-800 text-neutral-400">
                <span>{'/// LIVE_COMBAT_LOG'}</span>
              </h2>

              <div className="flex-1 min-h-0 bg-black/40 border border-neutral-800/60 rounded-xl p-3 md:p-5 overflow-y-auto custom-scrollbar shadow-inner flex flex-col gap-2 backdrop-blur-sm">
                {logs.map((log, index) => {
                  const isNewRound = index === 0 || logs[index - 1].round !== log.round;
                  const logStyle = getLogColor(log.type);

                  // 史诗级/神话级播报特化边框流光
                  const isEpic =
                    log.type === 'loot_epic' ||
                    (log.htmlText && log.htmlText.includes('GRAND VICTORY'));

                  return (
                    <React.Fragment key={index}>
                      {isNewRound && log.round > 0 && (
                        <div className="w-full my-3 md:my-4 flex items-center justify-center relative opacity-60">
                          <div className="h-px bg-linear-to-r from-transparent via-cyan-500 to-transparent w-full"></div>
                          <span className="absolute bg-neutral-950 px-3 text-cyan-500 text-[10px] font-mono tracking-widest border border-cyan-900/50 rounded-full">
                            TURN_{log.round}
                          </span>
                        </div>
                      )}

                      <div
                        className={`p-3 md:p-4 rounded-r-lg relative animate-[slide-in-from-bottom_0.3s_ease-out] font-sans text-xs md:text-sm tracking-wide leading-relaxed
                                       ${logStyle} ${isEpic ? 'before:absolute before:inset-0 before:bg-linear-to-r before:from-yellow-500/10 before:to-transparent before:pointer-events-none before:animate-pulse' : ''}`}
                      >
                        {log.htmlText ? (
                          <span dangerouslySetInnerHTML={{ __html: log.htmlText }}></span>
                        ) : (
                          log.text
                        )}
                      </div>
                    </React.Fragment>
                  );
                })}
                <div ref={logsEndRef} className="h-2 shrink-0" />

                {gameOver && winner && (
                  <div className="mt-6 md:mt-8 p-6 md:p-8 bg-black border-y-2 border-yellow-500 text-center shadow-[0_0_50px_rgba(250,204,21,0.15)] relative overflow-hidden shrink-0">
                    <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjMDAwIiBmaWxsLW9wYWNpdHk9IjAuMSIvPgo8cGF0aCBkPSJNMCAwdjRoNHYtNEgweiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utb3BhY2l0eT0iMC4wNSIvPgo8L3N2Zz4=')] opacity-30"></div>
                    <div className="text-6xl md:text-7xl mb-4 drop-shadow-[0_0_15px_rgba(255,255,255,0.4)] relative z-10 animate-bounce">
                      {winner.icon}
                    </div>
                    <h2 className="text-2xl md:text-4xl font-black text-transparent bg-clip-text bg-linear-to-r from-yellow-300 to-yellow-600 mb-2 tracking-widest relative z-10">
                      NEW WORLD CREATED
                    </h2>
                    <p className="text-neutral-400 text-sm md:text-base font-mono relative z-10">
                      WINNER: <span className="text-white font-bold">[{winner.name}]</span>
                    </p>
                  </div>
                )}
              </div>

              {/* 控制台面板 (Controls) */}
              <div className="shrink-0 mt-3 md:mt-4 flex gap-2 md:gap-3 border-t border-neutral-800 pt-3">
                {!gameOver ? (
                  <>
                    <button
                      onClick={() => setIsAutoPlaying(!isAutoPlaying)}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 md:py-4 rounded-lg font-black tracking-widest font-mono transition-all text-xs md:text-sm border
                          ${
                            isAutoPlaying
                              ? 'bg-yellow-900/30 border-yellow-600/50 text-yellow-500 hover:bg-yellow-900/50 shadow-[0_0_15px_rgba(202,138,4,0.3)]'
                              : 'bg-green-900/30 border-green-600/50 text-green-500 hover:bg-green-900/50 shadow-[0_0_15px_rgba(22,163,74,0.3)]'
                          }`}
                    >
                      {isAutoPlaying ? (
                        <>
                          <Pause size={16} /> PAUSE_STREAM
                        </>
                      ) : (
                        <>
                          <Play size={16} /> RESUME_STREAM
                        </>
                      )}
                    </button>
                    <button
                      onClick={manualNextRound}
                      disabled={isAutoPlaying || playbackQueue.length > 0}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 md:py-4 rounded-lg font-black tracking-widest font-mono transition-all text-xs md:text-sm border
                          ${
                            isAutoPlaying || playbackQueue.length > 0
                              ? 'bg-neutral-900/50 border-neutral-800 text-neutral-600 cursor-not-allowed'
                              : 'bg-neutral-800 border-neutral-600 text-neutral-300 hover:bg-neutral-700 shadow-sm'
                          }`}
                    >
                      <FastForward size={16} /> NEXT_CYCLE
                    </button>
                  </>
                ) : (
                  <button
                    onClick={returnToSetup}
                    className="w-full py-4 bg-cyan-900/30 border border-cyan-500 text-cyan-400 font-black tracking-widest font-mono rounded-lg hover:bg-cyan-900/50 transition-all shadow-[0_0_20px_rgba(34,211,238,0.3)]"
                  >
                    <RefreshCw className="inline mr-2" /> INITIALIZE_NEW_DGP
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 注入极具表现力的 CSS 动画库 */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
          .custom-scrollbar::-webkit-scrollbar { width: 4px; }
          .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(34,211,238,0.2); border-radius: 4px; }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(34,211,238,0.5); }

          @keyframes slide-in-from-top {
            0% { transform: translate(-50%, -100%); opacity: 0; }
            100% { transform: translate(-50%, 0); opacity: 1; }
          }
          @keyframes slide-in-from-bottom {
            0% { transform: translateY(10px); opacity: 0; }
            100% { transform: translateY(0); opacity: 1; }
          }
          @keyframes heavy-shake {
            0%, 100% { transform: translate(0, 0) rotate(0); }
            15%, 45%, 75% { transform: translate(-4px, -2px) rotate(-1deg); filter: contrast(1.2); }
            30%, 60%, 90% { transform: translate(4px, 2px) rotate(1deg); filter: contrast(1.2); }
          }
          @keyframes glitch {
            0% { clip-path: inset(20% 0 80% 0); transform: translate(-2px, 2px); }
            20% { clip-path: inset(60% 0 10% 0); transform: translate(2px, -2px); }
            40% { clip-path: inset(40% 0 50% 0); transform: translate(2px, 2px); }
            60% { clip-path: inset(80% 0 5% 0); transform: translate(-2px, -2px); }
            80% { clip-path: inset(10% 0 70% 0); transform: translate(2px, -2px); }
            100% { clip-path: inset(30% 0 50% 0); transform: translate(-2px, 2px); }
          }
          @keyframes hologram-scan {
            0% { opacity: 0; transform: scale(0.95) translateY(5px); filter: brightness(2) hue-rotate(90deg); }
            100% { opacity: 1; transform: scale(1) translateY(0); filter: brightness(1) hue-rotate(0); }
          }
        `,
        }}
      />
    </div>
  );
};

export default DgpGame;
