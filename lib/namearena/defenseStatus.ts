import type { Fighter, SkillDefinition, StatusEntry } from './types';

export const DEFENSE_STATUS_TYPES = new Set(['SPELL_BLOCK', 'BKB', 'INVUL']);

type DefenseStatusKind = 'SPELL_BLOCK' | 'BKB' | 'INVUL';

type DefenseTemplateVars = {
  target: string;
  source: string;
  healText?: string;
  user?: string;
  skill?: string;
  effect?: string;
};

type DefenseStatusProfile = {
  name: string;
  spellBlockText?: string;
  preSkillBlockText?: string;
  invulText?: string;
  attackInvulText?: string;
  controlBlockText?: string;
  controlCleanseText?: string;
  breakText?: string;
};

const DEFENSE_STATUS_PROFILES: Record<string, DefenseStatusProfile> = {
  generic_spell_block: {
    name: '防护光幕',
    spellBlockText: '🔵 {target} 的防护光幕挡下了{source}{healText}！',
    preSkillBlockText: '🔵 {user} 的【{skill}】刚要命中 {target}，但被防护光幕挡下{healText}！',
  },
  generic_control_immunity: {
    name: '抗性防护',
    controlBlockText: '🟡 {target} 的抗性防护免疫了{effect}！',
    controlCleanseText: '🟡 {target} 的抗性防护驱散了控制与沉默效果！',
  },
  generic_invul: {
    name: '短暂无敌',
    invulText: '🛡️ {target} 进入短暂无敌，避开了{source}！',
    attackInvulText: '🛡️ {target} 进入短暂无敌，避开了 {user} 的攻击！',
  },

  morphling_linken_sphere: {
    name: '林肯法球',
    spellBlockText: '🔵 庇护之音！林肯法球的蔚蓝光幕为 {target} 挡下了{source}{healText}！',
    preSkillBlockText: '🔵 庇护之音！{user} 的【{skill}】刚要命中 {target}，林肯法球的蔚蓝光幕将其挡下{healText}！',
  },
  morphling_liquid_mirage: {
    name: '液化无敌',
    invulText: '🌊 {target} 化作流水，只让{source}穿过了一片水影！',
    attackInvulText: '🌊 {target} 化作流水，让 {user} 的攻击只击中了水影！',
  },

  gamer_bkb: {
    name: '黑皇杖',
    controlBlockText: '🟡 {target} 处于黑皇杖状态，免疫了{effect}！',
    controlCleanseText: '🟡 {target} 的黑皇杖金光爆发，强行免疫了控制与沉默效果！',
  },
  gamer_zhonya: {
    name: '中娅沙漏',
    invulText: '⏱️ {target} 化为小金人，完整规避了{source}！',
    attackInvulText: '⏱️ {target} 化为小金人，让 {user} 的攻击落空！',
  },
  gamer_roll_dodge: {
    name: '翻滚无敌帧',
    invulText: '🔄 {target} 卡住翻滚无敌帧，躲过了{source}！',
    attackInvulText: '🔄 {target} 用翻滚无敌帧躲过了 {user} 的攻击！',
  },
  gamer_world_stage: {
    name: '世界赛舞台',
    controlBlockText: '🏆 {target} 在世界赛舞台保持专注，免疫了{effect}！',
    controlCleanseText: '🏆 {target} 的世界赛专注度拉满，压住了控制与沉默效果！',
  },
  gamer_perfect_parry: {
    name: '完美弹反',
    spellBlockText: '🛡️ 【完美弹反】{target} 读准前摇，架开了{source}{healText}！',
    preSkillBlockText: '🛡️ 【完美弹反】{target} 读准 {user} 的【{skill}】前摇，将其架开{healText}！',
    controlBlockText: '🛡️ 【完美弹反】{target} 稳住架势，免疫了{effect}！',
    controlCleanseText: '🛡️ 【完美弹反】{target} 用防守架势化解了控制与沉默效果！',
  },
  gamer_clutch_focus: {
    name: '残局专注',
    spellBlockText: '🎮 【残局专注】{target} 预判路线，避开了{source}{healText}！',
    preSkillBlockText: '🎮 【残局专注】{target} 预判 {user} 的【{skill}】，把命中窗口错开{healText}！',
    controlBlockText: '🎮 【残局专注】{target} 没有断节奏，免疫了{effect}！',
    controlCleanseText: '🎮 【残局专注】{target} 稳住输入节奏，甩开了控制与沉默效果！',
  },

  rabbit_slide: {
    name: '兔兔滑铲',
    invulText: '💨 {target} 借着【兔兔滑铲】的低姿态从攻击下方钻过，避开了{source}！',
    attackInvulText: '💨 {target} 借着【兔兔滑铲】的低姿态从 {user} 的攻击下方钻过！',
  },
  rabbit_emperor_armor: {
    name: '帝皇铠甲',
    spellBlockText: '👑 【帝皇铠甲】的威光护住 {target}，挡下了{source}{healText}！',
    preSkillBlockText: '👑 【帝皇铠甲】的威光护住 {target}，挡下了 {user} 的【{skill}】{healText}！',
    controlBlockText: '👑 【帝皇铠甲】令 {target} 不受动摇，免疫了{effect}！',
    controlCleanseText: '👑 【帝皇铠甲】压住了 {target} 身上的控制与沉默效果！',
  },
  rabbit_family_guard: {
    name: '顾家守护',
    spellBlockText: '🍳 【顾家女人】的守护姿态替 {target} 挡下了{source}{healText}！',
    preSkillBlockText: '🍳 【顾家女人】的守护姿态替 {target} 挡下了 {user} 的【{skill}】{healText}！',
  },

  slacking_off_field: {
    name: '场外OB',
    invulText: '⛺ {target} 正在场外 OB，{source}根本碰不到她！',
    attackInvulText: '⛺ {target} 正在场外 OB，{user} 的攻击找不到目标！',
    controlBlockText: '⛺ {target} 正在场外 OB，{effect}无法影响她！',
    controlCleanseText: '⛺ {target} 正在场外 OB，战场上的控制与沉默影响不到她！',
  },

  tokusatsu_soul: {
    name: '特摄魂',
    spellBlockText: '🔥 【特摄魂】替 {target} 咬牙顶住了{source}{healText}！',
    preSkillBlockText: '🔥 【特摄魂】替 {target} 顶住了 {user} 的【{skill}】{healText}！',
    controlBlockText: '🔥 【特摄魂】让 {target} 咬牙稳住，免疫了{effect}！',
    controlCleanseText: '🔥 【特摄魂】让 {target} 强行稳住，甩开了控制与沉默效果！',
  },
  tokusatsu_alchemy_armor: {
    name: '炼成护甲',
    spellBlockText: '🛡️ 【炼成护甲】的加厚装甲为 {target} 挡下了{source}{healText}！',
    preSkillBlockText: '🛡️ 【炼成护甲】的加厚装甲为 {target} 挡下了 {user} 的【{skill}】{healText}！',
    controlBlockText: '🛡️ 【炼成护甲】替 {target} 稳住身形，免疫了{effect}！',
    controlCleanseText: '🛡️ 【炼成护甲】替 {target} 稳住身形，清掉了控制与沉默效果！',
  },
  tokusatsu_miracle_alchemy: {
    name: '奇迹炼金',
    spellBlockText: '✨ 【奇迹炼金】重构出的护层为 {target} 挡下了{source}{healText}！',
    preSkillBlockText: '✨ 【奇迹炼金】重构出的护层为 {target} 挡下了 {user} 的【{skill}】{healText}！',
    controlBlockText: '✨ 【奇迹炼金】重构状态，令 {target} 免疫了{effect}！',
    controlCleanseText: '✨ 【奇迹炼金】重构状态，清掉了 {target} 的控制与沉默效果！',
  },
  tokusatsu_bujin_throne: {
    name: '武神王座',
    spellBlockText: '🪑 【武神王座】的悲愿屏障替 {target} 挡下了{source}{healText}！',
    preSkillBlockText: '🪑 【武神王座】的悲愿屏障替 {target} 挡下了 {user} 的【{skill}】{healText}！',
    controlBlockText: '🪑 【武神王座】让 {target} 固守反击姿态，免疫了{effect}！',
    controlCleanseText: '🪑 【武神王座】让 {target} 固守反击姿态，化解了控制与沉默效果！',
  },
  tokusatsu_miracle_armor: {
    name: '奇迹炼成装甲',
    spellBlockText: '🌈 【奇迹炼成装甲】的彩虹装甲为 {target} 挡下了{source}{healText}！',
    preSkillBlockText: '🌈 【奇迹炼成装甲】的彩虹装甲为 {target} 挡下了 {user} 的【{skill}】{healText}！',
    controlBlockText: '🌈 【奇迹炼成装甲】让 {target} 稳住怪兽形态，免疫了{effect}！',
    controlCleanseText: '🌈 【奇迹炼成装甲】让 {target} 稳住怪兽形态，清掉了控制与沉默效果！',
  },
  tokusatsu_rainbow_fever: {
    name: '彩虹狂热余波',
    spellBlockText: '🌈 【彩虹狂热】余波化成彩虹护层，为 {target} 挡下了{source}{healText}！',
    preSkillBlockText: '🌈 【彩虹狂热】余波化成彩虹护层，为 {target} 挡下了 {user} 的【{skill}】{healText}！',
    controlBlockText: '🌈 【彩虹狂热】余波护住 {target}，免疫了{effect}！',
    controlCleanseText: '🌈 【彩虹狂热】余波护住 {target}，清掉了控制与沉默效果！',
  },
  tokusatsu_great_monster_victory: {
    name: '怪兽胜利星光',
    controlBlockText: '⭐ 【GREAT MONSTER VICTORY】的星光回流护住 {target}，免疫了{effect}！',
    controlCleanseText: '⭐ 【GREAT MONSTER VICTORY】的星光回流护住 {target}，清掉了控制与沉默效果！',
  },
  tokusatsu_defiance: {
    name: '悲愿不倒',
    invulText: '🔥 【悲愿不倒】让 {target} 强行锁住战线，避开了{source}！',
    attackInvulText: '🔥 【悲愿不倒】让 {target} 强行锁住战线，避开了 {user} 的攻击！',
    controlBlockText: '🔥 【悲愿不倒】让 {target} 拒绝退场，免疫了{effect}！',
    controlCleanseText: '🔥 【悲愿不倒】让 {target} 拒绝退场，控制与沉默被悲愿压碎！',
  },
  ting_croc_kill_embers: {
    name: '爆鳄余烬',
    spellBlockText: '🩸 【爆鳄余烬】的怨念回流护住 {target}，挡下了{source}{healText}！',
    preSkillBlockText: '🩸 【爆鳄余烬】的怨念回流护住 {target}，挡下了 {user} 的【{skill}】{healText}！',
    invulText: '🩸 【爆鳄余烬】让 {target} 在怨念回流中避开了{source}！',
    attackInvulText: '🩸 【爆鳄余烬】让 {target} 在怨念回流中避开了 {user} 的攻击！',
    controlBlockText: '🩸 【爆鳄余烬】压住异常，令 {target} 免疫了{effect}！',
    controlCleanseText: '🩸 【爆鳄余烬】压住异常，清掉了 {target} 的控制与沉默效果！',
  },

  gacha_small_pity: {
    name: '保底光芒',
    spellBlockText: '🍀 【保底光芒】护住 {target}，挡下了{source}{healText}！',
    preSkillBlockText: '🍀 【保底光芒】护住 {target}，挡下了 {user} 的【{skill}】{healText}！',
  },
  gacha_whale_rewrite: {
    name: '氪金改命',
    spellBlockText: '💳 【氪金改命】把坏结局买掉，为 {target} 挡下了{source}{healText}！',
    preSkillBlockText: '💳 【氪金改命】把坏结局买掉，为 {target} 挡下了 {user} 的【{skill}】{healText}！',
    controlBlockText: '💳 【氪金改命】替 {target} 买掉了{effect}！',
    controlCleanseText: '💳 【氪金改命】替 {target} 买掉了控制与沉默效果！',
  },
  gacha_death_charm: {
    name: '欧皇护符',
    spellBlockText: '👑 【欧皇护符】的改命光芒替 {target} 挡下了{source}{healText}！',
    preSkillBlockText: '👑 【欧皇护符】的改命光芒替 {target} 挡下了 {user} 的【{skill}】{healText}！',
    controlBlockText: '👑 【欧皇护符】替 {target} 强行改命，免疫了{effect}！',
    controlCleanseText: '👑 【欧皇护符】替 {target} 强行改命，清掉了控制与沉默效果！',
  },
  gacha_tribute_compensation: {
    name: '祭品不足补偿',
    spellBlockText: '🍀 【祭品不足补偿】歪出的护盾替 {target} 挡下了{source}{healText}！',
    preSkillBlockText: '🍀 【祭品不足补偿】歪出的护盾替 {target} 挡下了 {user} 的【{skill}】{healText}！',
  },
  gacha_true_light: {
    name: '真之光',
    spellBlockText: '💡 【真之光】的光辉护住 {target}，挡下了{source}{healText}！',
    preSkillBlockText: '💡 【真之光】的光辉护住 {target}，挡下了 {user} 的【{skill}】{healText}！',
    controlBlockText: '💡 【真之光】维系白龙领域，令 {target} 免疫了{effect}！',
    controlCleanseText: '💡 【真之光】维系白龙领域，清掉了 {target} 的控制与沉默效果！',
  },
  gacha_ancient_chant: {
    name: '古之咒文',
    spellBlockText: '🛐 【古之咒文】唤起太阳神威，为 {target} 挡下了{source}{healText}！',
    preSkillBlockText: '🛐 【古之咒文】唤起太阳神威，为 {target} 挡下了 {user} 的【{skill}】{healText}！',
  },
  gacha_heavenly_exchange: {
    name: '天井兑换',
    spellBlockText: '💰 【天井兑换】检索出的防御牌替 {target} 挡下了{source}{healText}！',
    preSkillBlockText: '💰 【天井兑换】检索出的防御牌替 {target} 挡下了 {user} 的【{skill}】{healText}！',
  },
  exodia_seal_wall: {
    name: '封印护壁',
    spellBlockText: '🧙‍♂️ 【封印护壁】展开禁忌封印，为 {target} 挡下了{source}{healText}！',
    preSkillBlockText: '🧙‍♂️ 【封印护壁】展开禁忌封印，为 {target} 挡下了 {user} 的【{skill}】{healText}！',
    controlBlockText: '🧙‍♂️ 【封印护壁】压制干涉，令 {target} 免疫了{effect}！',
    controlCleanseText: '🧙‍♂️ 【封印护壁】压制干涉，清掉了 {target} 的控制与沉默效果！',
  },
  exodia_obliterate_guard: {
    name: '黑暗大法师余威',
    spellBlockText: '🧙‍♂️ 【Exodia Obliterate】余威护住 {target}，挡下了{source}{healText}！',
    preSkillBlockText: '🧙‍♂️ 【Exodia Obliterate】余威护住 {target}，挡下了 {user} 的【{skill}】{healText}！',
  },
  blue_eyes_guard: {
    name: '白龙护主',
    spellBlockText: '🐲 【白龙护主】振翼护住 {target}，挡下了{source}{healText}！',
    preSkillBlockText: '🐲 【白龙护主】振翼护住 {target}，挡下了 {user} 的【{skill}】{healText}！',
  },
  ra_divine_aura: {
    name: '太阳神性',
    spellBlockText: '☀️ 【太阳神性】护住 {target}，挡下了{source}{healText}！',
    preSkillBlockText: '☀️ 【太阳神性】护住 {target}，挡下了 {user} 的【{skill}】{healText}！',
    controlBlockText: '☀️ 【太阳神性】令 {target} 不受凡俗控制，免疫了{effect}！',
    controlCleanseText: '☀️ 【太阳神性】令 {target} 不受凡俗控制，清掉了控制与沉默效果！',
  },
  summon_revenge_order: {
    name: '召唤师遗产',
    controlBlockText: '🧿 【召唤师遗产】维持最后指令，令 {target} 免疫了{effect}！',
    controlCleanseText: '🧿 【召唤师遗产】维持最后指令，清掉了 {target} 的控制与沉默效果！',
  },
  fake_seal_card: {
    name: '盗版封印卡套',
    spellBlockText: '🧩 盗版封印卡套替 {target} 挡了一下，化解了{source}{healText}！',
    preSkillBlockText: '🧩 盗版封印卡套替 {target} 挡了一下，化解了 {user} 的【{skill}】{healText}！',
  },

  war_thunder_repair: {
    name: '王牌乘员抢修',
    spellBlockText: '🔧 【王牌乘员抢修】布好的烟幕与应急装甲替 {target} 挡下了{source}{healText}！',
    preSkillBlockText: '🔧 【王牌乘员抢修】布好的烟幕与应急装甲替 {target} 挡下了 {user} 的【{skill}】{healText}！',
    controlBlockText: '🔧 【王牌乘员抢修】让 {target} 重新获得作战能力，免疫了{effect}！',
    controlCleanseText: '🔧 【王牌乘员抢修】更换乘员并修复模块，压下了控制与沉默效果！',
  },
  war_thunder_ricochet: {
    name: '魔法跳弹',
    invulText: '🛡️ 【魔法跳弹】让{source}打在 {target} 的倾斜装甲上直接弹飞！',
    attackInvulText: '🛡️ 【魔法跳弹】让 {user} 的攻击打在 {target} 的倾斜装甲上直接弹飞！',
  },
  war_thunder_top_ricochet: {
    name: '顶级魔法跳弹',
    spellBlockText: '🛡️ 【顶级魔法跳弹】的复合装甲与烟幕挡下了{source}{healText}！',
    preSkillBlockText: '🛡️ 【顶级魔法跳弹】的复合装甲与烟幕挡下了 {user} 的【{skill}】{healText}！',
    invulText: '🛡️ 【顶级魔法跳弹】让{source}被复合装甲和角度直接化解！',
    attackInvulText: '🛡️ 【顶级魔法跳弹】让 {user} 的攻击被复合装甲和角度直接化解！',
  },
  war_thunder_top_tier_spawn: {
    name: '顶级备用载具装甲',
    spellBlockText: '🚜 顶级载具的满挂爆反与烟幕替 {target} 挡下了{source}{healText}！',
    preSkillBlockText: '🚜 顶级载具的满挂爆反与烟幕替 {target} 挡下了 {user} 的【{skill}】{healText}！',
  },
  war_thunder_backup_vehicle: {
    name: '备用载具烟幕',
    spellBlockText: '🚜 【备用载具】入场烟幕遮住 {target}，挡下了{source}{healText}！',
    preSkillBlockText: '🚜 【备用载具】入场烟幕遮住 {target}，挡下了 {user} 的【{skill}】{healText}！',
    invulText: '🚜 【备用载具】刚出出生点，入场保护让 {target} 避开了{source}！',
    attackInvulText: '🚜 【备用载具】刚出出生点，入场保护让 {target} 避开了 {user} 的攻击！',
    controlBlockText: '🚜 【备用载具】的临时作战保护令 {target} 免疫了{effect}！',
    controlCleanseText: '🚜 【备用载具】的临时作战保护压下了控制与沉默效果！',
  },

  valo_reposition: {
    name: '再定位',
    spellBlockText: '🎯 【再定位】让 {target} 错开弹线，避开了{source}{healText}！',
    preSkillBlockText: '🎯 【再定位】让 {target} 错开 {user} 的【{skill}】命中线{healText}！',
  },
  valorant_jett_tailwind: {
    name: '捷风瞬风',
    invulText: '🌪️ {target} 借【瞬风】拉开身位，避开了{source}！',
    attackInvulText: '🌪️ {target} 借【瞬风】拉开身位，避开了 {user} 的攻击！',
  },
  valorant_astra_cosmic_divide: {
    name: '宇宙分裂',
    invulText: '🌍 【宇宙分裂】隔开战场，{source}无法穿过星界屏障命中 {target}！',
    attackInvulText: '🌍 【宇宙分裂】隔开战场，{user} 的攻击无法穿过星界屏障命中 {target}！',
  },
  valo_run_it_back_ally: {
    name: '再火一回支援',
    invulText: '🔥 【再火一回】的时空标记护住 {target}，避开了{source}！',
    attackInvulText: '🔥 【再火一回】的时空标记护住 {target}，避开了 {user} 的攻击！',
  },

  diva_starlight: {
    name: '星光闪耀',
    invulText: '🌟 【星光闪耀】的舞台光幕托住 {target}，避开了{source}！',
    attackInvulText: '🌟 【星光闪耀】的舞台光幕托住 {target}，避开了 {user} 的攻击！',
  },
  baby_absolute_doting: {
    name: '绝对溺爱',
    invulText: '🛡️ 【绝对溺爱】护住 {target}，让{source}完全落空！',
    attackInvulText: '🛡️ 【绝对溺爱】护住 {target}，让 {user} 的攻击完全落空！',
  },
  baby_nanoshield: {
    name: '纳米护盾',
    invulText: '🛡️ 【纳米护盾】包住 {target}，抵消了{source}！',
    attackInvulText: '🛡️ 【纳米护盾】包住 {target}，抵消了 {user} 的攻击！',
  },
  holy_shield: {
    name: '神圣护盾',
    invulText: '🛡️ 【神圣护盾】的圣光护住 {target}，抵消了{source}！',
    attackInvulText: '🛡️ 【神圣护盾】的圣光护住 {target}，抵消了 {user} 的攻击！',
  },
  chimera_fortress: {
    name: '叹息之墙',
    controlBlockText: '🛡️ 【叹息之墙】挡住干涉，令 {target} 免疫了{effect}！',
    controlCleanseText: '🛡️ 【叹息之墙】挡住干涉，清掉了 {target} 的控制与沉默效果！',
  },
  chimera_startup_core: {
    name: '异变核心',
    spellBlockText: '🧬 【异变核心】刚完成重组，为 {target} 挡下了{source}{healText}！',
    preSkillBlockText: '🧬 【异变核心】刚完成重组，为 {target} 挡下了 {user} 的【{skill}】{healText}！',
    controlBlockText: '🧬 【异变核心】稳定住神经回路，令 {target} 免疫了{effect}！',
    controlCleanseText: '🧬 【异变核心】稳定住神经回路，清掉了 {target} 的控制与沉默效果！',
  },
  chimera_adaptive_skin: {
    name: '自适应外壳',
    spellBlockText: '🛡️ 【自适应外壳】快速硬化，为 {target} 挡下了{source}{healText}！',
    preSkillBlockText: '🛡️ 【自适应外壳】快速硬化，为 {target} 挡下了 {user} 的【{skill}】{healText}！',
    controlBlockText: '🛡️ 【自适应外壳】隔绝干涉，令 {target} 免疫了{effect}！',
    controlCleanseText: '🛡️ 【自适应外壳】隔绝干涉，清掉了 {target} 的控制与沉默效果！',
  },
  chimera_disaster_omen: {
    name: '灾厄预兆',
    spellBlockText: '☣️ 【灾厄预兆】扭曲来袭轨迹，为 {target} 挡下了{source}{healText}！',
    preSkillBlockText: '☣️ 【灾厄预兆】扭曲来袭轨迹，为 {target} 挡下了 {user} 的【{skill}】{healText}！',
    invulText: '☣️ 【灾厄预兆】让 {target} 短暂脱离常理，避开了{source}！',
    attackInvulText: '☣️ 【灾厄预兆】让 {target} 短暂脱离常理，避开了 {user} 的攻击！',
  },
};

