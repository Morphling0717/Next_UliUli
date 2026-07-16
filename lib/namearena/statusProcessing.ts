import type { DamageApplicationOptions, DefeatOptions, Fighter, SpinalSwordRef, StatusEffectsMap, StatusEntry } from './types';
import { healFighter } from './combatState';
import {
  ACTION_BLOCKING_STATUS_TYPES,
  BKB_BLOCKED_STATUS_TYPES,
  CONTROL_STATUS_TYPES,
  DOT_STATUS_TYPES,
  WT_REPAIRING_PROFILE,
  isStatusType,
} from './statusRules';
import {
  findDefenseStatus,
  formatControlCleanse,
} from './defenseStatus';
import {
  addTokusatsuThroneResonance,
  canUseTokusatsuThrone,
  enterTokusatsuThroneStance,
  getTokusatsuControlThroneChance,
  TOKUSATSU_THRONE_RESONANCE_MAX,
} from './tokusatsuMechanics';
import {
  createLifecycleStatus,
  normalizeStatusEntry,
  tickStatusTurn,
} from './statusLifecycle';
import { cleanupOrphanedTimedStatModifiers, withTimedStatModifiersSuspended } from './statModifiers';

const SINGLE_INSTANCE_STATUS_TYPES = ['BURN', 'POISON', 'BLEED', 'CHARMED', 'OWL_EVADE_DOWN'] as const;

export interface StatusProcessingRuntime {
  fighters: Fighter[];
  statusEffects: StatusEffectsMap;
  turnCount: number;
  log: (type: string, text: string) => void;
  applyDamage: (
    target: Fighter,
    amount: number,
    source: string,
    isTrueDamage?: boolean,
    attacker?: Fighter,
    options?: DamageApplicationOptions,
  ) => number;
  markDefeated: (target: Fighter, options?: DefeatOptions) => boolean;
  flushDeferredDamageEvents: (fighter: Fighter, phase?: 'mitigation' | 'all') => void;
  syncHpPct: (fighter: Fighter) => void;
  isActiveCombatant: (fighter: Fighter) => boolean;
}

export interface StatusTurnResult {
  canAct: boolean;
  confused: boolean;
  embarrassed: boolean;
  blockingStatusType?: string;
  pendingAirborneLanding?: StatusEntry;
  pendingActionBlockExpiry?: StatusEntry;
}

export interface StatusTurnOptions {
  deferAirborneLanding?: boolean;
  deferActionBlockExpiry?: boolean;
}

function findStatusApplier(runtime: StatusProcessingRuntime, status: StatusEntry): Fighter | undefined {
  return status.applierId
    ? runtime.fighters.find((fighter) => fighter.id === status.applierId)
    : undefined;
}

function normalizeLegacyAirborne(actor: Fighter): void {
  const entries = actor.status.filter((status) => status.type === 'AIRBORNE' || status.type === 'WT_AIRBORNE');
  if (entries.length === 0) return;

  const hadLegacyAirborne = entries.some((status) => status.type === 'WT_AIRBORNE');
  const primary = entries[0];
  primary.type = 'AIRBORNE';
  primary.duration = 1;
  primary.remainingTurns = 1;
  primary.tickMode = 'self';
  primary.expiresOn = 'self_turn_end';
  if (hadLegacyAirborne) {
    primary.sourceId = primary.sourceId ?? 'war_thunder_airborne';
  }
  for (const duplicate of entries.slice(1)) {
    if (duplicate.applierId) {
      primary.applierId = duplicate.applierId;
      primary.applierName = duplicate.applierName;
    }
  }
  actor.status = actor.status.filter((status) => !entries.includes(status) || status === primary);
}

function normalizeSingleInstanceStatuses(actor: Fighter): void {
  for (const type of SINGLE_INSTANCE_STATUS_TYPES) {
    const entries = actor.status.filter((status) => status.type === type);
    if (entries.length <= 1) continue;
    const primary = entries[entries.length - 1];
    const rawLongest = Math.max(...entries.map((status) => status.remainingTurns ?? status.duration));
    const longest = type === 'OWL_EVADE_DOWN' ? Math.min(2, rawLongest) : rawLongest;
    primary.duration = longest;
    primary.remainingTurns = longest;
    if (type === 'POISON') {
      primary.stacks = Math.min(3, entries.reduce((sum, status) => sum + Math.max(1, status.stacks ?? 1), 0));
    }
    actor.status = actor.status.filter((status) => !entries.includes(status) || status === primary);
  }
}

