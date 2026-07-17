import type { CombatActorMotion } from './combatEffects';

export type CombatMotionRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type CombatActorMotionFrame = {
  offset: number;
  x: number;
  y: number;
  easing?: string;
};

export type CombatActorMotionTiming = {
  durationMs: number;
  effectDelayMs: number;
  impactDelayMs: number;
};

export type CombatActorMotionPlan = CombatActorMotionTiming & {
  destination: { x: number; y: number };
  frames: CombatActorMotionFrame[];
};

export const TING_SELF_DESTRUCT_TIMELINE = {
  actorHoldMs: 700,
  actorArriveMs: 1180,
  effectDelayMs: 1200,
  explosionDelayMs: 1600,
  effectDurationMs: 1320,
  returnStartMs: 2880,
  durationMs: 3200,
} as const;

const MOTION_TIMINGS: Record<CombatActorMotion, CombatActorMotionTiming> = {
  stationary: { durationMs: 0, effectDelayMs: 0, impactDelayMs: 0 },
  melee_lunge: { durationMs: 620, effectDelayMs: 180, impactDelayMs: 205 },
  aerial_kick: { durationMs: 920, effectDelayMs: 300, impactDelayMs: 470 },
  delayed_slash: { durationMs: 980, effectDelayMs: 320, impactDelayMs: 520 },
  heavy_lunge: { durationMs: 780, effectDelayMs: 220, impactDelayMs: 340 },
  multi_melee_lunge: { durationMs: 1320, effectDelayMs: 180, impactDelayMs: 300 },
  self_destruct_cling: {
    durationMs: TING_SELF_DESTRUCT_TIMELINE.durationMs,
    effectDelayMs: TING_SELF_DESTRUCT_TIMELINE.effectDelayMs,
    impactDelayMs: TING_SELF_DESTRUCT_TIMELINE.explosionDelayMs,
  },
};

export function getCombatActorMotionTiming(
  motion: CombatActorMotion,
  reducedMotion = false,
): CombatActorMotionTiming {
  if (reducedMotion) return { durationMs: 0, effectDelayMs: 0, impactDelayMs: 0 };
  return MOTION_TIMINGS[motion];
}

