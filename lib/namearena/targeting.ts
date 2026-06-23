import type { Fighter } from './types';

export interface TargetingRuntime {
  fighters: Fighter[];
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
  return runtime.isActiveCombatant(target) &&
    target.id !== user.id &&
    runtime.getTeamId(target) !== runtime.getTeamId(user) &&
    !target.status.some((status) => status.type === 'SYNERGY_SLACKING');
}

export function getSelectableTargets(runtime: TargetingRuntime, user: Fighter): Fighter[] {
  return runtime.fighters.filter((fighter) => isSelectableTargetFor(runtime, user, fighter));
}

export function resolveTarget(
  runtime: TargetingRuntime,
  user: Fighter,
  forcedTarget: Fighter | null,
  currentTargets: Fighter[],
): TargetSelectionResult | null {
  if (currentTargets.length === 0) return null;

  const forcedTargetValid = forcedTarget ? isSelectableTargetFor(runtime, user, forcedTarget) : false;
  let target = forcedTargetValid ? forcedTarget! : currentTargets[Math.floor(Math.random() * currentTargets.length)];
  let isIntercepted = false;
  const protector = runtime.fighters.find((fighter) =>
    fighter.isSummon &&
    fighter.summonerId === target.id &&
    fighter.name === '小汀(傀儡)' &&
    runtime.isActiveCombatant(fighter),
  );
  if (protector && protector.id !== user.id) {
    target = protector;
    isIntercepted = true;
  }

  if (!target || !runtime.isActiveCombatant(target) || target.id === user.id) return null;
  return { target, isIntercepted };
}