function removeExpiredCharmSource(runtime: StatusProcessingRuntime, actor: Fighter): void {
  const staleCharms = actor.status.filter((status) => {
    if (status.type !== 'CHARMED' || !status.applierId) return false;
    const source = findStatusApplier(runtime, status);
    return !source || !runtime.isActiveCombatant(source) || source.status.some((entry) => entry.type === 'SYNERGY_SLACKING');
  });
  if (staleCharms.length === 0) return;
  actor.status = actor.status.filter((status) => !staleCharms.includes(status));
  staleCharms.forEach((status) => {
    runtime.log('info', `💔 【魅惑解除】${status.applierName ?? '魅惑来源'} 已经离开战场，${actor.name} 恢复了清醒！`);
  });
}

export function handleSelfTimedStatusExpiry(
  runtime: StatusProcessingRuntime,
  actor: Fighter,
  type: string,
  expiredStatus?: StatusEntry,
): void {
  if (type === 'WT_REPAIRING') {
    runtime.log('info', `🔧 【抢修完成】${actor.name} 接好履带、修复炮闩，重新恢复机动！`);
    return;
  }
  if (type === 'AIRBORNE' || type === 'WT_AIRBORNE') {
    resolveAirborneLanding(runtime, actor, expiredStatus ?? { type, duration: 0 });
    return;
  }
  if (type !== 'ZEROED') return;
  if (actor.baseStatsForZero) {
    const legacyBase = actor.baseStatsForZero;
    withTimedStatModifiersSuspended(actor, () => {
      actor.atk = legacyBase.atk;
      actor.def = legacyBase.def;
      actor.res = legacyBase.res;
    });
  }
  delete actor.baseStatsForZero;
  actor.wasZeroed = false;
  runtime.log('info', `🧮 ${actor.name} 的【归零】状态结束，被降维的属性恢复了！`);
}

export function resolveAirborneLanding(
  runtime: StatusProcessingRuntime,
  actor: Fighter,
  status: StatusEntry,
): void {
  const applier = findStatusApplier(runtime, status);
  const damage = Math.max(1, Math.floor(actor.maxHp * 0.03));
  const damageOptions: DamageApplicationOptions = {
    deferTransform: true,
    actionName: '击飞坠地',
  };
  const actualDamage = runtime.applyDamage(actor, damage, 'status', false, applier, damageOptions);
  const isWarThunder = !!applier?.isWT || status.sourceId === 'war_thunder_airborne';
  runtime.flushDeferredDamageEvents(actor, 'mitigation');
  runtime.log(
    actualDamage > 0 ? 'poison' : 'info',
    isWarThunder
      ? `🚀 【炮震坠落】${actor.name} 从大口径冲击中重重落地，实际损失 ${actualDamage} 点生命！`
      : `🚀 【击飞坠地】${actor.name} 重重砸回战场，实际损失 ${actualDamage} 点生命！`,
  );
  if (actualDamage > 0 || (actor.pendingDamageEvents?.length ?? 0) > 0) {
    runtime.flushDeferredDamageEvents(actor);
  }
  if (actor.currentHp <= 0) {
    runtime.markDefeated(actor, {
      message: `💀 ${actor.name} 因击飞坠地的冲击倒下了！`,
      killer: applier,
      awardKill: !!applier,
    });
  }
}

function handleGlobalTimedStatusExpiry(
  log: StatusProcessingRuntime['log'] | undefined,
  fighter: Fighter,
  type: string,
): void {
  if (!log) return;
  if (type === 'TING_DEFIANCE') {
    log('info', `🩸 ${fighter.name} 的【不甘倒下】怨念耗尽，下一次致命伤将无法再被压回！`);
  } else if (type === 'TOKUSATSU_DEFIANCE') {
    log('info', `🔥 ${fighter.name} 的【悲愿不倒】奇迹余火熄灭，后续致命伤不会再被强行改写！`);
  }
}

export function advanceGlobalTimedStatuses(
  fighters: Fighter[],
  turnCount: number,
  log?: StatusProcessingRuntime['log'],
): void {
  fighters.forEach((fighter) => {
    if (fighter.isDead) return;

    fighter.status = fighter.status.flatMap((status) => {
      normalizeStatusEntry(status);
      if (status.expiresOn !== 'global_action_end' || status.duration >= 999) {
        return [status];
      }

      const appliedTurn = status.appliedTurn ?? turnCount;
      if (appliedTurn >= turnCount) {
        return [{ ...status, appliedTurn }];
      }

      if (!tickStatusTurn(status)) return [{ ...status, appliedTurn }];
      handleGlobalTimedStatusExpiry(log, fighter, status.type);
      return [];
    });
    cleanupOrphanedTimedStatModifiers(fighter);
  });
}

