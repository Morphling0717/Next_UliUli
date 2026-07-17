import { getCombatActorMotionTiming } from '@/lib/namearena/combatActorMotion';
import type { TokusatsuCombatEffectCue, TokusatsuCombatMotion } from '@/lib/namearena/combatEffects';
import { TOKUSATSU_ART, TOKUSATSU_ASSET_PATHS } from '@/lib/namearena/tokusatsuArt';

export type TokusatsuFxPoint = { x: number; y: number };

export type TokusatsuCombatFx = {
  id: number;
  motion: TokusatsuCombatMotion;
  from: TokusatsuFxPoint;
  to: TokusatsuFxPoint;
  elapsed: number;
  delay: number;
  duration: number;
  seed: number;
  targetIndex: number;
  targetCount: number;
};

const GREEN = '#64ff72';
const ACID_GREEN = '#b8ff45';
const CYAN = '#4cecff';
const DEEP_GREEN = '#063b2b';
const BLACK = '#05080a';
const SILVER = '#edf7f4';
const GOLD = '#ffd44c';
const BLUE = '#33a8ff';
const VIOLET = '#a96cff';
const RED = '#ff465e';

const MOTION_DURATION: Record<TokusatsuCombatMotion, number> = {
  fan_strike: 620,
  fan_rider_kick: 920,
  fan_cross_beam: 920,
  fan_rocket: 980,
  fan_hero_punch: 780,
  henshin_rehearsal: 1280,
  tokusatsu_soul: 1180,
  bujin_slash: 980,
  black_mist_wave: 1180,
  adversity_flash: 1280,
  miracle_magic: 1120,
  miracle_alchemy: 1320,
  alchemy_armor: 1120,
  bujin_throne: 1420,
  monster_punch: 920,
  energy_crush: 1080,
  miracle_armor: 1320,
  bujin_monster_combo: 1320,
  monster_roar: 1240,
  great_monster_victory: 1480,
  rainbow_fever: 1680,
};

const imageCache = new Map<string, HTMLImageElement>();

function getImage(source: string): HTMLImageElement | null {
  if (typeof window === 'undefined') return null;
  const cached = imageCache.get(source);
  if (cached) return cached;
  const image = new window.Image();
  image.decoding = 'async';
  image.src = source;
  imageCache.set(source, image);
  return image;
}

