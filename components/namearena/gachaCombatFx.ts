import type { GachaCombatEffectCue, GachaCombatMotion } from '@/lib/namearena/combatEffects';
import { getCombatActorMotionTiming } from '@/lib/namearena/combatActorMotion';

export type GachaFxPoint = { x: number; y: number };

export type GachaCombatFx = {
  id: number;
  motion: GachaCombatMotion;
  from: GachaFxPoint;
  to: GachaFxPoint;
  elapsed: number;
  delay: number;
  duration: number;
  seed: number;
  label?: string;
  count?: number;
};

const GOLD = '#ffd65a';
const PALE_GOLD = '#fff2b5';
const CARD_BLUE = '#46cfff';
const CARD_VIOLET = '#8b68ff';
const MAGENTA = '#ff4fd8';
const CRIMSON = '#d62352';
const SOLAR = '#ffb21c';
const WHITE = '#f7fbff';
const VOID = '#6e2ca5';
const DARK_VOID = '#16051f';

const MOTION_DURATION: Record<GachaCombatMotion, number> = {
  blue_sky: 920,
  qiqi_wish: 1050,
  fake_seal: 920,
  pot_shard: 900,
  debate_smash: 760,
  shipwreck: 1180,
  greed_draw: 1120,
  whale_rewrite: 1420,
  lifesteal_card: 1120,
  ten_pull: 1480,
  ceiling_exchange: 1320,
  ash_blossom: 980,
  mirror_force: 1120,
  monster_reborn: 1360,
  black_lotus: 1180,
  summon_command: 920,
  all_out_attack: 820,
  tribute_prep: 1280,
  summon_recycle: 1120,
  exodia_piece: 1420,
  pity_guard: 1160,
  jackpot: 1480,
  instant_action: 1120,
  luck_star: 860,
  death_save: 1380,
  lifesteal_tether: 980,
  guardian_trap: 1180,
  summon_guard: 920,
  blue_eyes_beam: 1100,
  true_light: 1180,
  ancient_chant: 1320,
  solar_cannon: 1260,
  phoenix: 1380,
  solar_tribute: 1260,
  geo_meteor: 1080,
  saber_arc: 760,
  sam_drive: 820,
  bahamut_flare: 1120,
  emrakul_void: 1280,
  surtr_flame: 920,
  svarog_barrage: 1040,
  blue_eyes_sweep: 1120,
  dragon_roar: 1040,
  ultimate_beam: 1320,
  triple_heads: 980,
  solar_flare: 1260,
  divine_pressure: 1180,
  phoenix_rebirth: 1580,
  solar_guard: 1260,
  dragon_guard: 1120,
  triple_guard: 1220,
  seal_wall: 1320,
  exodia_blast: 1120,
  seal_chains: 1180,
  obliterate: 1480,
};

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

function mix(from: GachaFxPoint, to: GachaFxPoint, progress: number): GachaFxPoint {
  const t = clamp(progress);
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

function curvePoint(from: GachaFxPoint, to: GachaFxPoint, progress: number, bend = 0): GachaFxPoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const control = {
    x: (from.x + to.x) / 2 - (dy / length) * bend,
    y: (from.y + to.y) / 2 + (dx / length) * bend,
  };
  const t = clamp(progress);
  const inv = 1 - t;
  return {
    x: inv * inv * from.x + 2 * inv * t * control.x + t * t * to.x,
    y: inv * inv * from.y + 2 * inv * t * control.y + t * t * to.y,
  };
}

