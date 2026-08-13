import { cloneJobDefinition, healFighter } from './combatState';
import { commitFormTransition } from './battlePresentation';
import { canProvideHerobrineSupport } from './npcCombat';

import { rememberYuzuTeammates } from './yuzuMechanics';
import type {
  DamageApplicationOptions,
  DefeatOptions,
  Fighter,
  JobDefinition,
  MomoState,
  StatusApplication,
  DispelOptions,
  DispelResolution,
  BattleLogMetadata,
  BattleState,
} from './types';
import { applyStatus, consumeStatusValue, hasIdentity, queryMechanic, removeEffects } from './statusSystem';
import { getEffectiveCombatStat } from './statusMechanics';
import { statusPresentationGroupKey } from './statusPresentation';

export const MOMO_JOY_MAX = 138;
export const MOMO_RIDER_KICKS_TO_PHASE_THREE = 7;
export const MOMO_DYNAMIC_TEAM_LIMIT = 1;
export const MOMO_CAPTAIN_HP_BONUS = 138;
export const MOMO_CAPTAIN_ATTACK_MULTIPLIER = 1.1;
export const MOMO_CAPTAIN_HEAL_RATIO = 0.08;
export const MOMO_BLUE_EYES_BANISH_CHANCE = 0.05;
export const MOMO_ALTERNATE_DRAGON_CHANCE = 0.2;
export const MOMO_SWORD_RESONANCE_CHANCE = 0.25;
export const MOMO_OWL_FOOD_CHANCE = 0.0314;

export interface MomoRuntime {
  fighters: Fighter[];
  battleState?: BattleState;
  jobs: Partial<Record<string, JobDefinition>>;
  turnCount: number;
  getTeamId: (fighter: Fighter) => string;
  isActiveCombatant: (fighter: Fighter) => boolean;
  log: (type: string, text: string, metadata?: BattleLogMetadata) => void;
  syncHpPct: (fighter: Fighter) => void;
  applyDamage: (
    target: Fighter,
    amount: number,
    source: string,
    isTrueDamage?: boolean,
    attacker?: Fighter,
    options?: DamageApplicationOptions,
  ) => number;
  applyStatus: (target: Fighter, application: StatusApplication) => boolean;
  dispelStatusEffects: (target: Fighter, options: DispelOptions) => DispelResolution;
  markDefeated: (target: Fighter, options?: DefeatOptions) => boolean;
  flushDeferredDamageEvents: (fighter: Fighter, phase?: 'mitigation' | 'all') => void;
}

export type MomoDamageReward = {
  momo: Fighter;
  joyHealed: number;
  momoHealed: number;
  joyStacks: number;
};

function hasStatusFrom(fighter: Fighter, type: string, sourceId: string): boolean {
  return hasIdentity(fighter, type, { effectSourceIds: [sourceId] });
}

function isFoodUnit(fighter: Fighter): boolean {
  return fighter.owlSummonState?.kind === 'meal' || fighter.owlSummonState?.kind === 'rice';
}

function isCaptainEligible(fighter: Fighter): boolean {
  return !fighter.isNpc && !fighter.cannotWin && !fighter.cannotAct && !isFoodUnit(fighter);
}

export function ensureMomoState(momo: Fighter): MomoState {
  const state = momo.momoState ?? {
    phase: 1,
    teamMode: 'uninitialized',
    riderKickCount: 0,
    waterDaughter: false,
  };
  state.phase = Math.max(1, Math.min(3, Math.floor(state.phase ?? 1))) as 1 | 2 | 3;
  state.teamMode = state.teamMode ?? 'uninitialized';
  state.riderKickCount = Math.max(0, Math.floor(state.riderKickCount ?? 0));
  state.waterDaughter = !!state.waterDaughter;
  state.partnerSelectionCount = Math.max(0, Math.floor(state.partnerSelectionCount ?? 0));
  state.partnerReselectPending = !!state.partnerReselectPending;
  state.assignedMemberIds ??= [];
  state.originalTeamIds ??= {};
  momo.momoState = state;
  return state;
}

function hasMomoCaptainRelationship(fighter: Fighter, momoId: string): boolean {
  return !!fighter.momoCaptainBonuses?.[momoId] ||
    hasIdentity(fighter, 'MOMO_CAPTAIN', { effectSourceIds: [momoId] }) ||
    hasIdentity(fighter, 'MOMO_CROWD_JOY', { effectSourceIds: [momoId] });
}

