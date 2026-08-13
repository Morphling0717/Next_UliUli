import { isActiveCombatant, resolveHealing } from '../combatState';
import { isSelectableTargetFor } from '../targeting';
import {
  isSurtrAfterglowActive,
  SURTR_MAGIC_RESISTANCE_PENETRATION,
  SURTR_TWILIGHT_MAX_HP_GAIN,
} from '../surtrMechanics';
import type { Fighter, SkillContext, SkillDefinition } from '../types';

function activeEnemies(ctx: SkillContext): Fighter[] {
  return ctx.fighters.filter((fighter) =>
    isSelectableTargetFor({
      fighters: ctx.fighters,
      turnCount: ctx.turnCount,
      battleState: ctx.battleState,
      getTeamId: ctx.getTeamId,
      isActiveCombatant,
    }, ctx.user, fighter),
  );
}

function randomDistinctEnemies(ctx: SkillContext, limit: number): Fighter[] {
  const pool = activeEnemies(ctx);
  const forced = ctx.user.confusedForcedTargetId
    ? pool.find((fighter) => fighter.id === ctx.user.confusedForcedTargetId)
    : undefined;
  const remaining = forced ? pool.filter((fighter) => fighter.id !== forced.id) : pool;
  for (let index = remaining.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [remaining[index], remaining[swapIndex]] = [remaining[swapIndex]!, remaining[index]!];
  }
  return (forced ? [forced, ...remaining] : remaining).slice(0, limit);
}

function executeDistinctImpacts(
  ctx: SkillContext,
  targets: Fighter[],
  skillId: string,
): void {
  const resolvedTargetIds = new Set<string>();
  for (const plannedTarget of targets) {
    if (!isActiveCombatant(ctx.user)) break;
    const previousForcedTargetId = ctx.user.confusedForcedTargetId;
    ctx.user.confusedForcedTargetId = plannedTarget.id;
    const plannedTargetStillValid = (
      isActiveCombatant(plannedTarget) &&
      !resolvedTargetIds.has(plannedTarget.id) &&
      isSelectableTargetFor({
        fighters: ctx.fighters,
        turnCount: ctx.turnCount,
        battleState: ctx.battleState,
        getTeamId: ctx.getTeamId,
        isActiveCombatant,
      }, ctx.user, plannedTarget)
    );
    ctx.user.confusedForcedTargetId = previousForcedTargetId;
    let target = plannedTargetStillValid ? plannedTarget : undefined;
    if (!target) {
      const selectableTargets = activeEnemies(ctx).filter((candidate) =>
        !resolvedTargetIds.has(candidate.id),
      );
      target = selectableTargets[Math.floor(Math.random() * selectableTargets.length)];
      if (!target) continue;
      const actionName = skillId === 'surtr_twilight_hit' ? '黄昏' : '熔核巨影';
      ctx.log(
        'info',
        `🔥 【${actionName}·目标重校】战场关系发生变化，${plannedTarget.name} 已不再是合法目标，${ctx.user.name} 的后续斩击改为追击 ${target.name}。`,
        { actorId: ctx.user.id, actorName: ctx.user.name, targetIds: [target.id] },
      );
    }
    resolvedTargetIds.add(target.id);
    ctx.user.confusedForcedTargetId = target.id;
    try {
      ctx.executeSkillAction(skillId, ctx.user, target, ctx.triggerDepth + 1);
    } finally {
      ctx.user.confusedForcedTargetId = previousForcedTargetId;
    }
  }
}

