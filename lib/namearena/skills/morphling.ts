import type { DamageApplicationOptions, SkillDefinition } from '../types';
import { namerenaData as Data } from '../data';
import { applyPermanentStatBuff, clearZeroedStatPenalty, isActiveCombatant } from '../combatState';
import { tryExecuteDefeat } from '../executionGuards';
import { filterImportantRemovedStatuses, formatRemovedStatusList } from '../statusRemovalLog';
import { hasIdentity, removeEffects } from '../statusSystem';
import { getStatusIdentityIdsByTag } from '../statusRegistry';
import { getResolvedDamageTotal } from '../damageRedirects';

const { SKILL_TAGS } = Data;

export const morphlingSkills: Record<string, SkillDefinition> = {
  universal_acid: { name: '万能酸液', tag: SKILL_TAGS.MAG, mult: 1.5, statusApplications: [{ identityId: 'POISON' }], text: '🧪 {USER} 喷出高腐蚀性酸液，对 {TARGET} 造成 {VAL} 伤害并中毒！' },
  liquid_mirage: { name: '镜花水月·波涌', tag: SKILL_TAGS.MAG, mult: 2.0, statusApplications: [{ identityId: 'INVUL', target: 'user', attribution: { effectSourceId: 'morphling_liquid_mirage' } }], text: '🌊 枪火在水面上只留下了倒影！{USER} 化作一滩流水穿透了 {TARGET} 的防线！造成 {VAL} 伤害并进入液化无敌状态！' },
  divine_shift: {
    name: '神权·沸腾与绝对零度', tag: SKILL_TAGS.HEAL, mult: 5.0,
    dispelSpecs: [{ strength: 'absolute', direction: 'negative' }],
    condition: (u) => u.hpPct < 0.3,
    text: '🔄 【神权更迭】！{USER} 的水流躯体剧烈沸腾（绝对驱散可清除的负面状态）并瞬间重组！牺牲了部分速度，重塑了 {VAL} 点生命屏障！',
    onExecute: (ctx) => { applyPermanentStatBuff(ctx.user, { spd: 0.5 }); return false; },
  },
  abyssal_prison: {
    name: '深渊水牢', tag: SKILL_TAGS.MAG, mult: 1.5,
    text: '💧 {USER} 抬手升起一座深渊水牢！{TARGET} 引以为傲的反击姿态瞬间瓦解！只能在无尽的窒息中挣扎...',
    afterExecute: (ctx, actualDmg) => {
      if (ctx.damageRedirectedByOriginiumCore || ctx.damageRedirectedByOwlEmperor || actualDmg <= 0 || ctx.target.currentHp <= 0) return;
      if (!ctx.applyStatus(ctx.target, { identityId: 'WATER_PRISON', remainingTurns: 3 })) return;
      removeEffects(ctx.target, {
        identityIds: ['WAIT_COUNTER', ...getStatusIdentityIdsByTag('counter_stance')],
        reason: 'scripted',
      });
      if (ctx.target.hpPct < 0.2) {
        tryExecuteDefeat(ctx, ctx.target, '溺毙处决', {
          message: `💀 【溺毙处决】${ctx.target.name} 在深渊水牢中彻底停止了呼吸...`,
          killer: ctx.user,
        }, {
          ignoreActiveDeathSave: true,
          blockFreshTransformLock: ctx.targetWasTransformedBeforeDamage === false && !!ctx.target.transformed,
        });
      }
    },
  },
  apocalyptic_flood: {
    name: '神罚·灭世大洪水', tag: SKILL_TAGS.MAG, mult: 4.0, ignoreDef: true,
    text: '🌊🌊🌊 【神罚·灭世大洪水】！天地倒转，万物归虚！{USER} 掀起吞噬战场的狂潮，先将 {TARGET} 卷入洪峰，造成 {VAL} 点真实伤害！',
    afterExecute: (ctx, dmg) => {
      const floodDamage = ctx.preMitigationDamage ?? dmg;
      const otherEnemies = (ctx.currentTargets ?? []).filter((f) => f.id !== ctx.target.id && isActiveCombatant(f));
      for (const e of otherEnemies) {
        if (!isActiveCombatant(ctx.user)) break;
        if (e.currentHp <= 0 || e.isDead || e.isDeadAnnounced || hasIdentity(e, 'SYNERGY_SLACKING')) continue;
        const damageOptions: DamageApplicationOptions = { actionName: '神罚·灭世大洪水' };
        const actualDmg = ctx.applyDamage(e, floodDamage, 'skill', false, ctx.user, damageOptions);
        if (damageOptions.redirectedByJoker) {
          const redirectedDamage = damageOptions.redirectedJokerDamage ?? 0;
          ctx.log('info', redirectedDamage > 0
            ? `🎭 狂暴洪水卷向 ${e.name}，却被【随机恶作剧】转移；原目标未受伤，转移目标实际损失 ${redirectedDamage} 点生命！`
            : `🎭 狂暴洪水卷向 ${e.name}，却被【随机恶作剧】转移；原目标与转移目标都未损失生命！`);
          continue;
        }
        if (damageOptions.redirectedByOriginiumCore) {
          const redirectedDamage = damageOptions.redirectedOriginiumDamage ?? 0;
          ctx.log('info', redirectedDamage > 0
            ? `🟚 狂暴洪水卷向 ${e.name}，被阿喃那导入源石网络；源石结晶合计损失 ${redirectedDamage} 点生命，${e.name} 本体未受伤！`
            : `🟚 狂暴洪水卷向 ${e.name}，被阿喃那导入源石网络，但源石结晶均未损失生命！`);
          continue;
        }
        if (damageOptions.redirectedByOwlEmperor) {
          const redirectedDamage = damageOptions.redirectedOwlEmperorDamage ?? 0;
          ctx.log('info', redirectedDamage > 0
            ? `🐲 狂暴洪水卷向 ${e.name}，被【帝王之征】全数接走，龙实际承受 ${redirectedDamage} 点伤害！`
            : `🐲 狂暴洪水卷向 ${e.name}，被【帝王之征】全数接走，但龙未损失生命！`);
          continue;
        }
        if (damageOptions.redirectedByMomo) {
          const redirectedDamage = damageOptions.redirectedMomoDamage ?? 0;
          ctx.log('info', redirectedDamage > 0
            ? `💗 狂暴洪水卷向 ${e.name}，触发【|OMO】分摊；舰长合计损失 ${redirectedDamage} 点生命，${e.name} 本体未受伤！`
            : `💗 狂暴洪水卷向 ${e.name}，触发【|OMO】分摊，但舰长均未损失生命！`);
          continue;
        }
        if (damageOptions.redirectedByYuzu) {
          const redirectedDamage = getResolvedDamageTotal(actualDmg, damageOptions);
          ctx.log('info', redirectedDamage > 0
            ? `🪞 狂暴洪水卷向 ${e.name}，触发【镜界分摊】；队友合计损失 ${redirectedDamage} 点生命，${e.name} 本体未受伤！`
            : `🪞 狂暴洪水卷向 ${e.name}，触发【镜界分摊】，但队友均未损失生命！`);
          continue;
        }
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
  ethereal_blade: { name: '虚灵之刃', tag: SKILL_TAGS.MAG, mult: 4.5, statusApplications: [{ identityId: 'ETHEREAL' }], text: '👻 【Shotgun连招】！{USER} 祭出虚灵之刃！将 {TARGET} 打入虚无界，随后倾泻毁灭性的属性洪流！造成 {VAL} 点核爆魔法伤害！' },
  manta_style: {
    name: '幻影斧', tag: SKILL_TAGS.PHYS, mult: 1.5, hits: 3, ignoreDef: true,
    text: '🪓 斩断枷锁！{USER} 激活幻影斧，驱散一切污秽并幻化出两道水流残影！幻影齐出，对 {TARGET} 造成 3 次真伤连斩（共 {VAL} 伤害）！',
    onExecute: (ctx) => {
      ctx.log('skill', `🪓 【幻影斧】${ctx.user.name} 斩断自身枷锁，开始驱散污秽并凝聚两道水流残影！`);
      clearZeroedStatPenalty(ctx.user);
      ctx.dispelStatusEffects(ctx.user, {
        strength: 'absolute',
        direction: 'all',
        includeNeutral: true,
        includeIndependent: true,
        excludeIdentityIds: ['LIQUID_BODY'],
      });
      ctx.user.agl = Math.floor(ctx.user.agl * 1.5);
      return false;
    },
  },
  eye_of_skadi: {
    name: '斯嘉蒂之眼', tag: SKILL_TAGS.MAG, mult: 2.5, statusApplications: [{ identityId: 'FREEZE' }],
    text: '👁️ 感受极北的寒意！{USER} 凝聚斯嘉蒂之眼，射出霜寒水弹！{TARGET} 被绝对零度击中，生机与速度被彻底封印！',
    afterExecute: (ctx, actualDmg) => {
      if (ctx.damageRedirectedByOriginiumCore || ctx.damageRedirectedByOwlEmperor || actualDmg <= 0 || ctx.target.currentHp <= 0) return;
      ctx.applyStatus(ctx.target, { identityId: 'YUZU_SLOW', remainingTurns: 3 });
      ctx.applyStatus(ctx.target, { identityId: 'WEAK', remainingTurns: 3 });
      ctx.applyStatus(ctx.target, { identityId: 'NO_HEAL', remainingTurns: 3 });
    },
  },
  linken_sphere: { name: '林肯法球', tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'SPELL_BLOCK', charges: 3, attribution: { effectSourceId: 'morphling_linken_sphere' } }], text: '🔵 庇护之音响起！{USER} 周身凝结出林肯法球的蔚蓝光幕！免疫一切恶意，神明的威压不容侵犯！' },
  khanda: { name: '绝刃', tag: SKILL_TAGS.PHYS, mult: 3.5, ignoreDef: true, alwaysCrit: true, alwaysHit: true, text: '🔪 绝影无形，一击必杀！{USER} 唤醒绝刃，将法术的毁灭与利刃的锋芒融为一体，对 {TARGET} 斩出无法躲避的致命暴击（{VAL}伤害）！' },
  nullifier: {
    name: '否决挂件', tag: SKILL_TAGS.MAG, mult: 2.0, statusApplications: [{ identityId: 'SILENCE' }], alwaysHit: true,
    spellBlockMode: 'afterSetup',
    text: '📿 【万法归无】！{USER} 抛出否决挂件！{TARGET} 身上的所有神力、护盾与增益被瞬间强行剥夺！只能以凡人之躯承受降维打击！',
    onExecute: (ctx) => {
      ctx.log('skill', `📿 【万法归无】${ctx.user.name} 抛出否决挂件，开始剥夺 ${ctx.target.name} 的防护与增益！`);
      const removed = ctx.dispelStatusEffects(ctx.target, {
        strength: 'absolute',
        direction: 'positive',
      }).removed;
      const independentTargets = [...new Set([
        'LIQUID_BODY',
        'TING_DEFIANCE',
        'TOKUSATSU_DEFIANCE',
        'COUNTER',
        'WAIT_COUNTER',
        ...getStatusIdentityIdsByTag('counter_stance'),
        ...getStatusIdentityIdsByTag('chimera_plug'),
        ...getStatusIdentityIdsByTag('rabbit_style'),
      ])].filter((identityId) => hasIdentity(ctx.target, identityId));
      if (independentTargets.length > 0) {
        removed.push(...ctx.dispelStatusEffects(ctx.target, {
          strength: 'absolute',
          direction: 'all',
          includeIndependent: true,
          identityIds: independentTargets,
        }).removed);
      }
      const removedStatuses = filterImportantRemovedStatuses(removed);
      if (removedStatuses.some((status) => status.identityId === 'TOKUSATSU_DEFIANCE')) {
        ctx.target.tokusatsuInstantActionQueued = false;
      }
      if (removedStatuses.length > 0) {
        ctx.queuePreResolutionLog?.('info', `📿 【万法归无】剥夺了 ${ctx.target.name} 的${formatRemovedStatusList(removedStatuses)}，防护与反击链条被切断！`);
      }
      return false;
    },
  },
  cosmic_slap: { name: '降维打击', tag: SKILL_TAGS.PHYS, mult: 9.9, ignoreDef: true, text: '🌌 所谓绝对防御，在神明眼中不过是层薄纸！{USER} 伸出高维触手，直接无视了 {TARGET} 的防御！造成 {VAL} 点降维真实伤害！' },
};