function tryTokusatsuControlThrone(runtime: StatusProcessingRuntime, actor: Fighter): boolean {
  if (!canUseTokusatsuThrone(actor)) return false;
  const hadControl = actor.status.some((status) => isStatusType(status.type, CONTROL_STATUS_TYPES));
  if (!hadControl) return false;

  const resonance = addTokusatsuThroneResonance(actor, 1);
  if (Math.random() >= getTokusatsuControlThroneChance(actor)) return false;

  actor.status = actor.status.filter((status) => !isStatusType(status.type, BKB_BLOCKED_STATUS_TYPES));
  enterTokusatsuThroneStance(actor, 2, 2);
  runtime.log('buff', `🪑 【悲愿共鸣】${actor.name} 被控制逼到极限，王座共鸣升至 ${resonance}/${TOKUSATSU_THRONE_RESONANCE_MAX}，强行坐上【武神王座】等待反击！`);
  return true;
}

export function processStatusTurn(
  runtime: StatusProcessingRuntime,
  actor: Fighter,
  options: StatusTurnOptions = {},
): StatusTurnResult {
  normalizeLegacyAirborne(actor);
  normalizeSingleInstanceStatuses(actor);
  removeExpiredCharmSource(runtime, actor);

  if (!actor.status.some((status) => status.type === 'SYNERGY_SLACKING')) {
    const controlImmune = findDefenseStatus(actor, 'BKB');
    const hadBkbBlocked = actor.status.some((status) => isStatusType(status.type, BKB_BLOCKED_STATUS_TYPES));
    if (controlImmune && hadBkbBlocked) {
      actor.status = actor.status.filter((status) => !isStatusType(status.type, BKB_BLOCKED_STATUS_TYPES));
      runtime.log('info', formatControlCleanse(controlImmune, actor.name));
    }

    const hadFoolControl = actor.status.some((status) => isStatusType(status.type, CONTROL_STATUS_TYPES));
    if (actor.status.some((status) => status.type === 'STYLE_FOOL') && hadFoolControl) {
      actor.status = actor.status.filter((status) => !isStatusType(status.type, CONTROL_STATUS_TYPES));
      runtime.log('info', `🤪 ${actor.name} 笨蛋女人的混沌之力让她对控制免疫，懵懵懂懂地无视了异常状态！`);
    }

    const hadGachaControl = actor.status.some((status) => isStatusType(status.type, CONTROL_STATUS_TYPES));
    if (actor.jobData?.name === '欧皇' && hadGachaControl && Math.random() < 0.8) {
      actor.status = actor.status.filter((status) => !isStatusType(status.type, CONTROL_STATUS_TYPES));
      runtime.log('buff', `👑 ${actor.name} 发动了钞能力！解除了控制状态！`);
    }
    tryTokusatsuControlThrone(runtime, actor);
  }

  const blockingStatus = actor.status.find((status) => status.type === 'AIRBORNE' || status.type === 'WT_AIRBORNE') ??
    actor.status.find((status) => isStatusType(status.type, ACTION_BLOCKING_STATUS_TYPES));
  let blockedByControl = !!blockingStatus;
  let confused = actor.status.some((status) => status.type === 'CONFUSED');
  let embarrassed = actor.status.some((status) => status.type === 'EMBARRASSED');
  const controlStatusesAtTurnStart = actor.status.filter((status) => isStatusType(status.type, CONTROL_STATUS_TYPES));
  const blockedByCharacterState = actor.status.some((status) =>
    status.type === 'OWL_FORM_DEFEAT' ||
    status.type === 'OWL_ENJOYING' ||
    status.type === 'OWL_SPALTER_DOLL',
  );
  const nextStatusEntries: Array<{ original: StatusEntry; next: StatusEntry }> = [];
  const processedStatuses = new Set(actor.status);
  const statusesToProcess = [...actor.status];
  const isSlacking = actor.status.some((status) => status.type === 'SYNERGY_SLACKING');
  let pendingAirborneLanding: StatusEntry | undefined;
  let pendingActionBlockExpiry: StatusEntry | undefined;

  for (const status of statusesToProcess) {
    if (actor.currentHp <= 0 || actor.isDead || actor.isDeadAnnounced) break;

    if (!isSlacking && isStatusType(status.type, DOT_STATUS_TYPES)) {
      const poisonStacks = Math.max(1, Math.min(3, status.stacks ?? 1));
      const damagePct = status.type === 'WATER_PRISON'
        ? 0.08
        : status.type === 'BURN'
          ? 0.05
          : status.type === 'BLEED'
            ? 0.04
            : [0.04, 0.05, 0.06][poisonStacks - 1] ?? 0.04;
      const dmgAmt = Math.max(1, Math.floor(actor.maxHp * damagePct));
      const statusInfo = runtime.statusEffects[status.type];
      const statusCause = status.type === 'WATER_PRISON' ? '深渊水牢窒息' : (statusInfo?.name ?? '持续伤害');
      const actionText = status.type === 'WATER_PRISON'
        ? '在深渊水牢中窒息'
        : status.type === 'BLEED'
          ? '血流不止'
          : '受到持续伤害';
      const damageOptions: DamageApplicationOptions = {
        deferTransform: true,
        actionName: statusCause,
      };
      const applier = findStatusApplier(runtime, status);
      const actualDmg = runtime.applyDamage(actor, dmgAmt, 'status', true, applier, damageOptions);
      runtime.flushDeferredDamageEvents(actor, 'mitigation');
      if (actualDmg > 0) {
        const stackText = status.type === 'POISON' ? `（${poisonStacks} 层）` : '';
        runtime.log('poison', `${statusInfo?.icon ?? ''} ${actor.name} ${actionText}${stackText}，实际损失 ${actualDmg} 点生命！`);
      } else {
        runtime.log('info', `${statusInfo?.icon ?? ''} ${actor.name} 的【${statusInfo?.name ?? status.type}】本次没有穿透防护，生命未减少。`);
      }
      if (actualDmg > 0 || (actor.pendingDamageEvents?.length ?? 0) > 0) {
        runtime.flushDeferredDamageEvents(actor);
      }
      if (actor.currentHp <= 0) {
        runtime.markDefeated(actor, {
          message: `💀 ${actor.name} 因${statusCause}（${actualDmg}点）倒下了！`,
          killer: applier,
          awardKill: !!applier,
        });
        if (!runtime.isActiveCombatant(actor)) {
          blockedByControl = true;
          break;
        }
      }
    }
    const canAutoRecover =
      status.type === 'REGEN' ||
      status.type === 'WT_REPAIRING' ||
      status.type === 'STYLE_FAMILY' ||
      (status.type === 'PLUG_HEART' && !!actor.isSuccubus && !!actor.transformed);
    if (!isSlacking && canAutoRecover && actor.currentHp < actor.maxHp) {
      if (actor.status.some((candidate) => candidate.type === 'NO_HEAL')) {
        runtime.log('info', status.type === 'WT_REPAIRING'
          ? `🥀 【抢修受阻】${actor.name} 处于禁疗状态，本次维修无法恢复生命！`
          : `🥀 ${actor.name} 处于禁疗状态，无法自动回复生命！`);
      } else {
        const healPct = status.type === 'WT_REPAIRING' ? WT_REPAIRING_PROFILE.healPerTurnPct : 0.05;
        const heal = Math.floor(actor.maxHp * healPct);
        const healed = healFighter(actor, heal, runtime.log);
        if (healed > 0) {
          runtime.log('heal', status.type === 'WT_REPAIRING'
            ? `🔧 【抢修进度】${actor.name} 趁停车维修恢复了 ${healed} 点生命！`
            : `${runtime.statusEffects[status.type]?.icon ?? ''} ${actor.name} 自动回复了 ${healed} 点生命`);
        }
      }
    }
    normalizeStatusEntry(status);
    const statusStillPresent = actor.status.includes(status);
    if (!statusStillPresent) {
      continue;
    }
    if (status.expiresOn !== 'self_turn_end') {
      nextStatusEntries.push({ original: status, next: status });
    } else if (!tickStatusTurn(status)) {
      nextStatusEntries.push({ original: status, next: { ...status } });
    } else if (status.type === 'AIRBORNE' && options.deferAirborneLanding) {
      pendingAirborneLanding = { ...status };
    } else if (
      status.type === 'WT_REPAIRING' &&
      options.deferActionBlockExpiry
    ) {
      pendingActionBlockExpiry = { ...status };
    } else {
      handleSelfTimedStatusExpiry(runtime, actor, status.type, status);
    }
  }
  const controlPurgedDuringProcessing = controlStatusesAtTurnStart.some((status) => !actor.status.includes(status));
  const statusesAddedDuringProcessing = actor.status.filter((status) => !processedStatuses.has(status));
  actor.status = [
    ...nextStatusEntries
      .filter(({ original }) => actor.status.includes(original))
      .map(({ next }) => next),
    ...statusesAddedDuringProcessing,
  ];
  cleanupOrphanedTimedStatModifiers(actor);
  syncSpinalSwordState(runtime, actor, true);

  if (controlPurgedDuringProcessing) {
    blockedByControl = false;
    confused = false;
    embarrassed = false;
    pendingAirborneLanding = undefined;
    pendingActionBlockExpiry = undefined;
  }

  if (actor.status.some((status) => status.type === 'SYNERGY_SLACKING')) {
    return {
      canAct: false,
      confused: false,
      embarrassed: false,
      blockingStatusType: 'SYNERGY_SLACKING',
      pendingAirborneLanding,
      pendingActionBlockExpiry,
    };
  }
  return {
    canAct: actor.currentHp > 0 && !actor.isDead && !actor.isDeadAnnounced && !blockedByControl && !blockedByCharacterState,
    confused,
    embarrassed,
    blockingStatusType: blockingStatus?.type,
    pendingAirborneLanding,
    pendingActionBlockExpiry,
  };
}

