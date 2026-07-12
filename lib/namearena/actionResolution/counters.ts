import type { Fighter } from '../types';
import { healFighter } from '../combatState';
import { runCharacterWaitCounterHooks } from '../characterHooks';
import { COUNTER_STANCE_STATUS_TYPES, isStatusType } from '../statusRules';
import { consumeStatusCharge } from '../statusLifecycle';
import type { ActionResolutionRuntime } from './types';

export function handleWaitCounter(
  runtime: ActionResolutionRuntime,
  target: Fighter,
  user: Fighter,
  triggerDepth: number,
  actionName = '攻击',
): boolean {
  if (!target.status.some((status) => status.type === 'WAIT_COUNTER') || target.counterUsed) return false;

  runtime.log('info', `⚔️ ${user.name} 的【${actionName}】即将命中 ${target.name}，触发等待反击判定！`);
  const waitingStatus = target.status.find((status) => status.type === 'WAIT_COUNTER');
  if (waitingStatus) consumeStatusCharge(target, waitingStatus);
  target.counterUsed = true;
  if (runCharacterWaitCounterHooks({
    target,
    user,
    runtime: runtime.createCharacterHookRuntime(),
    triggerDepth,
  })) return true;

  runtime.log('skill', `🪑 ${target.name} 从借来的椅子上跃起，触发了等待反击！`);
  runtime.log('info', `🚫 ${user.name} 的攻击被打断了！`);
  const counterDmg = Math.floor(target.atk * 2.0);
  const actualCounterDmg = runtime.applyDamage(user, counterDmg, 'counter', false, target, { deferTransform: true });
  if (actualCounterDmg > 0) {
    runtime.log('crit', `💥 强力反击！${target.name} 对 ${user.name} 实际造成 ${actualCounterDmg} 点伤害！`);
  } else {
    runtime.log('info', `💥 强力反击被化解，${user.name} 没有承受实际伤害！`);
  }
  if (actualCounterDmg > 0 || (user.pendingDamageEvents?.length ?? 0) > 0) runtime.flushDeferredDamageEvents(user);
  if (user.currentHp <= 0) {
    runtime.markDefeated(user, {
      message: `💀 ${user.name} 承受不住反击的威力，被直接击杀了！`,
      killer: target,
    });
  }
  return true;
}

export function isPassiveCharmCounter(fighter: Fighter, counterType: string): boolean {
  return counterType === 'CTR_CHARM' && fighter.status.some((status) => status.type === 'STYLE_SEXY' || status.type === 'STYLE_EMPEROR');
}

