import type {
  DamageApplicationOptions,
  DamageSourceKind,
  DamageResolutionRecord,
  DefeatOptions,
  Fighter,
  StatKey,
  StatusCalculationStage,
  StatusInstance,
} from './types';
import {
  getStatusIdentityDefinition,
  getStatusIdentityIdsByTag,
  getStatusMechanicId,
  getStatusMechanicProjection,
  isDirectDamageKind,
  type StatusMechanicProjection,
} from './statusRegistry';
import {
  applyStatus,
  consumeMechanicValue,
  consumeStatusValue,
  findMechanic,
  hasIdentity,
  queryMechanic,
  removeBarriers,
  removeEffects,
} from './statusSystem';

export const WT_REPAIRING_PROFILE = {
  remainingTurns: 2,
  healPerTurnPct: 0.2,
  incomingDamageMultiplier: 1.3,
} as const;

export interface StatusMechanicsRuntime {
  fighters: Fighter[];
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
  isActiveCombatant: (fighter: Fighter) => boolean;
}

export interface StatusDamageEvent {
  mechanicId: string;
  trigger: 'large_round' | 'attack' | 'forced' | 'aftermath' | 'npc_substitute';
  statusInstanceId?: string;
  sourceId?: string;
  applierId?: string;
  targetId: string;
  attempted: number;
  hpDamage: number;
  shieldDamage: number;
  overkillDamage: number;
  lockblood: boolean;
  phaseTransition: boolean;
  defeated: boolean;
  hitWithoutHpDamage: boolean;
  redirectedBy?: 'momo' | 'originium_core' | 'owl_emperor' | 'joker' | 'yuzu';
  redirectedDamage?: number;
}

export interface BleedTriggerResult {
  triggered: number;
  canContinue: boolean;
  events: StatusDamageEvent[];
}

function statusApplier(runtime: StatusMechanicsRuntime, status: StatusInstance): Fighter | undefined {
  const actorId = status.attribution.creditActorId ?? status.attribution.applierId;
  if (!actorId) return undefined;
  return runtime.fighters.find((fighter) => fighter.id === actorId);
}

function statusLabel(status: StatusInstance): { name: string; icon: string } {
  const definition = getStatusIdentityDefinition(status.identityId);
  return {
    name: definition.displayName,
    icon: definition.icon,
  };
}

function aggregateDualStatus(fighter: Fighter, mechanicId: string): StatusInstance | undefined {
  const value = queryMechanic(fighter, mechanicId);
  const latest = findMechanic(fighter, mechanicId);
  if (!latest || value.count <= 0) return undefined;
  return {
    ...latest,
    potency: value.potency,
    count: value.count,
  };
}

function makeStatusDamageEvent(
  target: Fighter,
  status: StatusInstance,
  trigger: StatusDamageEvent['trigger'],
  attempted: number,
  options: DamageApplicationOptions,
): StatusDamageEvent {
  const redirectedBy = options.redirectedByMomo
    ? 'momo'
    : options.redirectedByOriginiumCore
      ? 'originium_core'
      : options.redirectedByOwlEmperor
        ? 'owl_emperor'
        : options.redirectedByJoker
          ? 'joker'
          : options.redirectedByYuzu
            ? 'yuzu'
            : undefined;
  const redirectedDamage = redirectedBy === 'momo'
    ? options.redirectedMomoDamage
    : redirectedBy === 'originium_core'
      ? options.redirectedOriginiumDamage
      : redirectedBy === 'owl_emperor'
        ? options.redirectedOwlEmperorDamage
        : redirectedBy === 'joker'
          ? options.redirectedJokerDamage
          : redirectedBy === 'yuzu'
            ? options.redirectedYuzuDamage
            : undefined;
  return {
    mechanicId: getStatusMechanicId(status),
    trigger,
    statusInstanceId: status.instanceId,
    sourceId: status.attribution.effectSourceId,
    applierId: status.attribution.creditActorId ?? status.attribution.applierId,
    targetId: target.id,
    attempted,
    hpDamage: options.resolution?.hpDamage ?? 0,
    shieldDamage: options.resolution?.shieldDamage ?? 0,
    overkillDamage: options.resolution?.overkillDamage ?? 0,
    lockblood: options.phaseLockTriggered === true ||
      options.resolution?.phaseLockTriggered === true ||
      options.resolution?.outcome === 'lockblood',
    phaseTransition: options.resolution?.phaseTransition === true,
    defeated: target.currentHp <= 0 || target.isDead || target.isDeadAnnounced,
    hitWithoutHpDamage: options.hitWithoutHpDamage === true,
    redirectedBy,
    redirectedDamage,
  };
}