function getCenter(rect: CombatMotionRect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function getDestination(
  motion: Exclude<CombatActorMotion, 'stationary'>,
  actorRect: CombatMotionRect,
  targetRect: CombatMotionRect,
) {
  const actor = getCenter(actorRect);
  const target = getCenter(targetRect);
  const dx = target.x - actor.x;
  const dy = target.y - actor.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const nx = dx / distance;
  const ny = dy / distance;
  const touchDistance =
    Math.abs(nx) * (actorRect.width + targetRect.width) / 2
    + Math.abs(ny) * (actorRect.height + targetRect.height) / 2;
  const stopDistance = motion === 'self_destruct_cling'
    ? Math.max(22, touchDistance * 0.28)
    : motion === 'delayed_slash'
      ? Math.max(38, touchDistance * 0.72)
      : motion === 'heavy_lunge' || motion === 'multi_melee_lunge'
        ? Math.max(46, touchDistance * 0.8)
        : Math.max(54, touchDistance * 0.92 + 6);
  const travel = Math.max(0, distance - stopDistance);
  const sideOffset = motion === 'self_destruct_cling' ? Math.min(10, touchDistance * 0.08) : 0;
  return {
    x: nx * travel - ny * sideOffset,
    y: ny * travel + nx * sideOffset,
  };
}

export function createCombatActorMotionPlan(
  motion: CombatActorMotion,
  actorRect: CombatMotionRect,
  targetRect: CombatMotionRect,
  reducedMotion = false,
): CombatActorMotionPlan | null {
  if (motion === 'stationary' || reducedMotion) return null;
  const timing = getCombatActorMotionTiming(motion);
  const destination = getDestination(motion, actorRect, targetRect);
  const distance = Math.hypot(destination.x, destination.y);
  if (distance < 3) return null;

  const nx = destination.x / distance;
  const ny = destination.y / distance;
  if (motion === 'melee_lunge') {
    return {
      ...timing,
      destination,
      frames: [
        { offset: 0, x: 0, y: 0 },
        { offset: 0.12, x: -nx * 8, y: -ny * 8, easing: 'cubic-bezier(0.3, 0, 0.7, 1)' },
        { offset: 0.35, x: destination.x, y: destination.y, easing: 'cubic-bezier(0.1, 0.78, 0.18, 1)' },
        { offset: 0.62, x: destination.x, y: destination.y },
        { offset: 0.72, x: destination.x + nx * 7, y: destination.y + ny * 7, easing: 'ease-out' },
        { offset: 1, x: 0, y: 0, easing: 'cubic-bezier(0.28, 0.02, 0.36, 1)' },
      ],
    };
  }

  if (motion === 'aerial_kick') {
    const arcHeight = Math.min(118, Math.max(48, distance * 0.24));
    return {
      ...timing,
      destination,
      frames: [
        { offset: 0, x: 0, y: 0 },
        { offset: 0.12, x: -nx * 8, y: -ny * 8 + 8, easing: 'ease-in' },
        { offset: 0.36, x: destination.x * 0.58, y: destination.y * 0.58 - arcHeight, easing: 'cubic-bezier(0.16, 0.76, 0.28, 1)' },
        { offset: 0.52, x: destination.x, y: destination.y, easing: 'cubic-bezier(0.08, 0.8, 0.16, 1)' },
        { offset: 0.64, x: destination.x + nx * 12, y: destination.y + ny * 12 },
        { offset: 1, x: 0, y: 0, easing: 'cubic-bezier(0.28, 0.02, 0.36, 1)' },
      ],
    };
  }

  if (motion === 'delayed_slash') {
    return {
      ...timing,
      destination,
      frames: [
        { offset: 0, x: 0, y: 0 },
        { offset: 0.16, x: -nx * 12, y: -ny * 12, easing: 'ease-in' },
        { offset: 0.34, x: destination.x, y: destination.y, easing: 'cubic-bezier(0.08, 0.84, 0.16, 1)' },
        { offset: 0.58, x: destination.x, y: destination.y },
        { offset: 0.67, x: destination.x + nx * 24, y: destination.y + ny * 24, easing: 'ease-out' },
        { offset: 1, x: 0, y: 0, easing: 'cubic-bezier(0.28, 0.02, 0.36, 1)' },
      ],
    };
  }

  if (motion === 'heavy_lunge' || motion === 'multi_melee_lunge') {
    return {
      ...timing,
      destination,
      frames: [
        { offset: 0, x: 0, y: 0 },
        { offset: 0.15, x: -nx * 14, y: -ny * 14, easing: 'ease-in' },
        { offset: 0.4, x: destination.x, y: destination.y, easing: 'cubic-bezier(0.08, 0.82, 0.16, 1)' },
        { offset: 0.58, x: destination.x + nx * 10, y: destination.y + ny * 10 },
        { offset: 0.7, x: destination.x, y: destination.y, easing: 'ease-out' },
        { offset: 1, x: 0, y: 0, easing: 'cubic-bezier(0.28, 0.02, 0.36, 1)' },
      ],
    };
  }

  const jitterX = -ny * 5;
  const jitterY = nx * 5;
  const frameOffset = (milliseconds: number) => milliseconds / timing.durationMs;
  return {
    ...timing,
    destination,
    frames: [
      { offset: 0, x: 0, y: 0 },
      { offset: frameOffset(TING_SELF_DESTRUCT_TIMELINE.actorHoldMs), x: 0, y: 0 },
      {
        offset: frameOffset(TING_SELF_DESTRUCT_TIMELINE.actorArriveMs),
        x: destination.x,
        y: destination.y,
        easing: 'cubic-bezier(0.08, 0.76, 0.16, 1)',
      },
      { offset: frameOffset(1320), x: destination.x, y: destination.y },
      { offset: frameOffset(1420), x: destination.x + jitterX, y: destination.y + jitterY },
      { offset: frameOffset(1510), x: destination.x - jitterX * 0.8, y: destination.y - jitterY * 0.8 },
      { offset: frameOffset(1580), x: destination.x + jitterX * 0.55, y: destination.y + jitterY * 0.55 },
      { offset: frameOffset(TING_SELF_DESTRUCT_TIMELINE.explosionDelayMs), x: destination.x, y: destination.y },
      { offset: frameOffset(TING_SELF_DESTRUCT_TIMELINE.returnStartMs), x: destination.x, y: destination.y },
      { offset: 1, x: 0, y: 0, easing: 'cubic-bezier(0.28, 0.02, 0.36, 1)' },
    ],
  };
}
