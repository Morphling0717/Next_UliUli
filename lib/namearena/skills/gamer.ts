import type { SkillDefinition } from '../types';
import { namerenaData as Data } from '../data';

const { SKILL_TAGS } = Data;

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
};
