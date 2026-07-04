import type { SkillTag, StatusEffectInfo } from '../types';

// ---------------------------------------------------------------------------
// Skill tag constants
// ---------------------------------------------------------------------------
export const SKILL_TAGS = {
  PHYS: 'physical' as SkillTag,
  MAG: 'magical' as SkillTag,
  HEAL: 'heal' as SkillTag,
  BUFF: 'buff' as SkillTag,
  DEBUFF: 'debuff' as SkillTag,
  SPECIAL: 'special' as SkillTag,
};

// ---------------------------------------------------------------------------
// Status effect display table
// ---------------------------------------------------------------------------
export const STATUS_EFFECTS: Record<string, StatusEffectInfo> = {
  STUN:   { name: '眩晕', icon: '💫', desc: '无法行动' },
  FREEZE: { name: '冰冻', icon: '❄️', desc: '无法行动，物理防御归零' },
  BURN:   { name: '灼烧', icon: '🔥', desc: '持续伤害' },
  POISON: { name: '中毒', icon: '🤢', desc: '持续伤害' },
  BLIND:  { name: '致盲', icon: '🕶️', desc: '命中率降低' },
  INVUL:  { name: '无敌', icon: '🌟', desc: '免疫伤害' },
  COUNTER:{ name: '反击', icon: '💢', desc: '受到物理攻击反弹' },
  REGEN:  { name: '再生', icon: '🌿', desc: '恢复生命' },
  RAGE:   { name: '狂暴', icon: '😡', desc: '攻升防降' },
  SILENCE:{ name: '沉默', icon: '😶', desc: '无法使用技能' },
  AIM:    { name: '锁头', icon: '🎯', desc: '下一次攻击必暴击且必中' },
  CONFUSED: { name: '尴尬', icon: '🥶', desc: '尴尬得脚趾扣地，无法行动' },
  CHARMED: { name: '魅惑', icon: '😍', desc: '被土味情话击中，无法攻击' },
  WAIT_COUNTER: { name: '坐椅子', icon: '🪑', desc: '停止行动，受到攻击时触发终极反击（仅限一次）' },
  BKB:    { name: '控制免疫', icon: '🟡', desc: '免疫控制效果；具体来源以战斗日志为准' },
  SPINAL_SWORD: { name: '脊髓剑', icon: '🦴', desc: '手持小汀的脊髓剑，攻击力大幅提升，数回合后将剑掷出引爆' },
  PUPPET_MASTER: { name: '提线者', icon: '🎭', desc: '拥有小汀作为傀儡护卫' },
  TING_DEFIANCE: { name: '不甘倒下', icon: '🩸', desc: '怨念锁住最后 1 点生命，持续期间再次受到致命伤也不会立刻倒下' },
  TOKUSATSU_DEFIANCE: { name: '悲愿不倒', icon: '🔥', desc: '奇迹怪兽武刃受到致死伤害时强行续命，并立刻反扑一次' },

  VALO_ULT_EMPRESS: { name: '女皇神威', icon: '👑', desc: '攻击/速度翻倍，100%吸血' },
  VALO_ULT_RUN_IT_BACK: { name: '再火一回', icon: '🔥', desc: '受到致命伤可满血复活' },
  VALO_HOLDING_ANGLE: { name: '架枪预瞄', icon: '🔭', desc: '受击截停：受到攻击时强制先手反击' },
  VALO_AIM_PUNCH: { name: '截停', icon: '🎯', desc: '命中率暴降80%' },
  VALO_CLUTCH: { name: '残局模式', icon: '🎯', desc: '瓦学妹进入残局专注，枪线、身位与技能选择更偏向收割' },
  VALO_REPOSITION: { name: '再定位', icon: '🧭', desc: '击杀后快速换位，清除架枪笨重并准备补枪' },
  VALO_OPERATOR_PENALTY: { name: '冥驹笨重', icon: '🔭', desc: '本轮架枪后身位暴露，直到下一次行动前速度与闪避下降' },
  VALO_HARBOR_WALL: { name: '海港水墙', icon: '🌊', desc: 'Harbor 水墙阻挡火力，短暂提升防御与魔抗' },
  VALO_CYPHER_REVEALED: { name: '情报暴露', icon: '📷', desc: '被 Cypher 读取位置，防御下降' },
  NEURAL_THEFT_DEBUFF: { name: '被窃取情报', icon: '📷', desc: '闪避归零，受到伤害必暴击' },

  CTR_CHARM: { name: '魅惑反击', icon: '💕', desc: '受击时魅惑对手' },
  CTR_STUN:  { name: '震慑反击', icon: '😵', desc: '受击时眩晕对手' },
  CTR_DRAIN: { name: '汲取反击', icon: '🧛', desc: '受击时吸取对手生命' },
  CTR_POISON:{ name: '剧毒反击', icon: '🦠', desc: '受击时使对手中毒' },
  CTR_BURN:  { name: '烈焰反击', icon: '🔥', desc: '受击时点燃对手' },
  CTR_FREEZE:{ name: '极寒反击', icon: '🧊', desc: '受击时冻结对手' },
  CTR_VOID:  { name: '虚空反击', icon: '🌌', desc: '受击时造成真实伤害' },
  CTR_WEAK:  { name: '虚弱反击', icon: '📉', desc: '受击时降低对手攻击力' },
  CTR_CONFUSE:{ name: '混乱反击', icon: '🌀', desc: '受击时使对手混乱' },
  CTR_EXECUTE:{ name: '断头反击', icon: '☠️', desc: '受击时若对手生命低则直接斩杀' },

  PLUG_HEAD: { name: '暴食之口', icon: '🦷', desc: '攻击力/吸血大幅提升' },
  PLUG_ARM:  { name: '斩舰巨刃', icon: '⚔️', desc: '攻击力/暴击大幅提升' },
  PLUG_BACK: { name: '浮游炮阵', icon: '🛸', desc: '魔力/智力大幅提升' },
  PLUG_HEART:{ name: '永动炉心', icon: '☢️', desc: '全属性小幅提升，每回合回血' },
  PLUG_EYE:  { name: '石化魔眼', icon: '👁️', desc: '魔力/命中大幅提升' },
  PLUG_SKIN: { name: '纳米皮肤', icon: '🛡️', desc: '防御/魔抗大幅提升' },
  PLUG_LEG:  { name: '反重力足', icon: '🦶', desc: '速度/闪避大幅提升' },
  PLUG_TAIL: { name: '灾厄毒尾', icon: '🦂', desc: '攻击/魔力提升，附带剧毒' },

  VALO_FLASH: { name: '闪光曲球', icon: '🔆', desc: '被致盲，命中率大幅下降' },
  DIVA_SONG:  { name: '歌姬祝福', icon: '🎵', desc: '受到丝瓜uli的激励，属性提升' },
  DIVA_HEADPHONE_GUARD: { name: '耳机隔音', icon: '🎧', desc: '隔绝噪音与干扰，魔抗大幅提升' },
  DIVA_FINAL_CHORUS: { name: '燃曲压轴', icon: '🔥', desc: '歌姬压轴演出，全属性短暂提升' },
  BABY_LOVE_BOTTLE: { name: '爱心奶瓶', icon: '🍼', desc: '丝瓜 baby 递上的专属支援，全属性提升' },
  BABY_WEAKNESS_MARK: { name: '弱点标记', icon: '👀', desc: '被指出破绽，防御与魔抗下降' },
  Q_BUNNY_IDOL_AGL: { name: '爱豆闪避加成', icon: '✨', desc: '偶像打歌加护：闪避提升20%' },
  GAMER_WORLD_STAGE: { name: '世界赛模式', icon: '🏆', desc: 'APM 爆表后进入高压竞技状态，解锁终局连段' },

  LIQUID_BODY: { name: '水之幻影', icon: '💧', desc: '物理伤害强制减半，免疫暴击与物理截停' },
  WATER_PRISON: { name: '深渊水牢', icon: '🌊', desc: '丧失闪避与转移能力，持续窒息溺水' },
  ETHEREAL: { name: '虚无', icon: '👻', desc: '免疫物理，受到魔法伤害翻倍，无法进行物理攻击' },
  SPELL_BLOCK: { name: '法术抵挡', icon: '🔵', desc: '抵挡下一次技能伤害或控制' },
  NO_HEAL: { name: '禁疗', icon: '🥀', desc: '无法恢复生命值' },
  GACHA_SUMMON_LIFESTEAL: { name: '吸血牌', icon: '🧛', desc: '召唤物造成的部分伤害会转化为牢鳄的治疗' },
  GACHA_TRAP_GUARD_COOLDOWN: { name: '护主陷阱冷却', icon: '🪤', desc: '护主陷阱刚刚发动，短时间内不能再次翻开' },
  GACHA_BLUE_EYES_GUARD_COOLDOWN: { name: '白龙护主冷却', icon: '🐲', desc: '青眼白龙刚刚护主，正在重整姿态' },
  GACHA_ULTIMATE_GUARD_COOLDOWN: { name: '究极龙护主冷却', icon: '🐉', desc: '青眼究极龙刚刚分担伤害，龙首需要短暂恢复' },
  RA_PHOENIX: { name: '神不死鸟', icon: '🔥', desc: '翼神龙受到致死伤害时一场一次复燃反扑' },

  SLACKING: { name: '摸鱼', icon: '🐟', desc: '场外OB，无敌且无法被选中与行动' },
  ZEROED: { name: '归零', icon: '🧮', desc: '全属性强行降至10%' },
  STYLE_SMART: { name: '精明女人', icon: '👓', desc: '智力速度翻倍，高额吸血' },
  STYLE_SEXY: { name: '性感女人', icon: '💋', desc: '永久魅惑反击，普攻真伤' },
  STYLE_ANGRY: { name: '暴躁女人', icon: '😡', desc: '防御归零，攻击翻3倍，必定暴击' },
  STYLE_FOOL: { name: '笨蛋女人', icon: '🤪', desc: '免控，攻击随机附带异常' },
  STYLE_VAIN: { name: '虚荣女人', icon: '💅', desc: '攻击偷取属性' },
  STYLE_FAMILY: { name: '顾家女人', icon: '🍳', desc: '高额双抗，回合结束回血，法术抵挡' },
  STYLE_EMPEROR: { name: '帝皇铠甲', icon: '👑', desc: '融合所有女人风格' },
  RABBIT_CALC_HASTE: { name: '计算超频', icon: '⚡', desc: '计算器盲按带来的临时出手加速' },
  RABBIT_ZERO_HASTE: { name: '归零超频', icon: '🧮', desc: '归零后短暂吸收算力，提高出手频率' },

  WT_SUPPRESS:  { name: '火力压制', icon: '🚧', desc: '被机炮弹雨压制，无法行动，闪避归零' },
  WT_AIRBORNE:  { name: '击飞', icon: '🚀', desc: '被大口径主炮物理击飞，重重摔落，眩晕一回合' },
  AIRBORNE: { name: '击飞', icon: '🚀', desc: '被强力冲击击飞，眩晕一回合' },
  WT_REPAIRING: { name: '抢修中', icon: '🔧', desc: '长按F修车中，无法行动，受到伤害增加但疯狂回血' },
  WT_ERA:       { name: '爆反装甲', icon: '🧱', desc: '披挂爆炸反应装甲，获得高额减伤' },
  WT_SCOUTED:   { name: '战雷侦察', icon: '🔭', desc: '被热成像/测距仪锁定，M1 后续火力更容易命中与处决' },
  WT_BREECH_DAMAGED: { name: '炮闩损坏', icon: '🔩', desc: '主武器受损，造成伤害下降' },
  WT_TRACK_DAMAGED:  { name: '履带断裂', icon: '🛞', desc: '机动受损，闪避归零' },
  WT_AMMO_EXPOSED:   { name: '弹药架暴露', icon: '💥', desc: '被命中模块弱点，低血时容易殉爆' },
  SYNERGY_SLACKING: { name: '场外OB', icon: '⛺', desc: '手牵手摸鱼中，绝对无敌且无法行动' },
  WEAK: { name: '虚弱', icon: '📉', desc: '攻击力大幅下降' },
};

export const COLORS: string[] = [
  'from-red-500 to-orange-500', 'from-blue-500 to-cyan-500', 'from-green-500 to-emerald-500',
  'from-purple-500 to-pink-500', 'from-yellow-500 to-amber-500', 'from-gray-500 to-slate-500',
  'from-indigo-500 to-violet-500', 'from-teal-400 to-green-400',
];
