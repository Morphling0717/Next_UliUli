import type { DamageApplicationOptions, Fighter, SkillDefinition } from '../types';
import { namerenaData as Data } from '../data';
import { clearZeroedStatPenalty, isActiveCombatant, resolveHealing } from '../combatState';
import { consumeSpellBlock, formatPreSkillSpellBlock } from '../defenseStatus';
import { applyStatus, hasIdentity } from '../statusSystem';
import { isDamageRedirected } from '../damageRedirects';

const { SKILL_TAGS } = Data;

function namesOf(fighters: Fighter[]): string {
  return fighters.map((fighter) => fighter.name).join('、') || '无';
}

function consumeAreaStatusSpellBlock(ctx: Parameters<NonNullable<SkillDefinition['onExecute']>>[0], target: Fighter, actionName: string): boolean {
  const spellBlock = consumeSpellBlock(target);
  if (!spellBlock) return false;
  const healing = resolveHealing(target, Math.floor(target.maxHp * 0.15), {}, ctx.log);
  const healText = healing.actual > 0
    ? `，并恢复了 ${healing.actual} 点生命`
    : healing.outcome === 'blocked'
      ? '，但附带治疗被完全阻止'
      : '，但生命已满，治疗溢出';
  ctx.log('info', formatPreSkillSpellBlock(spellBlock, ctx.user.name, actionName, target.name, healText));
  return true;
}

