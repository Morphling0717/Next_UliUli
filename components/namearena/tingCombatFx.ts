import type { TingCombatEffectCue, TingCombatMotion } from '@/lib/namearena/combatEffects';
import { getCombatActorMotionTiming } from '@/lib/namearena/combatActorMotion';

export type CombatFxPoint = { x: number; y: number };

export type TingCombatFx = {
  id: number;
  motion: TingCombatMotion;
  from: CombatFxPoint;
  to: CombatFxPoint;
  elapsed: number;
  delay: number;
  duration: number;
  seed: number;
};

const BLOOD = '#c9153c';
const ARTERIAL = '#ff365f';
const DARK_BLOOD = '#3a0713';
const VEIN = '#18040a';
const BONE = '#f3dfc4';

const MOTION_DURATION: Record<TingCombatMotion, number> = {
  quick_slash: 480,
  spinal_cleave: 820,
  blood_mist: 1320,
  grudge_rend: 920,
  blood_feast: 1380,
  wail: 1080,
  bone_guard: 1100,
  blood_rite: 1040,
  detonation: 1320,
  rage: 920,
  puppet_ritual: 1320,
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - clamp(value), 3);
}

function easeInOutCubic(value: number): number {
  const progress = clamp(value);
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function noise(seed: number, index: number): number {
  return fract(Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453);
}

function curveControl(from: CombatFxPoint, to: CombatFxPoint, bend: number): CombatFxPoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  return {
    x: (from.x + to.x) / 2 - (dy / length) * bend,
    y: (from.y + to.y) / 2 + (dx / length) * bend,
  };
}

function quadraticPoint(
  from: CombatFxPoint,
  control: CombatFxPoint,
  to: CombatFxPoint,
  progress: number,
): CombatFxPoint {
  const t = clamp(progress);
  const inverse = 1 - t;
  return {
    x: inverse * inverse * from.x + 2 * inverse * t * control.x + t * t * to.x,
    y: inverse * inverse * from.y + 2 * inverse * t * control.y + t * t * to.y,
  };
}

function strokeLine(
  context: CanvasRenderingContext2D,
  from: CombatFxPoint,
  to: CombatFxPoint,
  color: string,
  width: number,
  alpha: number,
  blur = 0,
): void {
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.lineWidth = width;
  context.strokeStyle = color;
  context.globalAlpha = clamp(alpha);
  context.shadowColor = color;
  context.shadowBlur = blur;
  context.stroke();
  context.shadowBlur = 0;
  context.globalAlpha = 1;
}

function strokeCurve(
  context: CanvasRenderingContext2D,
  from: CombatFxPoint,
  control: CombatFxPoint,
  to: CombatFxPoint,
  color: string,
  width: number,
  alpha: number,
  blur = 0,
): void {
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.quadraticCurveTo(control.x, control.y, to.x, to.y);
  context.lineWidth = width;
  context.strokeStyle = color;
  context.globalAlpha = clamp(alpha);
  context.shadowColor = color;
  context.shadowBlur = blur;
  context.stroke();
  context.shadowBlur = 0;
  context.globalAlpha = 1;
}

function drawRing(
  context: CanvasRenderingContext2D,
  center: CombatFxPoint,
  radius: number,
  color: string,
  width: number,
  alpha: number,
): void {
  if (radius <= 0) return;
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.lineWidth = width;
  context.strokeStyle = color;
  context.globalAlpha = clamp(alpha);
  context.stroke();
  context.globalAlpha = 1;
}

function drawDroplet(
  context: CanvasRenderingContext2D,
  center: CombatFxPoint,
  radius: number,
  color: string,
  alpha: number,
): void {
  context.beginPath();
  context.arc(center.x, center.y, Math.max(0.5, radius), 0, Math.PI * 2);
  context.fillStyle = color;
  context.globalAlpha = clamp(alpha);
  context.fill();
  context.globalAlpha = 1;
}

