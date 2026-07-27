import type { BattleLogMetadata, Fighter, StatusApplication } from './types';
import type { ReactionActionDescriptor } from './characterHooks';
import { isSelectableTargetFor } from './targeting';
import {
  findActiveYuzuProphet,
  getYuzuProphetBoundYuzu,
} from './yuzuProphetMechanics';
import { commitFormTransition } from './battlePresentation';

import { consumeBarriers, getBarrierTotal, grantBarrier, removeBarriers, removeEffects, applyStatus, withPersistentStatusShapesSuspended } from './statusSystem';

export type YuzuWeaponId =
  | 'sword'
  | 'knife'
  | 'greatsword'
  | 'hammer'
  | 'shield'
  | 'dagger'
  | 'whip'
  | 'spear'
  | 'spoon'
  | 'scythe';

export type YuzuWeapon = {
  id: YuzuWeaponId;
  name: string;
  weight: number;
  attackMultiplier: number;
  selfHealMaxHpRatio?: number;
  bleedCount?: number;
  evadeDownTurns?: number;
  defDownTurns?: number;
  shieldFromDamageRatio?: number;
};

export interface YuzuRuntime {
  fighters: Fighter[];
  turnCount: number;
  largeRound?: number;
  getTeamId: (fighter: Fighter) => string;
  isActiveCombatant: (fighter: Fighter) => boolean;
  log: (type: string, text: string, metadata?: BattleLogMetadata) => void;
  syncHpPct?: (fighter: Fighter) => void;
  applyStatus?: (target: Fighter, application: StatusApplication) => boolean;
  runReactionAction?: (
    actor: Fighter,
    descriptor: ReactionActionDescriptor,
    callback: () => void,
  ) => void;
}

export const YUZU_WEAPONS: Record<YuzuWeaponId, YuzuWeapon> = {
  sword: { id: 'sword', name: '剑', weight: 10, attackMultiplier: 1.15 },
  knife: { id: 'knife', name: '刀', weight: 10, attackMultiplier: 1.15, bleedCount: 3 },
  greatsword: { id: 'greatsword', name: '巨剑', weight: 10, attackMultiplier: 1.35, evadeDownTurns: 2 },
  hammer: { id: 'hammer', name: '锤', weight: 10, attackMultiplier: 1.3, evadeDownTurns: 3, defDownTurns: 1 },
  shield: { id: 'shield', name: '盾牌', weight: 10, attackMultiplier: 1.05, shieldFromDamageRatio: 0.75 },
  dagger: { id: 'dagger', name: '匕首', weight: 10, attackMultiplier: 1.1, bleedCount: 2 },
  whip: { id: 'whip', name: '鞭', weight: 10, attackMultiplier: 1.3, bleedCount: 5 },
  spear: { id: 'spear', name: '长矛', weight: 10, attackMultiplier: 1.3, evadeDownTurns: 3 },
  spoon: { id: 'spoon', name: '勺子', weight: 1, attackMultiplier: 0.7, selfHealMaxHpRatio: 0.3 },
  scythe: { id: 'scythe', name: '镰刀', weight: 9, attackMultiplier: 1.6, bleedCount: 3, evadeDownTurns: 3, defDownTurns: 3 },
};

export const YUZU_PHASE_ONE_REDUCTION = 0.15;
export const YUZU_PHASE_THREE_REDUCTION = 0.157;
export const YUZU_TEAM_SHARE_RATIO = 1;
export const YUZU_OPENING_SHIELD_RATIO = 0.2;
export const YUZU_PHASE_TWO_SOLO_SHIELD_RATIO = 0.65;
export const YUZU_PHASE_TWO_TEAM_SHIELD_RATIO = 0.35;
export const YUZU_UNMARKED_INCOMING_DAMAGE_MULTIPLIER = 0.23;
export const YUZU_MARK_DAMAGE_BONUS = 0.2;
export const YUZU_UNMARKED_DAMAGE_PENALTY = 0.2;
export const YUZU_FURIOSO_COUNT = 9;
export const YUZU_BARRIER_IDENTITY = 'YUZU_BARRIER';

function scaleStat(value: number, multiplier: number, floor: number): number {
  return Math.max(floor, Math.floor(value * multiplier));
}

