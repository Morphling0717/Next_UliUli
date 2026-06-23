import type { Fighter, StatusEffectsMap } from './types';
import { CONTROL_STATUS_TYPES, isStatusType } from './statusRules';
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

export function determineActor(alive: Fighter[]): Fighter | null {
  if (alive.length === 0) return null;
  const actionWeight = (fighter: Fighter) => Math.max(1, fighter.spd);
  let ticket = Math.random() * alive.reduce((sum, fighter) => sum + actionWeight(fighter), 0);
  for (const fighter of alive) {
    ticket -= actionWeight(fighter);
    if (ticket <= 0) return fighter;
  }
  return alive[0];
}

export function checkWinCondition(runtime: TurnFlowRuntime, alive: Fighter[]): boolean {
  const aliveCombatants = alive.filter((fighter) => runtime.isActiveCombatant(fighter));
  const activeTeams = new Set(aliveCombatants.map((fighter) => runtime.getTeamId(fighter)));
  let preventEnd = false;

  const hookRuntime = runtime.createCharacterHookRuntime();
  for (const fighter of runtime.fighters) {
    if (shouldCharacterPreventWin({ fighter, runtime: hookRuntime, aliveCombatants, activeTeams })) preventEnd = true;
  }

  if (activeTeams.size <= 1 && !preventEnd) {
    const winners = aliveCombatants.map((fighter) => fighter.name).join(' & ');
    const winTeam = aliveCombatants.length > 0 ? (aliveCombatants[0].teamId ? `【${aliveCombatants[0].teamId}】` : '') : '';
    runtime.log('win', `🏆 最终胜者：${winTeam} ${winners || '无（同归于尽）'}！`);
    return true;
  }
  return false;
}

export function logUnableToAct(runtime: TurnFlowRuntime, actor: Fighter): void {
  if (actor.status.some((status) => status.type === 'SYNERGY_SLACKING')) {
    runtime.log('info', `⛺ ${actor.name} 正在场外OB摸鱼，暂时不参与战斗！`);
    return;
  }

  const blockingStatus = actor.status.find((status) =>
    isStatusType(status.type, CONTROL_STATUS_TYPES),
  );
  if (blockingStatus) {
    runtime.log('info', `💫 ${actor.name} 处于【${runtime.statusEffects[blockingStatus.type]?.name ?? blockingStatus.type}】状态，无法行动！`);
  }
}

export function getWaitingCounterStatus(runtime: TurnFlowRuntime, actor: Fighter): string | null {
  const waitingCounter = actor.status.find((status) =>
    status.type === 'WAIT_COUNTER' ||
    (status.type.startsWith('CTR_') && !runtime.isPassiveCharmCounter(actor, status.type)),
  );
  return waitingCounter?.type ?? null;
}

export function logWaitingCounter(runtime: TurnFlowRuntime, actor: Fighter, statusType: string): void {
  runtime.log('info', `🛡️ ${actor.name} 保持【${runtime.statusEffects[statusType]?.name ?? statusType}】姿态，等待对手出手！`);
}
