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
  | 'aerial_kick'
  | 'delayed_slash'
  | 'heavy_lunge'
  | 'multi_melee_lunge'
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
  | 'gacha_void'
  | 'tokusatsu_green'
  | 'tokusatsu_slash'
  | 'tokusatsu_alchemy'
  | 'tokusatsu_throne'
  | 'tokusatsu_monster'
  | 'tokusatsu_rainbow'
  | 'herobrine_eye'
  | 'herobrine_fog'
  | 'herobrine_glitch'
  | 'herobrine_blocks';

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

export type HerobrineCombatMotion =
  | 'empty_gaze'
  | 'hidden_strike'
  | 'stripped_leaves'
  | 'world_seed_error'
  | 'single_world'
  | 'clone_attack';

export type HerobrineCombatEffectId = Extract<BattleCombatEffectId,
  | 'herobrine_empty_gaze'
  | 'herobrine_hidden_strike'
  | 'herobrine_stripped_leaves'
  | 'herobrine_world_seed_error'
  | 'herobrine_single_world'
  | 'herobrine_clone_attack'
>;

export type HerobrineCombatEffectCue = {
  theme: 'herobrine';
  motion: HerobrineCombatMotion;
  actorMotion: CombatActorMotion;
  targetMode: 'actor' | 'targets';
  presentation: SkillPresentation;
  impact: CombatImpactTheme;
  stageImpact: boolean;
};

export type TokusatsuCombatMotion =
  | 'fan_strike'
  | 'fan_rider_kick'
  | 'fan_cross_beam'
  | 'fan_rocket'
  | 'fan_hero_punch'
  | 'henshin_rehearsal'
  | 'tokusatsu_soul'
  | 'bujin_slash'
  | 'black_mist_wave'
  | 'adversity_flash'
  | 'miracle_magic'
  | 'miracle_alchemy'
  | 'alchemy_armor'
  | 'bujin_throne'
  | 'monster_punch'
  | 'energy_crush'
  | 'miracle_armor'
  | 'bujin_monster_combo'
  | 'monster_roar'
  | 'great_monster_victory'
  | 'rainbow_fever';

export type TokusatsuCombatEffectId =
  | 'toku_fan_strike'
  | 'toku_fan_rider_kick'
  | 'toku_fan_cross_beam'
  | 'toku_fan_rocket'
  | 'toku_fan_hero_punch'
  | 'toku_henshin_rehearsal'
  | 'toku_soul'
  | 'toku_bujin_slash'
  | 'toku_black_mist_wave'
  | 'toku_adversity_flash'
  | 'toku_miracle_magic'
  | 'toku_miracle_alchemy'
  | 'toku_alchemy_armor'
  | 'toku_bujin_chair'
  | 'toku_monster_punch'
  | 'toku_energy_crush'
  | 'toku_miracle_armor'
  | 'toku_monster_combo'
  | 'toku_monster_roar'
  | 'toku_great_monster_victory'
  | 'toku_rainbow_fever';

export type TokusatsuCombatEffectCue = {
  theme: 'tokusatsu';
  motion: TokusatsuCombatMotion;
  actorMotion: CombatActorMotion;
  targetMode: 'actor' | 'targets';
  presentation: SkillPresentation;
  impact: CombatImpactTheme;
  stageImpact: boolean;
};

export type CombatEffectCue =
  | TingCombatEffectCue
  | GachaCombatEffectCue
  | TokusatsuCombatEffectCue
  | HerobrineCombatEffectCue;

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

type TingCombatEffectId = Extract<BattleCombatEffectId,
  | 'ting_blood_rite'
  | 'ting_grudge_rend'
  | 'ting_detonation'
  | 'ting_detonation_charge'
  | 'ting_rage'
  | 'ting_wail'
>;

const TING_EFFECTS: Record<
  TingCombatEffectId,
  Omit<TingCombatEffectCue, 'theme' | 'presentation' | 'stageImpact'>