function drawSlashMark(
  context: CanvasRenderingContext2D,
  center: CombatFxPoint,
  angle: number,
  length: number,
  alpha: number,
  boneCore: boolean,
): void {
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const from = {
    x: center.x - direction.x * length * 0.5,
    y: center.y - direction.y * length * 0.5,
  };
  const to = {
    x: center.x + direction.x * length * 0.5,
    y: center.y + direction.y * length * 0.5,
  };
  strokeLine(context, from, to, DARK_BLOOD, 16, alpha * 0.72, 18);
  strokeLine(context, from, to, ARTERIAL, 6, alpha, 14);
  strokeLine(context, from, to, boneCore ? BONE : '#ffd0d8', 1.6, alpha, 8);
}

function drawMistCloud(
  context: CanvasRenderingContext2D,
  center: CombatFxPoint,
  progress: number,
  seed: number,
  scale = 1,
): void {
  context.globalCompositeOperation = 'source-over';
  for (let index = 0; index < 24; index += 1) {
    const angle = noise(seed, index * 3 + 1) * Math.PI * 2;
    const distance = (18 + noise(seed, index * 3 + 2) * 88) * easeOutCubic(progress) * scale;
    const radius = (12 + noise(seed, index * 3 + 3) * 26) * (0.35 + progress * 0.8) * scale;
    const point = {
      x: center.x + Math.cos(angle) * distance,
      y: center.y + Math.sin(angle) * distance * 0.68 - progress * 12,
    };
    drawDroplet(
      context,
      point,
      radius,
      index % 3 === 0 ? DARK_BLOOD : BLOOD,
      (1 - progress) * (index % 3 === 0 ? 0.16 : 0.1),
    );
  }
  context.globalCompositeOperation = 'lighter';
}

function drawBloodReturn(
  context: CanvasRenderingContext2D,
  from: CombatFxPoint,
  to: CombatFxPoint,
  progress: number,
  seed: number,
  streams = 4,
): void {
  const pull = easeInOutCubic(clamp(progress));
  for (let index = 0; index < streams; index += 1) {
    const bend = (index - (streams - 1) / 2) * 24 + (noise(seed, index) - 0.5) * 24;
    const control = curveControl(from, to, bend);
    strokeCurve(context, from, control, to, index % 2 === 0 ? BLOOD : ARTERIAL, 2 + index % 2, (1 - pull) * 0.58 + 0.18, 10);
    const bead = quadraticPoint(from, control, to, clamp(pull + index * 0.08));
    drawDroplet(context, bead, 4.5 - index * 0.35, ARTERIAL, 0.9 - pull * 0.3);
  }
}

function drawQuickSlash(context: CanvasRenderingContext2D, fx: TingCombatFx, progress: number): void {
  const impact = clamp(progress / 0.82);
  if (impact <= 0) return;
  const angle = Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x) - 0.72;
  drawSlashMark(context, fx.to, angle, 82 * easeOutCubic(impact), Math.sin(impact * Math.PI), false);
}

function drawSpinalCleave(context: CanvasRenderingContext2D, fx: TingCombatFx, progress: number): void {
  const impact = clamp(progress / 0.84);
  if (impact <= 0) return;
  const angle = Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x) - 0.82;
  const fade = Math.sin(impact * Math.PI);
  drawSlashMark(context, fx.to, angle, 154 * easeOutCubic(impact), fade, true);
  drawSlashMark(context, { x: fx.to.x - 14, y: fx.to.y + 10 }, angle + 0.2, 108 * easeOutCubic(impact), fade * 0.72, true);
  for (let index = 0; index < 16; index += 1) {
    const shardAngle = noise(fx.seed, index * 2) * Math.PI * 2;
    const distance = easeOutCubic(impact) * (18 + noise(fx.seed, index * 2 + 1) * 76);
    const point = {
      x: fx.to.x + Math.cos(shardAngle) * distance,
      y: fx.to.y + Math.sin(shardAngle) * distance,
    };
    drawDroplet(context, point, index % 3 === 0 ? 2.7 : 4.2, index % 3 === 0 ? BONE : ARTERIAL, fade * 0.85);
  }
}

