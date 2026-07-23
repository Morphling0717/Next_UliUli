import { STATUS_IDENTITY_PRESENTATION } from './data/constants';
import type {
  DamageSourceKind,
  StatusCalculationStage,
  StatusDispelTier,
  StatusInstance,
  StatusExpiryPoint,
  StatusPolarity,
  StatusStackMode,
  StatusTickMode,
  StatKey,
} from './types';

interface StatusDefinitionBase {
  mechanicId: string;
  displayName: string;
  icon: string;
  description: string;
  polarity: StatusPolarity;
  dispelTier: StatusDispelTier;
  tickMode: StatusTickMode;
  expiresOn: StatusExpiryPoint;
  stackMode: StatusStackMode;
  calculationStage: StatusCalculationStage;
  damageSourceMask?: DamageSourceKind[];
  statScope?: Array<StatKey | 'physical' | 'magical' | 'all' | 'accuracy_only' | 'evasion_only'>;
  barrierInteraction?: 'absorb' | 'bypass';
  defaultPotency?: number;
  defaultCount?: number;
  defaultCharges?: number;
  potencyCap?: number;
  countCap?: number;
  chargeCap?: number;
  remainingTurnCap?: number;
  dualValue?: boolean;
  /** Value consumed when this mechanic's declared clock advances. */
  advanceField?: 'potency' | 'count' | 'remainingTurns' | 'charges';
  /** Persistent raw-stat shape maintained centrally while this mechanic exists. */
  persistentStatShape?: (potency: number) => Partial<Record<StatKey | 'maxHp', number>>;
  /** Different themed identities in the same slot replace one another per applier. */
  exclusiveGroup?: string;
  /** Hidden mechanical projections for one themed status card. */
  components?: StatusMechanicComponent[];
}

export type StatusTag =
  | 'control'
  | 'action_blocking'
  | 'spell_immunity_blocked'
  | 'common_negative'
  | 'damage_over_time'
  | 'counter_stance'
  | 'slacking_away_state'
  | 'slacking_return_protection'
  | 'death_persistent'
  | 'revive_clean'
  | 'rabbit_style'
  | 'chimera_plug'
  | 'not_diva_spreadable'
  | 'important_removal';

export type StatusMechanicDefinition = StatusDefinitionBase;

export interface StatusIdentityDefinition extends StatusDefinitionBase {
  identityId: string;
  tags: readonly StatusTag[];
}

export interface BarrierIdentityDefinition {
  identityId: string;
  displayName: string;
  icon: string;
  description: string;
  polarity: StatusPolarity;
  dispelTier: StatusDispelTier;
  tickMode: StatusTickMode;
}

export interface StatusMechanicComponent {
  mechanicId: string;
  potency: number;
  description: string;
  stackMode?: StatusStackMode;
  calculationStage?: StatusCalculationStage;
  damageSourceMask?: DamageSourceKind[];
  statScope?: Array<StatKey | 'physical' | 'magical' | 'all' | 'accuracy_only' | 'evasion_only'>;
  /** Optional floor applied after this panel-stat projection. */
  minimumStatValue?: number;
}

export interface StatusMechanicProjection {
  mechanicId: string;
  potency: number;
  description?: string;
  stackMode: StatusStackMode;
  calculationStage: StatusCalculationStage;
  damageSourceMask?: DamageSourceKind[];
  statScope?: Array<StatKey | 'physical' | 'magical' | 'all' | 'accuracy_only' | 'evasion_only'>;
  minimumStatValue?: number;
}

const CORE: Record<string, StatusMechanicDefinition> = {
  BURN: {
    mechanicId: 'BURN', displayName: '灼烧', icon: '🔥',
    description: '每个大回合结束时造成强度×6的状态伤害并消耗1次，可被屏障吸收',
    polarity: 'negative', dispelTier: 'normal', tickMode: 'large_round', expiresOn: 'large_round_end',
    stackMode: 'add', calculationStage: 'aftermath', barrierInteraction: 'absorb',
    defaultPotency: 6, defaultCount: 2, potencyCap: 20, countCap: 6, dualValue: true,
  },
  BLEED: {
    mechanicId: 'BLEED', displayName: '流血', icon: '🩸',
    description: '主动攻击出手前造成强度×6的状态伤害并消耗1次；伤害绕过屏障',
    polarity: 'negative', dispelTier: 'normal', tickMode: 'trigger', expiresOn: 'trigger',
    stackMode: 'add', calculationStage: 'aftermath', barrierInteraction: 'bypass',
    defaultPotency: 6, defaultCount: 2, potencyCap: 20, countCap: 6, dualValue: true,
  },
  POISON: {
    mechanicId: 'POISON', displayName: '中毒', icon: '🤢',
    description: '自身行动机会开始时按1/2/3层损失4%/5%/6%最大生命',
    polarity: 'negative', dispelTier: 'normal', tickMode: 'self_opportunity', expiresOn: 'self_opportunity_end',
    stackMode: 'add', calculationStage: 'aftermath', barrierInteraction: 'bypass',
    defaultPotency: 1, potencyCap: 3,
  },
  RUPTURE: {
    mechanicId: 'RUPTURE', displayName: '破裂', icon: '◆',
    description: '受到造成生命伤害的直接攻击后追加伤害并消耗1次',
    polarity: 'negative', dispelTier: 'normal', tickMode: 'trigger', expiresOn: 'trigger',
    stackMode: 'add', calculationStage: 'aftermath', barrierInteraction: 'bypass',
    defaultPotency: 1, defaultCount: 1, potencyCap: 20, countCap: 6, dualValue: true,
  },
  TREMOR: {
    mechanicId: 'TREMOR', displayName: '震颤', icon: '🟨',
    description: '被震颤爆发时将强度加入失衡值并消耗1次；每次自身行动机会后自然衰减1次',
    polarity: 'negative', dispelTier: 'normal', tickMode: 'self_opportunity', expiresOn: 'self_opportunity_end',
    stackMode: 'add', calculationStage: 'aftermath',
    defaultPotency: 1, defaultCount: 1, potencyCap: 20, countCap: 6, dualValue: true,
    advanceField: 'count',
  },
  STAGGERED: {
    mechanicId: 'STAGGERED', displayName: '踉跄', icon: '💥',
    description: '闪避归零，无法反击、等待反击或拦截，受到的非持续直接伤害提高25%',
    polarity: 'negative', dispelTier: 'normal', tickMode: 'self_opportunity', expiresOn: 'self_opportunity_end',
    stackMode: 'refresh', calculationStage: 'incoming_post_mitigation',
    damageSourceMask: ['standard', 'custom', 'manual'],
  },
  SINKING: {
    mechanicId: 'SINKING', displayName: '沉沦', icon: '🌊',
    description: '受到造成生命伤害的直接攻击后降低等同强度的士气并消耗1次',
    polarity: 'negative', dispelTier: 'normal', tickMode: 'trigger', expiresOn: 'trigger',
    stackMode: 'add', calculationStage: 'aftermath',
    defaultPotency: 1, defaultCount: 1, potencyCap: 20, countCap: 6, dualValue: true,
  },
  MENTAL_BREAKDOWN: {
    mechanicId: 'MENTAL_BREAKDOWN', displayName: '精神崩溃', icon: '🫥',
    description: '下一次真正完成的行动只能使用不会暴击的普通攻击',
    polarity: 'negative', dispelTier: 'strong_only', tickMode: 'trigger', expiresOn: 'trigger',
    stackMode: 'refresh', calculationStage: 'lifecycle', chargeCap: 1,
  },
  POISE: {
    mechanicId: 'POISE', displayName: '呼吸', icon: '🫁',
    description: '每点强度提高5个百分点暴击率；真正暴击时消耗1次',
    polarity: 'positive', dispelTier: 'normal', tickMode: 'trigger', expiresOn: 'trigger',
    stackMode: 'add', calculationStage: 'hit_check',
    defaultPotency: 1, defaultCount: 1, potencyCap: 10, countCap: 6, dualValue: true,
  },
  CHARGE: {
    mechanicId: 'CHARGE', displayName: '充能', icon: '⚡',
    description: '技能资源，上限20；每次自身行动机会结束后减少1点',
    polarity: 'neutral', dispelTier: 'none', tickMode: 'self_opportunity', expiresOn: 'self_opportunity_end',
    stackMode: 'add', calculationStage: 'resource', defaultPotency: 0, potencyCap: 20,
    advanceField: 'potency',
  },
};