export const surtrSkills: Record<string, SkillDefinition> = {
  surtr_flame_sword: {
    name: '烈焰魔剑',
    tag: 'magical',
    mult: 3.10,
    flatDefensePenetration: SURTR_MAGIC_RESISTANCE_PENETRATION,
    visualEffect: 'summon_surtr_laeva',
    text: '🔥 {USER} 挥动烈焰魔剑斩向 {TARGET}，造成 {VAL} 点法术伤害！',
  },

  surtr_molten_shadow: {
    name: '熔核巨影',
    tag: 'magical',
    spellBlockMode: 'perHit',
    visualEffect: 'summon_surtr_laeva',
    text: '🔥 {USER} 唤起熔核巨影：一个也别想逃走！',
    onExecute: (ctx) => {
      const targets = randomDistinctEnemies(ctx, 2);
      if (targets.length === 0) return true;
      const singleTarget = targets.length === 1;
      ctx.setVisualTargets(targets);
      ctx.log(
        'skill',
        singleTarget
          ? `🔥 【熔核巨影】${ctx.user.name} 只找到 ${targets[0]!.name} 一名敌人，熔核力量集中为攻击 × 260%！`
          : `🔥 【熔核巨影】${ctx.user.name} 锁定 ${targets.map((target) => target.name).join('、')}，分别以攻击 × 220% 发动法术斩击！`,
        { actorId: ctx.user.id, actorName: ctx.user.name, targetIds: targets.map((target) => target.id) },
      );
      executeDistinctImpacts(
        ctx,
        targets,
        singleTarget ? 'surtr_molten_shadow_single_hit' : 'surtr_molten_shadow_split_hit',
      );
      return true;
    },
  },

  surtr_molten_shadow_split_hit: {
    name: '熔核巨影',
    tag: 'magical',
    scalingStat: 'atk',
    mult: 2.20,
    flatDefensePenetration: SURTR_MAGIC_RESISTANCE_PENETRATION,
    visualEffect: 'summon_surtr_laeva',
    text: '🔥 {USER} 的熔核巨影斩中 {TARGET}，造成 {VAL} 点法术伤害！',
  },

  surtr_molten_shadow_single_hit: {
    name: '熔核巨影·集中',
    tag: 'magical',
    scalingStat: 'atk',
    mult: 2.60,
    flatDefensePenetration: SURTR_MAGIC_RESISTANCE_PENETRATION,
    visualEffect: 'summon_surtr_laeva',
    text: '🔥 {USER} 将熔核巨影集中斩向 {TARGET}，造成 {VAL} 点法术伤害！',
  },

  surtr_twilight: {
    name: '黄昏',
    tag: 'magical',
    presentation: 'finisher',
    spellBlockMode: 'perHit',
    condition: (user) => !!user.surtrState && !user.surtrState.twilightUsed && !isSurtrAfterglowActive(user),
    visualEffect: 'summon_surtr_laeva',
    text: '🌇 {USER} 高举莱万汀，发动仅此一次的【黄昏】！',
    onExecute: (ctx) => {
      const state = ctx.user.surtrState;
      if (!state || state.twilightUsed || isSurtrAfterglowActive(ctx.user)) {
        ctx.log('info', `🌇 ${ctx.user.name} 的【黄昏】已经燃尽，本局不能再次发动。`);
        return true;
      }

      state.twilightUsed = true;
      state.twilightActivatedTurn = ctx.turnCount;
      ctx.user.maxHp += SURTR_TWILIGHT_MAX_HP_GAIN;
      const missingHp = Math.max(0, ctx.user.maxHp - ctx.user.currentHp);
      const healing = resolveHealing(ctx.user, missingHp, {
        kind: 'direct',
        sourceId: '黄昏',
        healer: ctx.user,
      }, ctx.log);
      const targets = randomDistinctEnemies(ctx, 4);
      ctx.setVisualTargets(targets);
      const healText = healing.actual > 0
        ? `恢复 ${healing.actual} 点生命，当前 ${ctx.user.currentHp}/${ctx.user.maxHp}`
        : healing.outcome === 'blocked'
          ? `治疗被禁疗完全阻止，当前仍为 ${ctx.user.currentHp}/${ctx.user.maxHp}`
          : `生命已经达到 ${ctx.user.currentHp}/${ctx.user.maxHp}`;
      ctx.log(
        'crit',
        `🌇 【黄昏】${ctx.user.name}：“莱万汀！”最大生命永久 +${SURTR_TWILIGHT_MAX_HP_GAIN}，${healText}；本局唯一一次黄昏已经消耗，并锁定 ${targets.length} 名目标。`,
        { actorId: ctx.user.id, actorName: ctx.user.name, targetIds: targets.map((target) => target.id) },
      );
      executeDistinctImpacts(ctx, targets, 'surtr_twilight_hit');
      if (isActiveCombatant(ctx.user)) {
        ctx.log('debuff', `🌇 【黄昏流失启动】${ctx.user.name} 将从下一次自身行动机会结束时流失 1% 最大生命，之后逐次递增，最高 20%。`);
      }
      return true;
    },
  },

  surtr_twilight_hit: {
    name: '黄昏',
    tag: 'magical',
    presentation: 'finisher',
    scalingStat: 'atk',
    mult: 4.30,
    flatDefensePenetration: SURTR_MAGIC_RESISTANCE_PENETRATION,
    visualEffect: 'summon_surtr_laeva',
    text: '🌇 {USER} 用莱万汀斩过 {TARGET}，造成 {VAL} 点法术伤害！',
  },
};
