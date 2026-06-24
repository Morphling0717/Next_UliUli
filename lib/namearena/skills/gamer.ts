import type { SkillDefinition } from '../types';
import { namerenaData as Data } from '../data';
import { healFighter } from '../combatState';
import { COMMON_NEGATIVE_STATUS_TYPES, isStatusType } from '../statusRules';

const { SKILL_TAGS } = Data;

const MAX_APM = 12;

function spendApm(user: { apm?: number }, cost: number): boolean {
  if ((user.apm ?? 0) < cost) return false;
  user.apm = Math.max(0, Math.min(MAX_APM, (user.apm ?? 0) - cost));
  return true;
}

export const gamerSkills: Record<string, SkillDefinition> = {
  awp_shot: { name: '大狙盲狙', tag: SKILL_TAGS.PHYS, mult: 3.0, ignoreDef: true, text: '🎯 {USER} 掏出AWP，空中转体360度盲狙，一枪爆了 {TARGET} 的头！造成 {VAL} 真实伤害！' },
  flash_lol: { name: '闪现A', tag: SKILL_TAGS.PHYS, mult: 1.5, status: 'AIM', text: '✨ {USER} 极限闪现拉近距离，对 {TARGET} 打出必中一击！造成 {VAL} 伤害！' },
  hook_dota: { name: '肉钩', tag: SKILL_TAGS.PHYS, mult: 1.5, status: 'STUN', text: '🪝 {USER} 盲出肉钩，精准命中了 {TARGET}，造成 {VAL} 伤害并眩晕！' },
  helm_breaker: { name: '登龙剑', tag: SKILL_TAGS.PHYS, mult: 2.5, text: '🐉 {USER} 高高跃起，一招气刃兜割劈在 {TARGET} 身上！造成 {VAL} 伤害！' },
  tcs_mh: { name: '真蓄力斩', tag: SKILL_TAGS.PHYS, mult: 4.0, text: '⚔️ {USER} 完美铁山靠顶住攻击，随后猛力劈下真蓄力斩！对 {TARGET} 造成 {VAL} 伤害！' },
  waterfowl: { name: '水鸟乱舞', tag: SKILL_TAGS.PHYS, mult: 0.8, hits: 5, text: '🦢 {USER} 化身女武神，对 {TARGET} 施展水鸟乱舞！连续劈砍 5 次，共造成 {VAL} 伤害！' },
  bkb_dota: { name: '开启BKB', tag: SKILL_TAGS.BUFF, status: 'BKB', text: '🟡 {USER} 开启了黑皇杖，全身散发金光，免疫一切魔法控制！' },
  rush_b: { name: 'Rush B', tag: SKILL_TAGS.BUFF, statBuff: { spd: 2.0, atk: 1.5 }, text: "🏃 {USER} 大喊一声 \"Rush B, Don't stop!\"，速度和攻击力飙升！" },
  yasuo_q: { name: '哈撒给', tag: SKILL_TAGS.MAG, mult: 1.5, status: 'STUN', text: '🌪️ {USER} 斩出一道龙卷风，将 {TARGET} 高高击飞！造成 {VAL} 伤害！' },
  teemo_shroom: { name: '种蘑菇', tag: SKILL_TAGS.MAG, mult: 1.0, status: 'POISON', text: '🍄 {USER} 偷偷在 {TARGET} 脚下种了个毒蘑菇，造成 {VAL} 伤害并施加剧毒！' },
  divine_sunderer: { name: '神圣分离者', tag: SKILL_TAGS.PHYS, mult: 1.5, lifesteal: 0.5, text: '🔨 {USER} 触发耀光效果重击 {TARGET}，造成 {VAL} 伤害并回复自身血量！' },
  judgment_cut: { name: '次元斩', tag: SKILL_TAGS.MAG, mult: 3.0, ignoreDef: true, text: '🗡️ {USER} 拔刀瞬间切开空间，对 {TARGET} 造成 {VAL} 无视魔抗的次元伤害！' },
  kamehameha: { name: '龟派气功', tag: SKILL_TAGS.MAG, mult: 4.0, text: '🐢 {USER} 双手聚气："龟—派—气—功—波！" 轰穿了 {TARGET}，造成 {VAL} 伤害！' },
  zonia: { name: '金身', tag: SKILL_TAGS.BUFF, status: 'INVUL', text: '⏱️ {USER} 按下了中娅沙漏，化为小金人，进入无敌状态！' },
  aim_bot: { name: '锁头挂', tag: SKILL_TAGS.BUFF, status: 'AIM', statBuff: { crit: 1.0 }, text: '💻 {USER} 偷偷开启了锁头脚本... 下次攻击必定暴击且无法闪避！' },
  lag_switch: { name: '拔网线', tag: SKILL_TAGS.DEBUFF, status: 'STUN', text: '🔌 {USER} 物理拔掉了服务器网线！{TARGET} 掉线了，原地罚站！' },
  roll_dodge: { name: '翻滚无敌帧', tag: SKILL_TAGS.BUFF, status: 'INVUL', text: '🔄 {USER} 熟练地进行翻滚，利用无敌帧规避了即将到来的所有伤害！' },
  tp_scroll: { name: 'TP逃生', tag: SKILL_TAGS.HEAL, mult: 2.0, text: '📜 {USER} 亮起TP光芒，瞬间回到泉水恢复了 {VAL} 点生命值，又TP回了战场！' },
  warcry_dota: { name: '战吼', tag: SKILL_TAGS.BUFF, statBuff: { def: 2.0, res: 2.0 }, text: '吼 {USER} 发出战吼，护甲和魔抗大幅提升！' },

  gamer_headshot_line: {
    name: '爆头线',
    tag: SKILL_TAGS.PHYS,
    mult: 2.8,
    ignoreDef: true,
    minDamagePct: 0.18,
    text: '🎯 {USER} 把准星压到爆头线，精准点掉 {TARGET}，造成 {VAL} 真实伤害！',
  },
  gamer_perfect_parry: {
    name: '完美弹反',
    tag: SKILL_TAGS.BUFF,
    status: 'COUNTER',
    statBuff: { def: 1.25, res: 1.25 },
    text: '🛡️ {USER} 读准前摇，进入完美弹反姿态，双抗提升并准备反击！',
  },
  gamer_estus_cancel: {
    name: '喝瓶取消',
    tag: SKILL_TAGS.HEAL,
    condition: (user) => (user.apm ?? 0) >= 2,
    text: '🧃 {USER} 卡掉后摇喝下恢复道具，稳住血线！',
    onExecute: (ctx) => {
      if (!spendApm(ctx.user, 2)) return false;
      ctx.user.status = ctx.user.status.filter((status) => !isStatusType(status.type, COMMON_NEGATIVE_STATUS_TYPES));
      const healAmt = Math.floor(ctx.user.maxHp * 0.25 + Math.max(ctx.user.atk, ctx.user.mag) * 0.5);
      const healed = healFighter(ctx.user, healAmt);
      const healText = healed > 0 ? `并恢复了 ${healed} 点生命` : '但生命已满，治疗溢出';
      ctx.log('heal', `🧃 【喝瓶取消】${ctx.user.name} 消耗 2 APM 清掉常规异常，${healText}！`);
      return true;
    },
  },
  gamer_tactical_pause: {
    name: '战术暂停',
    tag: SKILL_TAGS.DEBUFF,
    mult: 1.6,
    status: 'STUN',
    condition: (user) => (user.apm ?? 0) >= 3,
    text: '⏸️ {USER} 抓住对局节奏强行暂停，{TARGET} 被读到下一步行动，受到 {VAL} 伤害并眩晕！',
    onExecute: (ctx) => {
      if (!spendApm(ctx.user, 3)) return false;
      return false;
    },
  },
  gamer_wombo_combo: {
    name: '团战连招',
    tag: SKILL_TAGS.SPECIAL,
    condition: (user) => (user.apm ?? 0) >= 3,
    text: '🌀 {USER} 开启 MOBA 团战思路，准备打一套群体连招！',
    onExecute: (ctx) => {
      if (!spendApm(ctx.user, 3)) return false;
      const enemies = (ctx.currentTargets ?? []).filter((target) => target.currentHp > 0).slice(0, 3);
      const dmg = Math.floor(Math.max(ctx.user.atk, ctx.user.mag) * 0.95);
      ctx.log('skill', `🌀 【团战连招】${ctx.user.name} 消耗 3 APM 多线操作，向 ${enemies.length} 名敌人打出连招！`);
      let totalDmg = 0;
      enemies.forEach((enemy) => {
        const actualDmg = ctx.applyDamage(enemy, dmg, 'skill');
        totalDmg += actualDmg;
        ctx.user.stats.dmgDealt += actualDmg;
        if (actualDmg > 0) {
          ctx.log('info', `🎮 连招命中 ${enemy.name}，实际造成 ${actualDmg} 点伤害！`);
        } else {
          ctx.log('info', `🎮 连招扫到 ${enemy.name}，但没有造成实际伤害！`);
        }
        if (enemy.currentHp <= 0 && !enemy.isDead && !enemy.isDeadAnnounced) {
          ctx.markDefeated(enemy, { message: `💀 【团战收割】${enemy.name} 被玄凝的多线操作打崩了！`, killer: ctx.user });
        }
      });
      if (totalDmg > 0) {
        ctx.log('info', `🌀 【团战连招】${ctx.user.name} 本次多线操作总计造成 ${totalDmg} 点伤害！`);
      } else {
        ctx.log('info', `🌀 【团战连招】${ctx.user.name} 这轮多线操作没有打出有效伤害！`);
      }
      return true;
    },
  },
  gamer_qte_execute: {
    name: '处决QTE',
    tag: SKILL_TAGS.SPECIAL,
    condition: (user) => (user.apm ?? 0) >= 4,
    text: '🎮 {USER} 看到处决提示亮起，按下完美 QTE！',
    onExecute: (ctx) => {
      if (!spendApm(ctx.user, 4)) return false;
      const hpRatio = ctx.target.currentHp / ctx.target.maxHp;
      const dmg = Math.floor(ctx.user.atk * (hpRatio < 0.35 ? 4.2 : 2.6));
      const actualDmg = ctx.applyDamage(ctx.target, dmg, 'skill', true);
      ctx.user.stats.dmgDealt += actualDmg;
      if (actualDmg > 0) {
        ctx.log('crit', `🎮 【处决QTE】${ctx.user.name} 消耗 4 APM 打出完美输入，对 ${ctx.target.name} 实际造成 ${actualDmg} 点真实处决伤害！`);
      } else {
        ctx.log('info', `🎮 【处决QTE】${ctx.user.name} 消耗 4 APM 打出完美输入，但 ${ctx.target.name} 没有承受实际伤害！`);
      }
      if (ctx.target.currentHp <= 0 && !ctx.target.isDead && !ctx.target.isDeadAnnounced) {
        ctx.markDefeated(ctx.target, { message: `💀 【QTE处决】${ctx.target.name} 被玄凝一套操作带走！`, killer: ctx.user });
      }
      return true;
    },
  },
  gamer_speedrun_route: {
    name: '速通路线',
    tag: SKILL_TAGS.BUFF,
    status: 'AIM',
    condition: (user) => (user.apm ?? 0) >= 2,
    text: '🏃 {USER} 规划速通路线，下一次攻击将精准命中弱点！',
    onExecute: (ctx) => {
      if (!spendApm(ctx.user, 2)) return false;
      return false;
    },
  },
  gamer_read_inputs: {
    name: '读输入',
    tag: SKILL_TAGS.DEBUFF,
    mult: 1.8,
    status: 'NEURAL_THEFT_DEBUFF',
    condition: (user) => (user.apm ?? 0) >= 3,
    text: '👁️ {USER} 像打格斗游戏一样读到了 {TARGET} 的输入，造成 {VAL} 伤害并暴露弱点！',
    onExecute: (ctx) => {
      if (!spendApm(ctx.user, 3)) return false;
      return false;
    },
  },
  gamer_clutch_ace: {
    name: '1vX残局',
    tag: SKILL_TAGS.SPECIAL,
    condition: (user) => (user.apm ?? 0) >= 3,
    text: '🏅 {USER} 进入 1vX 残局，开始冷静拆解战场！',
    onExecute: (ctx) => {
      if (!spendApm(ctx.user, 3)) return false;
      ctx.user.status = ctx.user.status.filter((status) => !isStatusType(status.type, COMMON_NEGATIVE_STATUS_TYPES));
      ctx.user.status.push({ type: 'BKB', duration: 1 });
      ctx.user.status.push({ type: 'AIM', duration: 1 });
      const healed = healFighter(ctx.user, Math.floor(ctx.user.maxHp * 0.24 + ctx.user.wis * 0.9));
      const dmg = Math.floor(Math.max(ctx.user.atk, ctx.user.mag) * 2.2);
      const actualDmg = ctx.applyDamage(ctx.target, dmg, 'skill', true);
      ctx.user.stats.dmgDealt += actualDmg;
      const healText = healed > 0 ? `恢复 ${healed} 点生命` : '治疗溢出';
      const damageText = actualDmg > 0 ? `并对 ${ctx.target.name} 打出 ${actualDmg} 点真实反打伤害` : `但没有对 ${ctx.target.name} 造成实际伤害`;
      ctx.log(actualDmg > 0 ? 'crit' : 'info', `🏅 【1vX残局】${ctx.user.name} 消耗 3 APM 清掉异常、${healText}，${damageText}！`);
      if (ctx.target.currentHp <= 0 && !ctx.target.isDead && !ctx.target.isDeadAnnounced) {
        ctx.markDefeated(ctx.target, { message: `💀 【残局收割】${ctx.target.name} 被玄凝的残局处理带走！`, killer: ctx.user });
      }
      return true;
    },
  },
  gamer_world_combo: {
    name: '世界赛名场面',
    tag: SKILL_TAGS.SPECIAL,
    condition: (user) => (user.apm ?? 0) >= 5 && user.status.some((status) => status.type === 'GAMER_WORLD_STAGE'),
    text: '🏆 {USER} 进入世界赛状态，开始复刻名场面！',
    onExecute: (ctx) => {
      if (!spendApm(ctx.user, 6)) return false;
      const primary = Math.floor(Math.max(ctx.user.atk, ctx.user.mag) * 3.0);
      const actualPrimary = ctx.applyDamage(ctx.target, primary, 'skill', true);
      ctx.user.stats.dmgDealt += actualPrimary;
      if (actualPrimary > 0) {
        ctx.log('crit', `🏆 【世界赛名场面】${ctx.user.name} 消耗 6 APM 打出高光操作，对 ${ctx.target.name} 实际造成 ${actualPrimary} 点真实伤害！`);
      } else {
        ctx.log('info', `🏆 【世界赛名场面】${ctx.user.name} 消耗 6 APM 打出高光操作，但 ${ctx.target.name} 没有承受实际伤害！`);
      }
      const splash = Math.floor(primary * 0.25);
      (ctx.currentTargets ?? [])
        .filter((enemy) => enemy.id !== ctx.target.id && enemy.currentHp > 0)
        .slice(0, 2)
        .forEach((enemy) => {
          const actualDmg = ctx.applyDamage(enemy, splash, 'skill', true);
          ctx.user.stats.dmgDealt += actualDmg;
          if (actualDmg > 0) {
            ctx.log('info', `🏆 名场面余波波及 ${enemy.name}，实际造成 ${actualDmg} 点真实伤害！`);
          } else {
            ctx.log('info', `🏆 名场面余波波及 ${enemy.name}，但没有造成实际伤害！`);
          }
          if (enemy.currentHp <= 0 && !enemy.isDead && !enemy.isDeadAnnounced) {
            ctx.markDefeated(enemy, { message: `💀 【名场面收割】${enemy.name} 被玄凝的世界赛操作带走！`, killer: ctx.user });
          }
        });
      if (ctx.target.currentHp <= 0 && !ctx.target.isDead && !ctx.target.isDeadAnnounced) {
        ctx.markDefeated(ctx.target, { message: `💀 【名场面处决】${ctx.target.name} 倒在玄凝的世界赛操作下！`, killer: ctx.user });
      }
      return true;
    },
  },
};