function settleStatusDamage(
  runtime: StatusMechanicsRuntime,
  target: Fighter,
  status: StatusInstance,
  amount: number,
  trigger: StatusDamageEvent['trigger'],
  options: { bypassShields: boolean; actionName: string },
): StatusDamageEvent {
  const applier = statusApplier(runtime, status);
  const damageOptions: DamageApplicationOptions = {
    deferTransform: true,
    actionName: options.actionName,
    sourceKind: 'status',
    suppressStatusAftermath: true,
    bypassShields: options.bypassShields,
    creditAttacker: !!applier,
  };
  runtime.applyDamage(target, Math.max(1, Math.floor(amount)), 'status', true, applier, damageOptions);
  runtime.flushDeferredDamageEvents(target, 'mitigation');
  return makeStatusDamageEvent(target, status, trigger, amount, damageOptions);
}

function logStatusSettlement(
  runtime: StatusMechanicsRuntime,
  target: Fighter,
  status: StatusInstance,
  event: StatusDamageEvent,
  phrase: string,
  remainingCount: number,
): void {
  const { name, icon } = statusLabel(status);
  const applier = statusApplier(runtime, status);
  const sourceName = status.attribution?.applierName ?? applier?.name ?? status.attribution?.effectSourceName;
  const sourceText = sourceName ? `；最新施加者 ${sourceName}` : '';
  const settlement = `本次强度 ${status.potency ?? 0}${sourceText}；结算后剩余 ${remainingCount} 次${remainingCount === 0 ? `，【${name}】耗尽` : ''}`;
  if (event.redirectedBy) {
    const redirectedDamage = event.redirectedDamage ?? 0;
    const redirectText = event.redirectedBy === 'momo'
      ? redirectedDamage > 0
        ? `伤害触发【|OMO】，舰长合计实际损失 ${redirectedDamage} 点生命`
        : '伤害触发【|OMO】，但舰长均未损失生命'
      : event.redirectedBy === 'originium_core'
        ? redirectedDamage > 0
          ? `伤害被导入【源石网络】，源石结晶合计实际损失 ${redirectedDamage} 点生命`
          : '伤害被导入【源石网络】，但源石结晶均未损失生命'
        : event.redirectedBy === 'owl_emperor'
          ? redirectedDamage > 0
            ? `伤害由【帝王之征】接管，龙实际损失 ${redirectedDamage} 点生命`
            : '伤害由【帝王之征】接管，但龙未损失生命'
          : event.redirectedBy === 'yuzu'
            ? redirectedDamage > 0
              ? `伤害触发【镜界分摊】，队友合计实际损失 ${redirectedDamage} 点生命`
              : '伤害触发【镜界分摊】，但队友均未损失生命'
          : redirectedDamage > 0
            ? `伤害被转移，替代承伤者实际损失 ${redirectedDamage} 点生命`
            : '伤害被转移，但替代承伤者未损失生命';
    runtime.log(
      redirectedDamage > 0 ? 'poison' : 'info',
      `${icon} 【${name}】${target.name} ${phrase}，${redirectText}；${target.name}本体未损失生命！（${settlement}）`,
    );
  } else if (event.hpDamage > 0) {
    runtime.log('poison', `${icon} 【${name}】${target.name} ${phrase}，实际损失 ${event.hpDamage} 点生命！（${settlement}）`);
  } else if (event.shieldDamage > 0) {
    runtime.log('info', `${icon} 【${name}】${target.name} ${phrase}，但 ${event.shieldDamage} 点伤害被屏障吸收，生命未减少！（${settlement}）`);
  } else if (event.hitWithoutHpDamage) {
    runtime.log('info', `${icon} 【${name}】${target.name} ${phrase}并被成功命中；但【黄昏余命】期间显示生命已为 0，未再损失生命！（${settlement}）`);
  } else {
    runtime.log('info', `${icon} 【${name}】${target.name} ${phrase}，伤害被完全化解！（${settlement}）`);
  }
  if (event.hpDamage > 0 || event.shieldDamage > 0 || event.hitWithoutHpDamage || (target.pendingDamageEvents?.length ?? 0) > 0) {
    runtime.flushDeferredDamageEvents(target);
  }
}

