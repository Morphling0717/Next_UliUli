import type { Fighter } from '../types';
import { consumeStatusValue, findIdentity, hasIdentity } from '../statusSystem';
import type { ActionResolutionRuntime } from './types';

export function handleValorantPreFire(
  runtime: ActionResolutionRuntime,
  user: Fighter,
  userTeamId: string,
  targets: Fighter[],
  triggerDepth: number,
): boolean {
  if (triggerDepth !== 0 || user.job === 'VALO_JUNIOR' || targets.length === 0) return false;

  const preFirer = runtime.fighters.find(
    (fighter) =>
      runtime.isActiveCombatant(fighter) &&
      runtime.getTeamId(fighter) !== userTeamId &&
      fighter.job === 'VALO_JUNIOR' &&
      hasIdentity(fighter, 'VALO_HOLDING_ANGLE'),
  );
  if (!preFirer) return false;
  const holdingAngle = findIdentity(preFirer, 'VALO_HOLDING_ANGLE');

  if (hasIdentity(user, 'LIQUID_BODY')) {
    runtime.log('skill', `💧 瓦学妹的提前枪精准命中了 ${user.name}，但子弹仅仅是穿过了水流！攻击并未被截停！`);
    if (holdingAngle) consumeStatusValue(preFirer, holdingAngle, 'charges');
    return false;
  }

  runtime.log('skill', `🔭 【受击截停】${preFirer.name} 提前预瞄了 ${user.name} 的位置，强制先手开火拦截！`);
  if (holdingAngle) consumeStatusValue(preFirer, holdingAngle, 'charges');
  runtime.executeSkillAction('valo_pre_fire', preFirer, user, triggerDepth + 1);
  if (user.isDead || user.isDeadAnnounced || user.currentHp <= 0) {
    return true;
  }
  if (hasIdentity(user, 'VALO_AIM_PUNCH')) {
    runtime.log('info', `🎯 ${user.name} 被提前枪截停（Aim Punch），原有的攻击动作被打断！`);
    return true;
  }
  return false;
}