const SUPPLEMENTAL: Record<string, StatusMechanicDefinition> = {
  VULNERABILITY: numeric('VULNERABILITY', '易损', '🩹', 'negative', 'incoming_post_mitigation', '受到的非持续直接伤害提高强度百分比'),
  PROTECTION: numeric('PROTECTION', '防护', '🛡️', 'positive', 'incoming_post_mitigation', '受到的非持续直接伤害降低强度百分比'),
  PARALYSIS: trigger('PARALYSIS', '麻痹', '⚡', 'negative', '下一次攻击使用最低伤害且不能暴击'),
  HASTE: numeric('HASTE', '迅捷', '💨', 'positive', 'target_selection', '行动调度速度提高强度百分比'),
  BIND: numeric('BIND', '束缚', '⛓️', 'negative', 'target_selection', '行动调度速度降低强度百分比'),
  AGGRO: { ...numeric('AGGRO', '仇恨值', '🎯', 'neutral', 'target_selection', '被敌方选为目标的权重提高强度百分比'), dispelTier: 'none' },
  OUTPUT_UP: numeric('OUTPUT_UP', '威势', '⬆️', 'positive', 'post_formula', '适用攻击的输出提高强度百分比'),
  OUTPUT_DOWN: numeric('OUTPUT_DOWN', '衰弱', '⬇️', 'negative', 'post_formula', '适用攻击的输出降低强度百分比'),
  ATK_UP: numeric('ATK_UP', '强攻', '⚔️', 'positive', 'effective_stat', '伤害公式读取的有效攻击提高强度百分比'),
  ATK_DOWN: numeric('ATK_DOWN', '怯攻', '📉', 'negative', 'effective_stat', '伤害公式读取的有效攻击降低强度百分比'),
  MAG_UP: numeric('MAG_UP', '盈魔', '🔮', 'positive', 'effective_stat', '伤害公式读取的有效魔力提高强度百分比'),
  MAG_DOWN: numeric('MAG_DOWN', '枯魔', '🌑', 'negative', 'effective_stat', '伤害公式读取的有效魔力降低强度百分比'),
  WIS_UP: numeric('WIS_UP', '明识', '🧠', 'positive', 'effective_stat', '技能公式读取的有效智力提高强度百分比'),
  WIS_DOWN: numeric('WIS_DOWN', '迷惘', '🌫️', 'negative', 'effective_stat', '技能公式读取的有效智力降低强度百分比'),
  SPD_UP: numeric('SPD_UP', '疾行', '🏃', 'positive', 'effective_stat', '有效速度提高强度百分比'),
  SPD_DOWN: numeric('SPD_DOWN', '迟行', '🐌', 'negative', 'effective_stat', '有效速度降低强度百分比'),
  AGL_UP: numeric('AGL_UP', '灵巧', '🪽', 'positive', 'effective_stat', '有效敏捷提高强度百分比'),
  AGL_DOWN: numeric('AGL_DOWN', '滞身', '🪨', 'negative', 'effective_stat', '有效敏捷降低强度百分比'),
  DEF_RES_UP: numeric('DEF_RES_UP', '坚固', '🛡️', 'positive', 'effective_stat', '有效防御与魔抗提高强度百分比'),
  DEF_RES_DOWN: numeric('DEF_RES_DOWN', '破防', '💢', 'negative', 'effective_stat', '有效防御与魔抗降低强度百分比'),
  DEF_UP: numeric('DEF_UP', '甲胄', '🪖', 'positive', 'effective_stat', '有效物理防御提高强度百分比'),
  DEF_DOWN: numeric('DEF_DOWN', '裂甲', '🪓', 'negative', 'effective_stat', '有效物理防御降低强度百分比'),
  RES_UP: numeric('RES_UP', '灵障', '🔷', 'positive', 'effective_stat', '有效魔法抗性提高强度百分比'),
  RES_DOWN: numeric('RES_DOWN', '蚀障', '🔻', 'negative', 'effective_stat', '有效魔法抗性降低强度百分比'),
  ACCURACY_UP: trigger('ACCURACY_UP', '洞察', '👁️', 'positive', '提高攻击命中率'),
  ACCURACY_DOWN: trigger('ACCURACY_DOWN', '偏离', '🕶️', 'negative', '降低攻击命中率'),
  ACCURACY_AGL_UP: numeric('ACCURACY_AGL_UP', '命中灵巧', '◉', 'positive', 'hit_check', '仅提高攻击方命中公式读取的敏捷'),
  EVASION_UP: numeric('EVASION_UP', '残影', '👤', 'positive', 'hit_check', '有效闪避能力提高强度百分比'),
  EVASION_DOWN: numeric('EVASION_DOWN', '失位', '🧭', 'negative', 'hit_check', '有效闪避能力降低强度百分比'),
  VITALITY: numeric('VITALITY', '生机', '🌱', 'positive', 'aftermath', '受到的治疗、再生与合法吸血提高强度百分比'),
  EXHAUSTION: numeric('EXHAUSTION', '枯竭', '🥀', 'negative', 'aftermath', '受到的治疗、再生与合法吸血降低强度百分比'),
  BARRIER: numeric('BARRIER', '屏障', '🔵', 'positive', 'barrier', '以独立护盾值先于生命承受允许被屏障吸收的伤害'),
  CRIT_DAMAGE_UP: trigger('CRIT_DAMAGE_UP', '锐意', '✦', 'positive', '提高暴击额外伤害'),
  CRIT_DAMAGE_DOWN: trigger('CRIT_DAMAGE_DOWN', '钝化', '◇', 'negative', '降低受到的暴击额外伤害'),
  CRIT_RATE_UP: numeric('CRIT_RATE_UP', '会心', '✧', 'positive', 'hit_check', '暴击率提高强度个百分点'),
  ATK_FLAT_UP: numeric('ATK_FLAT_UP', '攻击增量', '⚔️', 'positive', 'effective_stat', '有效攻击增加固定数值'),
  DEF_FLAT_UP: numeric('DEF_FLAT_UP', '防御增量', '🛡️', 'positive', 'effective_stat', '有效防御增加固定数值'),
  SPD_FLAT_UP: numeric('SPD_FLAT_UP', '速度增量', '🏃', 'positive', 'effective_stat', '有效速度增加固定数值'),
  AGL_FLAT_UP: numeric('AGL_FLAT_UP', '敏捷增量', '🪽', 'positive', 'effective_stat', '有效敏捷增加固定数值'),
  MAG_FLAT_UP: numeric('MAG_FLAT_UP', '魔力增量', '✨', 'positive', 'effective_stat', '有效魔力增加固定数值'),
  RES_FLAT_UP: numeric('RES_FLAT_UP', '魔抗增量', '🔷', 'positive', 'effective_stat', '有效魔抗增加固定数值'),
  WIS_FLAT_UP: numeric('WIS_FLAT_UP', '智力增量', '🧠', 'positive', 'effective_stat', '有效智力增加固定数值'),
  DRAIN: trigger('DRAIN', '汲取', '🧛', 'positive', '直接攻击造成生命伤害时按比例治疗'),
  OPENING: numeric('OPENING', '破绽', '🎯', 'negative', 'hit_check', '攻击该单位时的暴击率提高强度个百分点'),
  SURE_HIT_TAKEN: numeric('SURE_HIT_TAKEN', '战术锁定', '◎', 'negative', 'hit_check', '攻击该单位时必定命中'),
};

