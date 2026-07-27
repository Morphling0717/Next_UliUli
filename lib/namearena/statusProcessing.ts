import type {
  BarrierEntry,
  DamageApplicationOptions,
  DefeatOptions,
  DispelOptions,
  DispelResolution,
  Fighter,
  SpinalSwordRef,
  StatusInstance,
} from './types';
import { healFighter } from './combatState';
import { didDamageConnect } from './damageRedirects';
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
  advanceEffects,
  applyStatus,
  findMechanic,
  hasIdentity,
  hasMechanic,
  removeEffects,
} from './statusSystem';
import {
  buildBarrierPresentationItem,
  buildStatusPresentationMember,
  statusPresentationGroupKey,
} from './statusPresentation';
import {
  getStatusIdentityIdsByTag,
  getStatusMechanicDefinition,
  getStatusMechanicId,
  statusHasTag,
} from './statusRegistry';
import { WT_REPAIRING_PROFILE } from './statusMechanics';

export interface StatusProcessingRuntime {
  fighters: Fighter[];
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
  dispelStatusEffects: (target: Fighter, options: DispelOptions) => DispelResolution;
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
  /** Statuses that existed when this opportunity began and tick after it ends. */
  selfOpportunityStatuses: StatusInstance[];
  /** Timed barriers that existed when this opportunity began. */
  selfOpportunityBarriers: BarrierEntry[];
  selfOpportunityStatusVersions: Record<string, number>;
  selfOpportunityBarrierVersions: Record<string, number>;
}

export interface StatusTurnOptions {
  /** Battle steps defer expiry until the action or skipped opportunity is logged. */
  deferSelfOpportunitySettlement?: boolean;
}

function findStatusApplier(runtime: StatusProcessingRuntime, status: StatusInstance): Fighter | undefined {
  const applierId = status.attribution.creditActorId ?? status.attribution.applierId;
  return applierId
    ? runtime.fighters.find((fighter) => fighter.id === applierId)
    : undefined;
}

const STATUS_SETTLEMENT_ORDER = new Map<string, number>([
  ['POISON', 0],
  ['BURN', 1],
  ['BLEED', 2],
  ['WATER_PRISON', 3],
  ['REGEN', 10],
  ['WT_REPAIRING', 11],
  ['STYLE_FAMILY', 12],
  ['PLUG_HEART', 13],
]);

function statusSettlementPriority(status: StatusInstance): number {
  return STATUS_SETTLEMENT_ORDER.get(status.identityId) ?? 100;
}

function removeExpiredCharmSource(runtime: StatusProcessingRuntime, actor: Fighter): void {
  const staleCharms = actor.statuses.filter((status) => {
    if (status.identityId !== 'CHARMED' || !status.attribution.applierId) return false;
    const source = findStatusApplier(runtime, status);
    return !source || !runtime.isActiveCombatant(source) || hasIdentity(source, 'SYNERGY_SLACKING');
  });
  if (staleCharms.length === 0) return;
  staleCharms.forEach((status) => removeEffects(actor, { instanceIds: [status.instanceId], reason: 'scripted' }).length > 0);
  staleCharms.forEach((status) => {
    runtime.log('info', `💔 【魅惑解除】${status.attribution.applierName ?? '魅惑来源'} 已经离开战场，${actor.name} 恢复了清醒！`);
  });
}

function statusMechanicChangeLabel(status: StatusInstance): string {
  if (status.identityId === 'WAIT_COUNTER') return '等待反击';
  return getStatusMechanicDefinition(getStatusMechanicId(status)).displayName;
}

