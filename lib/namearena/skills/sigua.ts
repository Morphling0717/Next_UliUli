import type { SkillDefinition } from '../types';
import { namerenaData as Data } from '../data';

const { SKILL_TAGS, DIVA_BUFF_POOL } = Data;

export const siguaSkills: Record<string, SkillDefinition> = {
  diva_song: { name: '歌姬演唱', tag: SKILL_TAGS.BUFF, isGacha: true, pool: DIVA_BUFF_POOL, text: '🎤 {USER} 开始演唱...' },
};
