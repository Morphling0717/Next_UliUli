import type { BattleCombatEffectId, BattleEvent, Fighter, SkillPresentation } from './types';

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
  | 'ting_detonation'
  | 'gacha_card'
  | 'gacha_luck'
  | 'gacha_whale'
  | 'gacha_summon'
  | 'gacha_dragon'
  | 'gacha_solar'
  | 'gacha_void';

export type TingCombatEffectCue = {
  theme: 'ting';
  motion: TingCombatMotion;
  actorMotion: CombatActorMotion;
  targetMode: 'actor' | 'targets';
  presentation: SkillPresentation;
  impact: CombatImpactTheme;
  stageImpact: boolean;
};

export type GachaCombatMotion =
  | 'blue_sky'
  | 'qiqi_wish'
  | 'fake_seal'
  | 'pot_shard'
  | 'debate_smash'
  | 'shipwreck'
  | 'greed_draw'
  | 'whale_rewrite'
  | 'lifesteal_card'
  | 'ten_pull'
  | 'ceiling_exchange'
  | 'ash_blossom'
  | 'mirror_force'
  | 'monster_reborn'
  | 'black_lotus'
  | 'summon_command'
  | 'all_out_attack'
  | 'tribute_prep'
  | 'summon_recycle'
  | 'exodia_piece'
  | 'pity_guard'
  | 'jackpot'
  | 'instant_action'
  | 'luck_star'
  | 'death_save'
  | 'lifesteal_tether'
  | 'guardian_trap'
  | 'summon_guard'
  | 'blue_eyes_beam'
  | 'true_light'
  | 'ancient_chant'
  | 'solar_cannon'
  | 'phoenix'
  | 'solar_tribute'
  | 'geo_meteor'
  | 'saber_arc'
  | 'sam_drive'
  | 'bahamut_flare'
  | 'emrakul_void'
  | 'surtr_flame'
  | 'svarog_barrage'
  | 'blue_eyes_sweep'
  | 'dragon_roar'
  | 'ultimate_beam'
  | 'triple_heads'
  | 'solar_flare'
  | 'divine_pressure'
  | 'phoenix_rebirth'
  | 'solar_guard'
  | 'dragon_guard'
  | 'triple_guard'
  | 'seal_wall'
  | 'exodia_blast'
  | 'seal_chains'
  | 'obliterate';

export type GachaCombatEffectCue = {
  theme: 'gacha';
  motion: GachaCombatMotion;
  actorMotion: CombatActorMotion;
  targetMode: 'actor' | 'targets';
  presentation: SkillPresentation;
  impact: CombatImpactTheme;
  stageImpact: boolean;
};

export type CombatEffectCue = TingCombatEffectCue | GachaCombatEffectCue;

type CombatEffectEvent = Pick<
  BattleEvent,
  'skillId' | 'skillName' | 'text' | 'presentation' | 'type' | 'visualCue'
>;

const TING_SKILL_EFFECTS: Record<
  string,
  Omit<TingCombatEffectCue, 'theme' | 'presentation' | 'stageImpact'>
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

const GACHA_EFFECTS: Record<
  BattleCombatEffectId,
  Omit<GachaCombatEffectCue, 'theme' | 'presentation' | 'stageImpact'>
