import type { DamageApplicationOptions, SkillDefinition, StatKey, StylePoolEntry } from '../types';
import { namerenaData as Data } from '../data';
import { healFighter, isActiveCombatant, setCurrentHp } from '../combatState';

const { SKILL_TAGS } = Data;

function refreshStatus(userStatus: { type: string; duration: number }[], type: string, duration: number): void {
  const existing = userStatus.find((status) => status.type === type);
  if (existing) {
    existing.duration = Math.max(existing.duration, duration);
  } else {
    userStatus.push({ type, duration });
  }
}

export const rabbitSkills: Record<string, SkillDefinition> = {
  q_bunny_idol: {
    name: '偶像打歌', tag: SKILL_TAGS.HEAL, mult: 1.2, text: '🎵 {USER} 开始了爱豆Live！歌声治愈了大家...',
    onExecute: (ctx) => {
      const allies = (ctx.fighters ?? []).filter(
        (f) => !f.isDead && ctx.getTeamId(f) === ctx.getTeamId(ctx.user) && !(f.status ?? []).some((s) => s.type === 'SYNERGY_SLACKING'),
      );
      const healAmt = Math.floor(ctx.user.mag * 1.5);
      let totalHealed = 0;
      const healedNames: string[] = [];
      allies.forEach((a) => {
        if (!(a.status ?? []).some((s) => s.type === 'NO_HEAL')) {
          const healed = healFighter(a, healAmt);
          if (healed > 0) {
            totalHealed += healed;
            healedNames.push(a.name);
          }
        }
        a.status = a.status ?? [];
        const existing = a.status.find((s) => s.type === 'Q_BUNNY_IDOL_AGL');
        if (existing) {
          existing.duration = 3;
        } else {
          a.status.push({ type: 'Q_BUNNY_IDOL_AGL', duration: 3 });
        }
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
      ctx.target.status = ctx.target.status ?? [];
      if (Math.random() < 0.5) {
        ctx.target.status.push({ type: 'CHARMED', duration: 2 });
        ctx.log('skill', `💕 卖萌暴击！${ctx.target.name} 被迷得神魂颠倒，陷入了魅惑！`);
      } else {
        ctx.target.atk = Math.max(1, Math.floor(ctx.target.atk * 0.7));
        ctx.log('skill', `📉 ${ctx.target.name} 被萌化了，攻击力大幅下降！`);
      }
      return true;
    },
  },
  q_bunny_offkey: {
    name: '跑调绝杀', tag: SKILL_TAGS.MAG, mult: 2.0, ignoreDef: true, status: 'SILENCE',
    text: '🎤 {USER} 飙了个极度跑调的高音！魔音贯耳对 {TARGET} 造成了 {VAL} 点真实精神伤害并使其沉默！',
  },
  q_bunny_slide: {
    name: '兔兔滑铲', tag: SKILL_TAGS.BUFF, status: 'INVUL',
    text: '💨 {USER} "弹幕：太矮了根本打不到！" 利用体型优势极限滑铲，获得无敌状态！',
  },
  q_bunny_carrot: {
    name: '狂啃胡萝卜', tag: SKILL_TAGS.BUFF, status: 'REGEN', statBuff: { spd: 1.3, agl: 1.3 },
    text: '🥬 {USER} 掏出一根胡萝卜狂啃！获得了持续回血效果，并且速度和敏捷永久提升！',
  },

  v_rabbit_calc_rng: {
    name: '计算器盲按', tag: SKILL_TAGS.SPECIAL,
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

      const doDamage = (baseDmg: number, actionName = '计算器盲按'): { actualDmg: number; redirected: boolean } => {
        const res = ctx.user.jobData?.name === '欧皇' ? Math.floor(ctx.target.res * 0.5) : ctx.target.res;
        let finalDmg = Math.max(1, Math.floor(baseDmg * (1 + Math.random() * 0.2) - res * 0.5));
        if ((ctx.target.status ?? []).some((s) => s.type === 'ETHEREAL')) finalDmg = Math.floor(finalDmg * 2.0);
        const damageOptions: DamageApplicationOptions = { actionName };
        const actualDmg = ctx.applyDamage(ctx.target, finalDmg, 'skill', false, ctx.user, damageOptions);
        if (ctx.user?.stats) ctx.user.stats.dmgDealt += actualDmg;
        return { actualDmg, redirected: !!damageOptions.redirectedByJoker };
      };

      if (roll.type === '114514') {
        ctx.log('skill', `🧮 滴—— 1 1 4 5 1 4... ${ctx.user.name} 播放极其生草的恶臭数字，精神污染朝 ${ctx.target.name} 扩散！`);
        const { actualDmg: dmg, redirected } = doDamage(Math.floor(ctx.user.mag * 1.5), '恶臭数字');
        if (redirected) {
          // 屑的转移日志已经说明完整结果。
        } else if (dmg <= 0) {
          ctx.log('info', `🧮 恶臭数字扫过 ${ctx.target.name}，但没有造成实际伤害，中毒没有生效！`);
        } else {
          ctx.log('skill', `🧮 恶臭数字命中 ${ctx.target.name}，实际造成 ${dmg} 点精神伤害并使其深度中毒！`);
          ctx.flushDeferredDamageEvents?.();
          ctx.target.status = ctx.target.status ?? [];
          ctx.target.status.push({ type: 'POISON', duration: 3 });
        }
      } else if (roll.type === '666666') {
        ctx.log('skill', `🧮 滴—— 6 6 6 6 6 6... 弹幕共鸣！${ctx.user.name} 召唤弹幕狂潮，准备对 ${ctx.target.name} 打出 6 段魔法打击！`);
        let totalDmg = 0;
        let redirectedAny = false;
        for (let i = 0; i < 6; i++) {
          if (!isActiveCombatant(ctx.user)) break;
          if (ctx.target.currentHp > 0) {
            let segDmg = Math.floor(ctx.user.mag * 0.5);
            if (Math.random() < 0.5) segDmg = Math.floor(segDmg * 1.5);
            const segment = doDamage(segDmg, '弹幕共鸣');
            redirectedAny ||= segment.redirected;
            totalDmg += segment.actualDmg;
          }
        }
        if (totalDmg > 0) {
          ctx.log('crit', `🧮 【弹幕共鸣】${ctx.user.name} 的 6 段魔法打击结算完毕，对 ${ctx.target.name} 总计造成 ${totalDmg} 点实际伤害！`);
        } else if (!redirectedAny) {
          ctx.log('info', `🧮 【弹幕共鸣】弹幕狂潮扫过 ${ctx.target.name}，但没有造成实际伤害！`);
        }
        ctx.flushDeferredDamageEvents?.();
      } else if (roll.type === '888888') {
        ctx.log('skill', roll.text.replace(/{USER}/g, ctx.user.name));
        const allies = (ctx.fighters ?? []).filter(
          (f) => !f.isDead && ctx.getTeamId(f) === ctx.getTeamId(ctx.user) && !(f.status ?? []).some((s) => s.type === 'SYNERGY_SLACKING'),
        );
        const healAmt = Math.floor(ctx.user.mag * 2.0);
        const boostedValoNames: string[] = [];
        let totalHealed = 0;
        const healedNames: string[] = [];
        allies.forEach((a) => {
          if (!(a.status ?? []).some((s) => s.type === 'NO_HEAL')) {
            const healed = healFighter(a, healAmt);
            if (healed > 0) {
              totalHealed += healed;
              healedNames.push(a.name);
            }
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
        const { actualDmg: dmg, redirected } = doDamage(Math.floor(ctx.user.mag * 0.1), '爱心飞吻');
        if (redirected) {
          // 屑的转移日志已经说明完整结果。
        } else if (dmg <= 0) {
          ctx.log('info', `🧮 爱心飞吻擦过 ${ctx.target.name}，但没有造成实际伤害，魅惑没有生效！`);
        } else {
          ctx.log('skill', `🧮 爱心飞吻命中 ${ctx.target.name}，实际造成 ${dmg} 点物理伤害并深度魅惑！`);
          ctx.flushDeferredDamageEvents?.();
          ctx.target.status = ctx.target.status ?? [];
          ctx.target.status.push({ type: 'CHARMED', duration: 3 });
        }
      } else if (roll.type === '233333') {
        ctx.log('skill', roll.text.replace(/{USER}/g, ctx.user.name).replace(/{TARGET}/g, ctx.target.name));
        ctx.user.status = ctx.user.status ?? [];
        ctx.user.status.push({ type: 'COUNTER', duration: 2 });
      } else if (roll.type === '996007') {
        ctx.log('skill', `🧮 滴—— 9 9 6 0 0 7... ${ctx.user.name} 强迫 ${ctx.target.name} 无休加班，重压即将落下！`);
        const { actualDmg: dmg, redirected } = doDamage(Math.floor(ctx.user.mag * 1.8), '无休加班');
        if (redirected) {
          // 屑的转移日志已经说明完整结果。
        } else if (dmg <= 0) {
          ctx.log('info', `🧮 无休加班的重压没有造成实际伤害，灼烧和减速没有生效！`);
        } else {
          ctx.log('skill', `🧮 无休加班压垮 ${ctx.target.name}，实际造成 ${dmg} 点魔法伤害并附加灼烧，速度永久暴跌！`);
          ctx.flushDeferredDamageEvents?.();
          ctx.target.status = ctx.target.status ?? [];
          ctx.target.status.push({ type: 'BURN', duration: 3 });
          ctx.target.spd = Math.max(1, Math.floor(ctx.target.spd * 0.5));
        }
      }

      if (ctx.target.currentHp <= 0 && !ctx.target.isDeadAnnounced && !ctx.target.isDead) {
        ctx.markDefeated(ctx.target, { message: `💀 【击杀】${ctx.target.name} 承受不住这极其离谱的计算器魔法，当场暴毙！`, killer: ctx.user });
      }

      if (!isActiveCombatant(ctx.user)) return true;
      ctx.user.status = ctx.user.status ?? [];
      refreshStatus(ctx.user.status, 'RABBIT_CALC_HASTE', 3);
      ctx.log('info', `⚡ 伴随着按键的残影，${ctx.user.name} 进入【计算超频】状态，接下来 3 次自身行动出手频率提升 15%！`);

      return true;
    },
  },

  v_rabbit_zero: {
    name: '物理『归零』', tag: SKILL_TAGS.SPECIAL, text: '🔘 {USER} 狠狠按下了计算器最上方的键：『归零！』',
    onExecute: (ctx) => {
      ctx.log('skill', `🧮 咔哒！计算器发出了震耳欲聋的审判之音："【归——零——】！！！"`);

      if (ctx.target.job === 'GOD_SLIME') {
        const actualDmg = ctx.applyDamage(ctx.user, 9999, 'skill', true, ctx.target, { actionName: '弑神反噬', respectDefenses: false });
        if (actualDmg > 0) {
          ctx.log('crit', `⚡ 【弑神反噬】警告！！${ctx.user.name} 试图篡改神明【${ctx.target.name}】的数据！\n神明的绝对威压免疫了归零，降下神罚之雷，实际造成 ${actualDmg} 点真实伤害！`);
        } else {
          ctx.log('info', `⚡ 【弑神反噬】警告！！${ctx.user.name} 试图篡改神明【${ctx.target.name}】的数据，但神罚没有造成实际伤害！`);
        }
        ctx.flushDeferredDamageEvents?.();
        if (ctx.user.currentHp <= 0) {
          ctx.markDefeated(ctx.user, { message: `💀 【天谴】${ctx.user.name} 遭到反噬，被劈得灰飞烟灭！`, awardKill: false });
        }
        return true;
      }

      if ((ctx.target.status ?? []).some((s) => s.type.startsWith('STYLE_')) && ctx.target.baseStatsForStyle) {
        Object.assign(ctx.target, ctx.target.baseStatsForStyle);
        delete ctx.target.baseStatsForStyle;
      }
      const preservedDebuffs = new Set([
        'STUN', 'FREEZE', 'CONFUSED', 'CHARMED', 'WATER_PRISON', 'WT_SUPPRESS', 'WT_AIRBORNE', 'WT_REPAIRING',
        'POISON', 'BURN', 'BLIND', 'SILENCE', 'NO_HEAL', 'VALO_FLASH', 'VALO_AIM_PUNCH', 'NEURAL_THEFT_DEBUFF',
        'ETHEREAL', 'ZEROED',
      ]);
      ctx.target.status = (ctx.target.status ?? []).filter((s) => preservedDebuffs.has(s.type));

      if (!(ctx.target.status ?? []).some((s) => s.type === 'ZEROED')) {
        ctx.target.baseStatsForZero = { atk: ctx.target.atk, def: ctx.target.def, res: ctx.target.res };
        ctx.target.atk = Math.max(1, Math.floor(ctx.target.atk * 0.1));
        ctx.target.def = Math.max(1, Math.floor(ctx.target.def * 0.1));
        ctx.target.res = Math.max(1, Math.floor(ctx.target.res * 0.1));
        ctx.target.status.push({ type: 'ZEROED', duration: 3 });
      } else {
        const zeroStatus = (ctx.target.status ?? []).find((s) => s.type === 'ZEROED');
        if (zeroStatus) zeroStatus.duration = 3;
      }

      ctx.target.wasZeroed = true;
      ctx.user.status = ctx.user.status ?? [];
      refreshStatus(ctx.user.status, 'RABBIT_ZERO_HASTE', 2);

      ctx.log('skill', `🧮 【归零】降维打击！${ctx.target.name} 的所有正面状态被强行清空，攻击、防御、魔抗在接下来的回合内暴跌至 10%！\n✨ 同时 ${ctx.user.name} 吸收了算力，进入【归零超频】状态，接下来 2 次自身行动出手频率提升 30%！`);

      return true;
    },
  },

  v_rabbit_style_switch: {
    name: '切换人设', tag: SKILL_TAGS.SPECIAL, text: '🎭 {USER} 决定换一个人设...',
    condition: () => false,
    onExecute: (ctx) => {
      const pool: StylePoolEntry[] = Data.TUJUANJUAN_STYLE_POOL ?? [];

      if ((ctx.user.status ?? []).some((s) => s.type === 'STYLE_EMPEROR')) {
        ctx.log('info', `👑 ${ctx.user.name} 已登基为王，不再需要切换人设！`);
        ctx.log('skill', `⚡ 帝皇不可阻挡！${ctx.user.name} 立即发起了无情追击！`);
        const followUpSkills = ['v_rabbit_calc_rng', 'v_rabbit_calc_smash', 'v_rabbit_zero', 'v_rabbit_megaphone'];
        ctx.executeSkillAction(followUpSkills[Math.floor(Math.random() * followUpSkills.length)], ctx.user, ctx.target, ctx.triggerDepth + 1);
        return true;
      }

      if (!ctx.user.baseStatsForStyle) {
        ctx.user.baseStatsForStyle = { atk: ctx.user.atk, def: ctx.user.def, res: ctx.user.res, mag: ctx.user.mag, spd: ctx.user.spd, wis: ctx.user.wis, agl: ctx.user.agl };
      } else {
        Object.assign(ctx.user, ctx.user.baseStatsForStyle);
      }

      const isEmperor = Math.random() < 0.05;
      const normalPool = pool.filter((p) => p && p.status !== 'STYLE_EMPEROR');

      if (normalPool.length === 0) return true;

      const selectedStyle: StylePoolEntry | undefined = isEmperor
        ? pool.find((p) => p.status === 'STYLE_EMPEROR')
        : normalPool[Math.floor(Math.random() * normalPool.length)];

      ctx.user.status = (ctx.user.status ?? []).filter(
        (s) => !s.type.startsWith('STYLE_') && s.type !== 'CTR_CHARM' && s.type !== 'SPELL_BLOCK' && s.type !== 'RAGE',
      );

      if (selectedStyle) {
        ctx.user.status.push({ type: selectedStyle.status, duration: 999 });

        const effectDesc: string[] = [];

        if (selectedStyle.status === 'STYLE_FAMILY') {
          ctx.user.status.push({ type: 'SPELL_BLOCK', duration: 999 });
          effectDesc.push('免疫魔法控制(林肯)');
        }
        if (selectedStyle.status === 'STYLE_SEXY' || selectedStyle.status === 'STYLE_EMPEROR') {
          ctx.user.status.push({ type: 'CTR_CHARM', duration: 999 });
          effectDesc.push('受击概率魅惑敌人');
        }
        if (selectedStyle.status === 'STYLE_ANGRY') {
          ctx.user.status.push({ type: 'RAGE', duration: 999 });
          effectDesc.push('自带狂暴 & 半血斩杀');
        }

        if (selectedStyle.statBuff) {
          const buff = selectedStyle.statBuff;
          (Object.keys(buff) as StatKey[]).forEach((k) => {
            const val = buff[k];
            if (val !== undefined && ctx.user[k] !== undefined) {
              ctx.user[k] = Math.max(1, Math.floor(ctx.user[k] * val));
            }
          });
          if (buff.atk) effectDesc.push(`攻击力变为 ${buff.atk} 倍`);
          if (buff.spd) effectDesc.push(`速度变为 ${buff.spd} 倍`);
          if (buff.def) effectDesc.push(`防御变为 ${buff.def} 倍`);
          if (buff.mag) effectDesc.push(`魔力变为 ${buff.mag} 倍`);
        }

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
      const realtimeHpPct = ctx.target.currentHp / ctx.target.maxHp;
      if (
        (ctx.user.status ?? []).some((s) => ['STYLE_ANGRY', 'STYLE_EMPEROR'].includes(s.type)) &&
        ctx.target.currentHp > 0 &&
        realtimeHpPct < 0.5 &&
        !ctx.target.transformed
      ) {
        setCurrentHp(ctx.target, 0);
        ctx.markDefeated(ctx.target, { message: `☠️ 【斩杀处决】处于暴躁女人的极怒状态，${ctx.user.name} 用计算器将残血的 ${ctx.target.name} 直接砸成了肉泥！`, killer: ctx.user, setHpZero: false });
      }
    },
  },

  v_rabbit_undo: {
    name: '等等按错了！', tag: SKILL_TAGS.HEAL, text: '⏪ "等一下，刚才那个不算！重来！" {USER} 狂按计算器上的【CE（清除）】键...',
    onExecute: (ctx) => {
      ctx.log('skill', `🧮 滴滴滴！屏幕上的【114514】被清空！计算器播报："【CE——】清除完毕！"`);

      const allies = (ctx.fighters ?? []).filter(
        (f) => !f.isDead && ctx.getTeamId(f) === ctx.getTeamId(ctx.user) && !(f.status ?? []).some((s) => s.type === 'SYNERGY_SLACKING'),
      );
      const healAmt = Math.floor(ctx.user.mag * 2.0);
      let totalHealed = 0;
      const healedNames: string[] = [];
      allies.forEach((a) => {
        a.status = (a.status ?? []).filter((s) => {
          if (s.type === 'ZEROED' && a.baseStatsForZero) {
            a.atk = a.baseStatsForZero.atk;
            a.def = a.baseStatsForZero.def;
            a.res = a.baseStatsForZero.res;
            a.wasZeroed = false;
            delete a.baseStatsForZero;
          }
          return !['STUN', 'FREEZE', 'BURN', 'POISON', 'BLIND', 'SILENCE', 'CONFUSED', 'CHARMED', 'VALO_FLASH', 'VALO_AIM_PUNCH', 'NEURAL_THEFT_DEBUFF', 'ZEROED'].includes(s.type);
        });
        if (!(a.status ?? []).some((s) => s.type === 'NO_HEAL')) {
          const healed = healFighter(a, healAmt);
          if (healed > 0) {
            totalHealed += healed;
            healedNames.push(a.name);
          }
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
    onExecute: (ctx) => {
      const enemies = ctx.currentTargets ?? [];
      const dmg = Math.floor(ctx.user.mag * 2.5);
      const enemyNames = enemies.map((enemy) => enemy.name).join('、') || '无';
      ctx.log('skill', `🔊 【扩音处刑】大喇叭里传出放大了十倍的魔音："【6666...归零！】" 刺向 ${enemies.length} 名敌人：${enemyNames}！`);
      for (const e of enemies) {
        if (!isActiveCombatant(ctx.user)) break;
        if (e.currentHp <= 0 || e.isDead || e.isDeadAnnounced || e.status.some((s) => s.type === 'SYNERGY_SLACKING')) continue;
        const damageOptions: DamageApplicationOptions = { actionName: '扩音处刑' };
        const actualDmg = ctx.applyDamage(e, dmg, 'skill', true, ctx.user, damageOptions);
        if (damageOptions.redirectedByJoker) continue;
        ctx.user.stats.dmgDealt += actualDmg;
        if (damageOptions.targetDefeatedDuringDamage || e.isDead || e.isDeadAnnounced) {
          ctx.flushDeferredDamageEvents?.();
          continue;
        }
        const controlImmune = (e.status ?? []).some((s) => ['BKB', 'STYLE_FOOL', 'STYLE_EMPEROR'].includes(s.type));
        let shouldStun = false;
        if (actualDmg <= 0) {
          ctx.log('info', `🔊 刺耳魔音擦身而过！${e.name} 没有承受实际伤害，也没有被眩晕！`);
        } else if (controlImmune) {
          ctx.log('info', `🔊 刺耳魔音贯耳！${e.name} 承受了 ${actualDmg} 点真实精神伤害，但免疫了眩晕！`);
        } else {
          ctx.log('info', `🔊 刺耳魔音贯耳！${e.name} 承受了 ${actualDmg} 点真实精神伤害并被眩晕！`);
          shouldStun = true;
        }
        ctx.flushDeferredDamageEvents?.();
        if (shouldStun && e.currentHp > 0 && !e.isDead && !e.isDeadAnnounced) {
          e.status = e.status ?? [];
          e.status.push({ type: 'STUN', duration: 1 });
        }
        if (e.currentHp <= 0 && !e.isDeadAnnounced && !e.isDead) {
          ctx.markDefeated(e, { message: `💀 【击杀】${e.name} 被魔音贯耳，大脑宕机而亡！`, killer: ctx.user });
        }
      }

      return true;
    },
  },
};