> = {
  ting_blood_rite: { motion: 'blood_rite', actorMotion: 'stationary', targetMode: 'targets', impact: 'ting_blood' },
  ting_grudge_rend: { motion: 'grudge_rend', actorMotion: 'melee_lunge', targetMode: 'targets', impact: 'ting_slash' },
  ting_detonation: { motion: 'detonation', actorMotion: 'stationary', targetMode: 'targets', impact: 'ting_detonation' },
  ting_detonation_charge: { motion: 'detonation', actorMotion: 'melee_lunge', targetMode: 'targets', impact: 'ting_detonation' },
  ting_rage: { motion: 'rage', actorMotion: 'stationary', targetMode: 'actor', impact: 'ting_blood' },
  ting_wail: { motion: 'wail', actorMotion: 'stationary', targetMode: 'targets', impact: 'ting_curse' },
};

type GachaCombatEffectId = Exclude<
  BattleCombatEffectId,
  TokusatsuCombatEffectId | TingCombatEffectId | HerobrineCombatEffectId
>;

const GACHA_EFFECTS: Record<
  GachaCombatEffectId,
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
  Object.keys(GACHA_EFFECTS) as GachaCombatEffectId[],
);

const SUMMON_SKILL_EFFECTS: Record<string, GachaCombatEffectId> = {
  surtr_laeva: 'summon_surtr_laeva',
  surtr_flame_sword: 'summon_surtr_laeva',
  surtr_molten_shadow: 'summon_surtr_laeva',
  surtr_molten_shadow_split_hit: 'summon_surtr_laeva',
  surtr_molten_shadow_single_hit: 'summon_surtr_laeva',
  surtr_twilight: 'summon_surtr_laeva',
  surtr_twilight_hit: 'summon_surtr_laeva',
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

const GACHA_STAGE_IMPACT_EFFECTS = new Set<GachaCombatEffectId>([
  'summon_blue_eyes_burst',
  'summon_ultimate_burst',
  'summon_ra_flare',
  'summon_exodia_obliterate',
]);

const ORDINARY_SUMMON_EFFECTS: Record<string, GachaCombatEffectId> = {
  '钟离': 'summon_zhongli_geo',
  Saber: 'summon_saber_slash',
  '萨姆': 'summon_sam_drive',
  '巴哈姆特': 'summon_bahamut_flare',
  '伊莫库': 'summon_emrakul_void',
  '史尔特尔': 'summon_surtr_laeva',
  '史瓦罗': 'summon_svarog_barrage',
};

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
  effectId: GachaCombatEffectId,
): GachaCombatEffectCue {
  const presentation = event.presentation ?? (event.skillId === null ? 'basic' : 'skill');
  return {
    theme: 'gacha',
    presentation,
    stageImpact: presentation === 'finisher' && GACHA_STAGE_IMPACT_EFFECTS.has(effectId),
    ...GACHA_EFFECTS[effectId],
  };
}

const TOKUSATSU_EFFECTS: Record<
  TokusatsuCombatEffectId,
  Omit<TokusatsuCombatEffectCue, 'theme' | 'presentation' | 'stageImpact'>
