import type { DamageApplicationOptions, SkillDefinition } from '../types';
import { namerenaData as Data } from '../data';
import { isActiveCombatant } from '../combatState';

const { SKILL_TAGS } = Data;

function activeEnemies(ctx: Parameters<NonNullable<SkillDefinition['onExecute']>>[0]) {
  const myTeamId = ctx.getTeamId(ctx.user);
  return ctx.fighters.filter((fighter) =>
    fighter.id !== ctx.user.id &&
    !fighter.isDead &&
    !fighter.isDeadAnnounced &&
    fighter.currentHp > 0 &&
    ctx.getTeamId(fighter) !== myTeamId &&
    !fighter.status.some((status) => status.type === 'SYNERGY_SLACKING'),
  );
}

export const duelMonsterSkills: Record<string, SkillDefinition> = {
  exodia_forbidden_blast: {
    name: '禁忌魔弹',
    tag: SKILL_TAGS.MAG,
    rate: 0.5,
    mult: 5.2,
    ignoreDef: true,
    text: '🧙‍♂️ {USER} 抬起被封印的右腕，释放禁忌魔弹贯穿 {TARGET}，造成 {VAL} 点真实魔法伤害！',
  },
  exodia_seal_chains: {
    name: '封印锁链',
    tag: SKILL_TAGS.DEBUFF,
    rate: 0.35,
    mult: 2.4,
    status: 'STUN',
    text: '🔒 {USER} 展开封印锁链束缚 {TARGET}，造成 {VAL} 点伤害并封锁行动！',
    afterExecute: (ctx) => {
      ctx.target.atk = Math.max(1, Math.floor(ctx.target.atk * 0.85));
      ctx.target.mag = Math.max(1, Math.floor(ctx.target.mag * 0.85));
      ctx.log('info', `🔒 ${ctx.target.name} 被封印锁链压制，攻击与魔力下降！`);
    },
  },
  exodia_obliterate: {
    name: 'Exodia Obliterate',
    tag: SKILL_TAGS.SPECIAL,
    rate: 0.45,
    condition: (user) => !user.hasUsedExodiaObliterate,
    text: '🧙‍♂️ {USER} 五体解封，宣告【Exodia Obliterate】！',
    onExecute: (ctx) => {
      if (ctx.user.hasUsedExodiaObliterate) {
        ctx.log('info', `🧙‍♂️ ${ctx.user.name} 已经释放过【Exodia Obliterate】，封印之力暂时沉寂。`);
        return true;
      }

      ctx.user.hasUsedExodiaObliterate = true;
      const enemies = activeEnemies(ctx);
      const baseDmg = Math.floor(ctx.user.mag * 4.2 + ctx.user.atk * 2.2);
      ctx.log('crit', `🧙‍♂️ 【Exodia Obliterate】${ctx.user.name} 释放被封印者的怒火，横扫 ${enemies.length} 名敌人！`);
      for (const enemy of enemies) {
        if (!isActiveCombatant(ctx.user)) break;
        if (enemy.currentHp <= 0 || enemy.isDead || enemy.isDeadAnnounced || enemy.status.some((status) => status.type === 'SYNERGY_SLACKING')) continue;
        const damageOptions: DamageApplicationOptions = { actionName: 'Exodia Obliterate' };
        const actualDmg = ctx.applyDamage(enemy, baseDmg, 'skill', true, ctx.user, damageOptions);
        if (damageOptions.redirectedByJoker) continue;
        if (actualDmg > 0) {
          ctx.log('skill', `🧙‍♂️ 黑暗大法师的怒火命中 ${enemy.name}，实际造成 ${actualDmg} 点真实伤害！`);
        } else {
          ctx.log('info', `🧙‍♂️ 黑暗大法师的怒火扫过 ${enemy.name}，但没有造成实际伤害！`);
        }
        ctx.flushDeferredDamageEvents?.();
        if (enemy.currentHp > 0 && enemy.hpPct <= 0.18) {
          ctx.markDefeated(enemy, { message: `☠️ 【封印处决】${enemy.name} 被黑暗大法师的禁忌力量彻底抹除！`, killer: ctx.user, setHpZero: false });
        } else if (enemy.currentHp <= 0) {
          ctx.markDefeated(enemy, { message: `💀 【Exodia Obliterate】${enemy.name} 被黑暗大法师轰成了卡片碎屑！`, killer: ctx.user });
        }
      }
      if (isActiveCombatant(ctx.user)) {
        ctx.user.status.push({ type: 'SPELL_BLOCK', duration: 2 });
      }
      return true;
    },
  },

  blue_eyes_burst_stream: {
    name: '毁灭爆裂疾风弹',
    tag: SKILL_TAGS.MAG,
    rate: 0.55,
    mult: 4.3,
    text: '🐲 {USER} 张开龙口，轰出毁灭爆裂疾风弹！对 {TARGET} 造成 {VAL} 点魔法伤害！',
  },
  blue_eyes_sweeping_breath: {
    name: '白龙扫射',
    tag: SKILL_TAGS.MAG,
    rate: 0.35,
    mult: 3.0,
    text: '🌪️ {USER} 振翼俯冲，白色龙息扫过 {TARGET}，造成 {VAL} 点魔法伤害！',
    afterExecute: (ctx, dmg) => {
      const splashDmg = Math.max(1, Math.floor(dmg * 0.45));
      const splashTargets = activeEnemies(ctx)
        .filter((enemy) => enemy.id !== ctx.target.id)
        .slice(0, 2);
      for (const enemy of splashTargets) {
        if (!isActiveCombatant(ctx.user)) break;
        if (enemy.currentHp <= 0 || enemy.isDead || enemy.isDeadAnnounced || enemy.status.some((status) => status.type === 'SYNERGY_SLACKING')) continue;
        const damageOptions: DamageApplicationOptions = { actionName: '白龙扫射余波' };
        const actualDmg = ctx.applyDamage(enemy, splashDmg, 'skill', false, ctx.user, damageOptions);
        if (damageOptions.redirectedByJoker) continue;
        if (actualDmg > 0) {
          ctx.log('skill', `🌪️ 白龙扫射的余波命中 ${enemy.name}，实际造成 ${actualDmg} 点溅射伤害！`);
        } else {
          ctx.log('info', `🌪️ 白龙扫射的余波擦过 ${enemy.name}，但没有造成实际伤害！`);
        }
        ctx.flushDeferredDamageEvents?.();
        if (enemy.currentHp <= 0) {
          ctx.markDefeated(enemy, { message: `💀 【白龙扫射】${enemy.name} 被青眼白龙的龙息余波击落！`, killer: ctx.user });
        }
      }
    },
  },
  blue_eyes_dragon_roar: {
    name: '白龙威压',
    tag: SKILL_TAGS.DEBUFF,
    rate: 0.3,
    mult: 1.8,
    status: 'STUN',
    text: '🐉 {USER} 发出震天龙吼，压制 {TARGET}，造成 {VAL} 点伤害并震慑目标！',
    afterExecute: (ctx) => {
      ctx.target.res = Math.max(1, Math.floor(ctx.target.res * 0.9));
      ctx.log('info', `🐉 ${ctx.target.name} 被白龙威压震慑，魔抗下降！`);
    },
  },

  ultimate_burst_stream: {
    name: '究极爆裂疾风弹',
    tag: SKILL_TAGS.SPECIAL,
    rate: 0.45,
    text: '🐉 {USER} 三首齐鸣，准备释放究极爆裂疾风弹！',
    onExecute: (ctx) => {
      const enemies = activeEnemies(ctx);
      if (enemies.length === 0) return true;
      const split = Math.max(0.42, 1 - enemies.length * 0.08);
      const baseDmg = Math.floor((ctx.user.mag * 3.6 + ctx.user.atk * 2.0) * split);
      ctx.log('crit', `🐉 【究极爆裂疾风弹】${ctx.user.name} 三重龙息横扫 ${enemies.length} 名敌人！（目标越多单体威力越分散）`);
      for (const enemy of enemies) {
        if (!isActiveCombatant(ctx.user)) break;
        if (enemy.currentHp <= 0 || enemy.isDead || enemy.isDeadAnnounced || enemy.status.some((status) => status.type === 'SYNERGY_SLACKING')) continue;
        const damageOptions: DamageApplicationOptions = { actionName: '究极爆裂疾风弹' };
        const actualDmg = ctx.applyDamage(enemy, baseDmg, 'skill', true, ctx.user, damageOptions);
        if (damageOptions.redirectedByJoker) continue;
        if (actualDmg > 0) {
          ctx.log('skill', `🐉 究极龙息命中 ${enemy.name}，实际造成 ${actualDmg} 点真实伤害！`);
        } else {
          ctx.log('info', `🐉 究极龙息扫过 ${enemy.name}，但没有造成实际伤害！`);
        }
        ctx.flushDeferredDamageEvents?.();
        if (enemy.currentHp <= 0) {
          ctx.markDefeated(enemy, { message: `💀 【究极爆裂疾风弹】${enemy.name} 被 ${ctx.user.name} 的三重龙息击败！`, killer: ctx.user });
        }
      }
      if (!isActiveCombatant(ctx.user)) return true;
      ctx.user.blueEyesUltimateStrain = (ctx.user.blueEyesUltimateStrain ?? 0) + 1;
      if ((ctx.user.blueEyesUltimateStrain ?? 0) >= 2) {
        ctx.user.def = Math.max(1, Math.floor(ctx.user.def * 0.88));
        ctx.user.res = Math.max(1, Math.floor(ctx.user.res * 0.88));
        ctx.log('info', `🧬 【融合不稳定】${ctx.user.name} 的融合负荷加重，防御与魔抗下降！`);
      }
      return true;
    },
  },
  triple_dragon_head: {
    name: '三重龙首',
    tag: SKILL_TAGS.SPECIAL,
    rate: 0.4,
    text: '🐉 {USER} 三颗龙首锁定 {TARGET}，连续撕咬三次！',
    onExecute: (ctx) => {
      let total = 0;
      ctx.log('skill', `🐉 【三重龙首】${ctx.user.name} 锁定 ${ctx.target.name}，三首依次发动攻击！`);
      for (let i = 1; i <= 3; i += 1) {
        if (!isActiveCombatant(ctx.user) || !isActiveCombatant(ctx.target)) break;
        const dmg = Math.floor(ctx.user.atk * 1.55 + ctx.user.mag * 0.7);
        const damageOptions: DamageApplicationOptions = { actionName: '三重龙首' };
        const actualDmg = ctx.applyDamage(ctx.target, dmg, 'skill', false, ctx.user, damageOptions);
        if (damageOptions.redirectedByJoker) {
          ctx.log('info', `🐉 第 ${i} 颗龙首的攻击被 ${ctx.target.name} 用随机恶作剧转移，原目标没有受伤；转移伤害已单独结算！`);
          continue;
        }
        total += actualDmg;
        ctx.log(actualDmg > 0 ? 'skill' : 'info', actualDmg > 0
          ? `🐉 第 ${i} 颗龙首命中 ${ctx.target.name}，实际造成 ${actualDmg} 点伤害！`
          : `🐉 第 ${i} 颗龙首被 ${ctx.target.name} 化解，没有造成实际伤害！`);
        ctx.flushDeferredDamageEvents?.();
        if (ctx.target.currentHp <= 0) {
          ctx.markDefeated(ctx.target, { message: `💀 【三重龙首】${ctx.target.name} 被 ${ctx.user.name} 撕碎！`, killer: ctx.user });
        }
      }
      if (!isActiveCombatant(ctx.user)) return true;
      ctx.user.blueEyesUltimateStrain = (ctx.user.blueEyesUltimateStrain ?? 0) + 1;
      if (total > 0 && (ctx.user.blueEyesUltimateStrain ?? 0) >= 3) {
        const recoil = Math.floor(ctx.user.maxHp * 0.06);
        ctx.user.currentHp = Math.max(1, ctx.user.currentHp - recoil);
        ctx.log('info', `🧬 【融合不稳定】${ctx.user.name} 承受融合反噬，损失 ${recoil} 点生命！`);
      }
      return true;
    },
  },

  ra_sun_flare: {
    name: '太阳神烈焰',
    tag: SKILL_TAGS.MAG,
    rate: 0.45,
    mult: 3.9,
    ignoreDef: true,
    status: 'BURN',
    text: '☀️ {USER} 张开黄金羽翼，太阳神烈焰灼烧 {TARGET}，造成 {VAL} 点魔法伤害并灼烧！',
    afterExecute: (ctx, dmg) => {
      if (!isActiveCombatant(ctx.user) || dmg <= 0) return;
      const healed = Math.floor(Math.min(dmg, ctx.target.maxHp) * 0.12);
      if (healed <= 0) return;
      ctx.user.currentHp = Math.min(ctx.user.maxHp, ctx.user.currentHp + healed);
      ctx.user.hpPct = ctx.user.currentHp / ctx.user.maxHp;
      ctx.log('heal', `☀️ ${ctx.user.name} 吸收太阳神火，恢复了 ${healed} 点生命！`);
    },
  },
  ra_divine_pressure: {
    name: '神威压制',
    tag: SKILL_TAGS.DEBUFF,
    rate: 0.35,
    mult: 2.6,
    ignoreDef: true,
    status: 'STUN',
    text: '☀️ {USER} 释放神之威压，压制 {TARGET}，造成 {VAL} 点伤害并震慑！',
    afterExecute: (ctx) => {
      ctx.target.atk = Math.max(1, Math.floor(ctx.target.atk * 0.82));
      ctx.target.mag = Math.max(1, Math.floor(ctx.target.mag * 0.82));
      ctx.target.res = Math.max(1, Math.floor(ctx.target.res * 0.9));
      ctx.log('info', `☀️ ${ctx.target.name} 被太阳神威压削弱，攻击、魔力与魔抗下降！`);
    },
  },
};
