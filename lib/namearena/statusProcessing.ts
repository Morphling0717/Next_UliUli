import type { DamageApplicationOptions, DefeatOptions, Fighter, SpinalSwordRef, StatusEffectsMap, StatusEntry } from './types';
import { healFighter } from './combatState';
import {
  BKB_BLOCKED_STATUS_TYPES,
  CONTROL_STATUS_TYPES,
  DOT_STATUS_TYPES,
  getStatusTickMode,
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
  syncHpPct: (fighter: Fighter) => void;
  isActiveCombatant: (fighter: Fighter) => boolean;
}

export function handleSelfTimedStatusExpiry(
  runtime: Pick<StatusProcessingRuntime, 'log'>,
  actor: Fighter,
  type: string,
): void {
  if (type !== 'ZEROED' || !actor.baseStatsForZero) return;

  actor.atk = actor.baseStatsForZero.atk;
  actor.def = actor.baseStatsForZero.def;
  actor.res = actor.baseStatsForZero.res;
  delete actor.baseStatsForZero;
  actor.wasZeroed = false;
  runtime.log('info', `🧮 ${actor.name} 的【归零】状态结束，被降维的属性恢复了！`);
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
      if (getStatusTickMode(status.type) !== 'global' || status.duration >= 999) {
        return [status];
      }

      const appliedTurn = status.appliedTurn ?? turnCount;
      if (appliedTurn >= turnCount) {
        return [{ ...status, appliedTurn }];
      }

      if (status.duration > 1) {
        return [{ ...status, duration: status.duration - 1, appliedTurn }];
      }
      handleGlobalTimedStatusExpiry(log, fighter, status.type);
      return [];
    });
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

export function processStatus(runtime: StatusProcessingRuntime, actor: Fighter): boolean {
  let canAct = true;
  const nextStatusEntries: Array<{ original: StatusEntry; next: StatusEntry }> = [];
  const processedStatuses = new Set(actor.status);
  const statusesToProcess = [...actor.status];
  const isSlacking = actor.status.some((status) => status.type === 'SYNERGY_SLACKING');

  for (const status of statusesToProcess) {
    if (actor.currentHp <= 0 || actor.isDead || actor.isDeadAnnounced) break;

    if (isStatusType(status.type, CONTROL_STATUS_TYPES)) canAct = false;
    if (!isSlacking && isStatusType(status.type, DOT_STATUS_TYPES)) {
      const dmgAmt = status.type === 'WATER_PRISON' ? Math.floor(actor.maxHp * 0.08) : Math.floor(actor.maxHp * 0.05);
      const statusInfo = runtime.statusEffects[status.type];
      const statusCause = status.type === 'WATER_PRISON' ? '深渊水牢窒息' : (statusInfo?.name ?? '持续伤害');
      runtime.log('poison', `${statusInfo?.icon ?? ''} ${actor.name} ${status.type === 'WATER_PRISON' ? '在深渊水牢中窒息' : '受到持续伤害'}，损失 ${dmgAmt} 点生命`);
      const actualDmg = runtime.applyDamage(actor, dmgAmt, 'status', true);
      if (actor.currentHp <= 0) {
        runtime.markDefeated(actor, {
          message: `💀 ${actor.name} 因${statusCause}（${actualDmg}点）倒下了！`,
          awardKill: false,
        });
        canAct = false;
        break;
      }
    }
    const canAutoRecover =
      status.type === 'REGEN' ||
      status.type === 'STYLE_FAMILY' ||
      (status.type === 'PLUG_HEART' && !!actor.isSuccubus && !!actor.transformed);
    if (!isSlacking && canAutoRecover && actor.currentHp < actor.maxHp) {
      if (actor.status.some((candidate) => candidate.type === 'NO_HEAL')) {
        runtime.log('info', `🥀 ${actor.name} 处于禁疗状态，无法自动回复生命！`);
      } else {
        const heal = Math.floor(actor.maxHp * 0.05);
        const healed = healFighter(actor, heal);
        if (healed > 0) {
          runtime.log('heal', `${runtime.statusEffects[status.type]?.icon ?? ''} ${actor.name} 自动回复了 ${healed} 点生命`);
        }
      }
    }
    const tickMode = getStatusTickMode(status.type);
    const statusStillPresent = actor.status.includes(status);
    if (!statusStillPresent) {
      continue;
    }
    if (tickMode !== 'self') {
      nextStatusEntries.push({ original: status, next: status });
    } else if (status.duration > 1) {
      nextStatusEntries.push({ original: status, next: { ...status, duration: status.duration - 1 } });
    } else if (status.duration <= 1) {
      handleSelfTimedStatusExpiry(runtime, actor, status.type);
    }
  }
  const statusesAddedDuringProcessing = actor.status.filter((status) => !processedStatuses.has(status));
  actor.status = [
    ...nextStatusEntries
      .filter(({ original }) => actor.status.includes(original))
      .map(({ next }) => next),
    ...statusesAddedDuringProcessing,
  ];
  syncSpinalSwordState(runtime, actor, true);

  if (actor.status.some((status) => status.type === 'SYNERGY_SLACKING')) {
    return false;
  }

  const controlImmune = findDefenseStatus(actor, 'BKB');
  if (controlImmune && !actor.status.some((status) => status.type === 'SYNERGY_SLACKING')) {
    const hadBlocked = actor.status.some((status) => isStatusType(status.type, BKB_BLOCKED_STATUS_TYPES));
    if (hadBlocked) {
      actor.status = actor.status.filter((status) => !isStatusType(status.type, BKB_BLOCKED_STATUS_TYPES));
      canAct = true;
      runtime.log('info', formatControlCleanse(controlImmune, actor.name));
    }
  }

  if (actor.status.some((status) => status.type === 'STYLE_FOOL') && !canAct) {
    const hadControl = actor.status.some((status) => isStatusType(status.type, CONTROL_STATUS_TYPES));
    if (hadControl) {
      actor.status = actor.status.filter((status) => !isStatusType(status.type, CONTROL_STATUS_TYPES));
      canAct = true;
      runtime.log('info', `🤪 ${actor.name} 笨蛋女人的混沌之力让她对控制免疫，懵懵懂懂地无视了异常状态！`);
    }
  }

  if (actor.jobData?.name === '欧皇' && !canAct && Math.random() < 0.8) {
    canAct = true;
    actor.status = actor.status.filter((status) => !isStatusType(status.type, CONTROL_STATUS_TYPES));
    runtime.log('buff', `👑 ${actor.name} 发动了钞能力！解除了控制状态！`);
  }
  if (!canAct && tryTokusatsuControlThrone(runtime, actor)) {
    canAct = true;
  }
  return canAct;
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
      actor.status.push({ type: 'SPINAL_SWORD', duration: actor.spinalSwordTurns });
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
    actor.status.push({ type: 'PUPPET_MASTER', duration: 999 });
  } else if (!hasPuppet && hasStatus) {
    actor.status = actor.status.filter((status) => status.type !== 'PUPPET_MASTER');
  }
}