> = {
  toku_fan_strike: { motion: 'fan_strike', actorMotion: 'melee_lunge', targetMode: 'targets', impact: 'tokusatsu_green' },
  toku_fan_rider_kick: { motion: 'fan_rider_kick', actorMotion: 'aerial_kick', targetMode: 'targets', impact: 'tokusatsu_green' },
  toku_fan_cross_beam: { motion: 'fan_cross_beam', actorMotion: 'stationary', targetMode: 'targets', impact: 'tokusatsu_green' },
  toku_fan_rocket: { motion: 'fan_rocket', actorMotion: 'stationary', targetMode: 'targets', impact: 'tokusatsu_green' },
  toku_fan_hero_punch: { motion: 'fan_hero_punch', actorMotion: 'heavy_lunge', targetMode: 'targets', impact: 'tokusatsu_green' },
  toku_henshin_rehearsal: { motion: 'henshin_rehearsal', actorMotion: 'stationary', targetMode: 'actor', impact: 'tokusatsu_alchemy' },
  toku_soul: { motion: 'tokusatsu_soul', actorMotion: 'stationary', targetMode: 'actor', impact: 'tokusatsu_green' },
  toku_bujin_slash: { motion: 'bujin_slash', actorMotion: 'delayed_slash', targetMode: 'targets', impact: 'tokusatsu_slash' },
  toku_black_mist_wave: { motion: 'black_mist_wave', actorMotion: 'stationary', targetMode: 'targets', impact: 'tokusatsu_slash' },
  toku_adversity_flash: { motion: 'adversity_flash', actorMotion: 'delayed_slash', targetMode: 'targets', impact: 'tokusatsu_slash' },
  toku_miracle_magic: { motion: 'miracle_magic', actorMotion: 'stationary', targetMode: 'targets', impact: 'tokusatsu_alchemy' },
  toku_miracle_alchemy: { motion: 'miracle_alchemy', actorMotion: 'stationary', targetMode: 'actor', impact: 'tokusatsu_alchemy' },
  toku_alchemy_armor: { motion: 'alchemy_armor', actorMotion: 'stationary', targetMode: 'actor', impact: 'tokusatsu_alchemy' },
  toku_bujin_chair: { motion: 'bujin_throne', actorMotion: 'stationary', targetMode: 'actor', impact: 'tokusatsu_throne' },
  toku_monster_punch: { motion: 'monster_punch', actorMotion: 'heavy_lunge', targetMode: 'targets', impact: 'tokusatsu_monster' },
  toku_energy_crush: { motion: 'energy_crush', actorMotion: 'heavy_lunge', targetMode: 'targets', impact: 'tokusatsu_monster' },
  toku_miracle_armor: { motion: 'miracle_armor', actorMotion: 'stationary', targetMode: 'actor', impact: 'tokusatsu_rainbow' },
  toku_monster_combo: { motion: 'bujin_monster_combo', actorMotion: 'multi_melee_lunge', targetMode: 'targets', impact: 'tokusatsu_monster' },
  toku_monster_roar: { motion: 'monster_roar', actorMotion: 'stationary', targetMode: 'targets', impact: 'tokusatsu_monster' },
  toku_great_monster_victory: { motion: 'great_monster_victory', actorMotion: 'heavy_lunge', targetMode: 'targets', impact: 'tokusatsu_monster' },
  toku_rainbow_fever: { motion: 'rainbow_fever', actorMotion: 'aerial_kick', targetMode: 'targets', impact: 'tokusatsu_rainbow' },
};

const HEROBRINE_EFFECTS: Record<
  HerobrineCombatEffectId,
  Omit<HerobrineCombatEffectCue, 'theme' | 'presentation' | 'stageImpact'>
> = {
  herobrine_empty_gaze: {
    motion: 'empty_gaze',
    actorMotion: 'stationary',
    targetMode: 'targets',
    impact: 'herobrine_eye',
  },
  herobrine_hidden_strike: {
    motion: 'hidden_strike',
    actorMotion: 'stationary',
    targetMode: 'targets',
    impact: 'herobrine_fog',
  },
  herobrine_stripped_leaves: {
    motion: 'stripped_leaves',
    actorMotion: 'stationary',
    targetMode: 'targets',
    impact: 'herobrine_fog',
  },
  herobrine_world_seed_error: {
    motion: 'world_seed_error',
    actorMotion: 'stationary',
    targetMode: 'targets',
    impact: 'herobrine_glitch',
  },
  herobrine_single_world: {
    motion: 'single_world',
    actorMotion: 'stationary',
    targetMode: 'targets',
    impact: 'herobrine_blocks',
  },
  herobrine_clone_attack: {
    motion: 'clone_attack',
    actorMotion: 'melee_lunge',
    targetMode: 'targets',
    impact: 'herobrine_eye',
  },
};

function makeHerobrineCue(
  event: CombatEffectEvent,
  effectId: HerobrineCombatEffectId,
): HerobrineCombatEffectCue {
  return {
    theme: 'herobrine',
    presentation: event.presentation ?? (event.skillId === null ? 'basic' : 'skill'),
    stageImpact: true,
    ...HEROBRINE_EFFECTS[effectId],
  };
}