export function preloadTokusatsuCombatFxAssets(): void {
  TOKUSATSU_ASSET_PATHS.forEach((source) => {
    const image = getImage(source);
    if (!image) return;
    if (image.complete) {
      void image.decode?.().catch(() => undefined);
      return;
    }
    image.addEventListener('load', () => {
      void image.decode?.().catch(() => undefined);
    }, { once: true });
  });
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function easeOut(value: number): number {
  return 1 - Math.pow(1 - clamp(value), 3);
}

function easeInOut(value: number): number {
  const t = clamp(value);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function noise(seed: number, index: number): number {
  return fract(Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453);
}

function mix(from: TokusatsuFxPoint, to: TokusatsuFxPoint, progress: number): TokusatsuFxPoint {
  const t = clamp(progress);
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

function stroke(
  context: CanvasRenderingContext2D,
  from: TokusatsuFxPoint,
  to: TokusatsuFxPoint,
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

function curve(
  context: CanvasRenderingContext2D,
  from: TokusatsuFxPoint,
  to: TokusatsuFxPoint,
  bend: number,
  color: string,
  width: number,
  alpha: number,
  blur = 0,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.quadraticCurveTo(
    (from.x + to.x) / 2 - (dy / distance) * bend,
    (from.y + to.y) / 2 + (dx / distance) * bend,
    to.x,
    to.y,
  );
  context.lineWidth = width;
  context.strokeStyle = color;
  context.globalAlpha = clamp(alpha);
  context.shadowColor = color;
  context.shadowBlur = blur;
  context.stroke();
  context.shadowBlur = 0;
  context.globalAlpha = 1;
}

function ring(context: CanvasRenderingContext2D, center: TokusatsuFxPoint, radius: number, color: string, width: number, alpha: number): void {
  if (radius <= 0) return;
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.lineWidth = width;
  context.strokeStyle = color;
  context.globalAlpha = clamp(alpha);
  context.shadowColor = color;
  context.shadowBlur = 14;
  context.stroke();
  context.shadowBlur = 0;
  context.globalAlpha = 1;
}

function polygon(
  context: CanvasRenderingContext2D,
  center: TokusatsuFxPoint,
  radius: number,
  sides: number,
  rotation: number,
  color: string,
  width: number,
  alpha: number,
): void {
  context.beginPath();
  for (let index = 0; index <= sides; index += 1) {
    const angle = rotation + (Math.PI * 2 * index) / sides;
    const point = { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  }
  context.lineWidth = width;
  context.strokeStyle = color;
  context.globalAlpha = clamp(alpha);
  context.shadowColor = color;
  context.shadowBlur = 12;
  context.stroke();
  context.shadowBlur = 0;
  context.globalAlpha = 1;
}

function star(context: CanvasRenderingContext2D, center: TokusatsuFxPoint, radius: number, color: string, alpha: number, rotation = 0): void {
  context.beginPath();
  for (let index = 0; index <= 10; index += 1) {
    const angle = rotation - Math.PI / 2 + (Math.PI * index) / 5;
    const r = index % 2 === 0 ? radius : radius * 0.42;
    const point = { x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r };
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  }
  context.closePath();
  context.fillStyle = color;
  context.globalAlpha = clamp(alpha);
  context.shadowColor = color;
  context.shadowBlur = 24;
  context.fill();
  context.shadowBlur = 0;
  context.globalAlpha = 1;
}

function drawAsset(
  context: CanvasRenderingContext2D,
  source: string,
  center: TokusatsuFxPoint,
  width: number,
  alpha: number,
  rotation = 0,
  flipX = false,
): void {
  const image = getImage(source);
  if (!image?.complete || image.naturalWidth <= 0) return;
  const height = width * image.naturalHeight / image.naturalWidth;
  context.save();
  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = clamp(alpha);
  context.translate(center.x, center.y);
  context.rotate(rotation);
  context.scale(flipX ? -1 : 1, 1);
  context.drawImage(image, -width / 2, -height / 2, width, height);
  context.restore();
}

function impactBurst(context: CanvasRenderingContext2D, fx: TokusatsuCombatFx, p: number, color = GREEN, rays = 9): void {
  const blast = clamp((p - 0.45) / 0.45);
  const alpha = Math.sin(blast * Math.PI);
  ring(context, fx.to, 18 + blast * 92, color, 5 - blast * 3, alpha);
  for (let index = 0; index < rays; index += 1) {
    const angle = (Math.PI * 2 * index) / rays + noise(fx.seed, index) * 0.25;
    const length = (28 + noise(fx.seed, index + 20) * 66) * easeOut(blast);
    stroke(context, fx.to, { x: fx.to.x + Math.cos(angle) * length, y: fx.to.y + Math.sin(angle) * length }, index % 3 === 0 ? SILVER : color, 2 + index % 3, alpha, 12);
  }
}

function drawFanStrike(context: CanvasRenderingContext2D, fx: TokusatsuCombatFx, p: number): void {
  const travel = easeInOut(clamp(p / 0.58));
  const point = mix(fx.from, fx.to, travel);
  curve(context, fx.from, point, -26, DEEP_GREEN, 14, (1 - p) * 0.65, 12);
  curve(context, fx.from, point, -26, GREEN, 4, 1 - p * 0.5, 16);
  star(context, point, 8 + 10 * Math.sin(p * Math.PI), ACID_GREEN, 0.75);
  impactBurst(context, fx, p, GREEN, 7);
}

function drawRiderKick(context: CanvasRenderingContext2D, fx: TokusatsuCombatFx, p: number): void {
  const travel = easeInOut(clamp(p / 0.62));
  curve(context, fx.from, mix(fx.from, fx.to, travel), -96, GREEN, 10, (1 - p) * 0.9, 18);
  const kick = mix(fx.from, fx.to, travel);
  polygon(context, kick, 12 + p * 10, 6, p * 2, ACID_GREEN, 4, Math.sin(p * Math.PI));
  impactBurst(context, fx, p, ACID_GREEN, 12);
}

function drawCrossBeam(context: CanvasRenderingContext2D, fx: TokusatsuCombatFx, p: number): void {
  const charge = clamp(p / 0.32);
  const half = 22 + charge * 26;
  stroke(context, { x: fx.from.x - half, y: fx.from.y }, { x: fx.from.x + half, y: fx.from.y }, GREEN, 6, charge, 16);
  stroke(context, { x: fx.from.x, y: fx.from.y - half }, { x: fx.from.x, y: fx.from.y + half }, CYAN, 6, charge, 16);
  if (p > 0.28) {
    const beam = clamp((p - 0.28) / 0.42);
    const point = mix(fx.from, fx.to, easeOut(beam));
    stroke(context, fx.from, point, DEEP_GREEN, 20, 1 - p * 0.55, 20);
    stroke(context, fx.from, point, SILVER, 5, 1 - p * 0.3, 22);
  }
  impactBurst(context, fx, p, CYAN, 8);
}

function drawRocket(context: CanvasRenderingContext2D, fx: TokusatsuCombatFx, p: number): void {
  const travel = easeInOut(clamp(p / 0.68));
  const point = mix(fx.from, fx.to, travel);
  curve(context, fx.from, point, 44, RED, 15, 1 - p, 18);
  curve(context, fx.from, point, 44, GOLD, 4, 1 - p * 0.45, 15);
  star(context, point, 12, SILVER, 0.86, p * 3);
  impactBurst(context, fx, p, GOLD, 11);
}

function drawHeroPunch(context: CanvasRenderingContext2D, fx: TokusatsuCombatFx, p: number): void {
  const point = mix(fx.from, fx.to, easeOut(clamp(p / 0.52)));
  polygon(context, point, 18 + p * 18, 5, -p, GREEN, 8, Math.sin(p * Math.PI));
  curve(context, fx.from, point, 18, ACID_GREEN, 16, (1 - p) * 0.54, 18);
  impactBurst(context, fx, p, GREEN, 10);
}

function drawRehearsal(context: CanvasRenderingContext2D, fx: TokusatsuCombatFx, p: number): void {
  const pulse = Math.sin(p * Math.PI);
  drawAsset(context, TOKUSATSU_ART.bujinBelt, { x: fx.from.x, y: fx.from.y + 18 }, 126 + pulse * 18, pulse);
  ring(context, fx.from, 34 + p * 96, GREEN, 4, (1 - p) * 0.8);
  for (let index = 0; index < 5; index += 1) {
    const x = fx.from.x - 62 + index * 31;
    stroke(context, { x, y: fx.from.y - 55 }, { x: x + 18, y: fx.from.y + 70 }, index % 2 ? CYAN : GREEN, 3, pulse * 0.66, 9);
  }
}

function drawSoul(context: CanvasRenderingContext2D, fx: TokusatsuCombatFx, p: number): void {
  const pulse = Math.sin(p * Math.PI);
  ring(context, fx.from, 28 + p * 84, ACID_GREEN, 4, (1 - p) * 0.8);
  for (let index = 0; index < 14; index += 1) {
    const angle = (Math.PI * 2 * index) / 14;
    const distance = 18 + easeOut(p) * (36 + noise(fx.seed, index) * 54);
    const point = { x: fx.from.x + Math.cos(angle) * distance, y: fx.from.y + Math.sin(angle) * distance - p * 24 };
    star(context, point, 2 + noise(fx.seed, index + 20) * 5, index % 3 ? GREEN : SILVER, pulse * 0.7, angle);
  }
  stroke(context, { x: fx.from.x, y: fx.from.y + 54 }, { x: fx.from.x, y: fx.from.y - 66 }, GREEN, 12, pulse * 0.34, 24);
}

function drawBujinSlash(context: CanvasRenderingContext2D, fx: TokusatsuCombatFx, p: number): void {
  const angle = Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x) + Math.PI / 2;
  const swordPoint = mix(fx.from, fx.to, easeOut(clamp(p / 0.5)));
  drawAsset(context, TOKUSATSU_ART.bujinSword, swordPoint, 112, Math.sin(clamp(p / 0.72) * Math.PI), angle);
  const slash = clamp((p - 0.34) / 0.38);
  const length = 70 + slash * 130;
  const slashFrom = { x: fx.to.x - length * 0.45, y: fx.to.y + length * 0.32 };
  const slashTo = { x: fx.to.x + length * 0.45, y: fx.to.y - length * 0.32 };
  const slashAlpha = Math.sin(slash * Math.PI);
  context.save();
  context.globalCompositeOperation = 'source-over';
  stroke(context, slashFrom, slashTo, BLACK, 28, slashAlpha * 0.94, 24);
  context.restore();
  stroke(context, slashFrom, slashTo, GREEN, 9, slashAlpha * 0.74, 24);
  stroke(context, slashFrom, slashTo, SILVER, 3, slashAlpha, 18);
  impactBurst(context, fx, p, GREEN, 6);
}

function drawBlackMistWave(context: CanvasRenderingContext2D, fx: TokusatsuCombatFx, p: number): void {
  const travel = easeOut(clamp(p / 0.72));
  const point = mix(fx.from, fx.to, travel);
  const bend = (fx.targetIndex % 2 ? 1 : -1) * (42 + fx.targetIndex * 18);
  context.save();
  context.globalCompositeOperation = 'source-over';
  curve(context, fx.from, point, bend, BLACK, 32, (1 - p * 0.45) * 0.82, 30);
  context.restore();
  curve(context, fx.from, point, bend, GREEN, 5, 1 - p * 0.55, 18);
  for (let index = 0; index < 9; index += 1) {
    const offset = (noise(fx.seed, index) - 0.5) * 72;
    stroke(context, { x: point.x - 24, y: point.y + offset }, { x: point.x + 32, y: point.y - offset * 0.35 }, index % 3 ? DEEP_GREEN : SILVER, 2, (1 - p) * 0.58, 9);
  }
  impactBurst(context, fx, p, GREEN, 5);
}

function drawAdversityFlash(context: CanvasRenderingContext2D, fx: TokusatsuCombatFx, p: number, viewport: { width: number; height: number }): void {
  const pulse = Math.sin(p * Math.PI);
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = `rgba(0, 5, 4, ${pulse * 0.3})`;
  context.fillRect(0, 0, viewport.width, viewport.height);
  context.globalCompositeOperation = 'lighter';
  if (p < 0.48) {
    const beat = p * 2.1;
    const y = viewport.height * 0.18;
    stroke(context, { x: viewport.width * 0.18, y }, { x: viewport.width * (0.18 + beat * 0.28), y }, RED, 3, 0.55, 10);
  }
  const slash = clamp((p - 0.48) / 0.3);
  const length = slash * 240;
  stroke(context, { x: fx.to.x - length * 0.5, y: fx.to.y + length * 0.3 }, { x: fx.to.x + length * 0.5, y: fx.to.y - length * 0.3 }, SILVER, 8, Math.sin(slash * Math.PI), 28);
  stroke(context, { x: fx.to.x + length * 0.32, y: fx.to.y + length * 0.46 }, { x: fx.to.x - length * 0.32, y: fx.to.y - length * 0.46 }, GREEN, 4, Math.sin(slash * Math.PI), 18);
}

function drawAlchemy(context: CanvasRenderingContext2D, fx: TokusatsuCombatFx, p: number, target = fx.to, rainbow = false): void {
  const pulse = Math.sin(p * Math.PI);
  const colors = rainbow ? [RED, GOLD, GREEN, CYAN, VIOLET] : [GREEN, CYAN, SILVER, ACID_GREEN, BLUE];
  for (let index = 0; index < 5; index += 1) {
    ring(context, target, 24 + index * 15 + easeOut(p) * 32, colors[index], 2 + (index % 2), pulse * (0.72 - index * 0.07));
    polygon(context, target, 22 + index * 17, 6 + (index % 2), p * (index % 2 ? -2 : 2), colors[index], 1.5, pulse * 0.54);
  }
}

function drawArmor(context: CanvasRenderingContext2D, fx: TokusatsuCombatFx, p: number, rainbow = false): void {
  drawAlchemy(context, fx, p, fx.from, rainbow);
  const pulse = Math.sin(p * Math.PI);
  for (let index = 0; index < 6; index += 1) {
    const angle = (Math.PI * 2 * index) / 6 + p;
    const center = { x: fx.from.x + Math.cos(angle) * 62, y: fx.from.y + Math.sin(angle) * 52 };
    polygon(context, center, 17, 6, angle, rainbow ? [RED, GOLD, GREEN, CYAN, BLUE, VIOLET][index] : index % 2 ? CYAN : GREEN, 3, pulse * 0.72);
  }
}

function drawThrone(context: CanvasRenderingContext2D, fx: TokusatsuCombatFx, p: number): void {
  const arrive = easeOut(clamp(p / 0.46));
  const pulse = Math.sin(p * Math.PI);
  drawAsset(context, TOKUSATSU_ART.bujinChair, { x: fx.from.x, y: fx.from.y + 20 - (1 - arrive) * 90 }, 150, pulse * 0.94);
  ring(context, { x: fx.from.x, y: fx.from.y + 42 }, 36 + p * 108, GREEN, 4, (1 - p) * 0.7);
  for (let index = -2; index <= 2; index += 1) {
    stroke(context, { x: fx.from.x + index * 27, y: fx.from.y + 82 }, { x: fx.from.x + index * 18, y: fx.from.y - 96 }, index === 0 ? SILVER : DEEP_GREEN, 5, pulse * 0.48, 14);
  }
}

function drawMonsterPunch(context: CanvasRenderingContext2D, fx: TokusatsuCombatFx, p: number): void {
  const travel = easeOut(clamp(p / 0.58));
  const point = mix(fx.from, fx.to, travel);
  curve(context, fx.from, point, -34, BLUE, 20, (1 - p) * 0.64, 22);
  drawAsset(context, TOKUSATSU_ART.monsterGlove, point, 112 + Math.sin(p * Math.PI) * 28, 1 - p * 0.2, Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x));
  star(context, fx.to, clamp((p - 0.44) / 0.34) * 82, GOLD, Math.sin(clamp((p - 0.44) / 0.5) * Math.PI), p * 1.4);
  impactBurst(context, fx, p, BLUE, 12);
}

function drawEnergyCrush(context: CanvasRenderingContext2D, fx: TokusatsuCombatFx, p: number): void {
  const crush = easeInOut(clamp(p / 0.62));
  const spread = 126 * (1 - crush);
  drawAsset(context, TOKUSATSU_ART.monsterGlove, { x: fx.to.x - spread, y: fx.to.y }, 96, Math.sin(p * Math.PI), 0, false);
  drawAsset(context, TOKUSATSU_ART.monsterGlove, { x: fx.to.x + spread, y: fx.to.y }, 96, Math.sin(p * Math.PI), 0, true);
  polygon(context, fx.to, 28 + crush * 62, 6, p * 2, BLUE, 6, Math.sin(p * Math.PI));
  impactBurst(context, fx, p, GOLD, 14);
}

function drawMonsterCombo(context: CanvasRenderingContext2D, fx: TokusatsuCombatFx, p: number): void {
  const local = clamp((p - fx.targetIndex * 0.08) / 0.72);
  const angle = fx.targetIndex % 2 === 0 ? -0.7 : 0.75;
  const length = 70 + easeOut(local) * 126;
  context.save();
  context.globalCompositeOperation = 'source-over';
  stroke(context, { x: fx.to.x - Math.cos(angle) * length / 2, y: fx.to.y - Math.sin(angle) * length / 2 }, { x: fx.to.x + Math.cos(angle) * length / 2, y: fx.to.y + Math.sin(angle) * length / 2 }, BLACK, 20, Math.sin(local * Math.PI), 20);
  context.restore();
  stroke(context, { x: fx.to.x - Math.cos(angle) * length / 2, y: fx.to.y - Math.sin(angle) * length / 2 }, { x: fx.to.x + Math.cos(angle) * length / 2, y: fx.to.y + Math.sin(angle) * length / 2 }, fx.targetIndex % 2 ? BLUE : GOLD, 4, Math.sin(local * Math.PI), 18);
  drawAsset(context, TOKUSATSU_ART.bujinSword, mix(fx.from, fx.to, easeOut(clamp(local / 0.5))), 92, Math.sin(local * Math.PI), angle + Math.PI / 2);
}

function drawRoar(context: CanvasRenderingContext2D, fx: TokusatsuCombatFx, p: number): void {
  const spread = easeOut(clamp(p / 0.78));
  const direction = Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x);
  for (let index = 0; index < 5; index += 1) {
    const center = mix(fx.from, fx.to, clamp(spread - index * 0.09));
    context.beginPath();
    context.arc(center.x, center.y, 18 + index * 13, direction - 0.72, direction + 0.72);
    context.lineWidth = 7 - index;
    context.strokeStyle = index % 2 ? BLUE : GOLD;
    context.globalAlpha = (1 - p) * 0.74;
    context.shadowColor = context.strokeStyle;
    context.shadowBlur = 16;
    context.stroke();
  }
  context.shadowBlur = 0;
  context.globalAlpha = 1;
  impactBurst(context, fx, p, BLUE, 8);
}

function drawGreatMonsterVictory(context: CanvasRenderingContext2D, fx: TokusatsuCombatFx, p: number, viewport: { width: number; height: number }): void {
  const pulse = Math.sin(p * Math.PI);
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = `rgba(1, 9, 12, ${pulse * 0.34})`;
  context.fillRect(0, 0, viewport.width, viewport.height);
  context.globalCompositeOperation = 'lighter';
  star(context, fx.from, 42 + p * 118, GOLD, pulse * 0.56, p * 2);
  drawMonsterPunch(context, fx, p);
  for (let index = 0; index < 8; index += 1) {
    const angle = (Math.PI * 2 * index) / 8;
    stroke(context, fx.to, { x: fx.to.x + Math.cos(angle) * 210 * easeOut(p), y: fx.to.y + Math.sin(angle) * 160 * easeOut(p) }, index % 2 ? GOLD : BLUE, 7, (1 - p) * 0.76, 20);
  }
}

function drawRainbowFever(context: CanvasRenderingContext2D, fx: TokusatsuCombatFx, p: number, viewport: { width: number; height: number }): void {
  const colors = [RED, GOLD, GREEN, CYAN, BLUE, VIOLET];
  const pulse = Math.sin(p * Math.PI);
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = `rgba(6, 8, 14, ${pulse * 0.28})`;
  context.fillRect(0, 0, viewport.width, viewport.height);
  context.globalCompositeOperation = 'lighter';
  drawAsset(context, TOKUSATSU_ART.rainbowBelt, { x: fx.from.x, y: fx.from.y + 16 }, 138, clamp((0.42 - p) / 0.18));
  const travel = easeInOut(clamp((p - 0.18) / 0.64));
  const point = mix(fx.from, fx.to, travel);
  colors.forEach((color, index) => curve(context, fx.from, point, (index - 2.5) * 11, color, 4, (1 - p) * 0.8, 14));
  drawAsset(context, TOKUSATSU_ART.steamLiner, point, 150 + travel * 90, p > 0.12 ? 0.96 : 0, Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x));
  const blast = clamp((p - 0.58) / 0.36);
  colors.forEach((color, index) => ring(context, fx.to, 24 + blast * (66 + index * 15), color, 4, Math.sin(blast * Math.PI) * 0.82));
  star(context, fx.to, blast * 86, SILVER, Math.sin(blast * Math.PI) * 0.8, p * 2);
}

export function createTokusatsuCombatFx(
  cue: TokusatsuCombatEffectCue,
  from: TokusatsuFxPoint,
  targets: TokusatsuFxPoint[],
  serial: number,
  reducedMotion: boolean,
): TokusatsuCombatFx[] {
  const destinations = cue.targetMode === 'actor' ? [from] : targets.length > 0 ? targets : [from];
  const actorDelay = getCombatActorMotionTiming(cue.actorMotion, reducedMotion).effectDelayMs;
  return destinations.map((to, index) => ({
    id: serial * 100 + index,
    motion: cue.motion,
    from: { ...from },
    to: { ...to },
    elapsed: 0,
    delay: reducedMotion ? 0 : actorDelay + (destinations.length > 1 ? index * 90 : 0),
    duration: reducedMotion ? 170 : MOTION_DURATION[cue.motion],
    seed: serial * 131 + index * 41 + 23,
    targetIndex: index,
    targetCount: destinations.length,
  }));
}

export function drawTokusatsuCombatFx(
  context: CanvasRenderingContext2D,
  fx: TokusatsuCombatFx,
  delta: number,
  viewport: { width: number; height: number },
): boolean {
  fx.elapsed += delta;
  if (fx.elapsed < fx.delay) return true;
  const p = clamp((fx.elapsed - fx.delay) / fx.duration);

  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.globalCompositeOperation = 'lighter';
  switch (fx.motion) {
    case 'fan_strike': drawFanStrike(context, fx, p); break;
    case 'fan_rider_kick': drawRiderKick(context, fx, p); break;
    case 'fan_cross_beam': drawCrossBeam(context, fx, p); break;
    case 'fan_rocket': drawRocket(context, fx, p); break;
    case 'fan_hero_punch': drawHeroPunch(context, fx, p); break;
    case 'henshin_rehearsal': drawRehearsal(context, fx, p); break;
    case 'tokusatsu_soul': drawSoul(context, fx, p); break;
    case 'bujin_slash': drawBujinSlash(context, fx, p); break;
    case 'black_mist_wave': drawBlackMistWave(context, fx, p); break;
    case 'adversity_flash': drawAdversityFlash(context, fx, p, viewport); break;
    case 'miracle_magic': drawAlchemy(context, fx, p); break;
    case 'miracle_alchemy': drawAlchemy(context, fx, p, fx.from); break;
    case 'alchemy_armor': drawArmor(context, fx, p); break;
    case 'bujin_throne': drawThrone(context, fx, p); break;
    case 'monster_punch': drawMonsterPunch(context, fx, p); break;
    case 'energy_crush': drawEnergyCrush(context, fx, p); break;
    case 'miracle_armor': drawArmor(context, fx, p, true); break;
    case 'bujin_monster_combo': drawMonsterCombo(context, fx, p); break;
    case 'monster_roar': drawRoar(context, fx, p); break;
    case 'great_monster_victory': drawGreatMonsterVictory(context, fx, p, viewport); break;
    case 'rainbow_fever': drawRainbowFever(context, fx, p, viewport); break;
  }
  context.restore();
  return fx.elapsed < fx.delay + fx.duration;
}
