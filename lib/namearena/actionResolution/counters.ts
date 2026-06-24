import type { Fighter } from '../types';
import { healFighter } from '../combatState';
import { runCharacterWaitCounterHooks } from '../characterHooks';
import type { ActionResolutionRuntime } from './types';

export function handleWaitCounter(
  runtime: ActionResolutionRuntime,
  target: Fighter,
  user: Fighter,
  triggerDepth: number,
): boolean {
  if (!target.status.some((status) => status.type === 'WAIT_COUNTER') || target.counterUsed) return false;

  target.status = target.status.filter((status) => status.type !== 'WAIT_COUNTER');
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
  const actualCounterDmg = runtime.applyDamage(user, counterDmg, 'counter', false, target);
  if (actualCounterDmg > 0) {
    runtime.log('crit', `💥 强力反击！${target.name} 对 ${user.name} 实际造成 ${actualCounterDmg} 点伤害！`);
  } else {
    runtime.log('info', `💥 强力反击被化解，${user.name} 没有承受实际伤害！`);
  }
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
  const counterStatus = target.status.find((status) => status.type.startsWith('CTR_'));
  if (!counterStatus) return false;

  const counterType = counterStatus.type;
  const isPermanentCharmCounter = isPassiveCharmCounter(target, counterType);
  const triggerChance = isPermanentCharmCounter ? 0.5 : 1.0;
  if (Math.random() > triggerChance) {
    if (!target.status.some((status) => status.type === 'STYLE_SEXY' || status.type === 'STYLE_EMPEROR')) {
      target.status = target.status.filter((status) => status !== counterStatus);
    }
    return false;
  }

  runtime.log('skill', `😈 ${target.name} 触发了【${runtime.statusEffects[counterType]?.name ?? counterType}】！`);
  if (!target.status.some((status) => status.type === 'STYLE_SEXY' || status.type === 'STYLE_EMPEROR')) {
    target.status = target.status.filter((status) => status !== counterStatus);
  }
  if (counterType === 'CTR_CHARM') { user.status.push({ type: 'CHARMED', duration: 2 }); runtime.log('info', `😍 ${user.name} 被魅惑了，停止了攻击！`); return true; }
  if (counterType === 'CTR_STUN') { user.status.push({ type: 'STUN', duration: 2 }); runtime.log('info', `💫 ${user.name} 被震慑眩晕，攻击中断！`); return true; }
  if (counterType === 'CTR_DRAIN') {
    const drain = runtime.applyDamage(user, 300, 'counter', true, target);
    const healed = healFighter(target, drain);
    if (drain <= 0) {
      runtime.log('info', `🧛 ${target.name} 发动汲取反击，但没有从 ${user.name} 身上吸到有效生命！`);
    } else if (healed > 0) {
      runtime.log('heal', `🧛 ${target.name} 发动汲取反击，${user.name} 实际损失 ${drain} 点生命，${target.name} 恢复了 ${healed} 点生命！`);
    } else {
      runtime.log('info', `🧛 ${target.name} 发动汲取反击，${user.name} 实际损失 ${drain} 点生命，但 ${target.name} 生命已满，治疗溢出！`);
    }
    if (user.currentHp <= 0) {
      runtime.markDefeated(user, { message: `💀 ${user.name} 被吸干了生命！`, killer: target });
    }
  }
  if (counterType === 'CTR_POISON') user.status.push({ type: 'POISON', duration: 5 });
  if (counterType === 'CTR_BURN') user.status.push({ type: 'BURN', duration: 5 });
  if (counterType === 'CTR_FREEZE') { user.status.push({ type: 'FREEZE', duration: 2 }); return true; }
  if (counterType === 'CTR_VOID') {
    const actualDmg = runtime.applyDamage(user, 500, 'counter', true, target);
    if (actualDmg > 0) {
      runtime.log('crit', `🌌 虚空反击陷阱启动！吞噬 ${user.name}，实际造成 ${actualDmg} 点真实伤害！`);
    } else {
      runtime.log('info', `🌌 虚空反击陷阱启动，但 ${user.name} 没有承受实际伤害！`);
    }
    if (user.currentHp <= 0) {
      runtime.markDefeated(user, { message: `💀 ${user.name} 跌入了虚空被粉碎！`, killer: target });
    }
  }
  if (counterType === 'CTR_WEAK') { user.atk = Math.floor(user.atk * 0.5); runtime.log('info', `📉 ${user.name} 的攻击力大幅下降！`); }
  if (counterType === 'CTR_CONFUSE') { user.status.push({ type: 'CONFUSED', duration: 3 }); return true; }
  if (counterType === 'CTR_EXECUTE') {
    if (user.hpPct < 0.4) {
      runtime.markDefeated(user, { message: `☠️ 断头台落下！${user.name} 被直接处决！`, killer: target });
      return true;
    }
    runtime.log('info', `☠️ ${user.name} 生命值尚高，逃过一劫！`);
  }
  return false;
}
