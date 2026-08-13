import type { BattleState, DefeatOptions, Fighter, MajorNpcEventKind } from './types';
import type { PuruisaishiRuntime } from './puruisaishiMechanics';
import {
  executeHerobrineCloneTurn,
  executeHerobrineTurn,
  handleHerobrineContestantDefeat,
  handleHerobrineNpcDefeat,
  HEROBRINE_MAJOR_EVENT_CHANCE,
  HEROBRINE_MIN_CONTESTANTS,
  HEROBRINE_SPAWN_END_TURN,
  HEROBRINE_SPAWN_START_TURN,
  processHerobrineGlobalActionEnd,
  processHerobrineLargeRoundEnd,
  processHerobrineActionEnd,
  type HerobrineRuntime,
  spawnHerobrineEvent,
} from './herobrineMechanics';
import {
  notePuruisaishiRoundActor,
  processPuruisaishiLargeRoundEnd,
  processPuruisaishiRoundEnd,
  spawnPuruisaishiEvent,
} from './puruisaishiMechanics';
import {
  isHerobrine,
  isHerobrineClone,
  isHerobrineEventUnit,
} from './npcCombat';

export interface MajorNpcEventRuntime {
  herobrine: HerobrineRuntime;
  puruisaishi: PuruisaishiRuntime;
}

export interface MajorNpcEventSpawnRuntime {
  herobrine: Parameters<typeof spawnHerobrineEvent>[0];
  puruisaishi: Parameters<typeof spawnPuruisaishiEvent>[0];
}

function activeContestantCount(runtime: HerobrineRuntime): number {
  return runtime.fighters.filter((fighter) =>
    runtime.isActiveCombatant(fighter) &&
    !fighter.isNpc &&
    !fighter.isSummon &&
    !fighter.cannotWin,
  ).length;
}

export function canStartMajorNpcEvent(runtime: HerobrineRuntime): boolean {
  if (runtime.battleState.majorNpcEvent) return false;
  if (runtime.turnCount < HEROBRINE_SPAWN_START_TURN || runtime.turnCount > HEROBRINE_SPAWN_END_TURN) return false;
  return activeContestantCount(runtime) >= HEROBRINE_MIN_CONTESTANTS;
}

export function forceMajorNpcEvent(
  runtime: MajorNpcEventSpawnRuntime,
  kind: MajorNpcEventKind,
  reason: string,
): boolean {
  if (runtime.herobrine.battleState.majorNpcEvent) return false;
  if (kind === 'puruisaishi') {
    spawnPuruisaishiEvent(runtime.puruisaishi, reason);
    return true;
  }
  return !!spawnHerobrineEvent(runtime.herobrine, reason);
}

function chooseMajorNpcEventKind(runtime: HerobrineRuntime): MajorNpcEventKind {
  let value = (
    runtime.battleState.seed ^
    Math.imul(runtime.turnCount + 1, 0x9e3779b9)
  ) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000 >= 0.5 ? 'puruisaishi' : 'herobrine';
}

export function trySpawnMajorNpcEvent(runtime: MajorNpcEventRuntime): MajorNpcEventKind | undefined {
  if (!canStartMajorNpcEvent(runtime.herobrine)) return undefined;
  if (Math.random() >= HEROBRINE_MAJOR_EVENT_CHANCE) return undefined;
  // Event identity uses its own deterministic draw so adding a second event
  // does not shift every later combat roll in an existing seeded battle.
  const kind = chooseMajorNpcEventKind(runtime.herobrine);
  return forceMajorNpcEvent(runtime, kind, kind === 'puruisaishi'
    ? '重大 NPC 事件触发，源石映像干涉战场'
    : '重大 NPC 事件触发，白色眼睛出现在雾里')
    ? kind
    : undefined;
}

export function noteMajorNpcRoundActor(runtime: MajorNpcEventRuntime, actor: Fighter): void {
  if (runtime.herobrine.battleState.majorNpcEvent?.kind === 'puruisaishi') {
    notePuruisaishiRoundActor(runtime.puruisaishi, actor);
  }
}

export function processMajorNpcActionEnd(
  runtime: MajorNpcEventRuntime,
  actor: Fighter,
  primaryTargetId?: string,
): void {
  if (runtime.herobrine.battleState.majorNpcEvent?.kind === 'herobrine') {
    processHerobrineActionEnd(runtime.herobrine, actor, primaryTargetId);
  }
}

export function executeMajorNpcTurn(
  runtime: MajorNpcEventRuntime,
  actor: Fighter,
  forcedBasicTarget?: Fighter,
): boolean | undefined {
  if (runtime.herobrine.battleState.majorNpcEvent?.kind !== 'herobrine') return undefined;
  if (isHerobrine(actor)) {
    return executeHerobrineTurn(runtime.herobrine, actor, forcedBasicTarget);
  }
  if (isHerobrineClone(actor)) {
    return executeHerobrineCloneTurn(runtime.herobrine, actor, forcedBasicTarget);
  }
  return undefined;
}

export function processMajorNpcGlobalActionEnd(
  runtime: MajorNpcEventRuntime,
  timing: 'before_round_sync' | 'after_round_sync',
): void {
  const kind = runtime.herobrine.battleState.majorNpcEvent?.kind;
  if (kind === 'herobrine' && timing === 'before_round_sync') {
    processHerobrineGlobalActionEnd(runtime.herobrine);
  } else if (kind === 'puruisaishi' && timing === 'after_round_sync') {
    processPuruisaishiRoundEnd(runtime.puruisaishi);
  }
}

export function processMajorNpcLargeRoundEnd(
  runtime: MajorNpcEventRuntime,
  completedRound: number,
  timing: 'before_global_effects' | 'after_event_effects',
): void {
  const kind = runtime.herobrine.battleState.majorNpcEvent?.kind;
  if (kind === 'herobrine' && timing === 'before_global_effects') {
    processHerobrineLargeRoundEnd(runtime.herobrine, completedRound);
  } else if (kind === 'puruisaishi' && timing === 'after_event_effects') {
    processPuruisaishiLargeRoundEnd(runtime.puruisaishi);
  }
}

export function handleMajorNpcUnitDefeat(
  runtime: MajorNpcEventRuntime,
  target: Fighter,
  options: DefeatOptions,
): boolean | undefined {
  if (
    runtime.herobrine.battleState.majorNpcEvent?.kind === 'herobrine' &&
    isHerobrineEventUnit(target)
  ) {
    return handleHerobrineNpcDefeat(runtime.herobrine, target, options);
  }
  return undefined;
}

export function handleMajorNpcContestantDefeat(
  runtime: MajorNpcEventRuntime,
  defeated: Fighter,
): void {
  if (runtime.herobrine.battleState.majorNpcEvent?.kind === 'herobrine') {
    handleHerobrineContestantDefeat(runtime.herobrine, defeated);
  }
}

export function shouldSuppressMajorNpcRevival(
  state: BattleState,
  fighter: Fighter,
): boolean {
  const event = state.majorNpcEvent;
  if (event?.kind !== 'herobrine' || fighter.isNpc || fighter.isSummon) {
    return false;
  }
  return (
    (event.finalPursuit && !event.completed) ||
    event.finalPursuitDefeatedContestantId === fighter.id
  );
}
