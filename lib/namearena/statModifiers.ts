import type { Fighter, StatKey, TimedStatBase, TimedStatModifier } from './types';

const STAT_KEYS: StatKey[] = ['atk', 'def', 'spd', 'agl', 'mag', 'res', 'wis'];

function captureBase(fighter: Fighter): TimedStatBase {
  return {
    atk: fighter.atk,
    def: fighter.def,
    spd: fighter.spd,
    agl: fighter.agl,
    mag: fighter.mag,
    res: fighter.res,
    wis: fighter.wis,
    critRate: fighter.critRate,
  };
}

function assignBase(fighter: Fighter, base: TimedStatBase): void {
  STAT_KEYS.forEach((key) => {
    fighter[key] = base[key];
  });
  fighter.critRate = base.critRate;
}

function recomputeTimedStats(fighter: Fighter): void {
  const modifiers = fighter.timedStatModifiers ?? [];
  const base = fighter.timedStatBase;
  if (!base) return;

  if (modifiers.length === 0) {
    assignBase(fighter, base);
    delete fighter.timedStatBase;
    delete fighter.timedStatModifiers;
    return;
  }

  STAT_KEYS.forEach((key) => {
    const multiplier = modifiers.reduce((product, modifier) => product * (modifier.multipliers[key] ?? 1), 1);
    fighter[key] = Math.max(1, Math.floor(base[key] * multiplier));
  });
  fighter.critRate = base.critRate + modifiers.reduce((sum, modifier) => sum + modifier.critBonus, 0);
}

function ensureTimedBase(fighter: Fighter): void {
  if (!fighter.timedStatBase) fighter.timedStatBase = captureBase(fighter);
  fighter.timedStatModifiers = fighter.timedStatModifiers ?? [];
}

export function applyTimedStatModifier(fighter: Fighter, modifier: TimedStatModifier): void {
  ensureTimedBase(fighter);
  const modifiers = fighter.timedStatModifiers ?? [];
  const existingIndex = modifiers.findIndex((entry) => entry.id === modifier.id);
  if (existingIndex >= 0) modifiers[existingIndex] = modifier;
  else modifiers.push(modifier);
  fighter.timedStatModifiers = modifiers;
  recomputeTimedStats(fighter);
}

export function removeTimedStatModifier(fighter: Fighter, modifierId: string): boolean {
  if (!fighter.timedStatBase || !fighter.timedStatModifiers?.length) return false;
  const before = fighter.timedStatModifiers.length;
  fighter.timedStatModifiers = fighter.timedStatModifiers.filter((modifier) => modifier.id !== modifierId);
  if (fighter.timedStatModifiers.length === before) return false;
  recomputeTimedStats(fighter);
  return true;
}

export function cleanupOrphanedTimedStatModifiers(fighter: Fighter): void {
  if (!fighter.timedStatBase || !fighter.timedStatModifiers?.length) return;
  const activeModifiers = fighter.timedStatModifiers.filter((modifier) =>
    fighter.status.some((status) =>
      status.type === modifier.statusType &&
      (!modifier.statusSourceId || status.sourceId === modifier.statusSourceId),
    ),
  );
  if (activeModifiers.length === fighter.timedStatModifiers.length) return;
  fighter.timedStatModifiers = activeModifiers;
  recomputeTimedStats(fighter);
}

/**
 * Permanent mutations and transformations must operate on the unmodified stat
 * layer. Active temporary modifiers are then reapplied to the new base.
 */
export function withTimedStatModifiersSuspended<T>(fighter: Fighter, callback: () => T): T {
  if (!fighter.timedStatBase || !fighter.timedStatModifiers?.length) return callback();

  const modifiers = [...fighter.timedStatModifiers];
  assignBase(fighter, fighter.timedStatBase);
  delete fighter.timedStatBase;
  delete fighter.timedStatModifiers;
  try {
    const result = callback();
    fighter.timedStatBase = captureBase(fighter);
    fighter.timedStatModifiers = modifiers;
    recomputeTimedStats(fighter);
    return result;
  } catch (error) {
    fighter.timedStatBase = captureBase(fighter);
    fighter.timedStatModifiers = modifiers;
    recomputeTimedStats(fighter);
    throw error;
  }
}

export function applyPermanentStatBuff(
  fighter: Fighter,
  buff: Partial<Record<StatKey | 'crit', number>>,
): void {
  withTimedStatModifiersSuspended(fighter, () => {
    (Object.keys(buff) as (StatKey | 'crit')[]).forEach((key) => {
      if (key === 'crit') {
        fighter.critRate += buff.crit ?? 0;
        return;
      }
      fighter[key] = Math.max(1, Math.floor(fighter[key] * (buff[key] ?? 1)));
    });
  });
}

export function makeTimedStatModifier(
  id: string,
  statusType: string,
  buff: Partial<Record<StatKey | 'crit', number>>,
  statusSourceId?: string,
): TimedStatModifier {
  const multipliers: Partial<Record<StatKey, number>> = {};
  STAT_KEYS.forEach((key) => {
    if (buff[key] !== undefined) multipliers[key] = buff[key];
  });
  return {
    id,
    statusType,
    statusSourceId,
    multipliers,
    critBonus: buff.crit ?? 0,
  };
}

/** Removes the current ZEROED layer and also understands pre-layer snapshots. */
export function clearZeroedStatPenalty(fighter: Fighter): void {
  const legacyBase = fighter.baseStatsForZero;
  fighter.status = fighter.status.filter((status) => status.type !== 'ZEROED');
  cleanupOrphanedTimedStatModifiers(fighter);
  if (legacyBase) {
    withTimedStatModifiersSuspended(fighter, () => {
      fighter.atk = legacyBase.atk;
      fighter.def = legacyBase.def;
      fighter.res = legacyBase.res;
    });
  }
  delete fighter.baseStatsForZero;
  fighter.wasZeroed = false;
}
