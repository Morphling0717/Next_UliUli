import type { BattleEvent, Fighter, SkillPresentation } from './types';

export type TingCombatMotion =
  | 'quick_slash'
  | 'spinal_cleave'
  | 'blood_mist'
  | 'grudge_rend'
  | 'blood_feast'
  | 'wail'
  | 'bone_guard'
  | 'blood_rite'
  | 'detonation'
  | 'rage'
  | 'puppet_ritual';

export type CombatActorMotion =
  | 'stationary'
  | 'melee_lunge'
  | 'self_destruct_cling';

export type CombatImpactTheme =
  | 'ting_slash'
  | 'ting_blood'
  | 'ting_curse'
  | 'ting_guard'
  | 'ting_detonation';

export type TingCombatEffectCue = {
  theme: 'ting';
  motion: TingCombatMotion;
  actorMotion: CombatActorMotion;
  targetMode: 'actor' | 'targets';
  presentation: SkillPresentation;
  impact: CombatImpactTheme;
};

type CombatEffectEvent = Pick<
  BattleEvent,
  'skillId' | 'skillName' | 'text' | 'presentation' | 'type'
>;

const TING_SKILL_EFFECTS: Record<
  string,
  Omit<TingCombatEffectCue, 'theme' | 'presentation'>
> = {
  spinal_slash: { motion: 'spinal_cleave', actorMotion: 'melee_lunge', targetMode: 'targets', impact: 'ting_slash' },
  blood_mist: { motion: 'blood_mist', actorMotion: 'stationary', targetMode: 'targets', impact: 'ting_blood' },
  grudge_rend: { motion: 'grudge_rend', actorMotion: 'melee_lunge', targetMode: 'targets', impact: 'ting_slash' },
  grudge_blood_feast: { motion: 'blood_feast', actorMotion: 'stationary', targetMode: 'targets', impact: 'ting_blood' },
  grudge_wail: { motion: 'wail', actorMotion: 'stationary', targetMode: 'targets', impact: 'ting_curse' },
  grudge_curse: { motion: 'wail', actorMotion: 'stationary', targetMode: 'targets', impact: 'ting_curse' },
  bone_guard: { motion: 'bone_guard', actorMotion: 'stationary', targetMode: 'actor', impact: 'ting_guard' },
  suicide_bomb: { motion: 'detonation', actorMotion: 'self_destruct_cling', targetMode: 'targets', impact: 'ting_detonation' },
  summon_puppet_ting: { motion: 'puppet_ritual', actorMotion: 'stationary', targetMode: 'actor', impact: 'ting_blood' },
};

function resolveSuicidePoolMotion(text: string): TingCombatMotion {
  if (/自爆|尸爆|手雷|坠落|风暴|黑洞|终焉|邪神契约|同归于尽/.test(text)) return 'detonation';
  if (/斩|刃|切腹|抽骨|碎颅|断腿|禁手|撕下|猛撞/.test(text)) return 'grudge_rend';
  return 'blood_rite';
}

function resolveSuicidePoolActorMotion(text: string, motion: TingCombatMotion): CombatActorMotion {
  if (motion === 'grudge_rend') return 'melee_lunge';
  if (/自爆卡车|坠落冲击|舍身风暴|碎颅击|断腿踢|碎牙咬|乱舞/.test(text)) return 'melee_lunge';
  return 'stationary';
}

function makeCue(
  event: CombatEffectEvent,
  effect: Omit<TingCombatEffectCue, 'theme' | 'presentation'>,
): TingCombatEffectCue {
  return {
    theme: 'ting',
    presentation: event.presentation ?? (event.skillId === null ? 'basic' : 'skill'),
    ...effect,
  };
}

/** Maps authoritative action metadata to a character effect. Text is only used for random-pool subtypes. */
export function resolveCombatEffect(
  event: CombatEffectEvent,
  actor?: Pick<Fighter, 'isTing'>,
): TingCombatEffectCue | null {
  const skillId = event.skillId;
  if (skillId && TING_SKILL_EFFECTS[skillId]) {
    return makeCue(event, TING_SKILL_EFFECTS[skillId]);
  }

  if (skillId === 'suicide_rng') {
    const motion = resolveSuicidePoolMotion(event.text);
    return makeCue(event, {
      motion,
      actorMotion: resolveSuicidePoolActorMotion(event.text, motion),
      targetMode: 'targets',
      impact: motion === 'detonation' ? 'ting_detonation' : motion === 'grudge_rend' ? 'ting_slash' : 'ting_blood',
    });
  }

  if (skillId === 'red_fury_rng') {
    if (/咆哮|震晕|斗志/.test(event.text)) {
      return makeCue(event, { motion: 'wail', actorMotion: 'stationary', targetMode: 'targets', impact: 'ting_curse' });
    }
    return makeCue(event, { motion: 'rage', actorMotion: 'stationary', targetMode: 'actor', impact: 'ting_blood' });
  }

  if (!actor?.isTing) return null;
  if (skillId === null) {
    return makeCue(event, { motion: 'quick_slash', actorMotion: 'melee_lunge', targetMode: 'targets', impact: 'ting_slash' });
  }

  if (event.type === 'buff' || event.type === 'heal') {
    return makeCue(event, { motion: 'rage', actorMotion: 'stationary', targetMode: 'actor', impact: 'ting_blood' });
  }
  return makeCue(event, { motion: 'blood_rite', actorMotion: 'stationary', targetMode: 'targets', impact: 'ting_blood' });
}