> = {
  gacha_blue_sky: { motion: 'blue_sky', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_card' },
  gacha_qiqi: { motion: 'qiqi_wish', actorMotion: 'stationary', targetMode: 'actor', impact: 'gacha_luck' },
  gacha_fake_seal: { motion: 'fake_seal', actorMotion: 'stationary', targetMode: 'actor', impact: 'gacha_card' },
  gacha_pot_shard: { motion: 'pot_shard', actorMotion: 'stationary', targetMode: 'actor', impact: 'gacha_card' },
  gacha_debate_club: { motion: 'debate_smash', actorMotion: 'melee_lunge', targetMode: 'targets', impact: 'gacha_summon' },
  gacha_shipwreck: { motion: 'shipwreck', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_void' },
  gacha_pot_of_greed: { motion: 'greed_draw', actorMotion: 'stationary', targetMode: 'actor', impact: 'gacha_card' },
  gacha_whale_rewrite: { motion: 'whale_rewrite', actorMotion: 'stationary', targetMode: 'actor', impact: 'gacha_whale' },
  gacha_summon_lifesteal: { motion: 'lifesteal_card', actorMotion: 'stationary', targetMode: 'actor', impact: 'gacha_card' },
  gacha_ten_pull_gold: { motion: 'ten_pull', actorMotion: 'stationary', targetMode: 'actor', impact: 'gacha_luck' },
  gacha_ceiling_exchange: { motion: 'ceiling_exchange', actorMotion: 'stationary', targetMode: 'actor', impact: 'gacha_whale' },
  gacha_ash_blossom: { motion: 'ash_blossom', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_card' },
  gacha_mirror_force: { motion: 'mirror_force', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_summon' },
  gacha_monster_reborn: { motion: 'monster_reborn', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_card' },
  gacha_black_lotus: { motion: 'black_lotus', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_void' },
  gacha_summon_command: { motion: 'summon_command', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_card' },
  gacha_all_out_attack: { motion: 'all_out_attack', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_summon' },
  gacha_tribute_prep: { motion: 'tribute_prep', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_solar' },
  gacha_summon_recycle: { motion: 'summon_recycle', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_luck' },
  gacha_exodia_piece: { motion: 'exodia_piece', actorMotion: 'stationary', targetMode: 'actor', impact: 'gacha_void' },
  gacha_small_pity: { motion: 'pity_guard', actorMotion: 'stationary', targetMode: 'actor', impact: 'gacha_luck' },
  gacha_major_pity: { motion: 'jackpot', actorMotion: 'stationary', targetMode: 'actor', impact: 'gacha_luck' },
  gacha_luck_gain: { motion: 'luck_star', actorMotion: 'stationary', targetMode: 'actor', impact: 'gacha_luck' },
  gacha_instant_action: { motion: 'instant_action', actorMotion: 'stationary', targetMode: 'actor', impact: 'gacha_luck' },
  gacha_death_save: { motion: 'death_save', actorMotion: 'stationary', targetMode: 'actor', impact: 'gacha_whale' },
  gacha_lifesteal_proc: { motion: 'lifesteal_tether', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_card' },
  gacha_guard_trap: { motion: 'guardian_trap', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_card' },
  gacha_summon_guard: { motion: 'summon_guard', actorMotion: 'melee_lunge', targetMode: 'targets', impact: 'gacha_summon' },
  gacha_blue_eyes_burst: { motion: 'blue_eyes_beam', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_dragon' },
  gacha_true_light: { motion: 'true_light', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_dragon' },
  gacha_ancient_chant: { motion: 'ancient_chant', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_solar' },
  gacha_blaze_cannon: { motion: 'solar_cannon', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_solar' },
  gacha_ra_phoenix: { motion: 'phoenix', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_solar' },
  gacha_ra_tribute: { motion: 'solar_tribute', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_solar' },
  summon_zhongli_geo: { motion: 'geo_meteor', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_summon' },
  summon_saber_slash: { motion: 'saber_arc', actorMotion: 'melee_lunge', targetMode: 'targets', impact: 'gacha_summon' },
  summon_sam_drive: { motion: 'sam_drive', actorMotion: 'melee_lunge', targetMode: 'targets', impact: 'gacha_summon' },
  summon_bahamut_flare: { motion: 'bahamut_flare', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_dragon' },
  summon_emrakul_void: { motion: 'emrakul_void', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_void' },
  summon_surtr_laeva: { motion: 'surtr_flame', actorMotion: 'melee_lunge', targetMode: 'targets', impact: 'gacha_solar' },
  summon_svarog_barrage: { motion: 'svarog_barrage', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_summon' },
  summon_blue_eyes_burst: { motion: 'blue_eyes_beam', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_dragon' },
  summon_blue_eyes_sweep: { motion: 'blue_eyes_sweep', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_dragon' },
  summon_blue_eyes_roar: { motion: 'dragon_roar', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_dragon' },
  summon_ultimate_burst: { motion: 'ultimate_beam', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_dragon' },
  summon_triple_heads: { motion: 'triple_heads', actorMotion: 'melee_lunge', targetMode: 'targets', impact: 'gacha_dragon' },
  summon_ra_flare: { motion: 'solar_flare', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_solar' },
  summon_ra_pressure: { motion: 'divine_pressure', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_solar' },
  summon_ra_rebirth: { motion: 'phoenix_rebirth', actorMotion: 'stationary', targetMode: 'actor', impact: 'gacha_solar' },
  summon_ra_guard: { motion: 'solar_guard', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_solar' },
  summon_blue_eyes_guard: { motion: 'dragon_guard', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_dragon' },
  summon_ultimate_guard: { motion: 'triple_guard', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_dragon' },
  summon_exodia_guard: { motion: 'seal_wall', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_void' },
  summon_exodia_blast: { motion: 'exodia_blast', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_void' },
  summon_exodia_chains: { motion: 'seal_chains', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_void' },
  summon_exodia_obliterate: { motion: 'obliterate', actorMotion: 'stationary', targetMode: 'targets', impact: 'gacha_void' },
};

export const GACHA_COMBAT_EFFECT_IDS = Object.freeze(
  Object.keys(GACHA_EFFECTS) as BattleCombatEffectId[],
);

const SUMMON_SKILL_EFFECTS: Record<string, BattleCombatEffectId> = {
  surtr_laeva: 'summon_surtr_laeva',
  blue_eyes_burst_stream: 'summon_blue_eyes_burst',
  blue_eyes_sweeping_breath: 'summon_blue_eyes_sweep',
  blue_eyes_dragon_roar: 'summon_blue_eyes_roar',
  ultimate_burst_stream: 'summon_ultimate_burst',
  triple_dragon_head: 'summon_triple_heads',
  ra_sun_flare: 'summon_ra_flare',
  ra_divine_pressure: 'summon_ra_pressure',
  exodia_forbidden_blast: 'summon_exodia_blast',
  exodia_seal_chains: 'summon_exodia_chains',
  exodia_obliterate: 'summon_exodia_obliterate',
};

const GACHA_STAGE_IMPACT_EFFECTS = new Set<BattleCombatEffectId>([
  'summon_blue_eyes_burst',
  'summon_ultimate_burst',
  'summon_ra_flare',
  'summon_exodia_obliterate',
]);

const ORDINARY_SUMMON_EFFECTS: Record<string, BattleCombatEffectId> = {
  '钟离': 'summon_zhongli_geo',
  Saber: 'summon_saber_slash',
  '萨姆': 'summon_sam_drive',
  '巴哈姆特': 'summon_bahamut_flare',
  '伊莫库': 'summon_emrakul_void',
  '史尔特尔': 'summon_surtr_laeva',
  '史瓦罗': 'summon_svarog_barrage',
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
  effect: Omit<TingCombatEffectCue, 'theme' | 'presentation' | 'stageImpact'>,
): TingCombatEffectCue {
  return {
    theme: 'ting',
    presentation: event.presentation ?? (event.skillId === null ? 'basic' : 'skill'),
    stageImpact: true,
    ...effect,
  };
}

function makeGachaCue(
  event: CombatEffectEvent,
  effectId: BattleCombatEffectId,
): GachaCombatEffectCue {
  const presentation = event.presentation ?? (event.skillId === null ? 'basic' : 'skill');
  return {
    theme: 'gacha',
    presentation,
    stageImpact: presentation === 'finisher' && GACHA_STAGE_IMPACT_EFFECTS.has(effectId),
    ...GACHA_EFFECTS[effectId],
  };
}

/** Maps authoritative action metadata to a character effect. Text is only used for random-pool subtypes. */
export function resolveCombatEffect(
  event: CombatEffectEvent,
  actor?: Pick<Fighter, 'isTing' | 'isSummon' | 'summonBaseName' | 'name'>,
): CombatEffectCue | null {
  const skillId = event.skillId;
  if (event.visualCue?.kind === 'combat_fx') {
    return makeGachaCue(event, event.visualCue.effectId);
  }

  if (actor?.isSummon) {
    const summonSkillEffect = skillId ? SUMMON_SKILL_EFFECTS[skillId] : undefined;
    if (summonSkillEffect) return makeGachaCue(event, summonSkillEffect);
    const baseName = actor.summonBaseName ?? actor.name.replace(/#\d+$/, '');
    const ordinaryEffect = ORDINARY_SUMMON_EFFECTS[baseName];
    if (ordinaryEffect) return makeGachaCue(event, ordinaryEffect);
  }

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