function numeric(
  mechanicId: string,
  displayName: string,
  icon: string,
  polarity: StatusPolarity,
  calculationStage: StatusCalculationStage,
  description: string,
): StatusMechanicDefinition {
  return {
    mechanicId, displayName, icon, description, polarity,
    dispelTier: 'normal', tickMode: 'self_opportunity', expiresOn: 'self_opportunity_end',
    stackMode: 'refresh', calculationStage,
  };
}

function statComponents(
  buffs: Partial<Record<StatKey | 'crit', number>>,
): StatusMechanicComponent[] {
  return Object.entries(buffs).map(([rawKey, multiplier]) => {
    const key = rawKey as StatKey | 'crit';
    const value = multiplier ?? 1;
    if (key === 'crit') {
      return {
        mechanicId: 'CRIT_RATE_UP',
        potency: Math.round(value * 100),
        stackMode: 'add',
        calculationStage: 'hit_check',
        description: `暴击率提高 ${Math.round(value * 100)} 个百分点`,
      };
    }
    const isIncrease = value >= 1;
    const mechanicId = `${key.toUpperCase()}_${isIncrease ? 'UP' : 'DOWN'}`;
    const potency = Math.round(Math.abs(value - 1) * 100);
    return {
      mechanicId,
      potency,
      stackMode: 'multiply',
      calculationStage: 'panel_stat',
      statScope: [key],
      description: `${key.toUpperCase()} ${isIncrease ? '提高' : '降低'} ${potency}%`,
    };
  });
}

function trigger(
  mechanicId: string,
  displayName: string,
  icon: string,
  polarity: StatusPolarity,
  description: string,
): StatusMechanicDefinition {
  return {
    mechanicId, displayName, icon, description, polarity,
    dispelTier: 'normal', tickMode: 'trigger', expiresOn: 'trigger',
    stackMode: 'add', calculationStage: 'hit_check',
  };
}

type StatusIdentityOverride = Partial<Omit<StatusIdentityDefinition, 'identityId' | 'tags'>> & { mechanicId: string };

