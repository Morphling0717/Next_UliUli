"use client";

import React, { useState, useEffect, useRef } from "react";
import { BattleEngine } from "@/lib/namearena/battleEngine";
import { namerenaCore } from "@/lib/namearena/core";
import { namerenaData } from "@/lib/namearena/data";
import { namerenaJobs } from "@/lib/namearena/jobs";
import { namerenaSkills } from "@/lib/namearena/skills";

type BattleLogEntry = { type: string; text: string };

/** Runtime fighter shape from legacy generator (matches original JS objects). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fighter = any;

function Icon({
  d,
  className = "",
  size = 16,
  fill = "none",
}: {
  d: string;
  className?: string;
  size?: number;
  fill?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={d} />
    </svg>
  );
}

type IconProps = Omit<React.ComponentProps<typeof Icon>, "d">;

const Icons = {
  Play: (p: IconProps) => <Icon {...p} fill="currentColor" d="M5 3l14 9-14 9V3z" />,
  RotateCcw: (p: IconProps) => <Icon {...p} d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5" />,
  Download: (p: IconProps) => (
    <Icon {...p} d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3" />
  ),
  BookOpen: (p: IconProps) => (
    <Icon {...p} d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  ),
  X: (p: IconProps) => <Icon {...p} d="M18 6L6 18 M6 6l12 12" />,
  BarChart: (p: IconProps) => <Icon {...p} d="M18 20V10 M12 20V4 M6 20v-6" />,
};

function StatusIcon({ type }: { type: string }) {
  const effect = namerenaData.STATUS_EFFECTS?.[type as keyof typeof namerenaData.STATUS_EFFECTS];
  if (!effect) return null;
  return (
    <span title={effect.desc} className="animate-pulse cursor-help text-base">
      {effect.icon}
    </span>
  );
}

export function NameArenaGame() {
    const [inputNames, setInputNames] = useState('水人\n玄凝\n小汀\n牢鳄\n兔卷卷\n屑\n刺猬人\n克蕾儿丝菲尔\n丝瓜uli\nM1A2_abrams_sep');
    const [fighters, setFighters] = useState<Fighter[]>([]);
    const [gameState, setGameState] = useState<'SETUP' | 'FIGHTING' | 'END'>('SETUP');
    const [showMvp, setShowMvp] = useState(false);

    const fullLogsRef = useRef<BattleLogEntry[]>([]);
    const [displayLogs, setDisplayLogs] = useState<BattleLogEntry[]>([]);
    const [isFullLogModalOpen, setIsFullLogModalOpen] = useState(false);
    const [logPage, setLogPage] = useState(1);
    const LOGS_PER_PAGE = 200;

    const spinalSwordRef = useRef(false);
    // Always-current fighters ref so battleStep never closes over a stale fighters value
    const fightersRef = useRef<Fighter[]>([]);
    const logsEndRef = useRef<HTMLDivElement | null>(null);
    const timerRef = useRef<number | null>(null);
    const battleSpeedRef = useRef(1500);
    const [currentSpeedLvl, setCurrentSpeedLvl] = useState(1); 
    const [isAutoScroll, setIsAutoScroll] = useState(true);

    useEffect(() => { if (isAutoScroll && gameState === 'FIGHTING') logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [displayLogs, isAutoScroll, gameState]);

    const resetGame = () => { 
        setGameState('SETUP'); 
        setDisplayLogs([]); 
        fullLogsRef.current = []; 
        fightersRef.current = [];
        setFighters([]); 
        setIsFullLogModalOpen(false);
        setShowMvp(false);
        spinalSwordRef.current = false;
        if (timerRef.current !== null) clearInterval(timerRef.current);
    };

    const getCore = () => namerenaCore;

    const addLog = (logEntry: BattleLogEntry) => {
        fullLogsRef.current.push(logEntry);
        setDisplayLogs(prev => {
            const newLogs = [...prev, logEntry];
            return newLogs.length > 100 ? newLogs.slice(-100) : newLogs; 
        });
    };

    // Synchronous log collector used inside battleStep so logs are batched with fighter state
    const pendingLogsRef = useRef<BattleLogEntry[]>([]);

    const downloadLogs = () => {
        const textContent = fullLogsRef.current.map(l => l.text).join('\n');
        const blob = new Blob([textContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `NameWar_BattleLog_${new Date().getTime()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const generateFighter = (rawInputName: string) => {
        const { SeededRNG, stringToSeed, generateUUID } = getCore();
        const JOBS = namerenaJobs as Record<string, (typeof namerenaJobs)['WARRIOR']>;
        const COLORS = namerenaData.COLORS || [];
        if (!SeededRNG) return null;

        const trimmedInput = rawInputName.trim();
        const parts = trimmedInput.split('@');
        const cleanName = parts[0].trim(); 
        const teamName = parts.length > 1 ? parts[1].trim() : null; 
        
        const seed = stringToSeed(trimmedInput);
        const rng = new SeededRNG(seed);
        const jobRng = teamName ? new SeededRNG(stringToSeed(teamName)) : rng;
        
        let jobKey = cleanName === '水人' || cleanName === '水人Morphling' ? 'SLIME' 
            : cleanName === '玄凝' ? 'HIGH_END_GAMER' 
            : cleanName === '屑' || cleanName === '屯硬币的屑' ? 'JOKE_KING' 
            : (cleanName.toLowerCase() === 'm1a2_abrams_sep' || cleanName.toLowerCase() === 'm1' || cleanName.toLowerCase() === 'arams_sep') ? 'WT_GRINDER'
            : cleanName === '刺猬人' || cleanName === '刺猬人chiray' ? 'TOKU_FAN' 
            : cleanName === '牢鳄' || cleanName === '鳄霸' ? 'GACHA_ADDICT' 
            : cleanName === '小汀' || cleanName === '小汀公本' ? 'RED_FURY_SAMURAI' 
            : cleanName === '克蕾儿丝菲尔' ? 'SUCCUBUS' 
            : cleanName === '丝瓜uli' || cleanName === '丝瓜' ? 'VIRTUAL_DIVA' 
            : cleanName === '兔卷卷' || cleanName === '兔卷卷curly' ? 'Q_BUNNY'
            : rng.next() < 0.02
              ? 'ONE_PUNCH'
              : rng.next() < 0.05
                ? 'HERO'
                : jobRng.pick(['WARRIOR', 'MAGE', 'ARCHER', 'PRIEST']) ?? 'WARRIOR';

        const resolvedJobKey = jobKey ?? 'WARRIOR';
        const job = (JOBS[resolvedJobKey] ?? JOBS['WARRIOR'])!;
        const isMorphling = resolvedJobKey === 'SLIME';
        const baseHp = rng.nextInt(200, 300);
        const finalStats: Record<string, number> = {};
        ['atk', 'def', 'spd', 'agl', 'mag', 'res', 'wis'].forEach(
            (k) =>
                (finalStats[k] = Math.floor(
                    rng.nextInt(10, 30) *
                        ((job as unknown as Record<string, number>)[k] || 1.0) *
                        (isMorphling ? 0.8 : 1.0),
                )),
        );

        return {
            id: generateUUID ? generateUUID() : `id-${Math.random()}`, 
            name: cleanName, displayName: trimmedInput, teamId: teamName, 
            job: resolvedJobKey, jobData: JSON.parse(JSON.stringify(job)),
            maxHp: Math.floor(baseHp * (job.hp || 1) * (isMorphling ? 0.8 : 1.0)), currentHp: Math.floor(baseHp * (job.hp || 1) * (isMorphling ? 0.8 : 1.0)), hpPct: 1.0,
            ...finalStats, critRate: rng.next() * 0.1 + 0.05, 
            color: COLORS.length > 0 ? (teamName ? jobRng.pick(COLORS) : rng.pick(COLORS)) : 'text-gray-500', 
            isDead: false, isDeadAnnounced: false, status: [], 
            stats: { kills: 0, dmgDealt: 0, dmgTaken: 0 },
            isMorphling,
            isGamer: resolvedJobKey === 'HIGH_END_GAMER',
            isJoker: resolvedJobKey === 'JOKE_KING',
            isTokusatsu: resolvedJobKey === 'TOKU_FAN',
            isGacha: resolvedJobKey === 'GACHA_ADDICT',
            isTing: resolvedJobKey === 'RED_FURY_SAMURAI',
            isSuccubus: resolvedJobKey === 'SUCCUBUS',
            isSigua: resolvedJobKey === 'VIRTUAL_DIVA',
            isTuJuanJuan: resolvedJobKey === 'Q_BUNNY',
            isWT: resolvedJobKey === 'WT_GRINDER',
            transformed: false, resurrected: false, isSon: false, summonerId: null, isSummon: false, counterUsed: false, monsterTurns: 0, reviveTurns: 0, hasResurrected: false, hasDroppedSword: false, spinalSwordTurns: 0, hasSpinalSword: false, puppetId: null, hasSummonedPuppet: false, ultPoints: 0, economy: 0,
            hasTriggeredSlacking: false,
            isActing: false, isHit: false
        };
    };

    const battleStep = () => {
        // Collect logs synchronously during the step so we can batch them with fighter state
        pendingLogsRef.current = [];
        const batchedLog = (logEntry: BattleLogEntry) => {
            fullLogsRef.current.push(logEntry);
            pendingLogsRef.current.push(logEntry);
        };

        const clonedFighters = fightersRef.current.map(f => ({
            ...f,
            jobData: f.jobData ? JSON.parse(JSON.stringify(f.jobData)) : {},
            status: f.status.map((s: { type: string; duration?: number }) => ({ ...s })),
            stats: { ...f.stats }
        }));

        const engine = new BattleEngine(
            clonedFighters, batchedLog,
            namerenaJobs, namerenaSkills, namerenaData, getCore()
        );

        let isEnd = false;
        let nextFighters: Fighter[] = fightersRef.current;
        try {
            isEnd = engine.step(spinalSwordRef);
            nextFighters = engine.fighters;
        } catch (error) {
            console.error("Game Loop Error:", error);
            const msg = error instanceof Error ? error.message : String(error);
            batchedLog({ type: 'death', text: `⚠️ 战斗系统崩溃: ${msg} (代码已停止)` });
            isEnd = true;
        }

        // Update ref immediately so the next tick always sees fresh data
        fightersRef.current = nextFighters;

        // setFighters + setDisplayLogs are called in the same timer tick.
        // React 18 batches them into a single render so cards and logs always update together.
        setFighters([...nextFighters]);
        const logsSnapshot = pendingLogsRef.current;
        if (logsSnapshot.length > 0) {
            setDisplayLogs(prev => {
                const newLogs = [...prev, ...logsSnapshot];
                return newLogs.length > 100 ? newLogs.slice(-100) : newLogs;
            });
        }

        if (isEnd) {
            setGameState('END');
            if (timerRef.current !== null) clearInterval(timerRef.current);
        }
    };

    useEffect(() => {
        if (gameState === 'FIGHTING')
                timerRef.current = window.setInterval(battleStep, battleSpeedRef.current);
            else if (timerRef.current !== null) clearInterval(timerRef.current);
            return () => {
                if (timerRef.current !== null) clearInterval(timerRef.current);
            };
    }, [gameState]);

    const changeSpeed = (spd: number) => {
        battleSpeedRef.current = spd;
        setCurrentSpeedLvl(spd === 1500 ? 1 : spd === 500 ? 2 : 3);
            if (gameState === 'FIGHTING') {
                if (timerRef.current !== null) clearInterval(timerRef.current);
                timerRef.current = window.setInterval(battleStep, spd);
            }
    };

    const names = fighters.map(f => f.name).filter(n => n.length > 0).sort((a,b) => b.length - a.length);
    const nameRegex = names.length > 0 ? new RegExp(`(${names.map(n => n.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')).join('|')})`, 'g') : null;

        const renderLogText = (l: BattleLogEntry, i: number) => {
        const parts = nameRegex ? l.text.split(nameRegex) : [l.text];
        
            const tagMap: Record<string, { label: string; bg: string }> = {
                crit:   { label: '暴击', bg: 'bg-yellow-600' },
                death:  { label: '击杀', bg: 'bg-red-600' },
                win:    { label: '高光', bg: 'bg-indigo-600' }, 
                heal:   { label: '恢复', bg: 'bg-emerald-600' },
                buff:   { label: '增益', bg: 'bg-cyan-600' },
                skill:  { label: '技能', bg: 'bg-blue-600' },
                poison: { label: '异常', bg: 'bg-purple-600' },
                info:   { label: '提示', bg: 'bg-slate-600' },
                system: { label: '系统', bg: 'bg-slate-500' }
            };
        const tag = tagMap[l.type] || tagMap['info'];

        if (l.type === 'win') {
            return (
                <div key={i} className="my-5 py-5 px-3 text-center rounded-xl bg-gradient-to-r from-indigo-900/60 via-purple-900/80 to-indigo-900/60 border border-purple-500/50 shadow-[0_0_20px_rgba(168,85,247,0.4)] relative overflow-hidden animate-log-entry animate-pulse-slow z-10">
                    <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjEpIi8+PC9zdmc+')] opacity-50"></div>
                    <span className="relative z-10 block text-base md:text-xl font-black leading-relaxed tracking-wide text-white drop-shadow-md">
                        {parts.map((part, idx) => {
                            if (names.includes(part)) {
                                const f = fighters.find(x => x.name === part);
                                const fColorClass = f ? f.color.split(' ')[0].replace('from-', 'text-') : 'text-white';
                                return (
                                    <strong key={idx} className={`font-black ${fColorClass} text-xl md:text-2xl bg-slate-950/80 px-2.5 py-1 rounded-lg mx-1 tracking-widest shadow-[0_4px_10px_rgba(0,0,0,0.5)] border border-slate-600/50 inline-block transform hover:scale-105 transition-transform`}>
                                        {part}
                                    </strong>
                                );
                            }
                            return <span key={idx} className="text-purple-100">{part}</span>;
                        })}
                    </span>
                </div>
            );
        }

        let colorClass = 'text-slate-200'; 
        if (l.type === 'crit') colorClass = 'text-yellow-400 font-bold';
        if (l.type === 'death') colorClass = 'text-red-400 font-bold';
        if (l.type === 'heal') colorClass = 'text-emerald-400';
        if (l.type === 'buff') colorClass = 'text-cyan-400';

        return (
            <div key={i} className={`mb-2 leading-relaxed text-sm animate-log-entry ${colorClass} bg-slate-900/40 p-2.5 rounded-lg border border-slate-800/50 hover:bg-slate-800/80 transition-colors shadow-sm`}>
                <span className={`inline-block w-[36px] text-center px-1 py-0.5 rounded text-[11px] font-black text-white mr-2.5 align-middle shadow-sm ${tag.bg}`}>
                    {tag.label}
                </span>
                <span className="align-middle">
                    {parts.map((part, idx) => {
                        if (names.includes(part)) {
                            const f = fighters.find(x => x.name === part);
                            const fColorClass = f ? f.color.split(' ')[0].replace('from-', 'text-') : 'text-white';
                            return (
                                <strong key={idx} className={`font-black ${fColorClass} bg-slate-950/80 px-1.5 py-0.5 rounded mx-0.5 tracking-wide shadow-sm border border-slate-700/50`}>
                                    {part}
                                </strong>
                            );
                        }
                        return <span key={idx}>{part}</span>;
                    })}
                </span>
            </div>
        );
    };

    const renderMVP = () => {
        const validFighters = fighters.filter(f => !f.isSummon || f.stats.dmgDealt > 0);
        const sortedByDmg = [...validFighters].sort((a, b) => b.stats.dmgDealt - a.stats.dmgDealt);
        const maxDmg = Math.max(1, sortedByDmg[0]?.stats.dmgDealt || 1);
        
        const mvpDmg = sortedByDmg[0];
        const mvpTank = [...validFighters].sort((a, b) => b.stats.dmgTaken - a.stats.dmgTaken)[0];
        const mvpKills = [...validFighters].sort((a, b) => b.stats.kills - a.stats.kills)[0];

        return (
            <div className="absolute inset-0 z-30 flex min-h-0 flex-col overflow-y-auto bg-slate-900 p-4 md:p-6 animate-fade-in custom-scrollbar">
                <div className="flex justify-between items-center mb-6 shrink-0">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">📊 赛后结算面板</h2>
                    <button onClick={() => setShowMvp(false)} className="text-slate-400 hover:text-white p-2 bg-slate-800 rounded-full hover:bg-slate-700 transition"><Icons.X size={20}/></button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 shrink-0">
                    <div className="bg-slate-800 p-5 rounded-2xl border border-slate-700 flex flex-col items-center shadow-xl relative overflow-hidden">
                        <div className="absolute top-0 w-full h-1 bg-gradient-to-r from-red-500 to-orange-500"></div>
                        <span className="text-sm text-slate-400 mb-2 font-bold tracking-widest">⚔️ 输出 MVP</span>
                        <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${mvpDmg?.color || 'bg-slate-600'} flex items-center justify-center text-3xl mb-3 shadow-lg border-2 border-slate-800`}>{mvpDmg?.jobData?.icon || '❓'}</div>
                        <span className="font-black text-lg text-white mb-1">{mvpDmg?.name || '-'}</span>
                        <span className="text-orange-400 font-mono font-bold">{mvpDmg?.stats.dmgDealt.toLocaleString() || 0} 伤害</span>
                    </div>
                    <div className="bg-slate-800 p-5 rounded-2xl border border-slate-700 flex flex-col items-center shadow-xl relative overflow-hidden">
                        <div className="absolute top-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-teal-400"></div>
                        <span className="text-sm text-slate-400 mb-2 font-bold tracking-widest">🛡️ 承伤 MVP</span>
                        <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${mvpTank?.color || 'bg-slate-600'} flex items-center justify-center text-3xl mb-3 shadow-lg border-2 border-slate-800`}>{mvpTank?.jobData?.icon || '❓'}</div>
                        <span className="font-black text-lg text-white mb-1">{mvpTank?.name || '-'}</span>
                        <span className="text-emerald-400 font-mono font-bold">{mvpTank?.stats.dmgTaken.toLocaleString() || 0} 承伤</span>
                    </div>
                    <div className="bg-slate-800 p-5 rounded-2xl border border-slate-700 flex flex-col items-center shadow-xl relative overflow-hidden">
                        <div className="absolute top-0 w-full h-1 bg-gradient-to-r from-purple-500 to-pink-500"></div>
                        <span className="text-sm text-slate-400 mb-2 font-bold tracking-widest">☠️ 击杀王</span>
                        <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${mvpKills?.color || 'bg-slate-600'} flex items-center justify-center text-3xl mb-3 shadow-lg border-2 border-slate-800`}>{mvpKills?.jobData?.icon || '❓'}</div>
                        <span className="font-black text-lg text-white mb-1">{mvpKills?.name || '-'}</span>
                        <span className="text-pink-400 font-mono font-bold">{mvpKills?.stats.kills || 0} 击杀</span>
                    </div>
                </div>

                <h3 className="text-lg font-bold text-white mb-4 shrink-0">📈 队伍输出统计</h3>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border border-slate-700/50 bg-slate-800/50 p-4 custom-scrollbar">
                    {sortedByDmg.map(f => (
                        <div key={f.id} className="flex items-center gap-3">
                            <span className="w-24 truncate text-sm text-slate-300 text-right font-bold">{f.name}</span>
                            <div className="flex-1 h-6 bg-slate-900 rounded-lg overflow-hidden relative border border-slate-800 shadow-inner">
                                <div className={`h-full bg-gradient-to-r ${f.color} transition-all duration-1000 ease-out`} style={{ width: `${(f.stats.dmgDealt / maxDmg) * 100}%` }}></div>
                                <span className="absolute inset-0 flex items-center px-3 text-xs font-mono font-bold text-white mix-blend-difference drop-shadow-md">
                                    {f.stats.dmgDealt.toLocaleString()}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-950 font-sans text-slate-200">
            <header className="bg-slate-900 border-b border-slate-800 p-3 pr-16 shrink-0 flex justify-between items-center shadow-lg z-20">
                <h1 className="text-xl font-black bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-500">
                    名字大乱斗 <span className="text-[10px] text-slate-500 border border-slate-700 px-1 rounded align-top">NameWar</span>
                </h1>
                <div className="flex items-center gap-2">
                    {gameState === 'FIGHTING' && (
                        <div className="flex bg-slate-800 rounded-lg p-0.5 gap-1 shadow-inner border border-slate-700/50">
                            <button onClick={() => changeSpeed(1500)} className={`px-2 py-1 text-xs rounded font-mono transition-colors ${currentSpeedLvl===1 ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>x1</button>
                            <button onClick={() => changeSpeed(500)} className={`px-2 py-1 text-xs rounded font-mono transition-colors ${currentSpeedLvl===2 ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>x2</button>
                            <button onClick={() => changeSpeed(50)} className={`px-2 py-1 text-xs rounded font-mono transition-colors ${currentSpeedLvl===3 ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>x3</button>
                        </div>
                    )}
                    {gameState === 'END' && !showMvp && (
                        <button onClick={() => setShowMvp(true)} className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 px-3 py-1.5 rounded-lg text-xs font-bold text-white flex items-center gap-1 shadow-lg transition-transform hover:scale-105" title="赛后结算">
                            <Icons.BarChart size={14}/> <span className="hidden sm:inline">数据统计</span>
                        </button>
                    )}
                </div>
            </header>

            <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
                {gameState === 'SETUP' ? (
                    <div className="w-full h-full overflow-y-auto bg-slate-950/50">
                        <div className="min-h-full flex items-center justify-center p-4 md:p-6">
                            <div className="bg-slate-900 border border-slate-700 p-6 md:p-8 rounded-2xl max-w-2xl w-full shadow-2xl relative z-10 my-auto">
                                <h2 className="text-3xl font-bold text-center mb-4 text-white">名字大乱斗 NameWar</h2>
                                <p className="text-center text-slate-400 text-sm mb-6">
                                    输入名字开始混战（支持组队：名字@战队名）。<br/>
                                    特殊彩蛋：<span className="text-indigo-400">水人</span>、<span className="text-indigo-400">玄凝</span>、
                                    <span className="text-cyan-400">屑</span>、
                                    <span className="text-emerald-400">刺猬人</span>、<span className="text-pink-400">牢鳄</span>、
                                    <span className="text-red-500">小汀</span>、<span className="text-purple-400">克蕾儿丝菲尔</span>、
                                    <span className="text-teal-400">丝瓜uli</span>、<span className="text-pink-400 font-bold">兔卷卷</span>、<span className="text-yellow-500 font-bold">M1</span>
                                </p>
                                <textarea value={inputNames} onChange={(e) => setInputNames(e.target.value)} className="w-full h-32 md:h-48 bg-slate-950 border border-slate-800 rounded-xl p-4 text-slate-300 focus:ring-indigo-500 outline-none font-mono text-sm md:text-base shadow-inner" />
                                <button onClick={() => {
                                    const { SeededRNG } = getCore();
                                    if (!SeededRNG) return alert("核心组件未加载，请检查 1_core.js");
                                    const list = inputNames.split('\n').filter(n=>n.trim());
                                    if(list.length<2) return alert("至少2人");
                                    const f = list.map(generateFighter).filter(x => x !== null);
                                    if (f.length < list.length) return alert("部分角色生成失败，请检查控制台");
                                    
                    fullLogsRef.current = []; setDisplayLogs([]);
                    fightersRef.current = f;
                    setFighters(f); addLog({type:'system', text:'⚔️ 战斗开始！'}); 
                    setGameState('FIGHTING'); spinalSwordRef.current = false; changeSpeed(1500);
                                }} className="mt-6 w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-transform hover:scale-[1.02] active:scale-95 shadow-lg">
                                    <Icons.Play size={20} /> 开始战斗
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        <section className="relative flex min-h-0 min-w-0 flex-1 flex-col border-slate-800 bg-slate-900/30 lg:border-r">
                            <div className="z-10 flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/50 p-3 shadow-sm backdrop-blur">
                                <span className="text-sm font-bold tracking-wide">存活人数: <span className="text-indigo-400">{fighters.filter(f=>!f.isDead).length}</span></span>
                                {(gameState === 'FIGHTING' || gameState === 'END') && (
                                    <button onClick={resetGame} className="bg-red-600/80 hover:bg-red-500 px-3 py-1.5 rounded-lg text-xs font-bold text-white flex items-center gap-1 transition-colors shadow-md" title="重开一局">
                                        <Icons.RotateCcw size={14}/> <span className="hidden sm:inline">重置大厅</span>
                                    </button>
                                )}
                            </div>
                            <div className="relative min-h-0 flex-1 overflow-hidden">
                                <div className="grid h-full min-h-0 auto-rows-max grid-cols-1 content-start items-start gap-4 overflow-y-auto p-4 md:grid-cols-2 custom-scrollbar">
                                {[...fighters].sort((a, b) => b.currentHp - a.currentHp).map((f) => (
                                    <div
                                        key={f.id}
                                        className={`min-w-0 max-w-full rounded-2xl border p-3 transition-[transform,box-shadow,border-color,background-color] duration-300 
                                        ${f.isActing ? 'z-10 scale-[1.02] border-indigo-400 bg-slate-800 shadow-[0_0_20px_rgba(99,102,241,0.4)]' : 'border-slate-700 bg-slate-800/80'} 
                                        ${f.isHit ? 'animate-shake border-red-500/50 bg-red-900/30' : ''} 
                                        ${f.isDead ? 'scale-95 border-slate-800 bg-slate-900 opacity-40 grayscale-[0.8]' : 'shadow-md'}`}
                                    >
                                        <div className="flex gap-3 mb-2 relative">
                                            <div className="absolute right-0 top-0 flex max-w-[55%] flex-wrap justify-end gap-1">{f.status.map((s: { type: string; duration?: number }, i: number) => (
                                            <StatusIcon key={`${f.id}-${s.type}-${i}`} type={s.type} />
                                        ))}</div>
                                            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center text-2xl shrink-0 shadow-inner border border-white/10`}>{f.jobData?.icon || '❓'}</div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-end mb-1">
                                                    <span className="font-bold truncate text-sm md:text-base">
                                                        {f.name}
                                                        {f.teamId && <span className="text-[10px] ml-1.5 bg-slate-700 px-1.5 py-0.5 rounded text-slate-300 hidden sm:inline-block border border-slate-600 shadow-sm">@{f.teamId}</span>}
                                                    </span>
                                                    <span className="text-xs font-mono font-bold text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded shadow-inner">{f.currentHp}/{f.maxHp}</span>
                                                </div>
                                                <div className="text-xs text-indigo-300 font-bold mb-1.5">{f.jobData?.name || '未知'}</div>
                                                <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800 shadow-inner">
                                                    <div className={`h-full transition-all duration-300 ease-out ${f.hpPct<0.3?'bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.8)]':'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.8)]'}`} style={{width:`${f.hpPct*100}%`}}/>
                                                </div>
                                            </div>
                                        </div>
                                        {!f.isDead && (
                                            <div className="grid grid-cols-4 gap-1 text-[10px] text-slate-400 text-center bg-slate-900 p-1.5 rounded-lg leading-tight shadow-inner font-mono font-bold">
                                                <span title="攻击">🗡️{f.atk}</span><span title="防御">🛡️{f.def}</span><span title="魔力">🔮{f.mag}</span><span title="魔抗">💠{f.res}</span>
                                                <span title="速度">⚡{f.spd}</span><span title="敏捷">🦶{f.agl}</span><span title="智力">🧠{f.wis}</span><span title="击杀" className="text-red-400">☠️{f.stats.kills}</span>
                                            </div>
                                        )}
                                    </div>
                                ))}
                                </div>
                                {showMvp ? renderMVP() : null}
                            </div>
                        </section>
                        
                        <section className="relative flex min-h-0 min-w-0 flex-1 flex-col border-t border-slate-800 bg-slate-950 shadow-[inset_10px_0_20px_rgba(0,0,0,0.2)] max-h-[42vh] lg:max-h-none lg:border-l lg:border-t-0">
                            <div className="z-10 flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/80 p-3 shadow-sm backdrop-blur">
                                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">实时战斗记录 <span className="text-slate-500 normal-case tracking-normal">(显示末尾百条)</span></span>
                                {gameState === 'END' ? (
                                    <div className="flex gap-2">
                                        <button onClick={() => { setLogPage(1); setIsFullLogModalOpen(true); }} className="text-xs bg-indigo-600/80 hover:bg-indigo-500 text-white px-2 py-1.5 rounded flex items-center gap-1 font-bold shadow-sm transition">
                                            <Icons.BookOpen size={12}/> 战报回放
                                        </button>
                                        <button onClick={downloadLogs} className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-2 py-1.5 rounded flex items-center gap-1 font-bold shadow-sm transition">
                                            <Icons.Download size={12}/> 导出 TXT
                                        </button>
                                    </div>
                                ) : (
                                    <button onClick={()=>setIsAutoScroll(!isAutoScroll)} className={`text-[10px] font-bold px-2 py-1 rounded transition-colors ${isAutoScroll ? 'bg-indigo-900/50 text-indigo-300' : 'bg-slate-800 text-slate-500'}`}>
                                        {isAutoScroll ? '自动滚动' : '暂停滚动'}
                                    </button>
                                )}
                            </div>
                            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-950 p-4 font-mono text-sm custom-scrollbar">
                                {displayLogs.map(renderLogText)}
                                <div ref={logsEndRef} className="h-4" />
                            </div>
                        </section>

                        {isFullLogModalOpen && (
                            <div className="absolute inset-0 z-50 flex min-h-0 flex-col bg-slate-950/95 backdrop-blur-sm animate-fade-in">
                                <div className="flex shrink-0 justify-between border-b border-slate-800 bg-slate-900 p-4 shadow-md">
                                    <div className="flex items-center gap-3">
                                        <h3 className="font-bold text-lg text-white flex items-center gap-2"><Icons.BookOpen size={20} className="text-indigo-400"/> 完整战报复盘</h3>
                                        <span className="text-xs font-mono font-bold text-slate-400 bg-slate-800 px-2 py-1 rounded shadow-inner">共 {fullLogsRef.current.length} 个动作片段</span>
                                    </div>
                                    <button onClick={() => setIsFullLogModalOpen(false)} className="text-slate-400 hover:text-white p-2 hover:bg-slate-800 rounded-full transition"><Icons.X size={24}/></button>
                                </div>
                                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-950/80 p-6 font-mono text-base shadow-inner custom-scrollbar">
                                    {fullLogsRef.current.slice((logPage-1)*LOGS_PER_PAGE, logPage*LOGS_PER_PAGE).map(renderLogText)}
                                </div>
                                <div className="flex shrink-0 justify-center gap-6 border-t border-slate-800 bg-slate-900 p-4 shadow-[0_-10px_20px_rgba(0,0,0,0.2)]">
                                    <button disabled={logPage <= 1} onClick={() => setLogPage(p=>p-1)} className="px-6 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg text-sm font-bold text-slate-300 transition shadow-sm border border-slate-700">上一页</button>
                                    <span className="text-sm font-mono font-bold text-slate-400 bg-slate-950 px-4 py-1.5 rounded-lg shadow-inner border border-slate-800">
                                        Page <span className="text-indigo-400">{logPage}</span> / {Math.ceil(fullLogsRef.current.length / LOGS_PER_PAGE)}
                                    </span>
                                    <button disabled={logPage >= Math.ceil(fullLogsRef.current.length / LOGS_PER_PAGE)} onClick={() => setLogPage(p=>p+1)} className="px-6 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg text-sm font-bold text-slate-300 transition shadow-sm border border-slate-700">下一页</button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </main>
            <style>{`
                .custom-scrollbar { scrollbar-width: thin; scrollbar-color: #334155 #020617; }
                .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: #020617; border-radius: 4px; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #475569; }
                
                @keyframes shake {
                    0%, 100% { transform: translateX(0) scale(1.02); }
                    25% { transform: translateX(-4px) rotate(-1deg) scale(1.02); }
                    75% { transform: translateX(4px) rotate(1deg) scale(1.02); }
                }
                .animate-shake {
                    animation: shake 0.3s cubic-bezier(.36,.07,.19,.97) both;
                }
                @keyframes fade-in {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .animate-fade-in {
                    animation: fade-in 0.3s ease-out forwards;
                }

                @keyframes pulse-slow {
                    0%, 100% { box-shadow: 0 0 15px rgba(139, 92, 246, 0.3); }
                    50% { box-shadow: 0 0 35px rgba(139, 92, 246, 0.7); }
                }
                .animate-pulse-slow {
                    animation: pulse-slow 2s infinite ease-in-out;
                }

                @keyframes slide-in-right {
                    from { transform: translateX(20px); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                .animate-log-entry {
                    animation: slide-in-right 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
                }
            `}</style>
        </div>
    );
}