function rebuildYuzuPhaseTwoStats(yuzu: Fighter): void {
  yuzu.maxHp = Math.max(3000, Math.min(3500, Math.floor(yuzu.maxHp * 5.8)));
  yuzu.currentHp = yuzu.maxHp;
  yuzu.atk = scaleStat(yuzu.atk, 4.0, 175);
  yuzu.def = scaleStat(yuzu.def, 5.2, 125);
  yuzu.res = scaleStat(yuzu.res, 5.2, 125);
  yuzu.spd = scaleStat(yuzu.spd, 7.0, 115);
  yuzu.agl = scaleStat(yuzu.agl, 5.8, 105);
  yuzu.mag = scaleStat(yuzu.mag, 8.0, 60);
  yuzu.wis = scaleStat(yuzu.wis, 7.5, 150);
}

function rebuildYuzuPhaseThreeStats(yuzu: Fighter): void {
  yuzu.maxHp = Math.max(3600, Math.min(4300, Math.floor(yuzu.maxHp * 1.23)));
  yuzu.currentHp = Math.max(yuzu.currentHp, Math.floor(yuzu.maxHp * 0.72));
  yuzu.atk = scaleStat(yuzu.atk, 1.45, 255);
  yuzu.def = scaleStat(yuzu.def, 1.35, 170);
  yuzu.res = scaleStat(yuzu.res, 1.35, 170);
  yuzu.spd = scaleStat(yuzu.spd, 1.25, 145);
  yuzu.agl = scaleStat(yuzu.agl, 1.25, 130);
  yuzu.mag = scaleStat(yuzu.mag, 1.4, 95);
  yuzu.wis = scaleStat(yuzu.wis, 1.35, 220);
}

function sameTeam(runtime: Pick<YuzuRuntime, 'getTeamId'>, a: Fighter, b: Fighter): boolean {
  return runtime.getTeamId(a) === runtime.getTeamId(b);
}

function currentYuzuTeamMembers(runtime: YuzuRuntime, yuzu: Fighter): Fighter[] {
  return runtime.fighters.filter((fighter) =>
    fighter.id !== yuzu.id &&
    !fighter.isSummon &&
    !fighter.isNpc &&
    !fighter.cannotWin &&
    sameTeam(runtime, yuzu, fighter),
  );
}

export function activeYuzuTeammates(runtime: YuzuRuntime, yuzu: Fighter): Fighter[] {
  return currentYuzuTeamMembers(runtime, yuzu).filter((fighter) => runtime.isActiveCombatant(fighter));
}

export function hasAnyYuzuTeammate(runtime: YuzuRuntime, yuzu: Fighter): boolean {
  return currentYuzuTeamMembers(runtime, yuzu).length > 0 || (yuzu.yuzuKnownTeammateIds?.length ?? 0) > 0;
}

export function rememberYuzuTeammates(runtime: YuzuRuntime, yuzu: Fighter): string[] {
  ensureYuzuState(yuzu);
  const knownIds = new Set(yuzu.yuzuKnownTeammateIds ?? []);
  currentYuzuTeamMembers(runtime, yuzu).forEach((fighter) => knownIds.add(fighter.id));
  yuzu.yuzuKnownTeammateIds = [...knownIds];
  return yuzu.yuzuKnownTeammateIds;
}

export function activeYuzuFriendlyUnits(runtime: YuzuRuntime, yuzu: Fighter, includeSelf = true): Fighter[] {
  return runtime.fighters.filter((fighter) =>
    (includeSelf || fighter.id !== yuzu.id) &&
    !fighter.isNpc &&
    !fighter.cannotWin &&
    runtime.isActiveCombatant(fighter) &&
    sameTeam(runtime, yuzu, fighter),
  );
}

export function activeYuzuEnemies(runtime: YuzuRuntime, yuzu: Fighter): Fighter[] {
  return runtime.fighters.filter((fighter) =>
    fighter.id !== yuzu.id &&
    runtime.isActiveCombatant(fighter) &&
    !sameTeam(runtime, yuzu, fighter),
  );
}

function isYuzuMarkEligibleTarget(target: Fighter): boolean {
  if (target.isPuruisaishi || target.isOriginiumCore) return false;
  if (target.isNpc && !target.isOriginiumCrystal) return false;
  if (target.cannotWin && !target.isOriginiumCrystal) return false;
  return true;
}

function activeYuzuMarkTargets(runtime: YuzuRuntime, yuzu: Fighter): Fighter[] {
  return activeYuzuEnemies(runtime, yuzu).filter((target) =>
    isYuzuMarkEligibleTarget(target) &&
    isSelectableTargetFor(runtime, yuzu, target),
  );
}

