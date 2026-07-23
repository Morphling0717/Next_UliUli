import type { DefeatOptions, Fighter, SkillContext } from './types';
import { hasIdentity } from './statusSystem';

interface ExecuteDefeatGuardOptions {
  ignoreActiveDeathSave?: boolean;
  blockFreshTransformLock?: boolean;
}

const ACTIVE_DEATH_SAVE_STATUS_TYPES = new Set([
  'TING_DEFIANCE',
  'TOKUSATSU_DEFIANCE',
]);

export function hasActiveDeathSave(target: Fighter): boolean {
  return [...ACTIVE_DEATH_SAVE_STATUS_TYPES].some((identityId) => hasIdentity(target, identityId)) ||
    !!target.tokusatsuInstantActionQueued;
}

export function tryExecuteDefeat(
  ctx: SkillContext,
  target: Fighter,
  actionName: string,
  options: DefeatOptions,
  guardOptions: ExecuteDefeatGuardOptions = {},
): boolean {
  if (guardOptions.blockFreshTransformLock) {
    ctx.log('info', `🛡️ 【${actionName}】${target.name} 刚刚触发阶段锁血，必须完成二阶段登场，处决无法跳过这次锁血！`);
    return false;
  }
  if (!guardOptions.ignoreActiveDeathSave && hasActiveDeathSave(target)) {
    ctx.log('info', `🛡️ 【${actionName}】${target.name} 的保命机制刚刚生效，强行改写了处决结果！`);
    return false;
  }
  return ctx.markDefeated(target, options);
}