function markStatusDefeat(runtime: StatusMechanicsRuntime, target: Fighter, status: StatusInstance): void {
  if (target.currentHp > 0 || target.isDead || target.isDeadAnnounced) return;
  const applier = statusApplier(runtime, status);
  const { name } = statusLabel(status);
  runtime.markDefeated(target, {
    message: `💀 ${target.name} 被【${name}】的后续伤害击倒！`,
    killer: applier,
    causeName: name,
    awardKill: !!applier,
  });
}

export function settleBurnAtLargeRound(runtime: StatusMechanicsRuntime, completedRound: number): StatusDamageEvent[] {
  const events: StatusDamageEvent[] = [];
  for (const target of runtime.fighters) {
    if (!runtime.isActiveCombatant(target) || hasIdentity(target, 'SYNERGY_SLACKING')) continue;
    const burn = aggregateDualStatus(target, 'BURN');
    if (!burn || (burn.count ?? 0) <= 0) continue;
    const event = settleStatusDamage(runtime, target, burn, (burn.potency ?? 0) * 6, 'large_round', {
      bypassShields: false,
      actionName: `第${completedRound}大回合灼烧`,
    });
    consumeMechanicValue(target, 'BURN', 'count', 1);
    logStatusSettlement(runtime, target, burn, event, '身上的火焰在大回合末蔓延', queryMechanic(target, 'BURN').count);
    events.push(event);
    markStatusDefeat(runtime, target, burn);
  }
  return events;
}

export function triggerBurn(
  runtime: StatusMechanicsRuntime,
  target: Fighter,
  times = 1,
): StatusDamageEvent[] {
  const events: StatusDamageEvent[] = [];
  for (let index = 0; index < Math.max(1, times); index += 1) {
    if (!runtime.isActiveCombatant(target)) break;
    const burn = aggregateDualStatus(target, 'BURN');
    if (!burn || (burn.count ?? 0) <= 0) break;
    const event = settleStatusDamage(runtime, target, burn, (burn.potency ?? 0) * 6, 'forced', {
      bypassShields: false,
      actionName: '爆燃',
    });
    consumeMechanicValue(target, 'BURN', 'count', 1);
    logStatusSettlement(runtime, target, burn, event, '积蓄的火势被【爆燃】提前引爆', queryMechanic(target, 'BURN').count);
    events.push(event);
    markStatusDefeat(runtime, target, burn);
    if (event.lockblood || event.phaseTransition || event.defeated) break;
  }
  return events;
}

export function triggerBleedBeforeAttack(
  runtime: StatusMechanicsRuntime,
  attacker: Fighter,
  times = 1,
): BleedTriggerResult {
  const events: StatusDamageEvent[] = [];
  let triggered = 0;
  for (let index = 0; index < Math.max(1, times); index += 1) {
    if (!runtime.isActiveCombatant(attacker)) break;
    const bleed = aggregateDualStatus(attacker, 'BLEED');
    if (!bleed || (bleed.count ?? 0) <= 0) break;
    const event = settleStatusDamage(runtime, attacker, bleed, (bleed.potency ?? 0) * 6, 'attack', {
      bypassShields: true,
      actionName: '攻击牵动流血',
    });
    triggered += 1;
    consumeMechanicValue(attacker, 'BLEED', 'count', 1);
    logStatusSettlement(runtime, attacker, bleed, event, '强行发动攻击，伤口在出手前裂开', queryMechanic(attacker, 'BLEED').count);
    events.push(event);
    markStatusDefeat(runtime, attacker, bleed);
    if (event.lockblood || event.phaseTransition || event.defeated) break;
  }
  return { triggered, canContinue: runtime.isActiveCombatant(attacker), events };
}

export function triggerBleed(
  runtime: StatusMechanicsRuntime,
  target: Fighter,
  times = 1,
): StatusDamageEvent[] {
  const events: StatusDamageEvent[] = [];
  for (let index = 0; index < Math.max(1, times); index += 1) {
    if (!runtime.isActiveCombatant(target)) break;
    const bleed = aggregateDualStatus(target, 'BLEED');
    if (!bleed || (bleed.count ?? 0) <= 0) break;
    const event = settleStatusDamage(runtime, target, bleed, (bleed.potency ?? 0) * 6, 'forced', {
      bypassShields: true,
      actionName: '催血',
    });
    consumeMechanicValue(target, 'BLEED', 'count', 1);
    logStatusSettlement(runtime, target, bleed, event, '伤口被【催血】强行牵动', queryMechanic(target, 'BLEED').count);
    events.push(event);
    markStatusDefeat(runtime, target, bleed);
    if (event.lockblood || event.phaseTransition || event.defeated) break;
  }
  return events;
}