function logNaturalStatusExpiryGroup(
  log: StatusProcessingRuntime['log'],
  fighter: Fighter,
  expiredStatuses: readonly StatusInstance[],
): void {
  const slackingTheme = expiredStatuses.find((status) =>
    status.identityId === 'SYNERGY_SLACKING' &&
    (status.groupId === 'slacking_off_field' || status.attribution.effectSourceId === 'slacking_off_field'),
  );
  if (slackingTheme) {
    log('info', `⛺ 【状态结束】${fighter.name} 的【场外OB】自然结束。`);
    return;
  }
  const status = [...expiredStatuses].sort((a, b) => b.appliedSequence - a.appliedSequence)[0];
  if (!status) return;
  const presentation = buildStatusPresentationMember(status);
  if (status.groupId === 'slacking_off_field' || status.attribution.effectSourceId === 'slacking_off_field') {
    return;
  }
  const groupKey = statusPresentationGroupKey(status);
  const remainingGroup = fighter.statuses.filter((entry) => statusPresentationGroupKey(entry) === groupKey);
  if (remainingGroup.length === 0) {
    log('info', `${presentation.icon} 【状态结束】${fighter.name} 的【${presentation.name}】自然结束。`);
    return;
  }

  const allMechanics = new Set([
    ...expiredStatuses.map((entry) => getStatusMechanicId(entry)),
    ...remainingGroup.map((entry) => getStatusMechanicId(entry)),
  ]);
  if (allMechanics.size > 1) {
    const expiredComponents = [...new Set(expiredStatuses.map((entry) =>
      statusMechanicChangeLabel(entry),
    ))];
    const activeComponents = [...new Set(remainingGroup.map((entry) =>
      statusMechanicChangeLabel(entry),
    ))];
    log(
      'info',
      `${presentation.icon} 【状态变化】${fighter.name} 的【${presentation.name}】失去【${expiredComponents.join('】、【')}】效果；【${activeComponents.join('】、【')}】仍在生效。`,
    );
    return;
  }

  const sourceName = status.attribution.applierName;
  const sourceText = sourceName ? `来自 ${sourceName} 的一份` : '其中一份';
  log(
    'info',
    `${presentation.icon} 【状态变化】${fighter.name} 的【${presentation.name}】${sourceText}效果自然结束；仍有其他来源维持。`,
  );
}

function groupExpiredStatuses(statuses: readonly StatusInstance[]): StatusInstance[][] {
  const groups = new Map<string, StatusInstance[]>();
  statuses.forEach((status) => {
    const key = statusPresentationGroupKey(status);
    const group = groups.get(key) ?? [];
    group.push(status);
    groups.set(key, group);
  });
  return [...groups.values()];
}

function handleSelfTimedStatusExpiryGroup(
  runtime: StatusProcessingRuntime,
  actor: Fighter,
  expiredStatuses: readonly StatusInstance[],
): void {
  const status = expiredStatuses[0];
  if (!status) return;
  const type = status.identityId;
  if (type === 'WT_REPAIRING') {
    runtime.log('info', `🔧 【抢修完成】${actor.name} 接好履带、修复炮闩，重新恢复机动！`);
    return;
  }
  if (type === 'AIRBORNE') {
    resolveAirborneLanding(runtime, actor, status);
    return;
  }
  if (type === 'ZEROED') {
    runtime.log('info', `🧮 ${actor.name} 的【归零】状态结束，被降维的属性恢复了！`);
    return;
  }
  if (status.mechanicId === 'CHARGE' && !hasMechanic(actor, 'CHARGE')) {
    const presentation = buildStatusPresentationMember(status);
    runtime.log('info', `${presentation.icon} 【资源耗尽】${actor.name} 的【${presentation.name}】归零并移除。`);
    return;
  }
  if (status.mechanicId === 'TREMOR' && !hasMechanic(actor, 'TREMOR')) {
    const presentation = buildStatusPresentationMember(status);
    runtime.log('info', `${presentation.icon} 【状态结束】${actor.name} 的【${presentation.name}】次数自然衰减至零。`);
    return;
  }
  if (status.mechanicId === 'STAGGERED' && !hasMechanic(actor, 'STAGGERED')) {
    const presentation = buildStatusPresentationMember(status);
    runtime.log('info', `${presentation.icon} 【状态结束】${actor.name} 稳住身形，【${presentation.name}】在本次行动机会后解除。`);
    return;
  }
  logNaturalStatusExpiryGroup(runtime.log, actor, expiredStatuses);
}

