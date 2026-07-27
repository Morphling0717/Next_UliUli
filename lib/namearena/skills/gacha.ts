import type { SkillDefinition } from '../types';
import { namerenaData as Data } from '../data';

const {
  SKILL_TAGS,
  GACHA_NORMAL_POOL,
  GACHA_SSR_POOL,
} = Data;

export const gachaSkills: Record<string, SkillDefinition> = {
  gacha_pull: { name: '单抽', tag: SKILL_TAGS.SPECIAL, isGacha: true, pool: GACHA_NORMAL_POOL, text: '🎲 {USER} 消耗阳寿进行了一次单抽...' },
  destiny_draw: { name: '命运抽卡', tag: SKILL_TAGS.SPECIAL, isGacha: true, pool: GACHA_SSR_POOL, text: '✨ {USER} 相信着卡组的羁绊，进行了命运抽卡！' },
};