export function isDefenseStatusType(type: string): type is DefenseStatusKind {
  return DEFENSE_STATUS_TYPES.has(type);
}

function profileFor(status: StatusEntry, kind: DefenseStatusKind): DefenseStatusProfile {
  if (status.sourceId && DEFENSE_STATUS_PROFILES[status.sourceId]) return DEFENSE_STATUS_PROFILES[status.sourceId];
  if (kind === 'SPELL_BLOCK') return DEFENSE_STATUS_PROFILES.generic_spell_block;
  if (kind === 'BKB') return DEFENSE_STATUS_PROFILES.generic_control_immunity;
  return DEFENSE_STATUS_PROFILES.generic_invul;
}

function applyTemplate(template: string, vars: DefenseTemplateVars): string {
  return template
    .replace(/{target}/g, vars.target)
    .replace(/{source}/g, vars.source)
    .replace(/{healText}/g, vars.healText ?? '')
    .replace(/{user}/g, vars.user ?? '')
    .replace(/{skill}/g, vars.skill ?? '')
    .replace(/{effect}/g, vars.effect ?? '');
}

export function grantStatus(fighter: Fighter, type: string, duration: number, sourceId?: string): void {
  const existing = fighter.status.find((status) => status.type === type);
  if (existing) {
    existing.duration = Math.max(existing.duration, duration);
    if (sourceId && isDefenseStatusType(type)) existing.sourceId = sourceId;
    delete existing.appliedTurn;
    return;
  }
  fighter.status.push({ type, duration, ...(sourceId && isDefenseStatusType(type) ? { sourceId } : {}) });
}

