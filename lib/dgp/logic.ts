/**
 * DGP 逻辑/助手函数。
 * 1:1 Ported from legacy lib/dgp/3_logic.js 的全部函数。
 */

import { BUCKLES } from './data';
import type { Player, BuckleDef, BuckleSkill } from './types';

export function calculateBuckleScore(player: Player, buckle: BuckleDef): number {
  // --- 核心修改：双重指挥带扣具有绝对最高诱惑力 ---
  if (buckle.id === 'Command_Raising' || buckle.id === 'Command_Twin') return 999999;

  if (buckle.id === 'Fever') return 999999;
  if (buckle.id === 'Boost') return 99999;
  if (buckle.id === player.idCore.affinity) return 5000;
  let score = buckle.tier === 'large' ? 1000 : 100;
  if (buckle.pref) {
    if (buckle.pref.str) score += player.str * buckle.pref.str;
    if (buckle.pref.agi) score += player.agi * buckle.pref.agi;
    if (buckle.pref.int) score += player.int * buckle.pref.int;
  }
  return score;
}

export function getWeightedRandomBuckle(
  availableKeys: string[],
  player: Player,
  rng: () => number = Math.random,
): string {
  const weights = availableKeys.map((key) => {
    const buckle = BUCKLES[key];
    let baseWeight = buckle.tier === 'large' ? 10 : 90;
    if (player.idCore.passive === 'luck' && buckle.tier === 'large') baseWeight *= 3;
    let weight = baseWeight;
    const prefMultiplier = buckle.tier === 'large' ? 0.05 : 0.5;
    if (buckle.pref) {
      if (buckle.pref.str) weight += player.str * buckle.pref.str * prefMultiplier;
      if (buckle.pref.agi) weight += player.agi * buckle.pref.agi * prefMultiplier;
      if (buckle.pref.int) weight += player.int * buckle.pref.int * prefMultiplier;
    }
    if (buckle.id === player.idCore.affinity) weight += buckle.tier === 'large' ? 10 : 40;
    return weight;
  });
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let random = rng() * totalWeight;
  for (let i = 0; i < availableKeys.length; i++) {
    if (random < weights[i]) return availableKeys[i];
    random -= weights[i];
  }
  return availableKeys[availableKeys.length - 1];
}

export function applyBuff(
  player: Player,
  type: string,
  duration: number,
  sourceId: string | null = null,
): boolean {
  // 护盾抵抗负面状态
  if (
    player.shield > 0 &&
    ['Poison', 'Stun', 'Vulnerable', 'Locked-on', 'Wet'].includes(type)
  ) {
    return false;
  }

  // 眩晕免疫判定
  if (type === 'Stun' && player.buffs.some((b) => b.type === 'Stun Immune')) {
    return false;
  }

  const existing = player.buffs.find((b) => b.type === type);
  if (existing) {
    existing.duration = Math.max(existing.duration, duration);
    if (sourceId) existing.sourceId = sourceId;
  } else {
    player.buffs.push({ type, duration, sourceId });
  }
  return true;
}

export function getEffectiveAgi(p: Player): number {
  return p.buffs.some((b) => b.type === 'Wet') ? p.agi * 0.7 : p.agi;
}

export function getThreatScore(
  actor: Player,
  target: Player,
  skill?: BuckleSkill | null,
  rng: () => number = Math.random,
): number {
  let score = 100;
  if (target.isBountyTarget) score += 2000;
  if (actor.isJyamato) {
    if (target.buckles?.some((b) => b.tags.includes('tank'))) score += 80;
    score -= (target.hp / target.maxHp) * 50;
    if (target.buffs.some((b) => b.type === 'Phantom')) score -= 60;
  } else {
    if (
      skill &&
      (skill.tags?.includes('ranged') ||
        actor.buckles.some((b) => b.tags.includes('assassin')))
    ) {
      if (target.hp / target.maxHp < 0.4) score += 100;
      if (target.buffs.some((b) => b.type === 'Vulnerable')) score += 80;
    } else {
      if (target.atk > 100) score += 40;
    }
    if (actor.int > 50) {
      if (target.idCore?.passive === 'thorns') {
        const actorHpRatio = actor.hp / actor.maxHp;
        const targetHpRatio = target.hp / target.maxHp;
        const targetHasFever = target.buckles?.some((b) => b.id === 'Fever');
        score -= targetHasFever ? 25 : 15;
        if (actorHpRatio < 0.35) score -= targetHasFever ? 30 : 15;
        if (targetHpRatio < 0.4) score += 45;
        if (target.atk > actor.atk) score += 20;
      }
      if (target.shield > 200) score -= Math.min(30, target.shield / 25);
    }
    if (skill && skill.magic && target.buffs.some((b) => b.type === 'Wet')) score += 60;
  }
  score += rng() * 30;
  return score;
}
