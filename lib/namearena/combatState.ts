import type { Fighter, HealingKind, HealingResolutionRecord, JobDefinition, StatKey, StatusInstance } from './types';
import { hasIdentity, queryMechanic, removeEffects, withPersistentStatusShapesSuspended } from './statusSystem';
import { isSurtrAfterglowActive } from './surtrMechanics';

export function cloneJobDefinition(job: JobDefinition): JobDefinition {
  return { ...job, skills: [...job.skills] };
}

export function cloneStatuses(status: StatusInstance[] = []): StatusInstance[] {
  return status.map((s) => ({
    ...s,
    attribution: { ...s.attribution },
    damageSourceMask: s.damageSourceMask ? [...s.damageSourceMask] : undefined,
    statScope: s.statScope ? [...s.statScope] : undefined,
  }));
}

export function syncHpPct(fighter: Fighter): void {
  if (isSurtrAfterglowActive(fighter)) {
    // Afterglow uses one internal HP only to remain in the turn scheduler.
    // Normalize direct HP writes so buffs and full resets cannot heal it.
    fighter.currentHp = 1;
    fighter.hpPct = 0;
    return;
  }
  fighter.hpPct = fighter.maxHp > 0
    ? Math.max(0, fighter.currentHp) / fighter.maxHp
    : 0;
}

export function setCurrentHp(fighter: Fighter, hp: number): void {
  fighter.currentHp = Math.max(0, Math.min(fighter.maxHp, hp));
  syncHpPct(fighter);
}

export function resolveHealing(
  fighter: Fighter,
  amount: number,
  options: {
    kind?: HealingKind;
    sourceId?: string;
    healer?: Fighter;
  } = {},
  log?: (type: string, text: string) => void,
): HealingResolutionRecord {
  const attempted = Math.max(0, Math.floor(amount));
  const vitality = queryMechanic(fighter, 'VITALITY').potency;
  const exhaustion = queryMechanic(fighter, 'EXHAUSTION').potency;
  const multiplier = Math.max(0, (1 + vitality / 100) * Math.max(0, 1 - exhaustion / 100));
  // Ordinary healing must never double as an implicit revival. Explicit
  // revival handlers restore the combatant state before invoking healing.
  const canReceiveHealing =
    !fighter.isDead &&
    !fighter.isDeadAnnounced &&
    fighter.currentHp > 0 &&
    !isSurtrAfterglowActive(fighter);
  const effectiveAmount = canReceiveHealing
    ? Math.max(0, Math.floor(attempted * multiplier))
    : 0;
  const before = fighter.currentHp;
  if (effectiveAmount > 0 && fighter.currentHp < fighter.maxHp) {
    setCurrentHp(fighter, fighter.currentHp + effectiveAmount);
  }
  const actual = fighter.currentHp - before;
  const prevented = Math.max(0, attempted - effectiveAmount);
  const outcome: HealingResolutionRecord['outcome'] = actual > 0
    ? 'healed'
    : attempted <= 0
      ? 'no_effect'
      : effectiveAmount <= 0
        ? 'blocked'
        : 'full';
  if (attempted > 0 && exhaustion > 0 && effectiveAmount <= 0) {
    log?.('info', `🥀 【枯竭】${fighter.name} 的治疗被完全阻止！（枯竭 ${exhaustion}%）`);
  } else if (attempted > 0 && (vitality > 0 || exhaustion > 0) && effectiveAmount !== attempted) {
    const statusText = [vitality > 0 ? `生机 ${vitality}%` : '', exhaustion > 0 ? `枯竭 ${exhaustion}%` : '']
      .filter(Boolean)
      .join('、');
    log?.(effectiveAmount > attempted ? 'buff' : 'debuff', `🌱 【治疗修正】${fighter.name} 受到${statusText}影响，治疗量由 ${attempted} 调整为 ${effectiveAmount}。`);
  }
  return {
    attempted,
    modified: effectiveAmount,
    actual,
    prevented,
    outcome,
    kind: options.kind ?? 'direct',
    sourceId: options.sourceId,
    healerId: options.healer?.id,
    targetId: fighter.id,
  };
}