export const TOKUSATSU_COMBAT_EFFECT_IDS = Object.freeze(
  Object.keys(TOKUSATSU_EFFECTS) as TokusatsuCombatEffectId[],
);

const TOKUSATSU_SKILL_EFFECTS: Record<string, TokusatsuCombatEffectId> = {
  tokusatsu_basic: 'toku_fan_strike',
  rider_kick: 'toku_fan_rider_kick',
  henshin_rehearsal: 'toku_henshin_rehearsal',
  tokusatsu_soul: 'toku_soul',
  bujin_slash: 'toku_bujin_slash',
  black_mist_wave: 'toku_black_mist_wave',
  adversity_flash: 'toku_adversity_flash',
  miracle_magic: 'toku_miracle_magic',
  miracle_alchemy: 'toku_miracle_alchemy',
  alchemy_armor: 'toku_alchemy_armor',
  bujin_chair: 'toku_bujin_chair',
  monster_punch: 'toku_monster_punch',
  energy_crush: 'toku_energy_crush',
  miracle_armor: 'toku_miracle_armor',
  bujin_monster_combo: 'toku_monster_combo',
  monster_roar: 'toku_monster_roar',
  great_monster_victory: 'toku_great_monster_victory',
  rainbow_fever: 'toku_rainbow_fever',
};

const TOKUSATSU_STAGE_IMPACT_EFFECTS = new Set<TokusatsuCombatEffectId>([
  'toku_black_mist_wave',
  'toku_monster_roar',
  'toku_great_monster_victory',
  'toku_rainbow_fever',
]);

function makeTokusatsuCue(
  event: CombatEffectEvent,
  effectId: TokusatsuCombatEffectId,
): TokusatsuCombatEffectCue {
  return {
    theme: 'tokusatsu',
    presentation: event.presentation ?? (event.skillId === null ? 'basic' : 'skill'),
    stageImpact: TOKUSATSU_STAGE_IMPACT_EFFECTS.has(effectId),
    ...TOKUSATSU_EFFECTS[effectId],
  };
}

/** Maps authoritative action metadata to a character effect without parsing player-visible log text. */
export function resolveCombatEffect(
  event: CombatEffectEvent,
  actor?: Pick<Fighter, 'isTing' | 'isTokusatsu' | 'isSummon' | 'summonBaseName' | 'name' | 'job'>,
): CombatEffectCue | null {
  const skillId = event.skillId;
  const explicitEffectId = event.visualCue?.kind === 'combat_fx' || event.visualCue?.kind === 'reaction_fx'
    ? event.visualCue.effectId
    : event.visualCue?.kind === 'combat_action'
      ? event.visualCue.effectId
      : undefined;
  if (explicitEffectId) {
    const effectId = explicitEffectId;
    if (effectId in TING_EFFECTS) return makeCue(event, TING_EFFECTS[effectId as TingCombatEffectId]);
    if (effectId in TOKUSATSU_EFFECTS) return makeTokusatsuCue(event, effectId as TokusatsuCombatEffectId);
    if (effectId in HEROBRINE_EFFECTS) return makeHerobrineCue(event, effectId as HerobrineCombatEffectId);
    return makeGachaCue(event, effectId as GachaCombatEffectId);
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

  const tokusatsuEffectId = skillId ? TOKUSATSU_SKILL_EFFECTS[skillId] : undefined;
  if (tokusatsuEffectId) return makeTokusatsuCue(event, tokusatsuEffectId);

  if (actor?.isTokusatsu) {
    if (skillId === null) {
      if (actor.job === 'MIRACLE_MONSTER_BUJIN') return makeTokusatsuCue(event, 'toku_monster_punch');
      if (actor.job === 'MIRACLE_BUJIN') return makeTokusatsuCue(event, 'toku_bujin_slash');
      return makeTokusatsuCue(event, 'toku_fan_strike');
    }
    if (event.type === 'buff' || event.type === 'heal') {
      return makeTokusatsuCue(event, actor.job === 'MIRACLE_MONSTER_BUJIN' ? 'toku_miracle_armor' : 'toku_miracle_alchemy');
    }
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
