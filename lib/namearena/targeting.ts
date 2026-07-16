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
  protectedTarget?: Fighter;
}

type OriginiumTargetingState = {
  phaseTwo: boolean;
  activeCrystalCount: number;
  coreActive: boolean;
};

export function isCompetitiveTarget(target: Fighter): boolean {
  return !target.isNpc && !target.cannotWin;
}

export function isSelectableTargetFor(
  runtime: TargetingRuntime,
  user: Fighter,
  target: Fighter,
): boolean {
  if (target.isPuruisaishi && (target.puruisaishiPhase ?? 1) <= 1) return false;
  if ((target.untargetableUntilTurn ?? -1) >= runtime.turnCount) return false;
  const confusedFriendlyTarget = user.confusedForcedTargetId === target.id;
  return runtime.isActiveCombatant(target) &&
    target.id !== user.id &&
    (confusedFriendlyTarget || runtime.getTeamId(target) !== runtime.getTeamId(user)) &&
    !target.status.some((status) => status.type === 'SYNERGY_SLACKING');
}

export function getSelectableTargets(runtime: TargetingRuntime, user: Fighter): Fighter[] {
  return runtime.fighters.filter((fighter) => isSelectableTargetFor(runtime, user, fighter));
}

export function getConfusionTargets(runtime: TargetingRuntime, user: Fighter): Fighter[] {
  const candidates = runtime.fighters.filter((target) =>
    target.id !== user.id &&
    runtime.isActiveCombatant(target) &&
    !(target.isPuruisaishi && (target.puruisaishiPhase ?? 1) <= 1) &&
    target.owlSummonState?.kind !== 'meal' &&
    target.owlSummonState?.kind !== 'rice' &&
    (target.untargetableUntilTurn ?? -1) < runtime.turnCount &&
    !target.status.some((status) => status.type === 'SYNERGY_SLACKING'),
  );
  const charmSourceId = user.status.find((status) => status.type === 'CHARMED')?.applierId;
  if (!charmSourceId) return candidates;
  const alternatives = candidates.filter((target) => target.id !== charmSourceId);
  return alternatives.length > 0 ? alternatives : candidates;
}

export function findActivePuppetProtector(
  runtime: TargetingRuntime,
  protectedTarget: Fighter,
  attacker?: Fighter,
): Fighter | undefined {
  return runtime.fighters.find((fighter) =>
    fighter.isSummon &&
    fighter.summonerId === protectedTarget.id &&
    (fighter.summonBaseName ?? fighter.name) === '小汀(傀儡)' &&
    runtime.isActiveCombatant(fighter) &&
    fighter.id !== attacker?.id,
  );
}

function getOriginiumTargetingState(runtime: TargetingRuntime): OriginiumTargetingState {
  return {
    phaseTwo: runtime.fighters.some((fighter) =>
      fighter.isPuruisaishi &&
      (fighter.puruisaishiPhase ?? 1) >= 2 &&
      runtime.isActiveCombatant(fighter),
    ),
    activeCrystalCount: runtime.fighters.filter((fighter) =>
      fighter.isOriginiumCrystal && runtime.isActiveCombatant(fighter),
    ).length,
    coreActive: runtime.fighters.some((fighter) =>
      fighter.isOriginiumCore && runtime.isActiveCombatant(fighter),
    ),
  };
}

function targetWeight(target: Fighter, originium: OriginiumTargetingState): number {
  if (target.isOriginiumCrystal) {
    if (!originium.phaseTwo) return 0.18;
    if (originium.activeCrystalCount > 10) return 2.8;
    if (originium.activeCrystalCount >= 8) return 1.6;
    if (originium.activeCrystalCount >= 4) return 0.95;
    return 0.6;
  }
  if (target.isOriginiumCore) {
    if (!originium.phaseTwo) return 0.28;
    if (originium.activeCrystalCount === 0) return 2.2;
    return originium.activeCrystalCount >= 8 ? 1.2 : 0.75;
  }
  if (target.isPuruisaishi) {
    if (!originium.phaseTwo) return 0.5;
    if (originium.activeCrystalCount > 0) return 0.35;
    return originium.coreActive ? 2.4 : 4;
  }
  const waitingOnTokusatsuThrone = target.isTokusatsu &&
    target.job === 'MIRACLE_BUJIN' &&
    target.status.some((status) => status.type === 'WAIT_COUNTER');
  return waitingOnTokusatsuThrone ? 3 : 1;
}

export function getTargetSelectionWeight(runtime: TargetingRuntime, target: Fighter): number {
  return targetWeight(target, getOriginiumTargetingState(runtime));
}

function pickWeightedTarget(runtime: TargetingRuntime, targets: Fighter[]): Fighter {
  const originium = getOriginiumTargetingState(runtime);
  const totalWeight = targets.reduce((sum, target) => sum + targetWeight(target, originium), 0);
  if (totalWeight <= 0) return targets[Math.floor(Math.random() * targets.length)]!;

  let roll = Math.random() * totalWeight;
  for (const target of targets) {
    roll -= targetWeight(target, originium);
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

  const charmSourceId = user.status.find((status) => status.type === 'CHARMED')?.applierId;
  const charmAlternatives = charmSourceId
    ? currentTargets.filter((candidate) => candidate.id !== charmSourceId)
    : currentTargets;
  const availableTargets = charmSourceId && charmAlternatives.length > 0
    ? charmAlternatives
    : currentTargets;
  const forcedTargetValid = forcedTarget
    ? availableTargets.some((candidate) => candidate.id === forcedTarget.id) && isSelectableTargetFor(runtime, user, forcedTarget)
    : false;
  const tauntingTargets = availableTargets.filter((candidate) =>
    candidate.isYuzu && candidate.status.some((status) => status.type === 'YUZU_TAUNT'),
  );
  const markedWarThunderTarget = user.isWT && user.wtMarkedTargetId
    ? availableTargets.find((candidate) => candidate.id === user.wtMarkedTargetId)
    : undefined;
  let target: Fighter;
  if (forcedTargetValid) target = forcedTarget!;
  else if (tauntingTargets.length > 0) target = pickWeightedTarget(runtime, tauntingTargets);
  else if (markedWarThunderTarget) target = markedWarThunderTarget;
  else target = pickWeightedTarget(runtime, availableTargets);
  let isIntercepted = false;
  let protectedTarget: Fighter | undefined;
  const protector = findActivePuppetProtector(runtime, target, user);
  if (protector) {
    protectedTarget = target;
    target = protector;
    isIntercepted = true;
  }

  if (!target || !runtime.isActiveCombatant(target) || target.id === user.id) return null;
  return { target, isIntercepted, protectedTarget };
}
