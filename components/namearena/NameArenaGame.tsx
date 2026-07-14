"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  NameArenaBattleStage,
  type NameArenaStageBadge,
} from "@/components/namearena/NameArenaBattleStage";
import { BattleEngine } from "@/lib/namearena/battleEngine";
import { cloneFighters, isWinningCombatant } from "@/lib/namearena/combatState";
import { namerenaCore } from "@/lib/namearena/core";
import { namerenaData } from "@/lib/namearena/data";
import { getDefenseStatusDisplayName } from "@/lib/namearena/defenseStatus";
import { generateNameArenaFighter } from "@/lib/namearena/fighterFactory";
import { namerenaJobs } from "@/lib/namearena/jobs";
import { hasPuruisaishiAppeared, spawnPuruisaishiEvent } from "@/lib/namearena/puruisaishiMechanics";
import { parseNameArenaSetupInput } from "@/lib/namearena/setupInput";
import { namerenaSkills } from "@/lib/namearena/skills";
import { statusDurationText } from "@/lib/namearena/statusLifecycle";
import {
  cloneBattleState,
  createBattleState,
  getLargeRoundProgress,
  withBattleRandom,
} from "@/lib/namearena/battleState";
import type {
  BattleEvent,
  BattleLogEntry as EngineBattleLogEntry,
  BattleState,
  Fighter,
  StatusEffectInfo,
  StatusEntry,
} from "@/lib/namearena/types";

type BattleLogEntry = Pick<EngineBattleLogEntry, 'type' | 'text'> & Partial<Omit<EngineBattleLogEntry, 'type' | 'text'>>;
type BattlePlaybackItem = {
  log: BattleLogEntry;
  fighters: Fighter[];
  turnCount: number;
  battleState: BattleState;
};
type SettlementStats = {
  dmgDealt: number;
  dmgTaken: number;
  kills: number;
};
type SettlementContribution = {
  name: string;
  stats: SettlementStats;
};
type SettlementRow = {
  id: string;
  fighter: Fighter;
  name: string;
  color: string;
  icon: string;
  stats: SettlementStats;
  summonStats: SettlementStats;
  summonContributions: SettlementContribution[];
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DISPLAY_LOG_LIMIT = 240;
const LOG_PLAYBACK_PROFILE_BY_SPEED: Record<number, {
  base: number;
  charMs: number;
  maxTextExtra: number;
  minDeath: number;
  minLong: number;
  minHighlight: number;
  minTransform: number;
  minFinisher: number;
  minSummon: number;
}> = {
  1500: { base: 2400, charMs: 28, maxTextExtra: 3600, minDeath: 3600, minLong: 4500, minHighlight: 5600, minTransform: 3400, minFinisher: 2100, minSummon: 4550 },
  500: { base: 1100, charMs: 12, maxTextExtra: 1500, minDeath: 1700, minLong: 2100, minHighlight: 2800, minTransform: 3400, minFinisher: 2100, minSummon: 4550 },
  50: { base: 260, charMs: 3, maxTextExtra: 320, minDeath: 480, minLong: 620, minHighlight: 800, minTransform: 3400, minFinisher: 2100, minSummon: 4550 },
};

const isFormTransitionLog = (log: BattleLogEntry) => log.visualCue?.kind === 'transformation';

const isTransformLog = (log: BattleLogEntry) =>
  isFormTransitionLog(log);

const isCinematicLog = (log: BattleLogEntry) =>
  log.presentation === 'finisher' || log.visualCue?.kind === 'summon_card';

const isHighlightLog = (log: BattleLogEntry) =>
  log.type === 'win' ||
  isTransformLog(log) ||
  /最终胜者|浴火重生|并没有死|从地狱归来|不甘倒下|欧皇护符|大保底启动|小保底启动|欧皇时刻|究极进化|人设时钟|光速切片|时间轴回拨|帝皇不可阻挡|摸鱼伙伴羁绊|突发状况|脊髓剑|GREAT！MONSTER|GREAT MONSTER|彩虹狂热|GOTCHARD|飓刃】收割|宇宙分裂|复活】|弑神反噬|大招充能完毕|资金充足|冥驹|武神王座|谢幕返场|乘员昏迷|普瑞赛斯|阿喃那|矿石病/.test(log.text);

const getLogPlaybackDelay = (log: BattleLogEntry, speed: number) => {
  const profile = LOG_PLAYBACK_PROFILE_BY_SPEED[speed] ?? LOG_PLAYBACK_PROFILE_BY_SPEED[500];
  const textLength = log.text.replace(/\s+/g, '').length;
  const textExtra = Math.min(profile.maxTextExtra, textLength * profile.charMs);
  let delay = profile.base + textExtra;
  if (log.text.includes('\n')) delay = Math.max(delay, profile.minLong);
  if (log.type === 'death') delay = Math.max(delay, profile.minDeath);
  if (isHighlightLog(log)) delay = Math.max(delay, profile.minHighlight);
  if (isFormTransitionLog(log)) delay = Math.max(delay, profile.minTransform);
  if (isCinematicLog(log)) delay = Math.max(delay, profile.minFinisher);
  if (log.visualCue?.kind === 'summon_card') delay = Math.max(delay, profile.minSummon);
  return delay;
};

const emptySettlementStats = (): SettlementStats => ({ dmgDealt: 0, dmgTaken: 0, kills: 0 });

const copySettlementStats = (fighter: Fighter): SettlementStats => ({
  dmgDealt: fighter.stats.dmgDealt,
  dmgTaken: fighter.stats.dmgTaken,
  kills: fighter.stats.kills,
});

const addSettlementStats = (target: SettlementStats, source: SettlementStats) => {
  target.dmgDealt += source.dmgDealt;
  target.dmgTaken += source.dmgTaken;
  target.kills += source.kills;
};

const hasSettlementContribution = (stats: SettlementStats) =>
  stats.dmgDealt > 0 || stats.dmgTaken > 0 || stats.kills > 0;

const buildSettlementRows = (fighters: Fighter[]): SettlementRow[] => {
  const rowsById = new Map<string, SettlementRow>();
  const rows: SettlementRow[] = [];

  fighters.forEach((fighter) => {
    if (fighter.isSummon || fighter.isNpc) return;
    const row: SettlementRow = {
      id: fighter.id,
      fighter,
      name: fighter.name,
      color: fighter.color,
      icon: fighter.jobData?.icon || '❓',
      stats: copySettlementStats(fighter),
      summonStats: emptySettlementStats(),
      summonContributions: [],
    };
    rowsById.set(fighter.id, row);
    rows.push(row);
  });

  fighters.forEach((fighter) => {
    if (!fighter.isSummon || fighter.isNpc) return;
    const stats = copySettlementStats(fighter);
    const summonerRow = fighter.summonerId ? rowsById.get(fighter.summonerId) : undefined;
    if (summonerRow) {
      addSettlementStats(summonerRow.stats, stats);
      addSettlementStats(summonerRow.summonStats, stats);
      if (hasSettlementContribution(stats)) {
        summonerRow.summonContributions.push({ name: fighter.name, stats });
      }
      return;
    }
    if (!hasSettlementContribution(stats)) return;
    rows.push({
      id: fighter.id,
      fighter,
      name: fighter.name,
      color: fighter.color,
      icon: fighter.jobData?.icon || '❓',
      stats,
      summonStats: emptySettlementStats(),
      summonContributions: [],
    });
  });

  return rows;
};

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
  ArrowLeft: (p: IconProps) => <Icon {...p} d="M19 12H5 M12 19l-7-7 7-7" />,
  RotateCcw: (p: IconProps) => <Icon {...p} d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5" />,
  Swords: (p: IconProps) => <Icon {...p} d="M14.5 17.5 3 6V3h3l11.5 11.5 M13 19l6-6 M16 16l4 4 M19 21l2-2 M14.5 6.5 18 3h3v3l-3.5 3.5 M5 14l4 4 M7 17l-3 3 M3 19l2 2" />,
  Smartphone: (p: IconProps) => <Icon {...p} d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2 M10 18h4 M2 8l-1 2 1 2 M1 10h6" />,
  Maximize: (p: IconProps) => <Icon {...p} d="M8 3H3v5 M16 3h5v5 M8 21H3v-5 M16 21h5v-5" />,
  Minimize: (p: IconProps) => <Icon {...p} d="M8 3v5H3 M16 3v5h5 M8 21v-5H3 M16 21v-5h5" />,
  Download: (p: IconProps) => (
    <Icon {...p} d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3" />
  ),
  BookOpen: (p: IconProps) => (
    <Icon {...p} d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  ),
  X: (p: IconProps) => <Icon {...p} d="M18 6L6 18 M6 6l12 12" />,
  BarChart: (p: IconProps) => <Icon {...p} d="M18 20V10 M12 20V4 M6 20v-6" />,
};

type StatusCategory =
  | 'control'
  | 'defense'
  | 'counter'
  | 'damage'
  | 'recovery'
  | 'special'
  | 'buff'
  | 'debuff'
  | 'unknown';

type StatusDisplayInfo = {
  type: string;
  name: string;
  icon: string;
  desc: string;
  sourceName?: string;
  category: StatusCategory;
  priority: number;
  durationLabel?: string;
  isUnknown: boolean;
};

type StatusDisplayItem = {
  status: StatusEntry;
  count: number;
  info: StatusDisplayInfo;
};

type ResourceTone = 'luck' | 'tech' | 'combat' | 'support' | 'shield' | 'neutral';

type ResourceChip = {
  icon: string;
  label: string;
  value: string;
  title: string;
  tone: ResourceTone;
  priority: number;
};

type StatTone = 'physical' | 'defense' | 'magic' | 'speed' | 'mental' | 'kill';

type StatChip = {
  key: string;
  icon: string;
  label: string;
  tone: StatTone;
  value: (fighter: Fighter) => number;
};

const STATUS_CHIP_LIMIT = 5;
const RESOURCE_CHIP_LIMIT = 4;

const STATUS_CATEGORY_STYLES: Record<StatusCategory, string> = {
  control: 'border-purple-400/40 bg-purple-500/10 text-purple-100',
  defense: 'border-sky-400/40 bg-sky-500/10 text-sky-100',
  counter: 'border-orange-400/40 bg-orange-500/10 text-orange-100',
  damage: 'border-red-400/40 bg-red-500/10 text-red-100',
  recovery: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100',
  special: 'border-amber-300/40 bg-amber-400/10 text-amber-100',
  buff: 'border-indigo-300/40 bg-indigo-500/10 text-indigo-100',
  debuff: 'border-slate-300/40 bg-slate-500/10 text-slate-100',
  unknown: 'border-rose-300/40 bg-rose-500/10 text-rose-100',
};

const STATUS_DISPLAY_FALLBACKS: Record<string, StatusEffectInfo> = {
  BLEED: { name: '流血', icon: '🩸', desc: '持续流血伤害' },
  YUZU_BARRIER: { name: '镜界护盾', icon: '🛡️', desc: '柚子施加的数值护盾，会先于生命承受伤害' },
  YUZU_TAUNT: { name: '满级嘲讽', icon: '🪞', desc: '柚子抽到盾牌后吸引敌方火力' },
  YUZU_MARKED: { name: '镜界标记', icon: '🎯', desc: '柚子三阶段定制目标，承受柚子更高伤害' },
  YUZU_EVADE_DOWN: { name: '闪避破坏', icon: '🪞', desc: '闪避率下降' },
  YUZU_DEF_DOWN: { name: '防御破坏', icon: '🪞', desc: '防御力下降' },
  YUZU_RES_DOWN: { name: '魔抗破坏', icon: '🪞', desc: '魔抗下降' },
  YUZU_ATK_DOWN: { name: '攻击破坏', icon: '🪞', desc: '攻击力下降' },
  YUZU_SLOW: { name: '减速', icon: '🪞', desc: '行动速度下降' },
  ORIGINIUM_DISEASE: { name: '矿石病', icon: '🦠', desc: '源石侵蚀层数；层数越高越危险，80 层死亡' },
  PURUISAISHI_SHIELD: { name: '源石映像护盾', icon: '🜲', desc: '普瑞赛斯二阶段护盾；场上有源石结晶时不会低于 1' },
};