const IDENTITY_MECHANICS: Record<string, StatusIdentityOverride> = {
  AIM: { mechanicId: 'AIM', defaultCharges: 1, chargeCap: 1, stackMode: 'refresh' },
  SPELL_BLOCK: { mechanicId: 'SPELL_BLOCK', defaultCharges: 1, stackMode: 'refresh' },
  WAIT_COUNTER: { mechanicId: 'WAIT_COUNTER', defaultCharges: 1, chargeCap: 1, stackMode: 'refresh' },
  WEAK: {
    mechanicId: 'OUTPUT_DOWN', defaultPotency: 50, dispelTier: 'strong_only',
    damageSourceMask: ['standard'], calculationStage: 'standard_formula', stackMode: 'multiply',
  },
  BLIND: { mechanicId: 'ACCURACY_DOWN', defaultPotency: 45 },
  VALO_FLASH: { mechanicId: 'ACCURACY_DOWN', defaultPotency: 55 },
  VALO_AIM_PUNCH: { mechanicId: 'ACCURACY_DOWN', defaultPotency: 80 },
  CHARMED: { mechanicId: 'CHARMED', stackMode: 'replace' },
  CTR_CHARM: { mechanicId: 'CTR_CHARM', defaultCharges: 1 },
  CTR_STUN: { mechanicId: 'CTR_STUN', defaultCharges: 1 },
  CTR_DRAIN: { mechanicId: 'CTR_DRAIN', defaultCharges: 1 },
  CTR_POISON: { mechanicId: 'CTR_POISON', defaultCharges: 1 },
  CTR_BURN: { mechanicId: 'CTR_BURN', defaultCharges: 1 },
  CTR_FREEZE: { mechanicId: 'CTR_FREEZE', defaultCharges: 1 },
  CTR_VOID: { mechanicId: 'CTR_VOID', defaultCharges: 1 },
  CTR_WEAK: { mechanicId: 'CTR_WEAK', defaultCharges: 1 },
  CTR_CONFUSE: { mechanicId: 'CTR_CONFUSE', defaultCharges: 1 },
  CTR_EXECUTE: { mechanicId: 'CTR_EXECUTE', defaultCharges: 1 },
  OWL_EVADE_DOWN: { mechanicId: 'OWL_EVADE_DOWN', remainingTurnCap: 2 },
  VALO_OPERATOR_PENALTY: {
    mechanicId: 'VALO_OPERATOR_PENALTY', polarity: 'negative', dispelTier: 'none',
    components: [
      {
        mechanicId: 'SPD_DOWN', potency: 22, stackMode: 'multiply', calculationStage: 'panel_stat',
        statScope: ['spd'], minimumStatValue: 80, description: '有效速度降低 22%，但不低于 80',
      },
      {
        mechanicId: 'AGL_DOWN', potency: 32, stackMode: 'multiply', calculationStage: 'panel_stat',
        statScope: ['agl'], minimumStatValue: 90, description: '有效敏捷降低 32%，但不低于 90',
      },
    ],
  },
  GAMER_READ_INPUTS: {
    mechanicId: 'GAMER_READ_INPUTS',
    components: [
      { mechanicId: 'EVASION_DOWN', potency: 100, stackMode: 'highest', description: '闪避能力降为 0' },
      {
        mechanicId: 'RES_DOWN', potency: 10, stackMode: 'highest',
        damageSourceMask: ['standard'], description: '标准魔法伤害公式读取的魔抗降低 10%',
      },
    ],
  },
  GAMER_PARRY_GUARD: { mechanicId: 'GAMER_PARRY_GUARD', components: statComponents({ def: 1.08, res: 1.08 }) },
  GAMER_ROUTE_BOOST: { mechanicId: 'GAMER_ROUTE_BOOST', components: statComponents({ spd: 1.06, agl: 1.06 }) },
  GAMER_RUSH_B: { mechanicId: 'GAMER_RUSH_B', components: statComponents({ spd: 2, atk: 1.5 }) },
  GAMER_WARCRY: { mechanicId: 'GAMER_WARCRY', components: statComponents({ def: 2, res: 2 }) },
  TOKUSATSU_REHEARSAL: { mechanicId: 'TOKUSATSU_REHEARSAL', components: statComponents({ atk: 1.18, mag: 1.18, spd: 1.15 }) },
  TOKUSATSU_ALCHEMY_RES: { mechanicId: 'TOKUSATSU_ALCHEMY_RES', components: statComponents({ res: 1.08 }) },
  TOKUSATSU_ALCHEMY_ARMOR: { mechanicId: 'TOKUSATSU_ALCHEMY_ARMOR', components: statComponents({ def: 1.18, res: 1.18 }) },
  TOKUSATSU_MIRACLE_ARMOR: { mechanicId: 'TOKUSATSU_MIRACLE_ARMOR', components: statComponents({ def: 1.12, res: 1.12 }) },
  ZEROED: { mechanicId: 'ZEROED', dispelTier: 'strong_only', components: statComponents({ atk: 0.1, def: 0.1, res: 0.1 }) },
  MOMO_CAPTAIN: {
    mechanicId: 'MOMO_CAPTAIN',
    components: [
      {
        mechanicId: 'MOMO_CAPTAIN',
        potency: 0,
        stackMode: 'refresh',
        calculationStage: 'resource',
        description: '建立舰长关系，并将造成伤害的一部分回馈给萌月沫沫',
      },
      ...statComponents({ atk: 1.1 }),
    ],
  },
  MOMO_VILLAGE_SWORD: { mechanicId: 'MOMO_VILLAGE_SWORD', components: statComponents({ atk: 1.1 }) },
  MOMO_AWAKENED_SWORD: { mechanicId: 'MOMO_AWAKENED_SWORD', components: statComponents({ atk: 1.35 }) },
  OWL_FORM_VICTORY: { mechanicId: 'OWL_FORM_VICTORY', components: statComponents({ atk: 1.08, def: 1.08, spd: 1.08, agl: 1.08, mag: 1.08, res: 1.08, wis: 1.08 }) },
  OWL_FORM_PRIDE: { mechanicId: 'OWL_FORM_PRIDE', components: statComponents({ def: 0.55, res: 0.55 }) },
  PLUG_HEAD: { mechanicId: 'PLUG_HEAD' },
  PLUG_ARM: { mechanicId: 'PLUG_ARM' },
  PLUG_BACK: { mechanicId: 'PLUG_BACK' },
  PLUG_HEART: { mechanicId: 'PLUG_HEART' },
  PLUG_EYE: { mechanicId: 'PLUG_EYE' },
  PLUG_SKIN: { mechanicId: 'PLUG_SKIN' },
  PLUG_LEG: { mechanicId: 'PLUG_LEG' },
  PLUG_TAIL: { mechanicId: 'PLUG_TAIL' },
  STYLE_SMART: { mechanicId: 'STYLE_SMART', components: statComponents({ wis: 2, spd: 2 }) },
  STYLE_SEXY: { mechanicId: 'STYLE_SEXY', components: statComponents({ atk: 1.2 }) },
  STYLE_ANGRY: { mechanicId: 'STYLE_ANGRY', components: statComponents({ def: 0.01, res: 0.01, atk: 3 }) },
  STYLE_FAMILY: {
    mechanicId: 'STYLE_FAMILY',
    components: [
      { mechanicId: 'REGEN', potency: 0, stackMode: 'refresh', description: '每次自身行动机会恢复 5% 最大生命' },
      ...statComponents({ def: 3, res: 3 }),
    ],
  },
  STYLE_EMPEROR: { mechanicId: 'STYLE_EMPEROR', components: statComponents({ atk: 3, wis: 2, spd: 2, def: 3, res: 3 }) },
  RABBIT_CARROT: {
    mechanicId: 'RABBIT_CARROT',
    components: [
      { mechanicId: 'REGEN', potency: 0, stackMode: 'refresh', description: '每次自身行动机会恢复生命' },
      ...statComponents({ spd: 1.3, agl: 1.3 }),
    ],
  },
  DIVA_FINAL_CHORUS: { mechanicId: 'DIVA_FINAL_CHORUS', components: statComponents({ atk: 1.22, def: 1.22, spd: 1.22, agl: 1.22, mag: 1.22, res: 1.22, wis: 1.22 }) },
  BABY_LOVE_BOTTLE: { mechanicId: 'BABY_LOVE_BOTTLE', components: statComponents({ atk: 1.18, def: 1.18, spd: 1.12, agl: 1.12, mag: 1.18, res: 1.18, wis: 1.12 }) },
  VALO_HARBOR_WALL: { mechanicId: 'VALO_HARBOR_WALL', components: statComponents({ def: 1.25, res: 1.35 }) },
  VALO_ULT_EMPRESS: { mechanicId: 'VALO_ULT_EMPRESS', components: statComponents({ atk: 2, spd: 2 }) },
  DIVA_CHEER: { mechanicId: 'DIVA_CHEER', exclusiveGroup: 'DIVA_SONG_STAT_SLOT', components: statComponents({ atk: 1.2 }) },
  DIVA_RHYTHM: { mechanicId: 'DIVA_RHYTHM', exclusiveGroup: 'DIVA_SONG_STAT_SLOT', components: statComponents({ spd: 1.5 }) },
  DIVA_FAN_GUARD: { mechanicId: 'DIVA_FAN_GUARD', exclusiveGroup: 'DIVA_SONG_STAT_SLOT', components: statComponents({ def: 1.5 }) },
  DIVA_STAGE_SMOKE: { mechanicId: 'DIVA_STAGE_SMOKE', exclusiveGroup: 'DIVA_SONG_STAT_SLOT', components: statComponents({ agl: 1.5 }) },
  BABY_MAGIC_BATTERY: { mechanicId: 'BABY_MAGIC_BATTERY', components: statComponents({ mag: 2 }) },
  BABY_WHETSTONE: { mechanicId: 'BABY_WHETSTONE', components: statComponents({ atk: 2 }) },
  BABY_GUARDIAN_FAIRY: { mechanicId: 'BABY_GUARDIAN_FAIRY', components: statComponents({ agl: 2 }) },
  BABY_CHEER: { mechanicId: 'BABY_CHEER', components: statComponents({ atk: 1.5, mag: 1.5 }) },
  BABY_SPEED: { mechanicId: 'BABY_SPEED', components: statComponents({ spd: 2, agl: 2 }) },
  EMOTE_OWNER_BONUS: {
    mechanicId: 'EMOTE_OWNER_BONUS',
    components: (['atk', 'def', 'spd', 'agl', 'mag', 'res', 'wis'] as const).map((key) => ({
      mechanicId: `${key.toUpperCase()}_FLAT_UP`,
      potency: 0,
      stackMode: 'add' as const,
      calculationStage: 'effective_stat' as const,
      statScope: [key],
      description: `${key.toUpperCase()} 增加固定数值`,
    })),
  },
  NEURAL_THEFT_DEBUFF: {
    mechanicId: 'NEURAL_THEFT_DEBUFF',
    components: [
      { mechanicId: 'EVASION_DOWN', potency: 100, stackMode: 'highest', description: '闪避能力降为 0' },
      { mechanicId: 'OPENING', potency: 100, stackMode: 'highest', description: '允许暴击的攻击必定暴击' },
      { mechanicId: 'SURE_HIT_TAKEN', potency: 100, stackMode: 'highest', description: '所有攻击必定命中' },
    ],
  },
  WT_SUPPRESS: {
    mechanicId: 'WT_SUPPRESS',
    components: [
      { mechanicId: 'EVASION_DOWN', potency: 100, stackMode: 'highest', description: '被压制期间闪避能力降为 0' },
    ],
  },
  RABBIT_CALC_HASTE: { mechanicId: 'HASTE', defaultPotency: 13, stackMode: 'multiply' },
  RABBIT_ZERO_HASTE: { mechanicId: 'HASTE', defaultPotency: 26, stackMode: 'multiply' },
  OWL_DRAGON_SLOW: {
    mechanicId: 'BIND', defaultPotency: 28, tickMode: 'global_action',
    expiresOn: 'global_action_end', stackMode: 'multiply',
  },
  YUZU_EVADE_DOWN: { mechanicId: 'EVASION_DOWN', defaultPotency: 45, stackMode: 'multiply' },
  YUZU_DEF_DOWN: {
    mechanicId: 'DEF_DOWN', defaultPotency: 30, stackMode: 'multiply', damageSourceMask: ['standard'],
  },
  YUZU_RES_DOWN: {
    mechanicId: 'RES_DOWN', defaultPotency: 30, stackMode: 'multiply', damageSourceMask: ['standard'],
  },
  YUZU_ATK_DOWN: {
    mechanicId: 'OUTPUT_DOWN', defaultPotency: 22, damageSourceMask: ['standard'],
    calculationStage: 'standard_formula', stackMode: 'multiply',
  },
  YUZU_SLOW: { mechanicId: 'BIND', defaultPotency: 25, stackMode: 'multiply' },
  MOMO_MIC_DEF_DOWN: {
    mechanicId: 'DEF_DOWN', defaultPotency: 22, stackMode: 'multiply',
    calculationStage: 'panel_stat', damageSourceMask: ['standard'],
  },
  VALO_CYPHER_REVEALED: {
    mechanicId: 'DEF_DOWN', defaultPotency: 32, stackMode: 'multiply', damageSourceMask: ['standard'],
  },
  BABY_WEAKNESS_MARK: {
    mechanicId: 'DEF_RES_DOWN', defaultPotency: 38, stackMode: 'multiply', damageSourceMask: ['standard'],
  },
  VALO_VIPER_DECAY: {
    mechanicId: 'DEF_RES_DOWN', defaultPotency: 50, stackMode: 'multiply', damageSourceMask: ['standard'],
  },
  DIVA_HEADPHONE_GUARD: {
    mechanicId: 'RES_UP', defaultPotency: 50, stackMode: 'multiply',
    calculationStage: 'panel_stat', statScope: ['res'],
  },
  WT_RADIO_MORALE: {
    mechanicId: 'OUTPUT_UP', defaultPotency: 30, damageSourceMask: ['standard'], statScope: ['physical'],
    calculationStage: 'standard_formula', stackMode: 'multiply',
  },
  WT_BREECH_DAMAGED: {
    mechanicId: 'OUTPUT_DOWN', defaultPotency: 38, damageSourceMask: ['standard'],
    calculationStage: 'standard_formula', stackMode: 'multiply', dispelTier: 'strong_only',
  },
  WT_TRACK_DAMAGED: {
    mechanicId: 'EVASION_DOWN', defaultPotency: 100, stackMode: 'multiply', dispelTier: 'strong_only',
  },
  WT_AMMO_EXPOSED: { mechanicId: 'WT_AMMO_EXPOSED', dispelTier: 'strong_only' },
  WT_ORIGINIUM_BREECH_DAMAGED: {
    mechanicId: 'OUTPUT_DOWN', defaultPotency: 38, damageSourceMask: ['standard'],
    calculationStage: 'standard_formula', stackMode: 'multiply', dispelTier: 'strong_only',
  },
  WT_ORIGINIUM_TRACK_DAMAGED: {
    mechanicId: 'EVASION_DOWN', defaultPotency: 100, stackMode: 'multiply', dispelTier: 'strong_only',
  },
  WT_ORIGINIUM_AMMO_EXPOSED: { mechanicId: 'WT_AMMO_EXPOSED', dispelTier: 'strong_only' },
  WT_SCOUTED: { mechanicId: 'WT_SCOUTED', dispelTier: 'strong_only' },
  WT_REPAIRING: {
    mechanicId: 'WT_REPAIRING', polarity: 'negative', dispelTier: 'strong_only',
  },
  // A second launch refreshes the one pending landing instead of queuing
  // another fall from a different source.
  AIRBORNE: { mechanicId: 'AIRBORNE', remainingTurnCap: 1, stackMode: 'replace' },
  ORIGINIUM_DISEASE: {
    mechanicId: 'ORIGINIUM_DISEASE', polarity: 'negative', dispelTier: 'none',
    defaultPotency: 1, potencyCap: 80, stackMode: 'add', calculationStage: 'panel_stat',
    persistentStatShape: (potency) => {
      const stacks = Math.max(0, Math.min(80, potency));
      return {
        maxHp: Math.max(0.42, 1 - stacks * 0.0065),
        atk: stacks < 60 ? 1 + stacks * 0.01 : 1,
        def: Math.max(0.28, 1 - stacks * 0.008),
        res: stacks < 60 ? 1 + stacks * 0.01 : 1,
      };
    },
  },
  RAGE: {
    mechanicId: 'RAGE', dispelTier: 'none',
    components: [{
      mechanicId: 'OUTPUT_UP', potency: 50, stackMode: 'highest',
      calculationStage: 'standard_formula', damageSourceMask: ['standard'], statScope: ['physical'],
      description: '标准物理与特殊攻击公式的输出提高 50%',
    }],
  },
  NO_HEAL: { mechanicId: 'EXHAUSTION', defaultPotency: 100, dispelTier: 'strong_only' },
  Q_BUNNY_IDOL_AGL: {
    mechanicId: 'Q_BUNNY_IDOL_AGL',
    components: [
      { mechanicId: 'ACCURACY_AGL_UP', potency: 20, stackMode: 'highest', description: '命中公式读取的敏捷提高 20%' },
      { mechanicId: 'EVASION_UP', potency: 20, stackMode: 'highest', description: '闪避公式读取的敏捷提高 20%' },
    ],
  },
  YUZU_TAUNT: { mechanicId: 'YUZU_TAUNT', dispelTier: 'none' },
  COUNTER: { mechanicId: 'COUNTER', defaultCharges: 1, stackMode: 'refresh' },
  VALO_HOLDING_ANGLE: { mechanicId: 'VALO_HOLDING_ANGLE', defaultCharges: 1, stackMode: 'refresh' },
  MOMO_CROWD_JOY: {
    mechanicId: 'MOMO_CROWD_JOY', defaultPotency: 0, potencyCap: 138, stackMode: 'add',
  },
  OWL_WILD: {
    mechanicId: 'OWL_WILD', defaultPotency: 0, potencyCap: 5, stackMode: 'add',
  },
  RABBIT_CHARM_COUNTER: { mechanicId: 'CTR_CHARM', defaultCharges: 1, stackMode: 'refresh' },
  RABBIT_STYLE_RAGE: {
    mechanicId: 'RAGE',
    components: [{
      mechanicId: 'OUTPUT_UP', potency: 50, stackMode: 'highest',
      calculationStage: 'standard_formula', damageSourceMask: ['standard'], statScope: ['physical'],
      description: '标准物理与特殊攻击公式的输出提高 50%',
    }],
  },
};

