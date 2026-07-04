import type {
  Fighter,
  SkillContext,
} from '../types';
import type { ActionResolutionRuntime } from './types';

export function createSkillContext(
  runtime: ActionResolutionRuntime,
  user: Fighter,
  target: Fighter,
  currentTargets: Fighter[],
  triggerDepth: number,
  actionName?: string,
  trackDeferredDamageTarget?: (fighter: Fighter) => void,
  flushDeferredDamageEvents?: () => void,
  queuePreResolutionLog?: (type: string, text: string) => void,
): SkillContext {
  return {
    user,
    target,
    currentTargets,
    fighters: runtime.fighters,
    setLogs: () => {},
    log: (type, text) => runtime.log(type, text),
    getTeamId: (fighter) => runtime.getTeamId(fighter),
    applyDamage: (damageTarget, amount, source, trueDamage, attacker, options) => {
      const damageAttacker = attacker ?? user;
      const damageOptions = {
        ...options,
        deferTransform: true,
        actionName: options?.actionName ?? actionName,
        respectDefenses: options?.respectDefenses ?? (source === 'skill' && damageTarget.id !== damageAttacker.id),
      };
      const actualDmg = runtime.applyDamage(damageTarget, amount, source, trueDamage, attacker ?? user, damageOptions);
      if (options) {
        if (damageOptions.redirectedByJoker) options.redirectedByJoker = true;
        if (damageOptions.targetDefeatedDuringDamage) options.targetDefeatedDuringDamage = true;
      }
      if (actualDmg > 0) trackDeferredDamageTarget?.(damageTarget);
      return actualDmg;
    },
    markDefeated: (defeatTarget, options) => runtime.markDefeated(defeatTarget, options),
    flushDeferredDamageEvents,
    queuePreResolutionLog,
    triggerDepth,
    executeSkillAction: (id, skillUser, skillTarget, depth) => runtime.executeSkillAction(id, skillUser, skillTarget, depth),
    executeSummonSkill: (skill, skillUser, userTeamId) => runtime.executeSummonSkill(skill, skillUser, userTeamId),
    STATUS_EFFECTS: runtime.statusEffects,
  };
}