function removeCaptainHpBonus(fighter: Fighter, momoId: string, keepRecord: boolean): void {
  const state = fighter.momoCaptainBonuses?.[momoId];
  if (!state) return;
  if (state.active) {
    fighter.maxHp = Math.max(1, fighter.maxHp - state.amount);
    if (fighter.currentHp > 0) fighter.currentHp = Math.max(1, fighter.currentHp - state.amount);
  }
  if (keepRecord) {
    state.active = false;
  } else if (fighter.momoCaptainBonuses) {
    delete fighter.momoCaptainBonuses[momoId];
    if (Object.keys(fighter.momoCaptainBonuses).length === 0) delete fighter.momoCaptainBonuses;
  }
}

function activateCaptainHpBonus(fighter: Fighter, momoId: string): boolean {
  fighter.momoCaptainBonuses ??= {};
  const existing = fighter.momoCaptainBonuses[momoId];
  if (existing?.active) return false;
  const state = existing ?? { amount: MOMO_CAPTAIN_HP_BONUS, active: false };
  state.amount = MOMO_CAPTAIN_HP_BONUS;
  state.active = true;
  fighter.momoCaptainBonuses[momoId] = state;
  fighter.maxHp += state.amount;
  if (fighter.currentHp > 0) fighter.currentHp += state.amount;
  return true;
}

/**
 * Permanent HP rebuilds operate on the unmodified layer, then restore every
 * active source-scoped captain bonus exactly once.
 */