function weightedPickWeapon(pool: YuzuWeapon[]): YuzuWeapon {
  const totalWeight = pool.reduce((sum, weapon) => sum + weapon.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const weapon of pool) {
    roll -= weapon.weight;
    if (roll <= 0) return weapon;
  }
  return pool[pool.length - 1] ?? YUZU_WEAPONS.sword;
}

export function drawYuzuWeapon(hasActiveTeammate: boolean, forcedWeapon?: YuzuWeaponId): YuzuWeapon {
  if (forcedWeapon) return YUZU_WEAPONS[forcedWeapon];
  if (hasActiveTeammate && Math.random() < 0.5) return YUZU_WEAPONS.shield;
  const pool = Object.values(YUZU_WEAPONS).filter((weapon) => weapon.id !== 'shield');
  return weightedPickWeapon(pool);
}

export function grantYuzuShield(target: Fighter, amount: number, sourceId?: string, sourceName?: string): number {
  const gained = Math.max(0, Math.floor(amount));
  if (gained <= 0) return 0;
  const resolvedSourceName = sourceName ?? (sourceId === target.id ? target.name : undefined);
  grantBarrier(target, gained, {
    identityId: YUZU_BARRIER_IDENTITY,
    sourceId: `yuzu:${sourceId ?? target.id}`,
    displayName: '镜界护盾',
    icon: '🛡️',
    tickMode: 'permanent',
    dispelTier: 'none',
    stackMode: 'add',
    attribution: {
      effectSourceId: `yuzu:${sourceId ?? target.id}`,
      effectSourceName: '镜界护盾',
      applierId: sourceId ?? target.id,
      applierName: resolvedSourceName,
      creditActorId: sourceId ?? target.id,
    },
  });
  return gained;
}

export function setYuzuShield(target: Fighter, amount: number, sourceId?: string, sourceName?: string): void {
  removeBarriers(target, { identityIds: [YUZU_BARRIER_IDENTITY] });
  const next = Math.max(0, Math.floor(amount));
  if (next > 0) {
    const resolvedSourceName = sourceName ?? (sourceId === target.id ? target.name : undefined);
    grantBarrier(target, next, {
      identityId: YUZU_BARRIER_IDENTITY,
      sourceId: `yuzu:${sourceId ?? target.id}`,
      displayName: '镜界护盾',
      icon: '🛡️',
      tickMode: 'permanent',
      dispelTier: 'none',
      stackMode: 'overwrite',
      attribution: {
        effectSourceId: `yuzu:${sourceId ?? target.id}`,
        effectSourceName: '镜界护盾',
        applierId: sourceId ?? target.id,
        applierName: resolvedSourceName,
        creditActorId: sourceId ?? target.id,
      },
    });
  }
  if (yuzuBarrierTotal(target) <= 0) clearYuzuShield(target);
}

export function clearYuzuShield(target: Fighter): void {
  removeBarriers(target, { identityIds: [YUZU_BARRIER_IDENTITY] });
}

export function isYuzuBarrier(barrier: NonNullable<Fighter['barriers']>[number]): boolean {
  return barrier.identityId === YUZU_BARRIER_IDENTITY;
}

function yuzuBarrierTotal(target: Fighter): number {
  return getBarrierTotal(target, { identityIds: [YUZU_BARRIER_IDENTITY] });
}

export function consumeYuzuShield(target: Fighter, incomingAmount: number): { absorbed: number; remaining: number; broke: boolean } {
  const incoming = Math.max(0, Math.floor(incomingAmount));
  const shield = yuzuBarrierTotal(target);
  if (shield <= 0 || incoming <= 0) return { absorbed: 0, remaining: incoming, broke: false };
  const result = consumeBarriers(target, incoming, { identityIds: [YUZU_BARRIER_IDENTITY] });
  const remainingShield = yuzuBarrierTotal(target);
  return {
    absorbed: result.absorbed,
    remaining: result.remaining,
    broke: shield > 0 && remainingShield <= 0,
  };
}

export function ensureYuzuState(yuzu: Fighter): void {
  yuzu.yuzuPhase = Math.max(1, yuzu.yuzuPhase ?? 1);
  yuzu.yuzuKnownTeammateIds = [...new Set((yuzu.yuzuKnownTeammateIds ?? []).filter((id) => id && id !== yuzu.id))];
  yuzu.yuzuMarkedHitCount = Math.max(0, yuzu.yuzuMarkedHitCount ?? 0);
  if (yuzu.yuzuFuriosoCountedTurn !== undefined) {
    yuzu.yuzuFuriosoCountedTurn = Math.floor(yuzu.yuzuFuriosoCountedTurn);
  }
  yuzu.yuzuFuriosoReady = !!yuzu.yuzuFuriosoReady;
}