type IdentityPolicy = Pick<
  StatusIdentityDefinition,
  'polarity' | 'dispelTier' | 'tickMode' | 'expiresOn' | 'stackMode' | 'calculationStage'
>;

const IDENTITY_POLICIES: Record<string, IdentityPolicy> = {};

function registerIdentityPolicies(ids: readonly string[], policy: IdentityPolicy): void {
  ids.forEach((identityId) => {
    if (IDENTITY_POLICIES[identityId]) throw new Error(`Duplicate status identity policy: ${identityId}`);
    IDENTITY_POLICIES[identityId] = { ...policy };
  });
}

const SELF = { tickMode: 'self_opportunity', expiresOn: 'self_opportunity_end' } as const;
const GLOBAL = { tickMode: 'global_action', expiresOn: 'global_action_end' } as const;
const TRIGGERED = { tickMode: 'trigger', expiresOn: 'trigger' } as const;
const PERMANENT = { tickMode: 'permanent', expiresOn: 'never' } as const;
const LIFECYCLE = { stackMode: 'refresh', calculationStage: 'lifecycle' } as const;

// Identities whose public identity is the mechanic itself are still enumerated.
// This list is the only supported direct-mechanic application surface.
const DIRECT_MECHANIC_IDENTITIES = [
  'BURN', 'BLEED', 'POISON', 'RUPTURE', 'TREMOR', 'STAGGERED', 'SINKING',
  'MENTAL_BREAKDOWN', 'POISE', 'CHARGE', 'VULNERABILITY', 'PROTECTION',
  'PARALYSIS', 'HASTE', 'BIND', 'AGGRO', 'OUTPUT_UP', 'OUTPUT_DOWN',
  'ATK_UP', 'ATK_DOWN', 'MAG_UP', 'MAG_DOWN', 'WIS_UP', 'WIS_DOWN',
  'SPD_UP', 'SPD_DOWN', 'AGL_UP', 'AGL_DOWN', 'DEF_RES_UP', 'DEF_RES_DOWN',
  'DEF_UP', 'DEF_DOWN', 'RES_UP', 'RES_DOWN', 'ACCURACY_UP', 'ACCURACY_DOWN',
  'ACCURACY_AGL_UP', 'EVASION_UP', 'EVASION_DOWN', 'VITALITY', 'EXHAUSTION',
  'BARRIER', 'CRIT_DAMAGE_UP', 'CRIT_DAMAGE_DOWN', 'CRIT_RATE_UP', 'ATK_FLAT_UP',
  'DEF_FLAT_UP', 'SPD_FLAT_UP', 'AGL_FLAT_UP', 'MAG_FLAT_UP', 'RES_FLAT_UP',
  'WIS_FLAT_UP', 'DRAIN', 'OPENING', 'SURE_HIT_TAKEN',
] as const;
DIRECT_MECHANIC_IDENTITIES.forEach((identityId) => {
  const definition = CORE[identityId] ?? SUPPLEMENTAL[identityId];
  if (!definition) throw new Error(`Missing direct mechanic definition: ${identityId}`);
  registerIdentityPolicies([identityId], {
    polarity: definition.polarity,
    dispelTier: definition.dispelTier,
    tickMode: definition.tickMode,
    expiresOn: definition.expiresOn,
    stackMode: definition.stackMode,
    calculationStage: definition.calculationStage,
  });
});

