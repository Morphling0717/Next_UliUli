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
  eventActive: boolean;
  phaseTwo: boolean;
  puruisaishiShield: number;
  activeCrystalCount: number;
  coreActive: boolean;
};

// These rolls supplement normal target weights; they are not the total event-target chance.
const ORIGINIUM_RESPONSE_CHANCE_PHASE_ONE = 0.01;
const ORIGINIUM_RESPONSE_CHANCE_PHASE_TWO = 0.02;

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
  const activePuruisaishi = runtime.fighters.find((fighter) =>
    fighter.isPuruisaishi && runtime.isActiveCombatant(fighter),
  );
  return {
    eventActive: !!activePuruisaishi,
    phaseTwo: (activePuruisaishi?.puruisaishiPhase ?? 1) >= 2,
    puruisaishiShield: Math.max(0, activePuruisaishi?.puruisaishiShield ?? 0),
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
    if (!originium.phaseTwo) return 0.32;
    if (originium.activeCrystalCount > 10) return 3.05;
    if (originium.activeCrystalCount >= 8) return 1.85;
    if (originium.activeCrystalCount >= 4) return 1.1;
    return 0.72;
  }
  if (target.isOriginiumCore) {
    if (!originium.phaseTwo) return 0.36;
    if (originium.activeCrystalCount === 0) return 2.32;
    return originium.activeCrystalCount >= 8 ? 1.32 : 0.85;
  }
  if (target.isPuruisaishi) {
    if (!originium.phaseTwo) return 0.5;
    if (originium.activeCrystalCount > 0) return originium.puruisaishiShield > 1 ? 1.35 : 0.05;
    return originium.coreActive ? 2.55 : 4.35;
  }
  const waitingOnTokusatsuThrone = target.isTokusatsu &&
    target.job === 'MIRACLE_BUJIN' &&
    target.status.some((status) => status.type === 'WAIT_COUNTER');
  return waitingOnTokusatsuThrone ? 3 : 1;
}

export function getTargetSelectionWeight(runtime: TargetingRuntime, target: Fighter): number {
  return targetWeight(target, getOriginiumTargetingState(runtime));
}

function pickWeightedTarget(
  runtime: TargetingRuntime,
  targets: Fighter[],
  originium = getOriginiumTargetingState(runtime),
): Fighter {
  const totalWeight = targets.reduce((sum, target) => sum + targetWeight(target, originium), 0);
  if (totalWeight <= 0) return targets[Math.floor(Math.random() * targets.length)]!;

  let roll = Math.random() * totalWeight;
  for (const target of targets) {
    roll -= targetWeight(target, originium);
    if (roll <= 0) return target;
  }
  return targets[targets.length - 1]!;
}

function pickOriginiumResponseTarget(
  runtime: TargetingRuntime,
  targets: Fighter[],
  originium: OriginiumTargetingState,
): Fighter | undefined {
  if (!originium.eventActive) return undefined;

  let eventTargets: Fighter[];
  if (!originium.phaseTwo) {
    eventTargets = targets.filter((target) => target.isOriginiumCrystal || target.isOriginiumCore);
  } else if (originium.activeCrystalCount > 0) {
    eventTargets = targets.filter((target) =>
      target.isOriginiumCrystal ||
      target.isOriginiumCore ||
      (target.isPuruisaishi && originium.puruisaishiShield > 1),
    );
  } else {
    eventTargets = targets.filter((target) => target.isPuruisaishi || target.isOriginiumCore);
  }
  if (eventTargets.length === 0) return undefined;

  const responseChance = originium.phaseTwo
    ? ORIGINIUM_RESPONSE_CHANCE_PHASE_TWO
    : ORIGINIUM_RESPONSE_CHANCE_PHASE_ONE;
  if (Math.random() >= responseChance) return undefined;
  return pickWeightedTarget(runtime, eventTargets, originium);
}

function lowestHealthTarget(targets: Fighter[], hpPctThreshold: number, flatHpFloor: number): Fighter | undefined {
  return targets
    .filter((target) =>
      isCompetitiveTarget(target) &&
      (target.hpPct <= hpPctThreshold || target.currentHp <= Math.max(flatHpFloor, target.maxHp * 0.35)),
    )
    .sort((a, b) => a.currentHp - b.currentHp)[0];
}

function preferredTacticalTarget(user: Fighter, targets: Fighter[]): Fighter | undefined {
  if (user.job === 'ALL_PLATFORM_CHAMPION') {
    const marked = user.gamerMarkedTargetId
      ? targets.find((target) => target.id === user.gamerMarkedTargetId)
      : undefined;
    return marked ?? lowestHealthTarget(targets, 0.42, 900);
  }

  if (user.job === 'VALO_JUNIOR') {
    const wounded = lowestHealthTarget(targets, 0.42, 900);
    if (wounded) return wounded;
    if ((user.crosshairFocus ?? 0) >= 3) {
      return targets.find((target) =>
        isCompetitiveTarget(target) && target.agl >= Math.max(160, user.agl * 0.75),
      );
    }
  }

  return undefined;
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
  const tacticalTarget = preferredTacticalTarget(user, availableTargets);
  let target: Fighter;
  if (forcedTargetValid) target = forcedTarget!;
  else if (tauntingTargets.length > 0) target = pickWeightedTarget(runtime, tauntingTargets);
  else {
    const originium = getOriginiumTargetingState(runtime);
    const originiumResponseTarget = pickOriginiumResponseTarget(runtime, availableTargets, originium);
    if (originiumResponseTarget) target = originiumResponseTarget;
    else if (markedWarThunderTarget) target = markedWarThunderTarget;
    else if (tacticalTarget) target = tacticalTarget;
    else target = pickWeightedTarget(runtime, availableTargets, originium);
  }
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