export function ensureYuzuOpeningShield(runtime: YuzuRuntime, yuzu: Fighter): boolean {
  if (!yuzu.isYuzu || yuzu.yuzuOpeningShieldApplied) return false;
  ensureYuzuState(yuzu);
  yuzu.yuzuOpeningShieldApplied = true;

  const targets = activeYuzuFriendlyUnits(runtime, yuzu, true);
  if (targets.length === 0) return false;
  const shield = Math.max(1, Math.floor(yuzu.maxHp * YUZU_OPENING_SHIELD_RATIO));
      targets.forEach((target) => grantYuzuShield(target, shield, yuzu.id, yuzu.name));
  runtime.log('buff', `🪞 【镜界开幕】${yuzu.name} 让镜世界展开，${targets.map((target) => target.name).join('、')} 获得 ${shield} 点镜界护盾。`);
  return true;
}

export function enterYuzuPhaseTwo(runtime: YuzuRuntime, yuzu: Fighter, reason: string): boolean {
  ensureYuzuState(yuzu);
  if (!yuzu.isYuzu || (yuzu.yuzuPhase ?? 1) >= 2 || !runtime.isActiveCombatant(yuzu)) return false;

  let teamMode = false;
  let shield = 0;
  return commitFormTransition({
    fighter: yuzu,
    log: runtime.log,
    message: () => `🪞 【一码归一码】${yuzu.name} ${reason}，进入二阶段：镜界肉体完成重构，生命恢复至 ${yuzu.currentHp}/${yuzu.maxHp}，${teamMode ? '为全体友方' : '为自己'}施加 ${shield} 点镜界护盾。`,
    mutate: () => {
      yuzu.yuzuPhase = 2;
      withPersistentStatusShapesSuspended(yuzu, () => rebuildYuzuPhaseTwoStats(yuzu));
      runtime.syncHpPct?.(yuzu);
      teamMode = activeYuzuTeammates(runtime, yuzu).length > 0;
      const targets = teamMode ? activeYuzuFriendlyUnits(runtime, yuzu, true) : [yuzu];
      const shieldRatio = teamMode ? YUZU_PHASE_TWO_TEAM_SHIELD_RATIO : YUZU_PHASE_TWO_SOLO_SHIELD_RATIO;
      shield = Math.max(1, Math.floor(yuzu.maxHp * shieldRatio));
      targets.forEach((target) => grantYuzuShield(target, shield, yuzu.id, yuzu.name));
    },
  });
}

export function clearYuzuMark(runtime: YuzuRuntime, yuzu: Fighter): void {
  runtime.fighters.forEach((fighter) => {
    removeEffects(fighter, { identityIds: ['YUZU_MARKED'], effectSourceIds: [yuzu.id], reason: 'scripted' });
  });
  yuzu.yuzuMarkedTargetId = undefined;
}

export function enterYuzuPhaseThree(runtime: YuzuRuntime, yuzu: Fighter, reason: string): boolean {
  ensureYuzuState(yuzu);
  if (!yuzu.isYuzu || (yuzu.yuzuPhase ?? 1) >= 3 || !runtime.isActiveCombatant(yuzu)) return false;

  const changed = commitFormTransition({
    fighter: yuzu,
    log: runtime.log,
    message: () => `🪞 【苦痛啊，你是我的唯一】${yuzu.name} ${reason}，进入三阶段：属性再次重构，生命稳定在 ${yuzu.currentHp}/${yuzu.maxHp}，镜界开始定制唯一目标。`,
    mutate: () => {
      yuzu.yuzuPhase = 3;
      withPersistentStatusShapesSuspended(yuzu, () => rebuildYuzuPhaseThreeStats(yuzu));
      yuzu.yuzuMarkedHitCount = 0;
      yuzu.yuzuFuriosoCountedTurn = undefined;
      yuzu.yuzuFuriosoReady = false;
      removeEffects(yuzu, { identityIds: ['YUZU_TAUNT'], reason: 'scripted' });
      runtime.syncHpPct?.(yuzu);
    },
  });
  if (!changed) return false;
  ensureYuzuMarkedTarget(runtime, yuzu);
  return true;
}