function drawBloodMist(context: CanvasRenderingContext2D, fx: TingCombatFx, progress: number): void {
  drawMistCloud(context, fx.to, progress, fx.seed, 1.15);
  const burst = clamp(progress / 0.48);
  drawRing(context, fx.to, 22 + burst * 105, ARTERIAL, 4 * (1 - burst) + 1, (1 - burst) * 0.82);
  for (let index = 0; index < 12; index += 1) {
    const angle = noise(fx.seed, 90 + index) * Math.PI * 2;
    const distance = burst * (30 + noise(fx.seed, 120 + index) * 85);
    const point = { x: fx.to.x + Math.cos(angle) * distance, y: fx.to.y + Math.sin(angle) * distance };
    drawDroplet(context, point, 2.5, index % 3 === 0 ? BONE : ARTERIAL, 1 - burst * 0.72);
  }
  if (progress > 0.28) drawBloodReturn(context, fx.to, fx.from, (progress - 0.28) / 0.72, fx.seed + 13, 5);
  if (progress > 0.52) {
    const recovery = clamp((progress - 0.52) / 0.48);
    drawRing(context, fx.from, 18 + recovery * 52, ARTERIAL, 4, (1 - recovery) * 0.8);
  }
}

function drawGrudgeRend(context: CanvasRenderingContext2D, fx: TingCombatFx, progress: number): void {
  const impact = clamp(progress / 0.86);
  const fade = Math.sin(impact * Math.PI);
  if (impact > 0) {
    const baseAngle = Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x);
    drawSlashMark(context, fx.to, baseAngle - 0.72, 148 * easeOutCubic(impact), fade, true);
    drawSlashMark(context, fx.to, baseAngle + 0.72, 128 * easeOutCubic(clamp(impact * 1.16)), fade * 0.86, false);
  }
  for (let index = 0; index < 5; index += 1) {
    const control = curveControl(fx.from, fx.to, (index - 2) * 22);
    strokeCurve(context, fx.from, control, fx.to, index % 2 === 0 ? VEIN : BLOOD, 2.5, (1 - progress) * 0.46, 8);
  }
}

function drawBloodFeast(context: CanvasRenderingContext2D, fx: TingCombatFx, progress: number): void {
  drawMistCloud(context, fx.to, progress, fx.seed, 0.96);
  if (progress > 0.1) drawBloodReturn(context, fx.to, fx.from, (progress - 0.1) / 0.82, fx.seed + 31, 7);
  const pulse = clamp((progress - 0.34) / 0.66);
  drawRing(context, fx.from, 18 + pulse * 62, ARTERIAL, 5 - pulse * 3, Math.sin(pulse * Math.PI) * 0.9);
  drawRing(context, fx.from, 10 + pulse * 36, BONE, 1.5, Math.sin(pulse * Math.PI) * 0.72);
  for (let index = 0; index < 10; index += 1) {
    const angle = (Math.PI * 2 * index) / 10 + progress * 1.4;
    const radius = 24 + (1 - pulse) * 42;
    drawDroplet(context, {
      x: fx.from.x + Math.cos(angle) * radius,
      y: fx.from.y + Math.sin(angle) * radius,
    }, 3, BLOOD, Math.sin(pulse * Math.PI));
  }
}

