import type { SkillDefinition } from '../types';
import { namerenaData as Data } from '../data';

const {
  SKILL_TAGS,
  SUCCUBUS_COUNTER_POOL,
} = Data;

export const succubusSkills: Record<string, SkillDefinition> = {
  charm: { name: '魅惑', tag: SKILL_TAGS.DEBUFF, statusApplications: [{ identityId: 'CHARMED' }], text: '💋 {USER} 向 {TARGET} 抛了个媚眼，{TARGET} 被彻底迷住了！' },
  life_drain: { name: '生命汲取', tag: SKILL_TAGS.MAG, mult: 1.2, lifesteal: 1.0, text: '🧛 {USER} 汲取了 {TARGET} 的生命力，造成 {VAL} 伤害并回复自身！' },
  succubus_counter: { name: '魅魔反制', tag: SKILL_TAGS.BUFF, isGacha: true, pool: SUCCUBUS_COUNTER_POOL, text: '😈 {USER} 摆出了诱惑的防御姿态...' },
};