export function handleSelfTimedStatusExpiry(
  runtime: StatusProcessingRuntime,
  actor: Fighter,
  expiredStatus: StatusInstance,
): void {
  handleSelfTimedStatusExpiryGroup(runtime, actor, [expiredStatus]);
}

export function resolveAirborneLanding(
  runtime: StatusProcessingRuntime,
  actor: Fighter,
  status: StatusInstance,
): void {
  const applier = findStatusApplier(runtime, status);
  const damage = Math.max(1, Math.floor(actor.maxHp * 0.03));
  const damageOptions: DamageApplicationOptions = {
    deferTransform: true,
    actionName: '击飞坠地',
  };
  const actualDamage = runtime.applyDamage(actor, damage, 'status', false, applier, damageOptions);
  const connected = didDamageConnect(actualDamage, damageOptions);
  const isWarThunder = !!applier?.isWT || status.attribution.effectSourceId === 'war_thunder_airborne';
  runtime.flushDeferredDamageEvents(actor, 'mitigation');
  runtime.log(
    connected ? 'poison' : 'info',
    actualDamage > 0
      ? isWarThunder
        ? `🚀 【炮震坠落】${actor.name} 从大口径冲击中重重落地，实际损失 ${actualDamage} 点生命！`
        : `🚀 【击飞坠地】${actor.name} 重重砸回战场，实际损失 ${actualDamage} 点生命！`
      : connected
        ? isWarThunder
          ? `🚀 【炮震坠落】${actor.name} 重重落地并承受冲击；但【黄昏余命】期间未再损失生命！`
          : `🚀 【击飞坠地】${actor.name} 重重砸回战场；但【黄昏余命】期间未再损失生命！`
      : isWarThunder
        ? `🚀 【炮震坠落】${actor.name} 完成落地，但防护吸收了全部冲击，未损失生命！`
        : `🚀 【击飞坠地】${actor.name} 砸回战场，但落地冲击被全部化解，未损失生命！`,
  );
  if (connected || (actor.pendingDamageEvents?.length ?? 0) > 0) {
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
  statuses: readonly StatusInstance[],
): void {
  if (!log) return;
  const status = statuses[0];
  if (!status) return;
  const type = status.identityId;
  if (type === 'TING_DEFIANCE') {
    log('info', `🩸 ${fighter.name} 的【不甘倒下】怨念耗尽，下一次致命伤将无法再被压回！`);
  } else if (type === 'TOKUSATSU_DEFIANCE') {
    log('info', `🔥 ${fighter.name} 的【悲愿不倒】奇迹余火熄灭，后续致命伤不会再被强行改写！`);
  } else {
    logNaturalStatusExpiryGroup(log, fighter, statuses);
  }
}

export function advanceGlobalTimedStatuses(
  fighters: Fighter[],
  turnCount: number,
  output?: StatusProcessingRuntime['log'] | StatusProcessingRuntime,
): void {
  const runtime = typeof output === 'function' ? undefined : output;
  const log = typeof output === 'function' ? output : output?.log;
  fighters.forEach((fighter) => {
    if (fighter.isDead) return;
    const { expiredStatuses, expiredBarriers } = advanceEffects(fighter, {
      tickMode: 'global_action',
      clock: turnCount,
    });
    for (const statuses of groupExpiredStatuses(expiredStatuses)) {
      const status = statuses[0];
      if (!status) continue;
      if (
        runtime &&
        status.mechanicId === 'AIRBORNE'
      ) {
        resolveAirborneLanding(runtime, fighter, status);
      } else {
        handleGlobalTimedStatusExpiry(log, fighter, statuses);
      }
    }
    expiredBarriers.forEach((barrier) => logBarrierExpiry(log, fighter, barrier));
  });
}

export function advanceLargeRoundTimedBarriers(
  fighters: Fighter[],
  completedRound: number,
  log?: StatusProcessingRuntime['log'],
): void {
  fighters.forEach((fighter) => {
    if (fighter.isDead || hasIdentity(fighter, 'SYNERGY_SLACKING')) return;
    const { expiredBarriers } = advanceEffects(fighter, {
      tickMode: 'large_round',
      clock: completedRound,
      includeStatuses: false,
    });
    expiredBarriers.forEach((barrier) => logBarrierExpiry(log, fighter, barrier));
  });
}

function logBarrierExpiry(
  log: StatusProcessingRuntime['log'] | undefined,
  fighter: Fighter,
  barrier: BarrierEntry,
): void {
  if (!log) return;
  const presentation = buildBarrierPresentationItem(barrier);
  log('info', `${presentation.icon} 【屏障结束】${fighter.name} 的【${presentation.name}】自然消散。`);
}

function tryTokusatsuControlThrone(runtime: StatusProcessingRuntime, actor: Fighter): boolean {
  if (!canUseTokusatsuThrone(actor)) return false;
  const hadControl = actor.statuses.some((status) => statusHasTag(status, 'control'));
  if (!hadControl) return false;

  const resonance = addTokusatsuThroneResonance(actor, 1);
  if (Math.random() >= getTokusatsuControlThroneChance(actor)) return false;

  runtime.log('buff', `🪑 【悲愿共鸣·武神王座】${actor.name} 被控制逼到极限，王座回应了 ${resonance}/${TOKUSATSU_THRONE_RESONANCE_MAX} 层共鸣！`);
  runtime.dispelStatusEffects(actor, {
    strength: 'strong',
    direction: 'negative',
    identityIds: getStatusIdentityIdsByTag('spell_immunity_blocked'),
  });
  enterTokusatsuThroneStance(actor, 2, 2);
  runtime.log('buff', `🪑 【武神王座】${actor.name} 已经挣脱控制并坐上王座，开始等待反击！`);
  return true;
}

export function processStatusTurn(
  runtime: StatusProcessingRuntime,
  actor: Fighter,
  _options: StatusTurnOptions = {},
): StatusTurnResult {
  void _options;
  removeExpiredCharmSource(runtime, actor);

  if (!hasIdentity(actor, 'SYNERGY_SLACKING')) {
    const controlImmune = findDefenseStatus(actor, 'BKB');
    const hadBkbBlocked = actor.statuses.some((status) => statusHasTag(status, 'spell_immunity_blocked'));
    if (controlImmune && hadBkbBlocked) {
      runtime.log('info', formatControlCleanse(controlImmune, actor.name));
      runtime.dispelStatusEffects(actor, {
        strength: 'strong',
        direction: 'negative',
        identityIds: getStatusIdentityIdsByTag('spell_immunity_blocked'),
      });
    }

    const hadFoolControl = actor.statuses.some((status) => statusHasTag(status, 'control'));
    if (hasIdentity(actor, 'STYLE_FOOL') && hadFoolControl) {
      runtime.log('info', `🤪 ${actor.name} 的笨蛋女人混沌之力发动，开始无视身上的控制异常！`);
      runtime.dispelStatusEffects(actor, {
        strength: 'strong',
        direction: 'negative',
        identityIds: getStatusIdentityIdsByTag('control'),
      });
    }

    const hadGachaControl = actor.statuses.some((status) => statusHasTag(status, 'control'));
    if (actor.jobData?.name === '欧皇' && hadGachaControl && Math.random() < 0.8) {
      runtime.log('buff', `👑 ${actor.name} 发动钞能力，开始解除控制状态！`);
      runtime.dispelStatusEffects(actor, {
        strength: 'strong',
        direction: 'negative',
        identityIds: getStatusIdentityIdsByTag('control'),
      });
    }
    tryTokusatsuControlThrone(runtime, actor);
  }

  let blockingStatus = findMechanic(actor, 'AIRBORNE') ??
    actor.statuses.find((status) => statusHasTag(status, 'action_blocking'));
  let blockedByControl = !!blockingStatus;
  let confused = hasMechanic(actor, 'CONFUSED');
  let embarrassed = hasMechanic(actor, 'EMBARRASSED');
  const blockedByCharacterState = actor.statuses.some((status) =>
    status.identityId === 'OWL_FORM_DEFEAT' ||
    status.identityId === 'OWL_ENJOYING' ||
    status.identityId === 'OWL_SPALTER_DOLL',
  );
  // Damage-over-time always resolves before recovery. A fixed secondary order
  // prevents insertion history from deciding survival or kill ownership.
  const statusesToProcess = actor.statuses
    .map((status, index) => ({ status, index }))
    .sort((a, b) => statusSettlementPriority(a.status) - statusSettlementPriority(b.status) || a.index - b.index)
    .map(({ status }) => status);
  const isSlacking = hasIdentity(actor, 'SYNERGY_SLACKING');
  const selfOpportunityStatuses = actor.statuses.filter((status) =>
    status.expiresOn === 'self_opportunity_end',
  );
  const selfOpportunityBarriers = (actor.barriers ?? []).filter((barrier) =>
    barrier.tickMode === 'self_opportunity',
  );
  const selfOpportunityStatusVersions = Object.fromEntries(selfOpportunityStatuses.map((status) => [
    status.instanceId,
    status.appliedSequence,
  ]));
  const selfOpportunityBarrierVersions = Object.fromEntries(selfOpportunityBarriers.map((barrier) => [
    barrier.id,
    barrier.appliedSequence,
  ]));
  let poisonSettled = false;

  for (const status of statusesToProcess) {
    if (actor.currentHp <= 0 || actor.isDead || actor.isDeadAnnounced) break;
    if (!actor.statuses.includes(status)) continue;

    if (!isSlacking && statusHasTag(status, 'damage_over_time')) {
      if (status.identityId === 'POISON' && poisonSettled) {
        // Each source keeps its own lifetime, but poison deals one aggregate tick.
      } else {
        const settlementStatus = status.identityId === 'POISON'
          ? findMechanic(actor, 'POISON') ?? status
          : status;
        if (status.identityId === 'POISON') poisonSettled = true;
        const poisonStacks = status.identityId === 'POISON'
          ? Math.max(1, Math.min(3, actor.statuses
              .filter((entry) => entry.mechanicId === 'POISON')
              .reduce((sum, entry) => sum + Math.max(0, entry.potency ?? 0), 0)))
          : 1;
        const damagePct = status.identityId === 'WATER_PRISON'
          ? 0.08
          : [0.04, 0.05, 0.06][poisonStacks - 1] ?? 0.04;
        const dmgAmt = Math.max(1, Math.floor(actor.maxHp * damagePct));
        const statusPresentation = buildStatusPresentationMember(settlementStatus);
        const statusCause = status.identityId === 'WATER_PRISON' ? '深渊水牢窒息' : statusPresentation.name;
        const actionText = status.identityId === 'WATER_PRISON'
          ? '在深渊水牢中窒息'
          : '受到持续伤害';
        const damageOptions: DamageApplicationOptions = {
          deferTransform: true,
          actionName: statusCause,
          sourceKind: 'status',
          suppressStatusAftermath: true,
          bypassShields: status.identityId === 'POISON',
        };
        const applier = findStatusApplier(runtime, settlementStatus);
        const actualDmg = runtime.applyDamage(actor, dmgAmt, 'status', true, applier, damageOptions);
        const connected = didDamageConnect(actualDmg, damageOptions);
        runtime.flushDeferredDamageEvents(actor, 'mitigation');
        const sourceName = settlementStatus.attribution.applierName ?? applier?.name ?? settlementStatus.attribution.effectSourceName;
        const sourceText = sourceName ? `；最新施加者 ${sourceName}` : '';
        const remainingBeforeTick = status.identityId === 'POISON'
          ? Math.max(...actor.statuses
              .filter((entry) => entry.identityId === 'POISON')
              .map((entry) => entry.remainingTurns ?? 0), 0)
          : settlementStatus.remainingTurns ?? 0;
        const timingText = `当前剩余 ${remainingBeforeTick} 次${sourceText}；本次行动结束后衰减 1 次`;
        if (actualDmg > 0) {
          const stackText = status.identityId === 'POISON' ? `（${poisonStacks} 层）` : '';
          runtime.log('poison', `${statusPresentation.icon} 【${statusPresentation.name}】${actor.name} ${actionText}${stackText}，实际损失 ${actualDmg} 点生命！（${timingText}）`);
        } else if (damageOptions.redirectedByMomo) {
          runtime.log('info', `${statusPresentation.icon} ${actor.name} 的【${statusPresentation.name}】触发【|OMO】，舰长合计损失 ${damageOptions.redirectedMomoDamage ?? 0} 点生命；${actor.name} 本体未受伤。（${timingText}）`);
        } else if (damageOptions.redirectedByYuzu) {
          runtime.log('info', `${statusPresentation.icon} ${actor.name} 的【${statusPresentation.name}】触发【镜界分摊】，队友合计损失 ${damageOptions.redirectedYuzuDamage ?? 0} 点生命；${actor.name} 本体未受伤。（${timingText}）`);
        } else if (connected) {
          runtime.log('info', `${statusPresentation.icon} 【${statusPresentation.name}】${actor.name} ${actionText}并被成功命中；但【黄昏余命】期间未再损失生命。（${timingText}）`);
        } else {
          runtime.log('info', `${statusPresentation.icon} ${actor.name} 的【${statusPresentation.name}】本次没有穿透防护，生命未减少。（${timingText}）`);
        }
        if (connected || (actor.pendingDamageEvents?.length ?? 0) > 0) {
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
    }
    const canAutoRecover =
      status.mechanicId === 'REGEN' ||
      status.identityId === 'WT_REPAIRING' ||
      (status.identityId === 'PLUG_HEART' && !!actor.isSuccubus && !!actor.transformed);
    if (!isSlacking && canAutoRecover && actor.currentHp < actor.maxHp) {
      const healPct = status.identityId === 'WT_REPAIRING' ? WT_REPAIRING_PROFILE.healPerTurnPct : 0.05;
      const heal = Math.floor(actor.maxHp * healPct);
      const healed = healFighter(actor, heal, runtime.log, { kind: 'regen', sourceId: status.attribution.effectSourceId });
      if (healed > 0) {
        const presentation = buildStatusPresentationMember(status);
        runtime.log('heal', status.identityId === 'WT_REPAIRING'
          ? `🔧 【抢修进度】${actor.name} 趁停车维修恢复了 ${healed} 点生命！`
          : `${presentation.icon} 【${presentation.name}】${actor.name} 自动回复了 ${healed} 点生命（来源：${presentation.sourceLabel}）`);
      }
    }
  }
  syncSpinalSwordState(runtime, actor, true);
  blockingStatus = findMechanic(actor, 'AIRBORNE') ??
    actor.statuses.find((status) => statusHasTag(status, 'action_blocking'));
  blockedByControl = !!blockingStatus;
  confused = hasMechanic(actor, 'CONFUSED');
  embarrassed = hasMechanic(actor, 'EMBARRASSED');

  if (hasIdentity(actor, 'SYNERGY_SLACKING')) {
    return {
      canAct: false,
      confused: false,
      embarrassed: false,
      blockingStatusType: 'SYNERGY_SLACKING',
      selfOpportunityStatuses: [],
      selfOpportunityBarriers: [],
      selfOpportunityStatusVersions: {},
      selfOpportunityBarrierVersions: {},
    };
  }
  return {
    canAct: actor.currentHp > 0 && !actor.isDead && !actor.isDeadAnnounced && !blockedByControl && !blockedByCharacterState,
    confused,
    embarrassed,
    blockingStatusType: blockingStatus?.identityId,
    selfOpportunityStatuses,
    selfOpportunityBarriers,
    selfOpportunityStatusVersions,
    selfOpportunityBarrierVersions,
  };
}

export function processStatus(runtime: StatusProcessingRuntime, actor: Fighter): boolean {
  const result = processStatusTurn(runtime, actor);
  settleSelfOpportunityStatuses(
    runtime,
    actor,
    result.selfOpportunityStatuses,
    result.selfOpportunityBarriers,
    result.selfOpportunityStatusVersions,
    result.selfOpportunityBarrierVersions,
  );
  return result.canAct;
}

export function settleSelfOpportunityStatuses(
  runtime: StatusProcessingRuntime,
  actor: Fighter,
  statuses: readonly StatusInstance[],
  barriers: readonly BarrierEntry[] = [],
  statusVersions?: Readonly<Record<string, number>>,
  barrierVersions?: Readonly<Record<string, number>>,
): void {
  const ordered = [...statuses].sort((a, b) => statusSettlementPriority(a) - statusSettlementPriority(b));
  const groups = groupExpiredStatuses(ordered);
  for (const group of groups) {
    const eligible = group.filter((status) =>
      actor.statuses.includes(status) &&
      (statusVersions?.[status.instanceId] === undefined || status.appliedSequence === statusVersions[status.instanceId]),
    );
    if (eligible.length === 0) continue;
    const { expiredStatuses } = advanceEffects(actor, {
      tickMode: 'self_opportunity',
      instanceIds: eligible.map((status) => status.instanceId),
      includeBarriers: false,
    });
    if (expiredStatuses.length === 0) continue;
    handleSelfTimedStatusExpiryGroup(runtime, actor, expiredStatuses);
    if (actor.currentHp <= 0 || actor.isDead || actor.isDeadAnnounced) break;
  }
  const eligibleBarrierIds = barriers
    .filter((barrier) =>
      actor.barriers?.includes(barrier) &&
      (barrierVersions?.[barrier.id] === undefined || barrier.appliedSequence === barrierVersions[barrier.id]))
    .map((barrier) => barrier.id);
  const { expiredBarriers } = advanceEffects(actor, {
    tickMode: 'self_opportunity',
    barrierIds: eligibleBarrierIds,
    includeStatuses: false,
  });
  expiredBarriers.forEach((barrier) => {
    const presentation = buildBarrierPresentationItem(barrier);
    runtime.log('info', `${presentation.icon} 【屏障结束】${actor.name} 的【${presentation.name}】自然消散。`);
  });
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
    !hasIdentity(actor, 'SYNERGY_SLACKING')
  ) {
    if (Math.random() < (actor.isGacha ? 0.8 : 0.2)) {
      actor.hasSpinalSword = true;
      actor.spinalSwordTurns = Math.floor(Math.random() * 3) + 3;
      applyStatus(actor, { identityId: 'SPINAL_SWORD', remainingTurns: actor.spinalSwordTurns, attribution: { effectSourceId: 'spinal_sword_pickup' } });
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
  const hadActiveSword = !!actor.hasSpinalSword || hasIdentity(actor, 'SPINAL_SWORD');
  actor.hasSpinalSword = false;
  actor.spinalSwordTurns = 0;
  removeEffects(actor, { identityIds: ['SPINAL_SWORD'], reason: 'scripted' });
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
  const hasStatus = hasIdentity(actor, 'SPINAL_SWORD');
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
  const hasStatus = hasIdentity(actor, 'PUPPET_MASTER');
  if (hasPuppet && !hasStatus) {
    applyStatus(actor, { identityId: 'PUPPET_MASTER', attribution: { effectSourceId: 'puppet_ting' } });
  } else if (!hasPuppet && hasStatus) {
    removeEffects(actor, { identityIds: ['PUPPET_MASTER'], reason: 'scripted' });
  }
}