function drawWail(context: CanvasRenderingContext2D, fx: TingCombatFx, progress: number): void {
  const center = fx.to;
  context.globalCompositeOperation = 'source-over';
  drawDroplet(context, center, 42 + progress * 44, VEIN, Math.sin(progress * Math.PI) * 0.46);
  context.globalCompositeOperation = 'lighter';
  const corePulse = Math.sin(clamp(progress * 1.45) * Math.PI);
  drawRing(context, center, 16 + progress * 32, BONE, 2.4, corePulse * 0.74);
  drawRing(context, center, 27 + progress * 50, ARTERIAL, 5, corePulse * 0.52);
  for (let ring = 0; ring < 3; ring += 1) {
    const ringProgress = clamp(progress * 1.35 - ring * 0.16);
    const radius = 28 + ringProgress * (104 + ring * 22);
    context.beginPath();
    for (let pointIndex = 0; pointIndex <= 44; pointIndex += 1) {
      const angle = (pointIndex / 44) * Math.PI * 2;
      const jag = (noise(fx.seed + ring, pointIndex) - 0.5) * 13;
      const x = center.x + Math.cos(angle) * (radius + jag);
      const y = center.y + Math.sin(angle) * (radius + jag) * 0.72;
      if (pointIndex === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.strokeStyle = ring === 1 ? '#ffd0d8' : ring === 0 ? ARTERIAL : BLOOD;
    context.lineWidth = 4.2 - ring * 0.6;
    context.globalAlpha = (1 - ringProgress) * 0.96;
    context.stroke();
  }
  context.globalAlpha = 1;
  for (let index = 0; index < 6; index += 1) {
    const angle = (Math.PI * 2 * index) / 6 + 0.35;
    const from = { x: center.x + Math.cos(angle) * 18, y: center.y + Math.sin(angle) * 18 };
    const to = { x: center.x + Math.cos(angle) * (64 + progress * 58), y: center.y + Math.sin(angle) * (46 + progress * 42) - 26 * progress };
    strokeCurve(context, from, curveControl(from, to, (index % 2 === 0 ? 1 : -1) * 24), to, index % 3 === 0 ? BONE : BLOOD, 3.2, (1 - progress) * 0.88, 13);
  }
}

function drawBoneGuard(context: CanvasRenderingContext2D, fx: TingCombatFx, progress: number): void {
  const appear = easeOutCubic(clamp(progress / 0.24));
  const fade = clamp((1 - progress) / 0.24);
  const alpha = Math.min(appear, progress > 0.76 ? fade : 1);
  const radius = 48 + Math.sin(progress * Math.PI) * 11;
  drawRing(context, fx.from, radius + 12, BLOOD, 3, alpha * 0.76);
  drawRing(context, fx.from, radius - 10, DARK_BLOOD, 8, alpha * 0.44);
  for (let index = 0; index < 10; index += 1) {
    const angle = (Math.PI * 2 * index) / 10 + progress * 1.7;
    const center = {
      x: fx.from.x + Math.cos(angle) * radius,
      y: fx.from.y + Math.sin(angle) * radius,
    };
    const tangent = angle + Math.PI / 2;
    const half = 7 + (index % 2) * 2;
    const from = { x: center.x - Math.cos(tangent) * half, y: center.y - Math.sin(tangent) * half };
    const to = { x: center.x + Math.cos(tangent) * half, y: center.y + Math.sin(tangent) * half };
    strokeLine(context, from, to, BONE, 5, alpha, 8);
    drawDroplet(context, from, 3.6, BONE, alpha);
    drawDroplet(context, to, 3.6, BONE, alpha);
  }
}

function drawBloodRite(context: CanvasRenderingContext2D, fx: TingCombatFx, progress: number): void {
  const charge = clamp(progress / 0.34);
  drawRing(context, fx.from, 16 + charge * 48, BLOOD, 5 - charge * 3, (1 - charge) * 0.9);
  drawMistCloud(context, fx.from, clamp(progress * 1.2), fx.seed, 0.58);
  if (progress > 0.18) drawBloodReturn(context, fx.from, fx.to, (progress - 0.18) / 0.72, fx.seed + 47, 4);
  const impact = clamp((progress - 0.42) / 0.58);
  if (impact > 0) {
    drawRing(context, fx.to, 12 + impact * 76, ARTERIAL, 4, (1 - impact) * 0.82);
    drawMistCloud(context, fx.to, impact, fx.seed + 9, 0.62);
  }
}

function drawDetonation(
  context: CanvasRenderingContext2D,
  fx: TingCombatFx,
  progress: number,
  viewport: { width: number; height: number },
): void {
  context.globalCompositeOperation = 'source-over';
  const screenPulse = Math.sin(clamp((progress - 0.22) / 0.62) * Math.PI);
  context.fillStyle = `rgba(82, 0, 18, ${screenPulse * 0.2})`;
  context.fillRect(0, 0, viewport.width, viewport.height);
  context.globalCompositeOperation = 'lighter';

  const charge = clamp(progress / 0.2);
  const chargeFade = 1 - charge * 0.38;
  drawRing(context, fx.to, 94 - charge * 66, ARTERIAL, 5, chargeFade * 0.9);
  drawRing(context, fx.to, 64 - charge * 42, BONE, 2, chargeFade * 0.74);
  for (let index = 0; index < 12; index += 1) {
    const angle = noise(fx.seed, 150 + index) * Math.PI * 2;
    const radius = 88 - charge * 72 + noise(fx.seed, 170 + index) * 18;
    drawDroplet(context, {
      x: fx.to.x + Math.cos(angle) * radius,
      y: fx.to.y + Math.sin(angle) * radius,
    }, 2.4 + noise(fx.seed, 190 + index) * 2.6, index % 4 === 0 ? BONE : ARTERIAL, chargeFade);
  }
  const blast = clamp((progress - 0.2) / 0.58);
  if (blast <= 0) return;
  const radius = easeOutCubic(blast) * Math.min(190, Math.max(112, Math.hypot(fx.to.x - fx.from.x, fx.to.y - fx.from.y) * 0.55));
  const fade = clamp((1 - progress) / 0.34);
  context.globalCompositeOperation = 'source-over';
  drawDroplet(context, fx.to, radius, DARK_BLOOD, fade * 0.44);
  context.globalCompositeOperation = 'lighter';
  drawDroplet(context, fx.to, radius * 0.5, ARTERIAL, fade * 0.5);
  drawDroplet(context, fx.to, radius * 0.16, BONE, fade * 0.88);
  for (let ring = 0; ring < 4; ring += 1) {
    const ringProgress = clamp(blast * 1.28 - ring * 0.12);
    drawRing(context, fx.to, 20 + ringProgress * (120 + ring * 34), ring === 0 ? BONE : ARTERIAL, 7 - ring, (1 - ringProgress) * 0.92);
  }
  for (let index = 0; index < 30; index += 1) {
    const angle = noise(fx.seed, 200 + index) * Math.PI * 2;
    const inner = 18 + blast * 38;
    const outer = inner + blast * (42 + noise(fx.seed, 250 + index) * 112);
    strokeLine(context, {
      x: fx.to.x + Math.cos(angle) * inner,
      y: fx.to.y + Math.sin(angle) * inner,
    }, {
      x: fx.to.x + Math.cos(angle) * outer,
      y: fx.to.y + Math.sin(angle) * outer,
    }, index % 5 === 0 ? BONE : ARTERIAL, index % 5 === 0 ? 2.8 : 1.7, fade * 0.86, 8);
  }
  drawMistCloud(context, fx.to, blast, fx.seed + 77, 1.35);
}

function drawRage(context: CanvasRenderingContext2D, fx: TingCombatFx, progress: number): void {
  const pulse = Math.sin(progress * Math.PI);
  drawRing(context, fx.from, 18 + progress * 74, ARTERIAL, 5 - progress * 3, (1 - progress) * 0.84);
  for (let index = 0; index < 14; index += 1) {
    const offset = (noise(fx.seed, index) - 0.5) * 86;
    const height = 24 + progress * (48 + noise(fx.seed, 30 + index) * 78);
    const from = { x: fx.from.x + offset, y: fx.from.y + 34 };
    const to = { x: fx.from.x + offset * 0.62, y: fx.from.y + 34 - height };
    strokeCurve(context, from, curveControl(from, to, (index % 2 === 0 ? 1 : -1) * 12), to, index % 3 === 0 ? BONE : BLOOD, 2 + index % 3, pulse * 0.74, 9);
  }
}

function drawPuppetRitual(context: CanvasRenderingContext2D, fx: TingCombatFx, progress: number): void {
  drawMistCloud(context, fx.from, progress, fx.seed, 1.08);
  const seal = easeOutCubic(clamp(progress / 0.42));
  drawRing(context, { x: fx.from.x, y: fx.from.y + 24 }, 28 + seal * 64, BLOOD, 4, Math.sin(progress * Math.PI) * 0.82);
  const bladeTop = { x: fx.from.x, y: fx.from.y - 88 * seal };
  const bladeBottom = { x: fx.from.x, y: fx.from.y + 54 * seal };
  strokeLine(context, bladeTop, bladeBottom, DARK_BLOOD, 14, Math.sin(progress * Math.PI) * 0.76, 18);
  strokeLine(context, bladeTop, bladeBottom, BONE, 3, Math.sin(progress * Math.PI), 9);
  strokeLine(context, { x: fx.from.x - 22 * seal, y: fx.from.y - 26 }, { x: fx.from.x + 22 * seal, y: fx.from.y - 26 }, ARTERIAL, 5, Math.sin(progress * Math.PI) * 0.9, 10);
}

export function createTingCombatFx(
  cue: TingCombatEffectCue,
  from: CombatFxPoint,
  targets: CombatFxPoint[],
  serial: number,
  reducedMotion: boolean,
): TingCombatFx[] {
  const destinations = cue.targetMode === 'actor' ? [from] : targets.length > 0 ? targets : [from];
  const baseDuration = MOTION_DURATION[cue.motion];
  const delay = getCombatActorMotionTiming(cue.actorMotion, reducedMotion).effectDelayMs;
  return destinations.map((to, index) => ({
    id: serial * 100 + index,
    motion: cue.motion,
    from: { ...from },
    to: { ...to },
    elapsed: 0,
    delay: reducedMotion ? 0 : delay,
    duration: reducedMotion ? 150 : baseDuration,
    seed: serial * 97 + index * 31 + 11,
  }));
}

export function drawTingCombatFx(
  context: CanvasRenderingContext2D,
  fx: TingCombatFx,
  delta: number,
  viewport: { width: number; height: number },
): boolean {
  fx.elapsed += delta;
  if (fx.elapsed < fx.delay) return true;
  const progress = clamp((fx.elapsed - fx.delay) / fx.duration);

  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.globalCompositeOperation = 'lighter';
  switch (fx.motion) {
    case 'quick_slash': drawQuickSlash(context, fx, progress); break;
    case 'spinal_cleave': drawSpinalCleave(context, fx, progress); break;
    case 'blood_mist': drawBloodMist(context, fx, progress); break;
    case 'grudge_rend': drawGrudgeRend(context, fx, progress); break;
    case 'blood_feast': drawBloodFeast(context, fx, progress); break;
    case 'wail': drawWail(context, fx, progress); break;
    case 'bone_guard': drawBoneGuard(context, fx, progress); break;
    case 'blood_rite': drawBloodRite(context, fx, progress); break;
    case 'detonation': drawDetonation(context, fx, progress, viewport); break;
    case 'rage': drawRage(context, fx, progress); break;
    case 'puppet_ritual': drawPuppetRitual(context, fx, progress); break;
  }
  context.restore();
  return fx.elapsed < fx.delay + fx.duration;
}