export function processStatus(runtime: StatusProcessingRuntime, actor: Fighter): boolean {
  return processStatusTurn(runtime, actor).canAct;
}

export function handleSpinalSwordDrop(
  runtime: Pick<StatusProcessingRuntime, 'log'>,
  actor: Fighter,
  spinalSwordRef: SpinalSwordRef,
): void {
  syncSpinalSwordState(runtime, actor);
  if (
    spinalSwordRef.current &&
    !actor.isTing &&
    !actor.isSummon &&
    !actor.hasSpinalSword &&
    !actor.status.some((status) => status.type === 'SYNERGY_SLACKING')
  ) {
    if (Math.random() < (actor.isGacha ? 0.8 : 0.2)) {
      actor.hasSpinalSword = true;
      actor.spinalSwordTurns = Math.floor(Math.random() * 3) + 3;
      actor.status.push(createLifecycleStatus('SPINAL_SWORD', actor.spinalSwordTurns));
      spinalSwordRef.current = false;
      runtime.log('buff', `🦴 ${actor.name} 捡起了小汀留下的脊髓剑！攻击力暴增！`);
      if (!actor.jobData?.skills?.includes('summon_puppet_ting')) {
        actor.jobData?.skills?.push('summon_puppet_ting');
      }
    }
  }
  syncSpinalSwordState(runtime, actor, true);
}