export function withMomoCaptainHpBonusesSuspended<T>(fighter: Fighter, callback: () => T): T {
  const activeBonus = Object.values(fighter.momoCaptainBonuses ?? {})
    .filter((state) => state.active)
    .reduce((sum, state) => sum + state.amount, 0);
  if (activeBonus <= 0) return callback();

  fighter.maxHp = Math.max(1, fighter.maxHp - activeBonus);
  if (fighter.currentHp > 0) fighter.currentHp = Math.max(1, fighter.currentHp - activeBonus);
  const restore = () => {
    fighter.maxHp += activeBonus;
    if (fighter.currentHp > 0) fighter.currentHp += activeBonus;
  };
  try {
    const result = callback();
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function suspendMomoCaptainFrom(runtime: MomoRuntime, fighter: Fighter, momo: Fighter): void {
  removeEffects(fighter, { identityIds: ['MOMO_CAPTAIN'], effectSourceIds: [momo.id], reason: 'scripted' });
  removeCaptainHpBonus(fighter, momo.id, true);
  runtime.syncHpPct(fighter);
}

function removeMomoCaptainFrom(fighter: Fighter, momo: Fighter, preserveJoy = false): void {
  removeEffects(fighter, {
    identityIds: preserveJoy ? ['MOMO_CAPTAIN'] : ['MOMO_CAPTAIN', 'MOMO_CROWD_JOY'],
    effectSourceIds: [momo.id],
    reason: 'scripted',
  });
  removeCaptainHpBonus(fighter, momo.id, false);
}

interface MomoCaptainGrantResult {
  fighter: Fighter;
  newRelationship: boolean;
  statusRestored: boolean;
  hpBonusActivated: boolean;
}

function grantMomoCaptainTo(runtime: MomoRuntime, momo: Fighter, fighter: Fighter): MomoCaptainGrantResult {
  if (!canProvideHerobrineSupport(runtime.battleState, momo, fighter)) {
    return {
      fighter,
      newRelationship: false,
      statusRestored: false,
      hpBonusActivated: false,
    };
  }
  const wasNewMember = !fighter.momoCaptainBonuses?.[momo.id];
  const statusRestored = !hasStatusFrom(fighter, 'MOMO_CAPTAIN', momo.id);
  if (statusRestored) {
    applyStatus(fighter, { identityId: 'MOMO_CAPTAIN', effectName: '全员上舰', attribution: { effectSourceId: momo.id, applierId: momo.id, applierName: momo.name } });
  }
  const hpBonusActivated = activateCaptainHpBonus(fighter, momo.id);
  runtime.syncHpPct(fighter);
  return { fighter, newRelationship: wasNewMember, statusRestored, hpBonusActivated };
}

export function activeMomoCaptains(runtime: MomoRuntime, momo: Fighter, includeSelf = true): Fighter[] {
  return runtime.fighters.filter((fighter) =>
    (includeSelf || fighter.id !== momo.id) &&
    runtime.isActiveCombatant(fighter) &&
    !hasIdentity(fighter, 'SYNERGY_SLACKING') &&
    canProvideHerobrineSupport(runtime.battleState, momo, fighter) &&
    hasStatusFrom(fighter, 'MOMO_CAPTAIN', momo.id),
  );
}

export function syncMomoCaptains(runtime: MomoRuntime, momo: Fighter, announce = false): Fighter[] {
  if (!runtime.isActiveCombatant(momo)) return [];
  const teamId = runtime.getTeamId(momo);
  const expectedMembers = runtime.fighters.filter((fighter) =>
    runtime.isActiveCombatant(fighter) &&
    isCaptainEligible(fighter) &&
    runtime.getTeamId(fighter) === teamId,
  );
  const expectedIds = new Set(expectedMembers.map((fighter) => fighter.id));
  runtime.fighters.forEach((fighter) => {
    if (hasMomoCaptainRelationship(fighter, momo.id) && !expectedIds.has(fighter.id)) {
      removeMomoCaptainFrom(fighter, momo);
      runtime.syncHpPct(fighter);
    } else if (
      expectedIds.has(fighter.id) &&
      hasIdentity(fighter, 'SYNERGY_SLACKING')
    ) {
      suspendMomoCaptainFrom(runtime, fighter, momo);
    }
  });
  const expected = expectedMembers.filter((fighter) =>
    !hasIdentity(fighter, 'SYNERGY_SLACKING'),
  );
  const grants = expected.map((fighter) => grantMomoCaptainTo(runtime, momo, fighter));
  const added = grants.filter((grant) => grant.newRelationship).map((grant) => grant.fighter);
  const restored = grants.filter((grant) =>
    !grant.newRelationship && (grant.statusRestored || grant.hpBonusActivated),
  );
  if (announce && added.length > 0) {
    runtime.log('buff', `⚓ 【全员上舰】${momo.name}：“坏了我自己给自己上舰了。”${added.map((fighter) => fighter.name).join('、')} 成为舰长，攻击提高且生命 +${MOMO_CAPTAIN_HP_BONUS}！`);
  }
  if (restored.length > 0) {
    runtime.log('buff', `⚓ 【重新上舰】${restored.map((grant) => grant.fighter.name).join('、')} 的舰长状态曾被移除，现有队伍关系将其恢复${restored.some((grant) => grant.hpBonusActivated) ? `，并重新激活生命 +${MOMO_CAPTAIN_HP_BONUS}` : '；现有生命加成没有重复计算'}。`);
  }
  return expected;
}

function activePartnerCandidates(runtime: MomoRuntime, momo: Fighter): Fighter[] {
  return runtime.fighters.filter((fighter) =>
    fighter.id !== momo.id &&
    !fighter.isNpc &&
    !fighter.cannotWin &&
    !fighter.cannotAct &&
    !isFoodUnit(fighter) &&
    runtime.isActiveCombatant(fighter) &&
    canProvideHerobrineSupport(runtime.battleState, momo, fighter),
  );
}

function resolvePartnerAnchor(runtime: MomoRuntime, target: Fighter): Fighter {
  if (!target.isSummon || !target.summonerId) return target;
  return runtime.fighters.find((fighter) => fighter.id === target.summonerId && runtime.isActiveCombatant(fighter)) ?? target;
}

export function clearMomoTeam(
  runtime: MomoRuntime,
  momo: Fighter,
  preserveExplicitTeam = false,
  preserveSelfCaptain = false,
): void {
  runtime.fighters.forEach((fighter) => {
    if (preserveSelfCaptain && fighter.id === momo.id) return;
    removeMomoCaptainFrom(fighter, momo);
    runtime.syncHpPct(fighter);
  });
  const state = ensureMomoState(momo);
  if (!preserveExplicitTeam && state.teamMode === 'dynamic') {
    const original = state.originalTeamIds?.[momo.id];
    momo.teamId = original ?? undefined;
  }
  state.partnerTargetId = undefined;
  state.partnerAnchorId = undefined;
  state.partnerReselectPending = false;
  state.dynamicTeamId = undefined;
  state.assignedMemberIds = [];
}

export function chooseMomoPartner(runtime: MomoRuntime, momo: Fighter, reason: string): Fighter | undefined {
  const state = ensureMomoState(momo);
  if (state.teamMode === 'explicit' || state.teamMode === 'water') {
    syncMomoCaptains(runtime, momo, true);
    return undefined;
  }

  clearMomoTeam(runtime, momo, false, true);
  state.teamMode = 'dynamic';
  state.originalTeamIds = state.originalTeamIds ?? {};
  if (!(momo.id in state.originalTeamIds)) state.originalTeamIds[momo.id] = momo.teamId ?? null;

  const selectionsUsed = state.partnerSelectionCount ?? 0;
  if (selectionsUsed >= MOMO_DYNAMIC_TEAM_LIMIT) {
    momo.teamId = `MOMO_SOLO:${momo.id}`;
    state.dynamicTeamId = momo.teamId;
    syncMomoCaptains(runtime, momo, true);
    runtime.log(
      'info',
      `🫧 【随机组队】${momo.name} 的认主次数已用尽（${selectionsUsed}/${MOMO_DYNAMIC_TEAM_LIMIT}），解除旧队伍并独自继续战斗。`,
      {
        actorId: momo.id,
        actorName: momo.name,
        targetIds: [momo.id],
      },
    );
    return undefined;
  }

  const candidates = activePartnerCandidates(runtime, momo);
  const target = candidates[Math.floor(Math.random() * candidates.length)];
  if (!target) {
    momo.teamId = `MOMO_SOLO:${momo.id}`;
    state.dynamicTeamId = momo.teamId;
    syncMomoCaptains(runtime, momo, true);
    runtime.log('info', `🫧 【随机组队】${momo.name} ${reason}，但场上暂时没有可组队的非 NPC 单位，只能先独自上舰。`);
    return undefined;
  }

  const anchor = resolvePartnerAnchor(runtime, target);
  const joinedTeamId = runtime.getTeamId(anchor);
  momo.teamId = joinedTeamId;
  state.partnerTargetId = target.id;
  state.partnerAnchorId = anchor.id;
  state.partnerSelectionCount = selectionsUsed + 1;
  state.partnerReselectPending = false;
  state.dynamicTeamId = joinedTeamId;
  state.assignedMemberIds = [momo.id];
  runtime.fighters
    .filter((fighter) => fighter.isYuzu && runtime.getTeamId(fighter) === joinedTeamId)
    .forEach((yuzu) => rememberYuzuTeammates(runtime, yuzu));
  runtime.log('buff', target.id === anchor.id
    ? `🫧 【随机组队】${momo.name} ${reason}，随机拉住 ${target.name} 成为队友！（认主 ${state.partnerSelectionCount}/${MOMO_DYNAMIC_TEAM_LIMIT}）`
    : `🫧 【随机组队】${momo.name} ${reason}，选中了召唤物 ${target.name}，因此其主人 ${anchor.name} 与同主召唤物一并成为队友！（认主 ${state.partnerSelectionCount}/${MOMO_DYNAMIC_TEAM_LIMIT}）`);
  syncMomoCaptains(runtime, momo, true);
  return target;
}

export function initializeMomoTeam(runtime: MomoRuntime, momo: Fighter): void {
  if (!momo.isMomo || !runtime.isActiveCombatant(momo)) return;
  const state = ensureMomoState(momo);
  if (state.teamMode !== 'uninitialized') {
    if (state.teamMode === 'dynamic' && state.partnerTargetId) {
      const partnerAlive = runtime.fighters.some((fighter) => fighter.id === state.partnerTargetId && runtime.isActiveCombatant(fighter));
      if (state.partnerReselectPending || !partnerAlive) chooseMomoPartner(runtime, momo, '原队友已经退场，重新抽选队友');
      else syncMomoCaptains(runtime, momo);
    } else if (state.teamMode === 'dynamic' && state.partnerReselectPending) {
      chooseMomoPartner(runtime, momo, '原队友已经退场，重新抽选队友');
    } else {
      syncMomoCaptains(runtime, momo);
    }
    return;
  }

  if (momo.teamId) {
    state.teamMode = momo.teamId === 'WATER_TEAM' ? 'water' : 'explicit';
    syncMomoCaptains(runtime, momo, true);
    return;
  }
  chooseMomoPartner(runtime, momo, '开局随机抽选队友');
}

export function handleMomoPartnerDefeat(runtime: MomoRuntime, fallen: Fighter): void {
  runtime.fighters.forEach((momo) => {
    if (!momo.isMomo || !runtime.isActiveCombatant(momo)) return;
    const state = ensureMomoState(momo);
    if (state.teamMode !== 'dynamic' || state.partnerTargetId !== fallen.id) return;
    state.partnerReselectPending = true;
    const selectionsUsed = state.partnerSelectionCount ?? 0;
    runtime.log(
      'info',
      selectionsUsed >= MOMO_DYNAMIC_TEAM_LIMIT
        ? `🫧 【队友退场】${fallen.name} 已离开战场，${momo.name} 的认主次数已经用尽，会在当前结算完成后解除队伍并独自战斗。`
        : `🫧 【队友退场】${fallen.name} 已离开战场，${momo.name} 会在当前结算完成后重新抽选队友。`,
      {
        actorId: momo.id,
        actorName: momo.name,
        targetIds: [fallen.id],
      },
    );
  });
}

export type MomoCrowdJoyGain = {
  captain: Fighter;
  before: number;
  after: number;
  gained: number;
};

export function addMomoCrowdJoyToCaptain(momo: Fighter, captain: Fighter, amount: number): MomoCrowdJoyGain {
  const existing = queryMechanic(captain, 'MOMO_CROWD_JOY', { effectSourceIds: [momo.id] }).entries[0];
  const before = Math.max(0, Math.min(MOMO_JOY_MAX, existing?.potency ?? 0));
  const status = applyStatus(captain, {
    identityId: 'MOMO_CROWD_JOY',
    potency: Math.max(0, Math.floor(amount)),
    attribution: { effectSourceId: momo.id, applierId: momo.id, applierName: momo.name },
  }).primary;
  const after = Math.max(0, Math.min(MOMO_JOY_MAX, status.potency ?? 0));
  return { captain, before, after, gained: after - before };
}

export function addMomoCrowdJoy(runtime: MomoRuntime, momo: Fighter, amount: number): MomoCrowdJoyGain[] {
  const captains = activeMomoCaptains(runtime, momo, true);
  return captains.map((captain) => addMomoCrowdJoyToCaptain(momo, captain, amount));
}

export function decayMomoCrowdJoy(runtime: MomoRuntime, actor: Fighter): void {
  const entries = queryMechanic(actor, 'MOMO_CROWD_JOY').entries.filter((status) => (status.potency ?? 0) > 0);
  entries.forEach((status) => {
    const before = Math.max(0, status.potency ?? 0);
    const next = Math.max(0, before - 10);
    consumeStatusValue(actor, status, 'potency', 10);
    runtime.log('info', `🎉 【众宾欢也】${actor.name} 完成本次行动，层数 ${before} -> ${next}。`);
  });
}

export function applyMomoCaptainDamageRewards(
  runtime: MomoRuntime,
  attacker: Fighter | undefined,
  actualDamage: number,
  source: string,
): MomoDamageReward[] {
  if (!attacker || actualDamage <= 0 || !runtime.isActiveCombatant(attacker)) return [];
  if (!['skill', 'counter', 'reflect'].includes(source)) return [];
  const rewards: MomoDamageReward[] = [];
  const captainStatuses = queryMechanic(attacker, 'MOMO_CAPTAIN').entries;
  captainStatuses.forEach((captainStatus) => {
    const sourceId = captainStatus.attribution.effectSourceId;
    const momo = runtime.fighters.find((fighter) => fighter.id === sourceId && fighter.isMomo && runtime.isActiveCombatant(fighter));
    if (!momo) return;
    const joy = queryMechanic(attacker, 'MOMO_CROWD_JOY', { effectSourceIds: [momo.id] }).entries[0];
    const joyStacks = Math.max(0, Math.min(MOMO_JOY_MAX, joy?.potency ?? 0));
    const joyHealed = joyStacks > 0
      ? healFighter(attacker, Math.floor(actualDamage * joyStacks / 100), runtime.log)
      : 0;
    const canReturnHealing = canProvideHerobrineSupport(runtime.battleState, attacker, momo);
    const momoHealed = canReturnHealing
      ? healFighter(momo, Math.floor(actualDamage * MOMO_CAPTAIN_HEAL_RATIO), runtime.log, {
          kind: 'direct',
          sourceId: '舰长联动',
          healer: attacker,
        })
      : 0;
    if (!canReturnHealing) {
      runtime.log('info', `⬜ 【单人世界边界】${attacker.name} 的舰长回馈无法越过隔离治疗 ${momo.name}。`);
    }
    rewards.push({ momo, joyHealed, momoHealed, joyStacks });
  });
  return rewards;
}

function rebuildMomoPhaseTwoStats(momo: Fighter): void {
  momo.maxHp = Math.max(3800, Math.min(4300, Math.floor(momo.maxHp * 6.2)));
  momo.currentHp = momo.maxHp;
  momo.atk = Math.max(175, Math.floor(momo.atk * 4.2));
  momo.def = Math.max(135, Math.floor(momo.def * 5.2));
  momo.res = Math.max(145, Math.floor(momo.res * 5.1));
  momo.spd = Math.max(120, Math.floor(momo.spd * 6.3));
  momo.agl = Math.max(110, Math.floor(momo.agl * 5.5));
  momo.mag = Math.max(185, Math.floor(momo.mag * 5.2));
  momo.wis = Math.max(190, Math.floor(momo.wis * 5.4));
}

function rebuildMomoPhaseThreeStats(momo: Fighter): void {
  momo.maxHp = Math.max(4500, Math.min(5100, Math.floor(momo.maxHp * 1.22)));
  momo.currentHp = Math.min(momo.maxHp, Math.max(momo.currentHp, Math.floor(momo.maxHp * 0.78)));
  momo.atk = Math.max(285, Math.floor(momo.atk * 1.55));
  momo.def = Math.max(195, Math.floor(momo.def * 1.42));
  momo.res = Math.max(205, Math.floor(momo.res * 1.42));
  momo.spd = Math.max(160, Math.floor(momo.spd * 1.35));
  momo.agl = Math.max(135, Math.floor(momo.agl * 1.25));
  momo.mag = Math.max(300, Math.floor(momo.mag * 1.55));
  momo.wis = Math.max(300, Math.floor(momo.wis * 1.45));
}

export function applyMomoPhaseTwoStats(momo: Fighter): void {
  rebuildMomoPhaseTwoStats(momo);
}

export function ensureMomoAwakenedSword(runtime: MomoRuntime, momo: Fighter, announceWay = true): boolean {
  const hasAwakened = hasStatusFrom(momo, 'MOMO_AWAKENED_SWORD', momo.id);
  if (hasAwakened) return false;
  removeEffects(momo, {
    identityIds: ['MOMO_VILLAGE_SWORD', 'MOMO_AWAKENED_SWORD'],
    effectSourceIds: [momo.id],
    reason: 'replaced',
  });
  applyStatus(momo, { identityId: 'MOMO_AWAKENED_SWORD', attribution: { effectSourceId: momo.id } });
  if (announceWay) {
    runtime.log(
      'buff',
      `⚔️ 【way？！】${momo.name} 手中没有醒剑，三阶段权能直接生成【醒剑】，攻击大幅提高！`,
      {
        actorId: momo.id,
        actorName: momo.name,
        targetIds: [momo.id],
      },
    );
  }
  return true;
}

export function grantMomoSword(runtime: MomoRuntime, momo: Fighter): 'village' | 'awakened' | 'existing' {
  if (hasStatusFrom(momo, 'MOMO_AWAKENED_SWORD', momo.id) || hasStatusFrom(momo, 'MOMO_VILLAGE_SWORD', momo.id)) {
    return 'existing';
  }
  if (Math.random() < MOMO_SWORD_RESONANCE_CHANCE) {
    ensureMomoAwakenedSword(runtime, momo, false);
    return 'awakened';
  }
  applyStatus(momo, { identityId: 'MOMO_VILLAGE_SWORD', attribution: { effectSourceId: momo.id } });
  runtime.log(
    'buff',
    `🗡️ 【SWORD VENT】无双龙为 ${momo.name} 降下【村好剑】，攻击小幅提高。`,
    {
      actorId: momo.id,
      actorName: momo.name,
      targetIds: [momo.id],
    },
  );
  return 'village';
}

export function enterMomoPhaseThree(runtime: MomoRuntime, momo: Fighter, reason: string): boolean {
  const state = ensureMomoState(momo);
  if (!momo.isMomo || state.phase >= 3 || !runtime.isActiveCombatant(momo)) return false;
  const changed = commitFormTransition({
    fighter: momo,
    log: runtime.log,
    message: () => `🦇 【塞Q来打！】${momo.name} ${reason}，完成三阶段变身；骑士踢计数 ${state.riderKickCount}/${MOMO_RIDER_KICKS_TO_PHASE_THREE}！`,
    mutate: () => {
      state.phase = 3;
      if (!state.waterDaughter) {
        const job = runtime.jobs.MOMO_SAI_Q_RIDER;
        momo.job = 'MOMO_SAI_Q_RIDER';
        if (job) momo.jobData = cloneJobDefinition(job);
      }
      withMomoCaptainHpBonusesSuspended(momo, () => rebuildMomoPhaseThreeStats(momo));
      runtime.syncHpPct(momo);
    },
  });
  if (!changed) return false;
  ensureMomoAwakenedSword(runtime, momo);

  const alternateDragon = runtime.fighters.find((fighter) =>
    fighter.summonerId === momo.id &&
    fighter.momoDragonVariant === 'alternate' &&
    runtime.isActiveCombatant(fighter),
  );
  if (alternateDragon && Math.random() < 0.5) {
    runtime.markDefeated(alternateDragon, {
      message: `💥 【失手处决】${momo.name} 变身时一剑劈歪，误将 ${alternateDragon.name} 当场处决！`,
      killer: momo,
    });
  }
  return true;
}

export function registerMomoRiderKick(runtime: MomoRuntime, momo: Fighter, skillName: string): number {
  const state = ensureMomoState(momo);
  if (state.phase >= 3) return state.riderKickCount;
  state.riderKickCount = Math.min(MOMO_RIDER_KICKS_TO_PHASE_THREE, state.riderKickCount + 1);
  runtime.log(
    'buff',
    `🦇 【骑士踢计数】${momo.name} 使用【${skillName}】，进度 ${state.riderKickCount}/${MOMO_RIDER_KICKS_TO_PHASE_THREE}（无论命中与否均计数）。`,
    {
      actorId: momo.id,
      actorName: momo.name,
      targetIds: [momo.id],
    },
  );
  if (state.riderKickCount >= MOMO_RIDER_KICKS_TO_PHASE_THREE) {
    enterMomoPhaseThree(runtime, momo, '累计使用 7 次骑士踢');
  }
  return state.riderKickCount;
}

export function activeMomoShareCaptains(runtime: MomoRuntime, momo: Fighter): Fighter[] {
  return activeMomoCaptains(runtime, momo, false);
}

function oldestOwlFood(runtime: MomoRuntime): Fighter | undefined {
  return runtime.fighters
    .filter((fighter) => runtime.isActiveCombatant(fighter) && isFoodUnit(fighter))
    .sort((a, b) => (a.owlSummonState?.spawnedTurn ?? 0) - (b.owlSummonState?.spawnedTurn ?? 0))[0];
}

function addThreePoisonStacks(momo: Fighter): void {
  applyStatus(momo, {
    identityId: 'POISON',
    potency: 3,
    remainingTurns: 3,
    attribution: { effectSourceId: momo.id, applierId: momo.id, applierName: momo.name },
  });
}

function consumeToxicMeal(runtime: MomoRuntime, momo: Fighter, food: Fighter | undefined, reason: string): void {
  if (food) {
    const index = runtime.fighters.findIndex((fighter) => fighter.id === food.id);
    if (index >= 0) runtime.fighters.splice(index, 1);
  }
  const cost = Math.max(1, Math.floor(momo.maxHp * 0.05));
  const options: DamageApplicationOptions = {
    actionName: '有毒拼好饭',
    respectDefenses: false,
    creditAttacker: false,
    bypassOwlEmperorRedirect: true,
    bypassOwlOutgoingModifier: true,
    bypassOwlIncomingModifier: true,
    bypassShields: true,
    suppressOwlCooperation: true,
    deferTransform: true,
  };
  const actual = runtime.applyDamage(momo, cost, 'momo_cost', true, momo, options);
  runtime.flushDeferredDamageEvents(momo, 'mitigation');
  runtime.log(
    'poison',
    `🍚 【这饭……有毒……】${momo.name} ${reason}，损失 ${actual} 点生命并获得 3 层中毒！`,
    {
      actorId: momo.id,
      actorName: momo.name,
      targetIds: [momo.id],
    },
  );
  if (actual > 0 || (momo.pendingDamageEvents?.length ?? 0) > 0) runtime.flushDeferredDamageEvents(momo);
  addThreePoisonStacks(momo);
  if (momo.currentHp <= 0 && !momo.isDead && !momo.isDeadAnnounced) {
    runtime.markDefeated(momo, { message: `💀 【这饭……有毒……】${momo.name} 吃完后中毒倒下！`, awardKill: false });
  }
}

export function tryMomoStealYuzuMeal(runtime: MomoRuntime, yuzu: Fighter): Fighter | undefined {
  const candidates = runtime.fighters.filter((fighter) =>
    fighter.isMomo &&
    ensureMomoState(fighter).phase >= 3 &&
    runtime.isActiveCombatant(fighter) &&
    runtime.getTeamId(fighter) !== runtime.getTeamId(yuzu),
  );
  const momo = candidates[Math.floor(Math.random() * candidates.length)];
  if (!momo) return undefined;
  const momoPower = Math.max(1, getEffectiveCombatStat(momo, 'wis') + getEffectiveCombatStat(momo, 'spd'));
  const yuzuPower = Math.max(1, getEffectiveCombatStat(yuzu, 'wis') + getEffectiveCombatStat(yuzu, 'spd'));
  const winChance = Math.max(0.3, Math.min(0.7, momoPower / (momoPower + yuzuPower)));
  if (Math.random() >= winChance) {
    runtime.log(
      'info',
      `🥄 【拼好饭争夺】${momo.name} 冲来和 ${yuzu.name} 拼点失败，拼好饭仍归柚子。`,
      {
        actorId: momo.id,
        actorName: momo.name,
        targetIds: [yuzu.id],
      },
    );
    return undefined;
  }
  runtime.log(
    'skill',
    `🥄 【拼好饭争夺】${momo.name} 拼点成功，在 ${yuzu.name} 拾取前抢走了拼好饭；柚子的勺子攻击仍会继续！`,
    {
      actorId: momo.id,
      actorName: momo.name,
      targetIds: [yuzu.id],
    },
  );
  consumeToxicMeal(runtime, momo, undefined, `从 ${yuzu.name} 手中抢走拼好饭并吃下`);
  return momo;
}

export function processMomoActorTurnEnd(runtime: MomoRuntime, actor: Fighter, performedAction: boolean): void {
  if (!performedAction) return;
  decayMomoCrowdJoy(runtime, actor);
  if (!actor.isMomo || ensureMomoState(actor).phase < 3 || !runtime.isActiveCombatant(actor)) return;
  const food = oldestOwlFood(runtime);
  if (!food || Math.random() >= MOMO_OWL_FOOD_CHANCE) return;
  consumeToxicMeal(runtime, actor, food, `趁行动间隙吃掉 ${food.name}`);
}

export function cleanseMomoCaptains(runtime: MomoRuntime, momo: Fighter): number {
  let removed = 0;
  activeMomoCaptains(runtime, momo, true).forEach((captain) => {
    const result = runtime.dispelStatusEffects(captain, {
      strength: 'normal',
      direction: 'negative',
    });
    removed += new Set(result.removed.map(statusPresentationGroupKey)).size;
  });
  return removed;
}

export function reviveMomoAsWaterDaughter(runtime: MomoRuntime, momo: Fighter): boolean {
  const state = ensureMomoState(momo);
  if (!momo.isMomo || !momo.isDead || state.waterDaughter) return false;
  const waterAnchor = runtime.fighters.find((fighter) =>
    runtime.isActiveCombatant(fighter) &&
    (fighter.isMorphling || (fighter.isGamer && fighter.isSon && fighter.job === 'MORPHLING_SON')),
  );
  const daughterJob = runtime.jobs.MOMO_WATER_DAUGHTER;
  if (!waterAnchor || !daughterJob) return false;

  clearMomoTeam(runtime, momo);
  const changed = commitFormTransition({
    fighter: momo,
    kind: 'form_shift',
    cause: 'revival',
    log: runtime.log,
    message: `🌊 【水人的大女儿】${momo.name} 刚被判定退场，就被 ${waterAnchor.name} 从水里捞起，满血加入水人阵营！`,
    mutate: () => {
      state.waterDaughter = true;
      state.teamMode = 'water';
      momo.teamId = waterAnchor.teamId ?? 'WATER_TEAM';
      momo.job = 'MOMO_WATER_DAUGHTER';
      momo.jobData = cloneJobDefinition(daughterJob);
      momo.isDead = false;
      momo.isDeadAnnounced = false;
      momo.defeatHooksResolved = false;
      momo.maxHp = Math.max(3600, Math.floor(momo.maxHp * 1.25));
      momo.currentHp = momo.maxHp;
      momo.atk = Math.max(230, Math.floor(momo.atk * 1.25));
      momo.def = Math.max(170, Math.floor(momo.def * 1.25));
      momo.res = Math.max(180, Math.floor(momo.res * 1.25));
      momo.spd = Math.max(135, Math.floor(momo.spd * 1.18));
      momo.agl = Math.max(120, Math.floor(momo.agl * 1.18));
      momo.mag = Math.max(235, Math.floor(momo.mag * 1.25));
      momo.wis = Math.max(245, Math.floor(momo.wis * 1.25));
      runtime.syncHpPct(momo);
    },
  });
  if (!changed) return false;
  runtime.dispelStatusEffects(momo, {
    strength: 'absolute',
    direction: 'all',
    includeNeutral: true,
    includeIndependent: true,
  });
  syncMomoCaptains(runtime, momo, true);
  if (state.phase >= 3) ensureMomoAwakenedSword(runtime, momo);
  return true;
}

export function processMomoGlobalTick(runtime: MomoRuntime): void {
  runtime.fighters.forEach((fighter) => {
    if (!fighter.isMomo || !runtime.isActiveCombatant(fighter)) return;
    initializeMomoTeam(runtime, fighter);
    const state = ensureMomoState(fighter);
    if (state.riderKickCount >= MOMO_RIDER_KICKS_TO_PHASE_THREE) {
      enterMomoPhaseThree(runtime, fighter, '骑士踢计数已经充满');
    }
    if (state.phase >= 3) ensureMomoAwakenedSword(runtime, fighter);
  });
}

export function tryMomoBanishBlueEyes(
  runtime: Pick<MomoRuntime, 'fighters' | 'getTeamId' | 'isActiveCombatant' | 'log' | 'markDefeated'>,
  summon: Fighter,
  summoner: Fighter,
): Fighter | undefined {
  if ((summon.summonBaseName ?? summon.name) !== '青眼白龙' || !summoner.isGacha) return undefined;
  const momos = runtime.fighters.filter((fighter) =>
    fighter.isMomo &&
    runtime.isActiveCombatant(fighter) &&
    runtime.getTeamId(fighter) === runtime.getTeamId(summoner),
  );
  for (const momo of momos) {
    if (Math.random() >= MOMO_BLUE_EYES_BANISH_CHANCE) continue;
    runtime.log('crit', `🚫 【抹杀的指名者】${momo.name} 宣言“青眼白龙”！${summon.name} 被直接除外，无视护盾、减伤与锁血！`);
    runtime.markDefeated(summon, {
      message: `💀 【除外结算】${summon.name} 被 ${momo.name} 的【抹杀的指名者】送离战场！`,
      killer: momo,
      setHpZero: true,
    });
    return momo;
  }
  return undefined;
}