export function createStatusEntry(type: string, duration: number, sourceId?: string): StatusEntry {
  return { type, duration, ...(sourceId && isDefenseStatusType(type) ? { sourceId } : {}) };
}

export function statusSourceFromSkill(skill: SkillDefinition): string | undefined {
  return skill.statusSource;
}

export function findDefenseStatus(fighter: Fighter, type: DefenseStatusKind): StatusEntry | undefined {
  return fighter.status.find((status) => status.type === type);
}

export function consumeSpellBlock(fighter: Fighter): StatusEntry | undefined {
  const spellBlock = findDefenseStatus(fighter, 'SPELL_BLOCK');
  if (!spellBlock) return undefined;
  fighter.status = fighter.status.filter((status) => status !== spellBlock);
  return spellBlock;
}

export function formatSpellBlock(status: StatusEntry, targetName: string, incomingSource: string, healText: string): string {
  const profile = profileFor(status, 'SPELL_BLOCK');
  return applyTemplate(profile.spellBlockText ?? DEFENSE_STATUS_PROFILES.generic_spell_block.spellBlockText!, {
    target: targetName,
    source: incomingSource,
    healText,
  });
}

export function formatPreSkillSpellBlock(
  status: StatusEntry,
  userName: string,
  skillName: string,
  targetName: string,
  healText: string,
): string {
  const profile = profileFor(status, 'SPELL_BLOCK');
  return applyTemplate(profile.preSkillBlockText ?? DEFENSE_STATUS_PROFILES.generic_spell_block.preSkillBlockText!, {
    target: targetName,
    user: userName,
    skill: skillName,
    source: `${userName}的【${skillName}】`,
    healText,
  });
}

