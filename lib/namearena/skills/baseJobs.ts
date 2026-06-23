import type { SkillDefinition } from '../types';
import { namerenaData as Data } from '../data';

const { SKILL_TAGS } = Data;

export const baseJobSkills: Record<string, SkillDefinition> = {
  hero_slash:   { name: '勇者之剑',   tag: SKILL_TAGS.PHYS,  rate: 0.3,  mult: 2.0, text: '🗡️ {USER} 挥舞发光的勇者之剑，劈砍 {TARGET}，造成 {VAL} 伤害！' },
  hero_guard:   { name: '勇者护盾',   tag: SKILL_TAGS.BUFF,  rate: 0.15, status: 'COUNTER', text: '🛡️ {USER} 举起勇者之盾，进入反击姿态！' },
  serious_punch:{ name: '认真一拳',   tag: SKILL_TAGS.PHYS,  rate: 0.5,  mult: 5.0, ignoreDef: true, text: '👊 {USER} 眼神变得犀利... 认真一拳！瞬间粉碎了 {TARGET}，造成 {VAL} 真实伤害！' },
  aim_shot:     { name: '瞄准射击',   tag: SKILL_TAGS.PHYS,  rate: 0.3,  mult: 1.8, text: '🏹 {USER} 屏息凝神，一箭精准射中 {TARGET}，造成 {VAL} 伤害。' },
  multi_shot:   { name: '多重射击',   tag: SKILL_TAGS.PHYS,  rate: 0.2,  mult: 0.8, hits: 3, text: '🏹 {USER} 瞬间射出三支箭矢！对 {TARGET} 造成 {VAL} 伤害。' },
  holy_shield:  { name: '神圣护盾',   tag: SKILL_TAGS.BUFF,  rate: 0.15, status: 'INVUL', text: '🛡️ {USER} 施放神之力量，获得无敌护盾！' },
  bash:         { name: '盾击',        tag: SKILL_TAGS.PHYS,  rate: 0.25, mult: 1.2, status: 'STUN', text: '🛡️ {USER} 举盾猛击，造成 {VAL} 伤害并眩晕了 {TARGET}！' },
  fireball:     { name: '火球术',      tag: SKILL_TAGS.MAG,   rate: 0.3,  mult: 1.5, status: 'BURN', text: '🔥 {USER} 搓出一发大火球，轰炸 {TARGET} 造成 {VAL} 魔法伤害！' },
  heal:         { name: '治疗术',      tag: SKILL_TAGS.HEAL,  rate: 0.35, mult: 1.5, condition: (u) => u.hpPct < 0.7, text: '✨ {USER} 沐浴圣光，恢复了 {VAL} 生命。' },
  smite:        { name: '圣光击',      tag: SKILL_TAGS.MAG,   rate: 0.25, mult: 1.4, text: '⚡ {USER} 圣光打击 {TARGET}，造成 {VAL} 魔法伤害。' },
  smoke_bomb:   { name: '烟雾弹',      tag: SKILL_TAGS.DEBUFF,rate: 0.2,  status: 'BLIND', text: '💨 {USER} 扔下烟雾弹，{TARGET} 丢失视野！' },
  meteor:       { name: '陨石术',      tag: SKILL_TAGS.MAG,   rate: 0.1,  mult: 3.0, status: 'STUN', text: '☄️ {USER} 召唤了巨大的陨石砸向 {TARGET}，造成 {VAL} 魔法伤害并眩晕！' },
  rage:         { name: '狂暴',        tag: SKILL_TAGS.BUFF,  rate: 0.1,  status: 'RAGE', text: '😡 {USER} 双眼通红，进入了狂暴状态！' },
};
