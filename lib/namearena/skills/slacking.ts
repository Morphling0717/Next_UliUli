import type { SkillDefinition } from '../types';
import { namerenaData as Data } from '../data';
import { executeSlackingSynergy } from '../characterHooks';

const { SKILL_TAGS } = Data;

export const slackingSkills: Record<string, SkillDefinition> = {
  slacking: { name: '寻找摸鱼搭子', tag: SKILL_TAGS.SPECIAL, rate: 1.0, condition: (u) => !u.hasTriggeredSlacking, onExecute: executeSlackingSynergy },
  slack_off: { name: '寻找摸鱼搭子', tag: SKILL_TAGS.SPECIAL, rate: 1.0, condition: (u) => !u.hasTriggeredSlacking, onExecute: executeSlackingSynergy },
  moyu: { name: '寻找摸鱼搭子', tag: SKILL_TAGS.SPECIAL, rate: 1.0, condition: (u) => !u.hasTriggeredSlacking, onExecute: executeSlackingSynergy },
};
