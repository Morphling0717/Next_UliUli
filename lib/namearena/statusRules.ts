import type { StatusTickMode } from './types';

export const WT_REPAIRING_PROFILE = {
  duration: 2,
  healPerTurnPct: 0.2,
  incomingDamageMultiplier: 1.3,
} as const;

export const CONTROL_STATUS_TYPES: string[] = [
  'STUN',
  'FREEZE',
  'CONFUSED',
  'EMBARRASSED',
  'CHARMED',
  'WATER_PRISON',
  'WT_SUPPRESS',
  'WT_AIRBORNE',
  'AIRBORNE',
  'WT_REPAIRING',
];

/** Controls that consume the owner's action outright. Soft controls are handled separately. */
export const ACTION_BLOCKING_STATUS_TYPES: string[] = [
  'STUN',
  'FREEZE',
  'WATER_PRISON',
  'WT_SUPPRESS',
  'WT_AIRBORNE',
  'AIRBORNE',
  'WT_REPAIRING',
];

export const BKB_BLOCKED_STATUS_TYPES: string[] = [
  ...CONTROL_STATUS_TYPES.filter((type) => type !== 'WT_REPAIRING'),
  'SILENCE',
];

export const COMMON_NEGATIVE_STATUS_TYPES: string[] = [
  'STUN',
  'FREEZE',
  'BURN',
  'POISON',
  'BLIND',
  'SILENCE',
  'CONFUSED',
  'EMBARRASSED',
  'CHARMED',
  'VALO_FLASH',
  'VALO_AIM_PUNCH',
  'VALO_CYPHER_REVEALED',
  'NEURAL_THEFT_DEBUFF',
  'BABY_WEAKNESS_MARK',
  'BLEED',
  'YUZU_EVADE_DOWN',
  'YUZU_DEF_DOWN',
  'YUZU_RES_DOWN',
  'YUZU_ATK_DOWN',
  'YUZU_SLOW',
  'OWL_EVADE_DOWN',
  'OWL_DRAGON_SLOW',
  'VALO_VIPER_DECAY',
  'GAMER_READ_INPUTS',
];

export const DOT_STATUS_TYPES: string[] = [
  'POISON',
  'BURN',
  'BLEED',
  'WATER_PRISON',
];

export const GLOBAL_TIMED_STATUS_TYPES: string[] = [
  'INVUL',
  'BKB',
  'ETHEREAL',
  'SYNERGY_SLACKING',
  'TING_DEFIANCE',
  'TOKUSATSU_DEFIANCE',
  'OWL_FORM_DEFEAT',
  'OWL_FORM_SORROW',
  'OWL_RIVER_MARK',
  'OWL_EAR_GUARD',
  'OWL_SPECTER_LOCK',
  'OWL_SPALTER_LOCK',
  'OWL_SPALTER_DOLL',
  'OWL_ENJOYING',
  'OWL_DRAGON_SLOW',
];

export const TRIGGER_TIMED_STATUS_TYPES: string[] = [
  'AIM',
  'COUNTER',
  'SPELL_BLOCK',
  'VALO_HOLDING_ANGLE',
  'WAIT_COUNTER',
];

export const COUNTER_STANCE_STATUS_TYPES: string[] = [
  'CTR_CHARM',
  'CTR_STUN',
  'CTR_DRAIN',
  'CTR_POISON',
  'CTR_BURN',
  'CTR_FREEZE',
  'CTR_VOID',
  'CTR_WEAK',
  'CTR_CONFUSE',
  'CTR_EXECUTE',
];

export const PERMANENT_STATUS_TYPES: string[] = [
  'LIQUID_BODY',
  'PUPPET_MASTER',
  'WT_ERA',
  'EMOTE_OWNER_BONUS',
  'YUZU_BARRIER',
  'YUZU_MARKED',
  'ORIGINIUM_DISEASE',
  'PURUISAISHI_SHIELD',
  'OWL_FORM_VICTORY',
  'OWL_FORM_PRIDE',
  'OWL_ACID_FEARLESS',
  'OWL_IMPERIAL_SEAL',
  'OWL_WILD',
];

export const PERMANENT_STATUS_PREFIXES: string[] = [
  'PLUG_',
  'STYLE_',
];

export const SLACKING_AWAY_STATUS_TYPES: string[] = [
  'SYNERGY_SLACKING',
  'INVUL',
  'STUN',
  'BKB',
  'SPELL_BLOCK',
];

export const SLACKING_RETURN_PROTECTION_STATUS_TYPES: string[] = [
  'INVUL',
  'STUN',
  'BKB',
  'SPELL_BLOCK',
];

export const REVIVE_CLEAN_STATUS_TYPES: string[] = [
  ...COMMON_NEGATIVE_STATUS_TYPES,
  'WATER_PRISON',
  'WT_SUPPRESS',
  'WT_AIRBORNE',
  'AIRBORNE',
  'WT_REPAIRING',
  'WT_BREECH_DAMAGED',
  'WT_TRACK_DAMAGED',
  'WT_AMMO_EXPOSED',
  'WT_SCOUTED',
  'VALO_CYPHER_REVEALED',
  'BABY_WEAKNESS_MARK',
  'NO_HEAL',
  'WEAK',
  'ZEROED',
  'BLEED',
  'YUZU_EVADE_DOWN',
  'YUZU_DEF_DOWN',
  'YUZU_RES_DOWN',
  'YUZU_ATK_DOWN',
  'YUZU_SLOW',
  'YUZU_TAUNT',
  'YUZU_MARKED',
  'OWL_EVADE_DOWN',
  'OWL_DRAGON_SLOW',
  'OWL_RIVER_MARK',
];

export function isStatusType(type: string, statusTypes: readonly string[]): boolean {
  return statusTypes.includes(type);
}

export function shouldTrackStatusApplier(type: string): boolean {
  return isStatusType(type, CONTROL_STATUS_TYPES) ||
    isStatusType(type, DOT_STATUS_TYPES) ||
    isStatusType(type, COMMON_NEGATIVE_STATUS_TYPES);
}

export function getStatusTickMode(type: string): StatusTickMode {
  if (PERMANENT_STATUS_PREFIXES.some((prefix) => type.startsWith(prefix))) return 'permanent';
  if (isStatusType(type, PERMANENT_STATUS_TYPES)) return 'permanent';
  if (isStatusType(type, TRIGGER_TIMED_STATUS_TYPES)) return 'trigger';
  if (isStatusType(type, GLOBAL_TIMED_STATUS_TYPES)) return 'global';
  return 'self';
}
