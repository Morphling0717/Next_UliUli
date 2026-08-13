import type { DamageApplicationOptions, Fighter } from '../types';
import { resolveHealing } from '../combatState';
import { runCharacterWaitCounterHooks } from '../characterHooks';
import { getStatusIdentityIdsByTag } from '../statusRegistry';
import { consumeStatusValue, findIdentity, hasIdentity, hasMechanic } from '../statusSystem';
import { buildStatusPresentationMember } from '../statusPresentation';
import { getEffectiveCombatStat } from '../statusMechanics';
import { didDamageConnect } from '../damageRedirects';
import type { ActionResolutionRuntime } from './types';

export function handleWaitCounter(
  runtime: ActionResolutionRuntime,
  target: Fighter,
  user: Fighter,
  triggerDepth: number,
  actionName = '攻击',
): boolean {
  if (hasMechanic(target, 'STAGGERED')) return false;
  if (!hasIdentity(target, 'WAIT_COUNTER') || target.counterUsed) return false;

  const incomingMetadata = {
    actorId: user.id,
    actorName: user.name,
    targetIds: [target.id],
  };
  const counterMetadata = {
    actorId: target.id,
    actorName: target.name,
    targetIds: [user.id],
  };
  runtime.log(
    'info',
    `⚔️ ${user.name} 的【${actionName}】即将命中 ${target.name}，触发等待反击判定！`,
    incomingMetadata,
  );
  const waitingStatus = findIdentity(target, 'WAIT_COUNTER');
  if (waitingStatus) consumeStatusValue(target, waitingStatus, 'charges');
  target.counterUsed = true;
  if (runCharacterWaitCounterHooks({
    target,
    user,
    runtime: runtime.createCharacterHookRuntime(),
    triggerDepth,
  })) return true;

  runtime.log('skill', `🪑 ${target.name} 从借来的椅子上跃起，触发了等待反击！`, counterMetadata);
  runtime.log('info', `🚫 ${user.name} 的当前一击被打断了！`, incomingMetadata);
  const counterDmg = Math.floor(getEffectiveCombatStat(target, 'atk', 'counter') * 2.0);
  const damageOptions: DamageApplicationOptions = { deferTransform: true, actionName: '等待反击' };
  const actualCounterDmg = runtime.applyDamage(user, counterDmg, 'counter', false, target, damageOptions);
  const connected = didDamageConnect(actualCounterDmg, damageOptions);
  runtime.flushDeferredDamageEvents(user, 'mitigation');
  if (actualCounterDmg > 0) {
    runtime.log(
      'crit',
      `💥 强力反击！${target.name} 对 ${user.name} 实际造成 ${actualCounterDmg} 点伤害！`,
      counterMetadata,
    );
  } else if (connected) {
    runtime.log(
      'crit',
      `💥 强力反击成功命中 ${user.name}；但【黄昏余命】期间未再损失生命！`,
      counterMetadata,
    );
  } else {
    runtime.log(
      'info',
      `💥 强力反击被化解，${user.name} 没有承受实际伤害！`,
      counterMetadata,
    );
  }
  if (connected || (user.pendingDamageEvents?.length ?? 0) > 0) runtime.flushDeferredDamageEvents(user);
  if (user.currentHp <= 0) {
    runtime.markDefeated(user, {
      message: `💀 ${user.name} 承受不住反击的威力，被直接击杀了！`,
      killer: target,
    });
  }
  return true;
}

export function isPassiveCharmCounter(fighter: Fighter, counterType: string): boolean {
  return counterType === 'CTR_CHARM' && (hasIdentity(fighter, 'STYLE_SEXY') || hasIdentity(fighter, 'STYLE_EMPEROR'));
}