export function healFighter(
  fighter: Fighter,
  amount: number,
  log?: (type: string, text: string) => void,
  options: { kind?: HealingKind; sourceId?: string; healer?: Fighter } = {},
): number {
  return resolveHealing(fighter, amount, options, log).actual;
}

export function isActiveCombatant(fighter: Fighter): boolean {
  return !fighter.isDead && !fighter.isDeadAnnounced && fighter.currentHp > 0;
}

export function isWinningCombatant(fighter: Fighter): boolean {
  return isActiveCombatant(fighter) && !fighter.cannotWin && !fighter.isNpc;
}

export function canActNormally(fighter: Fighter): boolean {
  return isActiveCombatant(fighter) &&
    !fighter.cannotAct &&
    (!fighter.isNpc || !!fighter.isYuzuProphet);
}

export function hasStatus(fighter: Fighter, type: string): boolean {
  return hasIdentity(fighter, type);
}

export function applyPermanentStatBuff(
  fighter: Fighter,
  buff: Partial<Record<StatKey | 'crit', number>>,
): void {
  withPersistentStatusShapesSuspended(fighter, () => {
    (Object.keys(buff) as Array<StatKey | 'crit'>).forEach((key) => {
      const multiplier = buff[key];
      if (multiplier === undefined) return;
      if (key === 'crit') fighter.critRate += multiplier;
      else fighter[key] = Math.max(1, Math.floor(fighter[key] * multiplier));
    });
  });
}

export function clearZeroedStatPenalty(fighter: Fighter): void {
  removeEffects(fighter, { identityIds: ['ZEROED'], reason: 'scripted' });
}

export function cloneFighter(fighter: Fighter): Fighter {
  return {
    ...fighter,
    jobData: fighter.jobData ? cloneJobDefinition(fighter.jobData) : fighter.jobData,
    statuses: cloneStatuses(fighter.statuses),
    barriers: fighter.barriers?.map((barrier) => ({
      ...barrier,
      attribution: { ...barrier.attribution },
    })),
    stats: { ...fighter.stats },
    exodiaPieces: fighter.exodiaPieces ? [...fighter.exodiaPieces] : fighter.exodiaPieces,
    originiumGrowthRoundActorIds: fighter.originiumGrowthRoundActorIds ? [...fighter.originiumGrowthRoundActorIds] : fighter.originiumGrowthRoundActorIds,
    emoteAdaptStats: fighter.emoteAdaptStats ? { ...fighter.emoteAdaptStats } : fighter.emoteAdaptStats,
    emoteOwnerBonus: fighter.emoteOwnerBonus ? { ...fighter.emoteOwnerBonus } : fighter.emoteOwnerBonus,
    owlState: fighter.owlState ? { ...fighter.owlState } : fighter.owlState,
    owlSummonState: fighter.owlSummonState ? { ...fighter.owlSummonState } : fighter.owlSummonState,
    surtrState: fighter.surtrState ? { ...fighter.surtrState } : fighter.surtrState,
    yuzuProphetState: fighter.yuzuProphetState ? { ...fighter.yuzuProphetState } : fighter.yuzuProphetState,
    yuzuProphetControlState: fighter.yuzuProphetControlState
      ? { ...fighter.yuzuProphetControlState }
      : fighter.yuzuProphetControlState,
    momoState: fighter.momoState ? {
      ...fighter.momoState,
      assignedMemberIds: fighter.momoState.assignedMemberIds ? [...fighter.momoState.assignedMemberIds] : undefined,
      originalTeamIds: fighter.momoState.originalTeamIds ? { ...fighter.momoState.originalTeamIds } : undefined,
    } : fighter.momoState,
    momoCaptainBonuses: fighter.momoCaptainBonuses
      ? Object.fromEntries(Object.entries(fighter.momoCaptainBonuses).map(([sourceId, state]) => [sourceId, { ...state }]))
      : fighter.momoCaptainBonuses,
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
