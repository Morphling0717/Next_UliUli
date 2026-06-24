import type { GachaEntry } from '../types';
import { SKILL_TAGS } from './constants';

export const DIVA_BUFF_POOL: GachaEntry[] = [
  { text: "🎵 {USER} 唱起了《甩葱歌》！全队心情愉悦，恢复了 {VAL} 生命！", tag: SKILL_TAGS.HEAL, mult: 2.0 },
  { text: "🎤 {USER} 开启演唱会模式！全队攻击力大幅提升！(Buff)", tag: SKILL_TAGS.BUFF, status: 'RAGE' },
  { text: "🎹 {USER} 弹奏治愈之音！全队获得持续恢复效果！(Regen)", tag: SKILL_TAGS.BUFF, status: 'REGEN' },
  { text: "🎼 {USER} 高音爆发！震晕了 {TARGET}，并为队友加油！", tag: SKILL_TAGS.MAG, mult: 1.0, status: 'STUN' },
  { text: "🎸 {USER} 摇滚时刻！全队获得反击护盾！(Counter)", tag: SKILL_TAGS.BUFF, status: 'COUNTER' },
  { text: "🎧 {USER} 戴上耳机，隔绝噪音！全队魔抗大幅提升！", tag: SKILL_TAGS.BUFF, status: 'PLUG_SKIN' },
  { text: "📢 {USER} 大声应援！所有队友技能冷却刷新！（攻击力小幅提升）", tag: SKILL_TAGS.BUFF, statBuff: { atk: 1.2 } },
  { text: "💃 {USER} 绝美舞姿！魅惑了 {TARGET}，让它无法行动！", tag: SKILL_TAGS.DEBUFF, status: 'CHARMED' },
  { text: "🌟 {USER} 星光闪耀！全队获得短暂无敌！", tag: SKILL_TAGS.BUFF, status: 'INVUL' },
  { text: "💊 {USER} 投喂润喉糖！全队解除了所有异常状态！", tag: SKILL_TAGS.HEAL, mult: 0.5, cleanStatus: true },
  { text: "🎶 {USER} 节奏加速！全队速度提升！", tag: SKILL_TAGS.BUFF, statBuff: { spd: 1.5 } },
  { text: "🛡️ {USER} 粉丝护卫队！召唤人墙保护全队（防御提升）！", tag: SKILL_TAGS.BUFF, statBuff: { def: 1.5 } },
  { text: "✨ {USER} 舞台特效！烟雾缭绕，全队闪避率提升！", tag: SKILL_TAGS.BUFF, statBuff: { agl: 1.5 } },
  { text: "❤️ {USER} 粉丝回馈！全队回复大量生命 {VAL}！", tag: SKILL_TAGS.HEAL, mult: 2.5 },
  { text: "🔥 {USER} 燃曲压轴！全队全属性大幅提升！", tag: SKILL_TAGS.BUFF, status: 'PLUG_HEART' },
];

export const VALORANT_POOL: GachaEntry[] = [
  { text: "🌪️ {USER} 杰特(Jett)附体！瞬风 (Tailwind)！速度拉满冲向 {TARGET} 造成 {VAL} 伤害！", tag: SKILL_TAGS.PHYS, mult: 2.5, status: 'INVUL' },
  { text: "🔥 {USER} 菲尼克斯(Phoenix)！火冒三丈！投掷火球对自己回血，对 {TARGET} 造成 {VAL} 伤害！", tag: SKILL_TAGS.MAG, mult: 2.0, lifesteal: 1.0, status: 'BURN' },
  { text: "🧛 {USER} 蕾娜(Reyna)！吞噬 (Devour)！处决了 {TARGET} 的一部分灵魂，回复大量生命 {VAL}！", tag: SKILL_TAGS.MAG, mult: 2.5, lifesteal: 1.2 },
  { text: "⚡ {USER} 霓虹(Neon)！极速过载！指尖闪电连射 {TARGET}，造成 {VAL} 点伤害！", tag: SKILL_TAGS.MAG, mult: 3.0, hits: 3 },
  { text: "🏹 {USER} 猎枭(Sova)！寻敌箭！透视全场！下一次攻击必定暴击！", tag: SKILL_TAGS.BUFF, status: 'AIM' },
  { text: "🐍 {USER} 蝰蛇(Viper)！开启毒幕！{TARGET} 吸入毒气，受到 {VAL} 伤害并持续衰弱！", tag: SKILL_TAGS.MAG, mult: 1.5, status: 'POISON' },
  { text: "💣 {USER} 雷兹(Raze)！晚安火炮！轰飞了 {TARGET} ({VAL}伤害)！", tag: SKILL_TAGS.PHYS, mult: 4.0, ignoreDef: true },
  { text: "📷 {USER} 零(Cypher)！这具尸体在哪？获取了 {TARGET} 的位置，降低其防御！", tag: SKILL_TAGS.DEBUFF, status: 'CTR_WEAK' },
  { text: "❄️ {USER} 贤者(Sage)！治愈之球！给自己回复了 {VAL} 生命。", tag: SKILL_TAGS.HEAL, mult: 3.0 },
  { text: "🌫️ {USER} 幽影(Omen)！黑影笼罩！{TARGET} 视野丢失 (致盲)！", tag: SKILL_TAGS.DEBUFF, status: 'BLIND' },
  { text: "🤖 {USER} 奇乐(Killjoy)！全面封锁！倒计时结束... 束缚了所有敌人！", tag: SKILL_TAGS.MAG, mult: 1.0, status: 'STUN' },
  { text: "🌍 {USER} 星礈(Astra)！宇宙分裂！进入星界形态，免疫所有伤害！", tag: SKILL_TAGS.BUFF, status: 'INVUL' },
  { text: "🔨 {USER} 炼狱(Brimstone)！天降以此！轨道激光炮轰炸 {TARGET} 造成 {VAL} 毁灭伤害！", tag: SKILL_TAGS.MAG, mult: 4.5 },
  { text: "🌊 {USER} 海港(Harbor)！狂潮！召唤水墙阻挡伤害！", tag: SKILL_TAGS.BUFF, status: 'PLUG_SKIN' },
  { text: "🔆 {USER} 斯凯(Skye)！追猎之灵！三只绿狗扑向 {TARGET} ({VAL}伤害) 并致盲！", tag: SKILL_TAGS.MAG, mult: 2.0, status: 'VALO_FLASH' },
];