const RESOURCE_TONE_STYLES: Record<ResourceTone, string> = {
  luck: 'border-yellow-300/40 bg-yellow-400/10 text-yellow-100',
  tech: 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100',
  combat: 'border-red-300/40 bg-red-400/10 text-red-100',
  support: 'border-emerald-300/40 bg-emerald-400/10 text-emerald-100',
  shield: 'border-sky-300/40 bg-sky-400/10 text-sky-100',
  neutral: 'border-slate-300/30 bg-slate-700/40 text-slate-200',
};

const STAT_TONE_STYLES: Record<StatTone, string> = {
  physical: 'border-red-300/25 bg-red-400/5 text-red-100',
  defense: 'border-sky-300/25 bg-sky-400/5 text-sky-100',
  magic: 'border-violet-300/25 bg-violet-400/5 text-violet-100',
  speed: 'border-amber-300/25 bg-amber-400/5 text-amber-100',
  mental: 'border-pink-300/25 bg-pink-400/5 text-pink-100',
  kill: 'border-rose-300/30 bg-rose-400/10 text-rose-100',
};

const STAT_CHIPS: StatChip[] = [
  { key: 'atk', icon: '🗡️', label: '攻击', tone: 'physical', value: (fighter) => fighter.atk },
  { key: 'def', icon: '🛡️', label: '防御', tone: 'defense', value: (fighter) => fighter.def },
  { key: 'mag', icon: '🔮', label: '魔力', tone: 'magic', value: (fighter) => fighter.mag },
  { key: 'res', icon: '💠', label: '魔抗', tone: 'defense', value: (fighter) => fighter.res },
  { key: 'spd', icon: '⚡', label: '速度', tone: 'speed', value: (fighter) => fighter.spd },
  { key: 'agl', icon: '🦶', label: '敏捷', tone: 'speed', value: (fighter) => fighter.agl },
  { key: 'wis', icon: '🧠', label: '智力', tone: 'mental', value: (fighter) => fighter.wis },
  { key: 'kills', icon: '☠️', label: '击杀', tone: 'kill', value: (fighter) => fighter.stats.kills },
];

const CONTROL_STATUS_TYPES = new Set([
  'STUN',
  'FREEZE',
  'CONFUSED',
  'CHARMED',
  'SILENCE',
  'WATER_PRISON',
  'WT_SUPPRESS',
  'WT_AIRBORNE',
  'AIRBORNE',
  'WT_REPAIRING',
]);

const DEFENSE_STATUS_TYPES = new Set([
  'INVUL',
  'BKB',
  'SPELL_BLOCK',
  'YUZU_BARRIER',
  'TING_DEFIANCE',
  'TOKUSATSU_DEFIANCE',
  'RA_PHOENIX',
  'VALO_ULT_RUN_IT_BACK',
  'VALO_HARBOR_WALL',
  'PURUISAISHI_SHIELD',
]);

const DAMAGE_STATUS_TYPES = new Set([
  'BURN',
  'POISON',
  'BLEED',
  'WATER_PRISON',
  'NO_HEAL',
  'WEAK',
  'ZEROED',
  'VALO_AIM_PUNCH',
  'VALO_CYPHER_REVEALED',
  'NEURAL_THEFT_DEBUFF',
  'BABY_WEAKNESS_MARK',
  'WT_SCOUTED',
  'WT_BREECH_DAMAGED',
  'WT_TRACK_DAMAGED',
  'WT_AMMO_EXPOSED',
  'YUZU_MARKED',
  'YUZU_EVADE_DOWN',
  'YUZU_DEF_DOWN',
  'YUZU_RES_DOWN',
  'YUZU_ATK_DOWN',
  'YUZU_SLOW',
  'ORIGINIUM_DISEASE',
]);

const RECOVERY_STATUS_TYPES = new Set([
  'REGEN',
  'PLUG_HEART',
  'GACHA_SUMMON_LIFESTEAL',
  'STYLE_FAMILY',
]);

const SPECIAL_STATUS_TYPES = new Set([
  'SYNERGY_SLACKING',
  'SLACKING',
  'SPINAL_SWORD',
  'PUPPET_MASTER',
  'GAMER_WORLD_STAGE',
  'LIQUID_BODY',
  'ETHEREAL',
  'VALO_ULT_EMPRESS',
  'VALO_CLUTCH',
  'VALO_REPOSITION',
  'VALO_OPERATOR_PENALTY',
  'RABBIT_CALC_HASTE',
  'RABBIT_ZERO_HASTE',
  'GACHA_TRAP_GUARD_COOLDOWN',
  'GACHA_BLUE_EYES_GUARD_COOLDOWN',
  'GACHA_ULTIMATE_GUARD_COOLDOWN',
  'WT_ERA',
  'YUZU_TAUNT',
]);

const STATUS_PRIORITY_BY_TYPE: Record<string, number> = {
  SYNERGY_SLACKING: 0,
  SLACKING: 0,
  STUN: 5,
  FREEZE: 6,
  CHARMED: 7,
  CONFUSED: 8,
  WATER_PRISON: 9,
  WT_SUPPRESS: 10,
  WT_AIRBORNE: 11,
  AIRBORNE: 11,
  WT_REPAIRING: 12,
  TING_DEFIANCE: 18,
  TOKUSATSU_DEFIANCE: 19,
  INVUL: 20,
  SPELL_BLOCK: 21,
  BKB: 22,
  VALO_ULT_RUN_IT_BACK: 23,
  RA_PHOENIX: 24,
  YUZU_BARRIER: 25,
  WAIT_COUNTER: 30,
  COUNTER: 31,
  SPINAL_SWORD: 40,
  PUPPET_MASTER: 41,
  GAMER_WORLD_STAGE: 42,
  WT_ERA: 43,
  GACHA_TRAP_GUARD_COOLDOWN: 44,
  GACHA_BLUE_EYES_GUARD_COOLDOWN: 44,
  GACHA_ULTIMATE_GUARD_COOLDOWN: 44,
  YUZU_TAUNT: 45,
  PURUISAISHI_SHIELD: 26,
  YUZU_MARKED: 63,
  YUZU_EVADE_DOWN: 64,
  YUZU_DEF_DOWN: 64,
  YUZU_RES_DOWN: 64,
  YUZU_ATK_DOWN: 64,
  YUZU_SLOW: 64,
  BURN: 60,
  POISON: 61,
  BLEED: 61,
  ORIGINIUM_DISEASE: 60,
  NO_HEAL: 62,
};

const getStatusCategory = (type: string, isUnknown: boolean): StatusCategory => {
  if (isUnknown) return 'unknown';
  if (CONTROL_STATUS_TYPES.has(type)) return 'control';
  if (DEFENSE_STATUS_TYPES.has(type)) return 'defense';
  if (type === 'COUNTER' || type === 'WAIT_COUNTER' || type.startsWith('CTR_')) return 'counter';
  if (DAMAGE_STATUS_TYPES.has(type)) return 'damage';
  if (RECOVERY_STATUS_TYPES.has(type)) return 'recovery';
  if (
    SPECIAL_STATUS_TYPES.has(type) ||
    type.startsWith('PLUG_') ||
    type.startsWith('STYLE_')
  ) {
    return 'special';
  }
  if (['RAGE', 'AIM', 'DIVA_SONG', 'DIVA_HEADPHONE_GUARD', 'DIVA_FINAL_CHORUS', 'BABY_LOVE_BOTTLE', 'Q_BUNNY_IDOL_AGL'].includes(type)) return 'buff';
  if (['BLIND', 'VALO_FLASH'].includes(type)) return 'debuff';
  return 'buff';
};

const getStatusPriority = (type: string, category: StatusCategory) => {
  if (STATUS_PRIORITY_BY_TYPE[type] !== undefined) return STATUS_PRIORITY_BY_TYPE[type];
  if (type.startsWith('CTR_')) return 32;
  if (type.startsWith('STYLE_')) return 45;
  if (type.startsWith('PLUG_')) return 50;
  return {
    control: 15,
    defense: 25,
    counter: 35,
    special: 55,
    damage: 65,
    recovery: 75,
    debuff: 85,
    buff: 90,
    unknown: 1,
  }[category];
};

const getStatusDurationLabel = (status: StatusEntry) => {
  return statusDurationText({ ...status });
};

const getStatusDisplayInfo = (status: StatusEntry): StatusDisplayInfo => {
  const effect = namerenaData.STATUS_EFFECTS?.[status.type] ?? STATUS_DISPLAY_FALLBACKS[status.type] ?? (
    status.displayName
      ? { name: status.displayName, icon: status.displayIcon ?? '⬆️', desc: status.displayDesc ?? '限时状态' }
      : undefined
  );
  const sourceName = getDefenseStatusDisplayName(status);
  const isUnknown = !effect;
  const category = getStatusCategory(status.type, isUnknown);
  const fallbackName = status.type.replace(/_/g, ' ');

  return (
    {
      type: status.type,
      name: sourceName ?? effect?.name ?? fallbackName,
      icon: effect?.icon ?? '❔',
      desc: effect?.desc ?? '未登记的状态，请检查状态显示表',
      sourceName,
      category,
      priority: getStatusPriority(status.type, category),
      durationLabel: getStatusDurationLabel(status),
      isUnknown,
    }
  );
};

const statusGroupKey = (status: StatusEntry) => `${status.type}:${status.sourceId ?? ''}`;

const buildStatusDisplayItems = (statuses: StatusEntry[]): StatusDisplayItem[] => {
  const grouped = new Map<string, StatusDisplayItem>();
  statuses.forEach((status) => {
    const key = statusGroupKey(status);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        status: { ...status },
        count: 1,
        info: getStatusDisplayInfo(status),
      });
      return;
    }
    existing.count += 1;
    if (status.duration > existing.status.duration) {
      existing.status = { ...status };
      existing.info = getStatusDisplayInfo(status);
    }
  });

  return [...grouped.values()].sort((a, b) =>
    a.info.priority - b.info.priority ||
    a.info.name.localeCompare(b.info.name, 'zh-Hans-CN') ||
    a.info.type.localeCompare(b.info.type),
  );
};

const formatStatusTitle = (item: StatusDisplayItem) => {
  const lines = [
    `${item.info.name}${item.count > 1 ? ` x${item.count}` : ''}`,
    item.info.desc,
  ];
  if (item.info.durationLabel) lines.push(`剩余：${item.info.durationLabel}`);
  if (item.info.sourceName && item.info.sourceName !== item.info.name) {
    lines.push(`来源：${item.info.sourceName}`);
  }
  if (item.info.isUnknown) lines.push(`原始状态：${item.info.type}`);
  return lines.join('\n');
};

function StatusChip({ item, compact = false }: { item: StatusDisplayItem; compact?: boolean }) {
  const label = compact ? `${item.info.name}${item.info.durationLabel ? ` ${item.info.durationLabel}` : ''}` : item.info.name;
  return (
    <span
      title={formatStatusTitle(item)}
      className={`inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-md border px-1.5 text-[10px] font-bold leading-none shadow-sm ${STATUS_CATEGORY_STYLES[item.info.category]}`}
    >
      <span className="shrink-0 text-[12px] leading-none">{item.info.icon}</span>
      <span className="min-w-0 truncate">{label}</span>
      {!compact && item.info.durationLabel ? (
        <span className="shrink-0 rounded bg-slate-950/40 px-1 font-mono text-[9px] leading-4 text-white/80">
          {item.info.durationLabel}
        </span>
      ) : null}
      {item.count > 1 ? (
        <span className="shrink-0 rounded bg-slate-950/40 px-1 font-mono text-[9px] leading-4 text-white/80">
          x{item.count}
        </span>
      ) : null}
    </span>
  );
}

