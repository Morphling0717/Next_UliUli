import type { GachaEntry } from '../types';
import { SKILL_TAGS } from './constants';

export const SUCCUBUS_COUNTER_POOL: GachaEntry[] = [
  { text: "💕 {USER} 摆出诱惑姿态，准备【魅惑反击】！", tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'CTR_CHARM' }] },
  { text: "😵 {USER} 散发恐怖气场，准备【震慑反击】！", tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'CTR_STUN' }] },
  { text: "🧛 {USER} 张开鲜血结界，准备【汲取反击】！", tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'CTR_DRAIN' }] },
  { text: "🦠 {USER} 涂抹致命毒素，准备【剧毒反击】！", tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'CTR_POISON' }] },
  { text: "🔥 {USER} 召唤地狱烈焰，准备【烈焰反击】！", tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'CTR_BURN' }] },
  { text: "🧊 {USER} 凝结极寒冰霜，准备【极寒反击】！", tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'CTR_FREEZE' }] },
  { text: "🌌 {USER} 扭曲周围空间，准备【虚空反击】！", tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'CTR_VOID' }] },
  { text: "📉 {USER} 释放虚弱诅咒，准备【虚弱反击】！", tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'CTR_WEAK' }] },
  { text: "🌀 {USER} 制造幻象迷宫，准备【混乱反击】！", tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'CTR_CONFUSE' }] },
  { text: "☠️ {USER} 磨亮了处刑镰刀，准备【断头反击】！", tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'CTR_EXECUTE' }] },
];

export const CHIMERA_PLUGIN_POOL: GachaEntry[] = [
  { text: "🦷 {USER} 安装了头部插件【暴食之口】！(获得吸血被动，习得「暴食·吞界法」)", tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'PLUG_HEAD' }], newSkill: 'chimera_devour', permanentStatMultiplier: { atk: 1.5 } },
  { text: "⚔️ {USER} 安装了手臂插件【斩舰巨刃】！(攻击暴击大增，习得「处刑·断头台」)", tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'PLUG_ARM' }], newSkill: 'chimera_execute', permanentStatMultiplier: { atk: 1.3, crit: 0.2 } },
  { text: "🛸 {USER} 安装了背部插件【浮游炮阵】！(魔力智力大增，习得「歼灭·全弹发射」)", tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'PLUG_BACK' }], newSkill: 'chimera_funnels', permanentStatMultiplier: { mag: 1.5, wis: 1.5 } },
  { text: "☢️ {USER} 安装了心脏插件【永动炉心】！(全属性强化，习得「再生·血肉重铸」)", tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'PLUG_HEART' }], newSkill: 'chimera_reconstruct', permanentStatMultiplier: { atk: 1.2, def: 1.2, spd: 1.2, mag: 1.2 } },
  { text: "👁️ {USER} 安装了眼部插件【石化魔眼】！(魔力命中提升，习得「魔眼·美杜莎」)", tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'PLUG_EYE' }], newSkill: 'chimera_petrify', permanentStatMultiplier: { mag: 1.3, agl: 1.3 } },
  { text: "🛡️ {USER} 安装了皮肤插件【纳米皮肤】！(双抗大幅提升，习得「堡垒·绝对力场」)", tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'PLUG_SKIN' }], newSkill: 'chimera_fortress', permanentStatMultiplier: { def: 1.5, res: 1.5 } },
  { text: "🦶 {USER} 安装了腿部插件【反重力足】！(速度闪避提升，习得「极速·缩地成寸」)", tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'PLUG_LEG' }], newSkill: 'chimera_warp', permanentStatMultiplier: { spd: 1.5, agl: 1.5 } },
  { text: "🦂 {USER} 安装了尾部插件【灾厄毒尾】！(攻击魔力提升，习得「灾厄·病毒君王」)", tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'PLUG_TAIL' }], newSkill: 'chimera_plague', permanentStatMultiplier: { atk: 1.3, mag: 1.3 } },
];
