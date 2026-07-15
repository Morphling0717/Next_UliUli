import type { JobDefinition } from './types';

// High-end gamer random skill pool
const gamer_skills: string[] = [
  'awp_shot', 'flash_lol', 'hook_dota', 'helm_breaker', 'tcs_mh', 'waterfowl',
  'bkb_dota', 'rush_b', 'yasuo_q', 'teemo_shroom', 'divine_sunderer', 'judgment_cut',
  'kamehameha', 'zonia', 'aim_bot', 'lag_switch', 'roll_dodge', 'tp_scroll', 'warcry_dota',
];

const all_platform_gamer_skills: string[] = [
  'gamer_headshot_line', 'gamer_perfect_parry', 'gamer_estus_cancel',
  'gamer_tactical_pause', 'gamer_wombo_combo', 'gamer_crack_confirm',
  'gamer_speedrun_route', 'gamer_resource_macro', 'gamer_read_inputs',
  'gamer_clutch_ace', 'gamer_world_combo',
  'awp_shot', 'waterfowl', 'bkb_dota', 'judgment_cut',
];

// God Slime full skill pool
const god_slime_skills: string[] = [
  'liquid_mirage', 'divine_shift', 'abyssal_prison', 'apocalyptic_flood',
  'ethereal_blade', 'manta_style', 'eye_of_skadi', 'linken_sphere',
  'khanda', 'nullifier', 'cosmic_slap',
];

