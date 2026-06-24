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
): SkillContext {
  return {
    user,
    target,
    currentTargets,
    fighters: runtime.fighters,
    setLogs: () => {},
    log: (type, text) => runtime.log(type, text),
    getTeamId: (fighter) => runtime.getTeamId(fighter),
    applyDamage: (damageTarget, amount, source, trueDamage, attacker) => runtime.applyDamage(damageTarget, amount, source, trueDamage, attacker ?? user),
    markDefeated: (defeatTarget, options) => runtime.markDefeated(defeatTarget, options),
    triggerDepth,
    executeSkillAction: (id, skillUser, skillTarget, depth) => runtime.executeSkillAction(id, skillUser, skillTarget, depth),
    STATUS_EFFECTS: runtime.statusEffects,
  };
}