export function tryAdvanceYuzuPhaseByHp(runtime: YuzuRuntime, yuzu: Fighter): boolean {
  if (!yuzu.isYuzu || !runtime.isActiveCombatant(yuzu)) return false;
  ensureYuzuState(yuzu);
  if ((yuzu.yuzuPhase ?? 1) === 1 && yuzu.currentHp <= yuzu.maxHp * 0.7) {
    return enterYuzuPhaseTwo(runtime, yuzu, '血量跌破 70%');
  }
  return false;
}

export function tryAdvanceYuzuPhaseByTeamLoss(runtime: YuzuRuntime, yuzu: Fighter): boolean {
  if (!yuzu.isYuzu || !runtime.isActiveCombatant(yuzu)) return false;
  ensureYuzuState(yuzu);
  const phase = yuzu.yuzuPhase ?? 1;
  if (phase >= 3) return false;
  const knownTeammateIds = rememberYuzuTeammates(runtime, yuzu);
  if (knownTeammateIds.length === 0) return false;
  const livingTeammateExists = knownTeammateIds.some((id) => {
    const teammate = runtime.fighters.find((fighter) => fighter.id === id);
    return !!teammate && runtime.isActiveCombatant(teammate);
  });
  if (livingTeammateExists) return false;
  if (phase < 2) {
    const enteredPhaseTwo = enterYuzuPhaseTwo(runtime, yuzu, '队友全部阵亡，镜界被迫提前重构');
    if (!enteredPhaseTwo && (yuzu.yuzuPhase ?? 1) < 2) return false;
  }
  return enterYuzuPhaseThree(runtime, yuzu, '队友全部阵亡');
}

export function ensureYuzuMarkedTarget(runtime: YuzuRuntime, yuzu: Fighter): Fighter | undefined {
  if (!yuzu.isYuzu || (yuzu.yuzuPhase ?? 1) < 3 || !runtime.isActiveCombatant(yuzu)) return undefined;

  const prophet = findActiveYuzuProphet(runtime.fighters, runtime.isActiveCombatant);
  const boundYuzu = prophet ? getYuzuProphetBoundYuzu(runtime.fighters, prophet) : undefined;
  if (
    prophet &&
    boundYuzu?.id === yuzu.id &&
    isSelectableTargetFor(runtime, yuzu, prophet)
  ) {
    if (yuzu.yuzuMarkedTargetId !== prophet.id) {
      clearYuzuMark(runtime, yuzu);
      yuzu.yuzuMarkedTargetId = prophet.id;
      yuzu.yuzuMarkedHitCount = 0;
      yuzu.yuzuFuriosoCountedTurn = undefined;
      runtime.log('debuff', `🎯 【预言家标记覆盖】${prophet.name} 重新成为 ${yuzu.name} 的唯一目标。`, {
        actorId: yuzu.id,
        actorName: yuzu.name,
        targetIds: [prophet.id],
        skillId: 'yuzu_mirror_mark',
        skillName: '镜界标记',
        presentation: 'skill',
      });
    }
    applyStatus(prophet, { identityId: 'YUZU_MARKED', attribution: { effectSourceId: yuzu.id } });
    return prophet;
  }

  const current = yuzu.yuzuMarkedTargetId
    ? runtime.fighters.find((fighter) =>
      fighter.id === yuzu.yuzuMarkedTargetId &&
      runtime.isActiveCombatant(fighter) &&
      isYuzuMarkEligibleTarget(fighter) &&
      isSelectableTargetFor(runtime, yuzu, fighter) &&
      !sameTeam(runtime, yuzu, fighter),
    )
    : undefined;
  if (current) {
    applyStatus(current, { identityId: 'YUZU_MARKED', attribution: { effectSourceId: yuzu.id } });
    return current;
  }

  clearYuzuMark(runtime, yuzu);
  const enemies = activeYuzuMarkTargets(runtime, yuzu);
  const target = enemies[Math.floor(Math.random() * enemies.length)];
  if (!target) return undefined;
  const applyMark = () => {
    yuzu.yuzuMarkedTargetId = target.id;
    applyStatus(target, { identityId: 'YUZU_MARKED', attribution: { effectSourceId: yuzu.id } });
    runtime.log('debuff', `🎯 【镜界标记】${yuzu.name} 将 ${target.name} 定制为唯一目标。`, {
      actorId: yuzu.id,
      actorName: yuzu.name,
      targetIds: [target.id],
      skillId: 'yuzu_mirror_mark',
      skillName: '镜界标记',
      presentation: 'skill',
    });
  };
  if (runtime.runReactionAction) {
    runtime.runReactionAction(yuzu, {
      skillId: 'yuzu_mirror_mark',
      skillName: '镜界标记',
      presentation: 'skill',
      targets: [target],
    }, applyMark);
  } else {
    applyMark();
  }
  return target;
}