registerIdentityPolicies(
  ['STUN', 'FREEZE', 'CONFUSED', 'EMBARRASSED', 'CHARMED', 'WATER_PRISON', 'WT_SUPPRESS', 'AIRBORNE', 'WT_REPAIRING', 'WT_SCOUTED', 'WT_BREECH_DAMAGED', 'WT_TRACK_DAMAGED', 'WT_AMMO_EXPOSED', 'WT_ORIGINIUM_BREECH_DAMAGED', 'WT_ORIGINIUM_TRACK_DAMAGED', 'WT_ORIGINIUM_AMMO_EXPOSED', 'WEAK', 'ZEROED', 'NO_HEAL'],
  { polarity: 'negative', dispelTier: 'strong_only', ...SELF, ...LIFECYCLE },
);
registerIdentityPolicies(
  ['SILENCE', 'VALO_CYPHER_REVEALED', 'NEURAL_THEFT_DEBUFF', 'VALO_VIPER_DECAY', 'BABY_WEAKNESS_MARK', 'GAMER_READ_INPUTS', 'YUZU_EVADE_DOWN', 'YUZU_DEF_DOWN', 'YUZU_RES_DOWN', 'YUZU_ATK_DOWN', 'YUZU_SLOW', 'OWL_EVADE_DOWN', 'MOMO_MIC_DEF_DOWN'],
  { polarity: 'negative', dispelTier: 'normal', ...SELF, ...LIFECYCLE },
);
registerIdentityPolicies(
  ['BLIND', 'VALO_FLASH', 'VALO_AIM_PUNCH'],
  { polarity: 'negative', dispelTier: 'normal', ...TRIGGERED, ...LIFECYCLE },
);
registerIdentityPolicies(
  ['VALO_OPERATOR_PENALTY'],
  { polarity: 'negative', dispelTier: 'none', ...SELF, ...LIFECYCLE },
);
registerIdentityPolicies(
  ['OWL_DRAGON_SLOW'],
  { polarity: 'negative', dispelTier: 'normal', ...GLOBAL, ...LIFECYCLE },
);
registerIdentityPolicies(
  ['ORIGINIUM_DISEASE'],
  { polarity: 'negative', dispelTier: 'none', ...PERMANENT, ...LIFECYCLE },
);

registerIdentityPolicies(
  ['INVUL', 'BKB', 'OWL_EAR_GUARD'],
  { polarity: 'positive', dispelTier: 'normal', ...GLOBAL, ...LIFECYCLE },
);
registerIdentityPolicies(
  ['AIM', 'SPELL_BLOCK'],
  { polarity: 'positive', dispelTier: 'normal', ...TRIGGERED, ...LIFECYCLE },
);
registerIdentityPolicies(
  [
    'REGEN', 'TOKUSATSU_REHEARSAL', 'TOKUSATSU_ALCHEMY_RES',
    'TOKUSATSU_ALCHEMY_ARMOR', 'TOKUSATSU_MIRACLE_ARMOR', 'VALO_ULT_EMPRESS',
    'VALO_HOLDING_ANGLE', 'VALO_CLUTCH', 'VALO_REPOSITION', 'VALO_HARBOR_WALL',
    'DIVA_HEADPHONE_GUARD', 'DIVA_FINAL_CHORUS', 'BABY_LOVE_BOTTLE',
    'BABY_MAGIC_BATTERY', 'BABY_WHETSTONE', 'BABY_GUARDIAN_FAIRY', 'BABY_CHEER',
    'BABY_SPEED', 'Q_BUNNY_IDOL_AGL', 'TEMP_STAT_BUFF', 'DIVA_CHEER', 'DIVA_RHYTHM',
    'DIVA_FAN_GUARD', 'DIVA_STAGE_SMOKE', 'GAMER_RUSH_B', 'GAMER_WARCRY',
    'GAMER_WORLD_STAGE', 'GAMER_PARRY_GUARD', 'GAMER_ROUTE_BOOST',
    'RABBIT_CALC_HASTE', 'RABBIT_ZERO_HASTE', 'RABBIT_CARROT', 'WT_RADIO_MORALE',
  ],
  { polarity: 'positive', dispelTier: 'normal', ...SELF, ...LIFECYCLE },
);
registerIdentityPolicies(
  ['RAGE'],
  { polarity: 'positive', dispelTier: 'none', ...SELF, ...LIFECYCLE },
);

registerIdentityPolicies(
  ['WAIT_COUNTER'],
  { polarity: 'independent', dispelTier: 'none', ...TRIGGERED, ...LIFECYCLE },
);
registerIdentityPolicies(
  [
    'COUNTER', 'SPINAL_SWORD', 'VALO_ULT_RUN_IT_BACK', 'GACHA_SUMMON_LIFESTEAL',
    'GACHA_TING_LUCK_COOLDOWN', 'GACHA_TRAP_GUARD_COOLDOWN',
    'GACHA_BLUE_EYES_GUARD_COOLDOWN', 'GACHA_ULTIMATE_GUARD_COOLDOWN',
    'RA_PHOENIX', 'EMOTE_ADAPT', 'EMOTE_FAMILIAR', 'EMOTE_ULT_COOLDOWN', 'YUZU_TAUNT',
    'CTR_CHARM', 'CTR_STUN', 'CTR_DRAIN', 'CTR_POISON', 'CTR_BURN', 'CTR_FREEZE',
    'CTR_VOID', 'CTR_WEAK', 'CTR_CONFUSE', 'CTR_EXECUTE',
  ],
  { polarity: 'independent', dispelTier: 'none', ...SELF, ...LIFECYCLE },
);
registerIdentityPolicies(
  [
    'TING_DEFIANCE', 'TOKUSATSU_DEFIANCE', 'ETHEREAL', 'SYNERGY_SLACKING',
    'OWL_FORM_DEFEAT', 'OWL_FORM_SORROW', 'OWL_RIVER_MARK', 'OWL_SPECTER_LOCK',
    'OWL_SPALTER_LOCK', 'OWL_SPALTER_DOLL', 'OWL_ENJOYING',
  ],
  { polarity: 'independent', dispelTier: 'none', ...GLOBAL, ...LIFECYCLE },
);
registerIdentityPolicies(
  [
    'LIQUID_BODY', 'PUPPET_MASTER', 'WT_ERA', 'EMOTE_OWNER_BONUS', 'YUZU_MARKED',
    'OWL_FORM_VICTORY', 'OWL_FORM_PRIDE', 'OWL_ACID_FEARLESS', 'OWL_IMPERIAL_SEAL',
    'OWL_WILD', 'MOMO_CAPTAIN', 'MOMO_CROWD_JOY', 'MOMO_VILLAGE_SWORD',
    'MOMO_AWAKENED_SWORD', 'PLUG_HEAD', 'PLUG_ARM', 'PLUG_BACK', 'PLUG_HEART',
    'PLUG_EYE', 'PLUG_SKIN', 'PLUG_LEG', 'PLUG_TAIL', 'STYLE_SMART', 'STYLE_SEXY',
    'STYLE_ANGRY', 'STYLE_FOOL', 'STYLE_VAIN', 'STYLE_FAMILY', 'STYLE_EMPEROR',
    'RABBIT_CHARM_COUNTER', 'RABBIT_STYLE_RAGE',
  ],
  { polarity: 'independent', dispelTier: 'none', ...PERMANENT, ...LIFECYCLE },
);

