import type {
  Fighter,
  SkillDefinition,
  SkillContext,
} from '../types';
import {
  handleCounterStatus,
  handleWaitCounter,
} from './counters';
import type { ActionResolutionRuntime } from './types';
import { consumeOwlEvadeOpening } from './guards';

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
  skill?: SkillDefinition,
): SkillContext {
  let customDirectOpeningConsumed = false;
  const context: SkillContext = {
    user,
    target,
    currentTargets,
    fighters: runtime.fighters,
    turnCount: runtime.turnCount,
    largeRound: runtime.largeRound,
    setLogs: () => {},
    log: (type, text, metadata) => runtime.log(type, text, metadata),
    getTeamId: (fighter) => runtime.getTeamId(fighter),
    applyDamage: (damageTarget, amount, source, trueDamage, attacker, options) => {
      context.suppressOnHitStatuses = false;
      context.suppressOnHitStatusTargetId = damageTarget.id;
      const damageAttacker = attacker ?? user;
      const pendingEventCountBefore = damageTarget.pendingDamageEvents?.length ?? 0;
      const damageOptions = {
        ...options,
        deferTransform: true,
        actionName: options?.actionName ?? actionName,
        respectDefenses: options?.respectDefenses ?? (source === 'skill' && damageTarget.id !== damageAttacker.id),
      };
      const actualDmg = runtime.applyDamage(damageTarget, amount, source, trueDamage, attacker ?? user, damageOptions);
      const blockedOutcome = damageOptions.resolution?.outcome === 'spell_blocked' ||
        damageOptions.resolution?.outcome === 'invulnerable' ||
        damageOptions.resolution?.outcome === 'prevented';
      if (
        skill?.directTarget &&
        source === 'skill' &&
        !customDirectOpeningConsumed &&
        !blockedOutcome &&
        consumeOwlEvadeOpening(damageTarget, { ...skill, mult: skill.mult ?? 1 }, false)
      ) {
        customDirectOpeningConsumed = true;
        runtime.log('debuff', `🍃 【乘风失衡】${damageTarget.name} 的身位破绽被 ${damageAttacker.name} 抓住，这次直接单体攻击必定命中！`);
      }
      runtime.flushDeferredDamageEvents(damageTarget, 'mitigation');
      if (options) {
        if (damageOptions.redirectedByJoker) options.redirectedByJoker = true;
        if (damageOptions.redirectedJokerDamage !== undefined) options.redirectedJokerDamage = damageOptions.redirectedJokerDamage;
        if (damageOptions.redirectedByOriginiumCore) {
          options.redirectedByOriginiumCore = true;
          options.redirectedOriginiumDamage = damageOptions.redirectedOriginiumDamage ?? actualDmg;
        }
        if (damageOptions.redirectedByOwlEmperor) {
          options.redirectedByOwlEmperor = true;
          options.redirectedOwlEmperorDamage = damageOptions.redirectedOwlEmperorDamage ?? actualDmg;
        }
        if (damageOptions.redirectedByMomo) {
          options.redirectedByMomo = true;
          options.redirectedMomoDamage = damageOptions.redirectedMomoDamage ?? actualDmg;
          options.redirectedMomoTargetIds = damageOptions.redirectedMomoTargetIds
            ? [...damageOptions.redirectedMomoTargetIds]
            : undefined;
          options.redirectedMomoDefeatedTargetIds = damageOptions.redirectedMomoDefeatedTargetIds
            ? [...damageOptions.redirectedMomoDefeatedTargetIds]
            : undefined;
        }
        if (damageOptions.targetDefeatedDuringDamage) options.targetDefeatedDuringDamage = true;
        if (damageOptions.suppressOnHitStatuses) options.suppressOnHitStatuses = true;
        if (damageOptions.resolution) options.resolution = damageOptions.resolution;
      }
      context.suppressOnHitStatuses = !!damageOptions.suppressOnHitStatuses;
      if (damageOptions.redirectedByOriginiumCore || damageOptions.redirectedByOwlEmperor || damageOptions.redirectedByMomo) {
        return 0;
      }
      if (actualDmg > 0 || (damageTarget.pendingDamageEvents?.length ?? 0) > pendingEventCountBefore) {
        trackDeferredDamageTarget?.(damageTarget);
      }
      return actualDmg;
    },
    markDefeated: (defeatTarget, options) => runtime.markDefeated(defeatTarget, options),
    applyStatus: (statusTarget, type, duration, options) => {
      if (
        context.suppressOnHitStatuses &&
        context.suppressOnHitStatusTargetId === statusTarget.id
      ) {
        return false;
      }
      return runtime.applyStatus(statusTarget, type, duration, {
        ...options,
        applierId: options?.applierId ?? user.id,
        applierName: options?.applierName ?? user.name,
      });
    },
    handleWaitCounter: (counterTarget, counterUser, counterActionName) =>
      handleWaitCounter(runtime, counterTarget, counterUser, triggerDepth, counterActionName ?? actionName),
    handleCounterStatus: (counterTarget, counterUser) =>
      handleCounterStatus(runtime, counterTarget, counterUser),
    flushDeferredDamageEvents,
    queuePreResolutionLog,
    triggerDepth,
    executeSkillAction: (id, skillUser, skillTarget, depth) => runtime.executeSkillAction(id, skillUser, skillTarget, depth),
    executeSummonSkill: (skill, skillUser, userTeamId) => runtime.executeSummonSkill(skill, skillUser, userTeamId),
    STATUS_EFFECTS: runtime.statusEffects,
  };
  return context;
}
