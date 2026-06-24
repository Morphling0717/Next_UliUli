import type { SkillDefinition } from '../types';
import { namerenaData as Data } from '../data';

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
      enemies.forEach((enemy) => {
        const actualDmg = ctx.applyDamage(enemy, baseDmg, 'skill', true);
        if (actualDmg > 0) {
          ctx.log('skill', `🧙‍♂️ 黑暗大法师的怒火命中 ${enemy.name}，实际造成 ${actualDmg} 点真实伤害！`);
        } else {
          ctx.log('info', `🧙‍♂️ 黑暗大法师的怒火扫过 ${enemy.name}，但没有造成实际伤害！`);
        }
        if (enemy.currentHp > 0 && enemy.hpPct <= 0.18) {
          ctx.markDefeated(enemy, { message: `☠️ 【封印处决】${enemy.name} 被黑暗大法师的禁忌力量彻底抹除！`, killer: ctx.user, setHpZero: false });
        } else if (enemy.currentHp <= 0) {
          ctx.markDefeated(enemy, { message: `💀 【Exodia Obliterate】${enemy.name} 被黑暗大法师轰成了卡片碎屑！`, killer: ctx.user });
        }
      });
      ctx.user.status.push({ type: 'SPELL_BLOCK', duration: 2 });
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
      activeEnemies(ctx)
        .filter((enemy) => enemy.id !== ctx.target.id)
        .slice(0, 2)
        .forEach((enemy) => {
          const actualDmg = ctx.applyDamage(enemy, splashDmg, 'skill');
          if (actualDmg > 0) {
            ctx.log('skill', `🌪️ 白龙扫射的余波命中 ${enemy.name}，实际造成 ${actualDmg} 点溅射伤害！`);
          } else {
            ctx.log('info', `🌪️ 白龙扫射的余波擦过 ${enemy.name}，但没有造成实际伤害！`);
          }
          if (enemy.currentHp <= 0) {
            ctx.markDefeated(enemy, { message: `💀 【白龙扫射】${enemy.name} 被青眼白龙的龙息余波击落！`, killer: ctx.user });
          }
        });
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
};