const TAG_IDENTITIES: Record<StatusTag, readonly string[]> = {
  control: ['STUN', 'FREEZE', 'CONFUSED', 'EMBARRASSED', 'CHARMED', 'WATER_PRISON', 'WT_SUPPRESS', 'AIRBORNE', 'WT_REPAIRING'],
  action_blocking: ['STUN', 'FREEZE', 'WATER_PRISON', 'WT_SUPPRESS', 'AIRBORNE', 'WT_REPAIRING'],
  spell_immunity_blocked: ['STUN', 'FREEZE', 'CONFUSED', 'EMBARRASSED', 'CHARMED', 'WATER_PRISON', 'WT_SUPPRESS', 'AIRBORNE', 'SILENCE'],
  common_negative: [
    'STUN', 'FREEZE', 'BURN', 'POISON', 'BLIND', 'SILENCE', 'CONFUSED', 'EMBARRASSED',
    'CHARMED', 'VALO_FLASH', 'VALO_AIM_PUNCH', 'VALO_CYPHER_REVEALED',
    'NEURAL_THEFT_DEBUFF', 'BABY_WEAKNESS_MARK', 'BLEED', 'YUZU_EVADE_DOWN',
    'YUZU_DEF_DOWN', 'YUZU_RES_DOWN', 'YUZU_ATK_DOWN', 'YUZU_SLOW', 'OWL_EVADE_DOWN',
    'OWL_DRAGON_SLOW', 'VALO_VIPER_DECAY', 'GAMER_READ_INPUTS', 'MOMO_MIC_DEF_DOWN',
  ],
  damage_over_time: ['POISON', 'WATER_PRISON'],
  counter_stance: ['CTR_CHARM', 'CTR_STUN', 'CTR_DRAIN', 'CTR_POISON', 'CTR_BURN', 'CTR_FREEZE', 'CTR_VOID', 'CTR_WEAK', 'CTR_CONFUSE', 'CTR_EXECUTE', 'RABBIT_CHARM_COUNTER'],
  slacking_away_state: ['SYNERGY_SLACKING', 'INVUL', 'STUN', 'BKB', 'SPELL_BLOCK'],
  slacking_return_protection: ['INVUL', 'STUN', 'BKB', 'SPELL_BLOCK'],
  death_persistent: ['ORIGINIUM_DISEASE'],
  revive_clean: [
    'STUN', 'FREEZE', 'BURN', 'POISON', 'BLIND', 'SILENCE', 'CONFUSED', 'EMBARRASSED',
    'CHARMED', 'VALO_FLASH', 'VALO_AIM_PUNCH', 'VALO_CYPHER_REVEALED',
    'NEURAL_THEFT_DEBUFF', 'BABY_WEAKNESS_MARK', 'BLEED', 'YUZU_EVADE_DOWN',
    'YUZU_DEF_DOWN', 'YUZU_RES_DOWN', 'YUZU_ATK_DOWN', 'YUZU_SLOW', 'OWL_EVADE_DOWN',
    'OWL_DRAGON_SLOW', 'VALO_VIPER_DECAY', 'GAMER_READ_INPUTS', 'MOMO_MIC_DEF_DOWN',
    'WATER_PRISON', 'WT_SUPPRESS', 'AIRBORNE', 'WT_REPAIRING',
    'WT_BREECH_DAMAGED', 'WT_TRACK_DAMAGED', 'WT_AMMO_EXPOSED',
    'WT_ORIGINIUM_BREECH_DAMAGED', 'WT_ORIGINIUM_TRACK_DAMAGED',
    'WT_ORIGINIUM_AMMO_EXPOSED', 'WT_SCOUTED',
    'NO_HEAL', 'WEAK', 'ZEROED', 'YUZU_TAUNT', 'YUZU_MARKED', 'OWL_RIVER_MARK',
  ],
  rabbit_style: ['STYLE_SMART', 'STYLE_SEXY', 'STYLE_ANGRY', 'STYLE_FOOL', 'STYLE_VAIN', 'STYLE_FAMILY', 'STYLE_EMPEROR', 'RABBIT_CHARM_COUNTER', 'RABBIT_STYLE_RAGE'],
  chimera_plug: ['PLUG_HEAD', 'PLUG_ARM', 'PLUG_BACK', 'PLUG_HEART', 'PLUG_EYE', 'PLUG_SKIN', 'PLUG_LEG', 'PLUG_TAIL'],
  not_diva_spreadable: [
    'PLUG_HEAD', 'PLUG_ARM', 'PLUG_BACK', 'PLUG_HEART', 'PLUG_EYE', 'PLUG_SKIN',
    'PLUG_LEG', 'PLUG_TAIL', 'CTR_CHARM', 'CTR_STUN', 'CTR_DRAIN', 'CTR_POISON',
    'CTR_BURN', 'CTR_FREEZE', 'CTR_VOID', 'CTR_WEAK', 'CTR_CONFUSE', 'CTR_EXECUTE',
    'RABBIT_CHARM_COUNTER', 'STYLE_SMART', 'STYLE_SEXY', 'STYLE_ANGRY', 'STYLE_FOOL',
    'STYLE_VAIN', 'STYLE_FAMILY', 'STYLE_EMPEROR', 'RABBIT_STYLE_RAGE', 'WT_SUPPRESS',
    'AIRBORNE', 'WT_REPAIRING', 'WT_ERA', 'WT_SCOUTED', 'WT_BREECH_DAMAGED',
    'WT_TRACK_DAMAGED', 'WT_AMMO_EXPOSED', 'WT_ORIGINIUM_BREECH_DAMAGED',
    'WT_ORIGINIUM_TRACK_DAMAGED', 'WT_ORIGINIUM_AMMO_EXPOSED', 'WT_RADIO_MORALE', 'GAMER_RUSH_B',
    'GAMER_WARCRY', 'GAMER_WORLD_STAGE', 'GAMER_PARRY_GUARD', 'GAMER_ROUTE_BOOST',
    'GAMER_READ_INPUTS', 'VALO_ULT_EMPRESS', 'VALO_ULT_RUN_IT_BACK',
    'VALO_HOLDING_ANGLE', 'VALO_AIM_PUNCH', 'VALO_CLUTCH', 'VALO_REPOSITION',
    'VALO_OPERATOR_PENALTY', 'VALO_HARBOR_WALL', 'VALO_CYPHER_REVEALED',
    'VALO_VIPER_DECAY', 'VALO_FLASH', 'BABY_LOVE_BOTTLE', 'BABY_MAGIC_BATTERY',
    'BABY_WHETSTONE', 'BABY_GUARDIAN_FAIRY', 'BABY_CHEER', 'BABY_SPEED',
    'BABY_WEAKNESS_MARK',
  ],
  important_removal: [
    'BKB', 'COUNTER', 'DIVA_FINAL_CHORUS', 'DIVA_HEADPHONE_GUARD', 'INVUL',
    'LIQUID_BODY', 'RAGE', 'SPELL_BLOCK', 'SYNERGY_SLACKING', 'TING_DEFIANCE',
    'TOKUSATSU_DEFIANCE', 'VALO_HARBOR_WALL', 'VALO_ULT_EMPRESS',
    'VALO_ULT_RUN_IT_BACK', 'WAIT_COUNTER', 'CTR_CHARM', 'CTR_STUN', 'CTR_DRAIN',
    'CTR_POISON', 'CTR_BURN', 'CTR_FREEZE', 'CTR_VOID', 'CTR_WEAK', 'CTR_CONFUSE',
    'CTR_EXECUTE', 'RABBIT_CHARM_COUNTER', 'PLUG_HEAD', 'PLUG_ARM', 'PLUG_BACK',
    'PLUG_HEART', 'PLUG_EYE', 'PLUG_SKIN', 'PLUG_LEG', 'PLUG_TAIL', 'STYLE_SMART',
    'STYLE_SEXY', 'STYLE_ANGRY', 'STYLE_FOOL', 'STYLE_VAIN', 'STYLE_FAMILY', 'STYLE_EMPEROR',
  ],
};