const JOBS: Partial<Record<string, JobDefinition>> = {
  // ── 丝瓜uli 系 ──────────────────────────────────────────────────────────
  VIRTUAL_DIVA: {
    name: '虚拟歌姬', icon: '🎤',
    hp: 2.5, atk: 1.0, def: 1.5, spd: 1.5, agl: 1.5, mag: 2.5, res: 2.5, wis: 4.0,
    skills: ['slacking', 'diva_song'],
  },
  VALO_JUNIOR: {
    name: '瓦学妹', icon: '🔫',
    hp: 1.5, atk: 2.0, def: 1.0, spd: 1.5, agl: 1.8, mag: 1.0, res: 1.0, wis: 1.5,
    skills: ['slacking', 'valo_classic_shot'],
  },
  MY_BABY: {
    name: '专属辅助', icon: '👶',
    hp: 1.5, atk: 0.5, def: 1.5, spd: 2.0, agl: 2.0, mag: 2.0, res: 2.0, wis: 3.0,
    skills: ['slacking', 'baby_feed', 'baby_laser', 'baby_satellite', 'baby_cheer', 'baby_scan', 'baby_shield', 'baby_speed', 'baby_poison', 'baby_bandaid'],
  },

  // ── 屑（冷笑话）系 ──────────────────────────────────────────────────────
  JOKE_KING: {
    name: '冷笑话大王', icon: '🥶',
    hp: 1.5, atk: 0.5, def: 1.0, spd: 1.2, agl: 1.5, mag: 1.5, res: 1.2, wis: 1.5,
    skills: ['cold_joke', 'cheesy_charm'],
  },
  DUAL_JOKER: {
    name: '双面小丑', icon: '🤡',
    hp: 1.8, atk: 1.5, def: 1.0, spd: 1.8, agl: 2.5, mag: 2.5, res: 1.5, wis: 2.0,
    skills: ['hell_joke', 'deadly_prank'],
  },
  GOD_OF_TROLLS: {
    name: '乐子人', icon: '🃏',
    hp: 2.0, atk: 1.0, def: 1.0, spd: 3.0, agl: 3.0, mag: 2.0, res: 1.5, wis: 3.0,
    skills: ['troll_brainwash', 'troll_steal', 'hell_joke'],
  },

  // ── 水人系 ──────────────────────────────────────────────────────────────
  SLIME: {
    name: '史莱姆', icon: '💧',
    hp: 1.2, atk: 0.8, def: 0.8, spd: 0.8, agl: 0.5, mag: 1.2, res: 1.5, wis: 0.5,
    skills: ['universal_acid'],
  },
  GOD_SLIME: {
    name: '史莱姆之神', icon: '🌊',
    hp: 5.0, atk: 5.0, def: 5.0, spd: 5.0, agl: 5.0, mag: 5.0, res: 5.0, wis: 5.0,
    skills: god_slime_skills,
  },
  MORPHLING_SON: {
    name: '水人的好大儿', icon: '👶',
    hp: 3.0, atk: 3.0, def: 2.0, spd: 2.0, agl: 1.5, mag: 3.0, res: 2.0, wis: 2.0,
    skills: ['universal_acid', 'liquid_mirage'],
  },

  // ── 玄凝系 ──────────────────────────────────────────────────────────────
  HIGH_END_GAMER: {
    name: '高端玩家', icon: '🎮',
    hp: 1.2, atk: 1.5, def: 1.0, spd: 1.5, agl: 1.5, mag: 1.5, res: 1.0, wis: 2.0,
    skills: gamer_skills,
  },
  ALL_PLATFORM_CHAMPION: {
    name: '全平台制霸者', icon: '🏆',
    hp: 3.0, atk: 3.2, def: 2.4, spd: 2.6, agl: 2.8, mag: 3.2, res: 2.4, wis: 3.5,
    skills: all_platform_gamer_skills,
  },

  // ── 刺猬人系 ────────────────────────────────────────────────────────────
  TOKU_FAN: {
    name: '特摄粉', icon: '🦔',
    hp: 1.3, atk: 1.2, def: 1.2, spd: 1.1, agl: 1.0, mag: 0.8, res: 1.0, wis: 0.9,
    skills: ['rider_kick', 'tokusatsu_basic', 'henshin_rehearsal', 'tokusatsu_soul'],
  },
  MIRACLE_BUJIN: {
    name: '奇迹武刃', icon: '🦗',
    hp: 3.0, atk: 4.0, def: 3.5, spd: 2.5, agl: 3.5, mag: 3.0, res: 3.0, wis: 2.5,
    skills: ['bujin_slash', 'black_mist_wave', 'adversity_flash', 'miracle_magic', 'miracle_alchemy', 'alchemy_armor', 'bujin_chair'],
  },
  MIRACLE_MONSTER_BUJIN: {
    name: '奇迹怪兽武刃', icon: '🦖',
    hp: 4.0, atk: 6.0, def: 4.5, spd: 3.0, agl: 4.0, mag: 4.0, res: 4.0, wis: 3.0,
    skills: ['rainbow_fever', 'monster_punch', 'energy_crush', 'miracle_armor', 'bujin_monster_combo', 'monster_roar', 'bujin_slash', 'black_mist_wave', 'adversity_flash', 'miracle_magic', 'miracle_alchemy', 'alchemy_armor'],
  },

  // ── 牢鳄系 ──────────────────────────────────────────────────────────────
  GACHA_ADDICT: {
    name: '抽卡狂魔', icon: '🐊',
    hp: 1.5, atk: 1.2, def: 1.0, spd: 1.0, agl: 1.0, mag: 1.5, res: 1.0, wis: 1.0,
    skills: ['gacha_pull'],
  },
  LUCK_EMPEROR: {
    name: '欧皇', icon: '👑',
    hp: 2.5, atk: 2.0, def: 1.5, spd: 1.5, agl: 1.5, mag: 3.0, res: 2.0, wis: 2.0,
    skills: ['gacha_pull', 'destiny_draw'],
  },

  // ── 小汀系 ──────────────────────────────────────────────────────────────
  RED_FURY_SAMURAI: {
    name: '红温武士', icon: '😡',
    hp: 1.2, atk: 2.0, def: 0.8, spd: 1.5, agl: 1.2, mag: 0.5, res: 0.5, wis: 0.5,
    skills: ['spinal_slash', 'blood_mist', 'red_fury_rng'],
  },
  EXPLOSIVE_ANTI_CROC: {
    name: '爆鳄狂人', icon: '💥',
    hp: 2.5, atk: 5.0, def: 1.0, spd: 2.5, agl: 2.0, mag: 1.0, res: 1.0, wis: 0.5,
    skills: ['spinal_slash', 'suicide_bomb', 'grudge_rend', 'bone_guard', 'suicide_rng'],
  },
  GRUDGE_SUICIDER: {
    name: '怨念恶灵', icon: '👻',
    hp: 2.0, atk: 3.0, def: 1.5, spd: 2.0, agl: 1.5, mag: 2.5, res: 1.5, wis: 1.0,
    skills: ['spinal_slash', 'grudge_rend', 'grudge_blood_feast', 'grudge_wail', 'bone_guard', 'grudge_curse', 'suicide_rng'],
  },

  // ── 克蕾儿系 ────────────────────────────────────────────────────────────
  SUCCUBUS: {
    name: '魅魔', icon: '😈',
    hp: 1.5, atk: 1.2, def: 1.0, spd: 1.3, agl: 1.4, mag: 2.0, res: 1.5, wis: 1.8,
    skills: ['charm', 'life_drain', 'succubus_counter'],
  },
  CHIMERA: {
    name: '合成兽', icon: '🧬',
    hp: 3.0, atk: 2.5, def: 2.0, spd: 2.0, agl: 1.8, mag: 3.0, res: 2.5, wis: 2.5,
    skills: ['chimera_install', 'chimera_strike'],
  },

  // ── 兔卷卷 curly 系 ─────────────────────────────────────────────────────
  Q_BUNNY: {
    name: 'Q版萌兔', icon: '🐰',
    hp: 0.8, atk: 0.3, def: 0.5, spd: 1.8, agl: 3.0, mag: 1.5, res: 1.0, wis: 2.0,
    skills: ['slacking', 'q_bunny_idol', 'q_bunny_attack', 'q_bunny_cute', 'q_bunny_offkey', 'q_bunny_slide', 'q_bunny_carrot'],
  },
  VERSATILE_RABBIT: {
    name: '百变兔娘', icon: '👯‍♀️',
    hp: 1.5, atk: 1.0, def: 1.0, spd: 2.5, agl: 1.8, mag: 3.5, res: 1.5, wis: 3.5,
    skills: ['slacking', 'v_rabbit_calc_rng', 'v_rabbit_zero', 'v_rabbit_style_switch', 'v_rabbit_calc_smash', 'v_rabbit_undo', 'v_rabbit_megaphone'],
  },

  // ── 战雷军迷系 ──────────────────────────────────────────────────────────
  WT_GRINDER: {
    name: '战雷肝帝', icon: '💻',
    hp: 1.8, atk: 1.5, def: 2.0, spd: 1.0, agl: 1.0, mag: 0.1, res: 1.5, wis: 1.5,
    skills: ['wt_apfsds', 'wt_attack_d_point', 'wt_repair', 'wt_magic_ricochet'],
  },
  WT_TOP_TIER: {
    name: '顶级房霸主', icon: '🪖',
    hp: 4.5, atk: 5.5, def: 4.5, spd: 1.2, agl: 0.8, mag: 0.1, res: 3.5, wis: 3.5,
    skills: ['wt_laser_rangefinder', 'wt_apfsds', 'wt_bmpt_suppress', 'wt_t58_knockup', 'wt_su30_cas', 'wt_magic_ricochet_premium', 'wt_repair_premium'],
  },

  // ── 表情系 ────────────────────────────────────────────────────────────
  EMOTE_MAHORAGA: {
    name: '四处认主型魔虚罗', icon: '🧿',
    hp: 0.1, atk: 0.1, def: 0.1, spd: 0.1, agl: 0.1, mag: 0.1, res: 0.1, wis: 0.1,
    skills: ['emote_meme_slap', 'emote_tenth_claim', 'emote_adaptation_wheel', 'emote_mark_owner', 'emote_wheel_cleave', 'emote_all_masters_return'],
  },
  YUZU_MIRROR_PARENT: {
    name: '镜世界的食指父辈', icon: '🪞',
    hp: 2.1, atk: 1.85, def: 1.55, spd: 1.15, agl: 0.9, mag: 0.5, res: 1.45, wis: 1.25,
    skills: [
      'yuzu_spear_impale', 'yuzu_hammer_crush', 'yuzu_sword_devour', 'yuzu_homeward_scythe',
      'yuzu_frozen_blood', 'yuzu_silent_applause', 'yuzu_falling_leaf_blade', 'yuzu_waiting_hell',
      'yuzu_customized_fool', 'yuzu_divine_pursuit', 'yuzu_daughter_reckoning', 'yuzu_unbreakable_daughter',
      'yuzu_furioso_replica',
    ],
  },

  // ── 鸮 / 雾隐罅中鸮系 ────────────────────────────────────────────────
  OWL_HEAVEN_AVATAR: {
    name: '天意的化身', icon: '🦉',
    hp: 1.7, atk: 1.7, def: 1.25, spd: 1.4, agl: 1.35, mag: 1.7, res: 1.35, wis: 1.8,
    skills: ['owl_benevolence_sword', 'owl_righteousness_sword', 'owl_nia', 'owl_yiling_fire', 'owl_shining_hopper'],
  },
  OWL_BOILED_HERO: {
    name: '煮酒论英雄', icon: '⚡',
    hp: 3.0, atk: 2.7, def: 2.5, spd: 2.35, agl: 2.15, mag: 3.1, res: 2.8, wis: 3.0,
    skills: ['owl_seven_in_seven_out', 'owl_sweep_furry', 'owl_crossing_mark'],
  },
  OWL_DRAGON_SOVEREIGN: {
    name: '龙，可是帝王之征啊！', icon: '🐉',
    hp: 3.8, atk: 3.8, def: 3.2, spd: 2.8, agl: 2.4, mag: 4.0, res: 3.4, wis: 3.8,
    skills: ['owl_bumper_harvest', 'owl_desk', 'owl_ruthless_sword', 'owl_enjoy', 'owl_great_wind', 'owl_bone_scrape'],
  },

  // ── 基础职业与隐藏彩蛋 ──────────────────────────────────────────────────
  ONE_PUNCH: {
    name: '秃头披风侠', icon: '👊',
    hp: 3.0, atk: 10.0, def: 5.0, spd: 2.0, agl: 2.0, mag: 0.1, res: 5.0, wis: 0.5,
    skills: ['serious_punch'],
  },
  HERO: {
    name: '勇者', icon: '🗡️',
    hp: 2.0, atk: 2.0, def: 2.0, spd: 1.5, agl: 1.5, mag: 1.5, res: 1.5, wis: 1.5,
    skills: ['hero_slash', 'hero_guard'],
  },
  LEGEND_DRAGON:  { name: '传说之龙',  icon: '🐲', hp: 1.5, atk: 1.4, def: 1.0, spd: 1.0, agl: 1.0, mag: 1.2, res: 1.2, wis: 1.0, skills: ['fireball'] },
  ARKNIGHTS_OP:   { name: '干员',      icon: '♟️', hp: 0.8, atk: 1.6, def: 0.6, spd: 1.2, agl: 1.2, mag: 1.2, res: 0.8, wis: 1.2, skills: ['surtr_laeva'] },
  WARRIOR:        { name: '战士',      icon: '⚔️', hp: 1.4, atk: 1.2, def: 1.3, spd: 0.9, agl: 0.8, mag: 0.5, res: 0.8, wis: 0.7, skills: ['bash', 'rage'] },
  MAGE:           { name: '法师',      icon: '🔮', hp: 0.8, atk: 0.6, def: 0.6, spd: 1.0, agl: 0.9, mag: 1.6, res: 1.4, wis: 1.3, skills: ['fireball', 'meteor'] },
  ARCHER:         { name: '游侠',      icon: '🏹', hp: 1.0, atk: 1.4, def: 0.8, spd: 1.4, agl: 1.3, mag: 0.6, res: 0.9, wis: 1.0, skills: ['aim_shot', 'multi_shot'] },
  PRIEST:         { name: '牧师',      icon: '🌿', hp: 1.1, atk: 0.5, def: 0.9, spd: 1.1, agl: 1.0, mag: 1.2, res: 1.5, wis: 1.6, skills: ['heal', 'smite', 'holy_shield'] },

  // Summon-only jobs (never assigned to player-fighters)
  DUEL_MONSTER:   { name: '决斗怪兽',  icon: '🃏', hp: 1.0, atk: 1.0, def: 1.0, spd: 1.0, agl: 1.0, mag: 1.0, res: 1.0, wis: 1.0, skills: ['bash'] },
  EXODIA_INCARNATE: { name: '黑暗大法师', icon: '🧙‍♂️', hp: 1.0, atk: 1.0, def: 1.0, spd: 1.0, agl: 1.0, mag: 1.0, res: 1.0, wis: 1.0, skills: ['exodia_obliterate', 'exodia_forbidden_blast', 'exodia_seal_chains'] },
  BLUE_EYES_WHITE_DRAGON: { name: '青眼白龙', icon: '🐲', hp: 1.0, atk: 1.0, def: 1.0, spd: 1.0, agl: 1.0, mag: 1.0, res: 1.0, wis: 1.0, skills: ['blue_eyes_burst_stream', 'blue_eyes_sweeping_breath', 'blue_eyes_dragon_roar'] },
  BLUE_EYES_ULTIMATE_DRAGON: { name: '青眼究极龙', icon: '🐉', hp: 1.0, atk: 1.0, def: 1.0, spd: 1.0, agl: 1.0, mag: 1.0, res: 1.0, wis: 1.0, skills: ['ultimate_burst_stream', 'triple_dragon_head'] },
  RA_WINGED_DRAGON: { name: '拉的翼神龙', icon: '☀️', hp: 1.0, atk: 1.0, def: 1.0, spd: 1.0, agl: 1.0, mag: 1.0, res: 1.0, wis: 1.0, skills: ['ra_sun_flare', 'ra_divine_pressure'] },
  GENSHIN_ARCHON: { name: '璃月七神',  icon: '🛡️', hp: 1.0, atk: 1.0, def: 2.0, spd: 1.0, agl: 1.0, mag: 1.0, res: 1.0, wis: 1.0, skills: ['bash'] },
  FATE_SERVANT:   { name: '从者',      icon: '🗡️', hp: 1.0, atk: 1.5, def: 1.0, spd: 1.5, agl: 1.0, mag: 1.0, res: 1.0, wis: 1.0, skills: ['bash'] },
  HSR_HUNTER:     { name: '星穹铁道猎人', icon: '🤖', hp: 1.0, atk: 1.2, def: 1.0, spd: 1.5, agl: 1.0, mag: 1.0, res: 1.0, wis: 1.0, skills: ['bash'] },
  ELDRAZI_TITAN:  { name: '埃尔德拉兹', icon: '🦑', hp: 1.0, atk: 1.0, def: 1.0, spd: 0.5, agl: 1.0, mag: 1.0, res: 1.0, wis: 1.0, skills: ['bash'] },
  OWL_FOOD:       { name: '盖饭', icon: '🍚', hp: 1.0, atk: 0.1, def: 0.1, spd: 0.1, agl: 0.1, mag: 0.1, res: 0.1, wis: 0.1, skills: [] },
  OWL_CRICKET:    { name: '有情有义的蛐蛐', icon: '🦗', hp: 1.0, atk: 1.0, def: 1.0, spd: 1.0, agl: 1.0, mag: 0.6, res: 0.8, wis: 0.8, skills: ['owl_cricket_strike'] },
  OWL_ZHAO_ADOU:  { name: '赵云&阿斗', icon: '🏇', hp: 1.0, atk: 1.0, def: 1.0, spd: 1.0, agl: 1.0, mag: 0.5, res: 1.0, wis: 1.0, skills: ['owl_zhao_rampage'] },
  OWL_SWIRE:      { name: '诗怀雅', icon: '🐯', hp: 1.0, atk: 1.0, def: 1.0, spd: 1.0, agl: 1.0, mag: 0.7, res: 1.0, wis: 1.0, skills: ['owl_swire_strike'] },
  OWL_LINLANG_SWIRE: { name: '琳琅诗怀雅', icon: '💰', hp: 1.0, atk: 1.0, def: 1.0, spd: 1.0, agl: 1.0, mag: 0.8, res: 1.0, wis: 1.0, skills: ['owl_linlang_strike'] },
  OWL_SPECTER:    { name: '幽灵鲨', icon: '🦈', hp: 1.0, atk: 1.0, def: 1.0, spd: 1.0, agl: 1.0, mag: 0.6, res: 1.0, wis: 0.8, skills: ['owl_specter_saw'] },
  OWL_SPALTER:    { name: '归溟幽灵鲨', icon: '🌊', hp: 1.0, atk: 1.0, def: 1.0, spd: 1.0, agl: 1.0, mag: 0.9, res: 1.0, wis: 1.0, skills: ['owl_spalter_saw'] },
  OWL_EMPEROR_DRAGON: { name: '帝王之征', icon: '🐲', hp: 1.0, atk: 1.0, def: 1.0, spd: 1.0, agl: 1.0, mag: 1.0, res: 1.0, wis: 1.0, skills: ['owl_emperor_claw', 'owl_atomic_breath', 'owl_dragon_shock'] },
};

export const namerenaJobs = JOBS;