export function registerYuzuMarkedSkill(runtime: YuzuRuntime, yuzu: Fighter, target: Fighter): void {
  if (!yuzu.isYuzu || (yuzu.yuzuPhase ?? 1) < 3 || yuzu.yuzuMarkedTargetId !== target.id) return;
  const currentLargeRound = runtime.largeRound ?? runtime.turnCount;
  if (yuzu.yuzuFuriosoCountedTurn === currentLargeRound) return;
  yuzu.yuzuFuriosoCountedTurn = currentLargeRound;
  yuzu.yuzuMarkedHitCount = Math.min(YUZU_FURIOSO_COUNT, (yuzu.yuzuMarkedHitCount ?? 0) + 1);
  if ((yuzu.yuzuMarkedHitCount ?? 0) >= YUZU_FURIOSO_COUNT && !yuzu.yuzuFuriosoReady) {
    yuzu.yuzuFuriosoReady = true;
    runtime.log('buff', `🪞 【Furioso-Replica】${yuzu.name} 已用三阶段技能命中定制目标 ${YUZU_FURIOSO_COUNT} 次，终幕复写准备完成。`);
  }
}

export function applyYuzuWeaponEffects(
  runtime: YuzuRuntime,
  user: Fighter,
  target: Fighter,
  weapon: YuzuWeapon,
  actualDamage: number,
  hitConnected = actualDamage > 0,
): void {
  if (!hitConnected) return;

  const applyHostileStatus = (identityId: string, value: number) => {
    if (!runtime.isActiveCombatant(target)) return false;
    if (runtime.applyStatus) return runtime.applyStatus(target, {
      identityId,
      ...(identityId === 'BLEED' ? { count: value } : { remainingTurns: value }),
      attribution: {
        effectSourceId: user.id,
        applierId: user.id,
        applierName: user.name,
      },
    });
    applyStatus(target, {
      identityId,
      ...(identityId === 'BLEED' ? { count: value } : { remainingTurns: value }),
      attribution: {
        effectSourceId: user.id,
        applierId: user.id,
        applierName: user.name,
      },
    });
    return true;
  };
  const appliedEffects: string[] = [];
  if (weapon.bleedCount && applyHostileStatus('BLEED', weapon.bleedCount)) appliedEffects.push(`${weapon.bleedCount} 次流血`);
  if (weapon.evadeDownTurns && applyHostileStatus('YUZU_EVADE_DOWN', weapon.evadeDownTurns)) appliedEffects.push(`${weapon.evadeDownTurns} 回合闪避破坏`);
  if (weapon.defDownTurns && applyHostileStatus('YUZU_DEF_DOWN', weapon.defDownTurns)) appliedEffects.push(`${weapon.defDownTurns} 回合防御破坏`);

  if (weapon.shieldFromDamageRatio && actualDamage > 0) {
    applyStatus(user, { identityId: 'YUZU_TAUNT', remainingTurns: 2, attribution: { effectSourceId: user.id } });
    const shieldAmount = Math.max(1, Math.floor(actualDamage * weapon.shieldFromDamageRatio));
    const targets = activeYuzuFriendlyUnits(runtime, user, true);
    targets.forEach((ally) => grantYuzuShield(ally, shieldAmount, user.id, user.name));
    runtime.log('buff', `🛡️ 【盾牌】${user.name} 把 ${actualDamage} 点命中伤害折成镜界护盾，${targets.map((ally) => ally.name).join('、')} 获得 ${shieldAmount} 点护盾，并把嘲讽拉满。`);
  }

  if (appliedEffects.length > 0) {
    runtime.log('debuff', `🪞 【${weapon.name}】${target.name} 被附加${appliedEffects.join('、')}。`);
  }
}

export function yuzuWeaponSummary(weapon: YuzuWeapon): string {
  const pct = Math.round((weapon.attackMultiplier - 1) * 100);
  return pct >= 0 ? `${weapon.name}（武器倍率+${pct}%）` : `${weapon.name}（武器倍率${pct}%）`;
}
