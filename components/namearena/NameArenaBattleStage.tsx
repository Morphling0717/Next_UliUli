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
import { namerenaJobs } from "@/lib/namearena/jobs";
import type { BattleEvent, BattleState, Fighter } from "@/lib/namearena/types";
import styles from "./NameArenaBattleStage.module.css";

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
  battleTurn: number;
  battleState: BattleState;
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

type StagePosition = { x: number; y: number };
type Popup = {
  id: string;
  fighterId: string;
  value: string;
  label: string;
  kind: "damage" | "heal" | "shield" | "shieldGain" | "defeat";
};
type FormIdentity = {
  jobKey: string;
  jobName: string;
  icon: string;
  phase: number;
};
type FinisherCinematic = {
  kind: "finisher";
  fighterId?: string;
  name: string;
  kicker: string;
  title: string;
  image?: string;
};
type TransformationCinematic = {
  kind: "transformation";
  fighterId?: string;
  name: string;
  kicker: string;
  title: string;
  from: FormIdentity;
  to: FormIdentity;
};
type Cinematic = FinisherCinematic | TransformationCinematic;
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
type LogGroup = {
  key: string;
  actionId?: string;
  actorId?: string;
  skillName?: string;
  turn?: number;
  largeRound?: number;
  logs: ArenaBattleLogEntry[];
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

const TRANSFORM_PATTERN = /转职为(?:专属辅助)?【|变身(?:为|——)?【|显露出【|展现出【|觉醒欧皇血统|乘员昏迷|KABOOM|解除了限制|进化为【|进入二阶段|进入三阶段/;
const FINISHER_PATTERN = /触发必杀|终结技锁定|一次性必杀|GREAT MONSTER VICTORY|彩虹狂热|GOTCHARD RAINBOW FEVER|Furioso/i;
const ATTACK_PATTERN = /攻击|伤害|命中|贯穿|斩|炮|踢|反击|爆炸|处决|击败|压制|肉钩|烈焰|Furioso|VICTORY/i;

const PREVIOUS_JOB_KEY: Record<string, string> = {
  GOD_SLIME: "SLIME",
  ALL_PLATFORM_CHAMPION: "HIGH_END_GAMER",
  DUAL_JOKER: "JOKE_KING",
  GOD_OF_TROLLS: "DUAL_JOKER",
  MIRACLE_BUJIN: "TOKU_FAN",
  MIRACLE_MONSTER_BUJIN: "MIRACLE_BUJIN",
  LUCK_EMPEROR: "GACHA_ADDICT",
  EXPLOSIVE_ANTI_CROC: "RED_FURY_SAMURAI",
  GRUDGE_SUICIDER: "RED_FURY_SAMURAI",
  CHIMERA: "SUCCUBUS",
  VALO_JUNIOR: "VIRTUAL_DIVA",
  MY_BABY: "VIRTUAL_DIVA",
  VERSATILE_RABBIT: "Q_BUNNY",
  WT_TOP_TIER: "WT_GRINDER",
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
  if (fighter.isWT) return "#77db82";
  if (fighter.isGamer) return "#b6ed55";
  if (fighter.isEmote) return "#d8b4fe";
  if (fighter.isMorphling) return "#5aa7ff";
  if (fighter.isTuJuanJuan) return "#ff8fc7";
  if (fighter.isJoker) return "#c084fc";
  if (fighter.isSummon) return "#e6c66a";
  return "#9aa8b4";
}

function getFighterImage(fighter?: Fighter) {
  return fighter?.isSigua ? "/Model.webp" : undefined;
}

function getPhaseNumber(fighter: Fighter) {
  if (fighter.isPuruisaishi) return Math.max(1, fighter.puruisaishiPhase ?? 1);
  if (fighter.isYuzu) return Math.max(1, fighter.yuzuPhase ?? 1);
  if (fighter.job === "MIRACLE_MONSTER_BUJIN" || fighter.job === "GOD_OF_TROLLS") return 3;
  return fighter.transformed ? 2 : 1;
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

function readFormIdentity(fighter: Fighter): FormIdentity {
  return {
    jobKey: fighter.job,
    jobName: fighter.jobData?.name ?? "未知职业",
    icon: fighter.jobData?.icon ?? (fighter.name.slice(0, 1) || "名"),
    phase: getPhaseNumber(fighter),
  };
}

function fallbackPreviousForm(fighter: Fighter, current: FormIdentity): FormIdentity {
  if (fighter.isYuzu || fighter.isPuruisaishi) {
    return { ...current, phase: Math.max(1, current.phase - 1) };
  }
  const previousJobKey = PREVIOUS_JOB_KEY[current.jobKey];
  const previousJob = previousJobKey ? namerenaJobs[previousJobKey] : undefined;
  return {
    jobKey: previousJobKey ?? current.jobKey,
    jobName: previousJob?.name ?? current.jobName,
    icon: previousJob?.icon ?? current.icon,
    phase: Math.max(1, current.phase - 1),
  };
}

function formChanged(before: FormIdentity | undefined, after: FormIdentity) {
  return Boolean(before && (before.jobKey !== after.jobKey || before.phase !== after.phase));
}

function createRingPositions(total: number): StagePosition[] {
  if (total <= 0) return [];
  const ringSizes = total <= 8
    ? [total]
    : total <= 16
      ? [Math.min(9, Math.ceil(total * 0.6)), total - Math.min(9, Math.ceil(total * 0.6))]
      : [10, Math.min(8, total - 10), Math.max(0, total - 18)];
  const radii = [
    { x: 38, y: 32 },
    { x: 24, y: 21 },
    { x: 11, y: 11 },
  ];
  const positions: StagePosition[] = [];

  ringSizes.forEach((count, ringIndex) => {
    if (count <= 0) return;
    const radius = radii[ringIndex] ?? radii[radii.length - 1];
    const offset = -Math.PI / 2 + (ringIndex % 2 === 0 ? Math.PI / Math.max(4, count) : 0);
    for (let index = 0; index < count; index += 1) {
      const angle = offset + (Math.PI * 2 * index) / count;
      positions.push({
        x: 50 + Math.cos(angle) * radius.x,
        y: 47 + Math.sin(angle) * radius.y,
      });
    }
  });
  return positions;
}

function buildLogGroups(logs: ArenaBattleLogEntry[]): LogGroup[] {
  const groups: LogGroup[] = [];
  logs.slice(-72).forEach((log, index) => {
    const actionKey = log.actionId ?? `event-${log.id ?? index}-${log.sequence ?? index}`;
    const previous = groups[groups.length - 1];
    if (log.actionId && previous?.actionId === log.actionId) {
      previous.logs.push(log);
      previous.skillName = log.skillName ?? previous.skillName;
      previous.actorId = log.actorId ?? previous.actorId;
      previous.turn = log.turn ?? previous.turn;
      previous.largeRound = log.largeRound ?? previous.largeRound;
      return;
    }
    groups.push({
      key: `${actionKey}-group-${log.id ?? log.sequence ?? index}`,
      actionId: log.actionId,
      actorId: log.actorId,
      skillName: log.skillName ?? undefined,
      turn: log.turn,
      largeRound: log.largeRound,
      logs: [log],
    });
  });
  return groups.slice(-14);
}

function getActionTitle(log?: ArenaBattleLogEntry) {
  if (!log) return "战场同步中";
  if (log.skillName) return log.skillName;
  const match = log.text.match(/【([^】]+)】/);
  if (match?.[1]) return match[1];
  return TYPE_LABELS[log.type] ?? "战斗事件";
}

function getTransformationTitle(log: ArenaBattleLogEntry, nextForm: FormIdentity) {
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

function colorWithAlpha(color: string, alpha: number) {
  const normalized = color.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return color;
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function NameArenaBattleStage({
  fighters,
  displayLogs,
  battleTurn,
  battleState,
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [popups, setPopups] = useState<Popup[]>([]);
  const [cinematic, setCinematic] = useState<Cinematic | null>(null);
  const [impactToken, setImpactToken] = useState(0);
  const [showImpact, setShowImpact] = useState(false);
  const [isGlitching, setIsGlitching] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const arenaRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const previousSnapshotRef = useRef(new Map<string, { hp: number; shield: number; dead: boolean }>());
  const formSnapshotRef = useRef(new Map<string, FormIdentity>());
  const particlesRef = useRef<Particle[]>([]);
  const beamsRef = useRef<Beam[]>([]);
  const popupSequenceRef = useRef(0);
  const cinematicTimerRef = useRef<number | null>(null);
  const impactTimerRef = useRef<number | null>(null);
  const glitchTimerRef = useRef<number | null>(null);
  const lastProcessedVisualEventKeyRef = useRef<string | null>(null);
  const lastVisualActionKeyRef = useRef<string | null>(null);
  const animatedAttackActionKeysRef = useRef(new Set<string>());
  const lastTransformationKeyRef = useRef<string | null>(null);
  const shownTransformationSignaturesRef = useRef(new Set<string>());
  const lastFinisherKeyRef = useRef<string | null>(null);

  const positions = useMemo(() => createRingPositions(fighters.length), [fighters.length]);
  const positionById = useMemo(() => {
    const map = new Map<string, StagePosition>();
    fighters.forEach((fighter, index) => map.set(fighter.id, positions[index] ?? { x: 50, y: 47 }));
    return map;
  }, [fighters, positions]);
  const fighterById = useMemo(() => new Map(fighters.map((fighter) => [fighter.id, fighter])), [fighters]);
  const logGroups = useMemo(() => buildLogGroups(displayLogs), [displayLogs]);
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
    return [...new Set(explicitTargets.length > 0 ? explicitTargets : hitTargets.length > 0 ? hitTargets : namedTargets)].slice(0, 8);
  }, [activeActorId, activeLog, fighterById, fighters]);
  const selectedFighter = fighterById.get(selectedId ?? "") ?? actor ?? fighters.find((fighter) => !fighter.isDead) ?? fighters[0];
  const selectedStatuses = selectedFighter ? getStatusBadges(selectedFighter) : [];
  const selectedResources = selectedFighter ? getResourceBadges(selectedFighter) : [];
  const displayOrder = useMemo(() => [...fighters].sort((left, right) => {
    if (left.id === activeActorId) return -1;
    if (right.id === activeActorId) return 1;
    if (left.isDead !== right.isDead) return left.isDead ? 1 : -1;
    return right.spd - left.spd;
  }), [activeActorId, fighters]);

  useEffect(() => {
    previousSnapshotRef.current.clear();
    formSnapshotRef.current.clear();
    lastProcessedVisualEventKeyRef.current = null;
    lastVisualActionKeyRef.current = null;
    animatedAttackActionKeysRef.current.clear();
    lastTransformationKeyRef.current = null;
    shownTransformationSignaturesRef.current.clear();
    lastFinisherKeyRef.current = null;
    if (cinematicTimerRef.current !== null) window.clearTimeout(cinematicTimerRef.current);
    if (impactTimerRef.current !== null) window.clearTimeout(impactTimerRef.current);
    if (glitchTimerRef.current !== null) window.clearTimeout(glitchTimerRef.current);
    cinematicTimerRef.current = null;
    impactTimerRef.current = null;
    glitchTimerRef.current = null;
    beamsRef.current = [];
    particlesRef.current = [];
    const frame = requestAnimationFrame(() => {
      setCinematic(null);
      setShowImpact(false);
      setIsGlitching(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [battleState.seed]);

  const playCinematic = useCallback((next: Cinematic, duration: number) => {
    if (cinematicTimerRef.current !== null) window.clearTimeout(cinematicTimerRef.current);
    setCinematic(next);
    cinematicTimerRef.current = window.setTimeout(() => {
      setCinematic((current) => current === next ? null : current);
      cinematicTimerRef.current = null;
    }, duration);
  }, []);

  const stopCinematic = useCallback(() => {
    if (cinematicTimerRef.current !== null) window.clearTimeout(cinematicTimerRef.current);
    cinematicTimerRef.current = null;
    setCinematic(null);
  }, []);

  useEffect(() => () => {
    if (cinematicTimerRef.current !== null) window.clearTimeout(cinematicTimerRef.current);
    if (impactTimerRef.current !== null) window.clearTimeout(impactTimerRef.current);
    if (glitchTimerRef.current !== null) window.clearTimeout(glitchTimerRef.current);
  }, []);

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

  const spawnBurst = useCallback((fighterId: string, color: string, amount = 30, force = 4.5) => {
    const center = getNodeCenter(fighterId);
    if (!center) return;
    for (let index = 0; index < amount; index += 1) {
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
  }, [getNodeCenter]);

  const spawnBeam = useCallback((actorId: string, targetId: string, color: string) => {
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
    for (let index = 0; index < 22; index += 1) {
      const ratio = index / 22;
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
  }, [getNodeCenter]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const arena = arenaRef.current;
    if (!canvas || !arena) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let animationFrame = 0;
    let previousTime = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(arena.clientWidth * dpr));
      canvas.height = Math.max(1, Math.floor(arena.clientHeight * dpr));
      canvas.style.width = `${arena.clientWidth}px`;
      canvas.style.height = `${arena.clientHeight}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(arena);
    resize();

    const draw = (time: number) => {
      const delta = Math.min(34, Math.max(8, time - previousTime));
      previousTime = time;
      context.clearRect(0, 0, arena.clientWidth, arena.clientHeight);
      context.globalCompositeOperation = "lighter";

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
      animationFrame = requestAnimationFrame(draw);
    };
    animationFrame = requestAnimationFrame(draw);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(animationFrame);
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
    requestAnimationFrame(() => setPopups((current) => [...current, ...created].slice(-16)));
    created.forEach((popup) => {
      const fighter = fighterById.get(popup.fighterId);
      spawnBurst(popup.fighterId, popup.kind === "heal" ? "#7be36a" : popup.kind.includes("shield") ? "#46a8ff" : getFighterAccent(fighter), popup.kind === "defeat" ? 70 : 34, popup.kind === "defeat" ? 7 : 4.5);
      window.setTimeout(() => setPopups((current) => current.filter((item) => item.id !== popup.id)), popup.kind === "defeat" ? 1450 : 1100);
    });
  }, [fighterById, fighters, spawnBurst]);

  useEffect(() => {
    if (!activeLog) return;
    const eventKey = activeLog.id ?? `event-${activeLog.sequence ?? battleTurn}`;
    if (lastProcessedVisualEventKeyRef.current === eventKey) return;
    lastProcessedVisualEventKeyRef.current = eventKey;

    const currentActor = activeLog.actorId ? fighterById.get(activeLog.actorId) : actor;
    const visualActionKey = activeLog.actionId ?? `turn-${activeLog.turn ?? battleTurn}-actor-${currentActor?.id ?? "global"}`;
    if (lastVisualActionKeyRef.current !== visualActionKey) {
      lastVisualActionKeyRef.current = visualActionKey;
      beamsRef.current = [];
      particlesRef.current = [];
      if (impactTimerRef.current !== null) window.clearTimeout(impactTimerRef.current);
      impactTimerRef.current = null;
      requestAnimationFrame(() => setShowImpact(false));
    }

    const namedTargets = fighters
      .filter((fighter) => fighter.id !== currentActor?.id && activeLog.text.includes(fighter.name))
      .map((fighter) => fighter.id);

    const accent = getFighterAccent(currentActor);
    const shouldAttack = Boolean(currentActor && targetIds.length > 0 && ATTACK_PATTERN.test(activeLog.text));
    if (shouldAttack && currentActor && !animatedAttackActionKeysRef.current.has(visualActionKey)) {
      animatedAttackActionKeysRef.current.add(visualActionKey);
      requestAnimationFrame(() => {
        targetIds.forEach((targetId) => {
          spawnBeam(currentActor.id, targetId, accent);
          spawnBurst(targetId, accent, activeLog.type === "crit" || activeLog.type === "death" ? 58 : 28, activeLog.type === "crit" ? 7 : 4.5);
        });
        setImpactToken((value) => value + 1);
        setShowImpact(true);
        if (impactTimerRef.current !== null) window.clearTimeout(impactTimerRef.current);
        impactTimerRef.current = window.setTimeout(() => {
          setShowImpact(false);
          impactTimerRef.current = null;
        }, 420);
      });
    } else if (activeLog.type === "heal" || activeLog.type === "buff") {
      const beneficiary = namedTargets[0] ?? currentActor?.id;
      if (beneficiary) requestAnimationFrame(() => spawnBurst(beneficiary, activeLog.type === "heal" ? "#7be36a" : accent, 36, 4));
    }

    const currentForms = new Map(fighters.map((fighter) => [fighter.id, readFormIdentity(fighter)]));
    const isTransformationLog = activeLog.type === "transform" || TRANSFORM_PATTERN.test(activeLog.text);
    const changedFighters = fighters.filter((fighter) => formChanged(formSnapshotRef.current.get(fighter.id), currentForms.get(fighter.id)!));
    const transformed = isTransformationLog
      ? changedFighters.find((fighter) => activeLog.text.includes(fighter.name))
        ?? changedFighters[0]
        ?? fighters.find((fighter) => activeLog.text.includes(fighter.name))
      : undefined;
    const currentForm = transformed ? currentForms.get(transformed.id) : undefined;
    const snapshotPreviousForm = transformed ? formSnapshotRef.current.get(transformed.id) : undefined;
    const previousForm = transformed && currentForm
      ? snapshotPreviousForm && formChanged(snapshotPreviousForm, currentForm)
        ? snapshotPreviousForm
        : fallbackPreviousForm(transformed, currentForm)
      : undefined;
    const transformationKey = eventKey;
    const transformationSignature = transformed && previousForm && currentForm
      ? `${transformed.id}:${previousForm.jobKey}:P${previousForm.phase}->${currentForm.jobKey}:P${currentForm.phase}`
      : undefined;
    const isTransformation = Boolean(
      isTransformationLog &&
      transformed &&
      currentForm &&
      previousForm &&
      formChanged(previousForm, currentForm) &&
      transformationSignature &&
      !shownTransformationSignaturesRef.current.has(transformationSignature) &&
      lastTransformationKeyRef.current !== transformationKey,
    );
    formSnapshotRef.current = currentForms;

    if (isTransformation && transformed && currentForm && previousForm && transformationSignature) {
      lastTransformationKeyRef.current = transformationKey;
      shownTransformationSignaturesRef.current.add(transformationSignature);
      const nextCinematic: TransformationCinematic = {
        kind: "transformation",
        fighterId: transformed?.id,
        name: transformed?.name ?? "形态变化",
        kicker: `PHASE SHIFT // TURN ${activeLog.turn ?? battleTurn}`,
        title: getTransformationTitle(activeLog, currentForm),
        from: previousForm,
        to: currentForm,
      };
      requestAnimationFrame(() => playCinematic(nextCinematic, 3200));
      requestAnimationFrame(() => spawnBurst(transformed.id, getFighterAccent(transformed), 86, 7));
    } else if (FINISHER_PATTERN.test(activeLog.text)) {
      const finisherKey = activeLog.actionId ?? activeLog.id ?? `event-${activeLog.sequence ?? battleTurn}`;
      if (lastFinisherKeyRef.current !== finisherKey) {
        lastFinisherKeyRef.current = finisherKey;
        const finisher = currentActor ?? transformed;
        const nextCinematic: FinisherCinematic = {
          kind: "finisher",
          fighterId: finisher?.id,
          name: finisher?.name ?? "终结技",
          kicker: `FINISHER // TURN ${activeLog.turn ?? battleTurn}`,
          title: getActionTitle(activeLog),
          image: getFighterImage(finisher),
        };
        requestAnimationFrame(() => playCinematic(nextCinematic, 1900));
      }
    }

    if (/普瑞赛斯|源石结晶|矿石病/.test(activeLog.text)) {
      if (glitchTimerRef.current !== null) window.clearTimeout(glitchTimerRef.current);
      requestAnimationFrame(() => setIsGlitching(true));
      glitchTimerRef.current = window.setTimeout(() => {
        setIsGlitching(false);
        glitchTimerRef.current = null;
      }, 900);
    }
  }, [activeLog, actor, battleTurn, fighterById, fighters, playCinematic, spawnBeam, spawnBurst, targetIds]);

  useEffect(() => {
    if (!isAutoScroll) return;
    const feed = feedRef.current;
    if (!feed) return;
    feed.scrollTo({ top: feed.scrollHeight, behavior: "smooth" });
  }, [isAutoScroll, logGroups]);

  useEffect(() => {
    if (mobileView !== "logs") return;
    requestAnimationFrame(() => {
      setShowImpact(false);
      stopCinematic();
    });
  }, [mobileView, stopCinematic]);

  const names = useMemo(() => fighters.map((fighter) => fighter.name).filter(Boolean).sort((a, b) => b.length - a.length), [fighters]);
  const namePattern = useMemo(() => names.length > 0 ? new RegExp(`(${names.map(escapeRegExp).join("|")})`, "g") : null, [names]);

  const renderHighlightedText = (text: string) => {
    if (!namePattern) return text;
    return text.split(namePattern).map((part, index) => {
      const namedFighter = fighters.find((fighter) => fighter.name === part);
      if (!namedFighter) return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
      return (
        <strong key={`${part}-${index}`} style={{ color: getFighterAccent(namedFighter) }}>
          {part}
        </strong>
      );
    });
  };

  const actionTitle = getActionTitle(activeLog);
  const actionSubtitle = activeLog?.text ?? "等待战斗事件";
  const actionAccent = getFighterAccent(actor);
  const threat = Math.min(100, 34 + Math.floor(battleTurn * 1.35) + Math.max(0, fighters.length - aliveCount) * 5);
  const selectedAccent = getFighterAccent(selectedFighter);

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${isGlitching ? styles.glitching : ""}`}
      data-mobile-view={mobileView}
      data-density={fighters.length > 12 ? "dense" : "normal"}
    >
      <section ref={arenaRef} className={styles.arena} aria-label="名字大乱斗新战场">
        <div className={styles.backdrop} aria-hidden="true" />
        <div className={styles.grid} aria-hidden="true" />
        <div className={styles.vignette} aria-hidden="true" />
        <canvas ref={canvasRef} className={styles.fxCanvas} aria-hidden="true" />
        {showImpact ? <div key={impactToken} className={styles.impactFlash} aria-hidden="true" /> : null}

        <div className={styles.actionBanner} style={{ "--event-accent": actionAccent } as CSSProperties}>
          <span>{`${activeLog?.type?.toUpperCase() ?? "ARENA"} // EVENT ${String(activeLog?.sequence ?? battleTurn).padStart(3, "0")}`}</span>
          <strong>{actionTitle}</strong>
          <small title={actionSubtitle}>{actionSubtitle}</small>
        </div>

        <div className={styles.roundOrbit} aria-hidden="true">
          <span>ROUND</span>
          <b>{String(roundProgress.number).padStart(2, "0")}</b>
          <small>{roundProgress.acted}/{roundProgress.total}</small>
        </div>

        <div className={styles.fighterLayer}>
          {fighters.map((fighter) => {
            const position = positionById.get(fighter.id) ?? { x: 50, y: 47 };
            const accent = getFighterAccent(fighter);
            const shield = getShield(fighter);
            const hpPercent = fighter.maxHp > 0 ? Math.max(0, Math.min(100, (fighter.currentHp / fighter.maxHp) * 100)) : 0;
            const shieldPercent = fighter.maxHp > 0 ? Math.max(0, Math.min(100, (shield / fighter.maxHp) * 100)) : 0;
            const statusBadges = getStatusBadges(fighter).slice(0, fighters.length > 12 ? 1 : 2);
            const isTarget = targetIds.includes(fighter.id);
            const isActive = fighter.id === activeActorId || fighter.isActing;
            const isDimmed = Boolean(activeActorId && !isActive && !isTarget);
            const image = getFighterImage(fighter);
            return (
              <button
                ref={(node) => {
                  if (node) nodeRefs.current.set(fighter.id, node);
                  else nodeRefs.current.delete(fighter.id);
                }}
                key={fighter.id}
                type="button"
                className={`${styles.fighter} ${isActive ? styles.active : ""} ${isTarget ? styles.target : ""} ${fighter.isHit ? styles.hit : ""} ${fighter.isDead ? styles.dead : ""} ${isDimmed ? styles.dimmed : ""} ${selectedFighter?.id === fighter.id ? styles.selected : ""}`}
                style={{ "--x": `${position.x}%`, "--y": `${position.y}%`, "--accent": accent } as CSSProperties}
                onClick={() => setSelectedId(fighter.id)}
                aria-label={`查看 ${fighter.displayName ?? fighter.name} 状态`}
              >
                <span className={styles.portrait}>
                  {image ? <Image src={image} alt="" fill sizes="54px" /> : <span className={styles.emblem}>{fighter.jobData?.icon || fighter.name.slice(0, 1)}</span>}
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
                    {fighter.isDead ? <span className={styles.koBadge}>已退场</span> : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

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

        {selectedFighter ? (
          <div className={styles.dossier} style={{ "--selected-accent": selectedAccent } as CSSProperties}>
            <i />
            <div className={styles.dossierBody}>
              <div className={styles.dossierHeading}>
                <div>
                  <span>{selectedFighter.jobData?.name ?? "未知职业"}</span>
                  <strong>{selectedFighter.displayName ?? selectedFighter.name}</strong>
                </div>
                <dl>
                  <div><dt>攻</dt><dd>{selectedFighter.atk}</dd></div>
                  <div><dt>防</dt><dd>{selectedFighter.def}</dd></div>
                  <div><dt>速</dt><dd>{selectedFighter.spd}</dd></div>
                  <div><dt>魔</dt><dd>{selectedFighter.mag}</dd></div>
                  <div><dt>盾</dt><dd>{getShield(selectedFighter)}</dd></div>
                </dl>
              </div>
              <div className={styles.dossierBadges}>
                {[...selectedStatuses, ...selectedResources].slice(0, 8).map((badge) => (
                  <span key={badge.key} data-tone={badge.tone} title={badge.detail}>{badge.icon} {badge.label}</span>
                ))}
                {selectedStatuses.length + selectedResources.length === 0 ? <small>当前没有额外状态或资源</small> : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className={styles.arenaFooter}>
          <div className={styles.threat}>
            <span>战场烈度</span>
            <div><i style={{ width: `${threat}%` }} /></div>
            <b>{threat >= 90 ? "极危" : threat >= 70 ? "激战" : "交战"}</b>
          </div>
          <div className={styles.currentActor}>
            <span>当前镜头</span>
            <b style={{ color: actionAccent }}>{actor?.name ?? "全局事件"}</b>
            <small>T{battleTurn} / R{roundProgress.number}</small>
          </div>
        </div>

        {cinematic?.kind === "finisher" ? (
          <div className={styles.cinematic} style={{ "--cinematic-accent": getFighterAccent(fighterById.get(cinematic.fighterId ?? "")) } as CSSProperties} aria-live="assertive">
            <div className={styles.cinematicScan} />
            <div className={`${styles.cinematicArt} ${cinematic.image ? "" : styles.cinematicEmblem}`} style={cinematic.image ? { backgroundImage: `url(${cinematic.image})` } : undefined}>
              {!cinematic.image ? fighterById.get(cinematic.fighterId ?? "")?.jobData?.icon ?? "名" : null}
            </div>
            <div className={styles.cinematicCopy}>
              <span>{cinematic.kicker}</span>
              <h2>{cinematic.name}</h2>
              <p>{cinematic.title}</p>
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

        {mvpOverlay}
      </section>

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
              <button type="button" onClick={onToggleAutoScroll} title={isAutoScroll ? "暂停自动跟随" : "恢复自动跟随"}>{isAutoScroll ? "跟随" : "暂停"}</button>
            )}
            <button type="button" onClick={onReset} title="重置大厅" aria-label="重置大厅">↻</button>
          </div>
        </header>

        <div className={styles.pulseStrip} aria-label="场上单位">
          {displayOrder.slice(0, 12).map((fighter) => (
            <button
              key={fighter.id}
              type="button"
              title={fighter.displayName ?? fighter.name}
              aria-label={`聚焦 ${fighter.displayName ?? fighter.name}`}
              onClick={() => {
                setSelectedId(fighter.id);
                setMobileView("arena");
              }}
              className={fighter.id === activeActorId ? styles.pulseActive : ""}
              style={{ "--pulse-accent": getFighterAccent(fighter) } as CSSProperties}
            >
              {fighter.jobData?.icon || fighter.name.slice(0, 1)}
            </button>
          ))}
          {displayOrder.length > 12 ? <span>+{displayOrder.length - 12}</span> : null}
        </div>

        <div ref={feedRef} className={styles.feedScroll}>
          {logGroups.map((group) => {
            const groupActor = group.actorId ? fighterById.get(group.actorId) : undefined;
            const latest = group.logs[group.logs.length - 1];
            const tone = getLogTone(latest);
            return (
              <article key={group.key} className={styles.logGroup} data-tone={tone} style={{ "--log-accent": getFighterAccent(groupActor) } as CSSProperties}>
                <header>
                  <div>
                    <span>{TYPE_LABELS[latest.type] ?? "事件"}</span>
                    <strong>{group.skillName || getActionTitle(latest)}</strong>
                  </div>
                  <time>T{group.turn ?? battleTurn} · R{group.largeRound ?? roundProgress.number}</time>
                </header>
                {group.logs.map((log, index) => <p key={log.id ?? `${group.key}-${index}`}>{renderHighlightedText(log.text)}</p>)}
              </article>
            );
          })}
        </div>

        <footer className={styles.feedFooter}>
          <span><i data-tone="skill" />技能</span>
          <span><i data-tone="death" />击杀</span>
          <span><i data-tone="heal" />恢复</span>
          <b>● 快照同步</b>
        </footer>
      </aside>

      <nav className={styles.mobileTabs} aria-label="手机战斗视图">
        <button type="button" className={mobileView === "arena" ? styles.mobileActive : ""} onClick={() => setMobileView("arena")}>战场 <span>{aliveCount}</span></button>
        <button type="button" className={mobileView === "logs" ? styles.mobileActive : ""} onClick={() => setMobileView("logs")}>战报 <span>{displayLogs.length}</span></button>
      </nav>
    </div>
  );
}
