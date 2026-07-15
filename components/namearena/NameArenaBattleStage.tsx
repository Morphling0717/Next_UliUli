"use client";

import React, {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import {
  createCombatActorMotionPlan,
  getCombatActorMotionTiming,
} from "@/lib/namearena/combatActorMotion";
import { getBattlePhase } from "@/lib/namearena/battlePresentation";
import {
  GACHA_COMBAT_EFFECT_IDS,
  resolveCombatEffect,
  type CombatEffectCue,
  type CombatImpactTheme,
  type GachaCombatEffectCue,
  type TingCombatEffectCue,
} from "@/lib/namearena/combatEffects";
import {
  createStagePositionMap,
  getStageFinisherImage,
  getStageFighterImage,
  getStageFocusCycleKey,
  resolveStageManualFocusId,
  shouldRenderFighterOnStage,
  type StageManualFocus,
  type StageLogGroup,
  type StagePosition,
} from "@/lib/namearena/battleStageModel";
import {
  EXODIA_STAR_ORDER,
  getSummonCardArt,
  orderExodiaMaterials,
} from "@/lib/namearena/summonCardArt";
import { StageAnimationScheduler } from "@/lib/namearena/stageAnimationScheduler";
import {
  collectStageAssetManifest,
  preloadStageAssetManifest,
  type StageAssetManifest,
} from "@/lib/namearena/stageAssetPreloader";
import type {
  BattleEvent,
  BattleCombatEffectId,
  BattleFormIdentity,
  Fighter,
  SummonCinematicKind,
} from "@/lib/namearena/types";
import styles from "./NameArenaBattleStage.module.css";
import {
  createTingCombatFx,
  drawTingCombatFx,
  type TingCombatFx,
} from "./tingCombatFx";
import {
  createGachaCombatFx,
  drawGachaCombatFx,
  type GachaCombatFx,
} from "./gachaCombatFx";

export type ArenaBattleLogEntry = Pick<BattleEvent, "type" | "text"> &
  Partial<Omit<BattleEvent, "type" | "text">>;

export type NameArenaStageBadge = {
  key: string;
  icon: string;
  label: string;
  detail: string;
  tone: "control" | "defense" | "counter" | "damage" | "recovery" | "special" | "buff" | "debuff" | "unknown" | "resource";
};

type RoundProgress = {
  number: number;
  acted: number;
  total: number;
  maxActions: number;
};

type NameArenaBattleStageProps = {
  fighters: Fighter[];
  displayLogs: ArenaBattleLogEntry[];
  logGroups: StageLogGroup[];
  battleTurn: number;
  battleRunId: number;
  roundProgress: RoundProgress;
  aliveCount: number;
  gameState: "FIGHTING" | "END";
  mobileView: "arena" | "logs";
  setMobileView: (view: "arena" | "logs") => void;
  isAutoScroll: boolean;
  onToggleAutoScroll: () => void;
  onReset: () => void;
  onOpenFullLog: () => void;
  onDownloadLogs: () => void;
  onDownloadReplay: () => void;
  getStatusBadges: (fighter: Fighter) => NameArenaStageBadge[];
  getResourceBadges: (fighter: Fighter) => NameArenaStageBadge[];
  mvpOverlay?: ReactNode;
};

type Popup = {
  id: string;
  fighterId: string;
  value: string;
  label: string;
  kind: "damage" | "heal" | "shield" | "shieldGain" | "defeat";
};
type FinisherCinematic = {
  kind: "finisher";
  fighterId?: string;
  name: string;
  kicker: string;
  title: string;
  image?: string;
  accent?: string;
  theme?: "ting_blood" | "gacha_dragon" | "gacha_solar" | "gacha_void" | "gacha_summon";
  targetName?: string;
};
type TransformationCinematic = {
  kind: "transformation";
  fighterId?: string;
  name: string;
  kicker: string;
  title: string;
  from: BattleFormIdentity;
  to: BattleFormIdentity;
};
type SummonCardCinematic = {
  kind: "summon_card";
  summonKind: SummonCinematicKind;
  summonerId: string;
  summonId: string;
  summonName: string;
  materials: string[];
  cardImage?: string;
};
type Cinematic = FinisherCinematic | TransformationCinematic | SummonCardCinematic;
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  color: string;
};
type Beam = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  life: number;
  maxLife: number;
  color: string;
};

const FX_CANVAS_MAX_DPR = 1.5;
const MAX_GENERIC_PARTICLES = 260;
const MAX_GENERIC_BEAMS = 18;
const MAX_CHARACTER_FX = 32;

function keepNewest<T>(items: T[], limit: number) {
  if (items.length > limit) items.splice(0, items.length - limit);
}

function keepNewestSet<T>(items: Set<T>, limit: number) {
  while (items.size > limit) {
    const oldest = items.values().next().value as T | undefined;
    if (oldest === undefined) break;
    items.delete(oldest);
  }
}
type FighterMotionRuntime = {
  node: HTMLButtonElement;
  animation: Animation;
};
const TYPE_LABELS: Record<string, string> = {
  crit: "暴击",
  death: "击杀",
  win: "高光",
  transform: "觉醒",
  heal: "恢复",
  buff: "增益",
  skill: "技能",
  poison: "异常",
  info: "提示",
  system: "系统",
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function getShield(fighter: Fighter) {
  return Math.max(0, Math.floor((fighter.yuzuShield ?? 0) + (fighter.puruisaishiShield ?? 0)));
}

function getFighterAccent(fighter?: Fighter) {
  if (!fighter) return "#39d9ff";
  if (fighter.isPuruisaishi || fighter.isOriginiumCore || fighter.isOriginiumCrystal) return "#d8ff65";
  if (fighter.isTing) return "#ff6767";
  if (fighter.isGacha) return "#ffc84a";
  if (fighter.isSuccubus) return "#ff8c3a";
  if (fighter.isSigua) return "#39d9ff";
  if (fighter.isTokusatsu) return "#42b9ff";
  if (fighter.isYuzu) return "#f266ff";
  if (fighter.isOwl) return "#ff9a55";
  if (fighter.isWT) return "#77db82";
  if (fighter.isGamer) return "#b6ed55";
  if (fighter.isEmote) return "#d8b4fe";
  if (fighter.isMorphling) return "#5aa7ff";
  if (fighter.isTuJuanJuan) return "#ff8fc7";
  if (fighter.isJoker) return "#c084fc";
  if (fighter.isSummon) return "#e6c66a";
  return "#9aa8b4";
}

function getPhaseNumber(fighter: Fighter) {
  return getBattlePhase(fighter);
}

function getPhaseLabel(fighter: Fighter) {
  if (fighter.isOriginiumCore) return "CORE";
  if (fighter.isOriginiumCrystal) return "ORE";
  if (fighter.isSummon) return fighter.isAdvancedSummon ? "ADV" : "SUM";
  return `P${getPhaseNumber(fighter)}`;
}

function getPhaseName(phase: number) {
  return phase === 1 ? "一阶段" : phase === 2 ? "二阶段" : phase === 3 ? "三阶段" : `第 ${phase} 阶段`;
}

function getActionTitle(log?: ArenaBattleLogEntry) {
  if (!log) return "战场同步中";
  if (log.skillName) return log.skillName;
  const match = log.text.match(/【([^】]+)】/);
  if (match?.[1]) return match[1];
  return TYPE_LABELS[log.type] ?? "战斗事件";
}

function getTransformationTitle(log: ArenaBattleLogEntry, nextForm: BattleFormIdentity) {
  const namedForm = log.text.match(/(?:转职为(?:专属辅助)?|变身(?:为|——)?|显露出|展现出|进化为)【([^】]+)】/);
  if (namedForm?.[1]) return `转职为 ${namedForm[1]}`;
  const phase = log.text.match(/进入([二三四五六七八九十]+)阶段/);
  if (phase?.[1]) return `进入${phase[1]}阶段`;
  return `形态进阶：${nextForm.jobName}`;
}

function getLogTone(log: ArenaBattleLogEntry) {
  if (log.type === "death") return "death";
  if (log.type === "heal") return "heal";
  if (log.type === "transform" || log.type === "win") return "highlight";
  if (log.type === "crit") return "crit";
  if (log.type === "poison") return "status";
  if (log.type === "buff") return "buff";
  if (log.type === "skill") return "skill";
  return "info";
}

function getLogGroupTone(group: StageLogGroup) {
  const priority: Array<ReturnType<typeof getLogTone>> = ["death", "highlight", "crit", "heal", "status", "buff", "skill", "info"];
  const tones = new Set(group.logs.map(getLogTone));
  return priority.find((tone) => tones.has(tone)) ?? "info";
}

function summonCinematicLabel(kind: SummonCardCinematic["summonKind"]) {
  if (kind === "reveal") return { code: "CARD REVEAL", title: "召唤展开" };
  if (kind === "fusion") return { code: "FUSION SUMMON", title: "融合召唤" };
  if (kind === "exodia") return { code: "THE FORBIDDEN ONE", title: "封印解除" };
  return { code: "TRIBUTE SUMMON", title: "上位召唤" };
}

function readDevelopmentSummonPreview(): SummonCardCinematic | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  const preview = new URLSearchParams(window.location.search).get("namearenaSummonPreview");
  const base = { kind: "summon_card" as const, summonerId: "preview-laoe", summonId: "preview-summon" };
  if (preview === "blue-eyes") return {
    ...base,
    summonKind: "tribute",
    summonName: "青眼白龙",
    materials: ["史尔特尔", "史瓦罗"],
  };
  if (preview === "zhongli") return {
    ...base,
    summonKind: "reveal",
    summonName: "钟离",
    materials: [],
  };
  if (preview === "ultimate") return {
    ...base,
    summonKind: "fusion",
    summonName: "青眼究极龙",
    materials: ["青眼白龙", "史尔特尔", "史瓦罗"],
  };
  if (preview === "ra") return {
    ...base,
    summonKind: "tribute",
    summonName: "翼神龙",
    materials: ["钟离", "Saber", "巴哈姆特"],
  };
  if (preview === "exodia") return {
    ...base,
    summonKind: "exodia",
    summonName: "黑暗大法师",
    materials: [...EXODIA_STAR_ORDER],
  };
  return null;
}

