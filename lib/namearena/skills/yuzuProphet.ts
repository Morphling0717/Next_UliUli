import {
  getOriginiumInfectionStacks,
  ORIGINIUM_DISEASE_STATUS,
  ORIGINIUM_MAX_STACKS,
} from '../puruisaishiMechanics';
import type { SkillDefinition } from '../types';

export const yuzuProphetSkills: Record<string, SkillDefinition> = {
  yuzu_prophet_wrong_time: {
    name: '你不该存在于此时',
    tag: 'special',
    noDamage: true,
    text: '🜲 {USER} 从被接管者中指定一人，命令其与绑定柚子拼点并释放技能。',
  },
  yuzu_prophet_wrong_place: {
    name: '你不该存在于此地',
    tag: 'special',
    noDamage: true,
    text: '🜲 {USER} 连续下达三次召唤物释放指令，每次分别与绑定柚子拼点。',
  },
  yuzu_prophet_shatter: {
    name: '我将击碎',
    tag: 'special',
    presentation: 'finisher',
    noDamage: true,
    text: '🜲 {USER} 指定一名被接管者连续释放三次技能，并在成功攻击后引爆震颤。',
  },
  yuzu_prophet_originium_land: {
    name: '源石，开满大地',
    tag: 'debuff',
    noDamage: true,
    text: '◆ {USER} 抹除一枚普通源石结晶，与目标拼点；胜利后施加矿石病与沉沦。',
  },
  yuzu_prophet_understand_puruisaishi: {
    name: '普瑞赛斯，我理解你',
    tag: 'magical',
    noDamage: true,
    text: '🜲 {USER} 为普瑞赛斯增加护盾并与目标拼点；胜利后对全部非 NPC 单位发动源石冲击。',
  },
  yuzu_prophet_execute_originium_plan: {
    name: '必须执行源石计划',
    tag: 'magical',
    presentation: 'finisher',
    noDamage: true,
    text: '🜲 {USER} 确认场上存在可斩杀目标后，依次攻击全部非 NPC 单位。',
  },
  yuzu_prophet_understand_hit: {
    name: '普瑞赛斯，我理解你',
    tag: 'magical',
    alwaysHit: true,
    damageSourceKind: 'custom',
    damageFormula: (user, target, _fighters, getEffectiveStat) =>
      Math.max(1, Math.floor(
        getEffectiveStat(user, 'mag') * 1.25 +
        target.maxHp * 0.035 -
        getEffectiveStat(target, 'res') * 0.35,
      )),
    text: '🜲 【普瑞赛斯，我理解你】源石冲击命中 {TARGET}，造成 {VAL} 点法术伤害！',
  },
  yuzu_prophet_originium_land_release: {
    name: '源石，开满大地',
    tag: 'debuff',
    noDamage: true,
    directTarget: true,
    text: '◆ 【源石，开满大地】{USER} 令源石在 {TARGET} 的命运中生根。',
    onExecute: (ctx) => {
      const before = getOriginiumInfectionStacks(ctx.target);
      const infectionApplied = ctx.applyStatus(ctx.target, {
        identityId: ORIGINIUM_DISEASE_STATUS,
        potency: 10,
        effectName: '源石，开满大地',
      });
      const after = getOriginiumInfectionStacks(ctx.target);
      if (infectionApplied && after > before) {
        ctx.log('poison', `🦠 【源石，开满大地】${ctx.target.name} 矿石病 +${after - before}（${after}/${ORIGINIUM_MAX_STACKS}）。`);
      }
      if (ctx.target.currentHp > 0) {
        ctx.applyStatus(ctx.target, {
          identityId: 'SINKING',
          potency: 10,
          count: 2,
          effectName: '源石，开满大地',
        });
      }
      if (after >= ORIGINIUM_MAX_STACKS && ctx.target.currentHp > 0) {
        ctx.markDefeated(ctx.target, {
          message: `💀 【矿石病】${ctx.target.name} 的矿石病达到 ${ORIGINIUM_MAX_STACKS} 层，身体被源石彻底吞没！`,
          causeName: `矿石病达到 ${ORIGINIUM_MAX_STACKS} 层`,
          awardKill: false,
        });
      }
      return true;
    },
  },
  yuzu_prophet_execute_hit: {
    name: '必须执行源石计划',
    tag: 'magical',
    presentation: 'finisher',
    alwaysHit: true,
    cannotCrit: true,
    damageSourceKind: 'custom',
    damageFormula: (user, target, _fighters, getEffectiveStat) =>
      Math.max(1, Math.floor(
        getEffectiveStat(user, 'mag') * 2.25 +
        target.maxHp * 0.1 -
        getEffectiveStat(target, 'res') * 0.3,
      )),
    text: '🜲 【必须执行源石计划】源石斩杀冲击命中 {TARGET}，造成 {VAL} 点法术伤害！',
  },
};
