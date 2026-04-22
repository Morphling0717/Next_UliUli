/**
 * DGP TypeScript 类型定义。
 * 参照 legacy lib/dgp/*.js 的运行时对象形状整理。
 * 设计上与 namearena 的 `Fighter = any` 同风格保守：
 * 为了避免破坏原始游戏行为，复杂联合字段使用 string / 可选字段。
 */

// ===============================================================
// Buckle（带扣）技能
// ===============================================================
export interface BuckleEffect {
  type: string;
  duration?: number;
  chance?: number;
}

export interface BuckleSelfBuff {
  type: string;
  duration?: number;
  hpScale?: number;
}

export interface BuckleSummon {
  id: string;
  name: string;
  inheritStats?: number;
  duration: number;
}

export interface BuckleSkill {
  name: string;
  type: 'attack' | 'tactical' | 'ultimate' | 'dual_ultimate' | string;
  cd: number;
  dmg: number;
  hits?: number;
  aoe?: boolean;
  maxTargets?: number;
  magic?: boolean;
  trueDmg?: boolean;
  ignoreDef?: number;
  ignoreShield?: boolean;
  randomTargets?: boolean;
  alwaysHit?: boolean;
  alwaysCrit?: boolean;
  lifesteal?: number;
  selfHeal?: boolean;
  healIntMult?: number;
  shield?: boolean;
  hpScale?: number;
  removeBoost?: boolean;
  dispelBuffs?: boolean;
  effect?: BuckleEffect;
  selfBuff?: BuckleSelfBuff;
  summon?: BuckleSummon;
  cond?: string;
  condMult?: number;
  target?: 'lowest_hp' | string;
  ignoreFront?: boolean;
  mode?: 'Jet' | 'Cannon' | string;
  tags?: string[];
  isWeaponSlotSkill?: boolean;
  isBoostDual?: boolean;
  isFeverDual?: boolean;
  isJackpot?: boolean;
  isHyperGrandVictory?: boolean;
  isTrueFeverBoost?: boolean;
  feverBoostPenalty?: boolean;
  dynamicMagnumJackpot?: boolean;
  b1Name?: string;
  b2Name?: string;
  selfDamage?: number;
  bonusCharge?: number;
}

export interface BuckleWeapon {
  name: string;
  type: string;
}

export interface BuckleDef {
  id: string;
  name: string;
  formName?: string;
  tier: 'base' | 'small' | 'large' | 'legendary' | 'mythic';
  hp: number;
  atk: number;
  tags: string[];
  pref: { str?: number; agi?: number; int?: number };
  weapon?: BuckleWeapon;
  skills: BuckleSkill[];
}

export type BuckleMap = Record<string, BuckleDef>;

// ===============================================================
// ID 核心（身份核心）
// ===============================================================
export interface IdCore {
  id: string;
  icon: string;
  name: string;
  affinity: string;
  passive: string;
  passiveName: string;
  passiveDesc?: string;
  desc?: string;
}

// ===============================================================
// 邪魔徒
// ===============================================================
export interface JyamatoTemplate {
  id: string;
  name: string;
  hp: number;
  atk: number;
  icon: string;
  tier: 'normal' | 'elite' | 'boss';
  str: number;
  agi: number;
  int: number;
  skills: BuckleSkill[];
}

export interface Supporter {
  id: string;
  name: string;
  targetBuckle: string;
  icon: string;
}

export interface SecretMission {
  id: string;
  name: string;
  desc: string;
  condition: (player: Player) => boolean;
}

export interface StageDef {
  id: string;
  name: string;
  type: 'safe' | 'danger' | 'chaos';
  startLog: string;
}

// ===============================================================
// 玩家 / 单位（骑士 / 邪魔徒 / 分身都共用此结构）
// ===============================================================
export interface PlayerBuff {
  type: string;
  duration: number;
  sourceId?: string | null;
}

export interface Player {
  id: string;
  name: string;
  icon: string;
  idCore: IdCore;

  isJyamato: boolean;
  isClone?: boolean;
  jyamatoTier?: 'normal' | 'elite' | 'boss';
  ownerId?: string;
  cloneDuration?: number;

  str: number;
  agi: number;
  int: number;
  baseHp: number;
  maxHp: number;
  hp: number;
  baseAtk: number;
  atk: number;

  buckles: BuckleDef[];
  skills?: BuckleSkill[];
  status: 'alive' | 'eliminated' | string;
  kills: number;
  feverSlot: BuckleDef | null;
  inventory: BuckleDef | null;
  buffs: PlayerBuff[];
  cooldowns: Record<string, number>;
  shield: number;
  isBountyTarget: boolean;

  // Command Raising / Twin 相关
  commandCharges?: number;
  commandMode?: 'Jet' | 'Cannon';

  // 一轮中的瞬态标记（不屈等）
  isUndeadActiveThisTurn?: boolean;
  undeadCheckedThisTurn?: boolean;

  // Fever 摇奖相关
  feverRollCd?: number;
  jackpotBurstReady?: boolean;

  // 待移除标记
  toBeRemoved?: boolean;
}

// ===============================================================
// 战斗日志条目
// ===============================================================
export interface DgpLogEntry {
  round: number;
  text?: string;
  htmlText?: string;
  type: string;
  delay?: number;
  extraReadTime?: number;
  actorId?: string | null;
  targetIds?: string[];
  activeStage?: StageDef | null;
  snapshot?: Player[];
  isGameOver?: boolean;
  winner?: Player | null;
}

export interface ActiveAction {
  actorId: string | null;
  targetIds: string[];
}
