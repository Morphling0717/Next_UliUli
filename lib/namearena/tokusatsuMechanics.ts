import type { Fighter } from './types';

import { hasIdentity, removeEffects, applyStatus } from './statusSystem';

export const TOKUSATSU_THRONE_RESONANCE_MAX = 5;
const TOKUSATSU_THRONE_STATUS_GROUP = 'tokusatsu_bujin_throne';

export function canUseTokusatsuThrone(fighter: Fighter): boolean {
  return !!fighter.isTokusatsu &&
    fighter.job === 'MIRACLE_BUJIN' &&
    !fighter.counterUsed &&
    !hasIdentity(fighter, 'WAIT_COUNTER');
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
  removeEffects(fighter, { identityIds: ['WAIT_COUNTER'], reason: 'replaced' });
  const throneAttribution = {
    effectSourceId: TOKUSATSU_THRONE_STATUS_GROUP,
    effectSourceName: '武神王座',
  };
  applyStatus(fighter, {
    identityId: 'BKB',
    remainingTurns: bkbDuration,
    groupId: TOKUSATSU_THRONE_STATUS_GROUP,
    attribution: throneAttribution,
  });
  applyStatus(fighter, {
    identityId: 'SPELL_BLOCK',
    charges: spellBlockDuration,
    groupId: TOKUSATSU_THRONE_STATUS_GROUP,
    attribution: throneAttribution,
  });
  applyStatus(fighter, {
    identityId: 'WAIT_COUNTER',
    charges: 1,
    groupId: TOKUSATSU_THRONE_STATUS_GROUP,
    attribution: throneAttribution,
  });
  clearTokusatsuThroneResonance(fighter);
}