function StatusStrip({ statuses }: { statuses: StatusEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const items = buildStatusDisplayItems(statuses);
  if (items.length === 0) return null;

  const visibleItems = expanded ? items : items.slice(0, STATUS_CHIP_LIMIT);
  const hiddenItems = expanded ? [] : items.slice(STATUS_CHIP_LIMIT);
  const hiddenTitle = hiddenItems.map(formatStatusTitle).join('\n\n');

  return (
    <div className="namerena-status-strip mt-2 rounded-lg border border-slate-700/60 bg-slate-950/50 px-2 py-1.5 shadow-inner">
      <div className="flex min-w-0 flex-wrap gap-1">
        {visibleItems.map((item) => (
          <StatusChip key={statusGroupKey(item.status)} item={item} />
        ))}
        {hiddenItems.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-expanded={false}
            title={hiddenTitle}
            className="inline-flex h-6 shrink-0 items-center rounded-md border border-slate-500/40 bg-slate-800 px-1.5 text-[10px] font-bold text-slate-200 shadow-sm"
          >
            +{hiddenItems.length}
          </button>
        ) : expanded && items.length > STATUS_CHIP_LIMIT ? (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-expanded={true}
            className="inline-flex h-6 shrink-0 items-center rounded-md border border-slate-500/40 bg-slate-800 px-1.5 text-[10px] font-bold text-slate-200 shadow-sm"
          >
            收起
          </button>
        ) : null}
      </div>
    </div>
  );
}

const getResourceTitle = (label: string, value: string, detail?: string) =>
  detail ? `${label}：${value}\n${detail}` : `${label}：${value}`;

const buildResourceChips = (fighter: Fighter, fighters: Fighter[], turnCount: number, battleState: BattleState): ResourceChip[] => {
  const chips: ResourceChip[] = [];
  const activeSummons = fighters.filter((candidate) =>
    candidate.isSummon &&
    candidate.summonerId === fighter.id &&
    !candidate.isDead &&
    candidate.currentHp > 0,
  );

  if ((fighter.originiumInfectionStacks ?? 0) > 0) {
    chips.push({
      icon: '🦠',
      label: '矿石病',
      value: `${fighter.originiumInfectionStacks ?? 0}/80`,
      title: getResourceTitle('矿石病层数', `${fighter.originiumInfectionStacks ?? 0}/80`, '60 层以上攻击与魔抗加成清零，80 层死亡'),
      tone: 'combat',
      priority: 5,
    });
  }

  if (fighter.isPuruisaishi) {
    const phase = Math.max(1, fighter.puruisaishiPhase ?? 1);
    const shield = Math.max(0, Math.floor(fighter.puruisaishiShield ?? 0));
    chips.push({
      icon: '🜲',
      label: '源石映像',
      value: `${phase}阶段`,
      title: getResourceTitle('普瑞赛斯阶段', `${phase}阶段`, phase >= 2 ? '二阶段后每 20 回合随机提高场上单位矿石病层数' : '一阶段不可被选为目标'),
      tone: 'tech',
      priority: 6,
    });
    if (shield > 0) {
      chips.push({
        icon: '🛡️',
        label: '护盾',
        value: String(shield),
        title: getResourceTitle('普瑞赛斯护盾', String(shield), '场上存在源石结晶时不会低于 1'),
        tone: 'shield',
        priority: 7,
      });
    }
  }

  if (fighter.isOriginiumCore || fighter.isOriginiumCrystal) {
    const protectedUntil = fighter.untargetableUntilTurn ?? -1;
    const isProtected = protectedUntil >= turnCount;
    chips.push({
      icon: fighter.isOriginiumCore ? '🜚' : '◆',
      label: fighter.isOriginiumCore ? '阿喃那' : '结晶',
      value: isProtected ? `保护至${protectedUntil}` : '活性',
      title: getResourceTitle(fighter.isOriginiumCore ? '阿喃那' : '源石结晶', isProtected ? `保护至第 ${protectedUntil} 回合` : '可被攻击'),
      tone: 'neutral',
      priority: 8,
    });
    if (fighter.isOriginiumCrystal) {
      const round = getLargeRoundProgress(battleState);
      chips.push({
        icon: '⏱️',
        label: '增殖轮',
        value: `${round.number} · ${round.acted}/${round.total}`,
        title: getResourceTitle(
          '源石结晶增殖大回合',
          `第 ${round.number} 轮（${round.acted}/${round.total} 名玩家已行动）`,
          fighter.originiumWasAttackedThisGrowthRound ? '本大回合已被攻击，不会增殖' : '若完整大回合内未被攻击，回合结束时增殖',
        ),
        tone: fighter.originiumWasAttackedThisGrowthRound ? 'neutral' : 'tech',
        priority: 9,
      });
    }
  }

  if (fighter.isYuzu) {
    const phase = Math.max(1, fighter.yuzuPhase ?? 1);
    const shield = Math.max(0, Math.floor(fighter.yuzuShield ?? 0));
    chips.push({
      icon: '🪞',
      label: '镜界',
      value: `${phase}阶段`,
      title: getResourceTitle('镜界阶段', `${phase}阶段`, phase >= 3 ? '唯一目标已启动，非标记目标伤害会被大量偏折' : undefined),
      tone: 'tech',
      priority: 24,
    });
    if (shield > 0) {
      chips.push({
        icon: '🛡️',
        label: '护盾',
        value: String(shield),
        title: getResourceTitle('镜界护盾', String(shield), '先于生命承受伤害；血条上的蓝色部分表示护盾覆盖量'),
        tone: 'shield',
        priority: 25,
      });
    }
    if (phase >= 3) {
      const markedTarget = fighter.yuzuMarkedTargetId
        ? fighters.find((candidate) => candidate.id === fighter.yuzuMarkedTargetId)
        : undefined;
      chips.push({
        icon: '🎯',
        label: '唯一',
        value: markedTarget?.name ?? '未定',
        title: getResourceTitle('唯一目标', markedTarget?.name ?? '未定', '柚子的三阶段定制目标'),
        tone: 'combat',
        priority: 26,
      });
      chips.push({
        icon: '🎼',
        label: '终幕',
        value: fighter.yuzuFuriosoReady ? 'READY' : `${fighter.yuzuMarkedHitCount ?? 0}/9`,
        title: getResourceTitle('Furioso-Replica', fighter.yuzuFuriosoReady ? '已准备' : `${fighter.yuzuMarkedHitCount ?? 0}/9`, '三阶段技能打到唯一目标后每个大回合最多计数一次'),
        tone: fighter.yuzuFuriosoReady ? 'combat' : 'tech',
        priority: 27,
      });
    }
  }

  if (fighter.isGacha) {
    if (typeof fighter.gachaLuck === 'number') {
      chips.push({
        icon: '🍀',
        label: '欧气',
        value: `${fighter.gachaLuck}/5`,
        title: getResourceTitle('欧气', `${fighter.gachaLuck}/5`, '满 5 后可触发欧皇行动窗口'),
        tone: 'luck',
        priority: 10,
      });
    }
    if (activeSummons.length > 0) {
      chips.push({
        icon: '🃏',
        label: '召唤',
        value: String(activeSummons.length),
        title: getResourceTitle('场上召唤物', String(activeSummons.length), activeSummons.map((summon) => summon.name).join('、')),
        tone: 'support',
        priority: 11,
      });
    }
    if ((fighter.exodiaPieces?.length ?? 0) > 0) {
      chips.push({
        icon: '🧩',
        label: '封印',
        value: `${fighter.exodiaPieces?.length ?? 0}/5`,
        title: getResourceTitle('黑暗大法师封印组件', `${fighter.exodiaPieces?.length ?? 0}/5`),
        tone: 'luck',
        priority: 12,
      });
    }
  }

  if (fighter.isGamer && typeof fighter.apm === 'number') {
    chips.push({
      icon: '🎮',
      label: 'APM',
      value: `${fighter.apm}/10`,
      title: getResourceTitle('APM', `${fighter.apm}/10`, '玄凝的竞技资源，影响技能强化与终局连段'),
      tone: 'tech',
      priority: 20,
    });
  }

  if (fighter.isSigua) {
    if (typeof fighter.ultPoints === 'number') {
      chips.push({
        icon: '✨',
        label: '大招',
        value: String(fighter.ultPoints),
        title: getResourceTitle('大招点数', String(fighter.ultPoints)),
        tone: 'support',
        priority: 30,
      });
    }
    if (typeof fighter.economy === 'number') {
      chips.push({
        icon: '💳',
        label: '经济',
        value: String(fighter.economy),
        title: getResourceTitle('经济', String(fighter.economy), '影响瓦学妹武器与战术选择'),
        tone: 'tech',
        priority: 31,
      });
    }
    if (typeof fighter.crosshairFocus === 'number') {
      chips.push({
        icon: '🎯',
        label: '专注',
        value: String(fighter.crosshairFocus),
        title: getResourceTitle('准星专注', String(fighter.crosshairFocus)),
        tone: 'combat',
        priority: 32,
      });
    }
  }

  if (fighter.isWT) {
    if (typeof fighter.wtSpawnPoints === 'number') {
      chips.push({
        icon: '🚜',
        label: 'SP',
        value: String(fighter.wtSpawnPoints),
        title: getResourceTitle('重生点', String(fighter.wtSpawnPoints), 'M1 的载具、维修与 CAS 资源'),
        tone: 'combat',
        priority: 40,
      });
    }
    if (typeof fighter.wtFpeCharges === 'number') {
      chips.push({
        icon: '🧯',
        label: '灭火',
        value: String(fighter.wtFpeCharges),
        title: getResourceTitle('灭火器', String(fighter.wtFpeCharges), '用于处理灼烧类异常'),
        tone: 'support',
        priority: 41,
      });
    }
    if (typeof fighter.wtNbcsCharges === 'number') {
      chips.push({
        icon: '☣️',
        label: '三防',
        value: String(fighter.wtNbcsCharges),
        title: getResourceTitle('三防处理', String(fighter.wtNbcsCharges), '用于处理毒素/污染类异常'),
        tone: 'support',
        priority: 42,
      });
    }
  }

  if (fighter.isTokusatsu) {
    if (typeof fighter.tokusatsuThroneResonance === 'number' && fighter.tokusatsuThroneResonance > 0) {
      chips.push({
        icon: '🪑',
        label: '王座',
        value: String(fighter.tokusatsuThroneResonance),
        title: getResourceTitle('武神王座共鸣', String(fighter.tokusatsuThroneResonance)),
        tone: 'combat',
        priority: 50,
      });
    }
    if (typeof fighter.monsterTurns === 'number' && fighter.monsterTurns > 0) {
      chips.push({
        icon: '🦖',
        label: '怪兽',
        value: String(fighter.monsterTurns),
        title: getResourceTitle('怪兽形态剩余行动', String(fighter.monsterTurns)),
        tone: 'combat',
        priority: 51,
      });
    }
  }

  if (fighter.isSuccubus) {
    const plugCount = fighter.status.filter((status) => status.type.startsWith('PLUG_')).length;
    if (plugCount > 0) {
      chips.push({
        icon: '🧬',
        label: '插件',
        value: `${plugCount}/8`,
        title: getResourceTitle('奇美拉插件', `${plugCount}/8`),
        tone: 'tech',
        priority: 60,
      });
    }
  }

  if (fighter.isTing && (fighter.hasSpinalSword || fighter.spinalSwordTurns)) {
    chips.push({
      icon: '🦴',
      label: '脊髓剑',
      value: fighter.spinalSwordTurns ? String(fighter.spinalSwordTurns) : '持有',
      title: getResourceTitle('脊髓剑', fighter.spinalSwordTurns ? `${fighter.spinalSwordTurns} 回合` : '持有中'),
      tone: 'combat',
      priority: 70,
    });
  }

  if (fighter.isSummon) {
    const summoner = fighters.find((candidate) => candidate.id === fighter.summonerId);
    chips.push({
      icon: '🔗',
      label: '召唤者',
      value: summoner?.name ?? '未知',
      title: getResourceTitle('召唤者', summoner?.name ?? '未知'),
      tone: 'neutral',
      priority: 80,
    });
  }

  return chips.sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label, 'zh-Hans-CN'));
};

