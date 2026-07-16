import type { Fighter, JobDefinition, StatusEntry } from './types';

export function cloneJobDefinition(job: JobDefinition): JobDefinition {
  return { ...job, skills: [...job.skills] };
}

export function cloneStatuses(status: StatusEntry[] = []): StatusEntry[] {
  return status.map((s) => ({ ...s }));
}

export function syncHpPct(fighter: Fighter): void {
  fighter.hpPct = fighter.maxHp > 0 ? Math.max(0, fighter.currentHp) / fighter.maxHp : 0;
}

export function setCurrentHp(fighter: Fighter, hp: number): void {
  fighter.currentHp = Math.max(0, Math.min(fighter.maxHp, hp));
  syncHpPct(fighter);
}

export function healFighter(
  fighter: Fighter,
  amount: number,
  log?: (type: string, text: string) => void,
): number {
  if (amount <= 0 || fighter.currentHp >= fighter.maxHp) return 0;
  const isBleeding = fighter.status.some((status) => status.type === 'BLEED');
  const effectiveAmount = isBleeding
    ? Math.floor(amount * 0.75)
    : amount;
  if (isBleeding && effectiveAmount < amount) {
    log?.('debuff', `🩸 【流血】${fighter.name} 的伤口妨碍治疗，本次可恢复量由 ${amount} 降至 ${effectiveAmount}！`);
  }
  if (effectiveAmount <= 0) return 0;
  const before = fighter.currentHp;
  setCurrentHp(fighter, fighter.currentHp + effectiveAmount);
  return fighter.currentHp - before;
}

export function isActiveCombatant(fighter: Fighter): boolean {
  return !fighter.isDead && !fighter.isDeadAnnounced && fighter.currentHp > 0;
}

export function isWinningCombatant(fighter: Fighter): boolean {
  return isActiveCombatant(fighter) && !fighter.cannotWin && !fighter.isNpc;
}

export function canActNormally(fighter: Fighter): boolean {
  return isActiveCombatant(fighter) && !fighter.cannotAct && !fighter.isNpc;
}

export function hasStatus(fighter: Fighter, type: string): boolean {
  return fighter.status.some((s) => s.type === type);
}

export function addStatus(fighter: Fighter, type: string, duration: number, sourceId?: string): void {
  fighter.status.push({ type, duration, ...(sourceId ? { sourceId } : {}) });
}

export function removeStatuses(fighter: Fighter, shouldRemove: (status: StatusEntry) => boolean): void {
  fighter.status = fighter.status.filter((s) => !shouldRemove(s));
}

export function cloneFighter(fighter: Fighter): Fighter {
  return {
    ...fighter,
    jobData: fighter.jobData ? cloneJobDefinition(fighter.jobData) : fighter.jobData,
    status: cloneStatuses(fighter.status),
    stats: { ...fighter.stats },
    exodiaPieces: fighter.exodiaPieces ? [...fighter.exodiaPieces] : fighter.exodiaPieces,
    originiumGrowthRoundActorIds: fighter.originiumGrowthRoundActorIds ? [...fighter.originiumGrowthRoundActorIds] : fighter.originiumGrowthRoundActorIds,
    originiumStatMultipliers: fighter.originiumStatMultipliers ? { ...fighter.originiumStatMultipliers } : fighter.originiumStatMultipliers,
    timedStatBase: fighter.timedStatBase ? { ...fighter.timedStatBase } : fighter.timedStatBase,
    timedStatModifiers: fighter.timedStatModifiers?.map((modifier) => ({
      ...modifier,
      multipliers: { ...modifier.multipliers },
    })),
    emoteAdaptStats: fighter.emoteAdaptStats ? { ...fighter.emoteAdaptStats } : fighter.emoteAdaptStats,
    emoteOwnerBonus: fighter.emoteOwnerBonus ? { ...fighter.emoteOwnerBonus } : fighter.emoteOwnerBonus,
    owlState: fighter.owlState ? { ...fighter.owlState } : fighter.owlState,
    owlSummonState: fighter.owlSummonState ? { ...fighter.owlSummonState } : fighter.owlSummonState,
  };
}

export function cloneFighters(fighters: Fighter[]): Fighter[] {
  return fighters.map(cloneFighter);
}

function snapshotValuesEqual(source: unknown, snapshot: unknown): boolean {
  if (Object.is(source, snapshot)) return true;
  if (
    source === null ||
    snapshot === null ||
    typeof source !== 'object' ||
    typeof snapshot !== 'object'
  ) return false;

  if (Array.isArray(source) || Array.isArray(snapshot)) {
    if (!Array.isArray(source) || !Array.isArray(snapshot) || source.length !== snapshot.length) return false;
    return source.every((value, index) => snapshotValuesEqual(value, snapshot[index]));
  }

  const sourceRecord = source as Record<string, unknown>;
  const snapshotRecord = snapshot as Record<string, unknown>;
  const sourceKeys = Object.keys(sourceRecord);
  const snapshotKeys = Object.keys(snapshotRecord);
  if (sourceKeys.length !== snapshotKeys.length) return false;
  return sourceKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(snapshotRecord, key) &&
    snapshotValuesEqual(sourceRecord[key], snapshotRecord[key]),
  );
}

/**
 * Builds an immutable playback frame while preserving unchanged fighter objects.
 * This keeps per-log HP/status synchronization without deep-cloning the full roster.
 */
export function reconcileFighterSnapshots(
  fighters: readonly Fighter[],
  previous: Fighter[] = [],
): Fighter[] {
  const previousById = new Map(previous.map((fighter) => [fighter.id, fighter]));
  let changed = fighters.length !== previous.length;
  const next = fighters.map((fighter, index) => {
    const candidate = previousById.get(fighter.id);
    if (candidate && snapshotValuesEqual(fighter, candidate)) {
      if (candidate !== previous[index]) changed = true;
      return candidate;
    }
    changed = true;
    return cloneFighter(fighter);
  });
  return changed ? next : previous;
}
