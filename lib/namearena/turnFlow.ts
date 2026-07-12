import type { Fighter, StatusEffectsMap } from './types';
import { canActNormally, isWinningCombatant } from './combatState';
import { CONTROL_STATUS_TYPES, COUNTER_STANCE_STATUS_TYPES, isStatusType } from './statusRules';
import type { CharacterHookRuntime } from './characterHooks';
import { shouldCharacterPreventWin } from './characterHooks';

export interface TurnFlowRuntime {
  fighters: Fighter[];
  statusEffects: StatusEffectsMap;
  getTeamId: (fighter: Fighter) => string;
  isActiveCombatant: (fighter: Fighter) => boolean;
  createCharacterHookRuntime: () => CharacterHookRuntime;
  log: (type: string, text: string) => void;
  isPassiveCharmCounter: (fighter: Fighter, counterType: string) => boolean;
}

function hasWaitingCounterStatus(
  fighter: Fighter,
  runtime: Pick<TurnFlowRuntime, 'isPassiveCharmCounter'>,
): boolean {
  return fighter.status.some((status) =>
    status.type === 'WAIT_COUNTER' ||
    (isStatusType(status.type, COUNTER_STANCE_STATUS_TYPES) && !runtime.isPassiveCharmCounter(fighter, status.type)),
  );
}

export function determineActor(
  alive: Fighter[],
  runtime?: Pick<TurnFlowRuntime, 'isPassiveCharmCounter'>,
  priorityActorIds: readonly string[] = [],
): Fighter | null {
  if (alive.length === 0) return null;
  const actionable = alive.filter((fighter) =>
    canActNormally(fighter) &&
    !fighter.status.some((status) => status.type === 'SYNERGY_SLACKING'),
  );
  if (actionable.length === 0) return null;
  const priorityIds = new Set(priorityActorIds);
  const priorityCandidates = actionable.filter((fighter) => priorityIds.has(fighter.id));
  const candidates = runtime
    ? actionable.filter((fighter) => !hasWaitingCounterStatus(fighter, runtime))
    : actionable;
  const actorPool = priorityCandidates.length > 0
    ? priorityCandidates
    : candidates.length > 0
      ? candidates
      : actionable;
  const actionWeight = (fighter: Fighter) => {
    let multiplier = 1;
    if (fighter.status.some((status) => status.type === 'RABBIT_CALC_HASTE')) multiplier *= 1.13;
    if (fighter.status.some((status) => status.type === 'RABBIT_ZERO_HASTE')) multiplier *= 1.26;
    if (fighter.status.some((status) => status.type === 'YUZU_SLOW')) multiplier *= 0.75;
    return Math.max(1, Math.floor(fighter.spd * multiplier));
  };
  let ticket = Math.random() * actorPool.reduce((sum, fighter) => sum + actionWeight(fighter), 0);
  for (const fighter of actorPool) {
    ticket -= actionWeight(fighter);
    if (ticket <= 0) return fighter;
  }
  return actorPool[0];
}

export function checkWinCondition(runtime: TurnFlowRuntime, alive: Fighter[]): boolean {
  const aliveCombatants = alive.filter((fighter) => runtime.isActiveCombatant(fighter));
  const winningCombatants = aliveCombatants.filter(isWinningCombatant);
  const activeTeams = new Set(winningCombatants.map((fighter) => runtime.getTeamId(fighter)));
  let preventEnd = false;

  const hookRuntime = runtime.createCharacterHookRuntime();
  for (const fighter of runtime.fighters) {
    if (shouldCharacterPreventWin({ fighter, runtime: hookRuntime, aliveCombatants: winningCombatants, activeTeams })) preventEnd = true;
  }

  if (activeTeams.size <= 1 && !preventEnd) {
    const winners = winningCombatants.map((fighter) => {
      if (!fighter.isSummon || !fighter.summonerId) return fighter.name;
      const summoner = runtime.fighters.find((candidate) => candidate.id === fighter.summonerId);
      return summoner ? `${fighter.name}（${summoner.name}召唤）` : fighter.name;
    }).join(' & ');
    const winTeam = winningCombatants.length > 0 ? (winningCombatants[0].teamId ? `【${winningCombatants[0].teamId}】` : '') : '';
    const winnerLabel = [winTeam, winners || '无（同归于尽）'].filter(Boolean).join(' ');
    runtime.log('win', `🏆 最终胜者：${winnerLabel}！`);
    return true;
  }
  return false;
}

export function logUnableToAct(runtime: TurnFlowRuntime, actor: Fighter, priorBlockingStatusType?: string): void {
  if (actor.status.some((status) => status.type === 'SYNERGY_SLACKING')) {
    runtime.log('info', `⛺ ${actor.name} 正在场外OB摸鱼，暂时不参与战斗！`);
    return;
  }

  const blockingStatus = actor.status.find((status) =>
    isStatusType(status.type, CONTROL_STATUS_TYPES),
  );
  const blockingStatusType = blockingStatus?.type ?? priorBlockingStatusType;
  if (blockingStatusType) {
    runtime.log('info', `💫 ${actor.name} 处于【${runtime.statusEffects[blockingStatusType]?.name ?? blockingStatusType}】状态，无法行动！`);
  }
}

export function getWaitingCounterStatus(runtime: TurnFlowRuntime, actor: Fighter): string | null {
  const waitingCounter = actor.status.find((status) =>
    status.type === 'WAIT_COUNTER' ||
    (isStatusType(status.type, COUNTER_STANCE_STATUS_TYPES) && !runtime.isPassiveCharmCounter(actor, status.type)),
  );
  return waitingCounter?.type ?? null;
}

export function logWaitingCounter(runtime: TurnFlowRuntime, actor: Fighter, statusType: string): void {
  runtime.log('info', `🛡️ ${actor.name} 保持【${runtime.statusEffects[statusType]?.name ?? statusType}】姿态，等待对手出手！`);
}