export function handleCounterStatus(
  runtime: ActionResolutionRuntime,
  target: Fighter,
  user: Fighter,
): boolean {
  const counterStatus = target.status.find((status) => isStatusType(status.type, COUNTER_STANCE_STATUS_TYPES));
  if (!counterStatus) return false;

  const counterType = counterStatus.type;
  const isPermanentCharmCounter = isPassiveCharmCounter(target, counterType);
  const triggerChance = isPermanentCharmCounter ? 0.5 : 1.0;
  if (Math.random() > triggerChance) {
    if (!target.status.some((status) => status.type === 'STYLE_SEXY' || status.type === 'STYLE_EMPEROR')) {
      consumeStatusCharge(target, counterStatus);
    }
    return false;
  }

  const counterName = runtime.statusEffects[counterType]?.name ?? counterType;
  runtime.log('skill', `😈 ${target.name} 受到 ${user.name} 攻击时触发了【${counterName}】！`);
  if (!target.status.some((status) => status.type === 'STYLE_SEXY' || status.type === 'STYLE_EMPEROR')) {
    consumeStatusCharge(target, counterStatus);
  }
  if (counterType === 'CTR_CHARM') {
    if (!runtime.applyStatus(user, 'CHARMED', 2, { effectName: '魅惑反击' })) {
      runtime.log('info', `😍 【魅惑反击】${target.name} 的魅惑被 ${user.name} 的抗性化解，原攻击继续结算！`);
      return false;
    }
    runtime.log('info', `😍 【魅惑反击】${target.name} 反制 ${user.name}，${user.name} 被魅惑 2 回合，攻击中断！`);
    return true;
  }
  if (counterType === 'CTR_STUN') {
    if (!runtime.applyStatus(user, 'STUN', 2, { effectName: '震慑反击' })) {
      runtime.log('info', `💫 【震慑反击】${target.name} 的震慑被 ${user.name} 的抗性化解，原攻击继续结算！`);
      return false;
    }
    runtime.log('info', `💫 【震慑反击】${target.name} 震慑 ${user.name}，${user.name} 眩晕 2 回合，攻击中断！`);
    return true;
  }
  if (counterType === 'CTR_DRAIN') {
    runtime.log('info', `🧛 【汲取反击】${target.name} 将 300 点真实吸取打向 ${user.name}，先结算对方防护与分摊。`);
    const drain = runtime.applyDamage(user, 300, 'counter', true, target, { deferTransform: true });
    const healed = healFighter(target, drain);
    if (drain <= 0) {
      runtime.log('info', `🧛 【汲取反击】${target.name} 试图吸取 ${user.name} 的生命，但没有吸到有效生命！`);
    } else if (healed > 0) {
      runtime.log('heal', `🧛 【汲取反击】${target.name} 吸取 ${user.name}，${user.name} 实际损失 ${drain} 点生命，${target.name} 恢复了 ${healed} 点生命！`);
    } else {
      runtime.log('info', `🧛 【汲取反击】${target.name} 吸取 ${user.name}，${user.name} 实际损失 ${drain} 点生命，但 ${target.name} 生命已满，治疗溢出！`);
    }
    if (drain > 0 || (user.pendingDamageEvents?.length ?? 0) > 0) runtime.flushDeferredDamageEvents(user);
    if (user.currentHp <= 0) {
      runtime.markDefeated(user, { message: `💀 ${user.name} 被吸干了生命！`, killer: target });
      return true;
    }
  }
  if (counterType === 'CTR_POISON') {
    runtime.applyStatus(user, 'POISON', 5);
    runtime.log('poison', `🦠 【剧毒反击】${target.name} 的毒素缠上 ${user.name}，${user.name} 中毒 5 回合，攻击继续结算！`);
  }
  if (counterType === 'CTR_BURN') {
    runtime.applyStatus(user, 'BURN', 5);
    runtime.log('poison', `🔥 【烈焰反击】${target.name} 用地狱烈焰点燃 ${user.name}，${user.name} 燃烧 5 回合，攻击继续结算！`);
  }
  if (counterType === 'CTR_FREEZE') {
    if (!runtime.applyStatus(user, 'FREEZE', 2, { effectName: '极寒反击' })) {
      runtime.log('info', `🧊 【极寒反击】${target.name} 的寒气被 ${user.name} 的抗性化解，原攻击继续结算！`);
      return false;
    }
    runtime.log('poison', `🧊 【极寒反击】${target.name} 冰封 ${user.name}，${user.name} 冻结 2 回合，攻击中断！`);
    return true;
  }
  if (counterType === 'CTR_VOID') {
    runtime.log('info', `🌌 【虚空反击】${target.name} 打开虚空陷阱，500 点真实伤害开始结算防护与分摊。`);
    const actualDmg = runtime.applyDamage(user, 500, 'counter', true, target, { deferTransform: true });
    if (actualDmg > 0) {
      runtime.log('crit', `🌌 【虚空反击】${target.name} 打开虚空陷阱吞噬 ${user.name}，实际造成 ${actualDmg} 点真实伤害！`);
    } else {
      runtime.log('info', `🌌 【虚空反击】${target.name} 打开虚空陷阱，但 ${user.name} 没有承受实际伤害！`);
    }
    if (actualDmg > 0 || (user.pendingDamageEvents?.length ?? 0) > 0) runtime.flushDeferredDamageEvents(user);
    if (user.currentHp <= 0) {
      runtime.markDefeated(user, { message: `💀 ${user.name} 跌入了虚空被粉碎！`, killer: target });
      return true;
    }
  }
  if (counterType === 'CTR_WEAK') {
    if (runtime.applyStatus(user, 'WEAK', 2)) {
      runtime.log('info', `📉 【虚弱反击】${target.name} 削弱 ${user.name}，输出降低 2 回合，攻击继续结算！`);
    }
  }
  if (counterType === 'CTR_CONFUSE') {
    if (!runtime.applyStatus(user, 'CONFUSED', 3, { effectName: '混乱反击' })) {
      runtime.log('info', `🌀 【混乱反击】${target.name} 的认知干扰被 ${user.name} 的抗性化解，原攻击继续结算！`);
      return false;
    }
    runtime.log('info', `🌀 【混乱反击】${target.name} 扭曲 ${user.name} 的判断，${user.name} 混乱 3 回合，攻击中断！`);
    return true;
  }
  if (counterType === 'CTR_EXECUTE') {
    if (user.hpPct < 0.4) {
      const defeated = runtime.markDefeated(user, { message: `☠️ 【断头反击】${target.name} 让断头台落下！${user.name} 被直接处决！`, killer: target });
      if (!defeated && user.currentHp > 0 && !user.isDead && !user.isDeadAnnounced) {
        runtime.log('info', `☠️ 【断头反击】${target.name} 的断头台已经落下，但 ${user.name} 的保命机制强行改写了处决结果，攻击中断！`);
      }
      return true;
    }
    runtime.log('info', `☠️ 【断头反击】${target.name} 锁定 ${user.name}，但 ${user.name} 生命值尚高，逃过一劫！`);
  }
  return false;
}
