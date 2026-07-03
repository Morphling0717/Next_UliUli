import type { DamageApplicationOptions, SkillDefinition } from '../types';
import { namerenaData as Data } from '../data';
import { isActiveCombatant, setCurrentHp } from '../combatState';

const { SKILL_TAGS } = Data;

export const morphlingSkills: Record<string, SkillDefinition> = {
  universal_acid: { name: '万能酸液', tag: SKILL_TAGS.MAG, mult: 1.5, status: 'POISON', text: '🧪 {USER} 喷出高腐蚀性酸液，对 {TARGET} 造成 {VAL} 伤害并中毒！' },
  liquid_mirage: { name: '镜花水月·波涌', tag: SKILL_TAGS.MAG, mult: 2.0, status: 'INVUL', statusSource: 'morphling_liquid_mirage', text: '🌊 枪火在水面上只留下了倒影！{USER} 化作一滩流水穿透了 {TARGET} 的防线！造成 {VAL} 伤害并进入液化无敌状态！' },
  divine_shift: {
    name: '神权·沸腾与绝对零度', tag: SKILL_TAGS.HEAL, mult: 5.0, cleanStatus: true,
    condition: (u) => u.hpPct < 0.3,
    text: '🔄 【神权更迭】！{USER} 的水流躯体剧烈沸腾（蒸发所有负面状态）并瞬间重组！牺牲了部分速度，重塑了 {VAL} 点生命屏障！',
    onExecute: (ctx) => { ctx.user.spd = Math.floor(ctx.user.spd * 0.5); return false; },
  },
  abyssal_prison: {
    name: '深渊水牢', tag: SKILL_TAGS.MAG, mult: 1.5,
    text: '💧 {USER} 抬手升起一座深渊水牢！{TARGET} 引以为傲的反击姿态瞬间瓦解！只能在无尽的窒息中挣扎...',
    afterExecute: (ctx, actualDmg) => {
      if (actualDmg <= 0 || ctx.target.currentHp <= 0) return;
      ctx.target.status = (ctx.target.status ?? []).filter((s) => s.type !== 'WAIT_COUNTER' && !s.type.startsWith('CTR_'));
      ctx.target.status.push({ type: 'WATER_PRISON', duration: 3 });
      if (ctx.target.hpPct < 0.2) {
        setCurrentHp(ctx.target, 0);
        ctx.markDefeated(ctx.target, { message: `💀 【溺毙处决】${ctx.target.name} 在深渊水牢中彻底停止了呼吸...`, killer: ctx.user, setHpZero: false });
      }
    },
  },
  apocalyptic_flood: {
    name: '神罚·灭世大洪水', tag: SKILL_TAGS.MAG, mult: 4.0, ignoreDef: true,
    text: '🌊🌊🌊 【神罚·灭世大洪水】！天地倒转，万物归虚！{USER} 掀起吞噬战场的狂潮，先将 {TARGET} 卷入洪峰，造成 {VAL} 点真实伤害！',
    afterExecute: (ctx, dmg) => {
      const otherEnemies = (ctx.currentTargets ?? []).filter((f) => f.id !== ctx.target.id && !f.isDead);
      for (const e of otherEnemies) {
        if (!isActiveCombatant(ctx.user)) break;
        if (e.currentHp <= 0 || e.isDead || e.isDeadAnnounced || e.status.some((status) => status.type === 'SYNERGY_SLACKING')) continue;
        const damageOptions: DamageApplicationOptions = { actionName: '神罚·灭世大洪水' };
        const actualDmg = ctx.applyDamage(e, dmg, 'skill', false, ctx.user, damageOptions);
        if (damageOptions.redirectedByJoker) continue;
        if (actualDmg > 0) {
          ctx.log('info', `🌊 狂暴洪水吞噬了 ${e.name}，实际造成 ${actualDmg} 点真实伤害！`);
        } else {
          ctx.log('info', `🌊 狂暴洪水卷过 ${e.name}，但没有造成实际伤害！`);
        }
        ctx.flushDeferredDamageEvents?.();
        if (e.currentHp <= 0) ctx.markDefeated(e, { message: `💀 【吞噬击杀】${e.name} 被狂暴的大洪水吞没溺毙！`, killer: ctx.user });
        const idx = (ctx.fighters ?? []).findIndex((x) => x.id === e.id);
        if (idx !== -1) ctx.fighters[idx] = e;
      }
    },
  },
  ethereal_blade: { name: '虚灵之刃', tag: SKILL_TAGS.MAG, mult: 4.5, status: 'ETHEREAL', text: '👻 【Shotgun连招】！{USER} 祭出虚灵之刃！将 {TARGET} 打入虚无界，随后倾泻毁灭性的属性洪流！造成 {VAL} 点核爆魔法伤害！' },
  manta_style: {
    name: '幻影斧', tag: SKILL_TAGS.PHYS, mult: 1.5, hits: 3, ignoreDef: true,
    text: '🪓 斩断枷锁！{USER} 激活幻影斧，驱散一切污秽并幻化出两道水流残影！幻影齐出，对 {TARGET} 造成 3 次真伤连斩（共 {VAL} 伤害）！',
    onExecute: (ctx) => {
      if ((ctx.user.status ?? []).some((s) => s.type === 'ZEROED') && ctx.user.baseStatsForZero) {
        ctx.user.atk = ctx.user.baseStatsForZero.atk;
        ctx.user.def = ctx.user.baseStatsForZero.def;
        ctx.user.res = ctx.user.baseStatsForZero.res;
        ctx.user.wasZeroed = false;
        delete ctx.user.baseStatsForZero;
      }
      ctx.user.status = (ctx.user.status ?? []).filter((s) => s.type === 'LIQUID_BODY');
      ctx.user.agl = Math.floor(ctx.user.agl * 1.5);
      return false;
    },
  },
  eye_of_skadi: {
    name: '斯嘉蒂之眼', tag: SKILL_TAGS.MAG, mult: 2.5, status: 'FREEZE',
    text: '👁️ 感受极北的寒意！{USER} 凝聚斯嘉蒂之眼，射出霜寒水弹！{TARGET} 被绝对零度击中，生机与速度被彻底封印！',
    afterExecute: (ctx, actualDmg) => {
      if (actualDmg <= 0 || ctx.target.currentHp <= 0) return;
      ctx.target.spd = Math.floor(ctx.target.spd * 0.2);
      ctx.target.atk = Math.floor(ctx.target.atk * 0.5);
      ctx.target.status = ctx.target.status ?? [];
      ctx.target.status.push({ type: 'NO_HEAL', duration: 3 });
    },
  },
  linken_sphere: { name: '林肯法球', tag: SKILL_TAGS.BUFF, status: 'SPELL_BLOCK', statusSource: 'morphling_linken_sphere', text: '🔵 庇护之音响起！{USER} 周身凝结出林肯法球的蔚蓝光幕！免疫一切恶意，神明的威压不容侵犯！' },
  khanda: { name: '绝刃', tag: SKILL_TAGS.PHYS, mult: 3.5, ignoreDef: true, alwaysCrit: true, alwaysHit: true, text: '🔪 绝影无形，一击必杀！{USER} 唤醒绝刃，将法术的毁灭与利刃的锋芒融为一体，对 {TARGET} 斩出无法躲避的致命暴击（{VAL}伤害）！' },
  nullifier: {
    name: '否决挂件', tag: SKILL_TAGS.MAG, mult: 2.0, status: 'SILENCE',
    text: '📿 【万法归无】！{USER} 抛出否决挂件！{TARGET} 身上的所有神力、护盾与增益被瞬间强行剥夺！只能以凡人之躯承受降维打击！',
    onExecute: (ctx) => {
      ctx.target.status = (ctx.target.status ?? []).filter(
        (s) => !['INVUL', 'BKB', 'RAGE', 'PLUG_HEAD', 'PLUG_ARM', 'PLUG_BACK', 'PLUG_HEART', 'PLUG_EYE', 'PLUG_SKIN', 'PLUG_LEG', 'PLUG_TAIL', 'SPELL_BLOCK', 'LIQUID_BODY', 'VALO_ULT_EMPRESS', 'VALO_ULT_RUN_IT_BACK', 'DIVA_SONG', 'COUNTER', 'WAIT_COUNTER'].includes(s.type) && !s.type.startsWith('CTR_'),
      );
      return false;
    },
  },
  cosmic_slap: { name: '降维打击', tag: SKILL_TAGS.PHYS, mult: 9.9, ignoreDef: true, text: '🌌 所谓绝对防御，在神明眼中不过是层薄纸！{USER} 伸出高维触手，直接无视了 {TARGET} 的防御！造成 {VAL} 点降维真实伤害！' },
};
