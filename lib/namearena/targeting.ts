import type { Fighter } from './types';

export interface TargetingRuntime {
  fighters: Fighter[];
  turnCount: number;
  getTeamId: (fighter: Fighter) => string;
  isActiveCombatant: (fighter: Fighter) => boolean;
}

export interface TargetSelectionResult {
  target: Fighter;
  isIntercepted: boolean;
}

export function isSelectableTargetFor(
  runtime: TargetingRuntime,
  user: Fighter,
  target: Fighter,
): boolean {
  if (target.isPuruisaishi && (target.puruisaishiPhase ?? 1) <= 1) return false;
  if ((target.untargetableUntilTurn ?? -1) >= runtime.turnCount) return false;
  return runtime.isActiveCombatant(target) &&
    target.id !== user.id &&
    runtime.getTeamId(target) !== runtime.getTeamId(user) &&
    !target.status.some((status) => status.type === 'SYNERGY_SLACKING');
}

export function getSelectableTargets(runtime: TargetingRuntime, user: Fighter): Fighter[] {
  return runtime.fighters.filter((fighter) => isSelectableTargetFor(runtime, user, fighter));
}

function getTargetWeight(target: Fighter): number {
  if (target.isOriginiumCrystal) return 0.18;
  if (target.isOriginiumCore) return 0.28;
  if (target.isPuruisaishi) return 0.35;
  const waitingOnTokusatsuThrone = target.isTokusatsu &&
    target.job === 'MIRACLE_BUJIN' &&
    target.status.some((status) => status.type === 'WAIT_COUNTER');
  return waitingOnTokusatsuThrone ? 3 : 1;
}

function pickWeightedTarget(targets: Fighter[]): Fighter {
  const totalWeight = targets.reduce((sum, target) => sum + getTargetWeight(target), 0);
  if (totalWeight <= 0) return targets[Math.floor(Math.random() * targets.length)]!;

  let roll = Math.random() * totalWeight;
  for (const target of targets) {
    roll -= getTargetWeight(target);
    if (roll <= 0) return target;
  }
  return targets[targets.length - 1]!;
}

export function resolveTarget(
  runtime: TargetingRuntime,
  user: Fighter,
  forcedTarget: Fighter | null,
  currentTargets: Fighter[],
): TargetSelectionResult | null {
  if (currentTargets.length === 0) return null;

  const forcedTargetValid = forcedTarget ? isSelectableTargetFor(runtime, user, forcedTarget) : false;
  const tauntingTargets = currentTargets.filter((candidate) =>
    candidate.isYuzu && candidate.status.some((status) => status.type === 'YUZU_TAUNT'),
  );
  let target = forcedTargetValid
    ? forcedTarget!
    : tauntingTargets.length > 0
      ? pickWeightedTarget(tauntingTargets)
      : pickWeightedTarget(currentTargets);
  let isIntercepted = false;
  const protector = runtime.fighters.find((fighter) =>
    fighter.isSummon &&
    fighter.summonerId === target.id &&
    (fighter.summonBaseName ?? fighter.name) === '小汀(傀儡)' &&
    runtime.isActiveCombatant(fighter),
  );
  if (protector && protector.id !== user.id) {
    target = protector;
    isIntercepted = true;
  }

  if (!target || !runtime.isActiveCombatant(target) || target.id === user.id) return null;
  return { target, isIntercepted };
}
