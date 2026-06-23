import type { SkillDefinition } from '../types';
import { namerenaData as Data } from '../data';
import { REVIVE_CLEAN_STATUS_TYPES, isStatusType } from '../statusRules';

const { SKILL_TAGS } = Data;

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
  valo_holding_angle: { name: '架枪预瞄', tag: SKILL_TAGS.BUFF, status: 'VALO_HOLDING_ANGLE', text: '🔭 {USER} 停止移动，进入了架枪预瞄姿态！' },
  valo_pre_fire: { name: '提前枪', tag: SKILL_TAGS.PHYS, mult: 1.5, minDamagePct: 0.18, status: 'VALO_AIM_PUNCH', text: '🔫 {USER} 扣下扳机，精准的提前枪击中了 {TARGET} 并附加了【截停】！' },

  valo_ult_showstopper: {
    name: '晚安火炮', tag: SKILL_TAGS.PHYS, mult: 3.0, text: '🚀 {USER} 掏出火箭筒："FIRE IN THE HOLE！" 轰炸了 {TARGET}，造成 {VAL} 毁灭伤害！',
    afterExecute: (ctx, dmg) => {
      const otherEnemies = (ctx.currentTargets ?? []).filter((f) => f.id !== ctx.target.id && !f.isDead).sort(() => 0.5 - Math.random()).slice(0, 2);
      if (otherEnemies.length > 0) {
        ctx.log('skill', `🚀 【晚安火炮】爆炸波及了周围的敌人！造成大量范围伤害！`);
        const aoeDmg = Math.floor(dmg * 0.8);
        otherEnemies.forEach((e) => {
          const actualDmg = ctx.applyDamage(e, aoeDmg, 'skill');
          ctx.log('info', `💥 爆炸余波重创了 ${e.name}，造成了 ${actualDmg} 点伤害！`);
          if (e.currentHp <= 0) ctx.markDefeated(e, { message: `💀 【范围击杀】${e.name} 被晚安火炮的余波炸碎了！`, killer: ctx.user });
          const idx = (ctx.fighters ?? []).findIndex((x) => x.id === e.id);
          if (idx !== -1) ctx.fighters[idx] = e;
        });
      }
    },
  },

  valo_ult_blade_storm: {
    name: '飓刃', tag: SKILL_TAGS.PHYS, mult: 2.0, ignoreDef: true, text: '🔪 {USER} 召唤出环绕的飓刃！飞刀贯穿了 {TARGET}，造成 {VAL} 真实伤害！',
    afterExecute: (ctx) => {
      if (ctx.target.currentHp <= 0 && !ctx.target.isDead) {
        ctx.log('win', `🔪 【飓刃】收割！${ctx.user.name} 拿到击杀，刷新行动条，立即再次出手！`);
        ctx.executeSkillAction('valo_ult_blade_storm', ctx.user, null, ctx.triggerDepth + 1);
      }
    },
  },

  valo_ult_empress: { name: '女皇神威', tag: SKILL_TAGS.BUFF, status: 'VALO_ULT_EMPRESS', statBuff: { atk: 2.0, spd: 2.0 }, text: '👑 {USER} 进入女皇状态！"绝不留情！" 攻击力与速度翻倍，且获得100%吸血！' },
  valo_ult_run_it_back: { name: '再火一回', tag: SKILL_TAGS.BUFF, status: 'VALO_ULT_RUN_IT_BACK', text: '🔥 {USER} 留下了时空标记："别急，我还会回来的！" 获得了免死金牌！' },
  valo_ult_hunters_fury: { name: '狂猎之怒', tag: SKILL_TAGS.MAG, mult: 1.5, hits: 3, ignoreDef: true, text: '🦅 {USER} 张弓搭箭："我就是猎人！" 三道能量箭穿透了 {TARGET}，共造成 {VAL} 真实伤害！' },

  valo_ult_orbital_strike: {
    name: '天降以此', tag: SKILL_TAGS.MAG, mult: 6.0, text: '🛰️ {USER} 呼叫轨道打击："准备迎接地狱火吧！" 激光炮锁定了 {TARGET}，造成 {VAL} 毁灭伤害！',
    afterExecute: (ctx, dmg, hpBeforeDamage) => {
      if (dmg > (hpBeforeDamage ?? 0)) {
        const overflow = dmg - (hpBeforeDamage ?? 0);
        const otherEnemies = (ctx.currentTargets ?? []).filter((f) => f.id !== ctx.target.id && !f.isDead);
        if (otherEnemies.length > 0) {
          ctx.log('crit', `🛰️ 【天降以此】火力过剩！溢出的 ${overflow} 点伤害溅射给了其他敌人！`);
          const splashDmg = Math.floor(overflow / otherEnemies.length);
          otherEnemies.forEach((e) => {
            const actualDmg = ctx.applyDamage(e, splashDmg, 'skill');
            ctx.log('info', `🔥 轨道炮的炽热余波溅射到了 ${e.name}，造成了 ${actualDmg} 点伤害！`);
            if (e.currentHp <= 0) ctx.markDefeated(e, { message: `💀 【溅射击杀】${e.name} 被轨道炮的余波轰成了渣！`, killer: ctx.user });
            const idx = (ctx.fighters ?? []).findIndex((x) => x.id === e.id);
            if (idx !== -1) ctx.fighters[idx] = e;
          });
        }
      }
    },
  },

  valo_ult_cosmic_divide: {
    name: '宇宙分裂', tag: SKILL_TAGS.SPECIAL, text: '🌍 {USER} 撕裂空间...',
    onExecute: (ctx) => {
      const userTeamId = ctx.getTeamId(ctx.user);
      const allies = (ctx.fighters ?? []).filter((f) => !f.isDead && ctx.getTeamId(f) === userTeamId);
      allies.forEach((a) => {
        a.status = a.status ?? [];
        a.status.push({ type: 'INVUL', duration: 1 });
        a.status = a.status.filter(
          (s) => !['STUN', 'FREEZE', 'BURN', 'POISON', 'BLIND', 'SILENCE', 'CONFUSED', 'CHARMED', 'VALO_AIM_PUNCH', 'NEURAL_THEFT_DEBUFF'].includes(s.type),
        );
        const idx = (ctx.fighters ?? []).findIndex((x) => x.id === a.id);
        if (idx !== -1) ctx.fighters[idx] = a;
      });
      ctx.log('win', `🌍 【宇宙分裂】${ctx.user.name} 撕裂了空间！全队获得绝对无敌并净化所有负面状态！`);
      return true;
    },
  },

  valo_ult_resurrection: {
    name: '复活', tag: SKILL_TAGS.SPECIAL, text: '💉 {USER} 注入生命之玉...',
    onExecute: (ctx) => {
      const myTeamId = ctx.getTeamId(ctx.user);
      const deadTeammates = (ctx.fighters ?? []).filter(
        (f) => f.isDead && ctx.getTeamId(f) === myTeamId && f.id !== ctx.user.id,
      );
      if (deadTeammates.length > 0) {
        const targetToRevive = deadTeammates[Math.floor(Math.random() * deadTeammates.length)];
        if (targetToRevive.baseStatsForZero) {
          targetToRevive.atk = targetToRevive.baseStatsForZero.atk;
          targetToRevive.def = targetToRevive.baseStatsForZero.def;
          targetToRevive.res = targetToRevive.baseStatsForZero.res;
          delete targetToRevive.baseStatsForZero;
          targetToRevive.wasZeroed = false;
        }
        targetToRevive.isDead = false;
        targetToRevive.isDeadAnnounced = false;
        targetToRevive.isActing = false;
        targetToRevive.isHit = false;
        targetToRevive.currentHp = targetToRevive.maxHp;
        targetToRevive.hpPct = 1.0;
        targetToRevive.status = (targetToRevive.status ?? []).filter((s) => !isStatusType(s.type, REVIVE_CLEAN_STATUS_TYPES));
        ctx.log('win', `💉 【复活】${ctx.user.name} 消耗终极点数，复活了 ${targetToRevive.name} (恢复了 ${targetToRevive.maxHp} 点生命)！"你的职责尚未完成！"`);
        const revIdx = (ctx.fighters ?? []).findIndex((f) => f.id === targetToRevive.id);
        if (revIdx !== -1) ctx.fighters[revIdx] = targetToRevive;
      }
      return true;
    },
  },

  valo_ult_lockdown: {
    name: '全面封锁', tag: SKILL_TAGS.SPECIAL, text: '🤖 {USER} 部署封锁装置...',
    onExecute: (ctx) => {
      (ctx.currentTargets ?? []).forEach((e) => {
        e.status = e.status ?? [];
        e.status.push({ type: 'STUN', duration: 2 });
        const idx = (ctx.fighters ?? []).findIndex((x) => x.id === e.id);
        if (idx !== -1) ctx.fighters[idx] = e;
      });
      ctx.log('skill', `🤖 【全面封锁】倒计时结束！${ctx.user.name} 的装置释放次级波，眩晕了所有敌人！`);
      return true;
    },
  },

  valo_ult_vipers_pit: {
    name: '蝰蛇神殿', tag: SKILL_TAGS.SPECIAL, text: '🐍 {USER} 展开毒幕...',
    onExecute: (ctx) => {
      (ctx.currentTargets ?? []).forEach((e) => {
        e.status = e.status ?? [];
        e.status.push({ type: 'POISON', duration: 3 });
        e.status.push({ type: 'BLIND', duration: 3 });
        e.def = Math.floor(e.def * 0.5);
        e.res = Math.floor(e.res * 0.5);
        const idx = (ctx.fighters ?? []).findIndex((x) => x.id === e.id);
        if (idx !== -1) ctx.fighters[idx] = e;
      });
      ctx.log('skill', `🐍 【蝰蛇神殿】全场弥漫剧毒！所有敌人中毒、致盲且防御骤降！`);
      return true;
    },
  },

  valo_ult_null_cmd: {
    name: '全面压制', tag: SKILL_TAGS.SPECIAL, text: '🤖 {USER} 发射抑制脉冲...',
    onExecute: (ctx) => {
      (ctx.currentTargets ?? []).forEach((e) => {
        e.status = e.status ?? [];
        e.status.push({ type: 'SILENCE', duration: 3 });
        const idx = (ctx.fighters ?? []).findIndex((x) => x.id === e.id);
        if (idx !== -1) ctx.fighters[idx] = e;
      });
      ctx.user.atk = Math.floor(ctx.user.atk * 1.5);
      ctx.log('skill', `🤖 【全面压制】抑制脉冲激活！所有敌人被【沉默】，${ctx.user.name} 攻击力上升！`);
      return true;
    },
  },

  valo_ult_neural_theft: {
    name: '神经取缔', tag: SKILL_TAGS.SPECIAL, text: '📷 {USER} 抛出帽子读取记忆...',
    onExecute: (ctx) => {
      (ctx.currentTargets ?? []).forEach((e) => {
        e.status = e.status ?? [];
        e.status.push({ type: 'NEURAL_THEFT_DEBUFF', duration: 2 });
        e.agl = 0;
        const idx = (ctx.fighters ?? []).findIndex((x) => x.id === e.id);
        if (idx !== -1) ctx.fighters[idx] = e;
      });
      ctx.log('skill', `📷 【神经取缔】"我知道你们在哪！" 敌方全体弱点暴露（闪避归零、必吃暴击）！`);
      return true;
    },
  },
};