export function handleCounterStatus(
  runtime: ActionResolutionRuntime,
  target: Fighter,
  user: Fighter,
): boolean {
  if (hasMechanic(target, 'STAGGERED')) return false;
  const counterStatus = getStatusIdentityIdsByTag('counter_stance')
    .map((identityId) => findIdentity(target, identityId))
    .filter((status) => status !== undefined)
    .sort((a, b) => a.appliedSequence - b.appliedSequence)[0];
  if (!counterStatus) return false;
  const logCounter = (type: string, text: string): void => {
    runtime.log(type, text, {
      actorId: target.id,
      actorName: target.name,
      targetIds: [user.id],
    });
  };

  const counterType = counterStatus.mechanicId;
  const isPermanentCharmCounter = isPassiveCharmCounter(target, counterType);
  const triggerChance = isPermanentCharmCounter ? 0.5 : 1.0;
  if (Math.random() > triggerChance) {
    if (!hasIdentity(target, 'STYLE_SEXY') && !hasIdentity(target, 'STYLE_EMPEROR')) {
      consumeStatusValue(target, counterStatus, 'charges');
    }
    return false;
  }

  const counterName = buildStatusPresentationMember(counterStatus).name;
  logCounter('skill', `😈 ${target.name} 受到 ${user.name} 攻击时触发了【${counterName}】！`);
  if (!hasIdentity(target, 'STYLE_SEXY') && !hasIdentity(target, 'STYLE_EMPEROR')) {
    consumeStatusValue(target, counterStatus, 'charges');
  }
  if (counterType === 'CTR_CHARM') {
    if (!runtime.applyStatus(user, { identityId: 'CHARMED', remainingTurns: 2, effectName: '魅惑反击', attribution: { applierId: target.id, applierName: target.name } })) {
      logCounter('info', `😍 【魅惑反击】${target.name} 的魅惑被 ${user.name} 的抗性化解，原攻击继续结算！`);
      return false;
    }
    logCounter('info', `😍 【魅惑反击】${target.name} 反制 ${user.name}，${user.name} 被魅惑 2 回合，当前一击中断！`);
    return true;
  }
  if (counterType === 'CTR_STUN') {
    if (!runtime.applyStatus(user, { identityId: 'STUN', remainingTurns: 2, effectName: '震慑反击', attribution: { applierId: target.id, applierName: target.name } })) {
      logCounter('info', `💫 【震慑反击】${target.name} 的震慑被 ${user.name} 的抗性化解，原攻击继续结算！`);
      return false;
    }
    logCounter('info', `💫 【震慑反击】${target.name} 震慑 ${user.name}，${user.name} 眩晕 2 回合，当前一击中断！`);
    return true;
  }
  if (counterType === 'CTR_DRAIN') {
    logCounter('info', `🧛 【汲取反击】${target.name} 将 300 点真实吸取打向 ${user.name}，先结算对方防护与分摊。`);
    const damageOptions: DamageApplicationOptions = { deferTransform: true, actionName: '汲取反击' };
    const drain = runtime.applyDamage(user, 300, 'counter', true, target, damageOptions);
    const connected = didDamageConnect(drain, damageOptions);
    runtime.flushDeferredDamageEvents(user, 'mitigation');
    const healing = resolveHealing(
      target,
      drain,
      { kind: 'lifesteal', sourceId: '汲取反击', healer: target },
      (type, text) => runtime.log(type, text, {
        actorId: target.id,
        actorName: target.name,
        targetIds: [target.id],
      }),
    );
    if (connected && drain <= 0) {
      logCounter('info', `🧛 【汲取反击】${target.name} 成功命中 ${user.name}；但【黄昏余命】期间没有可汲取的生命，因此未获得治疗！`);
    } else if (drain <= 0) {
      logCounter('info', `🧛 【汲取反击】${target.name} 试图吸取 ${user.name} 的生命，但没有吸到有效生命！`);
    } else if (healing.actual > 0) {
      logCounter('heal', `🧛 【汲取反击】${target.name} 吸取 ${user.name}，${user.name} 实际损失 ${drain} 点生命，${target.name} 恢复了 ${healing.actual} 点生命！`);
    } else if (healing.outcome === 'blocked') {
      logCounter('info', `🧛 【汲取反击】${target.name} 吸取 ${user.name}，${user.name} 实际损失 ${drain} 点生命，但 ${target.name} 的治疗被完全阻止！`);
    } else {
      logCounter('info', `🧛 【汲取反击】${target.name} 吸取 ${user.name}，${user.name} 实际损失 ${drain} 点生命，但 ${target.name} 生命已满，治疗溢出！`);
    }
    if (connected || (user.pendingDamageEvents?.length ?? 0) > 0) runtime.flushDeferredDamageEvents(user);
    if (user.currentHp <= 0) {
      runtime.markDefeated(user, { message: `💀 ${user.name} 被吸干了生命！`, killer: target });
      return true;
    }
  }
  if (counterType === 'CTR_POISON') {
    const applied = runtime.applyStatus(user, { identityId: 'POISON', remainingTurns: 5, attribution: { applierId: target.id, applierName: target.name } });
    logCounter(applied ? 'poison' : 'info', applied
      ? `🦠 【剧毒反击】${target.name} 的毒素缠上 ${user.name}，${user.name} 中毒 5 回合，攻击继续结算！`
      : `🦠 【剧毒反击】${target.name} 释放毒素，但 ${user.name} 化解了中毒效果，攻击继续结算！`);
  }
  if (counterType === 'CTR_BURN') {
    const applied = runtime.applyStatus(user, { identityId: 'BURN', count: 5, attribution: { applierId: target.id, applierName: target.name } });
    if (!applied) {
      logCounter('info', `🔥 【烈焰反击】${target.name} 释放地狱烈焰，但 ${user.name} 化解了灼烧效果，攻击继续结算！`);
    } else if (!runtime.isActiveCombatant(user)) {
      logCounter('poison', `🔥 【烈焰反击】${target.name} 引爆了 ${user.name} 身上的旧火，${user.name} 已经倒下，原攻击中止！`);
      return true;
    } else {
      logCounter('poison', `🔥 【烈焰反击】${target.name} 用地狱烈焰点燃 ${user.name}，${user.name} 燃烧 5 回合，攻击继续结算！`);
    }
  }
  if (counterType === 'CTR_FREEZE') {
    if (!runtime.applyStatus(user, { identityId: 'FREEZE', remainingTurns: 2, effectName: '极寒反击', attribution: { applierId: target.id, applierName: target.name } })) {
      logCounter('info', `🧊 【极寒反击】${target.name} 的寒气被 ${user.name} 的抗性化解，原攻击继续结算！`);
      return false;
    }
    logCounter('poison', `🧊 【极寒反击】${target.name} 冰封 ${user.name}，${user.name} 冻结 2 回合，当前一击中断！`);
    return true;
  }
  if (counterType === 'CTR_VOID') {
    logCounter('info', `🌌 【虚空反击】${target.name} 打开虚空陷阱，500 点真实伤害开始结算防护与分摊。`);
    const damageOptions: DamageApplicationOptions = { deferTransform: true, actionName: '虚空反击' };
    const actualDmg = runtime.applyDamage(user, 500, 'counter', true, target, damageOptions);
    const connected = didDamageConnect(actualDmg, damageOptions);
    runtime.flushDeferredDamageEvents(user, 'mitigation');
    if (actualDmg > 0) {
      logCounter('crit', `🌌 【虚空反击】${target.name} 打开虚空陷阱吞噬 ${user.name}，实际造成 ${actualDmg} 点真实伤害！`);
    } else if (connected) {
      logCounter('crit', `🌌 【虚空反击】虚空陷阱成功吞噬 ${user.name}；但【黄昏余命】期间未再损失生命！`);
    } else {
      logCounter('info', `🌌 【虚空反击】${target.name} 打开虚空陷阱，但 ${user.name} 没有承受实际伤害！`);
    }
    if (connected || (user.pendingDamageEvents?.length ?? 0) > 0) runtime.flushDeferredDamageEvents(user);
    if (user.currentHp <= 0) {
      runtime.markDefeated(user, { message: `💀 ${user.name} 跌入了虚空被粉碎！`, killer: target });
      return true;
    }
  }
  if (counterType === 'CTR_WEAK') {
    if (runtime.applyStatus(user, { identityId: 'WEAK', remainingTurns: 2, attribution: { applierId: target.id, applierName: target.name } })) {
      logCounter('info', `📉 【虚弱反击】${target.name} 削弱 ${user.name}，输出降低 2 回合，攻击继续结算！`);
    } else {
      logCounter('info', `📉 【虚弱反击】${target.name} 的削弱被 ${user.name} 的防护机制拒绝，攻击继续结算！`);
    }
  }
  if (counterType === 'CTR_CONFUSE') {
    if (!runtime.applyStatus(user, { identityId: 'CONFUSED', remainingTurns: 3, effectName: '混乱反击', attribution: { applierId: target.id, applierName: target.name } })) {
      logCounter('info', `🌀 【混乱反击】${target.name} 的认知干扰被 ${user.name} 的抗性化解，原攻击继续结算！`);
      return false;
    }
    logCounter('info', `🌀 【混乱反击】${target.name} 扭曲 ${user.name} 的判断，${user.name} 混乱 3 回合，当前一击中断！`);
    return true;
  }
  if (counterType === 'CTR_EXECUTE') {
    if (user.hpPct < 0.4) {
      const defeated = runtime.markDefeated(user, {
        message: `☠️ 【断头反击】${target.name} 让断头台落下！${user.name} 被直接处决！`,
        killer: target,
        causeName: '断头反击',
        directExecution: true,
      });
      if (!defeated && user.currentHp > 0 && !user.isDead && !user.isDeadAnnounced) {
        logCounter('info', `☠️ 【断头反击】${target.name} 的断头台已经落下，但 ${user.name} 的保命机制强行改写了处决结果，当前一击中断！`);
      }
      return true;
    }
    logCounter('info', `☠️ 【断头反击】${target.name} 锁定 ${user.name}，但 ${user.name} 生命值尚高，逃过一劫！`);
  }
  return false;
}
