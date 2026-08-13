import type {
  BattleState,
  DamageSourceKind,
  Fighter,
  NpcCombatCapabilities,
  NpcEventKind,
  NpcUnitKind,
} from './types';

const PLAYER_CAPABILITIES: NpcCombatCapabilities = {
  actionMode: 'normal',
  visible: true,
  targetable: true,
  aoeVulnerable: true,
  blocksSettlement: false,
  grantsKillCredit: true,
  countsForVictory: true,
};

const PASSIVE_NPC_CAPABILITIES: NpcCombatCapabilities = {
  actionMode: 'none',
  visible: true,
  targetable: true,
  aoeVulnerable: true,
  blocksSettlement: false,
  grantsKillCredit: false,
  countsForVictory: false,
};

export function getNpcCombatCapabilities(fighter: Fighter): NpcCombatCapabilities {
  if (!fighter.isNpc) return PLAYER_CAPABILITIES;
  if (fighter.npcUnitState) return fighter.npcUnitState.capabilities;

  return {
    ...PASSIVE_NPC_CAPABILITIES,
    actionMode: fighter.cannotAct ? 'none' : 'normal',
  };
}

export function configureNpcUnit(
  fighter: Fighter,
  eventKind: NpcEventKind,
  unitKind: NpcUnitKind,
  capabilities: Partial<NpcCombatCapabilities> = {},
): Fighter {
  const resolved: NpcCombatCapabilities = {
    ...PASSIVE_NPC_CAPABILITIES,
    ...capabilities,
    countsForVictory: false,
    grantsKillCredit: capabilities.grantsKillCredit ?? false,
  };
  fighter.isNpc = true;
  fighter.cannotWin = true;
  fighter.cannotAct = resolved.actionMode === 'none';
  delete fighter.morale;
  delete fighter.maxMorale;
  delete fighter.moraleLostSinceOpportunity;
  delete fighter.stagger;
  delete fighter.staggerThreshold;
  fighter.npcUnitState = {
    eventKind,
    unitKind,
    capabilities: resolved,
  };
  return fighter;
}

export function setNpcCombatCapabilities(
  fighter: Fighter,
  capabilities: Partial<NpcCombatCapabilities>,
): void {
  if (!fighter.npcUnitState) return;
  fighter.npcUnitState.capabilities = {
    ...fighter.npcUnitState.capabilities,
    ...capabilities,
    countsForVictory: false,
  };
  fighter.cannotAct = fighter.npcUnitState.capabilities.actionMode === 'none';
}

export function canEnterNormalActionQueue(fighter: Fighter): boolean {
  return getNpcCombatCapabilities(fighter).actionMode === 'normal';
}

export function shouldRenderNpcUnit(fighter: Fighter): boolean {
  return getNpcCombatCapabilities(fighter).visible;
}

export function isNpcTargetable(fighter: Fighter): boolean {
  return getNpcCombatCapabilities(fighter).targetable;
}

export function isNpcAoeVulnerable(fighter: Fighter): boolean {
  return getNpcCombatCapabilities(fighter).aoeVulnerable;
}

export function awardsNpcKillCredit(fighter: Fighter): boolean {
  return getNpcCombatCapabilities(fighter).grantsKillCredit;
}

export function isHerobrineEventUnit(fighter?: Fighter): boolean {
  return fighter?.npcUnitState?.eventKind === 'herobrine';
}

export function isHerobrine(fighter?: Fighter): boolean {
  return fighter?.npcUnitState?.unitKind === 'herobrine';
}

export function isHerobrineClone(fighter?: Fighter): boolean {
  return fighter?.npcUnitState?.unitKind === 'herobrine_clone';
}

export function isHerobrineTrace(fighter?: Fighter): boolean {
  return fighter?.npcUnitState?.unitKind === 'herobrine_tunnel' ||
    fighter?.npcUnitState?.unitKind === 'herobrine_leafless_tree' ||
    fighter?.npcUnitState?.unitKind === 'herobrine_sand_pyramid';
}

export function getHerobrineEvent(state?: BattleState) {
  return state?.majorNpcEvent?.kind === 'herobrine' ? state.majorNpcEvent : undefined;
}

