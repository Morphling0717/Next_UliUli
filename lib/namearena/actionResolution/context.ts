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
  trackDeferredDamageTarget?: (fighter: Fighter) => void,
  flushDeferredDamageEvents?: () => void,
): SkillContext {
  return {
    user,
    target,
    currentTargets,
    fighters: runtime.fighters,
    setLogs: () => {},
    log: (type, text) => runtime.log(type, text),
    getTeamId: (fighter) => runtime.getTeamId(fighter),
    applyDamage: (damageTarget, amount, source, trueDamage, attacker) => {
      const actualDmg = runtime.applyDamage(damageTarget, amount, source, trueDamage, attacker ?? user, { deferTransform: true });
      if (actualDmg > 0) trackDeferredDamageTarget?.(damageTarget);
      return actualDmg;
    },
    markDefeated: (defeatTarget, options) => runtime.markDefeated(defeatTarget, options),
    flushDeferredDamageEvents,
    triggerDepth,
    executeSkillAction: (id, skillUser, skillTarget, depth) => runtime.executeSkillAction(id, skillUser, skillTarget, depth),
    STATUS_EFFECTS: runtime.statusEffects,
  };
}