export const VALORANT_GUNS_POOL: GachaEntry[] = [
  { text: "🔫 {USER} 掏出「暴徒 (Vandal)」！爆头一击！对 {TARGET} 造成 {VAL} 伤害！", mult: 1.5, tag: SKILL_TAGS.PHYS },
  { text: "🔫 {USER} 掏出「幻象 (Phantom)」！近距离扫射！对 {TARGET} 造成 {VAL} 伤害！", mult: 1.4, tag: SKILL_TAGS.PHYS },
  { text: "🔭 {USER} 架起了「冥驹 (Operator)」！一枪一个！对 {TARGET} 造成 {VAL} 致命伤害！", mult: 2.5, tag: SKILL_TAGS.PHYS, ignoreDef: true },
  { text: "🔫 {USER} 使用「神射 (Sheriff)」！ECO局的神！对 {TARGET} 造成 {VAL} 伤害！", mult: 1.8, tag: SKILL_TAGS.PHYS },
  { text: "🔪 {USER} 掏出「蝴蝶刀」！检视...检视... 背刺 {TARGET} ({VAL}伤害)！", mult: 1.2, tag: SKILL_TAGS.PHYS },
  { text: "💥 {USER} 掏出「奥丁 (Odin)」！穿墙扫射！哒哒哒哒！对 {TARGET} 造成 {VAL} 压制伤害！", mult: 1.6, hits: 2, tag: SKILL_TAGS.PHYS },
];

export const BABY_SUPPORT_POOL: GachaEntry[] = [
  { text: "🍼 {USER} 递上「爱心奶瓶」！克蕾儿全属性大幅提升！", tag: SKILL_TAGS.BUFF, status: 'PLUG_HEART' },
  { text: "🛡️ {USER} 展开「绝对溺爱」护盾！克蕾儿获得无敌！", tag: SKILL_TAGS.BUFF, status: 'INVUL' },
  { text: "💋 {USER} 献上「胜利之吻」！克蕾儿下次攻击必暴击！", tag: SKILL_TAGS.BUFF, status: 'AIM' },
  { text: "🩸 {USER} 输送「生命之源」！克蕾儿恢复 {VAL} 点生命！", tag: SKILL_TAGS.HEAL, mult: 4.0 },
  { text: "🧹 {USER} 帮忙「清理战场」！对 {TARGET} 造成 {VAL} 点清扫伤害！", tag: SKILL_TAGS.MAG, mult: 2.5 },
  { text: "🔋 {USER} 充能「魔力电池」！克蕾儿魔力暴涨！", tag: SKILL_TAGS.BUFF, statBuff: { mag: 2.0 } },
  { text: "🔪 {USER} 递上「磨刀石」！克蕾儿攻击力暴涨！", tag: SKILL_TAGS.BUFF, statBuff: { atk: 2.0 } },
  { text: "👀 {USER} 帮忙「寻找弱点」！降低 {TARGET} 的防御和魔抗！", tag: SKILL_TAGS.DEBUFF, status: 'CTR_WEAK' },
  { text: "🛑 {USER} 大喊「不许欺负她」！眩晕了 {TARGET}！", tag: SKILL_TAGS.DEBUFF, status: 'STUN' },
  { text: "🩹 {USER} 贴上「创可贴」！解除了克蕾儿的异常状态！", tag: SKILL_TAGS.HEAL, mult: 1.0, cleanStatus: true },
  { text: "📢 {USER} 呼叫「场外援助」！轰炸 {TARGET} 造成 {VAL} 伤害！", tag: SKILL_TAGS.PHYS, mult: 3.0 },
  { text: "🕰️ {USER} 发动「时间倒流」！重置了克蕾儿的技能冷却！", tag: SKILL_TAGS.BUFF, status: 'REGEN' },
  { text: "⛓️ {USER} 释放「爱的束缚」！{TARGET} 无法移动（冰冻）！", tag: SKILL_TAGS.DEBUFF, status: 'FREEZE' },
  { text: "🧚‍♀️ {USER} 化身「守护精灵」！克蕾儿闪避率大幅提升！", tag: SKILL_TAGS.BUFF, statBuff: { agl: 2.0 } },
  { text: "💕 {USER} 此时此刻！也是无敌的！两人双双进入暴走状态！", tag: SKILL_TAGS.BUFF, status: 'RAGE' },
];