const buildStageStatusBadges = (fighter: Fighter): NameArenaStageBadge[] =>
  buildStatusDisplayItems(fighter.status).map((item) => ({
    key: `status-${statusGroupKey(item.status)}`,
    icon: item.info.icon,
    label: `${item.info.name}${item.info.durationLabel ? ` ${item.info.durationLabel}` : ''}${item.count > 1 ? ` x${item.count}` : ''}`,
    detail: formatStatusTitle(item),
    tone: item.info.category,
  }));

const buildStageResourceBadges = (
  fighter: Fighter,
  fighters: Fighter[],
  turnCount: number,
  battleState: BattleState,
): NameArenaStageBadge[] =>
  buildResourceChips(fighter, fighters, turnCount, battleState).map((chip) => ({
    key: `resource-${chip.label}-${chip.value}`,
    icon: chip.icon,
    label: `${chip.label} ${chip.value}`,
    detail: chip.title,
    tone: 'resource',
  }));

function ResourceStrip({ fighter, fighters, turnCount, battleState }: { fighter: Fighter; fighters: Fighter[]; turnCount: number; battleState: BattleState }) {
  const [expanded, setExpanded] = useState(false);
  const chips = buildResourceChips(fighter, fighters, turnCount, battleState);
  if (chips.length === 0) return null;

  const visibleChips = expanded ? chips : chips.slice(0, RESOURCE_CHIP_LIMIT);
  const hiddenChips = expanded ? [] : chips.slice(RESOURCE_CHIP_LIMIT);

  return (
    <div className="namerena-resource-strip mt-2 flex min-w-0 flex-wrap gap-1">
      {visibleChips.map((chip) => (
        <span
          key={`${chip.label}-${chip.value}`}
          title={chip.title}
          className={`inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-md border px-1.5 text-[10px] font-bold leading-none shadow-sm ${RESOURCE_TONE_STYLES[chip.tone]}`}
        >
          <span className="shrink-0 text-[12px] leading-none">{chip.icon}</span>
          <span className="shrink-0 text-slate-300/90">{chip.label}</span>
          <span className="min-w-0 truncate font-mono text-white">{chip.value}</span>
        </span>
      ))}
      {hiddenChips.length > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          title={hiddenChips.map((chip) => chip.title).join('\n\n')}
          className="inline-flex h-6 shrink-0 items-center rounded-md border border-slate-500/40 bg-slate-800 px-1.5 text-[10px] font-bold text-slate-200 shadow-sm"
        >
          +{hiddenChips.length}
        </button>
      ) : expanded && chips.length > RESOURCE_CHIP_LIMIT ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-expanded={true}
          className="inline-flex h-6 shrink-0 items-center rounded-md border border-slate-500/40 bg-slate-800 px-1.5 text-[10px] font-bold text-slate-200 shadow-sm"
        >
          收起
        </button>
      ) : null}
    </div>
  );
}

function HealthBar({ fighter }: { fighter: Fighter }) {
  const hpPct = Math.max(0, Math.min(100, fighter.hpPct * 100));
  const yuzuShield = Math.max(0, Math.floor(fighter.yuzuShield ?? 0));
  const puruisaishiShield = Math.max(0, Math.floor(fighter.puruisaishiShield ?? 0));
  const shield = yuzuShield + puruisaishiShield;
  const shieldPct = fighter.maxHp > 0 ? Math.max(0, Math.min(100, (shield / fighter.maxHp) * 100)) : 0;
  const effectivePct = fighter.maxHp > 0
    ? Math.max(0, Math.min(100, ((fighter.currentHp + shield) / fighter.maxHp) * 100))
    : hpPct;
  const hasShield = shield > 0;
  const shieldLabel = [
    yuzuShield > 0 ? `镜界护盾：${yuzuShield}` : null,
    puruisaishiShield > 0 ? `源石映像护盾：${puruisaishiShield}` : null,
  ].filter(Boolean).join('\n');
  const title = hasShield
    ? `生命：${fighter.currentHp}/${fighter.maxHp}\n${shieldLabel}\n蓝色区域表示护盾覆盖量，护盾会先于生命承受伤害。`
    : `生命：${fighter.currentHp}/${fighter.maxHp}`;

  return (
    <div
      title={title}
      className={`relative h-2 w-full overflow-hidden rounded-full border shadow-inner ${hasShield ? 'border-sky-700/60 bg-slate-950' : 'border-slate-800 bg-slate-900'}`}
    >
      {hasShield ? (
        <>
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-sky-500/55 shadow-[0_0_7px_rgba(56,189,248,0.65)] transition-all duration-300 ease-out"
            style={{ width: `${effectivePct}%` }}
          />
          <div
            className="absolute bottom-0 left-0 z-20 h-[2px] rounded-full bg-cyan-300 shadow-[0_0_5px_rgba(103,232,249,0.9)] transition-all duration-300 ease-out"
            style={{ width: `${shieldPct}%` }}
          />
        </>
      ) : null}
      <div
        className={`relative h-full transition-all duration-300 ease-out ${fighter.hpPct < 0.3 ? 'bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.8)]' : 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.8)]'}`}
        style={{ width: `${hpPct}%` }}
      />
    </div>
  );
}

function StatGrid({ fighter }: { fighter: Fighter }) {
  return (
    <div className="namerena-stat-grid mt-2 grid grid-cols-4 gap-1 rounded-lg bg-slate-900 p-1.5 text-[10px] font-bold leading-tight text-slate-300 shadow-inner md:grid-cols-2 2xl:grid-cols-4">
      {STAT_CHIPS.map((stat) => (
        <span
          key={stat.key}
          title={stat.label}
          className={`namerena-stat-chip flex h-7 min-w-0 items-center gap-1 rounded-md border px-1.5 shadow-sm ${STAT_TONE_STYLES[stat.tone]}`}
        >
          <span className="shrink-0 text-[12px] leading-none">{stat.icon}</span>
          <span className="namerena-stat-label shrink-0 text-slate-400">{stat.label}</span>
          <span className="namerena-stat-value ml-auto min-w-0 truncate font-mono text-white">{stat.value(fighter)}</span>
        </span>
      ))}
    </div>
  );
}

type NameArenaGameProps = {
    onExit?: () => void;
};