function stroke(
  context: CanvasRenderingContext2D,
  from: GachaFxPoint,
  to: GachaFxPoint,
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
  from: GachaFxPoint,
  to: GachaFxPoint,
  bend: number,
  color: string,
  width: number,
  alpha: number,
  blur = 0,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.quadraticCurveTo(
    (from.x + to.x) / 2 - (dy / length) * bend,
    (from.y + to.y) / 2 + (dx / length) * bend,
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

function ring(
  context: CanvasRenderingContext2D,
  center: GachaFxPoint,
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
  context.shadowColor = color;
  context.shadowBlur = width * 3;
  context.stroke();
  context.shadowBlur = 0;
  context.globalAlpha = 1;
}

function disc(
  context: CanvasRenderingContext2D,
  center: GachaFxPoint,
  radius: number,
  color: string,
  alpha: number,
): void {
  context.beginPath();
  context.arc(center.x, center.y, Math.max(0.5, radius), 0, Math.PI * 2);
  context.fillStyle = color;
  context.globalAlpha = clamp(alpha);
  context.shadowColor = color;
  context.shadowBlur = radius * 0.5;
  context.fill();
  context.shadowBlur = 0;
  context.globalAlpha = 1;
}

function polygon(
  context: CanvasRenderingContext2D,
  center: GachaFxPoint,
  sides: number,
  radius: number,
  rotation: number,
  color: string,
  alpha: number,
  fill = false,
): void {
  context.beginPath();
  for (let index = 0; index <= sides; index += 1) {
    const angle = rotation + (Math.PI * 2 * index) / sides;
    const x = center.x + Math.cos(angle) * radius;
    const y = center.y + Math.sin(angle) * radius;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.globalAlpha = clamp(alpha);
  if (fill) {
    context.fillStyle = color;
    context.fill();
  } else {
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.stroke();
  }
  context.globalAlpha = 1;
}

function star(
  context: CanvasRenderingContext2D,
  center: GachaFxPoint,
  radius: number,
  color: string,
  alpha: number,
  rotation = -Math.PI / 2,
): void {
  context.beginPath();
  for (let index = 0; index <= 10; index += 1) {
    const angle = rotation + (Math.PI * index) / 5;
    const length = index % 2 === 0 ? radius : radius * 0.42;
    const x = center.x + Math.cos(angle) * length;
    const y = center.y + Math.sin(angle) * length;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
  context.fillStyle = color;
  context.globalAlpha = clamp(alpha);
  context.shadowColor = color;
  context.shadowBlur = radius * 0.7;
  context.fill();
  context.shadowBlur = 0;
  context.globalAlpha = 1;
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function card(
  context: CanvasRenderingContext2D,
  center: GachaFxPoint,
  width: number,
  rotation: number,
  accent: string,
  alpha: number,
  label = '',
  back = false,
): void {
  const height = width * 1.458;
  context.save();
  context.translate(center.x, center.y);
  context.rotate(rotation);
  roundedRectPath(context, -width / 2, -height / 2, width, height, Math.max(2, width * 0.07));
  context.fillStyle = back ? '#151228' : '#f0dcc0';
  context.strokeStyle = accent;
  context.lineWidth = Math.max(1.5, width * 0.055);
  context.globalAlpha = clamp(alpha);
  context.shadowColor = accent;
  context.shadowBlur = width * 0.42;
  context.fill();
  context.stroke();
  context.shadowBlur = 0;
  if (back) {
    roundedRectPath(context, -width * 0.36, -height * 0.4, width * 0.72, height * 0.8, width * 0.04);
    context.strokeStyle = '#9f7bff';
    context.lineWidth = Math.max(1, width * 0.035);
    context.stroke();
    ring(context, { x: 0, y: 0 }, width * 0.22, accent, Math.max(1, width * 0.035), alpha);
  } else {
    context.fillStyle = '#1a2028';
    context.fillRect(-width * 0.36, -height * 0.25, width * 0.72, height * 0.43);
    context.strokeStyle = accent;
    context.lineWidth = 1;
    context.strokeRect(-width * 0.36, -height * 0.25, width * 0.72, height * 0.43);
  }
  if (label) {
    context.fillStyle = back ? PALE_GOLD : '#161018';
    context.font = `900 ${Math.max(7, width * 0.17)}px ui-monospace, monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label.slice(0, 10), 0, height * 0.34, width * 0.82);
  }
  context.restore();
  context.globalAlpha = 1;
}

function beam(
  context: CanvasRenderingContext2D,
  from: GachaFxPoint,
  to: GachaFxPoint,
  progress: number,
  colors: readonly string[],
  width: number,
): void {
  const tip = mix(from, to, easeOut(progress));
  colors.forEach((color, index) => {
    stroke(context, from, tip, color, width * (1 - index * 0.24), (1 - progress * 0.42) * (0.38 + index * 0.22), width * 1.8);
  });
  disc(context, tip, Math.max(3, width * 0.4), colors[colors.length - 1] ?? WHITE, 1 - progress * 0.35);
}

function orbitSparks(
  context: CanvasRenderingContext2D,
  center: GachaFxPoint,
  progress: number,
  seed: number,
  color: string,
  count = 16,
  radius = 68,
): void {
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count + progress * (1.2 + (index % 3) * 0.14);
    const wobble = 0.72 + noise(seed, index) * 0.38;
    const point = {
      x: center.x + Math.cos(angle) * radius * wobble,
      y: center.y + Math.sin(angle) * radius * 0.64 * wobble,
    };
    disc(context, point, 1.5 + noise(seed, 40 + index) * 2.5, color, Math.sin(progress * Math.PI));
  }
}

function drawBlueSky(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  for (let index = 0; index < 10; index += 1) {
    const angle = (index - 4.5) * 0.11;
    const point = { x: fx.from.x + (index - 4.5) * 8, y: fx.from.y - 54 - Math.abs(index - 4.5) * 2 };
    card(context, point, 17, angle, '#7dbdff', Math.sin(clamp(p * 1.5) * Math.PI), '', true);
  }
  const travel = clamp((p - 0.22) / 0.62);
  const phone = curvePoint(fx.from, fx.to, easeOut(travel), -42);
  context.save();
  context.translate(phone.x, phone.y);
  context.rotate(travel * Math.PI * 5);
  roundedRectPath(context, -10, -17, 20, 34, 4);
  context.fillStyle = '#111a25';
  context.strokeStyle = CARD_BLUE;
  context.lineWidth = 2;
  context.globalAlpha = travel > 0 ? 1 - clamp((p - 0.86) / 0.14) : 0;
  context.fill();
  context.stroke();
  context.restore();
  ring(context, fx.to, 16 + clamp((p - 0.72) / 0.28) * 52, CARD_BLUE, 3, 1 - clamp((p - 0.72) / 0.28));
}

function drawQiqiWish(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const pulse = Math.sin(p * Math.PI);
  card(context, { x: fx.from.x, y: fx.from.y - 40 }, 42 * easeOut(clamp(p * 2)), 0.04, '#9fe7ff', pulse, 'QIQI');
  ring(context, fx.from, 26 + p * 66, '#9fe7ff', 4, (1 - p) * 0.82);
  for (let index = 0; index < 8; index += 1) {
    const angle = (Math.PI * 2 * index) / 8 + p;
    const point = { x: fx.from.x + Math.cos(angle) * (28 + p * 38), y: fx.from.y + Math.sin(angle) * (20 + p * 30) };
    polygon(context, point, 4, 5, Math.PI / 4, index % 2 ? '#dff8ff' : '#79cfff', pulse, true);
  }
}

function drawFakeSeal(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const alpha = Math.sin(p * Math.PI);
  card(context, fx.from, 46, -0.08 + p * 0.16, '#ff5757', alpha, 'FAKE');
  ring(context, fx.from, 34 + p * 54, '#ff5757', 5, (1 - p) * 0.74);
  stroke(context, { x: fx.from.x - 36, y: fx.from.y - 42 }, { x: fx.from.x + 36, y: fx.from.y + 42 }, '#ff5757', 6, alpha, 12);
}

function drawPotShard(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const pulse = Math.sin(p * Math.PI);
  ring(context, fx.from, 30 + p * 44, GOLD, 3, (1 - p) * 0.8);
  for (let index = 0; index < 9; index += 1) {
    const angle = (Math.PI * 2 * index) / 9 + p * 2.2;
    const radius = 18 + easeOut(p) * (28 + noise(fx.seed, index) * 34);
    polygon(context, {
      x: fx.from.x + Math.cos(angle) * radius,
      y: fx.from.y + Math.sin(angle) * radius * 0.72,
    }, 3, 5 + noise(fx.seed, 30 + index) * 6, angle, index % 3 ? '#d8a64c' : PALE_GOLD, pulse, true);
  }
}

function drawDebateSmash(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const impact = clamp(p / 0.72);
  const angle = Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x) - 0.82;
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const length = 132 * easeOut(impact);
  stroke(context, {
    x: fx.to.x - direction.x * length * 0.55,
    y: fx.to.y - direction.y * length * 0.55,
  }, {
    x: fx.to.x + direction.x * length * 0.45,
    y: fx.to.y + direction.y * length * 0.45,
  }, '#8b5420', 18, Math.sin(impact * Math.PI), 18);
  stroke(context, {
    x: fx.to.x - direction.x * length * 0.55,
    y: fx.to.y - direction.y * length * 0.55,
  }, {
    x: fx.to.x + direction.x * length * 0.45,
    y: fx.to.y + direction.y * length * 0.45,
  }, PALE_GOLD, 4, Math.sin(impact * Math.PI), 10);
  ring(context, fx.to, 12 + impact * 62, GOLD, 4, (1 - impact) * 0.82);
}

function drawShipwreck(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const alpha = Math.sin(p * Math.PI);
  for (let index = 0; index < 18; index += 1) {
    const x = fx.to.x - 84 + noise(fx.seed, index) * 168;
    const y = fx.to.y - 88 + ((p + noise(fx.seed, 30 + index)) % 1) * 176;
    stroke(context, { x, y: y - 16 }, { x: x - 7, y: y + 16 }, index % 3 ? '#437ca5' : '#9fd8ff', 2, alpha * 0.7);
  }
  for (let wave = 0; wave < 3; wave += 1) {
    context.beginPath();
    const radius = 34 + wave * 20 + p * 34;
    context.arc(fx.to.x, fx.to.y + 28, radius, Math.PI * 1.12, Math.PI * 1.88);
    context.strokeStyle = wave === 0 ? '#b9e8ff' : '#3477a4';
    context.lineWidth = 5 - wave;
    context.globalAlpha = (1 - p) * 0.82;
    context.stroke();
  }
  context.globalAlpha = 1;
}

function drawGreed(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const appear = easeOut(clamp(p * 2.4));
  card(context, fx.from, 50 * appear, Math.sin(p * 6) * 0.04, '#45d889', Math.sin(p * Math.PI), 'DRAW 2');
  for (let index = 0; index < 2; index += 1) {
    const direction = index === 0 ? -1 : 1;
    const flight = clamp((p - 0.28) / 0.65);
    const point = { x: fx.from.x + direction * easeOut(flight) * 88, y: fx.from.y - 24 - Math.sin(flight * Math.PI) * 52 };
    card(context, point, 32, direction * (0.18 + flight * 0.24), '#56e4a0', flight * (1 - clamp((p - 0.9) / 0.1)), '', true);
  }
}

function drawWhaleRewrite(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const pulse = Math.sin(p * Math.PI);
  ring(context, fx.from, 28 + easeOut(p) * 92, MAGENTA, 5, (1 - p) * 0.86);
  ring(context, fx.from, 18 + easeOut(p) * 64, CARD_BLUE, 2, (1 - p) * 0.76);
  context.save();
  context.translate(fx.from.x, fx.from.y - 20);
  context.rotate(-0.12 + p * 0.24);
  roundedRectPath(context, -48, -28, 96, 56, 8);
  context.fillStyle = '#0b1630';
  context.strokeStyle = MAGENTA;
  context.lineWidth = 3;
  context.globalAlpha = pulse;
  context.shadowColor = MAGENTA;
  context.shadowBlur = 20;
  context.fill();
  context.stroke();
  context.shadowBlur = 0;
  context.fillStyle = CARD_BLUE;
  context.fillRect(-37, -15, 24, 12);
  context.fillStyle = WHITE;
  context.font = '900 12px ui-monospace, monospace';
  context.textAlign = 'right';
  context.fillText('PAY TO WIN', 39, 16);
  context.restore();
  for (let index = 0; index < 7; index += 1) {
    const y = fx.from.y - 58 + index * 17 + p * 28;
    stroke(context, { x: fx.from.x - 72, y }, { x: fx.from.x + 72, y }, index % 2 ? MAGENTA : CARD_BLUE, 2, pulse * 0.42);
  }
}

function drawLifestealCard(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const pulse = Math.sin(p * Math.PI);
  card(context, fx.from, 48 * easeOut(clamp(p * 2)), -0.06, CRIMSON, pulse, 'DRAIN');
  ring(context, fx.from, 24 + p * 66, CRIMSON, 4, (1 - p) * 0.78);
  for (let index = 0; index < 8; index += 1) {
    const angle = (Math.PI * 2 * index) / 8 + p * 1.8;
    const point = { x: fx.from.x + Math.cos(angle) * (36 + p * 32), y: fx.from.y + Math.sin(angle) * (28 + p * 22) };
    disc(context, point, 3.5, index % 2 ? GOLD : CRIMSON, pulse);
  }
}

function drawTenPull(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const fan = easeOut(clamp(p / 0.5));
  for (let index = 0; index < 10; index += 1) {
    const slot = index - 4.5;
    const point = { x: fx.from.x + slot * 16 * fan, y: fx.from.y - 26 - Math.abs(slot) * 4 * fan };
    const hue = `hsl(${(index * 36 + p * 120) % 360} 92% 66%)`;
    card(context, point, 27, slot * 0.08 * fan, index === 9 ? GOLD : hue, Math.sin(p * Math.PI), index === 9 ? 'SSR' : '', true);
  }
  const burst = clamp((p - 0.42) / 0.58);
  ring(context, fx.from, 34 + burst * 112, GOLD, 6, (1 - burst) * 0.88);
  for (let index = 0; index < 12; index += 1) {
    const color = `hsl(${index * 30} 95% 68%)`;
    const angle = (Math.PI * 2 * index) / 12;
    stroke(context, fx.from, {
      x: fx.from.x + Math.cos(angle) * burst * 132,
      y: fx.from.y + Math.sin(angle) * burst * 96,
    }, color, 3, (1 - burst) * 0.86, 9);
  }
}

function drawCeiling(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const collapse = easeInOut(clamp(p / 0.7));
  for (let index = 0; index < 12; index += 1) {
    const angle = (Math.PI * 2 * index) / 12 + p * 2;
    const radius = (1 - collapse) * 88 + 18;
    const point = { x: fx.from.x + Math.cos(angle) * radius, y: fx.from.y + Math.sin(angle) * radius * 0.65 };
    ring(context, point, 5, GOLD, 2, Math.sin(p * Math.PI));
  }
  card(context, fx.from, 54 * easeOut(clamp((p - 0.36) / 0.5)), 0, MAGENTA, Math.sin(clamp((p - 0.24) / 0.76) * Math.PI), 'PITY');
  ring(context, fx.from, 30 + p * 76, MAGENTA, 3, (1 - p) * 0.72);
}

function drawAshBlossom(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const travel = easeOut(clamp(p / 0.74));
  const head = curvePoint(fx.from, fx.to, travel, 42);
  card(context, head, 34, -0.12 + travel * 0.4, '#ff9dc5', 1 - clamp((p - 0.78) / 0.22), 'ASH');
  for (let index = 0; index < 22; index += 1) {
    const local = clamp(travel - index * 0.025);
    const point = curvePoint(fx.from, fx.to, local, 42 + (index % 3 - 1) * 14);
    polygon(context, {
      x: point.x + (noise(fx.seed, index) - 0.5) * 20,
      y: point.y + (noise(fx.seed, 40 + index) - 0.5) * 20,
    }, 4, 3.5, p * 5 + index, index % 3 ? '#ffb7d2' : WHITE, Math.sin(p * Math.PI), true);
  }
  ring(context, fx.to, 14 + clamp((p - 0.55) / 0.45) * 58, '#ff7ead', 3, 1 - clamp((p - 0.55) / 0.45));
}

function drawMirrorForce(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const alpha = Math.sin(p * Math.PI);
  const radius = 28 + Math.sin(p * Math.PI) * 16;
  polygon(context, fx.to, 6, radius, Math.PI / 6 + p * 0.4, '#9fe8ff', alpha, false);
  polygon(context, fx.to, 6, radius * 0.72, -Math.PI / 6 - p * 0.4, MAGENTA, alpha * 0.75, false);
  stroke(context, { x: fx.to.x - radius * 0.7, y: fx.to.y - radius * 0.7 }, { x: fx.to.x + radius * 0.7, y: fx.to.y + radius * 0.7 }, WHITE, 2, alpha * 0.8);
  ring(context, fx.to, radius + p * 42, CARD_BLUE, 3, (1 - p) * 0.68);
}

function drawMonsterReborn(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const rise = easeOut(clamp(p / 0.68));
  const center = { x: fx.to.x, y: fx.to.y + 72 - rise * 108 };
  card(context, center, 48, (1 - rise) * Math.PI, '#5be2a0', Math.sin(p * Math.PI), 'REBORN');
  ring(context, { x: fx.to.x, y: fx.to.y + 34 }, 20 + rise * 68, '#5be2a0', 4, (1 - p) * 0.82);
  stroke(context, { x: fx.to.x, y: fx.to.y + 30 }, { x: fx.to.x, y: fx.to.y - 62 }, WHITE, 4, Math.sin(p * Math.PI), 12);
  stroke(context, { x: fx.to.x - 24, y: fx.to.y - 10 }, { x: fx.to.x + 24, y: fx.to.y - 10 }, WHITE, 4, Math.sin(p * Math.PI), 12);
}

function drawBlackLotus(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const bloom = easeOut(clamp(p / 0.6));
  const alpha = Math.sin(p * Math.PI);
  disc(context, fx.to, 12 + bloom * 10, DARK_VOID, alpha);
  for (let index = 0; index < 10; index += 1) {
    const angle = (Math.PI * 2 * index) / 10 + p * 0.7;
    const center = { x: fx.to.x + Math.cos(angle) * 34 * bloom, y: fx.to.y + Math.sin(angle) * 24 * bloom };
    context.save();
    context.translate(center.x, center.y);
    context.rotate(angle);
    context.scale(1.9, 0.7);
    disc(context, { x: 0, y: 0 }, 11, index % 2 ? VOID : MAGENTA, alpha * 0.66);
    context.restore();
  }
  orbitSparks(context, fx.to, p, fx.seed, '#c78aff', 14, 72);
}

function drawSummonCommand(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  card(context, fx.from, 38, -0.12, GOLD, Math.sin(p * Math.PI), 'GO');
  const travel = clamp((p - 0.12) / 0.68);
  beam(context, fx.from, fx.to, travel, [CARD_VIOLET, GOLD, WHITE], 8);
  const arrow = mix(fx.from, fx.to, easeOut(travel));
  polygon(context, arrow, 3, 10, Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x), GOLD, 1 - clamp((p - 0.82) / 0.18), true);
}

function drawAllOut(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const travel = easeOut(clamp(p / 0.7));
  for (let index = 0; index < 4; index += 1) {
    const bend = (index - 1.5) * 26;
    const point = curvePoint(fx.from, fx.to, clamp(travel - index * 0.05), bend);
    card(context, point, 21, travel * (index % 2 ? -0.8 : 0.8), index % 2 ? GOLD : CARD_VIOLET, 1 - clamp((p - 0.76) / 0.24), '', true);
    curve(context, fx.from, point, bend, index % 2 ? GOLD : CARD_VIOLET, 2.5, (1 - p) * 0.68, 8);
  }
  ring(context, fx.to, 16 + clamp((p - 0.48) / 0.52) * 66, GOLD, 5, 1 - clamp((p - 0.48) / 0.52));
}

function drawTributePrep(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const alpha = Math.sin(p * Math.PI);
  ring(context, fx.to, 28 + p * 42, SOLAR, 3, (1 - p) * 0.82);
  polygon(context, fx.to, 6, 42 + p * 18, p * 0.5, GOLD, alpha, false);
  for (let index = 0; index < 6; index += 1) {
    const angle = (Math.PI * 2 * index) / 6;
    const base = { x: fx.to.x + Math.cos(angle) * 58, y: fx.to.y + Math.sin(angle) * 42 };
    stroke(context, base, { x: base.x, y: base.y - 16 }, '#ffdf72', 3, alpha);
    disc(context, { x: base.x, y: base.y - 20 - Math.sin(p * 8 + index) * 3 }, 4, SOLAR, alpha);
  }
}

function drawRecycle(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const travel = easeInOut(clamp(p / 0.82));
  for (let index = 0; index < 22; index += 1) {
    const local = clamp(travel - index * 0.022);
    const point = curvePoint(fx.to, fx.from, local, (index % 5 - 2) * 10);
    polygon(context, point, 4, 2.5 + noise(fx.seed, index) * 4, Math.PI / 4 + p * 4, index % 3 ? '#65e6a5' : GOLD, Math.sin(p * Math.PI), true);
  }
  card(context, fx.to, 36 * (1 - clamp(p / 0.68)), p * 2.2, '#65e6a5', 1 - clamp(p / 0.72), 'RECYCLE');
  ring(context, fx.from, 18 + clamp((p - 0.42) / 0.58) * 54, GOLD, 4, 1 - clamp((p - 0.42) / 0.58));
}

function drawExodiaPiece(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const activeCount = Math.max(1, Math.min(5, fx.count ?? 1));
  const radius = 78;
  const order = [0, 2, 4, 1, 3];
  for (let index = 0; index < 5; index += 1) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * order[index]) / 5;
    const point = { x: fx.from.x + Math.cos(angle) * radius, y: fx.from.y + Math.sin(angle) * radius * 0.76 };
    card(context, point, 27, angle + Math.PI / 2, index < activeCount ? GOLD : '#4b355c', Math.sin(p * Math.PI), index < activeCount ? String(index + 1) : '', index >= activeCount);
  }
  star(context, fx.from, 56 * easeOut(clamp(p * 1.5)), '#a45cff', Math.sin(p * Math.PI) * 0.34, p);
  disc(context, fx.from, 10 + p * 18, DARK_VOID, Math.sin(p * Math.PI) * 0.8);
  ring(context, fx.from, 32 + p * 82, CARD_VIOLET, 3, (1 - p) * 0.82);
}

function drawPity(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const count = Math.max(3, Math.min(5, fx.count ?? 3));
  for (let index = 0; index < count; index += 1) {
    const phase = clamp(p * 1.6 - index * 0.08);
    ring(context, fx.from, 24 + phase * (42 + index * 10), index === count - 1 ? PALE_GOLD : GOLD, 5 - index * 0.45, (1 - phase) * 0.8);
  }
  star(context, fx.from, 28 + Math.sin(p * Math.PI) * 20, PALE_GOLD, Math.sin(p * Math.PI));
  orbitSparks(context, fx.from, p, fx.seed, GOLD, 18, 76);
}

function drawJackpot(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const burst = easeOut(p);
  for (let index = 0; index < 18; index += 1) {
    const angle = (Math.PI * 2 * index) / 18;
    const color = `hsl(${index * 20 + p * 90} 96% 67%)`;
    stroke(context, fx.from, { x: fx.from.x + Math.cos(angle) * burst * 132, y: fx.from.y + Math.sin(angle) * burst * 94 }, color, 4, (1 - p) * 0.88, 10);
  }
  polygon(context, { x: fx.from.x, y: fx.from.y - 18 }, 5, 34 + Math.sin(p * Math.PI) * 12, -Math.PI / 2, GOLD, Math.sin(p * Math.PI), false);
  context.save();
  context.fillStyle = PALE_GOLD;
  context.font = '950 20px ui-monospace, monospace';
  context.textAlign = 'center';
  context.globalAlpha = Math.sin(p * Math.PI);
  context.shadowColor = GOLD;
  context.shadowBlur = 16;
  context.fillText('JACKPOT', fx.from.x, fx.from.y + 54);
  context.restore();
  ring(context, fx.from, 34 + p * 98, GOLD, 5, (1 - p) * 0.86);
}

function drawInstantAction(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const snap = easeOut(clamp(p / 0.58));
  const alpha = Math.sin(p * Math.PI);
  for (let index = 0; index < 12; index += 1) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / 12;
    const inner = 34 + snap * 5;
    const outer = inner + (index % 3 === 0 ? 15 : 8);
    stroke(context, {
      x: fx.from.x + Math.cos(angle) * inner,
      y: fx.from.y + Math.sin(angle) * inner,
    }, {
      x: fx.from.x + Math.cos(angle) * outer,
      y: fx.from.y + Math.sin(angle) * outer,
    }, index < 5 ? GOLD : CARD_BLUE, 3, alpha, 8);
  }
  ring(context, fx.from, 38 + snap * 7, PALE_GOLD, 4, alpha);
  const handAngle = -Math.PI / 2 + snap * Math.PI * 2.7;
  stroke(context, fx.from, {
    x: fx.from.x + Math.cos(handAngle) * 29,
    y: fx.from.y + Math.sin(handAngle) * 29,
  }, PALE_GOLD, 5, alpha, 12);
  for (let index = 0; index < 3; index += 1) {
    const point = { x: fx.from.x + 58 + index * 18, y: fx.from.y };
    polygon(context, point, 3, 11, 0, index === 2 ? PALE_GOLD : GOLD, (1 - p) * 0.9, true);
  }
  context.save();
  context.fillStyle = PALE_GOLD;
  context.font = '950 13px ui-monospace, monospace';
  context.textAlign = 'center';
  context.globalAlpha = alpha;
  context.shadowColor = GOLD;
  context.shadowBlur = 12;
  context.fillText('EXTRA ACTION', fx.from.x, fx.from.y + 72);
  context.restore();
}

function drawLuckStar(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const count = Math.max(1, Math.min(5, fx.count ?? 1));
  for (let index = 0; index < count; index += 1) {
    const point = {
      x: fx.from.x + (index - (count - 1) / 2) * 22,
      y: fx.from.y + 18 - easeOut(p) * (54 + index * 6),
    };
    star(context, point, 8 + Math.sin(p * Math.PI) * 4, index === count - 1 ? PALE_GOLD : GOLD, Math.sin(p * Math.PI), p * 3 + index);
  }
  ring(context, fx.from, 18 + p * 46, GOLD, 3, (1 - p) * 0.68);
}

function drawDeathSave(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const restore = clamp((p - 0.28) / 0.72);
  for (let index = 0; index < 8; index += 1) {
    const angle = noise(fx.seed, index) * Math.PI * 2;
    const start = { x: fx.from.x + Math.cos(angle) * 18, y: fx.from.y + Math.sin(angle) * 18 };
    const end = { x: fx.from.x + Math.cos(angle) * (38 + p * 58), y: fx.from.y + Math.sin(angle) * (30 + p * 42) };
    stroke(context, start, end, p < 0.34 ? '#ff365f' : GOLD, 3, Math.sin(p * Math.PI));
  }
  card(context, fx.from, 52 * easeOut(restore), 0, MAGENTA, Math.sin(restore * Math.PI), 'REVIVE');
  ring(context, fx.from, 24 + restore * 82, CARD_BLUE, 5, (1 - restore) * 0.86);
  ring(context, fx.from, 18 + restore * 58, GOLD, 3, (1 - restore) * 0.78);
}

function drawLifestealTether(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  for (let index = 0; index < 5; index += 1) {
    curve(context, fx.from, fx.to, (index - 2) * 18, index % 2 ? GOLD : CRIMSON, 2.5 + index % 2, Math.sin(p * Math.PI) * 0.72, 10);
    const point = curvePoint(fx.from, fx.to, clamp(easeInOut(p) + index * 0.06), (index - 2) * 18);
    disc(context, point, 3.5, index % 2 ? PALE_GOLD : '#ff557a', Math.sin(p * Math.PI));
  }
  ring(context, fx.to, 14 + p * 48, CRIMSON, 4, (1 - p) * 0.78);
}

function drawGuardianTrap(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const flip = easeOut(clamp(p / 0.5));
  const barrier = clamp((p - 0.26) / 0.74);
  const cardPoint = mix(fx.from, fx.to, 0.22);
  card(context, cardPoint, 46, Math.PI * (1 - flip), MAGENTA, Math.sin(p * Math.PI), flip > 0.52 ? 'TRAP' : '');
  curve(context, fx.to, fx.from, -22, '#ff496f', 7, (1 - barrier) * 0.42, 16);
  polygon(context, fx.from, 6, 34 + barrier * 24, p * -0.7, GOLD, Math.sin(p * Math.PI), false);
  polygon(context, fx.from, 6, 25 + barrier * 18, p * 0.9, CARD_BLUE, Math.sin(p * Math.PI) * 0.82, false);
  for (let index = 0; index < 8; index += 1) {
    const angle = (Math.PI * 2 * index) / 8;
    const start = { x: fx.from.x + Math.cos(angle) * 44, y: fx.from.y + Math.sin(angle) * 34 };
    stroke(context, start, {
      x: start.x + Math.cos(angle) * barrier * 38,
      y: start.y + Math.sin(angle) * barrier * 30,
    }, index % 2 ? GOLD : CARD_BLUE, 3, (1 - barrier) * 0.82, 8);
  }
}

function drawSummonGuard(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const rush = easeOut(clamp(p / 0.58));
  const intercept = curvePoint(fx.from, fx.to, Math.min(0.72, rush), -24);
  curve(context, fx.from, intercept, -24, GOLD, 6, (1 - p) * 0.74, 12);
  polygon(context, intercept, 5, 17, Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x), PALE_GOLD, Math.sin(p * Math.PI), true);
  const impact = clamp((p - 0.36) / 0.64);
  context.save();
  context.translate(intercept.x, intercept.y);
  context.rotate(Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x) + Math.PI / 2);
  context.beginPath();
  context.arc(0, 0, 38 + impact * 24, -1.15, 1.15);
  context.strokeStyle = CARD_BLUE;
  context.lineWidth = 8;
  context.globalAlpha = (1 - impact) * 0.88;
  context.shadowColor = CARD_BLUE;
  context.shadowBlur = 18;
  context.stroke();
  context.restore();
  ring(context, fx.to, 12 + impact * 58, GOLD, 4, (1 - impact) * 0.72);
}

function drawBlueEyesBeam(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const charge = clamp(p / 0.28);
  disc(context, fx.from, 8 + charge * 18, '#dff9ff', Math.sin(charge * Math.PI) * 0.92);
  ring(context, fx.from, 18 + charge * 44, CARD_BLUE, 4, (1 - charge) * 0.84);
  if (p > 0.18) beam(context, fx.from, fx.to, (p - 0.18) / 0.68, ['#256dff', '#7de8ff', WHITE], 24);
  const impact = clamp((p - 0.64) / 0.36);
  ring(context, fx.to, 20 + impact * 88, '#a6efff', 6, (1 - impact) * 0.9);
}

function drawTrueLight(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const alpha = Math.sin(p * Math.PI);
  card(context, { x: fx.to.x, y: fx.to.y - 34 }, 44, 0, '#dcfaff', alpha, 'TRUE');
  polygon(context, fx.to, 6, 40 + p * 26, p * 0.45, CARD_BLUE, alpha, false);
  ring(context, fx.to, 28 + p * 74, WHITE, 5, (1 - p) * 0.82);
  for (let index = 0; index < 6; index += 1) {
    const angle = (Math.PI * 2 * index) / 6;
    stroke(context, fx.to, { x: fx.to.x + Math.cos(angle) * 84, y: fx.to.y + Math.sin(angle) * 58 }, WHITE, 2, (1 - p) * 0.62, 8);
  }
}

function drawAncientChant(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const alpha = Math.sin(p * Math.PI);
  const count = Math.max(1, Math.min(3, fx.count ?? 1));
  for (let layer = 0; layer < count; layer += 1) {
    polygon(context, fx.to, 6, 36 + layer * 14 + Math.sin(p * Math.PI) * 12, p * (layer % 2 ? -1 : 1), layer === count - 1 ? PALE_GOLD : SOLAR, alpha * (0.7 + layer * 0.1), false);
  }
  ring(context, fx.to, 24 + p * 82, GOLD, 4, (1 - p) * 0.82);
  orbitSparks(context, fx.to, p, fx.seed, SOLAR, 16, 78);
}

function drawSolarCannon(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const charge = clamp(p / 0.3);
  disc(context, fx.from, 12 + charge * 28, PALE_GOLD, Math.sin(charge * Math.PI) * 0.94);
  ring(context, fx.from, 26 + charge * 50, SOLAR, 5, (1 - charge) * 0.88);
  if (p > 0.18) beam(context, fx.from, fx.to, (p - 0.18) / 0.66, ['#c94300', SOLAR, PALE_GOLD], 30);
  const impact = clamp((p - 0.56) / 0.44);
  disc(context, fx.to, impact * 58, '#ff650f', (1 - impact) * 0.62);
  ring(context, fx.to, 24 + impact * 104, GOLD, 7, (1 - impact) * 0.9);
}

function drawPhoenix(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const alpha = Math.sin(p * Math.PI);
  const spread = easeOut(clamp(p / 0.62));
  disc(context, fx.to, 10 + spread * 18, PALE_GOLD, alpha);
  for (const side of [-1, 1]) {
    for (let feather = 0; feather < 5; feather += 1) {
      const from = { x: fx.to.x + side * 8, y: fx.to.y };
      const to = { x: fx.to.x + side * spread * (42 + feather * 14), y: fx.to.y - spread * (52 - feather * 8) };
      curve(context, from, to, side * (18 + feather * 5), feather % 2 ? SOLAR : '#ff5b19', 7 - feather * 0.7, alpha * (1 - feather * 0.08), 12);
    }
  }
  stroke(context, { x: fx.to.x, y: fx.to.y - 18 }, { x: fx.to.x, y: fx.to.y + 58 }, PALE_GOLD, 7, alpha, 14);
  ring(context, fx.to, 30 + p * 96, SOLAR, 5, (1 - p) * 0.82);
}

function drawPhoenixRebirth(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const rise = easeOut(clamp(p / 0.72));
  const alpha = Math.sin(p * Math.PI);
  const core = { x: fx.from.x, y: fx.from.y + 58 - rise * 96 };
  for (let ember = 0; ember < 28; ember += 1) {
    const spread = (noise(fx.seed, ember) - 0.5) * 118;
    const point = {
      x: fx.from.x + spread * rise,
      y: fx.from.y + 58 - rise * (42 + noise(fx.seed, 40 + ember) * 112),
    };
    star(context, point, 2 + noise(fx.seed, 80 + ember) * 4, ember % 3 ? SOLAR : PALE_GOLD, alpha * 0.82, p * 5 + ember);
  }
  disc(context, core, 12 + rise * 16, PALE_GOLD, alpha);
  for (const side of [-1, 1]) {
    for (let feather = 0; feather < 7; feather += 1) {
      curve(context, core, {
        x: core.x + side * rise * (46 + feather * 14),
        y: core.y - rise * (72 - feather * 6),
      }, side * (22 + feather * 5), feather % 3 ? SOLAR : '#ff481c', 9 - feather * 0.72, alpha * (1 - feather * 0.07), 16);
    }
  }
  stroke(context, { x: core.x, y: core.y - 22 }, { x: core.x, y: core.y + 72 }, PALE_GOLD, 9, alpha, 20);
  ring(context, fx.from, 24 + p * 124, SOLAR, 7, (1 - p) * 0.9);
}

function drawSolarGuard(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const open = easeOut(clamp(p / 0.58));
  const alpha = Math.sin(p * Math.PI);
  curve(context, fx.from, fx.to, -34, SOLAR, 7, alpha * 0.74, 16);
  disc(context, fx.to, 10 + open * 18, PALE_GOLD, alpha * 0.78);
  for (const side of [-1, 1]) {
    for (let feather = 0; feather < 6; feather += 1) {
      const angle = -Math.PI / 2 + side * (0.28 + feather * 0.16);
      curve(context, fx.to, {
        x: fx.to.x + Math.cos(angle) * open * (54 + feather * 8),
        y: fx.to.y + Math.sin(angle) * open * (54 + feather * 8),
      }, side * 18, feather % 2 ? GOLD : PALE_GOLD, 8 - feather * 0.7, alpha * 0.84, 14);
    }
  }
  context.save();
  context.beginPath();
  context.arc(fx.to.x, fx.to.y, 48 + open * 28, Math.PI, 0);
  context.strokeStyle = SOLAR;
  context.lineWidth = 7;
  context.globalAlpha = alpha;
  context.shadowColor = SOLAR;
  context.shadowBlur = 22;
  context.stroke();
  context.restore();
}

function drawSolarTribute(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const travel = easeInOut(clamp(p / 0.82));
  for (let index = 0; index < 24; index += 1) {
    const local = clamp(travel - index * 0.018);
    const point = curvePoint(fx.from, fx.to, local, (index % 7 - 3) * 8);
    star(context, point, 2.5 + noise(fx.seed, index) * 4, index % 3 ? SOLAR : PALE_GOLD, Math.sin(p * Math.PI), p * 4 + index);
  }
  ring(context, fx.from, 18 + p * 54, '#ff7a20', 3, (1 - p) * 0.62);
  ring(context, fx.to, 22 + p * 72, GOLD, 5, (1 - p) * 0.84);
}

function drawGeoMeteor(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const fall = easeInOut(clamp(p / 0.68));
  const meteor = { x: fx.to.x + 72 * (1 - fall), y: fx.to.y - 160 * (1 - fall) };
  polygon(context, meteor, 4, 26 + fall * 12, Math.PI / 4 + p, '#ffba3c', 1 - clamp((p - 0.72) / 0.28), true);
  stroke(context, { x: meteor.x + 62, y: meteor.y - 84 }, meteor, '#ff8d24', 14, 0.52, 18);
  const impact = clamp((p - 0.58) / 0.42);
  ring(context, fx.to, 16 + impact * 92, GOLD, 7, (1 - impact) * 0.9);
  polygon(context, fx.to, 6, 28 + impact * 34, p, '#ffca5b', (1 - impact) * 0.58, false);
}

function drawSaberArc(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const impact = clamp(p / 0.78);
  const base = Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x);
  for (let layer = 0; layer < 3; layer += 1) {
    const radius = 48 + layer * 16 + easeOut(impact) * 48;
    context.beginPath();
    context.arc(fx.to.x, fx.to.y, radius, base - 1.2, base + 0.65);
    context.strokeStyle = layer === 0 ? WHITE : layer === 1 ? '#70c9ff' : GOLD;
    context.lineWidth = 8 - layer * 2.2;
    context.globalAlpha = Math.sin(impact * Math.PI) * (1 - layer * 0.17);
    context.shadowColor = context.strokeStyle;
    context.shadowBlur = 16;
    context.stroke();
  }
  context.shadowBlur = 0;
  context.globalAlpha = 1;
}

function drawSamDrive(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const impact = clamp(p / 0.78);
  for (let index = 0; index < 5; index += 1) {
    curve(context, fx.from, fx.to, (index - 2) * 13, index % 2 ? '#79ffb6' : '#ff7a31', 3 + index, (1 - p) * 0.74, 10);
  }
  const size = 52 + easeOut(impact) * 52;
  stroke(context, { x: fx.to.x - size / 2, y: fx.to.y - size / 2 }, { x: fx.to.x + size / 2, y: fx.to.y + size / 2 }, '#79ffb6', 8, Math.sin(impact * Math.PI), 16);
  stroke(context, { x: fx.to.x + size / 2, y: fx.to.y - size / 2 }, { x: fx.to.x - size / 2, y: fx.to.y + size / 2 }, '#ff7a31', 8, Math.sin(impact * Math.PI), 16);
}

function drawBahamutFlare(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const charge = clamp(p / 0.3);
  disc(context, fx.from, 9 + charge * 23, '#d7b7ff', Math.sin(charge * Math.PI));
  orbitSparks(context, fx.from, charge, fx.seed, '#9a67ff', 12, 46);
  const travel = clamp((p - 0.2) / 0.58);
  const orb = curvePoint(fx.from, fx.to, easeOut(travel), -28);
  disc(context, orb, 15 + Math.sin(travel * Math.PI) * 9, '#b787ff', 1 - clamp((p - 0.8) / 0.2));
  curve(context, fx.from, orb, -28, CARD_VIOLET, 8, (1 - p) * 0.64, 14);
  const blast = clamp((p - 0.62) / 0.38);
  disc(context, fx.to, blast * 72, VOID, (1 - blast) * 0.46);
  ring(context, fx.to, 18 + blast * 112, '#d5bdff', 6, (1 - blast) * 0.86);
}

function drawEmrakulVoid(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const alpha = Math.sin(p * Math.PI);
  disc(context, fx.to, 24 + Math.sin(p * Math.PI) * 34, '#050207', alpha * 0.92);
  ring(context, fx.to, 32 + p * 82, '#a84cff', 5, (1 - p) * 0.78);
  for (let index = 0; index < 9; index += 1) {
    const angle = (Math.PI * 2 * index) / 9 + p * 1.4;
    const from = { x: fx.to.x + Math.cos(angle) * 18, y: fx.to.y + Math.sin(angle) * 18 };
    const to = { x: fx.to.x + Math.cos(angle) * (66 + p * 52), y: fx.to.y + Math.sin(angle) * (48 + p * 38) };
    curve(context, from, to, (index % 2 ? -1 : 1) * 28, index % 3 ? VOID : MAGENTA, 5, alpha * 0.72, 12);
  }
}

function drawSurtrFlame(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const impact = clamp(p / 0.82);
  const angle = Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x) - 0.85;
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const length = 150 * easeOut(impact);
  const start = { x: fx.to.x - direction.x * length * 0.5, y: fx.to.y - direction.y * length * 0.5 };
  const end = { x: fx.to.x + direction.x * length * 0.5, y: fx.to.y + direction.y * length * 0.5 };
  stroke(context, start, end, '#e52d14', 20, Math.sin(impact * Math.PI) * 0.65, 22);
  stroke(context, start, end, SOLAR, 9, Math.sin(impact * Math.PI), 18);
  stroke(context, start, end, PALE_GOLD, 2, Math.sin(impact * Math.PI), 8);
  for (let index = 0; index < 16; index += 1) {
    const point = mix(start, end, noise(fx.seed, index));
    stroke(context, point, { x: point.x + (noise(fx.seed, 30 + index) - 0.5) * 24, y: point.y - 24 - noise(fx.seed, 60 + index) * 38 }, '#ff5a1f', 3, Math.sin(p * Math.PI));
  }
}

function drawSvarogBarrage(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const lock = clamp(p / 0.3);
  ring(context, fx.to, 42 - lock * 15, '#ff3b45', 3, lock * (1 - clamp((p - 0.78) / 0.22)));
  stroke(context, { x: fx.to.x - 48, y: fx.to.y }, { x: fx.to.x + 48, y: fx.to.y }, '#ff3b45', 2, lock * 0.8);
  stroke(context, { x: fx.to.x, y: fx.to.y - 48 }, { x: fx.to.x, y: fx.to.y + 48 }, '#ff3b45', 2, lock * 0.8);
  for (let index = 0; index < 7; index += 1) {
    const shot = clamp((p - 0.22 - index * 0.055) / 0.42);
    if (shot <= 0) continue;
    const origin = { x: fx.from.x + (index - 3) * 5, y: fx.from.y + (index % 2 ? -9 : 9) };
    const target = { x: fx.to.x + (noise(fx.seed, index) - 0.5) * 38, y: fx.to.y + (noise(fx.seed, 20 + index) - 0.5) * 32 };
    beam(context, origin, target, shot, ['#9f111b', '#ff414b', '#ffd1d1'], 5);
  }
}

function drawBlueEyesSweep(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  for (let index = 0; index < 3; index += 1) {
    const offset = (index - 1) * 28;
    const from = { x: fx.from.x, y: fx.from.y + offset * 0.3 };
    const to = { x: fx.to.x, y: fx.to.y + offset };
    beam(context, from, to, clamp((p - index * 0.08) / 0.78), ['#318cff', '#7ee9ff', WHITE], 13 - index * 2);
  }
  ring(context, fx.to, 18 + p * 88, CARD_BLUE, 5, (1 - p) * 0.8);
}

function drawDragonRoar(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  for (let index = 0; index < 4; index += 1) {
    const phase = clamp(p * 1.35 - index * 0.14);
    ring(context, fx.to, 22 + phase * (74 + index * 18), index % 2 ? WHITE : CARD_BLUE, 5 - index * 0.6, (1 - phase) * 0.82);
  }
  for (let ray = 0; ray < 8; ray += 1) {
    const angle = (Math.PI * 2 * ray) / 8;
    curve(context, fx.from, { x: fx.to.x + Math.cos(angle) * 56, y: fx.to.y + Math.sin(angle) * 42 }, (ray % 2 ? -1 : 1) * 18, CARD_BLUE, 2, (1 - p) * 0.45);
  }
}

function drawDragonGuard(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const spread = easeOut(clamp(p / 0.62));
  const alpha = Math.sin(p * Math.PI);
  curve(context, fx.from, fx.to, 28, CARD_BLUE, 7, alpha * 0.74, 16);
  for (const side of [-1, 1]) {
    for (let feather = 0; feather < 6; feather += 1) {
      const angle = Math.PI + side * (0.24 + feather * 0.14);
      curve(context, fx.to, {
        x: fx.to.x + Math.cos(angle) * spread * (48 + feather * 9),
        y: fx.to.y + Math.sin(angle) * spread * (48 + feather * 9),
      }, side * 14, feather % 2 ? WHITE : CARD_BLUE, 7 - feather * 0.55, alpha * 0.82, 14);
    }
  }
  polygon(context, fx.to, 6, 34 + spread * 18, p * -0.8, WHITE, alpha * 0.82, false);
  ring(context, fx.to, 24 + p * 82, CARD_BLUE, 5, (1 - p) * 0.82);
}

function drawUltimateBeam(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const offsets = [-28, 0, 28];
  offsets.forEach((offset, index) => {
    const normalX = fx.to.y - fx.from.y;
    const normalY = -(fx.to.x - fx.from.x);
    const length = Math.max(1, Math.hypot(normalX, normalY));
    const from = { x: fx.from.x + (normalX / length) * offset, y: fx.from.y + (normalY / length) * offset };
    const to = { x: fx.to.x + (normalX / length) * offset * 0.28, y: fx.to.y + (normalY / length) * offset * 0.28 };
    beam(context, from, to, clamp((p - index * 0.06) / 0.74), ['#304fff', '#7de8ff', WHITE], 18);
  });
  const blast = clamp((p - 0.52) / 0.48);
  disc(context, fx.to, blast * 62, '#a9efff', (1 - blast) * 0.48);
  ring(context, fx.to, 24 + blast * 126, WHITE, 7, (1 - blast) * 0.9);
}

function drawTripleHeads(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  for (let index = 0; index < 3; index += 1) {
    const phase = clamp((p - index * 0.13) / 0.58);
    const angle = Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x) + (index - 1) * 0.42;
    const from = { x: fx.to.x - Math.cos(angle) * 62, y: fx.to.y - Math.sin(angle) * 62 };
    const to = { x: fx.to.x + Math.cos(angle) * 34, y: fx.to.y + Math.sin(angle) * 34 };
    curve(context, from, to, (index - 1) * 22, index === 1 ? WHITE : CARD_BLUE, 10 - index, Math.sin(phase * Math.PI), 16);
    polygon(context, to, 3, 11, angle, WHITE, Math.sin(phase * Math.PI), false);
  }
}

function drawTripleGuard(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const incomingAngle = Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x);
  for (let index = 0; index < 3; index += 1) {
    const phase = clamp((p - index * 0.1) / 0.62);
    const side = index - 1;
    const origin = {
      x: fx.from.x - Math.sin(incomingAngle) * side * 28,
      y: fx.from.y + Math.cos(incomingAngle) * side * 28,
    };
    const bite = mix(origin, fx.to, easeOut(phase) * 0.78);
    curve(context, origin, bite, side * 28, index === 1 ? WHITE : CARD_BLUE, 11 - index, Math.sin(phase * Math.PI), 18);
    for (const jaw of [-1, 1]) {
      const jawAngle = incomingAngle + Math.PI + jaw * (0.34 - phase * 0.2);
      stroke(context, bite, {
        x: bite.x + Math.cos(jawAngle) * 28,
        y: bite.y + Math.sin(jawAngle) * 28,
      }, PALE_GOLD, 5, Math.sin(phase * Math.PI), 12);
    }
  }
  const shatter = clamp((p - 0.5) / 0.5);
  ring(context, fx.to, 16 + shatter * 82, WHITE, 6, (1 - shatter) * 0.88);
}

function drawSolarFlare(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  disc(context, fx.from, 13 + clamp(p / 0.3) * 26, PALE_GOLD, Math.sin(clamp(p / 0.3) * Math.PI));
  if (p > 0.16) beam(context, fx.from, fx.to, (p - 0.16) / 0.68, ['#dc3b00', SOLAR, PALE_GOLD], 24);
  const blast = clamp((p - 0.56) / 0.44);
  for (let ray = 0; ray < 12; ray += 1) {
    const angle = (Math.PI * 2 * ray) / 12;
    stroke(context, fx.to, { x: fx.to.x + Math.cos(angle) * blast * 108, y: fx.to.y + Math.sin(angle) * blast * 82 }, ray % 3 ? SOLAR : PALE_GOLD, 5, (1 - blast) * 0.82, 12);
  }
  ring(context, fx.to, 18 + blast * 96, GOLD, 6, (1 - blast) * 0.88);
}

function drawDivinePressure(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const descend = easeOut(clamp(p / 0.72));
  for (let layer = 0; layer < 5; layer += 1) {
    const y = fx.to.y - 112 + descend * (112 + layer * 8);
    context.beginPath();
    context.ellipse(fx.to.x, y, 68 - layer * 7, 22 - layer * 2, 0, 0, Math.PI * 2);
    context.strokeStyle = layer % 2 ? SOLAR : PALE_GOLD;
    context.lineWidth = 5 - layer * 0.65;
    context.globalAlpha = Math.sin(p * Math.PI) * (1 - layer * 0.11);
    context.shadowColor = SOLAR;
    context.shadowBlur = 14;
    context.stroke();
  }
  context.shadowBlur = 0;
  context.globalAlpha = 1;
  ring(context, fx.to, 20 + p * 82, GOLD, 5, (1 - p) * 0.78);
}

function drawExodiaBlast(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const travel = clamp(p / 0.74);
  const point = curvePoint(fx.from, fx.to, easeOut(travel), -36);
  disc(context, point, 15 + Math.sin(travel * Math.PI) * 13, '#c86cff', 1 - clamp((p - 0.82) / 0.18));
  curve(context, fx.from, point, -36, VOID, 12, (1 - p) * 0.72, 18);
  star(context, point, 16, '#ebc6ff', 1 - clamp((p - 0.78) / 0.22), p * 3);
  const blast = clamp((p - 0.58) / 0.42);
  disc(context, fx.to, blast * 58, DARK_VOID, (1 - blast) * 0.68);
  ring(context, fx.to, 18 + blast * 104, '#c86cff', 6, (1 - blast) * 0.86);
}

function drawSealChains(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const travel = easeOut(clamp(p / 0.72));
  for (let chainIndex = 0; chainIndex < 4; chainIndex += 1) {
    const bend = (chainIndex - 1.5) * 26;
    const head = curvePoint(fx.from, fx.to, travel, bend);
    curve(context, fx.from, head, bend, chainIndex % 2 ? '#a76cff' : GOLD, 3, 1 - clamp((p - 0.78) / 0.22), 9);
    for (let link = 0; link < 9; link += 1) {
      const point = curvePoint(fx.from, head, link / 8, bend);
      polygon(context, point, 4, 4.5, p * 3 + link, chainIndex % 2 ? '#b987ff' : PALE_GOLD, Math.sin(p * Math.PI), false);
    }
  }
  polygon(context, fx.to, 6, 36 + p * 22, p, VOID, Math.sin(p * Math.PI), false);
}

function drawSealWall(context: CanvasRenderingContext2D, fx: GachaCombatFx, p: number): void {
  const raise = easeOut(clamp(p / 0.56));
  const alpha = Math.sin(p * Math.PI);
  const center = mix(fx.from, fx.to, 0.68);
  star(context, center, 52 * raise, GOLD, alpha * 0.7, -p * 0.8);
  polygon(context, center, 6, 64 * raise, p * -0.5, VOID, alpha, false);
  polygon(context, center, 6, 45 * raise, p * 0.7, '#d6a2ff', alpha * 0.8, false);
  for (let index = 0; index < 5; index += 1) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / 5;
    const seal = {
      x: center.x + Math.cos(angle) * 48 * raise,
      y: center.y + Math.sin(angle) * 48 * raise,
    };
    card(context, seal, 20 * raise, angle + Math.PI / 2, index % 2 ? GOLD : CARD_VIOLET, alpha, String(index + 1), true);
  }
  const recoil = clamp((p - 0.44) / 0.56);
  beam(context, fx.to, center, recoil, ['#ff365f', VOID, PALE_GOLD], 12);
  ring(context, fx.to, 18 + recoil * 72, VOID, 5, (1 - recoil) * 0.82);
}

function drawObliterate(
  context: CanvasRenderingContext2D,
  fx: GachaCombatFx,
  p: number,
  viewport: { width: number; height: number },
): void {
  const pulse = Math.sin(p * Math.PI);
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = `rgba(34, 3, 46, ${pulse * 0.22})`;
  context.fillRect(0, 0, viewport.width, viewport.height);
  context.globalCompositeOperation = 'lighter';
  star(context, fx.from, 62 + p * 72, '#9c4cff', pulse * 0.5, p * -0.8);
  for (let ray = 0; ray < 10; ray += 1) {
    const angle = (Math.PI * 2 * ray) / 10 + p * 0.4;
    stroke(context, fx.from, { x: fx.from.x + Math.cos(angle) * 180 * easeOut(p), y: fx.from.y + Math.sin(angle) * 132 * easeOut(p) }, ray % 2 ? VOID : MAGENTA, 6, (1 - p) * 0.72, 16);
  }
  if (p > 0.2) beam(context, fx.from, fx.to, (p - 0.2) / 0.62, [DARK_VOID, VOID, '#e8c8ff'], 28);
  const blast = clamp((p - 0.56) / 0.44);
  disc(context, fx.to, blast * 74, DARK_VOID, (1 - blast) * 0.78);
  ring(context, fx.to, 24 + blast * 128, '#d7a5ff', 7, (1 - blast) * 0.9);
}

export function createGachaCombatFx(
  cue: GachaCombatEffectCue,
  from: GachaFxPoint,
  targets: GachaFxPoint[],
  serial: number,
  reducedMotion: boolean,
  metadata: { label?: string; count?: number } = {},
): GachaCombatFx[] {
  const destinations = cue.targetMode === 'actor' ? [from] : targets.length > 0 ? targets : [from];
  const delay = getCombatActorMotionTiming(cue.actorMotion, reducedMotion).effectDelayMs;
  return destinations.map((to, index) => ({
    id: serial * 100 + index,
    motion: cue.motion,
    from: { ...from },
    to: { ...to },
    elapsed: 0,
    delay: reducedMotion ? 0 : delay,
    duration: reducedMotion ? 160 : MOTION_DURATION[cue.motion],
    seed: serial * 113 + index * 37 + 19,
    label: metadata.label,
    count: metadata.count,
  }));
}

export function drawGachaCombatFx(
  context: CanvasRenderingContext2D,
  fx: GachaCombatFx,
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
    case 'blue_sky': drawBlueSky(context, fx, p); break;
    case 'qiqi_wish': drawQiqiWish(context, fx, p); break;
    case 'fake_seal': drawFakeSeal(context, fx, p); break;
    case 'pot_shard': drawPotShard(context, fx, p); break;
    case 'debate_smash': drawDebateSmash(context, fx, p); break;
    case 'shipwreck': drawShipwreck(context, fx, p); break;
    case 'greed_draw': drawGreed(context, fx, p); break;
    case 'whale_rewrite': drawWhaleRewrite(context, fx, p); break;
    case 'lifesteal_card': drawLifestealCard(context, fx, p); break;
    case 'ten_pull': drawTenPull(context, fx, p); break;
    case 'ceiling_exchange': drawCeiling(context, fx, p); break;
    case 'ash_blossom': drawAshBlossom(context, fx, p); break;
    case 'mirror_force': drawMirrorForce(context, fx, p); break;
    case 'monster_reborn': drawMonsterReborn(context, fx, p); break;
    case 'black_lotus': drawBlackLotus(context, fx, p); break;
    case 'summon_command': drawSummonCommand(context, fx, p); break;
    case 'all_out_attack': drawAllOut(context, fx, p); break;
    case 'tribute_prep': drawTributePrep(context, fx, p); break;
    case 'summon_recycle': drawRecycle(context, fx, p); break;
    case 'exodia_piece': drawExodiaPiece(context, fx, p); break;
    case 'pity_guard': drawPity(context, fx, p); break;
    case 'jackpot': drawJackpot(context, fx, p); break;
    case 'instant_action': drawInstantAction(context, fx, p); break;
    case 'luck_star': drawLuckStar(context, fx, p); break;
    case 'death_save': drawDeathSave(context, fx, p); break;
    case 'lifesteal_tether': drawLifestealTether(context, fx, p); break;
    case 'guardian_trap': drawGuardianTrap(context, fx, p); break;
    case 'summon_guard': drawSummonGuard(context, fx, p); break;
    case 'blue_eyes_beam': drawBlueEyesBeam(context, fx, p); break;
    case 'true_light': drawTrueLight(context, fx, p); break;
    case 'ancient_chant': drawAncientChant(context, fx, p); break;
    case 'solar_cannon': drawSolarCannon(context, fx, p); break;
    case 'phoenix': drawPhoenix(context, fx, p); break;
    case 'solar_tribute': drawSolarTribute(context, fx, p); break;
    case 'geo_meteor': drawGeoMeteor(context, fx, p); break;
    case 'saber_arc': drawSaberArc(context, fx, p); break;
    case 'sam_drive': drawSamDrive(context, fx, p); break;
    case 'bahamut_flare': drawBahamutFlare(context, fx, p); break;
    case 'emrakul_void': drawEmrakulVoid(context, fx, p); break;
    case 'surtr_flame': drawSurtrFlame(context, fx, p); break;
    case 'svarog_barrage': drawSvarogBarrage(context, fx, p); break;
    case 'blue_eyes_sweep': drawBlueEyesSweep(context, fx, p); break;
    case 'dragon_roar': drawDragonRoar(context, fx, p); break;
    case 'ultimate_beam': drawUltimateBeam(context, fx, p); break;
    case 'triple_heads': drawTripleHeads(context, fx, p); break;
    case 'solar_flare': drawSolarFlare(context, fx, p); break;
    case 'divine_pressure': drawDivinePressure(context, fx, p); break;
    case 'phoenix_rebirth': drawPhoenixRebirth(context, fx, p); break;
    case 'solar_guard': drawSolarGuard(context, fx, p); break;
    case 'dragon_guard': drawDragonGuard(context, fx, p); break;
    case 'triple_guard': drawTripleGuard(context, fx, p); break;
    case 'seal_wall': drawSealWall(context, fx, p); break;
    case 'exodia_blast': drawExodiaBlast(context, fx, p); break;
    case 'seal_chains': drawSealChains(context, fx, p); break;
    case 'obliterate': drawObliterate(context, fx, p, viewport); break;
  }
  context.restore();
  return fx.elapsed < fx.delay + fx.duration;
}
