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

const MOTION_TIMINGS: Record<CombatActorMotion, CombatActorMotionTiming> = {
  stationary: { durationMs: 0, effectDelayMs: 0, impactDelayMs: 0 },
  melee_lunge: { durationMs: 620, effectDelayMs: 180, impactDelayMs: 205 },
  self_destruct_cling: { durationMs: 2100, effectDelayMs: 1420, impactDelayMs: 1660 },
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

  const jitterX = -ny * 5;
  const jitterY = nx * 5;
  return {
    ...timing,
    destination,
    frames: [
      { offset: 0, x: 0, y: 0 },
      { offset: 0.44, x: 0, y: 0 },
      { offset: 0.6, x: destination.x, y: destination.y, easing: 'cubic-bezier(0.08, 0.76, 0.16, 1)' },
      { offset: 0.66, x: destination.x, y: destination.y },
      { offset: 0.7, x: destination.x + jitterX, y: destination.y + jitterY },
      { offset: 0.74, x: destination.x - jitterX * 0.8, y: destination.y - jitterY * 0.8 },
      { offset: 0.78, x: destination.x + jitterX * 0.55, y: destination.y + jitterY * 0.55 },
      { offset: 0.84, x: destination.x, y: destination.y },
      { offset: 0.88, x: destination.x, y: destination.y },
      { offset: 1, x: 0, y: 0, easing: 'cubic-bezier(0.28, 0.02, 0.36, 1)' },
    ],
  };
}
