import type { SkillDefinition } from './types';
import { babySkills } from './skills/baby';
import { baseJobSkills } from './skills/baseJobs';
import { chimeraSkills } from './skills/chimera';
import { duelMonsterSkills } from './skills/duelMonster';
import { emoteSkills } from './skills/emote';
import { gachaSkills } from './skills/gacha';
import { gamerSkills } from './skills/gamer';
import { jokerSkills } from './skills/joker';
import { morphlingSkills } from './skills/morphling';
import { rabbitSkills } from './skills/rabbit';
import { siguaSkills } from './skills/sigua';
import { slackingSkills } from './skills/slacking';
import { succubusSkills } from './skills/succubus';
import { tingSkills } from './skills/ting';
import { tokusatsuSkills } from './skills/tokusatsu';
import { valoJuniorSkills } from './skills/valoJunior';
import { warThunderSkills } from './skills/warThunder';

const SKILLS: Record<string, SkillDefinition> = {
  ...slackingSkills,
  ...siguaSkills,
  ...valoJuniorSkills,
  ...babySkills,
  ...jokerSkills,
  ...succubusSkills,
  ...chimeraSkills,
  ...duelMonsterSkills,
  ...emoteSkills,
  ...gachaSkills,
  ...tokusatsuSkills,
  ...morphlingSkills,
  ...tingSkills,
  ...gamerSkills,
  ...rabbitSkills,
  ...warThunderSkills,
  ...baseJobSkills,
};

export const namerenaSkills = SKILLS;