export const valoJuniorSkills: Record<string, SkillDefinition> = {
  valo_classic_shot: {
    name: '标配(Classic)', tag: SKILL_TAGS.PHYS, isGacha: true, minDamagePct: 0.18,
    pool: [
      ...Array(9).fill({ text: '🔫 {USER} 使用标配手枪点射了 {TARGET}，造成 {VAL} 伤害！', mult: 0.8 }),
      { text: '🎯 {USER} 手感火热！标配一发爆头击中了 {TARGET}！造成 {VAL} 真实伤害！', mult: 2.5, ignoreDef: true },
    ],
    text: '🔫 {USER} 掏出手枪...',
  },
  valo_vandal_shot: { name: '狂徒(Vandal)', tag: SKILL_TAGS.PHYS, mult: 1.5, minDamagePct: 0.22, text: '🔫 {USER} 使用狂徒步枪扫射 {TARGET}，造成 {VAL} 伤害！' },
  valo_operator_shot: { name: '冥驹(Operator)', tag: SKILL_TAGS.PHYS, mult: 5.0, ignoreDef: true, text: '🔭 {USER} 屏息凝神... 砰！冥驹轰鸣，一枪穿透了 {TARGET}！造成 {VAL} 真实伤害！' },
  valo_holding_angle: { name: '架枪预瞄', tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'VALO_HOLDING_ANGLE' }], text: '🔭 {USER} 停止移动，进入了架枪预瞄姿态！' },
  valo_pre_fire: { name: '提前枪', tag: SKILL_TAGS.PHYS, mult: 1.5, minDamagePct: 0.18, statusApplications: [{ identityId: 'VALO_AIM_PUNCH' }], text: '🔫 {USER} 扣下扳机，精准的提前枪击中了 {TARGET} 并附加了【截停】！' },
  valo_clutch_headshot: { name: '残局爆头线', tag: SKILL_TAGS.PHYS, mult: 2.6, minDamagePct: 0.42, ignoreDef: true, alwaysHit: true, alwaysCrit: true, text: '🎯 【残局爆头线】{USER} 架好准星，peek 出去的一瞬间爆头命中 {TARGET}，造成 {VAL} 真实伤害！' },
  valo_clutch_execute: { name: '残局处决', tag: SKILL_TAGS.PHYS, mult: 3.8, minDamagePct: 0.6, ignoreDef: true, alwaysHit: true, alwaysCrit: true, text: '🏆 【残局处决】{USER} 抓住 {TARGET} 的破绽，冷静收下这一分，造成 {VAL} 真实伤害！' },

  valo_ult_showstopper: {
    name: '晚安火炮', tag: SKILL_TAGS.PHYS, mult: 3.0, text: '🚀 {USER} 掏出火箭筒："FIRE IN THE HOLE！" 轰炸了 {TARGET}，造成 {VAL} 毁灭伤害！',
    afterExecute: (ctx, dmg) => {
      const otherEnemies = (ctx.currentTargets ?? [])
        .filter((f) => f.id !== ctx.target.id && !f.isDead && !f.isDeadAnnounced && f.currentHp > 0)
        .sort(() => 0.5 - Math.random())
        .slice(0, 2);
      if (otherEnemies.length > 0) {
        if (!isActiveCombatant(ctx.user)) return;
        ctx.log('skill', `🚀 【晚安火炮】爆炸波及 ${otherEnemies.length} 名敌人：${namesOf(otherEnemies)}！`, {
          targetIds: otherEnemies.map((enemy) => enemy.id),
          visualCue: {
            kind: 'combat_fx',
            sourceId: ctx.user.id,
            targetIds: otherEnemies.map((enemy) => enemy.id),
          },
        });
        const aoeDmg = Math.floor(dmg * 0.8);
        for (const e of otherEnemies) {
          if (!isActiveCombatant(ctx.user)) break;
          if (e.currentHp <= 0 || e.isDead || e.isDeadAnnounced || hasIdentity(e, 'SYNERGY_SLACKING')) continue;
          const damageOptions: DamageApplicationOptions = { actionName: '晚安火炮余波' };
          const actualDmg = ctx.applyDamage(e, aoeDmg, 'skill', false, ctx.user, damageOptions);
          if (isDamageRedirected(damageOptions)) continue;
          if (actualDmg > 0) {
            ctx.log('info', `💥 爆炸余波重创了 ${e.name}，实际造成 ${actualDmg} 点伤害！`);
          } else {
            ctx.log('info', `💥 爆炸余波扫过 ${e.name}，但没有造成实际伤害！`);
          }
          ctx.flushDeferredDamageEvents?.();
          if (e.currentHp <= 0) ctx.markDefeated(e, { message: `💀 【范围击杀】${e.name} 被晚安火炮的余波炸碎了！`, killer: ctx.user });
          const idx = (ctx.fighters ?? []).findIndex((x) => x.id === e.id);
          if (idx !== -1) ctx.fighters[idx] = e;
        }
      }
    },
  },

  valo_ult_blade_storm: {
    name: '飓刃', tag: SKILL_TAGS.PHYS, mult: 2.0, ignoreDef: true, text: '🔪 {USER} 召唤出环绕的飓刃！飞刀贯穿了 {TARGET}，造成 {VAL} 真实伤害！',
    afterExecute: (ctx) => {
      if ((ctx.targetDefeatedDuringAction || ctx.target.currentHp <= 0) && !ctx.target.isNpc && !ctx.target.cannotWin) {
        ctx.log('skill', `🔪 【飓刃】收割！${ctx.user.name} 拿到击杀，刷新行动条，立即再次出手！`);
        ctx.executeSkillAction('valo_ult_blade_storm', ctx.user, null, ctx.triggerDepth + 1);
      }
    },
  },

  valo_ult_empress: { name: '女皇神威', tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'VALO_ULT_EMPRESS' }], text: '👑 {USER} 进入女皇状态！"绝不留情！" 攻击力与速度翻倍，且获得100%吸血！' },
  valo_ult_run_it_back: { name: '再火一回', tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'VALO_ULT_RUN_IT_BACK' }], text: '🔥 {USER} 留下了时空标记："别急，我还会回来的！" 获得了免死金牌！' },
  valo_ult_hunters_fury: { name: '狂猎之怒', tag: SKILL_TAGS.MAG, mult: 1.5, hits: 3, ignoreDef: true, text: '🦅 {USER} 张弓搭箭："我就是猎人！" 三道能量箭穿透了 {TARGET}，共造成 {VAL} 真实伤害！' },

  valo_ult_orbital_strike: {
    name: '天降以此', tag: SKILL_TAGS.MAG, mult: 6.0, text: '🛰️ {USER} 呼叫轨道打击："准备迎接地狱火吧！" 激光炮锁定了 {TARGET}，造成 {VAL} 毁灭伤害！',
    afterExecute: (ctx, dmg, hpBeforeDamage) => {
      if (ctx.damageRedirectedByOriginiumCore || ctx.damageRedirectedByOwlEmperor || ctx.damageRedirectedByMomo) return;
      if (dmg > (hpBeforeDamage ?? 0)) {
        const overflow = dmg - (hpBeforeDamage ?? 0);
        const otherEnemies = (ctx.currentTargets ?? []).filter((f) => f.id !== ctx.target.id && !f.isDead && !f.isDeadAnnounced && f.currentHp > 0);
        if (otherEnemies.length > 0) {
          if (!isActiveCombatant(ctx.user)) return;
          ctx.log('crit', `🛰️ 【天降以此】火力过剩！溢出的 ${overflow} 点伤害溅射给 ${otherEnemies.length} 名敌人：${namesOf(otherEnemies)}！`, {
            targetIds: otherEnemies.map((enemy) => enemy.id),
            visualCue: {
              kind: 'combat_fx',
              sourceId: ctx.user.id,
              targetIds: otherEnemies.map((enemy) => enemy.id),
            },
          });
          const splashDmg = Math.floor(overflow / otherEnemies.length);
          for (const e of otherEnemies) {
            if (!isActiveCombatant(ctx.user)) break;
            if (e.currentHp <= 0 || e.isDead || e.isDeadAnnounced || hasIdentity(e, 'SYNERGY_SLACKING')) continue;
            const damageOptions: DamageApplicationOptions = { actionName: '天降以此余波' };
            const actualDmg = ctx.applyDamage(e, splashDmg, 'skill', false, ctx.user, damageOptions);
            if (isDamageRedirected(damageOptions)) continue;
            if (actualDmg > 0) {
              ctx.log('info', `🔥 轨道炮的炽热余波溅射到了 ${e.name}，实际造成 ${actualDmg} 点伤害！`);
            } else {
              ctx.log('info', `🔥 轨道炮余波溅射到了 ${e.name}，但没有造成实际伤害！`);
            }
            ctx.flushDeferredDamageEvents?.();
            if (e.currentHp <= 0) ctx.markDefeated(e, { message: `💀 【溅射击杀】${e.name} 被轨道炮的余波轰成了渣！`, killer: ctx.user });
            const idx = (ctx.fighters ?? []).findIndex((x) => x.id === e.id);
            if (idx !== -1) ctx.fighters[idx] = e;
          }
        }
      }
    },
  },

  valo_ult_cosmic_divide: {
    name: '宇宙分裂', tag: SKILL_TAGS.BUFF, text: '🌍 {USER} 撕裂空间...',
    onExecute: (ctx) => {
      const userTeamId = ctx.getTeamId(ctx.user);
      const allies = (ctx.fighters ?? []).filter((f) => !f.isDead && !f.isDeadAnnounced && f.currentHp > 0 && ctx.getTeamId(f) === userTeamId);
      ctx.setVisualTargets(allies);
      ctx.log('buff', `🌍 【宇宙分裂】${ctx.user.name} 撕裂空间，开始庇护并净化 ${allies.length} 名队友：${namesOf(allies)}！`);
      allies.forEach((a) => {
        applyStatus(a, { identityId: 'INVUL', remainingTurns: 1, attribution: { effectSourceId: 'valorant_astra_cosmic_divide' } });
        ctx.dispelStatusEffects(a, { strength: 'strong', direction: 'negative' });
        const idx = (ctx.fighters ?? []).findIndex((x) => x.id === a.id);
        if (idx !== -1) ctx.fighters[idx] = a;
      });
      ctx.log('buff', `🌍 【宇宙分裂完成】${allies.length} 名队友已获得绝对无敌，净化结算完毕！`);
      return true;
    },
  },

  valo_ult_resurrection: {
    name: '复活', tag: SKILL_TAGS.BUFF, text: '💉 {USER} 注入生命之玉...',
    onExecute: (ctx) => {
      const myTeamId = ctx.getTeamId(ctx.user);
      const deadTeammates = (ctx.fighters ?? []).filter(
        (f) => f.isDead && ctx.getTeamId(f) === myTeamId && f.id !== ctx.user.id,
      );
      if (deadTeammates.length > 0) {
        const targetToRevive = deadTeammates[Math.floor(Math.random() * deadTeammates.length)];
        ctx.setVisualTargets([targetToRevive]);
        targetToRevive.isDead = false;
        targetToRevive.isDeadAnnounced = false;
        targetToRevive.isActing = false;
        targetToRevive.isHit = false;
        targetToRevive.currentHp = targetToRevive.maxHp;
        targetToRevive.hpPct = 1.0;
        ctx.log('heal', `💉 【复活】${ctx.user.name} 将生命之玉注入 ${targetToRevive.name}：“你的职责尚未完成！”`);
        ctx.dispelStatusEffects(targetToRevive, { strength: 'strong', direction: 'negative' });
        clearZeroedStatPenalty(targetToRevive);
        ctx.log('heal', `💉 【复活完成】${targetToRevive.name} 已恢复至 ${targetToRevive.maxHp}/${targetToRevive.maxHp} 生命并重新加入战场！`);
        const revIdx = (ctx.fighters ?? []).findIndex((f) => f.id === targetToRevive.id);
        if (revIdx !== -1) ctx.fighters[revIdx] = targetToRevive;
      }
      return true;
    },
  },

  valo_ult_lockdown: {
    name: '全面封锁', tag: SKILL_TAGS.SPECIAL, spellBlockMode: 'perHit', text: '🤖 {USER} 部署封锁装置...',
    onExecute: (ctx) => {
      const targets = (ctx.currentTargets ?? []).filter((e) => !e.isDead && !e.isDeadAnnounced && e.currentHp > 0);
      ctx.setVisualTargets(targets);
      const affected = targets.filter((e) => {
        if (consumeAreaStatusSpellBlock(ctx, e, '全面封锁')) return false;
        const applied = ctx.applyStatus(e, { identityId: 'STUN', remainingTurns: 2 });
        const idx = (ctx.fighters ?? []).findIndex((x) => x.id === e.id);
        if (idx !== -1) ctx.fighters[idx] = e;
        return applied;
      });
      ctx.log('skill', `🤖 【全面封锁】倒计时结束！${ctx.user.name} 的装置释放次级波，实际眩晕 ${affected.length} 名敌人：${namesOf(affected)}！`);
      return true;
    },
  },

  valo_ult_vipers_pit: {
    name: '蝰蛇神殿', tag: SKILL_TAGS.SPECIAL, spellBlockMode: 'perHit', text: '🐍 {USER} 展开毒幕...',
    onExecute: (ctx) => {
      const targets = (ctx.currentTargets ?? []).filter((e) => !e.isDead && !e.isDeadAnnounced && e.currentHp > 0);
      ctx.setVisualTargets(targets);
      const affected = targets.filter((e) => {
        if (consumeAreaStatusSpellBlock(ctx, e, '蝰蛇神殿')) return false;
        const results = [
          ctx.applyStatus(e, { identityId: 'POISON', remainingTurns: 3 }),
          ctx.applyStatus(e, { identityId: 'BLIND', charges: 3 }),
          ctx.applyStatus(e, { identityId: 'VALO_VIPER_DECAY', remainingTurns: 3 }),
        ];
        const idx = (ctx.fighters ?? []).findIndex((x) => x.id === e.id);
        if (idx !== -1) ctx.fighters[idx] = e;
        return results.every(Boolean);
      });
      ctx.log('skill', `🐍 【蝰蛇神殿】毒幕扫过 ${targets.length} 名敌人，实际使 ${affected.length} 名目标中毒、致盲且防御骤降：${namesOf(affected)}！`);
      return true;
    },
  },

  valo_ult_null_cmd: {
    name: '全面压制', tag: SKILL_TAGS.SPECIAL, spellBlockMode: 'perHit', text: '🤖 {USER} 发射抑制脉冲...',
    onExecute: (ctx) => {
      const targets = (ctx.currentTargets ?? []).filter((e) => !e.isDead && !e.isDeadAnnounced && e.currentHp > 0);
      ctx.setVisualTargets(targets);
      const affected = targets.filter((e) => {
        if (consumeAreaStatusSpellBlock(ctx, e, '全面压制')) return false;
        const applied = ctx.applyStatus(e, { identityId: 'SILENCE', remainingTurns: 3 });
        const idx = (ctx.fighters ?? []).findIndex((x) => x.id === e.id);
        if (idx !== -1) ctx.fighters[idx] = e;
        return applied;
      });
      applyStatus(ctx.user, { identityId: 'RAGE', remainingTurns: 3 });
      ctx.log('skill', `🤖 【全面压制】抑制脉冲激活！${affected.length} 名敌人被【沉默】：${namesOf(affected)}，${ctx.user.name} 获得 3 回合狂暴！`);
      return true;
    },
  },

  valo_ult_neural_theft: {
    name: '神经取缔', tag: SKILL_TAGS.SPECIAL, spellBlockMode: 'perHit', text: '📷 {USER} 抛出帽子读取记忆...',
    onExecute: (ctx) => {
      const targets = (ctx.currentTargets ?? []).filter((e) => !e.isDead && !e.isDeadAnnounced && e.currentHp > 0);
      ctx.setVisualTargets(targets);
      const affected = targets.filter((e) => {
        if (consumeAreaStatusSpellBlock(ctx, e, '神经取缔')) return false;
        const applied = ctx.applyStatus(e, { identityId: 'NEURAL_THEFT_DEBUFF', remainingTurns: 2 });
        const idx = (ctx.fighters ?? []).findIndex((x) => x.id === e.id);
        if (idx !== -1) ctx.fighters[idx] = e;
        return applied;
      });
      ctx.log('skill', `📷 【神经取缔】"我知道你们在哪！" 实际暴露 ${affected.length} 名敌人的弱点：${namesOf(affected)}（闪避归零、必吃暴击）！`);
      return true;
    },
  },
};
