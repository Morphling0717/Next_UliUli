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
import { momoSkills } from './skills/momo';
import { owlSkills } from './skills/owl';
import { rabbitSkills } from './skills/rabbit';
import { siguaSkills } from './skills/sigua';
import { slackingSkills } from './skills/slacking';
import { succubusSkills } from './skills/succubus';
import { surtrSkills } from './skills/surtr';
import { tingSkills } from './skills/ting';
import { tokusatsuSkills } from './skills/tokusatsu';
import { valoJuniorSkills } from './skills/valoJunior';
import { warThunderSkills } from './skills/warThunder';
import { yuzuSkills } from './skills/yuzu';
import { yuzuProphetSkills } from './skills/yuzuProphet';

const SKILLS: Record<string, SkillDefinition> = {
  ...slackingSkills,
  ...siguaSkills,
  ...valoJuniorSkills,
  ...babySkills,
  ...jokerSkills,
  ...succubusSkills,
  ...surtrSkills,
  ...chimeraSkills,
  ...duelMonsterSkills,
  ...emoteSkills,
  ...gachaSkills,
  ...tokusatsuSkills,
  ...morphlingSkills,
  ...momoSkills,
  ...owlSkills,
  ...tingSkills,
  ...gamerSkills,
  ...rabbitSkills,
  ...warThunderSkills,
  ...yuzuSkills,
  ...yuzuProphetSkills,
  ...baseJobSkills,
};

export const namerenaSkills = SKILLS;
