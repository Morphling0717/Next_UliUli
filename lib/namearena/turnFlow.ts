import type { Fighter } from './types';
import { canActNormally, isWinningCombatant } from './combatState';
import type { CharacterHookRuntime } from './characterHooks';
import { shouldCharacterPreventWin } from './characterHooks';
import { getActionSpeedMultiplier, getEffectiveCombatStat } from './statusMechanics';
import { buildStatusPresentationMember } from './statusPresentation';
import { getStatusIdentityDefinition, getStatusIdentityIdsByTag } from './statusRegistry';
import { formatTeamDisplayLabel } from './teamPresentation';
import { findIdentity, hasIdentity, hasMechanic, queryMechanic } from './statusSystem';
import { getSurtrWinnerOwnerNames, isSurtrJointLegacy } from './surtrMechanics';

export interface TurnFlowRuntime {
  fighters: Fighter[];
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
  if (hasMechanic(fighter, 'STAGGERED')) return false;
  if (hasIdentity(fighter, 'WAIT_COUNTER')) return true;
  return getStatusesByIdentityTag(fighter, 'counter_stance')
    .some((status) => !runtime.isPassiveCharmCounter(fighter, status.mechanicId));
}

function getStatusesByIdentityTag(
  fighter: Fighter,
  tag: Parameters<typeof getStatusIdentityIdsByTag>[0],
) {
  return getStatusIdentityIdsByTag(tag)
    .flatMap((identityId) => {
      const identity = getStatusIdentityDefinition(identityId);
      return queryMechanic(fighter, identity.mechanicId, { identityIds: [identityId] }).entries;
    })
    .sort((a, b) => a.appliedSequence - b.appliedSequence);
}

export function determineActor(
  alive: Fighter[],
  runtime?: Pick<TurnFlowRuntime, 'isPassiveCharmCounter'>,
  priorityActorIds: readonly string[] = [],
): Fighter | null {
  if (alive.length === 0) return null;
  const actionable = alive.filter((fighter) =>
    canActNormally(fighter) &&
    !hasIdentity(fighter, 'SYNERGY_SLACKING'),
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
    const multiplier = getActionSpeedMultiplier(fighter);
    return Math.max(1, Math.floor(getEffectiveCombatStat(fighter, 'spd') * multiplier));
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
    const winnerNames = winningCombatants.flatMap((fighter) => {
      if (fighter.isSurtr) return getSurtrWinnerOwnerNames(runtime, fighter);
      if (!fighter.isSummon || !fighter.summonerId) return fighter.name;
      return runtime.fighters.find((candidate) => candidate.id === fighter.summonerId)?.name ?? fighter.name;
    });
    const winners = [...new Set(winnerNames)].join(' & ');
    const firstWinner = winningCombatants[0];
    const visibleTeam = firstWinner && !isSurtrJointLegacy(runtime, firstWinner)
      ? formatTeamDisplayLabel(runtime.getTeamId(firstWinner))
      : undefined;
    const winTeam = visibleTeam ? `【${visibleTeam}】` : '';
    const winnerLabel = [winTeam, winners || '无（同归于尽）'].filter(Boolean).join(' ');
    runtime.log('win', `🏆 最终胜者：${winnerLabel}！`);
    return true;
  }
  return false;
}

export function logUnableToAct(runtime: TurnFlowRuntime, actor: Fighter, priorBlockingStatusType?: string): void {
  if (hasIdentity(actor, 'SYNERGY_SLACKING')) {
    runtime.log('info', `⛺ ${actor.name} 正在场外OB摸鱼，暂时不参与战斗！`);
    return;
  }

  if (priorBlockingStatusType === 'AIRBORNE') {
    runtime.log('info', `💫 ${actor.name} 处于【${getStatusIdentityDefinition('AIRBORNE').displayName}】状态，无法行动！`);
    return;
  }

  const owlBlockingStatus = ['OWL_FORM_DEFEAT', 'OWL_ENJOYING', 'OWL_SPALTER_DOLL']
    .map((identityId) => findIdentity(actor, identityId))
    .find((status) => !!status);
  if (owlBlockingStatus) {
    runtime.log('info', `🦉 ${actor.name} 处于【${buildStatusPresentationMember(owlBlockingStatus).name}】状态，无法行动！`);
    return;
  }

  const blockingStatus = getStatusesByIdentityTag(actor, 'action_blocking')[0];
  const blockingStatusType = priorBlockingStatusType ?? blockingStatus?.identityId;
  if (blockingStatusType) {
    const displayName = blockingStatus && blockingStatus.identityId === blockingStatusType
      ? buildStatusPresentationMember(blockingStatus).name
      : getStatusIdentityDefinition(blockingStatusType).displayName;
    runtime.log('info', `💫 ${actor.name} 处于【${displayName}】状态，无法行动！`);
  }
}

export function getWaitingCounterStatus(runtime: TurnFlowRuntime, actor: Fighter): string | null {
  if (hasMechanic(actor, 'STAGGERED')) return null;
  const waitingCounter = [findIdentity(actor, 'WAIT_COUNTER'), ...getStatusesByIdentityTag(actor, 'counter_stance')]
    .filter((status) => status !== undefined)
    .filter((status) => status.identityId === 'WAIT_COUNTER' || !runtime.isPassiveCharmCounter(actor, status.mechanicId))
    .sort((a, b) => a.appliedSequence - b.appliedSequence)[0];
  return waitingCounter?.identityId ?? null;
}

export function logWaitingCounter(runtime: TurnFlowRuntime, actor: Fighter, statusType: string): void {
  const status = findIdentity(actor, statusType);
  const displayName = status
    ? buildStatusPresentationMember(status).name
    : getStatusIdentityDefinition(statusType).displayName;
  runtime.log('info', `🛡️ ${actor.name} 保持【${displayName}】姿态，等待对手出手！`);
}