export function NameArenaGame({ onExit }: NameArenaGameProps = {}) {
    const [inputNames, setInputNames] = useState('水人\n玄凝\n小汀\n牢鳄\n兔卷卷\n屑\n刺猬人\n克蕾儿丝菲尔\n丝瓜uli\nM1A2_abrams_sep');
    const [fighters, setFighters] = useState<Fighter[]>([]);
    const [battleTurn, setBattleTurn] = useState(0);
    const [battleState, setBattleState] = useState<BattleState>(() => createBattleState(1, 0));
    const [battleRunId, setBattleRunId] = useState(0);
    const [gameState, setGameState] = useState<'SETUP' | 'FIGHTING' | 'END'>('SETUP');
    const [showMvp, setShowMvp] = useState(false);

    const fullLogsRef = useRef<BattleLogEntry[]>([]);
    const fullEventsRef = useRef<BattleEvent[]>([]);
	    const [displayLogs, setDisplayLogs] = useState<BattleLogEntry[]>([]);
	    const [fullLogSnapshot, setFullLogSnapshot] = useState<BattleLogEntry[]>([]);
	    const [isFullLogModalOpen, setIsFullLogModalOpen] = useState(false);
    const [logPage, setLogPage] = useState(1);
    const LOGS_PER_PAGE = 200;

    const spinalSwordRef = useRef(false);
    // Always-current fighters ref so battleStep never closes over a stale fighters value
    const fightersRef = useRef<Fighter[]>([]);
    const logsEndRef = useRef<HTMLDivElement | null>(null);
    const timerRef = useRef<number | null>(null);
    const battleSpeedRef = useRef(1500);
    const battleTurnRef = useRef(0);
    const battleStateRef = useRef<BattleState>(battleState);
    const logPlaybackQueueRef = useRef<BattlePlaybackItem[]>([]);
    const pendingFinalFightersRef = useRef<Fighter[] | null>(null);
    const pendingEndRef = useRef(false);
    const lastBattleSetupRef = useRef<{ names: string[]; forcePuruisaishi: boolean; seed: number } | null>(null);
    const battlePumpRef = useRef<() => void>(() => {});
    const [currentSpeedLvl, setCurrentSpeedLvl] = useState(1);
    const [battleUiMode, setBattleUiMode] = useState<'next' | 'classic'>('next');
    const [isAutoScroll, setIsAutoScroll] = useState(true);
    const [mobileBattleView, setMobileBattleView] = useState<'arena' | 'logs'>('arena');
    const [isPortraitPhone, setIsPortraitPhone] = useState(false);
    const [landscapeHintDismissed, setLandscapeHintDismissed] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const showLandscapeHint = gameState === 'FIGHTING' && isPortraitPhone && !landscapeHintDismissed;

    const changeBattleUiMode = (mode: 'next' | 'classic') => {
        setBattleUiMode(mode);
    };

    useEffect(() => {
        const updateScreenMode = () => {
            const portraitPhone = window.innerWidth < 768 && window.innerHeight > window.innerWidth;
            setIsPortraitPhone(portraitPhone);
            if (!portraitPhone) setLandscapeHintDismissed(true);
        };
        updateScreenMode();
        window.addEventListener('resize', updateScreenMode);
        return () => window.removeEventListener('resize', updateScreenMode);
    }, []);

    useEffect(() => {
        const handleFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    useEffect(() => {
        if (
            battleUiMode === 'classic' &&
            isAutoScroll &&
            gameState === 'FIGHTING' &&
            (!isPortraitPhone || mobileBattleView === 'logs')
        ) {
            logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [battleUiMode, displayLogs, isAutoScroll, gameState, isPortraitPhone, mobileBattleView]);

    const appendDisplayLog = useCallback((logEntry: BattleLogEntry) => {
        setDisplayLogs(prev => {
            const newLogs = [...prev, logEntry];
            return newLogs.length > DISPLAY_LOG_LIMIT ? newLogs.slice(-DISPLAY_LOG_LIMIT) : newLogs;
        });
    }, []);

    const toggleFullscreen = async () => {
        if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen) {
            alert('当前浏览器不支持网页全屏，可尝试将网站添加到主屏幕。');
            return;
        }
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else await document.documentElement.requestFullscreen();
        } catch {
            alert('无法进入全屏，请检查浏览器的全屏权限。');
        }
    };

    const resetGame = () => {
        setGameState('SETUP');
		        setDisplayLogs([]);
        fullLogsRef.current = [];
        fullEventsRef.current = [];
	        setFullLogSnapshot([]);
        fightersRef.current = [];
        logPlaybackQueueRef.current = [];
        pendingFinalFightersRef.current = null;
        pendingEndRef.current = false;
        setFighters([]);
        setBattleTurn(0);
        setIsFullLogModalOpen(false);
        setShowMvp(false);
        setMobileBattleView('arena');
        setLandscapeHintDismissed(false);
        spinalSwordRef.current = false;
        battleTurnRef.current = 0;
        const resetBattleState = createBattleState(1, 0);
        battleStateRef.current = resetBattleState;
        setBattleState(resetBattleState);
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    const addLog = (logEntry: BattleLogEntry) => {
        fullLogsRef.current.push(logEntry);
        appendDisplayLog(logEntry);
    };

    const launchBattle = (list: string[], forcePuruisaishi: boolean, seed: number) => {
        const nextBattleState = createBattleState(seed, 0);
        const nextFighters = withBattleRandom(nextBattleState, () =>
            list.map(generateNameArenaFighter).filter((fighter): fighter is Fighter => fighter !== null),
        );
        if (nextFighters.length < list.length) {
            alert("存在空名字或角色生成失败，请检查输入");
            return;
        }

        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        fullLogsRef.current = [];
        fullEventsRef.current = [];
        setFullLogSnapshot([]);
        setDisplayLogs([]);
        logPlaybackQueueRef.current = [];
        pendingFinalFightersRef.current = null;
        pendingEndRef.current = false;
        battleTurnRef.current = 0;
        battleStateRef.current = nextBattleState;
        spinalSwordRef.current = false;

        const addSetupEvent = (type: string, text: string) => {
            const sequence = ++nextBattleState.eventSequence;
            const event: EngineBattleLogEntry = {
                id: `event-${sequence}`,
                sequence,
                kind: 'log',
                visible: true,
                type,
                text,
                turn: 0,
                largeRound: 1,
                seed: nextBattleState.seed,
            };
            fullEventsRef.current.push(event);
            addLog(event);
        };

        addSetupEvent('system', `⚔️ 战斗开始！本局种子：${nextBattleState.seed}`);
        if (forcePuruisaishi) {
            withBattleRandom(nextBattleState, () => spawnPuruisaishiEvent({
                fighters: nextFighters,
                core: namerenaCore,
                turnCount: 0,
                largeRound: 1,
                log: addSetupEvent,
            }, '隐藏调试指令启动'));
        }

        lastBattleSetupRef.current = { names: [...list], forcePuruisaishi, seed: nextBattleState.seed };
        fightersRef.current = nextFighters;
        setFighters(nextFighters);
        setBattleTurn(0);
        setBattleState(cloneBattleState(nextBattleState));
        setShowMvp(false);
        setIsFullLogModalOpen(false);
        setMobileBattleView('arena');
        setLandscapeHintDismissed(!(window.innerWidth < 768 && window.innerHeight > window.innerWidth));
        setGameState('FIGHTING');
        setBattleRunId((runId) => runId + 1);
        changeSpeed(1500);
    };

    const replayLastBattle = () => {
        const setup = lastBattleSetupRef.current;
        if (!setup) return;
        launchBattle(setup.names, setup.forcePuruisaishi, setup.seed);
    };

    // Synchronous log collector used inside battleStep so every displayed log carries its matching fighter state.
    const pendingPlaybackItemsRef = useRef<BattlePlaybackItem[]>([]);

    const scheduleBattlePump = useCallback((delay = 0) => {
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            battlePumpRef.current();
        }, delay);
    }, []);

    const downloadLogs = () => {
        const header = [
            `NameWar seed=${battleStateRef.current.seed}`,
            `globalTurn=${battleTurnRef.current}`,
            `largeRound=${battleStateRef.current.largeRound.number}`,
            '',
        ];
        const textContent = [
            ...header,
            ...fullLogsRef.current.map((log) => {
                const turn = log.turn ?? '?';
                const largeRound = log.largeRound ?? '?';
                const action = log.actionId ? ` ${log.actionId}` : '';
                return `[T${turn} R${largeRound}${action}] ${log.text}`;
            }),
        ].join('\n');
        const blob = new Blob([textContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `NameWar_BattleLog_${new Date().getTime()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const downloadReplayData = () => {
        const payload = {
            schemaVersion: 1,
            setup: lastBattleSetupRef.current,
            state: battleStateRef.current,
            events: fullEventsRef.current,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `NameWar_Replay_${battleStateRef.current.seed}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
    };

    const battleStep = useCallback(() => {
        if (pendingEndRef.current || logPlaybackQueueRef.current.length > 0) return;

        // Collect logs with an immediate fighter snapshot so the UI state advances with the log that explains it.
        pendingPlaybackItemsRef.current = [];
        let engine: BattleEngine | null = null;
        const clonedFighters = cloneFighters(fightersRef.current);
        const batchedLog = (logEntry: BattleLogEntry) => {
            const playbackItem: BattlePlaybackItem = {
                log: logEntry,
                fighters: cloneFighters(engine?.fighters ?? clonedFighters),
                turnCount: engine?.turnCount ?? battleTurnRef.current,
                battleState: cloneBattleState(engine?.battleState ?? battleStateRef.current),
            };
            if (logEntry.displayInFeed === false) {
                const previous = pendingPlaybackItemsRef.current[pendingPlaybackItemsRef.current.length - 1];
                if (previous && previous.log.actionId === logEntry.actionId) {
                    previous.fighters = playbackItem.fighters;
                    previous.turnCount = playbackItem.turnCount;
                    previous.battleState = playbackItem.battleState;
                    return;
                }
                pendingPlaybackItemsRef.current.push(playbackItem);
                return;
            }
            fullLogsRef.current.push(logEntry);
            pendingPlaybackItemsRef.current.push(playbackItem);
        };

        engine = new BattleEngine(
            clonedFighters, batchedLog,
            namerenaJobs, namerenaSkills, namerenaData, namerenaCore, battleTurnRef.current,
            battleStateRef.current,
            (event) => fullEventsRef.current.push(event),
        );

        let isEnd = false;
        let nextFighters: Fighter[] = fightersRef.current;
        try {
            isEnd = engine.step(spinalSwordRef);
            battleTurnRef.current = engine.turnCount;
            battleStateRef.current = cloneBattleState(engine.battleState);
            nextFighters = engine.fighters;
        } catch (error) {
            console.error("Game Loop Error:", error);
            const msg = error instanceof Error ? error.message : String(error);
            batchedLog({ type: 'death', text: `⚠️ 战斗系统崩溃: ${msg} (代码已停止)` });
            isEnd = true;
        }

        // Update ref immediately so the next tick always sees fresh data
        fightersRef.current = nextFighters;

        const playbackItems = pendingPlaybackItemsRef.current;
        const finalFightersSnapshot = cloneFighters(nextFighters);
        if (playbackItems.length > 0) {
            logPlaybackQueueRef.current.push(...playbackItems);
            pendingFinalFightersRef.current = finalFightersSnapshot;
        } else {
            pendingFinalFightersRef.current = null;
            setFighters(finalFightersSnapshot);
            setBattleTurn(battleTurnRef.current);
            setBattleState(cloneBattleState(battleStateRef.current));
        }

        if (isEnd) {
            pendingEndRef.current = true;
        }
    }, []);

    const battlePump = useCallback(() => {
        const nextItem = logPlaybackQueueRef.current[0];

        if (nextItem) {
            const playbackItem = logPlaybackQueueRef.current.shift();
            if (!playbackItem) return;
            setFighters(playbackItem.fighters);
            setBattleTurn(playbackItem.turnCount);
            setBattleState(playbackItem.battleState);
            if (playbackItem.log.displayInFeed === false) {
                scheduleBattlePump(0);
                return;
            }
            appendDisplayLog(playbackItem.log);
            scheduleBattlePump(getLogPlaybackDelay(playbackItem.log, battleSpeedRef.current));
            return;
        }

        if (pendingFinalFightersRef.current) {
            setFighters(pendingFinalFightersRef.current);
            setBattleTurn(battleTurnRef.current);
            setBattleState(cloneBattleState(battleStateRef.current));
            pendingFinalFightersRef.current = null;
        }

        if (pendingEndRef.current) {
            pendingEndRef.current = false;
            setGameState('END');
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
            return;
        }

        battleStep();
        scheduleBattlePump(logPlaybackQueueRef.current.length > 0 || pendingEndRef.current ? 0 : 180);
    }, [appendDisplayLog, battleStep, scheduleBattlePump]);

    useEffect(() => {
        battlePumpRef.current = battlePump;
    }, [battlePump]);

    useEffect(() => {
        if (gameState === 'FIGHTING' && !showLandscapeHint)
                scheduleBattlePump(0);
            else if (timerRef.current !== null) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
            return () => {
                if (timerRef.current !== null) {
                    clearTimeout(timerRef.current);
                    timerRef.current = null;
                }
            };
    }, [gameState, scheduleBattlePump, showLandscapeHint]);

    const changeSpeed = (spd: number) => {
        battleSpeedRef.current = spd;
        setCurrentSpeedLvl(spd === 1500 ? 1 : spd === 500 ? 2 : 3);
    };

    const names = fighters.map(f => f.name).filter(n => n.length > 0).sort((a,b) => b.length - a.length);
    const nameRegex = names.length > 0 ? new RegExp(`(${names.map(escapeRegExp).join('|')})`, 'g') : null;
    const roundProgress = getLargeRoundProgress(battleState);
    const aliveCount = fighters.filter(isWinningCombatant).length;

        const renderLogText = (l: BattleLogEntry, i: number) => {
        const parts = nameRegex ? l.text.split(nameRegex) : [l.text];

            const tagMap: Record<string, { label: string; bg: string }> = {
                crit:   { label: '暴击', bg: 'bg-yellow-600' },
                death:  { label: '击杀', bg: 'bg-red-600' },
                win:    { label: '高光', bg: 'bg-indigo-600' },
                transform: { label: '觉醒', bg: 'bg-fuchsia-600' },
                heal:   { label: '恢复', bg: 'bg-emerald-600' },
                buff:   { label: '增益', bg: 'bg-cyan-600' },
                skill:  { label: '技能', bg: 'bg-blue-600' },
                poison: { label: '异常', bg: 'bg-purple-600' },
                info:   { label: '提示', bg: 'bg-slate-600' },
                system: { label: '系统', bg: 'bg-slate-500' }
            };
        const tag = tagMap[l.type] || tagMap['info'];

        if (isHighlightLog(l)) {
            return (
                <div key={i} className="namerena-log-highlight relative z-10 my-5 overflow-hidden rounded-lg border border-purple-500/50 bg-gradient-to-r from-indigo-900/60 via-purple-900/80 to-indigo-900/60 px-3 py-5 text-center shadow-[0_0_20px_rgba(168,85,247,0.4)] animate-log-entry animate-pulse-slow">
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
            <div key={i} className={`namerena-log-entry mb-2 rounded-lg border border-slate-800/50 bg-slate-900/40 p-2.5 text-sm leading-relaxed shadow-sm transition-colors hover:bg-slate-800/80 animate-log-entry ${colorClass}`}>
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
        const settlementRows = buildSettlementRows(fighters);
        const sortedByDmg = [...settlementRows].sort((a, b) => b.stats.dmgDealt - a.stats.dmgDealt);
        const maxDmg = Math.max(1, sortedByDmg[0]?.stats.dmgDealt || 1);
        const showPuruisaishiProphecy = hasPuruisaishiAppeared(fighters);

        const mvpDmg = sortedByDmg[0];
        const mvpTank = [...settlementRows].sort((a, b) => b.stats.dmgTaken - a.stats.dmgTaken)[0];
        const mvpKills = [...settlementRows].sort((a, b) => b.stats.kills - a.stats.kills)[0];
        const summonSummary = (row?: SettlementRow) => {
            if (!row || !hasSettlementContribution(row.summonStats)) return null;
            const parts = [
                row.summonStats.dmgDealt > 0 ? `召唤伤害 +${row.summonStats.dmgDealt.toLocaleString()}` : null,
                row.summonStats.kills > 0 ? `召唤击杀 +${row.summonStats.kills}` : null,
                row.summonStats.dmgTaken > 0 ? `召唤承伤 +${row.summonStats.dmgTaken.toLocaleString()}` : null,
            ].filter(Boolean);
            return parts.join(' / ');
        };

        return (
            <div className="absolute inset-0 z-30 flex min-h-0 flex-col overflow-y-auto bg-[#080b0e] p-5 text-slate-100 animate-fade-in custom-scrollbar md:p-7">
                <div className="mb-5 flex shrink-0 items-end justify-between border-b border-white/10 pb-4">
                    <div>
                        <span className="font-mono text-[11px] font-black text-cyan-300">AFTER ACTION REPORT</span>
                        <h2 className="mt-1 text-2xl font-black text-white">赛后结算</h2>
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowMvp(false)}
                        className="grid h-9 w-9 place-items-center rounded border border-white/15 bg-[#11171d] text-slate-400 transition-colors hover:border-cyan-300 hover:text-white"
                        title="关闭结算面板"
                        aria-label="关闭结算面板"
                    >
                        <Icons.X size={18}/>
                    </button>
                </div>

                {showPuruisaishiProphecy ? (
                    <div className="mb-5 shrink-0 border border-violet-400/35 border-l-4 bg-[#11171d] p-4 text-center shadow-[0_0_22px_rgba(139,92,246,0.16)]">
                        <div className="font-mono text-[11px] font-black text-violet-300">PRIESTESS // 普瑞赛斯</div>
                        <div className="mt-1 text-lg font-black text-white">“我会一直看着你，预言家”</div>
                    </div>
                ) : null}

                <div className="mb-6 grid shrink-0 grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="relative flex min-h-40 flex-col items-center overflow-hidden rounded border border-white/10 bg-[#11171d] p-4">
                        <div className="absolute inset-x-0 top-0 h-[3px] bg-[#ff7a45]" />
                        <span className="mb-2 text-sm font-black text-slate-400">输出 MVP</span>
                        <div className={`mb-2 grid h-12 w-12 place-items-center rounded-sm border border-orange-300/50 bg-gradient-to-br text-2xl ${mvpDmg?.color || 'bg-slate-700'}`}>{mvpDmg?.icon || '❓'}</div>
                        <span className="mb-1 max-w-full truncate text-lg font-black text-white">{mvpDmg?.name || '-'}</span>
                        <span className="font-mono text-sm font-black text-orange-300">{mvpDmg?.stats.dmgDealt.toLocaleString() || 0} 伤害</span>
                        {summonSummary(mvpDmg) && <span className="mt-1 max-w-full truncate text-center text-[11px] font-bold text-orange-200/80" title={summonSummary(mvpDmg) ?? undefined}>{summonSummary(mvpDmg)}</span>}
                    </div>
                    <div className="relative flex min-h-40 flex-col items-center overflow-hidden rounded border border-white/10 bg-[#11171d] p-4">
                        <div className="absolute inset-x-0 top-0 h-[3px] bg-[#46a8ff]" />
                        <span className="mb-2 text-sm font-black text-slate-400">承伤 MVP</span>
                        <div className={`mb-2 grid h-12 w-12 place-items-center rounded-sm border border-blue-300/50 bg-gradient-to-br text-2xl ${mvpTank?.color || 'bg-slate-700'}`}>{mvpTank?.icon || '❓'}</div>
                        <span className="mb-1 max-w-full truncate text-lg font-black text-white">{mvpTank?.name || '-'}</span>
                        <span className="font-mono text-sm font-black text-blue-300">{mvpTank?.stats.dmgTaken.toLocaleString() || 0} 承伤</span>
                        {summonSummary(mvpTank) && <span className="mt-1 max-w-full truncate text-center text-[11px] font-bold text-blue-200/80" title={summonSummary(mvpTank) ?? undefined}>{summonSummary(mvpTank)}</span>}
                    </div>
                    <div className="relative flex min-h-40 flex-col items-center overflow-hidden rounded border border-white/10 bg-[#11171d] p-4">
                        <div className="absolute inset-x-0 top-0 h-[3px] bg-[#ffc84a]" />
                        <span className="mb-2 text-sm font-black text-slate-400">击杀王</span>
                        <div className={`mb-2 grid h-12 w-12 place-items-center rounded-sm border border-amber-300/50 bg-gradient-to-br text-2xl ${mvpKills?.color || 'bg-slate-700'}`}>{mvpKills?.icon || '❓'}</div>
                        <span className="mb-1 max-w-full truncate text-lg font-black text-white">{mvpKills?.name || '-'}</span>
                        <span className="font-mono text-sm font-black text-amber-300">{mvpKills?.stats.kills || 0} 击杀</span>
                        {summonSummary(mvpKills) && <span className="mt-1 max-w-full truncate text-center text-[11px] font-bold text-amber-200/80" title={summonSummary(mvpKills) ?? undefined}>{summonSummary(mvpKills)}</span>}
                    </div>
                </div>

                <div className="mb-3 flex shrink-0 items-end justify-between border-b border-white/10 pb-2">
                    <div>
                        <span className="font-mono text-[10px] font-black text-cyan-300">DAMAGE RANKING</span>
                        <h3 className="text-lg font-black text-white">队伍输出统计</h3>
                    </div>
                    <span className="font-mono text-[11px] font-bold text-slate-500">{sortedByDmg.length} 名参战者</span>
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 custom-scrollbar">
                    {sortedByDmg.map(f => (
                        <div key={f.id} className="grid grid-cols-[minmax(76px,120px)_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/5 pb-3">
                            <div className="min-w-0">
                                <div className="truncate text-sm font-black text-slate-200" title={f.name}>{f.name}</div>
                                {summonSummary(f) && <div className="truncate text-[10px] font-bold text-cyan-100/65" title={summonSummary(f) ?? undefined}>{summonSummary(f)}</div>}
                            </div>
                            <div className="h-3 overflow-hidden bg-white/10">
                                <div className={`h-full bg-gradient-to-r ${f.color} transition-[width] duration-1000 ease-out`} style={{ width: `${(f.stats.dmgDealt / maxDmg) * 100}%` }} />
                            </div>
                            <span className="min-w-12 text-right font-mono text-sm font-black text-white">{f.stats.dmgDealt.toLocaleString()}</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div data-game-state={gameState} className={`namerena-shell relative flex h-full min-h-0 flex-col overflow-hidden bg-slate-950 font-sans text-slate-200 ${onExit ? 'namerena-integrated-shell' : ''}`}>
            <header className={`namerena-game-header z-20 flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 p-3 shadow-lg ${battleUiMode === 'next' ? 'namerena-modern-header' : ''}`}>
                <div className="flex min-w-0 items-center gap-3">
                    {onExit ? (
                        <button
                            type="button"
                            onClick={onExit}
                            className="namerena-exit-button inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs font-bold text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
                            title="返回游戏大厅"
                            aria-label="返回游戏大厅"
                        >
                            <Icons.ArrowLeft size={15} />
                            <span className="namerena-exit-label">返回</span>
                        </button>
                    ) : null}
                    <h1 className={`namerena-title truncate text-xl font-black ${battleUiMode === 'next' ? 'text-white' : 'bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-500'}`}>
                        名字大乱斗 <span className="namerena-title-badge text-[10px] text-slate-500 border border-slate-700 px-1 rounded align-top">NameWar</span>
                    </h1>
                    {gameState !== 'SETUP' ? (
                        <div
                            className="namerena-round-summary hidden shrink-0 items-center gap-2 rounded-md border border-slate-700 bg-slate-950/70 px-2.5 py-1 font-mono text-xs font-bold text-slate-300 sm:flex"
                            title={`本局种子：${battleState.seed}\n当前大回合最多 ${roundProgress.maxActions} 次常规行动内完成`}
                        >
                            <span>全局 {battleTurn}</span>
                            <span className="text-indigo-300">大回合 {roundProgress.number}</span>
                            <span className="text-slate-500">{roundProgress.acted}/{roundProgress.total}</span>
                        </div>
                    ) : null}
                    {gameState !== 'SETUP' ? (
                        <span className="namerena-alive-summary hidden shrink-0 items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-100">
                            存活 <span className="font-mono text-emerald-300">{aliveCount}</span>
                        </span>
                    ) : null}
                </div>
                <div className="namerena-header-controls flex items-center gap-2">
                    {gameState === 'FIGHTING' && (
                        <>
                            <div className="namerena-speed-control flex bg-slate-800 rounded-lg p-0.5 gap-1 shadow-inner border border-slate-700/50">
                                <button onClick={() => changeSpeed(1500)} className={`px-2 py-1 text-xs rounded font-mono transition-colors ${currentSpeedLvl===1 ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>x1</button>
                                <button onClick={() => changeSpeed(500)} className={`px-2 py-1 text-xs rounded font-mono transition-colors ${currentSpeedLvl===2 ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>x2</button>
                                <button onClick={() => changeSpeed(50)} className={`px-2 py-1 text-xs rounded font-mono transition-colors ${currentSpeedLvl===3 ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>x3</button>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsAutoScroll(!isAutoScroll)}
                                className={`namerena-header-autoscroll hidden h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-bold transition-colors ${isAutoScroll ? 'border-indigo-500/30 bg-indigo-900/50 text-indigo-200' : 'border-slate-700 bg-slate-800 text-slate-400'}`}
                                title={isAutoScroll ? '暂停日志自动跟随' : '恢复日志自动跟随'}
                            >
                                <Icons.BookOpen size={12} />
                                <span>{isAutoScroll ? '暂停' : '跟随'}</span>
                            </button>
                        </>
                    )}
                    <div className="namerena-ui-mode-control flex shrink-0 gap-0.5 rounded border border-slate-700 bg-slate-950 p-0.5" role="group" aria-label="战斗界面版本">
                        <button
                            type="button"
                            aria-pressed={battleUiMode === 'next'}
                            onClick={() => changeBattleUiMode('next')}
                            className={`rounded-sm px-2 py-1 text-[11px] font-bold transition-colors ${battleUiMode === 'next' ? 'bg-cyan-400 text-slate-950' : 'text-slate-400 hover:text-white'}`}
                            title="使用新战斗舞台"
                        >
                            新<span className="namerena-ui-mode-long">舞台</span>
                        </button>
                        <button
                            type="button"
                            aria-pressed={battleUiMode === 'classic'}
                            onClick={() => changeBattleUiMode('classic')}
                            className={`rounded-sm px-2 py-1 text-[11px] font-bold transition-colors ${battleUiMode === 'classic' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}
                            title="切回经典战斗界面"
                        >
                            经典
                        </button>
                    </div>
                    {gameState !== 'SETUP' ? (
                        <button
                            type="button"
                            onClick={resetGame}
                            className="namerena-header-reset hidden h-7 w-7 items-center justify-center rounded-md border border-red-500/30 bg-red-600/80 text-white transition-colors hover:bg-red-500"
                            title="重置大厅"
                            aria-label="重置大厅"
                        >
                            <Icons.RotateCcw size={13} />
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={toggleFullscreen}
                        className="namerena-fullscreen-toggle hidden h-7 w-7 items-center justify-center rounded-md border border-slate-600 bg-slate-800 text-slate-200 transition-colors hover:bg-slate-700"
                        title={isFullscreen ? '退出全屏' : '进入全屏'}
                        aria-label={isFullscreen ? '退出全屏' : '进入全屏'}
                    >
                        {isFullscreen ? <Icons.Minimize size={13} /> : <Icons.Maximize size={13} />}
                    </button>
                    {gameState === 'END' && !showMvp && (
                        <>
                            <button onClick={replayLastBattle} className="flex items-center gap-1 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-bold text-white shadow-lg transition-colors hover:bg-slate-700" title={`按相同种子 ${battleState.seed} 重放`}>
                                <Icons.RotateCcw size={14}/> <span className="namerena-end-action-label hidden sm:inline">重放本局</span>
                            </button>
                            <button onClick={() => { setMobileBattleView('arena'); setShowMvp(true); }} className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 px-3 py-1.5 rounded-lg text-xs font-bold text-white flex items-center gap-1 shadow-lg transition-transform hover:scale-105" title="赛后结算">
                                <Icons.BarChart size={14}/> <span className="namerena-end-action-label hidden sm:inline">数据统计</span>
                            </button>
                        </>
                    )}
                </div>
            </header>

            <main className="namerena-battle-layout relative flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
                {gameState === 'SETUP' ? (
                    <div className="h-full w-full overflow-y-auto bg-[#080b0e]">
                        <div className="flex min-h-full items-center justify-center p-5 md:p-8">
                            <section className="my-auto w-full max-w-3xl border-y border-white/10 py-6 md:py-8">
                                <header className="mb-6 border-l-4 border-cyan-300 pl-4">
                                    <span className="font-mono text-[11px] font-black text-cyan-300">MATCH CONFIGURATION</span>
                                    <h2 className="mt-1 text-3xl font-black text-white">配置参战名单</h2>
                                    <p className="mt-2 text-sm leading-6 text-slate-400">每行一个名字；组队时使用“名字@战队名”。</p>
                                </header>

                                <label htmlFor="namearena-roster" className="mb-2 block text-sm font-black text-slate-200">参战者</label>
                                <textarea
                                    id="namearena-roster"
                                    value={inputNames}
                                    onChange={(e) => setInputNames(e.target.value)}
                                    placeholder={'玄凝\n小汀\n牢鳄@红队'}
                                    className="h-48 w-full resize-y rounded border border-white/15 bg-[#0d1217] p-4 font-mono text-base leading-7 text-slate-200 outline-none transition-colors focus:border-cyan-300 md:h-56"
                                />

                                <div className="mt-3 text-xs leading-5 text-slate-500">
                                    特殊角色：<span className="text-cyan-200">水人、玄凝、屑、刺猬人、牢鳄、小汀、克蕾儿丝菲尔、丝瓜uli、兔卷卷、M1、柚子、表情</span>
                                </div>

                                <button onClick={async () => {
                                    const { SeededRNG } = namerenaCore;
                                    if (!SeededRNG) return alert("核心组件未加载，请检查 1_core.js");
                                    let list: string[];
                                    let forcePuruisaishi = false;
                                    try {
                                        const parsedInput = await parseNameArenaSetupInput(inputNames);
                                        list = parsedInput.names;
                                        forcePuruisaishi = parsedInput.forcePuruisaishi;
                                    } catch (error) {
                                        const message = error instanceof Error ? error.message : String(error);
                                        return alert(message);
	                                    }
	                                    if(list.length<2) return alert("至少2人");
	                                    launchBattle(list, forcePuruisaishi, Math.max(1, Math.floor(Date.now() % 2147483646)));
                                }} className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded border border-cyan-200 bg-cyan-300 px-5 py-3 text-base font-black text-slate-950 transition-colors hover:bg-cyan-200 active:bg-cyan-400 md:ml-auto md:w-auto">
                                    <Icons.Play size={20} /> 开始战斗
                                </button>
                            </section>
                        </div>
                    </div>
                ) : battleUiMode === 'next' ? (
                    <div className="relative flex min-h-0 flex-1 overflow-hidden">
                        <NameArenaBattleStage
                            fighters={fighters}
                            displayLogs={displayLogs}
                            battleTurn={battleTurn}
                            battleState={battleState}
                            battleRunId={battleRunId}
                            roundProgress={roundProgress}
                            aliveCount={aliveCount}
                            gameState={gameState}
                            mobileView={mobileBattleView}
                            setMobileView={setMobileBattleView}
                            isAutoScroll={isAutoScroll}
                            onToggleAutoScroll={() => setIsAutoScroll((current) => !current)}
                            onReset={resetGame}
                            onOpenFullLog={() => {
                                setLogPage(1);
                                setFullLogSnapshot([...fullLogsRef.current]);
                                setIsFullLogModalOpen(true);
                            }}
                            onDownloadLogs={downloadLogs}
                            onDownloadReplay={downloadReplayData}
                            getStatusBadges={buildStageStatusBadges}
                            getResourceBadges={(fighter) => buildStageResourceBadges(fighter, fighters, battleTurn, battleState)}
                            mvpOverlay={showMvp ? renderMVP() : null}
                        />
                        {isFullLogModalOpen ? (
                            <div className="absolute inset-0 z-[90] flex min-h-0 flex-col bg-[#080b0e]/98 backdrop-blur-sm animate-fade-in">
                                <div className="flex shrink-0 justify-between border-b border-white/10 bg-[#0d1217] p-4">
                                    <div className="flex items-center gap-3">
                                        <h3 className="flex items-center gap-2 text-lg font-black text-white"><Icons.BookOpen size={19} className="text-cyan-300"/> 完整战报复盘</h3>
                                        <span className="rounded border border-white/10 bg-[#11171d] px-2 py-1 font-mono text-xs font-bold text-slate-400">共 {fullLogSnapshot.length} 条日志</span>
                                    </div>
                                    <button onClick={() => setIsFullLogModalOpen(false)} className="grid h-9 w-9 place-items-center rounded border border-white/10 bg-[#11171d] text-slate-400 transition-colors hover:border-cyan-300 hover:text-white" aria-label="关闭完整战报"><Icons.X size={19}/></button>
                                </div>
                                <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#080b0e] p-5 font-mono text-base">
                                    {fullLogSnapshot.slice((logPage-1)*LOGS_PER_PAGE, logPage*LOGS_PER_PAGE).map(renderLogText)}
                                </div>
                                <div className="flex shrink-0 justify-center gap-4 border-t border-white/10 bg-[#0d1217] p-4">
                                    <button disabled={logPage <= 1} onClick={() => setLogPage((page) => page - 1)} className="rounded border border-white/15 bg-[#11171d] px-6 py-2 text-sm font-bold text-slate-300 transition-colors hover:border-cyan-300 hover:text-white disabled:opacity-30">上一页</button>
                                    <span className="rounded border border-white/10 bg-[#080b0e] px-4 py-1.5 font-mono text-sm font-bold text-slate-400">Page <span className="text-cyan-300">{logPage}</span> / {Math.max(1, Math.ceil(fullLogSnapshot.length / LOGS_PER_PAGE))}</span>
                                    <button disabled={logPage >= Math.max(1, Math.ceil(fullLogSnapshot.length / LOGS_PER_PAGE))} onClick={() => setLogPage((page) => page + 1)} className="rounded border border-white/15 bg-[#11171d] px-6 py-2 text-sm font-bold text-slate-300 transition-colors hover:border-cyan-300 hover:text-white disabled:opacity-30">下一页</button>
                                </div>
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <>
                        <nav className="namerena-mobile-tabs hidden shrink-0 border-b border-slate-800 bg-slate-950 p-1.5" role="tablist" aria-label="手机战斗视图">
                            <button
                                type="button"
                                role="tab"
                                aria-selected={mobileBattleView === 'arena'}
                                onClick={() => setMobileBattleView('arena')}
                                className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-bold transition-colors ${mobileBattleView === 'arena' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400'}`}
                            >
                                <Icons.Swords size={14} />
                                <span>战场</span>
                                <span className="rounded bg-black/25 px-1.5 font-mono text-[10px]">{aliveCount}</span>
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={mobileBattleView === 'logs'}
                                onClick={() => setMobileBattleView('logs')}
                                className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-bold transition-colors ${mobileBattleView === 'logs' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400'}`}
                            >
                                <Icons.BookOpen size={14} />
                                <span>日志</span>
                                <span className="rounded bg-black/25 px-1.5 font-mono text-[10px]">{displayLogs.length}</span>
                            </button>
                        </nav>

                        <section
                            data-mobile-active={mobileBattleView === 'arena'}
                            className="namerena-battle-panel namerena-arena-panel relative flex min-h-0 min-w-0 flex-1 flex-col border-slate-800 bg-slate-900/30 lg:border-r"
                        >
                            <div className="namerena-panel-header z-10 flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/50 p-3 shadow-sm backdrop-blur">
                                <span className="text-sm font-bold tracking-wide">
                                    存活人数: <span className="text-indigo-400">{aliveCount}</span>
                                    <span className="namerena-panel-round ml-3 font-mono text-xs text-slate-500 sm:hidden">全局 {battleTurn} · 大回合 {roundProgress.number} ({roundProgress.acted}/{roundProgress.total})</span>
                                </span>
                                {(gameState === 'FIGHTING' || gameState === 'END') && (
                                    <button onClick={resetGame} className="bg-red-600/80 hover:bg-red-500 px-3 py-1.5 rounded-lg text-xs font-bold text-white flex items-center gap-1 transition-colors shadow-md" title="重开一局">
                                        <Icons.RotateCcw size={14}/> <span className="hidden sm:inline">重置大厅</span>
                                    </button>
                                )}
                            </div>
                            <div className="relative min-h-0 flex-1 overflow-hidden">
                                <div className="namerena-fighter-grid grid h-full min-h-0 auto-rows-max grid-cols-1 content-start items-start gap-4 overflow-y-auto p-4 md:grid-cols-2 custom-scrollbar">
                                {[...fighters].sort((a, b) => b.currentHp - a.currentHp).map((f) => (
                                    <div
                                        key={f.id}
                                        className={`namerena-fighter-card min-w-0 max-w-full rounded-lg border p-3 transition-[transform,box-shadow,border-color,background-color] duration-300
                                        ${f.isActing ? 'z-10 scale-[1.02] border-indigo-400 bg-slate-800 shadow-[0_0_20px_rgba(99,102,241,0.4)]' : 'border-slate-700 bg-slate-800/80'}
                                        ${f.isHit ? 'animate-shake border-red-500/50 bg-red-900/30' : ''}
                                        ${f.isDead ? 'scale-95 border-slate-800 bg-slate-900 opacity-40 grayscale-[0.8]' : 'shadow-md'}`}
                                    >
                                        <div className="namerena-fighter-heading mb-2 flex min-w-0 gap-3">
                                            <div className={`namerena-fighter-avatar flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-gradient-to-br text-2xl shadow-inner ${f.color}`}>{f.jobData?.icon || '❓'}</div>
                                            <div className="flex-1 min-w-0">
                                                <div className="mb-1 flex min-w-0 items-end justify-between gap-2">
                                                    <span title={f.name} className="min-w-0 truncate text-sm font-bold md:text-base">
                                                        {f.name}
                                                        {f.teamId && <span className="text-[10px] ml-1.5 bg-slate-700 px-1.5 py-0.5 rounded text-slate-300 hidden sm:inline-block border border-slate-600 shadow-sm">@{f.teamId}</span>}
                                                    </span>
                                                    <span className="inline-flex shrink-0 items-center gap-1 rounded bg-slate-900 px-1.5 py-0.5 font-mono text-xs font-bold text-slate-400 shadow-inner">
                                                        <span>{f.currentHp}/{f.maxHp}</span>
                                                        {((f.yuzuShield ?? 0) + (f.puruisaishiShield ?? 0)) > 0 ? (
                                                            <span className="rounded bg-sky-500/15 px-1 text-sky-200">+{Math.floor((f.yuzuShield ?? 0) + (f.puruisaishiShield ?? 0))}</span>
                                                        ) : null}
                                                    </span>
                                                </div>
                                                <div className="mb-1.5 truncate text-xs font-bold text-indigo-300">{f.jobData?.name || '未知'}</div>
                                                <HealthBar fighter={f} />
                                            </div>
                                        </div>
                                        <StatusStrip statuses={f.status} />
                                        <ResourceStrip fighter={f} fighters={fighters} turnCount={battleTurn} battleState={battleState} />
                                        {!f.isDead && (
                                            <StatGrid fighter={f} />
                                        )}
                                    </div>
                                ))}
                                </div>
                                {showMvp ? renderMVP() : null}
                            </div>
                        </section>

                        <section
                            data-mobile-active={mobileBattleView === 'logs'}
                            className="namerena-battle-panel namerena-log-panel relative flex min-h-0 min-w-0 flex-1 flex-col border-t border-slate-800 bg-slate-950 shadow-[inset_10px_0_20px_rgba(0,0,0,0.2)] max-h-[42vh] lg:max-h-none lg:border-l lg:border-t-0"
                        >
                            <div className="namerena-panel-header z-10 flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/80 p-3 shadow-sm backdrop-blur">
                                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">实时战斗记录 <span className="text-slate-500 normal-case tracking-normal">(显示末尾百条)</span></span>
                                {gameState === 'END' ? (
                                    <div className="flex gap-1.5">
                                        <button title="打开完整战报" onClick={() => { setLogPage(1); setFullLogSnapshot([...fullLogsRef.current]); setIsFullLogModalOpen(true); }} className="text-xs bg-indigo-600/80 hover:bg-indigo-500 text-white px-2 py-1.5 rounded flex items-center gap-1 font-bold shadow-sm transition">
                                            <Icons.BookOpen size={12}/> <span className="hidden sm:inline">战报回放</span><span className="sm:hidden">战报</span>
                                        </button>
                                        <button title="导出 TXT 战斗日志" aria-label="导出 TXT 战斗日志" onClick={downloadLogs} className="text-xs bg-slate-700 hover:bg-slate-600 text-white p-1.5 rounded flex items-center gap-1 font-bold shadow-sm transition sm:px-2">
                                            <Icons.Download size={12}/><span className="hidden sm:inline">导出 TXT</span>
                                        </button>
                                        <button title="导出 JSON 回放" aria-label="导出 JSON 回放" onClick={downloadReplayData} className="text-xs bg-slate-700 hover:bg-slate-600 text-white p-1.5 rounded flex items-center gap-1 font-bold shadow-sm transition sm:px-2">
                                            <Icons.Download size={12}/><span className="hidden sm:inline">回放 JSON</span>
                                        </button>
                                    </div>
                                ) : (
                                    <button onClick={()=>setIsAutoScroll(!isAutoScroll)} className={`text-[10px] font-bold px-2 py-1 rounded transition-colors ${isAutoScroll ? 'bg-indigo-900/50 text-indigo-300' : 'bg-slate-800 text-slate-500'}`}>
                                        {isAutoScroll ? '自动滚动' : '暂停滚动'}
                                    </button>
                                )}
                            </div>
                            <div className="namerena-log-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-950 p-4 font-mono text-sm custom-scrollbar">
                                {displayLogs.map(renderLogText)}
                                <div ref={logsEndRef} className="h-4" />
                            </div>
                        </section>

                        {isFullLogModalOpen && (
                            <div className="absolute inset-0 z-50 flex min-h-0 flex-col bg-slate-950/95 backdrop-blur-sm animate-fade-in">
                                <div className="flex shrink-0 justify-between border-b border-slate-800 bg-slate-900 p-4 shadow-md">
                                    <div className="flex items-center gap-3">
                                        <h3 className="font-bold text-lg text-white flex items-center gap-2"><Icons.BookOpen size={20} className="text-indigo-400"/> 完整战报复盘</h3>
                                        <span className="text-xs font-mono font-bold text-slate-400 bg-slate-800 px-2 py-1 rounded shadow-inner">共 {fullLogSnapshot.length} 个动作片段</span>
                                    </div>
                                    <button onClick={() => setIsFullLogModalOpen(false)} className="text-slate-400 hover:text-white p-2 hover:bg-slate-800 rounded-full transition"><Icons.X size={24}/></button>
                                </div>
                                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-950/80 p-6 font-mono text-base shadow-inner custom-scrollbar">
                                    {fullLogSnapshot.slice((logPage-1)*LOGS_PER_PAGE, logPage*LOGS_PER_PAGE).map(renderLogText)}
                                </div>
                                <div className="flex shrink-0 justify-center gap-6 border-t border-slate-800 bg-slate-900 p-4 shadow-[0_-10px_20px_rgba(0,0,0,0.2)]">
                                    <button disabled={logPage <= 1} onClick={() => setLogPage(p=>p-1)} className="px-6 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg text-sm font-bold text-slate-300 transition shadow-sm border border-slate-700">上一页</button>
                                    <span className="text-sm font-mono font-bold text-slate-400 bg-slate-950 px-4 py-1.5 rounded-lg shadow-inner border border-slate-800">
                                        Page <span className="text-indigo-400">{logPage}</span> / {Math.max(1, Math.ceil(fullLogSnapshot.length / LOGS_PER_PAGE))}
                                    </span>
                                    <button disabled={logPage >= Math.max(1, Math.ceil(fullLogSnapshot.length / LOGS_PER_PAGE))} onClick={() => setLogPage(p=>p+1)} className="px-6 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg text-sm font-bold text-slate-300 transition shadow-sm border border-slate-700">下一页</button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </main>
            {showLandscapeHint ? (
                <div className="absolute inset-0 z-[80] flex items-center justify-center bg-slate-950/90 p-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="namerena-landscape-title">
                    <div className="w-full max-w-sm rounded-lg border border-indigo-400/40 bg-slate-900 p-5 text-center shadow-2xl">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-indigo-400/30 bg-indigo-500/10 text-indigo-300">
                            <Icons.Smartphone size={25} />
                        </div>
                        <h2 id="namerena-landscape-title" className="mt-4 text-lg font-black text-white">横屏战斗更清晰</h2>
                        <p className="mt-2 text-sm leading-6 text-slate-400">旋转手机后会自动显示战场与日志双栏。战斗目前已暂停。</p>
                        <button
                            type="button"
                            onClick={() => setLandscapeHintDismissed(true)}
                            className="mt-5 w-full rounded-md border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-slate-700"
                        >
                            继续使用竖屏
                        </button>
                    </div>
                </div>
            ) : null}
            <style>{`
                .custom-scrollbar { scrollbar-width: thin; scrollbar-color: #334155 #020617; }
                .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: #020617; border-radius: 4px; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #475569; }

                .namerena-modern-header {
                    background: #080b0e;
                    border-bottom-color: rgba(255,255,255,0.16);
                    box-shadow: 0 8px 30px rgba(0,0,0,0.38);
                }

                .namerena-modern-header .namerena-round-summary {
                    border-color: rgba(255,255,255,0.12);
                    background: #11171d;
                }

                .namerena-integrated-shell .namerena-game-header {
                    padding-top: max(0.75rem, env(safe-area-inset-top));
                    padding-left: max(0.75rem, env(safe-area-inset-left));
                    padding-right: max(0.75rem, env(safe-area-inset-right));
                }

                @media (max-width: 767px) and (orientation: portrait) {
                    .namerena-mobile-tabs {
                        display: flex;
                    }
                    .namerena-battle-panel[data-mobile-active="false"] {
                        display: none;
                    }
                    .namerena-battle-panel[data-mobile-active="true"] {
                        display: flex;
                        flex: 1 1 0%;
                        max-height: none;
                    }
                    .namerena-log-panel {
                        border-top-width: 0;
                    }
                    .namerena-fighter-grid,
                    .namerena-log-scroll {
                        padding: 0.625rem;
                        padding-bottom: max(0.625rem, env(safe-area-inset-bottom));
                    }
                    .namerena-fighter-grid {
                        gap: 0.625rem;
                    }
                    .namerena-panel-header {
                        padding: 0.625rem 0.75rem;
                    }
                }

                @media (orientation: landscape) and (max-height: 600px) {
                    .namerena-game-header {
                        min-height: 2.25rem;
                        gap: 0.375rem;
                        padding-top: max(0.25rem, env(safe-area-inset-top));
                        padding-bottom: 0.25rem;
                        padding-left: max(0.375rem, env(safe-area-inset-left));
                        padding-right: max(0.375rem, env(safe-area-inset-right));
                    }
                    .namerena-integrated-shell .namerena-game-header {
                        padding-top: max(0.25rem, env(safe-area-inset-top));
                        padding-left: max(0.375rem, env(safe-area-inset-left));
                        padding-right: max(0.375rem, env(safe-area-inset-right));
                    }
                    .namerena-game-header > div:first-child {
                        gap: 0.375rem;
                    }
                    .namerena-exit-button {
                        width: 1.75rem;
                        height: 1.75rem;
                        justify-content: center;
                        padding: 0;
                    }
                    .namerena-exit-label,
                    .namerena-end-action-label {
                        display: none !important;
                    }
                    .namerena-title {
                        font-size: 0.9375rem;
                        line-height: 1.125rem;
                    }
                    .namerena-title-badge {
                        display: none;
                    }
                    .namerena-round-summary {
                        gap: 0.375rem;
                        padding-left: 0.375rem;
                        padding-right: 0.375rem;
                        padding-top: 0.125rem;
                        padding-bottom: 0.125rem;
                        font-size: 0.5625rem;
                    }
                    .namerena-alive-summary,
                    .namerena-header-autoscroll,
                    .namerena-header-reset,
                    .namerena-fullscreen-toggle {
                        display: inline-flex;
                    }
                    .namerena-header-controls {
                        gap: 0.25rem;
                    }
                    .namerena-speed-control {
                        gap: 0.125rem;
                    }
                    .namerena-speed-control button {
                        padding: 0.25rem 0.375rem;
                        font-size: 0.625rem;
                    }
                    .namerena-ui-mode-long {
                        display: none;
                    }
                    .namerena-mobile-tabs {
                        display: none;
                    }
                    .namerena-battle-layout {
                        flex-direction: row;
                    }
                    .namerena-battle-panel {
                        display: flex;
                    }
                    .namerena-arena-panel {
                        flex: 0 0 62%;
                        max-width: 62%;
                        border-right-width: 1px;
                    }
                    .namerena-log-panel {
                        flex: 1 1 38%;
                        max-height: none;
                        border-top-width: 0;
                        border-left-width: 1px;
                        padding-right: env(safe-area-inset-right);
                    }
                    .namerena-panel-header {
                        min-height: 1.75rem;
                        padding: 0.25rem 0.5rem;
                    }
                    .namerena-shell[data-game-state="FIGHTING"] .namerena-panel-header {
                        display: none;
                    }
                    .namerena-panel-round {
                        display: none;
                    }
                    .namerena-fighter-grid {
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                        gap: 0.5rem;
                        padding: 0.5rem;
                        padding-left: max(0.5rem, env(safe-area-inset-left));
                        padding-bottom: max(0.5rem, env(safe-area-inset-bottom));
                    }
                    .namerena-fighter-card {
                        padding: 0.5rem;
                    }
                    .namerena-fighter-heading {
                        margin-bottom: 0.375rem;
                        gap: 0.5rem;
                    }
                    .namerena-fighter-avatar {
                        width: 2.25rem;
                        height: 2.25rem;
                        font-size: 1.125rem;
                    }
                    .namerena-status-strip {
                        margin-top: 0.375rem;
                        padding: 0.25rem;
                    }
                    .namerena-resource-strip,
                    .namerena-stat-grid {
                        margin-top: 0.375rem;
                    }
                    .namerena-status-strip .inline-flex,
                    .namerena-resource-strip .inline-flex {
                        height: 1.25rem;
                        padding-left: 0.25rem;
                        padding-right: 0.25rem;
                        font-size: 0.5625rem;
                    }
                    .namerena-stat-grid {
                        grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
                        gap: 0.125rem;
                        padding: 0.25rem;
                    }
                    .namerena-stat-chip {
                        height: 1.375rem;
                        gap: 0.125rem;
                        padding-left: 0.25rem;
                        padding-right: 0.25rem;
                    }
                    .namerena-stat-chip > span:first-child {
                        font-size: 0.625rem;
                    }
                    .namerena-stat-label,
                    .namerena-stat-value {
                        font-size: 0.5625rem;
                    }
                    .namerena-log-scroll {
                        padding: 0.5rem;
                        padding-bottom: max(0.5rem, env(safe-area-inset-bottom));
                        font-size: 0.75rem;
                    }
                    .namerena-log-entry {
                        margin-bottom: 0.375rem;
                        padding: 0.5rem;
                        font-size: 0.75rem;
                    }
                    .namerena-log-highlight {
                        margin-top: 0.5rem;
                        margin-bottom: 0.5rem;
                        padding: 0.75rem 0.5rem;
                    }
                    .namerena-log-highlight strong {
                        margin-left: 0.125rem;
                        margin-right: 0.125rem;
                        padding: 0.125rem 0.375rem;
                        font-size: 0.875rem;
                        line-height: 1.25rem;
                    }
                }

                @media (orientation: landscape) and (max-height: 600px) and (max-width: 720px) {
                    .namerena-fighter-grid {
                        grid-template-columns: minmax(0, 1fr);
                    }
                    .namerena-stat-grid {
                        grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
                    }
                }

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