export function isInsideHerobrineSingleWorld(state: BattleState | undefined, fighter: Fighter): boolean {
  const event = getHerobrineEvent(state);
  return !!event?.singleWorld &&
    (event.singleWorld.targetId === fighter.id || event.herobrineId === fighter.id);
}

export function isOnFinalPursuitContestantSide(
  state: BattleState | undefined,
  fighter: Fighter | undefined,
): boolean {
  const event = getHerobrineEvent(state);
  const contestantId = event?.finalPursuitContestantId;
  if (!event?.finalPursuit || !contestantId || !fighter) return false;
  return fighter.id === contestantId || fighter.summonerId === contestantId;
}

export function canTargetAcrossHerobrineBoundary(
  state: BattleState | undefined,
  attacker: Fighter,
  target: Fighter,
): boolean {
  const event = getHerobrineEvent(state);
  if (event?.finalPursuit && event.finalPursuitContestantId) {
    const attackerIsHerobrine = attacker.id === event.herobrineId;
    const targetIsHerobrine = target.id === event.herobrineId;
    const attackerOnContestantSide = isOnFinalPursuitContestantSide(state, attacker);
    const targetOnContestantSide = isOnFinalPursuitContestantSide(state, target);

    if (attackerIsHerobrine) return targetOnContestantSide;
    if (targetIsHerobrine) return attackerOnContestantSide;
    if (attackerOnContestantSide || targetOnContestantSide) {
      return attackerOnContestantSide && targetOnContestantSide;
    }
    return true;
  }

  const singleWorld = event?.singleWorld;
  if (!singleWorld) return true;

  const attackerInside = attacker.id === singleWorld.targetId || attacker.id === event.herobrineId;
  const targetInside = target.id === singleWorld.targetId || target.id === event.herobrineId;
  if (!attackerInside && !targetInside) return true;
  if (!attackerInside || !targetInside) return false;
  return (
    (attacker.id === event.herobrineId && target.id === singleWorld.targetId) ||
    (attacker.id === singleWorld.targetId && target.id === event.herobrineId)
  );
}

export function canResolveHerobrineDamageBoundary(
  state: BattleState | undefined,
  attacker: Fighter | undefined,
  target: Fighter,
  sourceKind: DamageSourceKind | undefined,
  originalTarget?: Fighter,
): boolean {
  const event = getHerobrineEvent(state);
  if (!event?.singleWorld && !event?.finalPursuit) return true;
  // Statuses that were already active before the isolation continue to settle.
  // Existing status ticks and self-costs stay attached to their owner when a
  // duel boundary is established.
  if (sourceKind === 'status' || sourceKind === 'self_cost') return true;
  // A share/transfer belongs to the original victim's side of the boundary.
  // This lets an outside Momo split an existing status tick among outside
  // captains, while preventing an isolated victim from exporting damage.
  if (
    (sourceKind === 'share' || sourceKind === 'transfer') &&
    originalTarget
  ) {
    return canTargetAcrossHerobrineBoundary(state, originalTarget, target);
  }
  if (!attacker) return false;
  return canTargetAcrossHerobrineBoundary(state, attacker, target);
}

export function canProvideHerobrineSupport(
  state: BattleState | undefined,
  provider: Fighter | undefined,
  recipient: Fighter,
): boolean {
  const event = getHerobrineEvent(state);
  if (!event?.singleWorld) return true;
  if (!provider || provider.id === recipient.id) return true;
  return canTargetAcrossHerobrineBoundary(state, provider, recipient);
}

export function hasSettlementBlockingNpc(fighters: readonly Fighter[]): boolean {
  return fighters.some((fighter) => getNpcCombatCapabilities(fighter).blocksSettlement);
}

export function getMajorNpcNoWinnerSettlementLabel(state?: BattleState): string | undefined {
  const event = state?.majorNpcEvent;
  if (
    event?.kind === 'herobrine' &&
    event.completed &&
    event.outcome === 'contestants_defeated'
  ) {
    return '无（参赛者全灭）';
  }
  return undefined;
}

export function getMajorNpcForcedWinnerId(state?: BattleState): string | undefined {
  const event = state?.majorNpcEvent;
  if (
    event?.kind === 'herobrine' &&
    event.completed &&
    event.outcome === 'true_removal' &&
    event.finalPursuitContestantId
  ) {
    return event.finalPursuitContestantId;
  }
  return undefined;
}
