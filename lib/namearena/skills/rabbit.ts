import type { DamageApplicationOptions, SkillDefinition, StatKey, StylePoolEntry } from '../types';
import { namerenaData as Data } from '../data';
import { healFighter, isActiveCombatant } from '../combatState';
import { findDefenseStatus, formatControlBlocked } from '../defenseStatus';
import { tryExecuteDefeat } from '../executionGuards';
import { didDamageConnect, getResolvedDamageTotal, isDamageRedirected } from '../damageRedirects';
import { filterImportantRemovedStatuses, formatRemovedStatusList } from '../statusRemovalLog';
import { hasIdentity, queryMechanic, removeEffects, applyStatus } from '../statusSystem';
import { getSurtrTacticalHpPct } from '../surtrMechanics';

const { SKILL_TAGS } = Data;

export const rabbitSkills: Record<string, SkillDefinition> = {
  q_bunny_idol: {
    name: '偶像打歌', tag: SKILL_TAGS.HEAL, mult: 1.2, text: '🎵 {USER} 开始了爱豆Live！歌声治愈了大家...',
    onExecute: (ctx) => {
      const allies = (ctx.fighters ?? []).filter(
        (f) => isActiveCombatant(f) && ctx.getTeamId(f) === ctx.getTeamId(ctx.user) && !hasIdentity(f, 'SYNERGY_SLACKING'),
      );
      const healAmt = Math.floor(ctx.getEffectiveStat(ctx.user, 'mag') * 1.5);
      let totalHealed = 0;
      const healedNames: string[] = [];
      allies.forEach((a) => {
        const healed = healFighter(a, healAmt, ctx.log);
        if (healed > 0) {
          totalHealed += healed;
          healedNames.push(a.name);
        }
        applyStatus(a, { identityId: 'Q_BUNNY_IDOL_AGL', remainingTurns: 3 });
      });
      const healText = totalHealed > 0
        ? `治疗 ${healedNames.length} 名队友：${healedNames.join('、')}，总计恢复 ${totalHealed} 点生命`
        : '治疗被禁疗或满血溢出';
      ctx.log('heal', `🎵 【偶像打歌】可爱的歌声治愈全队，${healText}，并附加 3 回合闪避加成！`);
      return true;
    },
  },
  q_bunny_attack: {
    name: '萌兔出击', tag: SKILL_TAGS.PHYS, mult: 0.3, alwaysHit: true,
    text: '🥕 {USER} 用短手短脚进行物理攻击... 虽然刮痧但绝对会打中 {TARGET} (造成了 {VAL} 点伤害)！',
  },
  q_bunny_cute: {
    name: '随地卖萌', tag: SKILL_TAGS.DEBUFF, text: '🐰 {USER} 歪头杀！{TARGET} 不忍心下手...',
    onExecute: (ctx) => {
      if (Math.random() < 0.5) {
        if (ctx.applyStatus(ctx.target, { identityId: 'CHARMED', remainingTurns: 2 })) {
          ctx.log('skill', `💕 卖萌暴击！${ctx.target.name} 被迷得神魂颠倒，陷入了魅惑！`);
        }
      } else {
        if (ctx.applyStatus(ctx.target, { identityId: 'WEAK', remainingTurns: 2 })) {
          ctx.log('skill', `📉 ${ctx.target.name} 被萌化了，接下来 2 回合输出大幅下降！`);
        }
      }
      return true;
    },
  },
  q_bunny_offkey: {
    name: '跑调绝杀', tag: SKILL_TAGS.MAG, mult: 2.0, ignoreDef: true, statusApplications: [{ identityId: 'SILENCE' }],
    text: '🎤 {USER} 飙了个极度跑调的高音！魔音贯耳对 {TARGET} 造成了 {VAL} 点真实精神伤害并使其沉默！',
  },
  q_bunny_slide: {
    name: '兔兔滑铲', tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'INVUL', attribution: { effectSourceId: 'rabbit_slide' } }],
    text: '💨 {USER} "弹幕：太矮了根本打不到！" 利用体型优势极限滑铲，获得无敌状态！',
  },
  q_bunny_carrot: {
    name: '狂啃胡萝卜', tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'RABBIT_CARROT' }],
    text: '🥬 {USER} 掏出一根胡萝卜狂啃！获得了持续回血效果，并且速度和敏捷永久提升！',
  },

  v_rabbit_calc_rng: {
    name: '计算器盲按', tag: SKILL_TAGS.SPECIAL,
    directTarget: true,
    spellBlockMode: 'perHit',
    text: '🧮 {USER} 掏出她的发声计算器，开始疯狂盲按...',
    onExecute: (ctx) => {
      const rolls = [
        { type: '114514', text: "🧮 滴—— 1 1 4 5 1 4... {USER} 播放了极其生草的恶臭数字！对 {TARGET} 造成了 {VAL} 点精神伤害并使其深度中毒！" },
        { type: '666666', text: "🧮 滴—— 6 6 6 6 6 6... 弹幕共鸣！{USER} 召唤弹幕狂潮，对 {TARGET} 造成了 6 段魔法打击（共 {VAL} 点伤害）！" },
        { type: '888888', text: "🧮 滴—— 8 8 8 8 8 8... 发发发发！{USER} 给全队发放了豪华恢复福利！" },
        { type: '5201314', text: "🧮 滴—— 5 2 0 1 3 1 4... {USER} 发射了极致的爱心飞吻！对 {TARGET} 造成了 {VAL} 点物理伤害并深度魅惑！" },
        { type: '233333', text: "🧮 滴—— 2 3 3 3 3 3... {USER} 疯狂嘲笑 {TARGET}，气势大增，摆出了绝对防守反击的姿态！" },
        { type: '996007', text: "🧮 滴—— 9 9 6 0 0 7... {USER} 强迫 {TARGET} 无休加班！重压对其造成了 {VAL} 点魔法伤害并附加灼烧，同时速度永久暴跌！" },
      ];

      const roll = rolls[Math.floor(Math.random() * rolls.length)];

      const doDamage = (
        baseDmg: number,
        actionName = '计算器盲按',
      ): { actualDmg: number; resolvedDmg: number; redirected: boolean; connected: boolean } => {
        const targetRes = ctx.getEffectiveStat(ctx.target, 'res');
        const res = ctx.user.jobData?.name === '欧皇' ? Math.floor(targetRes * 0.5) : targetRes;
        let finalDmg = Math.max(1, Math.floor(baseDmg * (1 + Math.random() * 0.2) - res * 0.5));
        if (hasIdentity(ctx.target, 'ETHEREAL')) finalDmg = Math.floor(finalDmg * 2.0);
        const damageOptions: DamageApplicationOptions = { actionName };
        const actualDmg = ctx.applyDamage(ctx.target, finalDmg, 'skill', false, ctx.user, damageOptions);
        const redirected = isDamageRedirected(damageOptions);
        return {
          actualDmg,
          resolvedDmg: getResolvedDamageTotal(actualDmg, damageOptions),
          redirected,
          connected: !redirected && didDamageConnect(actualDmg, damageOptions),
        };
      };

      if (roll.type === '114514') {
        ctx.log('skill', `🧮 滴—— 1 1 4 5 1 4... ${ctx.user.name} 播放极其生草的恶臭数字，精神污染朝 ${ctx.target.name} 扩散！`);
        const { actualDmg: dmg, redirected, connected } = doDamage(Math.floor(ctx.getEffectiveStat(ctx.user, 'mag') * 1.5), '恶臭数字');
        if (redirected) {
          // 屑的转移日志已经说明完整结果。
        } else if (!connected) {
          ctx.log('info', `🧮 恶臭数字扫过 ${ctx.target.name}，但没有造成实际伤害，中毒没有生效！`);
        } else {
          ctx.log('skill', dmg > 0
            ? `🧮 恶臭数字命中 ${ctx.target.name}，实际造成 ${dmg} 点精神伤害！`
            : `🧮 恶臭数字命中 ${ctx.target.name}；但【黄昏余命】期间显示生命已为 0，未再损失生命！`);
          ctx.flushDeferredDamageEvents?.();
          if (isActiveCombatant(ctx.target) && ctx.applyStatus(ctx.target, { identityId: 'POISON', remainingTurns: 3 })) {
            ctx.log('debuff', `🦠 【恶臭数字】${ctx.target.name} 陷入 3 回合深度中毒！`);
          }
        }
      } else if (roll.type === '666666') {
        ctx.log('skill', `🧮 滴—— 6 6 6 6 6 6... 弹幕共鸣！${ctx.user.name} 召唤弹幕狂潮，准备对 ${ctx.target.name} 打出 6 段魔法打击！`);
        let totalDmg = 0;
        let redirectedAny = false;
        let connectedAny = false;
        for (let i = 0; i < 6; i++) {
          if (!isActiveCombatant(ctx.user)) break;
          if (ctx.target.currentHp > 0) {
            let segDmg = Math.floor(ctx.getEffectiveStat(ctx.user, 'mag') * 0.5);
            if (Math.random() < 0.5) segDmg = Math.floor(segDmg * 1.5);
            const segment = doDamage(segDmg, '弹幕共鸣');
            redirectedAny ||= segment.redirected;
            connectedAny ||= segment.connected;
            totalDmg += segment.resolvedDmg;
            if (segment.actualDmg > 0 && !segment.redirected) {
              ctx.log('skill', `🧮 【弹幕共鸣】第 ${i + 1}/6 段命中 ${ctx.target.name}，实际造成 ${segment.actualDmg} 点伤害！`);
            } else if (segment.connected) {
              ctx.log('skill', `🧮 【弹幕共鸣】第 ${i + 1}/6 段命中 ${ctx.target.name}；但【黄昏余命】期间未再损失生命！`);
            }
            ctx.flushDeferredDamageEvents?.();
          }
        }
        if (redirectedAny && totalDmg > 0) {
          ctx.log('crit', `🧮 【弹幕共鸣】6 段打击结算完毕：原目标与分摊/转移承受者合计实际损失 ${totalDmg} 点生命！`);
        } else if (totalDmg > 0) {
          ctx.log('crit', `🧮 【弹幕共鸣】${ctx.user.name} 的 6 段魔法打击结算完毕，对 ${ctx.target.name} 总计造成 ${totalDmg} 点实际伤害！`);
        } else if (redirectedAny) {
          ctx.log('info', `🧮 【弹幕共鸣】6 段打击已被分摊或转移，但所有承受者都没有损失生命！`);
        } else if (connectedAny) {
          ctx.log('info', `🧮 【弹幕共鸣】6 段打击均成功命中 ${ctx.target.name}；但【黄昏余命】期间未再损失生命！`);
        } else {
          ctx.log('info', `🧮 【弹幕共鸣】弹幕狂潮扫过 ${ctx.target.name}，但没有造成实际伤害！`);
        }
      } else if (roll.type === '888888') {
        ctx.log('skill', roll.text.replace(/{USER}/g, ctx.user.name));
        const allies = (ctx.fighters ?? []).filter(
          (f) => isActiveCombatant(f) && ctx.getTeamId(f) === ctx.getTeamId(ctx.user) && !hasIdentity(f, 'SYNERGY_SLACKING'),
        );
        const healAmt = Math.floor(ctx.getEffectiveStat(ctx.user, 'mag') * 2.0);
        const boostedValoNames: string[] = [];
        let totalHealed = 0;
        const healedNames: string[] = [];
        allies.forEach((a) => {
          const healed = healFighter(a, healAmt, ctx.log);
          if (healed > 0) {
            totalHealed += healed;
            healedNames.push(a.name);
          }
          if (a.job === 'VALO_JUNIOR') {
            a.economy = (a.economy ?? 0) + 3;
            boostedValoNames.push(a.name);
          }
        });
        const healText = totalHealed > 0
          ? `治疗 ${healedNames.length} 名队友：${healedNames.join('、')}，总计恢复 ${totalHealed} 点生命`
          : '治疗被禁疗或满血溢出';
        let logMsg = `✨ 【全队福利】发发发！${healText}！`;
        if (boostedValoNames.length > 0) logMsg += `\n💰 联动彩蛋触发：队里的瓦学妹【${boostedValoNames.join('、')}】顺手狂赚了 3 点经济！`;
        ctx.log('heal', logMsg);
      } else if (roll.type === '5201314') {
        ctx.log('skill', `🧮 滴—— 5 2 0 1 3 1 4... ${ctx.user.name} 发射极致的爱心飞吻，试图深度魅惑 ${ctx.target.name}！`);
        const { actualDmg: dmg, redirected, connected } = doDamage(Math.floor(ctx.getEffectiveStat(ctx.user, 'mag') * 0.1), '爱心飞吻');
        if (redirected) {
          // 屑的转移日志已经说明完整结果。
        } else if (!connected) {
          ctx.log('info', `🧮 爱心飞吻擦过 ${ctx.target.name}，但没有造成实际伤害，魅惑没有生效！`);
        } else {
          ctx.log('skill', dmg > 0
            ? `🧮 爱心飞吻命中 ${ctx.target.name}，实际造成 ${dmg} 点物理伤害！`
            : `🧮 爱心飞吻命中 ${ctx.target.name}；但【黄昏余命】期间显示生命已为 0，未再损失生命！`);
          ctx.flushDeferredDamageEvents?.();
          if (isActiveCombatant(ctx.target) && ctx.applyStatus(ctx.target, { identityId: 'CHARMED', remainingTurns: 3 })) {
            ctx.log('debuff', `💕 【爱心飞吻】${ctx.target.name} 陷入 3 回合深度魅惑！`);
          }
        }
      } else if (roll.type === '233333') {
        ctx.log('skill', roll.text.replace(/{USER}/g, ctx.user.name).replace(/{TARGET}/g, ctx.target.name));
        applyStatus(ctx.user, { identityId: 'COUNTER', remainingTurns: 2 });
      } else if (roll.type === '996007') {
        ctx.log('skill', `🧮 滴—— 9 9 6 0 0 7... ${ctx.user.name} 强迫 ${ctx.target.name} 无休加班，重压即将落下！`);
        const { actualDmg: dmg, redirected, connected } = doDamage(Math.floor(ctx.getEffectiveStat(ctx.user, 'mag') * 1.8), '无休加班');
        if (redirected) {
          // 屑的转移日志已经说明完整结果。
        } else if (!connected) {
          ctx.log('info', `🧮 无休加班的重压没有造成实际伤害，灼烧和减速没有生效！`);
        } else {
          ctx.log('skill', dmg > 0
            ? `🧮 无休加班压垮 ${ctx.target.name}，实际造成 ${dmg} 点魔法伤害！`
            : `🧮 无休加班命中 ${ctx.target.name}；但【黄昏余命】期间显示生命已为 0，未再损失生命！`);
          ctx.flushDeferredDamageEvents?.();
          const burnApplied = isActiveCombatant(ctx.target) &&
            ctx.applyStatus(ctx.target, { identityId: 'BURN', count: 3 }) &&
            isActiveCombatant(ctx.target);
          const slowApplied = isActiveCombatant(ctx.target) &&
            ctx.applyStatus(ctx.target, { identityId: 'YUZU_SLOW', remainingTurns: 3 }) &&
            isActiveCombatant(ctx.target);
          const burn = queryMechanic(ctx.target, 'BURN').entries[0];
          const appliedEffects = [
            burnApplied ? `灼烧 ${burn?.potency ?? 0}×${burn?.count ?? 0}` : '',
            slowApplied ? '3 回合减速' : '',
          ].filter(Boolean);
          if (appliedEffects.length > 0) {
            ctx.log('debuff', `🕘 【无休加班】${ctx.target.name} 被附加${appliedEffects.join('与')}！`);
          }
        }
      }

      if (ctx.target.currentHp <= 0 && !ctx.target.isDeadAnnounced && !ctx.target.isDead) {
        ctx.markDefeated(ctx.target, { message: `💀 【击杀】${ctx.target.name} 承受不住这极其离谱的计算器魔法，当场暴毙！`, killer: ctx.user });
      }

      if (!isActiveCombatant(ctx.user)) return true;
      applyStatus(ctx.user, { identityId: 'RABBIT_CALC_HASTE', remainingTurns: 3 });
      ctx.log('info', `⚡ 伴随着按键的残影，${ctx.user.name} 进入【计算超频】状态，接下来 3 次自身行动出手频率提升 13%！`);

      return true;
    },
  },

  v_rabbit_zero: {
    name: '物理『归零』', tag: SKILL_TAGS.SPECIAL, text: '🔘 {USER} 狠狠按下了计算器最上方的键：『归零！』',
    onExecute: (ctx) => {
      ctx.log('skill', `🧮 咔哒！计算器发出了震耳欲聋的审判之音："【归——零——】！！！"`);

      if (ctx.target.job === 'GOD_SLIME') {
        ctx.runReactionAction(ctx.target, {
          skillId: 'water_divine_backlash',
          skillName: '弑神反噬',
          presentation: 'finisher',
          targets: [ctx.user],
          triggerDepth: ctx.triggerDepth + 1,
        }, () => {
          const actualDmg = ctx.applyDamage(ctx.user, 9999, 'skill', true, ctx.target, { actionName: '弑神反噬', respectDefenses: false });
          const metadata = {
            actorId: ctx.target.id,
            actorName: ctx.target.name,
            targetIds: [ctx.user.id],
            visualCue: {
              kind: 'combat_action' as const,
              sourceId: ctx.target.id,
              targetIds: [ctx.user.id],
              presentation: 'finisher' as const,
            },
          };
          if (actualDmg > 0) {
            ctx.log('crit', `⚡ 【弑神反噬】警告！！${ctx.user.name} 试图篡改神明【${ctx.target.name}】的数据！\n神明的绝对威压免疫了归零，降下神罚之雷，实际造成 ${actualDmg} 点真实伤害！`, metadata);
          } else {
            ctx.log('info', `⚡ 【弑神反噬】警告！！${ctx.user.name} 试图篡改神明【${ctx.target.name}】的数据，但神罚没有造成实际伤害！`, metadata);
          }
          ctx.flushDeferredDamageEvents?.();
          if (ctx.user.currentHp <= 0) {
            ctx.markDefeated(ctx.user, { message: `💀 【天谴】${ctx.user.name} 遭到反噬，被劈得灰飞烟灭！`, awardKill: false });
          }
        });
        return true;
      }

      const dispelResult = ctx.dispelStatusEffects(ctx.target, {
        strength: 'strong',
        direction: 'positive',
      });
      const removedStatuses = filterImportantRemovedStatuses(dispelResult.removed);

      ctx.applyStatus(ctx.target, { identityId: 'ZEROED', remainingTurns: 3 });
      applyStatus(ctx.user, { identityId: 'RABBIT_ZERO_HASTE', remainingTurns: 2 });

      ctx.log('skill', `🧮 【归零】降维打击！${ctx.target.name} 的所有正面状态被强行清空，攻击、防御、魔抗在接下来的回合内暴跌至 10%！\n✨ 同时 ${ctx.user.name} 吸收了算力，进入【归零超频】状态，接下来 2 次自身行动出手频率提升 26%！`);
      if (removedStatuses.length > 0) {
        ctx.log('info', `🧮 【归零】明确剥离了 ${ctx.target.name} 的${formatRemovedStatusList(removedStatuses)}，后续伤害将正常结算！`);
      }

      return true;
    },
  },

  v_rabbit_style_switch: {
    name: '切换人设', tag: SKILL_TAGS.BUFF, text: '🎭 {USER} 决定换一个人设...',
    condition: () => false,
    onExecute: (ctx) => {
      const pool: StylePoolEntry[] = Data.TUJUANJUAN_STYLE_POOL ?? [];

      if (hasIdentity(ctx.user, 'STYLE_EMPEROR')) {
        ctx.log('info', `👑 ${ctx.user.name} 已登基为王，不再需要切换人设！`);
        ctx.log('skill', `⚡ 帝皇不可阻挡！${ctx.user.name} 立即发起了无情追击！`);
        const followUpSkills = ['v_rabbit_calc_rng', 'v_rabbit_calc_smash', 'v_rabbit_zero', 'v_rabbit_megaphone'];
        ctx.executeSkillAction(followUpSkills[Math.floor(Math.random() * followUpSkills.length)], ctx.user, ctx.target, ctx.triggerDepth + 1);
        return true;
      }

      const styleStatKeys: StatKey[] = ['atk', 'def', 'spd', 'agl', 'mag', 'res', 'wis'];
      const flatBonuses = Object.fromEntries(styleStatKeys.map((key) => [
        key,
        queryMechanic(ctx.user, `${key.toUpperCase()}_FLAT_UP`).potency,
      ])) as Record<StatKey, number>;
      if (!ctx.user.rabbitStyleBaseStats) {
        ctx.user.rabbitStyleBaseStats = Object.fromEntries(
          styleStatKeys.map((key) => [key, ctx.user[key] + flatBonuses[key]]),
        ) as Record<StatKey, number>;
      } else {
        styleStatKeys.forEach((key) => {
          ctx.user[key] = Math.max(1, ctx.user.rabbitStyleBaseStats![key] - flatBonuses[key]);
        });
      }

      const isEmperor = Math.random() < 0.044;
      const normalPool = pool.filter((p) => p && p.identityId !== 'STYLE_EMPEROR');

      if (normalPool.length === 0) return true;

      const selectedStyle: StylePoolEntry | undefined = isEmperor
        ? pool.find((p) => p.identityId === 'STYLE_EMPEROR')
        : normalPool[Math.floor(Math.random() * normalPool.length)];

      removeEffects(ctx.user, {
        identityIds: [
          'STYLE_SMART', 'STYLE_SEXY', 'STYLE_ANGRY', 'STYLE_FOOL', 'STYLE_VAIN',
          'STYLE_FAMILY', 'STYLE_EMPEROR', 'RABBIT_CHARM_COUNTER',
          'RABBIT_STYLE_RAGE', 'SPELL_BLOCK',
        ],
        reason: 'replaced',
      });

      if (selectedStyle) {
        applyStatus(ctx.user, {
          identityId: selectedStyle.identityId,
          attribution: { effectSourceId: selectedStyle.identityId, applierId: ctx.user.id, applierName: ctx.user.name },
        });

        const effectDesc: string[] = [];

        if (selectedStyle.identityId === 'STYLE_FAMILY') {
          applyStatus(ctx.user, { identityId: 'SPELL_BLOCK', charges: 999, attribution: { effectSourceId: 'rabbit_family_guard' } });
          effectDesc.push('顾家守护法术抵挡');
        }
        if (selectedStyle.identityId === 'STYLE_SEXY' || selectedStyle.identityId === 'STYLE_EMPEROR') {
          applyStatus(ctx.user, {
            identityId: 'RABBIT_CHARM_COUNTER',
            attribution: { effectSourceId: 'rabbit_emperor_counter', applierId: ctx.user.id, applierName: ctx.user.name },
          });
          effectDesc.push('受击概率魅惑敌人');
        }
        if (selectedStyle.identityId === 'STYLE_ANGRY') {
          applyStatus(ctx.user, { identityId: 'RABBIT_STYLE_RAGE' });
          effectDesc.push('自带狂暴 & 半血斩杀');
        }

        const styleStats: Partial<Record<string, string>> = {
          STYLE_SMART: '智力与速度变为 2 倍',
          STYLE_SEXY: '攻击变为 1.2 倍',
          STYLE_ANGRY: '攻击变为 3 倍，防御与魔抗降至 1%',
          STYLE_FAMILY: '防御与魔抗变为 3 倍',
          STYLE_EMPEROR: '攻击、防御、魔抗变为 3 倍，智力与速度变为 2 倍',
        };
        const styleStatText = styleStats[selectedStyle.identityId];
        if (styleStatText) effectDesc.push(styleStatText);

        const descStr = effectDesc.length > 0 ? ` 【人设特性生效：${effectDesc.join(' | ')}】` : '';
        ctx.log('buff', selectedStyle.text.replace(/{USER}/g, ctx.user.name) + descStr);
      }

      ctx.log('skill', `⚡ 【光速切片】换装完毕的 ${ctx.user.name} 并没有浪费回合，立刻无缝衔接了下一次攻击！`);
      const followUpSkills = ['v_rabbit_calc_rng', 'v_rabbit_calc_smash', 'v_rabbit_zero', 'v_rabbit_megaphone'];
      ctx.executeSkillAction(followUpSkills[Math.floor(Math.random() * followUpSkills.length)], ctx.user, ctx.target, ctx.triggerDepth + 1);
      return true;
    },
  },

  v_rabbit_calc_smash: {
    name: '计算器暴击', tag: SKILL_TAGS.PHYS, mult: 3.0,
    text: '💥 {USER} 抡起巨大的发声计算器，狠狠地拍在了 {TARGET} 脸上！造成了 {VAL} 点骨折伤害！',
    alwaysCrit: true,
    afterExecute: (ctx) => {
      if (ctx.damageRedirectedByOriginiumCore || ctx.damageRedirectedByOwlEmperor) return;
      const realtimeHpPct = getSurtrTacticalHpPct(ctx.target);
      if (
        (hasIdentity(ctx.user, 'STYLE_ANGRY') || hasIdentity(ctx.user, 'STYLE_EMPEROR')) &&
        ctx.target.currentHp > 0 &&
        realtimeHpPct < 0.5 &&
        !ctx.target.transformed
      ) {
        tryExecuteDefeat(ctx, ctx.target, '斩杀处决', {
          message: `☠️ 【斩杀处决】处于暴躁女人的极怒状态，${ctx.user.name} 用计算器将残血的 ${ctx.target.name} 直接砸成了肉泥！`,
          killer: ctx.user,
        });
      }
    },
  },

  v_rabbit_undo: {
    name: '等等按错了！', tag: SKILL_TAGS.HEAL, text: '⏪ "等一下，刚才那个不算！重来！" {USER} 狂按计算器上的【CE（清除）】键...',
    onExecute: (ctx) => {
      ctx.log('skill', `🧮 滴滴滴！屏幕上的【114514】被清空！计算器播报："【CE——】清除完毕！"`);

      const allies = (ctx.fighters ?? []).filter(
        (f) => isActiveCombatant(f) && ctx.getTeamId(f) === ctx.getTeamId(ctx.user) && !hasIdentity(f, 'SYNERGY_SLACKING'),
      );
      const healAmt = Math.floor(ctx.getEffectiveStat(ctx.user, 'mag') * 2.0);
      let totalHealed = 0;
      const healedNames: string[] = [];
      allies.forEach((a) => {
        ctx.dispelStatusEffects(a, { strength: 'strong', direction: 'negative' });
        const healed = healFighter(a, healAmt, ctx.log);
        if (healed > 0) {
          totalHealed += healed;
          healedNames.push(a.name);
        }
      });
      const healText = totalHealed > 0
        ? `治疗 ${healedNames.length} 名队友：${healedNames.join('、')}，总计恢复 ${totalHealed} 点生命`
        : '治疗被禁疗或满血溢出';
      ctx.log('heal', `✨ 【CE清除】战局强行回溯！${ctx.user.name} 驱散了我方全员的负面异常状态，${healText}！`);

      ctx.log('skill', `⏪ 时间轴回拨！${ctx.user.name} 白嫖了一个行动回合，立即再次出手！`);
      ctx.executeSkillAction('v_rabbit_calc_rng', ctx.user, ctx.target, ctx.triggerDepth + 1);
      return true;
    },
  },

  v_rabbit_megaphone: {
    name: '扩音处刑', tag: SKILL_TAGS.MAG, ignoreDef: true, text: '🔊 {USER} 掏出大喇叭对准计算器收音孔...',
    spellBlockMode: 'perHit',
    onExecute: (ctx) => {
      const enemies = ctx.currentTargets ?? [];
      const dmg = Math.floor(ctx.getEffectiveStat(ctx.user, 'mag') * 2.5);
      const enemyNames = enemies.map((enemy) => enemy.name).join('、') || '无';
      ctx.setVisualTargets(enemies);
      ctx.log('skill', `🔊 【扩音处刑】大喇叭里传出放大了十倍的魔音："【6666...归零！】" 刺向 ${enemies.length} 名敌人：${enemyNames}！`);
      for (const e of enemies) {
        if (!isActiveCombatant(ctx.user)) break;
        if (e.currentHp <= 0 || e.isDead || e.isDeadAnnounced || hasIdentity(e, 'SYNERGY_SLACKING')) continue;
        const damageOptions: DamageApplicationOptions = { actionName: '扩音处刑' };
        const actualDmg = ctx.applyDamage(e, dmg, 'skill', true, ctx.user, damageOptions);
        if (isDamageRedirected(damageOptions)) continue;
        const connected = didDamageConnect(actualDmg, damageOptions);
        if (damageOptions.targetDefeatedDuringDamage || e.isDead || e.isDeadAnnounced) {
          ctx.flushDeferredDamageEvents?.();
          continue;
        }
        if (!connected) {
          ctx.log('info', `🔊 刺耳魔音擦身而过！${e.name} 没有承受实际伤害，也没有被眩晕！`);
        } else if (actualDmg <= 0) {
          ctx.log('info', `🔊 刺耳魔音贯耳并成功命中 ${e.name}；但【黄昏余命】期间显示生命已为 0，未再损失生命！`);
        } else {
          ctx.log('info', `🔊 刺耳魔音贯耳！${e.name} 实际承受 ${actualDmg} 点真实精神伤害！`);
        }
        ctx.flushDeferredDamageEvents?.();
        if (connected && e.currentHp > 0 && !e.isDead && !e.isDeadAnnounced) {
          const bkbImmune = findDefenseStatus(e, 'BKB');
          const foolImmune = hasIdentity(e, 'STYLE_FOOL');
          const emperorImmune = hasIdentity(e, 'STYLE_EMPEROR');
          if (bkbImmune) {
            ctx.log('info', formatControlBlocked(bkbImmune, e.name, '眩晕效果'));
          } else if (foolImmune) {
            ctx.log('info', `🔊 【笨蛋女人】的混沌脑回路让 ${e.name} 无视了眩晕效果！`);
          } else if (emperorImmune) {
            ctx.log('info', `🔊 【帝皇铠甲】稳住了 ${e.name} 的威仪，眩晕没有生效！`);
          } else if (ctx.applyStatus(e, { identityId: 'STUN', remainingTurns: 1, effectName: '扩音处刑的眩晕效果' })) {
            ctx.log('debuff', `💫 【扩音处刑】${e.name} 被刺耳魔音震晕 1 回合！`);
          }
        }
        if (e.currentHp <= 0 && !e.isDeadAnnounced && !e.isDead) {
          const defeatMessage = e.isOriginiumCore || e.isOriginiumCrystal || e.isPuruisaishi
            ? `💀 【击杀】${e.name} 的源石结构被刺耳魔音震碎！`
            : `💀 【击杀】${e.name} 被魔音贯耳，大脑宕机而亡！`;
          ctx.markDefeated(e, { message: defeatMessage, killer: ctx.user });
        }
      }

      return true;
    },
  },
};