export function clearSpinalSword(
  runtime: Pick<StatusProcessingRuntime, 'log'>,
  actor: Fighter,
  logWhenActive = false,
): void {
  const hadActiveSword = !!actor.hasSpinalSword || actor.status.some((status) => status.type === 'SPINAL_SWORD');
  actor.hasSpinalSword = false;
  actor.spinalSwordTurns = 0;
  actor.status = actor.status.filter((status) => status.type !== 'SPINAL_SWORD');
  if (!actor.isTing) {
    actor.jobData.skills = (actor.jobData.skills ?? []).filter((skillId) => skillId !== 'summon_puppet_ting');
  }
  if (logWhenActive && hadActiveSword) {
    runtime.log('info', `🦴 ${actor.name} 手中的脊髓剑碎裂了...`);
  }
}

export function syncSpinalSwordState(
  runtime: Pick<StatusProcessingRuntime, 'log'>,
  actor: Fighter,
  logWhenExpired = false,
): void {
  const hasStatus = actor.status.some((status) => status.type === 'SPINAL_SWORD');
  if (actor.hasSpinalSword && !hasStatus) {
    clearSpinalSword(runtime, actor, logWhenExpired);
  } else if (!actor.hasSpinalSword && !actor.isTing && actor.jobData?.skills?.includes('summon_puppet_ting')) {
    actor.jobData.skills = actor.jobData.skills.filter((skillId) => skillId !== 'summon_puppet_ting');
  }
}

export function syncPuppetMasterStatus(runtime: StatusProcessingRuntime, actor: Fighter): void {
  const hasPuppet = runtime.fighters.some((fighter) =>
    fighter.isSummon &&
    fighter.summonerId === actor.id &&
    (fighter.summonBaseName ?? fighter.name) === '小汀(傀儡)' &&
    runtime.isActiveCombatant(fighter),
  );
  const hasStatus = actor.status.some((status) => status.type === 'PUPPET_MASTER');
  if (hasPuppet && !hasStatus) {
    actor.status.push(createLifecycleStatus('PUPPET_MASTER', 999));
  } else if (!hasPuppet && hasStatus) {
    actor.status = actor.status.filter((status) => status.type !== 'PUPPET_MASTER');
  }
}