function triggerRupture(
  runtime: StatusMechanicsRuntime,
  target: Fighter,
  statusHitCount: number,
): StatusDamageEvent[] {
  const events: StatusDamageEvent[] = [];
  for (let index = 0; index < statusHitCount; index += 1) {
    if (!runtime.isActiveCombatant(target)) break;
    const rupture = aggregateDualStatus(target, 'RUPTURE');
    if (!rupture || (rupture.count ?? 0) <= 0) break;
    const potency = rupture.potency ?? 0;
    const damage = potency >= 20
      ? Math.max(120, Math.floor(target.maxHp * 0.04))
      : potency * 6;
    const event = settleStatusDamage(runtime, target, rupture, damage, 'aftermath', {
      bypassShields: true,
      actionName: '破裂',
    });
    consumeMechanicValue(target, 'RUPTURE', 'count', 1);
    logStatusSettlement(runtime, target, rupture, event, '的旧伤被直接攻击撕开', queryMechanic(target, 'RUPTURE').count);
    events.push(event);
    markStatusDefeat(runtime, target, rupture);
    if (event.lockblood || event.phaseTransition || event.defeated) break;
  }
  return events;
}

export function changeMorale(
  fighter: Fighter,
  delta: number,
  log?: StatusMechanicsRuntime['log'],
  sourceName = '精神影响',
): { before: number; after: number; breakdown: boolean } {
  if (fighter.isNpc || fighter.morale === undefined || fighter.maxMorale === undefined) {
    return { before: 0, after: 0, breakdown: false };
  }
  const before = fighter.morale;
  fighter.morale = Math.max(0, Math.min(fighter.maxMorale, fighter.morale + Math.floor(delta)));
  if (delta < 0 && fighter.morale < before) fighter.moraleLostSinceOpportunity = true;
  let breakdown = false;
  if (fighter.morale <= 0) {
    breakdown = true;
    applyStatus(fighter, { identityId: 'MENTAL_BREAKDOWN', charges: 1, attribution: { effectSourceId: 'morale_breakdown' } });
    fighter.morale = Math.min(fighter.maxMorale, 50);
    log?.('debuff', `🫥 【精神崩溃】${fighter.name} 的士气被${sourceName}压至零，下一次有效行动只能进行无法暴击的普通攻击！（士气恢复至 ${fighter.morale}/${fighter.maxMorale}）`);
  }
  return { before, after: fighter.morale, breakdown };
}

function triggerSinking(
  runtime: StatusMechanicsRuntime,
  target: Fighter,
  statusHitCount: number,
): StatusDamageEvent[] {
  const events: StatusDamageEvent[] = [];
  for (let index = 0; index < statusHitCount; index += 1) {
    if (!runtime.isActiveCombatant(target)) break;
    const sinking = aggregateDualStatus(target, 'SINKING');
    if (!sinking || (sinking.count ?? 0) <= 0) break;
    if (target.isNpc || target.morale === undefined) {
      const event = settleStatusDamage(runtime, target, sinking, sinking.potency ?? 0, 'npc_substitute', {
        bypassShields: false,
        actionName: '沉沦侵蚀',
      });
      consumeMechanicValue(target, 'SINKING', 'count', 1);
      logStatusSettlement(runtime, target, sinking, event, '没有士气，精神冲击转化为侵蚀伤害', queryMechanic(target, 'SINKING').count);
      events.push(event);
      markStatusDefeat(runtime, target, sinking);
      if (event.lockblood || event.phaseTransition || event.defeated) break;
      continue;
    }
    const change = changeMorale(target, -(sinking.potency ?? 0), runtime.log, '沉沦');
    consumeMechanicValue(target, 'SINKING', 'count', 1);
    const remaining = queryMechanic(target, 'SINKING');
    runtime.log('debuff', `🌊 【沉沦】${target.name} 遭受精神冲击，士气由 ${change.before} 降至 ${change.after}！（本次强度 ${sinking.potency ?? 0}；结算后剩余 ${remaining.count} 次${remaining.count === 0 ? '，【沉沦】耗尽' : ''}）`);
  }
  return events;
}