const TAGS_BY_IDENTITY = Object.entries(TAG_IDENTITIES).reduce<Record<string, StatusTag[]>>(
  (result, [tag, identities]) => {
    identities.forEach((identityId) => {
      (result[identityId] ??= []).push(tag as StatusTag);
    });
    return result;
  },
  {},
);

const BASE_STATUS_MECHANICS: Readonly<Record<string, StatusMechanicDefinition>> = {
  ...CORE,
  ...SUPPLEMENTAL,
};

function buildIdentityDefinition(identityId: string): StatusIdentityDefinition {
  const presentation = STATUS_IDENTITY_PRESENTATION[identityId];
  const policy = IDENTITY_POLICIES[identityId];
  if (!presentation || !policy) throw new Error(`Incomplete status identity registration: ${identityId}`);
  const override = IDENTITY_MECHANICS[identityId];
  const mechanicId = override?.mechanicId ?? identityId;
  const mechanic = BASE_STATUS_MECHANICS[mechanicId];
  return {
    ...policy,
    ...mechanic,
    ...override,
    mechanicId,
    identityId,
    displayName: presentation.name,
    icon: presentation.icon,
    description: presentation.desc,
    polarity: override?.polarity ?? policy.polarity,
    dispelTier: override?.dispelTier ?? policy.dispelTier,
    tickMode: override?.tickMode ?? policy.tickMode,
    expiresOn: override?.expiresOn ?? policy.expiresOn,
    stackMode: override?.stackMode ?? mechanic?.stackMode ?? policy.stackMode,
    calculationStage: override?.calculationStage ?? mechanic?.calculationStage ?? policy.calculationStage,
    tags: TAGS_BY_IDENTITY[identityId] ?? [],
  };
}

const presentationIds = Object.keys(STATUS_IDENTITY_PRESENTATION);
const policyIds = Object.keys(IDENTITY_POLICIES);
const missingPolicies = presentationIds.filter((identityId) => !IDENTITY_POLICIES[identityId]);
const missingPresentation = policyIds.filter((identityId) => !STATUS_IDENTITY_PRESENTATION[identityId]);
if (missingPolicies.length || missingPresentation.length) {
  throw new Error(`Status catalog mismatch; missing policies=[${missingPolicies.join(',')}], missing presentation=[${missingPresentation.join(',')}]`);
}

export const STATUS_IDENTITIES: Readonly<Record<string, StatusIdentityDefinition>> = Object.fromEntries(
  presentationIds.map((identityId) => [identityId, buildIdentityDefinition(identityId)]),
);

const identitySpecificMechanics = Object.fromEntries(
  Object.values(STATUS_IDENTITIES)
    .filter((identity) => identity.mechanicId === identity.identityId && !BASE_STATUS_MECHANICS[identity.mechanicId])
    .map((identity) => [identity.mechanicId, identity]),
) as Record<string, StatusMechanicDefinition>;

export const STATUS_MECHANICS: Readonly<Record<string, StatusMechanicDefinition>> = {
  ...BASE_STATUS_MECHANICS,
  ...identitySpecificMechanics,
};

export const BARRIER_IDENTITIES: Readonly<Record<string, BarrierIdentityDefinition>> = {
  BARRIER: {
    identityId: 'BARRIER',
    displayName: '屏障',
    icon: '🔵',
    description: '先于生命承受允许被屏障吸收的伤害；屏障耗尽后自动消失',
    polarity: 'positive',
    dispelTier: 'normal',
    tickMode: 'self_opportunity',
  },
  YUZU_BARRIER: {
    identityId: 'YUZU_BARRIER',
    displayName: '镜界护盾',
    icon: '🛡️',
    description: '镜界构成的护盾，先于生命承受允许被屏障吸收的伤害',
    polarity: 'positive',
    dispelTier: 'none',
    tickMode: 'permanent',
  },
  PURUISAISHI_BARRIER: {
    identityId: 'PURUISAISHI_BARRIER',
    displayName: '源石映像护盾',
    icon: '🜲',
    description: '普瑞赛斯二阶段的专属护盾；护盾归零时触发既定退场规则',
    polarity: 'independent',
    dispelTier: 'none',
    tickMode: 'permanent',
  },
};

const referencedMechanicIds = new Set(
  Object.values(STATUS_IDENTITIES).flatMap((identity) => [
    identity.mechanicId,
    ...(identity.components ?? []).map((component) => component.mechanicId),
  ]),
);
const missingMechanics = [...referencedMechanicIds].filter((mechanicId) => !STATUS_MECHANICS[mechanicId]);
if (missingMechanics.length > 0) {
  throw new Error(`Status catalog references unregistered mechanics: ${missingMechanics.join(',')}`);
}

export function getStatusIdentityDefinition(identityId: string): StatusIdentityDefinition {
  const definition = STATUS_IDENTITIES[identityId];
  if (!definition) throw new Error(`Unknown status identity: ${identityId}`);
  return definition;
}

export function getStatusMechanicDefinition(mechanicId: string): StatusMechanicDefinition {
  const definition = STATUS_MECHANICS[mechanicId];
  if (!definition) throw new Error(`Unknown status mechanic: ${mechanicId}`);
  return definition;
}

export function getBarrierIdentityDefinition(identityId: string): BarrierIdentityDefinition {
  const definition = BARRIER_IDENTITIES[identityId];
  if (!definition) throw new Error(`Unknown barrier identity: ${identityId}`);
  return definition;
}

export function identityHasTag(identityId: string, tag: StatusTag): boolean {
  return getStatusIdentityDefinition(identityId).tags.includes(tag);
}

export function statusHasTag(status: Pick<StatusInstance, 'identityId'>, tag: StatusTag): boolean {
  return identityHasTag(status.identityId, tag);
}

export function getStatusIdentityIdsByTag(tag: StatusTag): readonly string[] {
  return TAG_IDENTITIES[tag];
}

export function getStatusMechanicId(status: Pick<StatusInstance, 'identityId' | 'mechanicId'>): string {
  return status.mechanicId;
}

export function getStatusPolarity(status: StatusInstance): StatusPolarity {
  return status.polarity;
}

export function getStatusDispelTier(status: StatusInstance): StatusDispelTier {
  return status.dispelTier;
}

export function getStatusPotency(status: StatusInstance): number {
  if (status.potency !== undefined) return status.potency;
  return status.potency ?? 0;
}

export function getStatusMechanicProjection(
  status: StatusInstance,
  mechanicId: string,
): StatusMechanicProjection | undefined {
  if (status.mechanicId !== mechanicId) return undefined;
  const component = getStatusIdentityDefinition(status.identityId).components
    ?.find((candidate) => candidate.mechanicId === mechanicId);
  return {
    mechanicId,
    potency: getStatusPotency(status),
    stackMode: status.stackMode,
    calculationStage: status.calculationStage,
    damageSourceMask: status.damageSourceMask,
    statScope: status.statScope,
    minimumStatValue: component?.minimumStatValue,
  };
}

export function getStatusMechanicalComponents(status: StatusInstance): StatusMechanicProjection[] {
  const projection = getStatusMechanicProjection(status, status.mechanicId);
  return projection ? [projection] : [];
}

export function getStatusPotencyForMechanic(status: StatusInstance, mechanicId: string): number {
  return getStatusMechanicProjection(status, mechanicId)?.potency ?? 0;
}

export function isDualValueStatus(status: StatusInstance): boolean {
  return getStatusMechanicDefinition(getStatusMechanicId(status)).dualValue === true;
}

export function isDirectDamageKind(kind: DamageSourceKind | undefined): boolean {
  return kind === 'standard' || kind === 'custom' || kind === 'manual';
}