export function formatInvul(status: StatusEntry, targetName: string, incomingSource: string): string {
  const profile = profileFor(status, 'INVUL');
  return applyTemplate(profile.invulText ?? DEFENSE_STATUS_PROFILES.generic_invul.invulText!, {
    target: targetName,
    source: incomingSource,
  });
}

export function formatAttackInvul(status: StatusEntry, targetName: string, attackerName: string): string {
  const profile = profileFor(status, 'INVUL');
  return applyTemplate(profile.attackInvulText ?? DEFENSE_STATUS_PROFILES.generic_invul.attackInvulText!, {
    target: targetName,
    user: attackerName,
    source: `${attackerName}的攻击`,
  });
}

export function formatControlBlocked(status: StatusEntry, targetName: string, effectName: string): string {
  const profile = profileFor(status, 'BKB');
  return applyTemplate(profile.controlBlockText ?? DEFENSE_STATUS_PROFILES.generic_control_immunity.controlBlockText!, {
    target: targetName,
    effect: effectName,
    source: effectName,
  });
}

export function formatControlCleanse(status: StatusEntry, targetName: string): string {
  const profile = profileFor(status, 'BKB');
  return applyTemplate(profile.controlCleanseText ?? DEFENSE_STATUS_PROFILES.generic_control_immunity.controlCleanseText!, {
    target: targetName,
    effect: '控制与沉默效果',
    source: '控制与沉默效果',
  });
}

export function formatDefenseBreak(statuses: StatusEntry[], targetName: string): string {
  const names = [...new Set(statuses.map((status) =>
    profileFor(status, status.type === 'SPELL_BLOCK' || status.type === 'BKB' ? status.type : 'INVUL').name,
  ))];
  return names.length > 0 ? `${targetName} 的${names.join('、')}` : `${targetName} 的防护状态`;
}