export function resolveDirectDamageStatusAftermath(
  runtime: StatusMechanicsRuntime,
  target: Fighter,
  resolution: DamageResolutionRecord | undefined,
  options: DamageApplicationOptions,
): StatusDamageEvent[] {
  if (
    !resolution ||
    options.suppressStatusAftermath ||
    !isDirectDamageKind(resolution.originSourceKind ?? resolution.sourceKind ?? options.originSourceKind ?? options.sourceKind) ||
    resolution.hpDamage <= 0 ||
    target.currentHp <= 0 ||
    options.phaseLockTriggered ||
    resolution.phaseLockTriggered ||
    resolution.phaseTransition
  ) return [];
  const hitCount = Math.max(1, Math.floor(options.statusHitCount ?? resolution.statusHitCount ?? 1));
  const ruptureEvents = triggerRupture(runtime, target, hitCount);
  if (ruptureEvents.some((event) => event.lockblood || event.phaseTransition || event.defeated)) {
    return ruptureEvents;
  }
  return [...ruptureEvents, ...triggerSinking(runtime, target, hitCount)];
}

export function burstTremor(
  fighter: Fighter,
  times = 1,
  log?: StatusMechanicsRuntime['log'],
): number {
  let totalAdded = 0;
  for (let index = 0; index < Math.max(1, times); index += 1) {
    const tremor = aggregateDualStatus(fighter, 'TREMOR');
    if (!tremor || (tremor.count ?? 0) <= 0) break;
    const added = tremor.potency ?? 0;
    fighter.stagger = Math.max(0, (fighter.stagger ?? 0) + added);
    totalAdded += added;
    consumeMechanicValue(fighter, 'TREMOR', 'count', 1);
    const remaining = queryMechanic(fighter, 'TREMOR');
    log?.('debuff', `🟨 【震颤爆发】${fighter.name} 的失衡值增加 ${added}！（本次强度 ${tremor.potency ?? 0}；结算后剩余 ${remaining.count} 次${remaining.count === 0 ? '，【震颤】耗尽' : ''}；失衡 ${fighter.stagger}/${fighter.staggerThreshold ?? 40}）`);
    if ((fighter.stagger ?? 0) >= (fighter.staggerThreshold ?? 40) && !findMechanic(fighter, 'STAGGERED')) {
      fighter.stagger = 0;
      applyStatus(fighter, { identityId: 'STAGGERED', remainingTurns: 1, attribution: { effectSourceId: 'tremor_stagger' } });
      log?.('debuff', `💥 【踉跄】${fighter.name} 的失衡值达到阈值并清零；闪避与反击暂时失效，受到的直接伤害提高！`);
    }
  }
  return totalAdded;
}

export function settleSelfOpportunityResources(fighter: Fighter, completedAction: boolean, log?: StatusMechanicsRuntime['log']): void {
  if (hasIdentity(fighter, 'SYNERGY_SLACKING')) return;
  if (fighter.morale !== undefined && fighter.maxMorale !== undefined) {
    if (!fighter.moraleLostSinceOpportunity && fighter.morale < fighter.maxMorale) {
      const before = fighter.morale;
      fighter.morale = Math.min(fighter.maxMorale, fighter.morale + 10);
      if (fighter.morale > before) log?.('buff', `🫧 【士气恢复】${fighter.name} 稳住心神，士气恢复 ${fighter.morale - before} 点！（${fighter.morale}/${fighter.maxMorale}）`);
    }
    fighter.moraleLostSinceOpportunity = false;
  }

  if (completedAction) {
    const breakdown = findMechanic(fighter, 'MENTAL_BREAKDOWN');
    if (breakdown) consumeStatusValue(fighter, breakdown, 'charges', 1);
  }
}

/** Spend charge atomically. Failed costs never consume a partial amount. */
export function spendCharge(fighter: Fighter, amount: number): boolean {
  const cost = Math.max(0, Math.floor(amount));
  if (cost === 0) return true;
  const charge = findMechanic(fighter, 'CHARGE');
  if (!charge || (charge.potency ?? 0) < cost) return false;
  consumeStatusValue(fighter, charge, 'potency', cost);
  return true;
}

export function resetStatusResourcesOnDeath(fighter: Fighter): void {
  removeEffects(fighter, {
    polarities: ['positive', 'negative'],
    excludeIdentityIds: getStatusIdentityIdsByTag('death_persistent'),
    reason: 'death',
  });
  delete fighter.morale;
  delete fighter.maxMorale;
  delete fighter.moraleLostSinceOpportunity;
  fighter.stagger = 0;
  removeBarriers(fighter);
}

export function resetStatusResourcesOnRevive(fighter: Fighter): void {
  if (fighter.isNpc) return;
  fighter.maxMorale = 100;
  fighter.morale = 100;
  fighter.moraleLostSinceOpportunity = false;
  fighter.stagger = 0;
}

export function getMoraleCritModifier(fighter: Fighter): number {
  return fighter.morale !== undefined && fighter.morale <= 50 ? -0.1 : 0;
}

