import type { SkillDefinition } from '../types';
import { namerenaData as Data } from '../data';

const { SKILL_TAGS } = Data;

export const babySkills: Record<string, SkillDefinition> = {
  baby_feed: { name: '喂食Play', tag: SKILL_TAGS.HEAL, mult: 2.0, text: '🍼 {USER} 给 {TARGET} 喂了一口好吃的！恢复了 {VAL} 生命值！' },
  baby_laser: { name: '协助射击', tag: SKILL_TAGS.MAG, mult: 1.5, text: '🔫 {USER} 掏出光线枪补了一发！对 {TARGET} 造成 {VAL} 伤害！' },
  baby_satellite: { name: '卫星打击', tag: SKILL_TAGS.MAG, mult: 2.0, text: '🛰️ {USER} 呼叫了轨道炮支援！轰炸 {TARGET} 造成 {VAL} 伤害！' },
  baby_cheer: { name: '爱的鼓励', tag: SKILL_TAGS.BUFF, statBuff: { atk: 1.5, mag: 1.5 }, text: '💕 {USER} 给 {TARGET} 疯狂打Call！攻击和魔力大幅上升！' },
  baby_scan: { name: '弱点扫描', tag: SKILL_TAGS.DEBUFF, status: 'WEAK', text: '🔎 {USER} 扫描了 {TARGET} 的弱点！' },
  baby_shield: { name: '纳米护盾', tag: SKILL_TAGS.BUFF, status: 'INVUL', text: '🛡️ {USER} 给 {TARGET} 套上了纳米级无敌护盾！' },
  baby_speed: { name: '极速挂载', tag: SKILL_TAGS.BUFF, statBuff: { spd: 2.0, agl: 2.0 }, text: '⚡ {USER} 给 {TARGET} 安装了加速引擎！速度狂飙！' },
  baby_poison: { name: '投毒', tag: SKILL_TAGS.DEBUFF, status: 'POISON', text: '🧪 {USER} 悄悄给 {TARGET} 下了毒！' },
  baby_bandaid: { name: '创可贴', tag: SKILL_TAGS.HEAL, mult: 1.0, cleanStatus: true, text: '🩹 {USER} 给 {TARGET} 贴上了神奇创可贴！恢复了 {VAL} 生命值并解除了所有异常状态！' },
};