const DEVELOPMENT_TING_PREVIEW_SKILLS = new Set([
  "basic",
  "spinal_slash",
  "blood_mist",
  "grudge_rend",
  "grudge_blood_feast",
  "grudge_wail",
  "bone_guard",
  "red_fury_rng",
  "suicide_rng",
  "suicide_bomb",
  "summon_puppet_ting",
]);

function readDevelopmentTingPreview(): string | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  const preview = new URLSearchParams(window.location.search).get("namearenaTingFxPreview");
  return preview && DEVELOPMENT_TING_PREVIEW_SKILLS.has(preview) ? preview : null;
}

function readDevelopmentGachaPreview(): BattleCombatEffectId | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  const preview = new URLSearchParams(window.location.search).get("namearenaGachaFxPreview");
  return preview && GACHA_COMBAT_EFFECT_IDS.includes(preview as BattleCombatEffectId)
    ? preview as BattleCombatEffectId
    : null;
}

function readDevelopmentFinisherPreview(): FinisherCinematic | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  const preview = new URLSearchParams(window.location.search).get("namearenaFinisherPreview");
  const previews: Record<string, { name: string; title: string; theme: NonNullable<FinisherCinematic["theme"]> }> = {
    "blue-eyes": { name: "青眼白龙", title: "毁灭的爆裂疾风弹", theme: "gacha_dragon" },
    ultimate: { name: "青眼究极龙", title: "究极爆裂疾风弹", theme: "gacha_dragon" },
    ra: { name: "翼神龙", title: "太阳神火焰加农", theme: "gacha_solar" },
    exodia: { name: "黑暗大法师", title: "Exodia Obliterate", theme: "gacha_void" },
  };
  const selected = preview ? previews[preview] : undefined;
  if (!selected) return null;
  const art = getSummonCardArt(selected.name);
  return {
    kind: "finisher",
    name: selected.name,
    kicker: "FINISHER // EFFECT PREVIEW",
    title: selected.title,
    image: art.cutinPath ?? art.avatarPath,
    accent: art.accent,
    theme: selected.theme,
    targetName: "特效测试目标",
  };
}