export function getMoraleDamageMultiplier(fighter: Fighter): number {
  return fighter.morale !== undefined && fighter.morale > 0 && fighter.morale <= 25 ? 0.85 : 1;
}

export function getPoiseCritBonus(fighter: Fighter): number {
  return queryMechanic(fighter, 'POISE').potency * 0.05;
}

export function getOpeningCritBonus(target: Fighter): number {
  return queryMechanic(target, 'OPENING').potency / 100;
}

export function getCritRateBonus(fighter: Fighter): number {
  return queryMechanic(fighter, 'CRIT_RATE_UP').potency / 100;
}

export function consumePoiseOnCritical(fighter: Fighter): boolean {
  return !!consumeMechanicValue(fighter, 'POISE', 'count', 1);
}

export function getIncomingDirectStatusMultiplier(
  target: Fighter,
  sourceKind?: DamageSourceKind,
  scope?: 'physical' | 'magical',
): number {
  const applies = (_entry: StatusInstance, projection: StatusMechanicProjection): boolean => {
    const mask = projection.damageSourceMask;
    if (sourceKind && mask && !mask.includes(sourceKind)) return false;
    if (!projection.statScope?.length || !scope) return true;
    return projection.statScope.includes('all') || projection.statScope.includes(scope);
  };
  const vulnerability = percentageProduct(target, 'VULNERABILITY', 'increase', applies);
  const protection = percentageProduct(target, 'PROTECTION', 'decrease', applies);
  const staggered = findMechanic(target, 'STAGGERED') ? 25 : 0;
  return Math.max(0, vulnerability * protection * (1 + staggered / 100));
}

export function getActionSpeedMultiplier(fighter: Fighter): number {
  return Math.max(0.05, percentageProduct(fighter, 'HASTE', 'increase') * percentageProduct(fighter, 'BIND', 'decrease'));
}

export function getEffectiveStatMultiplier(
  fighter: Fighter,
  mechanicUp: string,
  mechanicDown: string,
  sourceKind?: DamageSourceKind,
  statKey?: StatKey,
  calculationStage?: StatusCalculationStage,
  entryPredicate: (entry: StatusInstance) => boolean = () => true,
): number {
  const applies = (entry: StatusInstance, projection: StatusMechanicProjection): boolean =>
    entryPredicate(entry) &&
    (!calculationStage || projection.calculationStage === calculationStage) &&
    statusAppliesToDamageContext(projection, sourceKind, statKey);
  return Math.max(
    0,
    percentageProduct(fighter, mechanicUp, 'increase', applies) *
      percentageProduct(fighter, mechanicDown, 'decrease', applies),
  );
}

export function getOutgoingDirectStatusMultiplier(
  fighter: Fighter,
  sourceKind: DamageSourceKind,
  scope?: 'physical' | 'magical',
  calculationStage: StatusCalculationStage = 'post_formula',
): number {
  const applies = (_entry: StatusInstance, projection: StatusMechanicProjection): boolean => {
    if (projection.calculationStage !== calculationStage) return false;
    const mask = projection.damageSourceMask;
    if (mask && !mask.includes(sourceKind)) return false;
    if (!projection.statScope?.length || !scope) return true;
    return projection.statScope.includes('all') || projection.statScope.includes(scope);
  };
  return Math.max(
    0,
    percentageProduct(fighter, 'OUTPUT_UP', 'increase', applies) *
      percentageProduct(fighter, 'OUTPUT_DOWN', 'decrease', applies),
  );
}

