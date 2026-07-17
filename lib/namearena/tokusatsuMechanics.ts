import type { Fighter } from './types';
import { grantStatus } from './defenseStatus';

export const TOKUSATSU_THRONE_RESONANCE_MAX = 5;

export function canUseTokusatsuThrone(fighter: Fighter): boolean {
  return !!fighter.isTokusatsu &&
    fighter.job === 'MIRACLE_BUJIN' &&
    !fighter.counterUsed &&
    !fighter.status.some((status) => status.type === 'WAIT_COUNTER');
}

export function getTokusatsuThroneResonance(fighter: Fighter): number {
  return Math.max(0, Math.min(TOKUSATSU_THRONE_RESONANCE_MAX, fighter.tokusatsuThroneResonance ?? 0));
}

export function addTokusatsuThroneResonance(fighter: Fighter, amount = 1): number {
  if (!canUseTokusatsuThrone(fighter)) return getTokusatsuThroneResonance(fighter);
  const next = Math.min(TOKUSATSU_THRONE_RESONANCE_MAX, getTokusatsuThroneResonance(fighter) + amount);
  fighter.tokusatsuThroneResonance = next;
  return next;
}

export function clearTokusatsuThroneResonance(fighter: Fighter): void {
  fighter.tokusatsuThroneResonance = 0;
}

export function getTokusatsuThroneChance(fighter: Fighter): number {
  const resonance = getTokusatsuThroneResonance(fighter);
  const base = fighter.hpPct <= 0.35 ? 0.18 : (fighter.hpPct <= 0.75 ? 0.07 : 0.02);
  const perStack = fighter.hpPct <= 0.35 ? 0.025 : (fighter.hpPct <= 0.75 ? 0.03 : 0.02);
  return Math.min(0.33, base + resonance * perStack);
}

export function getTokusatsuControlThroneChance(fighter: Fighter): number {
  return Math.min(0.22, 0.1 + getTokusatsuThroneResonance(fighter) * 0.02);
}

export function enterTokusatsuThroneStance(fighter: Fighter, bkbDuration = 2, spellBlockDuration = 2): void {
  fighter.status = fighter.status.filter((status) => status.type !== 'WAIT_COUNTER');
  grantStatus(fighter, 'WAIT_COUNTER', 4);
  grantStatus(fighter, 'BKB', bkbDuration, 'tokusatsu_bujin_throne');
  grantStatus(fighter, 'SPELL_BLOCK', spellBlockDuration, 'tokusatsu_bujin_throne');
  clearTokusatsuThroneResonance(fighter);
}