function RitualCard({
  name,
  role,
  index = 0,
  className = "",
  imageOverride,
  style,
}: {
  name: string;
  role: "material" | "result" | "component";
  index?: number;
  className?: string;
  imageOverride?: string;
  style?: CSSProperties;
}) {
  const art = getSummonCardArt(name);
  const imagePath = imageOverride ?? art.imagePath;
  return (
    <div
      className={`${styles.ritualCard} ${className}`}
      data-card-role={role}
      data-card-tier={art.tier}
      data-card-key={art.key}
      data-has-card-art={imagePath ? "true" : "false"}
      title={`${art.name} · ${art.expectedPath}`}
      style={{
        "--card-accent": art.accent,
        "--card-index": index,
        ...style,
      } as CSSProperties}
    >
      <div className={styles.ritualCardFace}>
        <div className={styles.ritualCardArt}>
          {imagePath ? <Image src={imagePath} alt={art.name} fill sizes="180px" unoptimized /> : (
            <div className={styles.ritualCardPlaceholder}>
              <span>{art.sigil}</span>
              <small>CARD ART</small>
            </div>
          )}
        </div>
        {!imagePath ? (
          <div className={styles.ritualCardName}>
            <strong>{art.name}</strong>
            <small>{art.tier.toUpperCase()}</small>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SummonRitualCinematic({
  cinematic,
  turn,
}: {
  cinematic: SummonCardCinematic;
  turn: number;
}) {
  const label = summonCinematicLabel(cinematic.summonKind);
  const isRa = cinematic.summonName === "翼神龙";
  const requiredMaterialCount = cinematic.summonKind === "reveal"
    ? 0
    : cinematic.summonKind === "exodia"
    ? 5
    : cinematic.summonKind === "fusion" || isRa
      ? 3
      : 2;
  const suppliedMaterials = cinematic.summonKind === "exodia"
    ? orderExodiaMaterials(cinematic.materials)
    : [...cinematic.materials];
  while (suppliedMaterials.length < requiredMaterialCount) {
    suppliedMaterials.push(`素材卡 ${suppliedMaterials.length + 1}`);
  }
  const materials = suppliedMaterials.slice(0, requiredMaterialCount);
  const productArt = getSummonCardArt(cinematic.summonName);

  return (
    <div
      className={styles.summonCinematic}
      data-summon-kind={cinematic.summonKind}
      data-summon-ritual={isRa ? "ra" : cinematic.summonKind === "tribute" ? "blue-eyes" : cinematic.summonKind}
      style={{ "--ritual-accent": productArt.accent } as CSSProperties}
      aria-live="assertive"
    >
      <div className={styles.ritualBackdrop} aria-hidden="true" />
      {productArt.cutinPath ? (
        <div className={styles.ritualMonsterGhost} data-summon-ghost={productArt.key} aria-hidden="true">
          <Image src={productArt.cutinPath} alt="" fill sizes="80vw" priority unoptimized />
        </div>
      ) : null}
      <div className={styles.ritualHeader}>
        <span>{`${label.code} // T${turn}`}</span>
        <strong>{label.title}</strong>
        <small>{cinematic.summonName}</small>
      </div>

      {cinematic.summonKind === "reveal" ? (
        <div className={styles.revealRitual}>
          <div className={styles.revealDeck} aria-hidden="true"><i /><i /><i /></div>
          <div className={styles.revealTrail} aria-hidden="true"><i /><i /><i /></div>
          <div className={styles.revealResultCard}>
            <RitualCard name={cinematic.summonName} role="result" imageOverride={cinematic.cardImage} />
          </div>
          <div className={styles.revealSeal} aria-hidden="true"><i /><i /></div>
        </div>
      ) : null}

      {cinematic.summonKind === "tribute" ? (
        <div className={styles.tributeRitual} data-material-count={materials.length}>
          <div className={styles.tributeSeal} aria-hidden="true"><i /><i /><i /></div>
          <div className={styles.tributeBeams} aria-hidden="true">
            {materials.map((_, index) => (
              <i
                key={`beam-${index}`}
                style={{ "--beam-slot": index - (materials.length - 1) / 2 } as CSSProperties}
              />
            ))}
          </div>
          <div className={styles.tributeMaterials}>
            {materials.map((material, index) => (
              <RitualCard
                key={`${material}-${index}`}
                name={material}
                role="material"
                index={index}
                style={{ "--tribute-slot": index - (materials.length - 1) / 2 } as CSSProperties}
              />
            ))}
          </div>
          <div className={styles.ritualResultCard}>
            <RitualCard name={cinematic.summonName} role="result" imageOverride={cinematic.cardImage} />
          </div>
        </div>
      ) : null}

      {cinematic.summonKind === "fusion" ? (
        <div className={styles.fusionRitual}>
          <div className={styles.fusionVortex} aria-hidden="true"><i /><i /><i /></div>
          <div className={styles.fusionMaterials}>
            {materials.map((material, index) => (
              <RitualCard
                key={`${material}-${index}`}
                name={material}
                role="material"
                index={index}
                style={{ "--fusion-slot": index - 1 } as CSSProperties}
              />
            ))}
          </div>
          <div className={styles.fusionResultCard}>
            <RitualCard name={cinematic.summonName} role="result" imageOverride={cinematic.cardImage} />
          </div>
        </div>
      ) : null}

      {cinematic.summonKind === "exodia" ? (
        <div className={styles.exodiaRitual}>
          <svg className={styles.exodiaStar} viewBox="0 0 100 100" aria-hidden="true">
            <polygon points="50,4 79,92 3,38 97,38 21,92" />
          </svg>
          <div className={styles.exodiaComponents}>
            {materials.map((material, index) => (
              <RitualCard
                key={`${material}-${index}`}
                name={material}
                role="component"
                index={index}
              />
            ))}
          </div>
          <div className={styles.exodiaResultCard}>
            <RitualCard name={cinematic.summonName} role="result" imageOverride={cinematic.cardImage} />
          </div>
        </div>
      ) : null}

      <div className={styles.ritualResultName}>
        <span>{isRa ? "DIVINE ASCENSION" : label.code}</span>
        <strong>{cinematic.summonName}</strong>
      </div>
    </div>
  );
}

function colorWithAlpha(color: string, alpha: number) {
  const normalized = color.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return color;
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

type StageFighterCardProps = {
  fighter: Fighter;
  position: StagePosition;
  isActive: boolean;
  isTarget: boolean;
  isDimmed: boolean;
  isSelected: boolean;
  visibleStatusCount: number;
  getStatusBadges: (fighter: Fighter) => NameArenaStageBadge[];
  onSelect: (fighterId: string) => void;
  registerNode: (fighterId: string, node: HTMLButtonElement | null) => void;
};

const StageFighterCard = React.memo(function StageFighterCard({
  fighter,
  position,
  isActive,
  isTarget,
  isDimmed,
  isSelected,
  visibleStatusCount,
  getStatusBadges,
  onSelect,
  registerNode,
}: StageFighterCardProps) {
  const setNodeRef = useCallback((node: HTMLButtonElement | null) => {
    registerNode(fighter.id, node);
  }, [fighter.id, registerNode]);
  const accent = getFighterAccent(fighter);
  const shield = getShield(fighter);
  const hpPercent = fighter.maxHp > 0 ? Math.max(0, Math.min(100, (fighter.currentHp / fighter.maxHp) * 100)) : 0;
  const shieldPercent = fighter.maxHp > 0 ? Math.max(0, Math.min(100, (shield / fighter.maxHp) * 100)) : 0;
  const allStatusBadges = getStatusBadges(fighter);
  const statusBadges = allStatusBadges.slice(0, visibleStatusCount);
  const hiddenStatusCount = Math.max(0, allStatusBadges.length - statusBadges.length);
  const image = getStageFighterImage(fighter);

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`${styles.fighter} ${isActive ? styles.active : ""} ${isTarget ? styles.target : ""} ${fighter.isHit ? styles.hit : ""} ${fighter.isDead ? styles.dead : ""} ${isDimmed ? styles.dimmed : ""} ${isSelected ? styles.selected : ""}`}
      style={{ "--x": `${position.x}%`, "--y": `${position.y}%`, "--accent": accent } as CSSProperties}
      onClick={() => onSelect(fighter.id)}
      aria-label={`查看 ${fighter.displayName ?? fighter.name} 状态`}
      aria-pressed={isSelected}
    >
      <span className={styles.portrait}>
        {image ? <Image src={image} alt="" fill sizes="54px" unoptimized={image.startsWith("/namearena/cards/")} /> : <span className={styles.emblem}>{fighter.jobData?.icon || fighter.name.slice(0, 1)}</span>}
        {fighter.teamId ? <span className={styles.teamBadge} style={{ "--team-color": fighter.color } as CSSProperties}>{fighter.teamId}</span> : null}
        <span className={styles.phase}>{getPhaseLabel(fighter)}</span>
      </span>
      <span className={styles.unitHud}>
        <span className={styles.unitName}>
          <span title={fighter.displayName ?? fighter.name}>{fighter.displayName ?? fighter.name}</span>
          <small>{fighter.currentHp}/{fighter.maxHp}</small>
        </span>
        <span className={styles.hpBar} style={{ "--bar-value": `${hpPercent}%` } as CSSProperties}><i /></span>
        <span className={styles.shieldBar} style={{ "--bar-value": `${shieldPercent}%` } as CSSProperties}><i /></span>
        <span className={styles.unitBadges}>
          {statusBadges.map((badge) => <span key={badge.key} title={badge.detail}>{badge.icon} {badge.label}</span>)}
          {hiddenStatusCount > 0 ? (
            <span className={styles.moreBadge} title={allStatusBadges.slice(visibleStatusCount).map((badge) => badge.label).join("、")}>+{hiddenStatusCount}</span>
          ) : null}
          {fighter.isDead ? <span className={styles.koBadge}>已退场</span> : null}
        </span>
      </span>
    </button>
  );
});

type StageFighterLayerProps = {
  fighters: Fighter[];
  positionById: Map<string, StagePosition>;
  activeActorId?: string;
  targetIdSet: Set<string>;
  selectedFighterId?: string;
  visibleStatusCount: number;
  getStatusBadges: (fighter: Fighter) => NameArenaStageBadge[];
  onSelect: (fighterId: string) => void;
  onClearFocus: () => void;
  registerNode: (fighterId: string, node: HTMLButtonElement | null) => void;
};

const StageFighterLayer = React.memo(function StageFighterLayer({
  fighters,
  positionById,
  activeActorId,
  targetIdSet,
  selectedFighterId,
  visibleStatusCount,
  getStatusBadges,
  onSelect,
  onClearFocus,
  registerNode,
}: StageFighterLayerProps) {
  return (
    <div
      className={styles.fighterLayer}
      data-stage-empty-surface="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClearFocus();
      }}
    >
      {fighters.map((fighter) => {
        const position = positionById.get(fighter.id) ?? { x: 50, y: 47 };
        const isTarget = targetIdSet.has(fighter.id);
        const isActive = fighter.id === activeActorId || Boolean(fighter.isActing);
        return (
          <StageFighterCard
            key={fighter.id}
            fighter={fighter}
            position={position}
            isActive={isActive}
            isTarget={isTarget}
            isDimmed={Boolean(activeActorId && !isActive && !isTarget)}
            isSelected={selectedFighterId === fighter.id}
            visibleStatusCount={visibleStatusCount}
            getStatusBadges={getStatusBadges}
            onSelect={onSelect}
            registerNode={registerNode}
          />
        );
      })}
    </div>
  );
});

const StageActionBanner = React.memo(function StageActionBanner({
  activeLog,
  battleTurn,
  accent,
}: {
  activeLog?: ArenaBattleLogEntry;
  battleTurn: number;
  accent: string;
}) {
  const title = getActionTitle(activeLog);
  const subtitle = activeLog?.text ?? "等待战斗事件";
  return (
    <div className={styles.actionBanner} style={{ "--event-accent": accent } as CSSProperties}>
      <span>{`${activeLog?.type?.toUpperCase() ?? "ARENA"} // EVENT ${String(activeLog?.sequence ?? battleTurn).padStart(3, "0")}`}</span>
      <strong>{title}</strong>
      <small title={subtitle}>{subtitle}</small>
    </div>
  );
});

const StageRoundOrbit = React.memo(function StageRoundOrbit({
  number,
  acted,
  total,
}: Pick<RoundProgress, "number" | "acted" | "total">) {
  return (
    <div className={styles.roundOrbit} aria-hidden="true">
      <span>ROUND</span>
      <b>{String(number).padStart(2, "0")}</b>
      <small>{acted}/{total}</small>
    </div>
  );
});

const StagePopupLayer = React.memo(function StagePopupLayer({
  popups,
  positionById,
}: {
  popups: Popup[];
  positionById: Map<string, StagePosition>;
}) {
  return (
    <div className={styles.popupLayer} aria-hidden="true">
      {popups.map((popup) => {
        const position = positionById.get(popup.fighterId) ?? { x: 50, y: 47 };
        return (
          <span
            key={popup.id}
            className={`${styles.popup} ${styles[popup.kind]}`}
            style={{ left: `${position.x}%`, top: `${position.y}%` }}
            data-label={popup.label}
          >
            {popup.value}
          </span>
        );
      })}
    </div>
  );
});

const StageDossier = React.memo(function StageDossier({
  fighter,
  statuses,
  resources,
  accent,
  isManualFocus,
  focusCycleKey,
}: {
  fighter?: Fighter;
  statuses: NameArenaStageBadge[];
  resources: NameArenaStageBadge[];
  accent: string;
  isManualFocus: boolean;
  focusCycleKey: string;
}) {
  if (!fighter) return null;
  return (
    <div
      className={styles.dossier}
      style={{ "--selected-accent": accent } as CSSProperties}
      data-focus-mode={isManualFocus ? "manual" : "actor"}
      data-focus-cycle={focusCycleKey}
      data-focused-fighter-id={fighter.id}
    >
      <i />
      <div className={styles.dossierBody}>
        <div className={styles.dossierHeading}>
          <div>
            <span>{fighter.jobData?.name ?? "未知职业"}</span>
            <strong>{fighter.displayName ?? fighter.name}</strong>
            <small className={styles.dossierVital}>生命 {fighter.currentHp.toLocaleString()} / {fighter.maxHp.toLocaleString()}</small>
          </div>
          <dl>
            <div><dt>攻</dt><dd>{fighter.atk}</dd></div>
            <div><dt>防</dt><dd>{fighter.def}</dd></div>
            <div><dt>速</dt><dd>{fighter.spd}</dd></div>
            <div><dt>敏</dt><dd>{fighter.agl}</dd></div>
            <div><dt>魔</dt><dd>{fighter.mag}</dd></div>
            <div><dt>抗</dt><dd>{fighter.res}</dd></div>
            <div><dt>智</dt><dd>{fighter.wis}</dd></div>
            <div><dt>暴</dt><dd>{Math.round(fighter.critRate * 100)}%</dd></div>
            <div><dt>盾</dt><dd>{getShield(fighter)}</dd></div>
          </dl>
        </div>
        <div className={styles.dossierBadges}>
          {[...statuses, ...resources].map((badge) => (
            <span key={badge.key} data-tone={badge.tone} title={badge.detail}>{badge.icon} {badge.label}</span>
          ))}
          {statuses.length + resources.length === 0 ? <small>当前没有额外状态或资源</small> : null}
        </div>
      </div>
    </div>
  );
});

const StageArenaFooter = React.memo(function StageArenaFooter({
  threat,
  actorName,
  actorAccent,
  battleTurn,
  roundNumber,
}: {
  threat: number;
  actorName: string;
  actorAccent: string;
  battleTurn: number;
  roundNumber: number;
}) {
  return (
    <div className={styles.arenaFooter}>
      <div className={styles.threat}>
        <span>战场烈度</span>
        <div><i style={{ width: `${threat}%` }} /></div>
        <b>{threat >= 90 ? "极危" : threat >= 70 ? "激战" : "交战"}</b>
      </div>
      <div className={styles.currentActor}>
        <span>当前镜头</span>
        <b style={{ color: actorAccent }}>{actorName}</b>
        <small>T{battleTurn} / R{roundNumber}</small>
      </div>
    </div>
  );
});

const StagePulseButton = React.memo(function StagePulseButton({
  fighter,
  isActive,
  onSelect,
}: {
  fighter: Fighter;
  isActive: boolean;
  onSelect: (fighterId: string) => void;
}) {
  const image = getStageFighterImage(fighter);
  return (
    <button
      type="button"
      title={fighter.displayName ?? fighter.name}
      aria-label={`聚焦 ${fighter.displayName ?? fighter.name}`}
      onClick={() => onSelect(fighter.id)}
      className={isActive ? styles.pulseActive : ""}
      style={{ "--pulse-accent": getFighterAccent(fighter) } as CSSProperties}
    >
      {image ? (
        <Image src={image} alt="" fill sizes="34px" unoptimized={image.startsWith("/namearena/cards/")} />
      ) : (
        <span className={styles.pulseGlyph}>{fighter.jobData?.icon || fighter.name.slice(0, 1)}</span>
      )}
    </button>
  );
});

const StagePulseStrip = React.memo(function StagePulseStrip({
  fighters,
  activeActorId,
  onSelect,
}: {
  fighters: Fighter[];
  activeActorId?: string;
  onSelect: (fighterId: string) => void;
}) {
  return (
    <div className={styles.pulseStrip} aria-label="场上单位">
      <div className={styles.pulseList}>
        {fighters.slice(0, 12).map((fighter) => (
          <StagePulseButton
            key={fighter.id}
            fighter={fighter}
            isActive={fighter.id === activeActorId}
            onSelect={onSelect}
          />
        ))}
      </div>
      {fighters.length > 12 ? <span className={styles.pulseMore}>+{fighters.length - 12}</span> : null}
    </div>
  );
});

const StageLogGroupCard = React.memo(function StageLogGroupCard({
  group,
  turn,
  round,
  actorAccent,
  namePattern,
  nameAccentByName,
}: {
  group: StageLogGroup;
  turn: number;
  round: number;
  actorAccent: string;
  namePattern: RegExp | null;
  nameAccentByName: Map<string, string>;
}) {
  const latest = group.logs[group.logs.length - 1];
  const tone = getLogGroupTone(group);
  const renderText = (text: string) => {
    if (!namePattern) return text;
    return text.split(namePattern).map((part, index) => {
      const accent = nameAccentByName.get(part);
      if (!accent) return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
      return <strong key={`${part}-${index}`} style={{ color: accent }}>{part}</strong>;
    });
  };
  return (
    <article className={styles.logGroup} data-tone={tone} style={{ "--log-accent": actorAccent } as CSSProperties}>
      <header>
        <div>
          <span>{TYPE_LABELS[latest.type] ?? "事件"}</span>
          <strong>{group.skillName || getActionTitle(latest)}{group.partCount > 1 ? ` · ${group.part}/${group.partCount}` : ""}</strong>
        </div>
        <time>T{turn} · R{round}</time>
      </header>
      {group.logs.map((log, index) => <p key={log.id ?? `${group.key}-${index}`}>{renderText(log.text)}</p>)}
    </article>
  );
});

type StageFeedPanelProps = {
  feedRef: React.RefObject<HTMLDivElement>;
  fighters: Fighter[];
  activeActorId?: string;
  logGroups: StageLogGroup[];
  battleTurn: number;
  roundNumber: number;
  gameState: "FIGHTING" | "END";
  isAutoScroll: boolean;
  namePattern: RegExp | null;
  nameAccentByName: Map<string, string>;
  fighterAccentById: Map<string, string>;
  onSelectFighter: (fighterId: string) => void;
  onToggleAutoScroll: () => void;
  onReset: () => void;
  onOpenFullLog: () => void;
  onDownloadLogs: () => void;
  onDownloadReplay: () => void;
};

const StageFeedPanel = React.memo(function StageFeedPanel({
  feedRef,
  fighters,
  activeActorId,
  logGroups,
  battleTurn,
  roundNumber,
  gameState,
  isAutoScroll,
  namePattern,
  nameAccentByName,
  fighterAccentById,
  onSelectFighter,
  onToggleAutoScroll,
  onReset,
  onOpenFullLog,
  onDownloadLogs,
  onDownloadReplay,
}: StageFeedPanelProps) {
  return (
    <aside className={styles.feed} aria-label="实时战斗记录">
      <header className={styles.feedHeader}>
        <div>
          <span>COMBAT FEED // LIVE</span>
          <strong>实时战斗记录</strong>
        </div>
        <div className={styles.feedActions}>
          {gameState === "END" ? (
            <>
              <button type="button" onClick={onOpenFullLog} title="打开完整战报">战报</button>
              <button type="button" onClick={onDownloadLogs} title="导出 TXT 战斗日志">TXT</button>
              <button type="button" onClick={onDownloadReplay} title="导出 JSON 回放">JSON</button>
            </>
          ) : (
            <button type="button" onClick={onToggleAutoScroll} title={isAutoScroll ? "暂停自动跟随" : "恢复自动跟随"}>{isAutoScroll ? "暂停" : "跟随"}</button>
          )}
          <button type="button" onClick={onReset} title="重置大厅" aria-label="重置大厅">↻</button>
        </div>
      </header>

      <StagePulseStrip fighters={fighters} activeActorId={activeActorId} onSelect={onSelectFighter} />

      <div ref={feedRef} className={styles.feedScroll}>
        {logGroups.map((group) => (
          <StageLogGroupCard
            key={group.key}
            group={group}
            turn={group.turn ?? battleTurn}
            round={group.largeRound ?? roundNumber}
            actorAccent={group.actorId ? fighterAccentById.get(group.actorId) ?? "#9aa8b4" : "#9aa8b4"}
            namePattern={namePattern}
            nameAccentByName={nameAccentByName}
          />
        ))}
      </div>

      <footer className={styles.feedFooter}>
        <span><i data-tone="skill" />技能</span>
        <span><i data-tone="death" />击杀</span>
        <span><i data-tone="heal" />恢复</span>
        <b>● 快照同步</b>
      </footer>
    </aside>
  );
});

export function NameArenaBattleStage({
  fighters,
  displayLogs,
  logGroups,
  battleTurn,
  battleRunId,
  roundProgress,
  aliveCount,
  gameState,
  mobileView,
  setMobileView,
  isAutoScroll,
  onToggleAutoScroll,
  onReset,
  onOpenFullLog,
  onDownloadLogs,
  onDownloadReplay,
  getStatusBadges,
  getResourceBadges,
  mvpOverlay,
}: NameArenaBattleStageProps) {
  const [manualFocus, setManualFocus] = useState<StageManualFocus | null>(null);
  const [popups, setPopups] = useState<Popup[]>([]);
  const [cinematic, setCinematic] = useState<Cinematic | null>(null);
  const [impactToken, setImpactToken] = useState(0);
  const [showImpact, setShowImpact] = useState(false);
  const [impactTheme, setImpactTheme] = useState<"generic" | CombatImpactTheme>("generic");
  const [isGlitching, setIsGlitching] = useState(false);
  const [arenaSize, setArenaSize] = useState({ width: 1200, height: 720 });
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(true);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const arenaRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const previousSnapshotRef = useRef(new Map<string, { hp: number; shield: number; dead: boolean }>());
  const particlesRef = useRef<Particle[]>([]);
  const beamsRef = useRef<Beam[]>([]);
  const tingCombatFxRef = useRef<TingCombatFx[]>([]);
  const gachaCombatFxRef = useRef<GachaCombatFx[]>([]);
  const wakeFxLoopRef = useRef<() => void>(() => {});
  const stopFxLoopRef = useRef<() => void>(() => {});
  const stageFxSuspendedRef = useRef(false);
  const [animationScheduler] = useState(() => new StageAnimationScheduler());
  const combatFxSequenceRef = useRef(0);
  const popupSequenceRef = useRef(0);
  const fighterMotionAnimationsRef = useRef(new Map<string, FighterMotionRuntime>());
  const lastProcessedVisualEventKeyRef = useRef<string | null>(null);
  const lastVisualActionKeyRef = useRef<string | null>(null);
  const animatedAttackActionKeysRef = useRef(new Set<string>());
  const lastFinisherKeyRef = useRef<string | null>(null);
  const developmentSummonPreviewRef = useRef<SummonCardCinematic | null>(null);
  const developmentTingPreviewRef = useRef<string | null>(null);
  const developmentTingPreviewPlayedRef = useRef(false);
  const developmentGachaPreviewRef = useRef<BattleCombatEffectId | null>(null);
  const developmentGachaPreviewPlayedRef = useRef(false);
  const developmentFinisherPreviewRef = useRef<FinisherCinematic | null>(null);

  const stageFighters = useMemo(() => fighters.filter(shouldRenderFighterOnStage), [fighters]);
  const stageRosterKey = stageFighters.map((fighter) => fighter.id).join("\u001f");
  const densityPopulation = stageFighters.length;
  const stageDensity = densityPopulation > 18 ? "crowded" : densityPopulation > 12 ? "dense" : densityPopulation > 6 ? "compact" : "normal";
  const positionById = useMemo(
    () => createStagePositionMap(stageRosterKey ? stageRosterKey.split("\u001f") : [], arenaSize.width, arenaSize.height),
    [arenaSize.height, arenaSize.width, stageRosterKey],
  );
  const fighterById = useMemo(() => new Map(fighters.map((fighter) => [fighter.id, fighter])), [fighters]);
  const stageFighterById = useMemo(() => new Map(stageFighters.map((fighter) => [fighter.id, fighter])), [stageFighters]);
  const activeLog = displayLogs[displayLogs.length - 1];

  const actor = useMemo(() => {
    if (activeLog?.actorId) return fighterById.get(activeLog.actorId);
    return fighters.find((fighter) => fighter.isActing) ?? fighters.find((fighter) => activeLog?.text.includes(fighter.name));
  }, [activeLog, fighterById, fighters]);
  const activeActorId = actor?.id;
  const targetIds = useMemo(() => {
    if (!activeLog) return [];
    const explicitTargets = (activeLog.targetIds ?? []).filter((id) => fighterById.has(id));
    const hitTargets = fighters.filter((fighter) => fighter.isHit && fighter.id !== activeActorId).map((fighter) => fighter.id);
    const namedTargets = fighters
      .filter((fighter) => fighter.id !== activeActorId && activeLog.text.includes(fighter.name))
      .map((fighter) => fighter.id);
    return [...new Set(explicitTargets.length > 0 ? explicitTargets : hitTargets.length > 0 ? hitTargets : namedTargets)];
  }, [activeActorId, activeLog, fighterById, fighters]);
  const targetIdSet = useMemo(() => new Set(targetIds), [targetIds]);
  const focusCycleKey = getStageFocusCycleKey(activeLog, battleRunId, battleTurn, activeActorId);
  const focusCycleKeyRef = useRef(focusCycleKey);
  const selectedId = resolveStageManualFocusId(manualFocus, focusCycleKey);
  const selectedFighter = stageFighterById.get(selectedId ?? "")
    ?? (actor && stageFighterById.has(actor.id) ? actor : undefined)
    ?? stageFighters.find((fighter) => !fighter.isDead)
    ?? stageFighters[0];
  const selectedStatuses = useMemo(
    () => selectedFighter ? getStatusBadges(selectedFighter) : [],
    [getStatusBadges, selectedFighter],
  );
  const selectedResources = useMemo(
    () => selectedFighter ? getResourceBadges(selectedFighter) : [],
    [getResourceBadges, selectedFighter],
  );
  const displayOrder = stageFighters;
  const paletteKey = JSON.stringify(fighters.map((fighter) => [
    fighter.id,
    fighter.name,
    getFighterAccent(fighter),
  ]));
  const { namePattern, nameAccentByName, fighterAccentById } = useMemo(() => {
    const entries = JSON.parse(paletteKey) as Array<[string, string, string]>;
    const orderedNames = entries.map(([, name]) => name).filter(Boolean).sort((a, b) => b.length - a.length);
    return {
      namePattern: orderedNames.length > 0 ? new RegExp(`(${orderedNames.map(escapeRegExp).join("|")})`, "g") : null,
      nameAccentByName: new Map(entries.map(([, name, accent]) => [name, accent])),
      fighterAccentById: new Map(entries.map(([id, , accent]) => [id, accent])),
    };
  }, [paletteKey]);
  const assetManifestKey = JSON.stringify(collectStageAssetManifest(fighters));
  const visibleStatusCount = densityPopulation > 6 ? 1 : 2;
  const stageFxSuspended = !isPageVisible || mobileView === "logs" || cinematic !== null;

  useEffect(() => {
    focusCycleKeyRef.current = focusCycleKey;
  }, [focusCycleKey]);

  useEffect(() => {
    stageFxSuspendedRef.current = stageFxSuspended;
  }, [stageFxSuspended]);

  const selectFighterForCurrentAction = useCallback((fighterId: string) => {
    const currentFocusCycleKey = focusCycleKeyRef.current;
    setManualFocus((current) => (
      current?.fighterId === fighterId && current.focusCycleKey === currentFocusCycleKey
        ? null
        : { fighterId, focusCycleKey: currentFocusCycleKey }
    ));
  }, []);

  const clearManualFocus = useCallback(() => setManualFocus(null), []);
  const selectFighterFromFeed = useCallback((fighterId: string) => {
    selectFighterForCurrentAction(fighterId);
    setMobileView("arena");
  }, [selectFighterForCurrentAction, setMobileView]);

  const registerFighterNode = useCallback((fighterId: string, node: HTMLButtonElement | null) => {
    if (node) nodeRefs.current.set(fighterId, node);
    else nodeRefs.current.delete(fighterId);
  }, []);

  useEffect(() => {
    const manifest = JSON.parse(assetManifestKey) as StageAssetManifest;
    return preloadStageAssetManifest(manifest);
  }, [assetManifestKey]);

  const clearImpactTimers = useCallback(() => {
    animationScheduler.cancel("impact");
  }, [animationScheduler]);

  const clearFighterMotions = useCallback(() => {
    const motions = [...fighterMotionAnimationsRef.current.values()];
    fighterMotionAnimationsRef.current.clear();
    motions.forEach(({ node, animation }) => {
      animation.onfinish = null;
      animation.oncancel = null;
      animation.cancel();
      node.removeAttribute("data-combat-motion");
    });
  }, []);

  const playCombatImpact = useCallback((
    theme: "generic" | CombatImpactTheme,
    duration: number,
    delay = 0,
  ) => {
    const generation = animationScheduler.begin("impact");
    const show = () => {
      if (stageFxSuspendedRef.current || document.hidden) return;
      setImpactToken((value) => value + 1);
      setImpactTheme(theme);
      setShowImpact(true);
      animationScheduler.after("impact", prefersReducedMotion ? 40 : duration, () => {
        setShowImpact(false);
      }, generation);
    };
    if (!prefersReducedMotion && delay > 0) {
      animationScheduler.after("impact", delay, show, generation);
    } else {
      show();
    }
  }, [animationScheduler, prefersReducedMotion]);

  useEffect(() => {
    animationScheduler.reset();
    previousSnapshotRef.current.clear();
    lastProcessedVisualEventKeyRef.current = null;
    lastVisualActionKeyRef.current = null;
    animatedAttackActionKeysRef.current.clear();
    lastFinisherKeyRef.current = null;
    clearImpactTimers();
    clearFighterMotions();
    beamsRef.current = [];
    particlesRef.current = [];
    tingCombatFxRef.current = [];
    gachaCombatFxRef.current = [];
    combatFxSequenceRef.current = 0;
    developmentSummonPreviewRef.current = readDevelopmentSummonPreview();
    developmentTingPreviewRef.current = readDevelopmentTingPreview();
    developmentTingPreviewPlayedRef.current = false;
    developmentGachaPreviewRef.current = readDevelopmentGachaPreview();
    developmentGachaPreviewPlayedRef.current = false;
    developmentFinisherPreviewRef.current = readDevelopmentFinisherPreview();
    const generation = animationScheduler.begin("battle-init");
    animationScheduler.frame("battle-init", () => {
      setCinematic(developmentSummonPreviewRef.current ?? developmentFinisherPreviewRef.current);
      setShowImpact(false);
      setImpactTheme("generic");
      setIsGlitching(false);
    }, generation);
    return () => animationScheduler.cancel("battle-init");
  }, [animationScheduler, battleRunId, clearFighterMotions, clearImpactTimers]);

  const playCinematic = useCallback((next: Cinematic, duration: number) => {
    const generation = animationScheduler.begin("cinematic");
    stageFxSuspendedRef.current = true;
    setShowImpact(false);
    setCinematic(next);
    animationScheduler.after("cinematic", prefersReducedMotion ? 80 : duration, () => {
      setCinematic((current) => current === next ? null : current);
    }, generation);
  }, [animationScheduler, prefersReducedMotion]);

  const stopCinematic = useCallback(() => {
    animationScheduler.cancel("cinematic");
    setCinematic(null);
  }, [animationScheduler]);

  useEffect(() => () => {
    animationScheduler.reset();
    clearImpactTimers();
    clearFighterMotions();
  }, [animationScheduler, clearFighterMotions, clearImpactTimers]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const update = () => setIsPageVisible(!document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const generation = animationScheduler.begin("suspension");
    if (!stageFxSuspended) {
      wakeFxLoopRef.current();
      return () => animationScheduler.cancel("suspension");
    }
    stopFxLoopRef.current();
    particlesRef.current = [];
    beamsRef.current = [];
    tingCombatFxRef.current = [];
    gachaCombatFxRef.current = [];
    clearImpactTimers();
    clearFighterMotions();
    animationScheduler.frame("suspension", () => setShowImpact(false), generation);
    return () => animationScheduler.cancel("suspension");
  }, [animationScheduler, clearFighterMotions, clearImpactTimers, stageFxSuspended]);

  const getNodeCenter = useCallback((fighterId: string) => {
    const arena = arenaRef.current;
    const node = nodeRefs.current.get(fighterId);
    if (!arena || !node) return null;
    const arenaRect = arena.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    return {
      x: nodeRect.left - arenaRect.left + nodeRect.width / 2,
      y: nodeRect.top - arenaRect.top + nodeRect.height / 2,
    };
  }, []);

  const playCombatActorMotion = useCallback((
    cue: CombatEffectCue,
    actorId: string,
    targetId?: string,
  ) => {
    if (cue.actorMotion === "stationary" || !targetId || prefersReducedMotion || stageFxSuspendedRef.current || document.hidden) return;
    const actorNode = nodeRefs.current.get(actorId);
    const targetNode = nodeRefs.current.get(targetId);
    if (!actorNode || !targetNode || typeof actorNode.animate !== "function") return;
    const plan = createCombatActorMotionPlan(
      cue.actorMotion,
      actorNode.getBoundingClientRect(),
      targetNode.getBoundingClientRect(),
    );
    if (!plan) return;

    const previous = fighterMotionAnimationsRef.current.get(actorId);
    if (previous) {
      previous.animation.onfinish = null;
      previous.animation.oncancel = null;
      previous.animation.cancel();
      previous.node.removeAttribute("data-combat-motion");
    }

    actorNode.dataset.combatMotion = cue.actorMotion;
    const animation = actorNode.animate(
      plan.frames.map((frame) => ({
        offset: frame.offset,
        translate: `${frame.x}px ${frame.y}px`,
        ...(frame.easing ? { easing: frame.easing } : {}),
      })),
      { duration: plan.durationMs, easing: "linear", fill: "none" },
    );
    const runtime = { node: actorNode, animation };
    fighterMotionAnimationsRef.current.set(actorId, runtime);
    const release = () => {
      if (fighterMotionAnimationsRef.current.get(actorId) !== runtime) return;
      fighterMotionAnimationsRef.current.delete(actorId);
      actorNode.removeAttribute("data-combat-motion");
    };
    animation.onfinish = release;
    animation.oncancel = release;
  }, [prefersReducedMotion]);

  const runAfterSelfDestructReturn = useCallback((fighterId: string, callback: () => void) => {
    const runtime = fighterMotionAnimationsRef.current.get(fighterId);
    if (!runtime || runtime.node.dataset.combatMotion !== "self_destruct_cling") {
      callback();
      return;
    }
    void runtime.animation.finished
      .catch(() => undefined)
      .then(() => {
        if (runtime.node.isConnected) callback();
      });
  }, []);

  const spawnBurst = useCallback((fighterId: string, color: string, amount = 30, force = 4.5) => {
    if (stageFxSuspendedRef.current || document.hidden) return;
    const center = getNodeCenter(fighterId);
    if (!center) return;
    const available = Math.max(0, MAX_GENERIC_PARTICLES - particlesRef.current.length);
    const particleCount = Math.min(amount, available);
    for (let index = 0; index < particleCount; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = 0.8 + Math.random() * force;
      particlesRef.current.push({
        x: center.x,
        y: center.y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        size: 1.5 + Math.random() * 3.5,
        life: 420 + Math.random() * 520,
        maxLife: 940,
        color,
      });
    }
    wakeFxLoopRef.current();
  }, [getNodeCenter]);

  const spawnBeam = useCallback((actorId: string, targetId: string, color: string) => {
    if (stageFxSuspendedRef.current || document.hidden) return;
    const from = getNodeCenter(actorId);
    const to = getNodeCenter(targetId);
    if (!from || !to) return;
    beamsRef.current.push({
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      width: 4 + Math.random() * 4,
      life: 520,
      maxLife: 520,
      color,
    });
    keepNewest(beamsRef.current, MAX_GENERIC_BEAMS);
    const particleCount = Math.min(22, Math.max(0, MAX_GENERIC_PARTICLES - particlesRef.current.length));
    for (let index = 0; index < particleCount; index += 1) {
      const ratio = particleCount > 0 ? index / particleCount : 0;
      particlesRef.current.push({
        x: from.x + (to.x - from.x) * ratio,
        y: from.y + (to.y - from.y) * ratio,
        vx: (Math.random() - 0.5) * 1.4,
        vy: (Math.random() - 0.5) * 1.4,
        size: 1 + Math.random() * 2.5,
        life: 360,
        maxLife: 360,
        color,
      });
    }
    wakeFxLoopRef.current();
  }, [getNodeCenter]);

  const spawnTingEffect = useCallback((
    cue: TingCombatEffectCue,
    actorId: string,
    effectTargetIds: string[],
  ) => {
    if (stageFxSuspendedRef.current || document.hidden) return;
    const from = getNodeCenter(actorId);
    const arena = arenaRef.current;
    if (!from || !arena) return;
    const desiredMargin = cue.motion === "detonation"
      ? 108
      : cue.motion === "spinal_cleave" || cue.motion === "grudge_rend"
        ? 76
        : cue.motion === "wail" || cue.motion === "blood_mist" || cue.motion === "blood_feast"
          ? 64
          : 42;
    const horizontalMargin = Math.min(desiredMargin, arena.clientWidth * 0.18);
    const verticalMargin = Math.min(desiredMargin, arena.clientHeight * 0.18);
    const actorNode = nodeRefs.current.get(actorId);
    const destinations = effectTargetIds
      .map((targetId) => {
        const targetCenter = getNodeCenter(targetId);
        const targetNode = nodeRefs.current.get(targetId);
        if (
          !targetCenter ||
          cue.actorMotion !== "self_destruct_cling" ||
          prefersReducedMotion ||
          !actorNode ||
          !targetNode
        ) return targetCenter;
        const plan = createCombatActorMotionPlan(
          cue.actorMotion,
          actorNode.getBoundingClientRect(),
          targetNode.getBoundingClientRect(),
        );
        return plan
          ? { x: from.x + plan.destination.x, y: from.y + plan.destination.y }
          : targetCenter;
      })
      .filter((point): point is { x: number; y: number } => Boolean(point))
      .map((point) => ({
        x: Math.max(horizontalMargin, Math.min(arena.clientWidth - horizontalMargin, point.x)),
        y: Math.max(verticalMargin, Math.min(arena.clientHeight - verticalMargin, point.y)),
      }));
    const effects = createTingCombatFx(
      cue,
      from,
      destinations,
      ++combatFxSequenceRef.current,
      prefersReducedMotion,
    );
    tingCombatFxRef.current.push(...effects);
    keepNewest(tingCombatFxRef.current, MAX_CHARACTER_FX);
    wakeFxLoopRef.current();
  }, [getNodeCenter, prefersReducedMotion]);

  const spawnGachaEffect = useCallback((
    cue: GachaCombatEffectCue,
    sourceId: string,
    effectTargetIds: string[],
    metadata: { label?: string; count?: number } = {},
  ) => {
    if (stageFxSuspendedRef.current || document.hidden) return;
    const from = getNodeCenter(sourceId);
    const arena = arenaRef.current;
    if (!from || !arena) return;
    const margin = Math.min(92, arena.clientWidth * 0.15, arena.clientHeight * 0.2);
    const destinations = effectTargetIds
      .map((targetId) => getNodeCenter(targetId))
      .filter((point): point is { x: number; y: number } => Boolean(point))
      .map((point) => ({
        x: Math.max(margin, Math.min(arena.clientWidth - margin, point.x)),
        y: Math.max(margin, Math.min(arena.clientHeight - margin, point.y)),
      }));
    const effects = createGachaCombatFx(
      cue,
      from,
      destinations,
      ++combatFxSequenceRef.current,
      prefersReducedMotion,
      metadata,
    );
    gachaCombatFxRef.current.push(...effects);
    keepNewest(gachaCombatFxRef.current, MAX_CHARACTER_FX);
    wakeFxLoopRef.current();
  }, [getNodeCenter, prefersReducedMotion]);

  useEffect(() => {
    const previewSkill = developmentTingPreviewRef.current;
    if (!previewSkill || developmentTingPreviewPlayedRef.current) return;
    const arena = arenaRef.current;
    if (
      !arena ||
      Math.abs(arena.clientWidth - arenaSize.width) > 2 ||
      Math.abs(arena.clientHeight - arenaSize.height) > 2
    ) return;
    const previewActor = stageFighters.find((fighter) => fighter.isTing && !fighter.isDead);
    const previewTarget = stageFighters.find((fighter) => fighter.id !== previewActor?.id && !fighter.isDead);
    if (!previewActor || !previewTarget || !getNodeCenter(previewActor.id) || !getNodeCenter(previewTarget.id)) return;

    const skillNames: Record<string, string> = {
      basic: "普通攻击",
      spinal_slash: "脊髓剑·斩",
      blood_mist: "血雾爆发",
      grudge_rend: "怨念裂斩",
      grudge_blood_feast: "血怨吞噬",
      grudge_wail: "怨灵尖啸",
      bone_guard: "骨血架势",
      red_fury_rng: "红温",
      suicide_rng: "以命换命",
      suicide_bomb: "自爆",
      summon_puppet_ting: "召唤小汀",
    };
    const previewEvent: ArenaBattleLogEntry = {
      type: previewSkill === "bone_guard" ? "buff" : "skill",
      text: previewSkill === "suicide_rng"
        ? `${previewActor.name} 驾驶自爆卡车冲向 ${previewTarget.name}。`
        : `${previewActor.name} 对 ${previewTarget.name} 施放【${skillNames[previewSkill]}】。`,
      skillId: previewSkill === "basic" ? null : previewSkill,
      skillName: skillNames[previewSkill],
      presentation: previewSkill === "basic" ? "basic" : previewSkill === "suicide_bomb" ? "finisher" : "skill",
      actorId: previewActor.id,
      targetIds: [previewTarget.id],
    };
    const cue = resolveCombatEffect(previewEvent, previewActor);
    if (!cue) return;
    developmentTingPreviewPlayedRef.current = true;

    const generation = animationScheduler.begin("preview:ting");
    animationScheduler.after("preview:ting", prefersReducedMotion ? 0 : 220, () => {
      animationScheduler.frame("preview:ting", () => {
        playCombatActorMotion(cue, previewActor.id, previewTarget.id);
        if (cue.theme === "ting") spawnTingEffect(cue, previewActor.id, [previewTarget.id]);
        const timing = getCombatActorMotionTiming(cue.actorMotion, prefersReducedMotion);
        playCombatImpact(
          cue.impact,
          cue.impact === "ting_detonation" ? 1180 : 780,
          timing.impactDelayMs,
        );
        if (cue.presentation === "finisher") {
          playCinematic({
            kind: "finisher",
            fighterId: previewActor.id,
            name: previewActor.name,
            kicker: "FINISHER // EFFECT PREVIEW",
            title: previewEvent.skillName ?? "自爆",
            image: getStageFighterImage(previewActor),
            theme: "ting_blood",
            targetName: previewTarget.name,
          }, 2100);
        }
      }, generation);
    }, generation);
    return () => animationScheduler.cancel("preview:ting");
  }, [animationScheduler, arenaSize.height, arenaSize.width, getNodeCenter, playCinematic, playCombatActorMotion, playCombatImpact, prefersReducedMotion, spawnTingEffect, stageFighters]);

  useEffect(() => {
    const effectId = developmentGachaPreviewRef.current;
    if (!effectId || developmentGachaPreviewPlayedRef.current) return;
    const arena = arenaRef.current;
    if (
      !arena ||
      Math.abs(arena.clientWidth - arenaSize.width) > 2 ||
      Math.abs(arena.clientHeight - arenaSize.height) > 2
    ) return;
    const previewActor = stageFighters.find((fighter) => fighter.isGacha && !fighter.isDead);
    const previewTarget = stageFighters.find((fighter) => fighter.id !== previewActor?.id && !fighter.isDead);
    const previewFrom = previewActor ? getNodeCenter(previewActor.id) : null;
    const previewTo = previewTarget ? getNodeCenter(previewTarget.id) : null;
    if (!previewActor || !previewTarget || !previewFrom || !previewTo) return;
    const previewEvent: ArenaBattleLogEntry = {
      type: "skill",
      text: `${previewActor.name}触发开发特效 ${effectId}。`,
      skillId: "gacha_effect_preview",
      skillName: effectId,
      presentation: "skill",
      actorId: previewActor.id,
      targetIds: [previewTarget.id],
      visualCue: {
        kind: "combat_fx",
        effectId,
        sourceId: previewActor.id,
        targetIds: [previewTarget.id],
        label: effectId === "gacha_exodia_piece" ? "被封印者的右腕" : undefined,
        count: effectId === "gacha_exodia_piece" ? 3 : undefined,
      },
    };
    const cue = resolveCombatEffect(previewEvent);
    if (!cue || cue.theme !== "gacha") return;
    developmentGachaPreviewPlayedRef.current = true;

    const generation = animationScheduler.begin("preview:gacha");
    animationScheduler.after("preview:gacha", prefersReducedMotion ? 0 : 220, () => {
      animationScheduler.frame("preview:gacha", () => {
        gachaCombatFxRef.current.push(...createGachaCombatFx(
          cue,
          previewFrom,
          [previewTo],
          ++combatFxSequenceRef.current,
          prefersReducedMotion,
          {
            label: previewEvent.visualCue?.kind === "combat_fx" ? previewEvent.visualCue.label : undefined,
            count: previewEvent.visualCue?.kind === "combat_fx" ? previewEvent.visualCue.count : undefined,
          },
        ));
        keepNewest(gachaCombatFxRef.current, MAX_CHARACTER_FX);
        wakeFxLoopRef.current();
        if (cue.stageImpact) {
          playCombatImpact(cue.impact, 680, getCombatActorMotionTiming(cue.actorMotion, prefersReducedMotion).impactDelayMs);
        }
      }, generation);
    }, generation);
    return () => animationScheduler.cancel("preview:gacha");
  }, [animationScheduler, arenaSize.height, arenaSize.width, getNodeCenter, playCombatImpact, prefersReducedMotion, stageFighters]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const arena = arenaRef.current;
    if (!canvas || !arena) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let animationFrame = 0;
    let previousTime = performance.now();

    const hasActiveEffects = () =>
      particlesRef.current.length > 0 ||
      beamsRef.current.length > 0 ||
      tingCombatFxRef.current.length > 0 ||
      gachaCombatFxRef.current.length > 0;

    const clearCanvas = () => {
      context.clearRect(0, 0, arena.clientWidth, arena.clientHeight);
    };

    const stop = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      clearCanvas();
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, FX_CANVAS_MAX_DPR);
      canvas.width = Math.max(1, Math.floor(arena.clientWidth * dpr));
      canvas.height = Math.max(1, Math.floor(arena.clientHeight * dpr));
      canvas.style.width = `${arena.clientWidth}px`;
      canvas.style.height = `${arena.clientHeight}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      setArenaSize((current) => current.width === arena.clientWidth && current.height === arena.clientHeight
        ? current
        : { width: arena.clientWidth, height: arena.clientHeight });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(arena);
    resize();

    const draw = (time: number) => {
      animationFrame = 0;
      if (
        document.hidden ||
        stageFxSuspendedRef.current ||
        !hasActiveEffects()
      ) {
        clearCanvas();
        return;
      }
      const delta = Math.min(34, Math.max(8, time - previousTime));
      previousTime = time;
      context.clearRect(0, 0, arena.clientWidth, arena.clientHeight);
      context.globalCompositeOperation = "lighter";

      tingCombatFxRef.current = tingCombatFxRef.current.filter((effect) =>
        drawTingCombatFx(context, effect, delta, {
          width: arena.clientWidth,
          height: arena.clientHeight,
        }),
      );

      gachaCombatFxRef.current = gachaCombatFxRef.current.filter((effect) =>
        drawGachaCombatFx(context, effect, delta, {
          width: arena.clientWidth,
          height: arena.clientHeight,
        }),
      );

      beamsRef.current = beamsRef.current.filter((beam) => {
        beam.life -= delta;
        if (beam.life <= 0) return false;
        const alpha = beam.life / beam.maxLife;
        context.beginPath();
        context.moveTo(beam.x1, beam.y1);
        context.lineTo(beam.x2, beam.y2);
        context.lineWidth = beam.width * alpha;
        context.strokeStyle = colorWithAlpha(beam.color, alpha * 0.9);
        context.shadowColor = beam.color;
        context.shadowBlur = 18;
        context.stroke();
        context.shadowBlur = 0;
        return true;
      });

      particlesRef.current = particlesRef.current.filter((particle) => {
        particle.life -= delta;
        if (particle.life <= 0) return false;
        particle.x += particle.vx * (delta / 16.67);
        particle.y += particle.vy * (delta / 16.67);
        particle.vx *= 0.985;
        particle.vy *= 0.985;
        const alpha = Math.max(0, particle.life / particle.maxLife);
        context.beginPath();
        context.arc(particle.x, particle.y, Math.max(0.5, particle.size * alpha), 0, Math.PI * 2);
        context.fillStyle = colorWithAlpha(particle.color, alpha);
        context.fill();
        return true;
      });

      context.globalCompositeOperation = "source-over";
      if (hasActiveEffects()) {
        animationFrame = requestAnimationFrame(draw);
      }
    };

    const wake = () => {
      if (animationFrame || document.hidden || stageFxSuspendedRef.current || !hasActiveEffects()) return;
      previousTime = performance.now();
      animationFrame = requestAnimationFrame(draw);
    };
    const handleVisibilityChange = () => {
      if (document.hidden) stop();
      else wake();
    };
    wakeFxLoopRef.current = wake;
    stopFxLoopRef.current = stop;
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stop();
      wakeFxLoopRef.current = () => {};
      stopFxLoopRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    const previous = previousSnapshotRef.current;
    const next = new Map<string, { hp: number; shield: number; dead: boolean }>();
    const created: Popup[] = [];

    fighters.forEach((fighter) => {
      const current = { hp: fighter.currentHp, shield: getShield(fighter), dead: fighter.isDead };
      next.set(fighter.id, current);
      const before = previous.get(fighter.id);
      if (!before) return;
      const hpDelta = current.hp - before.hp;
      const shieldDelta = current.shield - before.shield;
      if (hpDelta < 0 || shieldDelta < 0) {
        const loss = Math.abs(Math.min(0, hpDelta)) + Math.abs(Math.min(0, shieldDelta));
        created.push({
          id: `popup-${++popupSequenceRef.current}`,
          fighterId: fighter.id,
          value: `-${loss}`,
          label: hpDelta < 0 ? "伤害" : "护盾吸收",
          kind: hpDelta < 0 ? "damage" : "shield",
        });
      } else if (hpDelta > 0) {
        created.push({
          id: `popup-${++popupSequenceRef.current}`,
          fighterId: fighter.id,
          value: `+${hpDelta}`,
          label: "恢复",
          kind: "heal",
        });
      } else if (shieldDelta > 0) {
        created.push({
          id: `popup-${++popupSequenceRef.current}`,
          fighterId: fighter.id,
          value: `+${shieldDelta}`,
          label: "护盾",
          kind: "shieldGain",
        });
      }
      if (!before.dead && current.dead) {
        created.push({
          id: `popup-${++popupSequenceRef.current}`,
          fighterId: fighter.id,
          value: "K.O.",
          label: "退场",
          kind: "defeat",
        });
      }
    });

    previousSnapshotRef.current = next;
    if (created.length === 0) return;
    created.forEach((popup) => {
      const scope = `popup:${popup.id}`;
      const generation = animationScheduler.begin(scope);
      const present = () => animationScheduler.frame(scope, () => {
        const fighter = fighterById.get(popup.fighterId);
        setPopups((current) => [...current, popup].slice(-16));
        spawnBurst(popup.fighterId, popup.kind === "heal" ? "#7be36a" : popup.kind.includes("shield") ? "#46a8ff" : getFighterAccent(fighter), popup.kind === "defeat" ? 70 : 34, popup.kind === "defeat" ? 7 : 4.5);
        animationScheduler.after(scope, prefersReducedMotion ? 40 : popup.kind === "defeat" ? 1450 : 1100, () => {
          setPopups((current) => current.filter((item) => item.id !== popup.id));
          animationScheduler.release(scope);
        }, generation);
      }, generation);
      if (popup.kind === "heal") runAfterSelfDestructReturn(popup.fighterId, present);
      else present();
    });
  }, [animationScheduler, fighterById, fighters, prefersReducedMotion, runAfterSelfDestructReturn, spawnBurst]);

  useEffect(() => {
    if (!activeLog || mobileView === "logs" || developmentSummonPreviewRef.current || developmentTingPreviewRef.current || developmentGachaPreviewRef.current || developmentFinisherPreviewRef.current) return;
    const eventKey = activeLog.id ?? `event-${activeLog.sequence ?? battleTurn}`;
    if (lastProcessedVisualEventKeyRef.current === eventKey) return;
    lastProcessedVisualEventKeyRef.current = eventKey;

    const currentActor = activeLog.actorId ? fighterById.get(activeLog.actorId) : actor;
    const explicitCombatCue = activeLog.visualCue?.kind === "combat_fx" ? activeLog.visualCue : null;
    const effectSource = explicitCombatCue
      ? fighterById.get(explicitCombatCue.sourceId)
      : currentActor;
    const effectTargetIds = explicitCombatCue
      ? explicitCombatCue.targetIds.filter((id) => fighterById.has(id))
      : targetIds;
    const visualActionKey = activeLog.actionId ?? `turn-${activeLog.turn ?? battleTurn}-actor-${currentActor?.id ?? "global"}`;
    let actionGeneration = animationScheduler.generation("action");
    if (lastVisualActionKeyRef.current !== visualActionKey || explicitCombatCue) {
      actionGeneration = animationScheduler.begin("action");
      lastVisualActionKeyRef.current = visualActionKey;
      clearFighterMotions();
      beamsRef.current = [];
      particlesRef.current = [];
      tingCombatFxRef.current = [];
      gachaCombatFxRef.current = [];
      clearImpactTimers();
      animationScheduler.frame("action", () => setShowImpact(false), actionGeneration);
    }

    const namedTargets = fighters
      .filter((fighter) => fighter.id !== effectSource?.id && activeLog.text.includes(fighter.name))
      .map((fighter) => fighter.id);

    const accent = getFighterAccent(effectSource ?? currentActor);
    const combatEffect = resolveCombatEffect(activeLog, effectSource);
    const attackLogType = activeLog.type === "skill" || activeLog.type === "crit" || activeLog.type === "death" || activeLog.type === "poison";
    const shouldAttack = Boolean(
      effectSource &&
      effectTargetIds.length > 0 &&
      activeLog.visualCue?.kind !== "summon_card" &&
      (activeLog.presentation === "basic" || (attackLogType && (activeLog.presentation === "skill" || activeLog.presentation === "finisher"))),
    );
    const shouldPlayActorEffect = Boolean(
      combatEffect?.targetMode === "actor" &&
      effectSource &&
      (activeLog.type === "skill" || activeLog.type === "crit" || activeLog.type === "buff" || activeLog.type === "heal"),
    );
    const shouldPlayActionEffect = Boolean(explicitCombatCue) || shouldAttack || shouldPlayActorEffect;
    const effectPlaybackKey = explicitCombatCue ? eventKey : visualActionKey;
    if (shouldPlayActionEffect && effectSource && !animatedAttackActionKeysRef.current.has(effectPlaybackKey)) {
      animatedAttackActionKeysRef.current.add(effectPlaybackKey);
      keepNewestSet(animatedAttackActionKeysRef.current, 256);
      animationScheduler.frame("action", () => {
        if (combatEffect) {
          playCombatActorMotion(combatEffect, effectSource.id, effectTargetIds[0]);
          if (combatEffect.theme === "ting") {
            spawnTingEffect(combatEffect, effectSource.id, effectTargetIds);
          } else {
            spawnGachaEffect(combatEffect, effectSource.id, effectTargetIds, {
              label: explicitCombatCue?.label,
              count: explicitCombatCue?.count,
            });
          }
        } else {
          effectTargetIds.forEach((targetId) => {
            spawnBeam(effectSource.id, targetId, accent);
            spawnBurst(targetId, accent, activeLog.type === "crit" || activeLog.type === "death" ? 58 : 28, activeLog.type === "crit" ? 7 : 4.5);
          });
        }
        const impactDuration = combatEffect?.impact === "ting_detonation"
          ? 1180
          : combatEffect?.impact === "ting_blood" || combatEffect?.impact === "ting_curse"
            ? 780
            : combatEffect?.theme === "gacha"
              ? 680
              : 460;
        const impactDelay = combatEffect
          ? getCombatActorMotionTiming(combatEffect.actorMotion, prefersReducedMotion).impactDelayMs
          : 0;
        if (!combatEffect || combatEffect.stageImpact) {
          playCombatImpact(combatEffect?.impact ?? "generic", impactDuration, impactDelay);
        }
      }, actionGeneration);
    } else if (activeLog.type === "heal" || activeLog.type === "buff") {
      const beneficiary = namedTargets[0] ?? effectSource?.id ?? currentActor?.id;
      if (beneficiary) {
        const present = () => animationScheduler.frame(
          "action",
          () => spawnBurst(beneficiary, activeLog.type === "heal" ? "#7be36a" : accent, 36, 4),
          actionGeneration,
        );
        if (activeLog.type === "heal") runAfterSelfDestructReturn(beneficiary, present);
        else present();
      }
    }

    const visualCue = activeLog.visualCue;
    if (visualCue?.kind === "transformation") {
      const transformed = fighterById.get(visualCue.fighterId);
      const nextCinematic: TransformationCinematic = {
        kind: "transformation",
        fighterId: visualCue.fighterId,
        name: visualCue.fighterName,
        kicker: `PHASE SHIFT // TURN ${activeLog.turn ?? battleTurn}`,
        title: getTransformationTitle(activeLog, visualCue.to),
        from: visualCue.from,
        to: visualCue.to,
      };
      animationScheduler.frame("action", () => playCinematic(nextCinematic, 3200), actionGeneration);
      if (transformed) animationScheduler.frame("action", () => spawnBurst(transformed.id, getFighterAccent(transformed), 86, 7), actionGeneration);
    } else if (visualCue?.kind === "summon_card") {
      animationScheduler.frame("action", () => playCinematic({ ...visualCue }, visualCue.summonKind === "reveal" ? 2800 : 4400), actionGeneration);
    } else if (activeLog.presentation === "finisher" && shouldAttack) {
      const finisherKey = activeLog.actionId ?? activeLog.id ?? `event-${activeLog.sequence ?? battleTurn}`;
      if (lastFinisherKeyRef.current !== finisherKey) {
        lastFinisherKeyRef.current = finisherKey;
        const finisher = currentActor;
        const nextCinematic: FinisherCinematic = {
          kind: "finisher",
          fighterId: finisher?.id,
          name: finisher?.name ?? "终结技",
          kicker: `FINISHER // TURN ${activeLog.turn ?? battleTurn}`,
          title: getActionTitle(activeLog),
          image: getStageFinisherImage(finisher),
          theme: combatEffect?.theme === "ting"
            ? "ting_blood"
            : combatEffect?.impact === "gacha_dragon"
              ? "gacha_dragon"
              : combatEffect?.impact === "gacha_solar"
                ? "gacha_solar"
                : combatEffect?.impact === "gacha_void"
                  ? "gacha_void"
                  : combatEffect?.theme === "gacha"
                    ? "gacha_summon"
                    : undefined,
          targetName: targetIds[0] ? fighterById.get(targetIds[0])?.name : undefined,
        };
        animationScheduler.frame("action", () => playCinematic(nextCinematic, nextCinematic.theme ? 2100 : 1900), actionGeneration);
      }
    }

    if (/普瑞赛斯|源石结晶|矿石病/.test(activeLog.text)) {
      const glitchGeneration = animationScheduler.begin("glitch");
      animationScheduler.frame("glitch", () => setIsGlitching(true), glitchGeneration);
      animationScheduler.after("glitch", prefersReducedMotion ? 40 : 900, () => {
        setIsGlitching(false);
      }, glitchGeneration);
    }
  }, [activeLog, actor, animationScheduler, battleTurn, clearFighterMotions, clearImpactTimers, fighterById, fighters, mobileView, playCinematic, playCombatActorMotion, playCombatImpact, prefersReducedMotion, runAfterSelfDestructReturn, spawnBeam, spawnBurst, spawnGachaEffect, spawnTingEffect, targetIds]);

  useEffect(() => {
    if (!isAutoScroll) return;
    const feed = feedRef.current;
    if (!feed) return;
    const generation = animationScheduler.begin("feed-scroll");
    animationScheduler.frame("feed-scroll", () => feed.scrollTo({ top: feed.scrollHeight, behavior: "auto" }), generation);
  }, [animationScheduler, isAutoScroll, logGroups]);

  useEffect(() => {
    if (mobileView !== "logs") return;
    const generation = animationScheduler.begin("mobile-view");
    animationScheduler.frame("mobile-view", () => {
      setShowImpact(false);
      stopCinematic();
    }, generation);
  }, [animationScheduler, mobileView, stopCinematic]);

  const actionAccent = getFighterAccent(actor);
  const playerCount = fighters.filter((fighter) => !fighter.isNpc && !fighter.isSummon).length;
  const livingPlayers = fighters.filter((fighter) => !fighter.isNpc && !fighter.isSummon && !fighter.isDead && !fighter.isDeadAnnounced && fighter.currentHp > 0).length;
  const threat = Math.min(100, 34 + Math.floor(battleTurn * 1.35) + Math.max(0, playerCount - livingPlayers) * 5);
  const selectedAccent = getFighterAccent(selectedFighter);

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${isGlitching ? styles.glitching : ""}`}
      data-mobile-view={mobileView}
      data-density={stageDensity}
      data-fx-suspended={stageFxSuspended ? "true" : "false"}
      data-cinematic-active={cinematic ? "true" : "false"}
      data-page-visible={isPageVisible ? "true" : "false"}
    >
      <section
        ref={arenaRef}
        className={styles.arena}
        aria-label="名字大乱斗新战场"
        data-active-actor-id={activeActorId ?? ""}
      >
        <div className={styles.backdrop} aria-hidden="true" />
        <div className={styles.grid} aria-hidden="true" />
        <div className={styles.vignette} aria-hidden="true" />
        <canvas ref={canvasRef} className={styles.fxCanvas} aria-hidden="true" />
        {showImpact ? (
          <div key={impactToken} className={styles.impactFlash} data-impact-theme={impactTheme} aria-hidden="true">
            <i /><i /><i />
          </div>
        ) : null}

        <StageActionBanner activeLog={activeLog} battleTurn={battleTurn} accent={actionAccent} />
        <StageRoundOrbit
          number={roundProgress.number}
          acted={roundProgress.acted}
          total={roundProgress.total}
        />
        <StageFighterLayer
          fighters={stageFighters}
          positionById={positionById}
          activeActorId={activeActorId}
          targetIdSet={targetIdSet}
          selectedFighterId={selectedFighter?.id}
          visibleStatusCount={visibleStatusCount}
          getStatusBadges={getStatusBadges}
          onSelect={selectFighterForCurrentAction}
          onClearFocus={clearManualFocus}
          registerNode={registerFighterNode}
        />
        <StagePopupLayer popups={popups} positionById={positionById} />
        <StageDossier
          fighter={selectedFighter}
          statuses={selectedStatuses}
          resources={selectedResources}
          accent={selectedAccent}
          isManualFocus={Boolean(selectedId)}
          focusCycleKey={focusCycleKey}
        />
        <StageArenaFooter
          threat={threat}
          actorName={actor?.name ?? "全局事件"}
          actorAccent={actionAccent}
          battleTurn={battleTurn}
          roundNumber={roundProgress.number}
        />

        {cinematic?.kind === "finisher" ? (
          <div
            className={styles.cinematic}
            data-cinematic-theme={cinematic.theme ?? "default"}
            style={{ "--cinematic-accent": cinematic.accent ?? getFighterAccent(fighterById.get(cinematic.fighterId ?? "")) } as CSSProperties}
            aria-live="assertive"
          >
            {cinematic.theme === "ting_blood" ? (
              <div className={styles.tingFinisherFx} aria-hidden="true">
                <i /><i /><i /><i /><i /><i />
              </div>
            ) : null}
            {cinematic.theme?.startsWith("gacha_") ? (
              <div className={styles.gachaFinisherFx} aria-hidden="true">
                <i /><i /><i /><i /><i /><i />
              </div>
            ) : null}
            <div className={styles.cinematicScan} />
            <div className={`${styles.cinematicArt} ${cinematic.image ? "" : styles.cinematicEmblem}`} style={cinematic.image ? { backgroundImage: `url(${cinematic.image})` } : undefined}>
              {!cinematic.image ? fighterById.get(cinematic.fighterId ?? "")?.jobData?.icon ?? "名" : null}
            </div>
            <div className={styles.cinematicCopy}>
              <span>{cinematic.kicker}</span>
              <h2>{cinematic.name}</h2>
              <p>{cinematic.title}</p>
              {cinematic.targetName ? <b className={styles.finisherTarget}>TARGET // {cinematic.targetName}</b> : null}
            </div>
            <i />
          </div>
        ) : null}

        {cinematic?.kind === "transformation" ? (
          <div
            className={styles.transformation}
            style={{ "--transform-accent": getFighterAccent(fighterById.get(cinematic.fighterId ?? "")) } as CSSProperties}
            aria-live="assertive"
          >
            <div className={styles.transformationGrid} aria-hidden="true" />
            <div className={styles.transformationHeader}>
              <span>{cinematic.kicker}</span>
              <b>职业形态重构</b>
              <strong>{cinematic.name}</strong>
            </div>
            <div className={styles.formTrack}>
              <div className={`${styles.formCard} ${styles.formBefore}`}>
                <span>FROM // {getPhaseName(cinematic.from.phase)}</span>
                <i>{cinematic.from.icon}</i>
                <strong>{cinematic.from.jobName}</strong>
                <small>{cinematic.from.jobKey}</small>
              </div>
              <div className={styles.formTransfer} aria-hidden="true">
                <i />
                <b>PHASE<br />SHIFT</b>
                <span>›››</span>
              </div>
              <div className={`${styles.formCard} ${styles.formAfter}`}>
                <span>TO // {getPhaseName(cinematic.to.phase)}</span>
                <i>{cinematic.to.icon}</i>
                <strong>{cinematic.to.jobName}</strong>
                <small>{cinematic.to.jobKey}</small>
              </div>
            </div>
            <p className={styles.transformationTitle}>【{cinematic.title}】</p>
            <div className={styles.transformationProgress} aria-hidden="true"><i /></div>
          </div>
        ) : null}

        {cinematic?.kind === "summon_card" ? (
          <SummonRitualCinematic cinematic={cinematic} turn={activeLog?.turn ?? battleTurn} />
        ) : null}

        {mvpOverlay}
      </section>

      <StageFeedPanel
        feedRef={feedRef}
        fighters={displayOrder}
        activeActorId={activeActorId}
        logGroups={logGroups}
        battleTurn={battleTurn}
        roundNumber={roundProgress.number}
        gameState={gameState}
        isAutoScroll={isAutoScroll}
        namePattern={namePattern}
        nameAccentByName={nameAccentByName}
        fighterAccentById={fighterAccentById}
        onSelectFighter={selectFighterFromFeed}
        onToggleAutoScroll={onToggleAutoScroll}
        onReset={onReset}
        onOpenFullLog={onOpenFullLog}
        onDownloadLogs={onDownloadLogs}
        onDownloadReplay={onDownloadReplay}
      />

      <nav className={styles.mobileTabs} aria-label="手机战斗视图">
        <button type="button" className={mobileView === "arena" ? styles.mobileActive : ""} onClick={() => setMobileView("arena")}>战场 <span>{aliveCount}</span></button>
        <button type="button" className={mobileView === "logs" ? styles.mobileActive : ""} onClick={() => setMobileView("logs")}>战报 <span>{displayLogs.length}</span></button>
      </nav>
    </div>
  );
}