export function getPanelCombatStat(
  fighter: Fighter,
  key: StatKey,
  sourceKind?: DamageSourceKind,
): number {
  const mechanicPair: Record<StatKey, [string, string]> = {
    atk: ['ATK_UP', 'ATK_DOWN'],
    def: ['DEF_UP', 'DEF_DOWN'],
    mag: ['MAG_UP', 'MAG_DOWN'],
    res: ['RES_UP', 'RES_DOWN'],
    wis: ['WIS_UP', 'WIS_DOWN'],
    spd: ['SPD_UP', 'SPD_DOWN'],
    agl: ['AGL_UP', 'AGL_DOWN'],
  };
  const [up, down] = mechanicPair[key];
  const rabbitStyleIdentities = new Set([
    'STYLE_SMART',
    'STYLE_SEXY',
    'STYLE_ANGRY',
    'STYLE_FAMILY',
    'STYLE_EMPEROR',
  ]);
  const isRabbitStyle = (entry: StatusInstance): boolean => rabbitStyleIdentities.has(entry.identityId);
  const hasRabbitStyle = !!fighter.rabbitStyleBaseStats && fighter.statuses.some(isRabbitStyle);
  const panelMechanics = key === 'def' || key === 'res'
    ? [up, down, 'DEF_RES_UP', 'DEF_RES_DOWN']
    : [up, down];
  const hasPanelModifier = panelMechanics.some((mechanicId) =>
    queryMechanic(fighter, mechanicId).entries.some((entry) => {
      const projection = getStatusMechanicProjection(entry, mechanicId);
      return projection?.calculationStage === 'panel_stat' &&
        statusAppliesToDamageContext(projection, sourceKind, key);
    }),
  );
  let panelMultiplier = getEffectiveStatMultiplier(fighter, up, down, sourceKind, key, 'panel_stat');
  if (key === 'def' || key === 'res') {
    panelMultiplier *= getEffectiveStatMultiplier(fighter, 'DEF_RES_UP', 'DEF_RES_DOWN', sourceKind, key, 'panel_stat');
  }
  const flat = queryMechanic(fighter, `${key.toUpperCase()}_FLAT_UP`).potency;
  const minimumStatValue = fighter.statuses.reduce((minimum, entry) => {
    const projection = getStatusMechanicProjection(entry, getStatusMechanicId(entry));
    if (
      projection?.calculationStage !== 'panel_stat' ||
      projection.minimumStatValue === undefined ||
      !projection.statScope?.includes(key)
    ) return minimum;
    return Math.max(minimum, projection.minimumStatValue);
  }, 0);
  if (hasRabbitStyle) {
    const styleMultiplier = getEffectiveStatMultiplier(
      fighter,
      up,
      down,
      sourceKind,
      key,
      'panel_stat',
      isRabbitStyle,
    );
    let ordinaryMultiplier = getEffectiveStatMultiplier(
      fighter,
      up,
      down,
      sourceKind,
      key,
      'panel_stat',
      (entry) => !isRabbitStyle(entry),
    );
    if (key === 'def' || key === 'res') {
      ordinaryMultiplier *= getEffectiveStatMultiplier(
        fighter,
        'DEF_RES_UP',
        'DEF_RES_DOWN',
        sourceKind,
        key,
        'panel_stat',
        (entry) => !isRabbitStyle(entry),
      );
    }
    const snapshot = fighter.rabbitStyleBaseStats![key];
    const styleValue = Math.max(
      1,
      Math.floor(snapshot * styleMultiplier) + (fighter[key] + flat - snapshot),
    );
    return Math.max(minimumStatValue, Math.floor(styleValue * ordinaryMultiplier));
  }
  const projectedValue = hasPanelModifier
    ? Math.max(0, Math.floor((fighter[key] + flat) * panelMultiplier))
    : fighter[key] + flat;
  const positiveStatFloor = fighter[key] + flat > 0 ? 1 : 0;
  return Math.max(minimumStatValue, positiveStatFloor, projectedValue);
}

export function hasPanelStatProjection(fighter: Fighter): boolean {
  return fighter.statuses.some((entry) => {
    const projection = getStatusMechanicProjection(entry, getStatusMechanicId(entry));
    return projection?.calculationStage === 'panel_stat';
  });
}

export function getEffectiveCombatStat(
  fighter: Fighter,
  key: StatKey,
  sourceKind?: DamageSourceKind,
): number {
  const mechanicPair: Record<StatKey, [string, string]> = {
    atk: ['ATK_UP', 'ATK_DOWN'],
    def: ['DEF_UP', 'DEF_DOWN'],
    mag: ['MAG_UP', 'MAG_DOWN'],
    res: ['RES_UP', 'RES_DOWN'],
    wis: ['WIS_UP', 'WIS_DOWN'],
    spd: ['SPD_UP', 'SPD_DOWN'],
    agl: ['AGL_UP', 'AGL_DOWN'],
  };
  const [up, down] = mechanicPair[key];
  let effectiveMultiplier = getEffectiveStatMultiplier(fighter, up, down, sourceKind, key, 'effective_stat');
  if (key === 'def' || key === 'res') {
    effectiveMultiplier *= getEffectiveStatMultiplier(fighter, 'DEF_RES_UP', 'DEF_RES_DOWN', sourceKind, key, 'effective_stat');
  }
  const panelValue = getPanelCombatStat(fighter, key, sourceKind);
  if (panelValue <= 0) return 0;
  return Math.max(1, panelValue * effectiveMultiplier);
}

