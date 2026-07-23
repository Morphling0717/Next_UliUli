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
import { getEffectiveCombatStat } from '../statusMechanics';
import { isDamageRedirected } from '../damageRedirects';

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
  let actionVisualEmitted = false;
  let declaredVisualTargetIds: string[] | undefined;
  let lastAffectedTargetId: string | undefined;
  const isSupportSkill = skill?.tag === 'heal' || skill?.tag === 'buff';
  const actionPresentation = skill?.presentation ?? 'skill';
  const context: SkillContext = {
    user,
    target,
    currentTargets,
    fighters: runtime.fighters,
    turnCount: runtime.turnCount,
    largeRound: runtime.largeRound,
    log: (type, text, metadata) => {
      const visualTargetIds = metadata?.targetIds ?? (
        !actionVisualEmitted && declaredVisualTargetIds?.length
          ? declaredVisualTargetIds
          : [isSupportSkill ? user.id : lastAffectedTargetId ?? context.target.id]
      );
      const canAnchorAction = isSupportSkill
        ? type === 'buff' || type === 'heal' || type === 'skill'
        : type === 'skill' || type === 'crit' || type === 'poison';
      const explicitVisual = metadata?.visualCue;
      const visualCue = explicitVisual ?? (!actionVisualEmitted && canAnchorAction ? {
        kind: 'combat_action' as const,
        sourceId: user.id,
        targetIds: visualTargetIds,
        presentation: actionPresentation,
        ...(skill?.visualEffect ? { effectId: skill.visualEffect } : {}),
      } : undefined);
      if (visualCue) actionVisualEmitted = true;
      runtime.log(type, text, {
        ...metadata,
        targetIds: visualTargetIds,
        ...(visualCue ? { visualCue } : {}),
      });
    },
    setVisualTargets: (targets) => {
      if (actionVisualEmitted) return;
      declaredVisualTargetIds = [...new Set(targets.map((fighter) => fighter.id))];
    },
    getTeamId: (fighter) => runtime.getTeamId(fighter),
    getEffectiveStat: (fighter, key) => getEffectiveCombatStat(fighter, key, 'custom'),
    applyDamage: (damageTarget, amount, source, trueDamage, attacker, options) => {
      lastAffectedTargetId = damageTarget.id;
      context.suppressOnHitStatuses = false;
      context.suppressOnHitStatusTargetId = damageTarget.id;
      const damageAttacker = attacker ?? user;
      const pendingEventCountBefore = damageTarget.pendingDamageEvents?.length ?? 0;
      const damageOptions = {
        ...options,
        deferTransform: true,
        actionName: options?.actionName ?? actionName,
        respectDefenses: options?.respectDefenses ?? (source === 'skill' && damageTarget.id !== damageAttacker.id),
        sourceKind: options?.sourceKind ?? (source === 'skill' ? (skill?.damageSourceKind ?? (skill?.directTarget ? 'custom' : 'manual')) : undefined),
        damageScope: options?.damageScope ?? (skill?.tag === 'magical' || skill?.tag === 'debuff' ? 'magical' : 'physical'),
        statusHitCount: options?.statusHitCount ?? skill?.statusHitCount ?? 1,
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
        if (damageOptions.redirectedByYuzu) {
          options.redirectedByYuzu = true;
          options.redirectedYuzuDamage = damageOptions.redirectedYuzuDamage ?? 0;
          options.redirectedYuzuTargetIds = damageOptions.redirectedYuzuTargetIds
            ? [...damageOptions.redirectedYuzuTargetIds]
            : undefined;
          options.redirectedYuzuDefeatedTargetIds = damageOptions.redirectedYuzuDefeatedTargetIds
            ? [...damageOptions.redirectedYuzuDefeatedTargetIds]
            : undefined;
        }
        if (damageOptions.targetDefeatedDuringDamage) options.targetDefeatedDuringDamage = true;
        if (damageOptions.suppressOnHitStatuses) options.suppressOnHitStatuses = true;
        if (damageOptions.resolution) options.resolution = damageOptions.resolution;
      }
      if (isDamageRedirected(damageOptions)) {
        runtime.log('system', `state-sync:${damageTarget.id}`, {
          displayInFeed: false,
          targetIds: [damageTarget.id],
        });
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
    markDefeated: (defeatTarget, options) => {
      lastAffectedTargetId = defeatTarget.id;
      return runtime.markDefeated(defeatTarget, options);
    },
    applyStatus: (statusTarget, application) => {
      lastAffectedTargetId = statusTarget.id;
      if (
        context.suppressOnHitStatuses &&
        context.suppressOnHitStatusTargetId === statusTarget.id
      ) {
        return false;
      }
      return runtime.applyStatus(statusTarget, {
        ...application,
        attribution: {
          ...application.attribution,
          effectSourceId: application.attribution?.effectSourceId ?? application.identityId,
          applierId: application.attribution?.applierId ?? user.id,
          applierName: application.attribution?.applierName ?? user.name,
          creditActorId: application.attribution?.creditActorId ?? user.id,
        },
      });
    },
    dispelStatusEffects: (statusTarget, options) => {
      lastAffectedTargetId = statusTarget.id;
      return runtime.dispelStatusEffects(statusTarget, options);
    },
    handleWaitCounter: (counterTarget, counterUser, counterActionName) =>
      handleWaitCounter(runtime, counterTarget, counterUser, triggerDepth, counterActionName ?? actionName),
    handleCounterStatus: (counterTarget, counterUser) =>
      handleCounterStatus(runtime, counterTarget, counterUser),
    flushDeferredDamageEvents,
    queuePreResolutionLog,
    triggerDepth,
    executeSkillAction: (id, skillUser, skillTarget, depth) => runtime.executeSkillAction(id, skillUser, skillTarget, depth),
    runReactionAction: (actor, descriptor, callback) => runtime.runReactionAction(actor, descriptor, callback),
    executeSummonSkill: (skill, skillUser, userTeamId) => runtime.executeSummonSkill(skill, skillUser, userTeamId),
  };
  return context;
}