export function getAccuracyPointModifier(fighter: Fighter): number {
  return (queryMechanic(fighter, 'ACCURACY_UP').potency - queryMechanic(fighter, 'ACCURACY_DOWN').potency) / 100;
}

export function getAccuracyAgilityMultiplier(fighter: Fighter): number {
  return Math.max(0, percentageProduct(fighter, 'ACCURACY_AGL_UP', 'increase'));
}

export function getEvasionMultiplier(fighter: Fighter): number {
  if (findMechanic(fighter, 'STAGGERED')) return 0;
  return Math.max(0, percentageProduct(fighter, 'EVASION_UP', 'increase') * percentageProduct(fighter, 'EVASION_DOWN', 'decrease'));
}

export function getAggroMultiplier(fighter: Fighter): number {
  return Math.max(0, 1 + queryMechanic(fighter, 'AGGRO').potency / 100);
}

export function isParalyzedForAttack(fighter: Fighter): boolean {
  return queryMechanic(fighter, 'PARALYSIS').charges > 0;
}

export function consumeParalysis(fighter: Fighter): boolean {
  const paralysis = findMechanic(fighter, 'PARALYSIS');
  return paralysis ? consumeStatusValue(fighter, paralysis, 'charges', 1) : false;
}

export function consumeAccuracyCharge(fighter: Fighter): void {
  for (const mechanicId of ['ACCURACY_UP', 'ACCURACY_DOWN']) {
    const status = findMechanic(fighter, mechanicId);
    if (status?.charges) consumeStatusValue(fighter, status, 'charges', 1);
  }
}

export function getDrainPercent(fighter: Fighter): number {
  return queryMechanic(fighter, 'DRAIN').potency;
}

export function consumeDrain(fighter: Fighter): void {
  const drain = findMechanic(fighter, 'DRAIN');
  if (drain?.charges) consumeStatusValue(fighter, drain, 'charges', 1);
}

export function getCriticalDamagePointModifier(attacker: Fighter, target: Fighter): number {
  return (queryMechanic(attacker, 'CRIT_DAMAGE_UP').potency - queryMechanic(target, 'CRIT_DAMAGE_DOWN').potency) / 100;
}

export function consumeCriticalDamageStatuses(attacker: Fighter, target: Fighter): void {
  const sharpen = findMechanic(attacker, 'CRIT_DAMAGE_UP');
  if (sharpen?.charges) consumeStatusValue(attacker, sharpen, 'charges', 1);
  const dull = findMechanic(target, 'CRIT_DAMAGE_DOWN');
  if (dull?.charges) consumeStatusValue(target, dull, 'charges', 1);
}

export function hasMentalBreakdown(fighter: Fighter): boolean {
  return !!findMechanic(fighter, 'MENTAL_BREAKDOWN');
}

function percentageProduct(
  fighter: Fighter,
  mechanicId: string,
  direction: 'increase' | 'decrease',
  predicate: (entry: StatusInstance, projection: StatusMechanicProjection) => boolean = () => true,
): number {
  const entries = queryMechanic(fighter, mechanicId).entries
    .map((entry) => ({ entry, projection: getStatusMechanicProjection(entry, mechanicId)! }))
    .filter(({ entry, projection }) => predicate(entry, projection));
  const additive = entries
    .filter(({ projection }) => projection.stackMode !== 'multiply' && projection.stackMode !== 'highest')
    .reduce((sum, { projection }) => sum + projection.potency, 0);
  const highest = entries
    .filter(({ projection }) => projection.stackMode === 'highest')
    .reduce((maximum, { projection }) => Math.max(maximum, projection.potency), 0);
  const combined = additive + highest;
  const additiveMultiplier = direction === 'increase'
    ? (100 + combined) / 100
    : Math.max(0, (100 - combined) / 100);
  return entries
    .filter(({ projection }) => projection.stackMode === 'multiply')
    .reduce((product, { projection }) => {
      const potency = projection.potency;
      const multiplier = direction === 'increase'
        ? (100 + potency) / 100
        : Math.max(0, (100 - potency) / 100);
      return product * multiplier;
    }, additiveMultiplier);
}

function statusAppliesToDamageContext(
  projection: StatusMechanicProjection,
  sourceKind?: DamageSourceKind,
  statKey?: StatKey,
): boolean {
  const mask = projection.damageSourceMask;
  if (sourceKind && mask && !mask.includes(sourceKind)) return false;
  const scope = projection.statScope;
  if (!scope?.length || !statKey) return true;
  return scope.includes('all') || scope.includes(statKey);
}
