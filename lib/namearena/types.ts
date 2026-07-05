/**
 * Shared type definitions for the NameArena battle system.
 * All game logic files import from here — no @ts-nocheck, no `any`.
 */

// ---------------------------------------------------------------------------
// Skill tag values (mirror SKILL_TAGS const in data.ts)
// ---------------------------------------------------------------------------
export type SkillTag =
  | 'physical'
  | 'magical'
  | 'heal'
  | 'buff'
  | 'debuff'
  | 'special';

// ---------------------------------------------------------------------------
// Stat keys — the numeric combat attributes shared by Fighter and StatBuff
// ---------------------------------------------------------------------------
export type StatKey = 'atk' | 'def' | 'spd' | 'agl' | 'mag' | 'res' | 'wis';

// ---------------------------------------------------------------------------
// Status effect entry stored in fighter.status[]
// The `type` is kept as `string` because the engine uses dynamic prefixes:
// STYLE_*, CTR_*, PLUG_*  — a union would be exhaustively large.
// ---------------------------------------------------------------------------
export interface StatusEntry {
  type: string;
  duration: number;
  /**
   * Flavor/mechanical source for defensive statuses such as SPELL_BLOCK,
   * BKB and INVUL. This keeps combat logs from calling every shield
   * "Linken" or every control immunity "BKB".
   */
  sourceId?: string;
  /** Engine turn when a globally-timed status was first observed. */
  appliedTurn?: number;
}

// ---------------------------------------------------------------------------
// Per-fighter match statistics
// ---------------------------------------------------------------------------
export interface FighterStats {
  kills: number;
  dmgDealt: number;
  dmgTaken: number;
}

export interface LastDamageRecord {
  amount: number;
  source: string;
  sourceLabel: string;
  attackerId?: string;
  attackerName?: string;
  turn: number;
}

export interface DamageApplicationOptions {
  deferTransform?: boolean;
  actionName?: string;
  respectDefenses?: boolean;
  canTriggerWaitCounter?: boolean;
  redirectedByJoker?: boolean;
  targetDefeatedDuringDamage?: boolean;
}

export interface PendingDamageEvent {
  type: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Job / class definition loaded from namerenaJobs
// ---------------------------------------------------------------------------
export interface JobDefinition {
  name: string;
  icon: string;
  /** Multipliers applied to base stats during fighter creation */
  hp: number;
  atk: number;
  def: number;
  spd: number;
  agl: number;
  mag: number;
  res: number;
  wis: number;
  skills: string[];
}

// ---------------------------------------------------------------------------
// Snapshot of numeric combat stats (used for save/restore)
// ---------------------------------------------------------------------------
export interface BaseStats {
  atk: number;
  def: number;
  res: number;
  mag: number;
  spd: number;
  wis: number;
  agl: number;
}

// ---------------------------------------------------------------------------
// Fighter — a participant in a battle round
// ---------------------------------------------------------------------------
export interface Fighter {
  id: string;
  name: string;
  /** Full display name including team suffix, e.g. "水人@红队". Summons use name as fallback. */
  displayName?: string;
  job: string;
  jobData: JobDefinition;
  maxHp: number;
  currentHp: number;
  hpPct: number;
  atk: number;
  def: number;
  spd: number;
  agl: number;
  mag: number;
  res: number;
  wis: number;
  critRate: number;
  color: string;
  isDead: boolean;
  isDeadAnnounced: boolean;
  status: StatusEntry[];
  stats: FighterStats;
  teamId?: string;

  // ── Character archetype flags ──────────────────────────────────────────
  isMorphling?: boolean;   // Water god (史莱姆)
  isJoker?: boolean;       // Joke king (乐子人)
  isTokusatsu?: boolean;   // Toku fan (刺猬人)
  isGacha?: boolean;       // Gacha addict (牢鳄)
  isTing?: boolean;        // 小汀
  isSuccubus?: boolean;    // Succubus (克蕾儿)
  isSigua?: boolean;       // 丝瓜uli
  isTuJuanJuan?: boolean;  // 兔卷卷
  isWT?: boolean;          // War Thunder player (战雷军迷)
  isGamer?: boolean;       // High-end gamer (玄凝)
  isEmote?: boolean;       // 表情（四处认主型魔虚罗）
  isSummon?: boolean;      // Summoned unit
  isAdvancedSummon?: boolean;
  isSon?: boolean;         // Water god's son
  summonerId?: string;
  summonBaseName?: string;

  // ── Battle-round state ─────────────────────────────────────────────────
  transformed?: boolean;
  isActing?: boolean;
  isHit?: boolean;
  defeatHooksResolved?: boolean;
  lastDamage?: LastDamageRecord;
  pendingDamageEvents?: PendingDamageEvent[];

  // ── Joker resurrection ─────────────────────────────────────────────────
  hasResurrected?: boolean;
  reviveTurns?: number;

  // ── Spinal sword (小汀 drop mechanic) ─────────────────────────────────
  hasSpinalSword?: boolean;
  spinalSwordTurns?: number;
  hasDroppedSword?: boolean;
  hasTriggeredTingDefiance?: boolean;

  // ── Gamer death / water-team resurrection ─────────────────────────────
  resurrected?: boolean;
  apm?: number;
  gamerLastSkillType?: string;
  gamerMastery?: number;
  gamerBoostReady?: boolean;
  gamerInputBuffer?: number;
  gamerMarkedTargetId?: string;
  gamerClutchWindow?: number;
  gamerDamageRewardTurn?: number;
  gamerHeavyHitRewardTurn?: number;
  gamerInstantActionQueued?: boolean;
  hasUsedGamerWorldStage?: boolean;
  hasUsedGamerChampionCombo?: boolean;
  hasUsedGamerTransformAction?: boolean;

  // ── Gacha addict / Luck Emperor pity system ───────────────────────────
  gachaLuck?: number;
  gachaInstantActionQueued?: boolean;
  gachaPityPower?: number;
  gachaTingGuardTrapReady?: boolean;
  hasUsedGachaDeathSave?: boolean;
  gachaSummonLifestealPct?: number;
  exodiaPieces?: string[];
  hasUsedExodiaObliterate?: boolean;
  hasUsedExodiaGuard?: boolean;
  hasUsedRaPhoenix?: boolean;
  hasUsedRaTingGuard?: boolean;
  raChantBoost?: number;
  blueEyesUltimateStrain?: number;
  blueEyesUltimateGuardCount?: number;

  // ── Chimera / Succubus ultimate evolution ─────────────────────────────
  hasUltimateEvolved?: boolean;
  chimeraMilestoneLevel?: number;
  chimeraInstantActionQueued?: boolean;

  // ── Tokusatsu (Bujin) counter state ───────────────────────────────────
  counterUsed?: boolean;
  hasUsedGreatMonsterVictory?: boolean;
  hasUsedRainbowFever?: boolean;
  hasUsedTokusatsuDefiance?: boolean;
  tokusatsuInstantActionQueued?: boolean;
  tokusatsuThroneResonance?: number;
  monsterTurns?: number;
  savedStats?: BaseStats;

  // ── Valorant Junior economy (丝瓜 2nd stage) ──────────────────────────
  ultPoints?: number;
  economy?: number;
  crosshairFocus?: number;
  valoInstantActionQueued?: boolean;
  hasUsedValoRunItBack?: boolean;
  savedSpd?: number;
  savedAgl?: number;

  // ── War Thunder vehicle / spawn-point system (M1) ─────────────────────
  wtSpawnPoints?: number;
  wtFpeCharges?: number;
  wtNbcsCharges?: number;
  wtBackupUsed?: boolean;
  wtMarkedTargetId?: string;
  wtKillStreak?: number;

  // ── Emote / Mahoraga adaptation-recognition system ────────────────────
  emoteDeathCount?: number;
  emoteReviveTurns?: number;
  emoteReviveAppliedTurn?: number;
  emoteAdaptStats?: Partial<Record<StatKey | 'maxHp', number>>;
  emoteOwnerId?: string;
  emoteOwnerBonus?: Partial<Record<StatKey | 'maxHp', number>>;
  emoteFamiliarTargetId?: string;
  emoteFinalDead?: boolean;
  emoteFinalChallengeUsed?: boolean;

  // ── Slacking synergy (丝瓜 + 兔卷卷 bond) ────────────────────────────
  willSlackThisGame?: boolean;
  hasTriggeredSlacking?: boolean;
  wasSynergySlacking?: boolean;

  // ── TuJuanJuan style-switch system ───────────────────────────────────
  styleTurnCounter?: number;
  baseStatsForStyle?: BaseStats;

  // ── Zero state (归零 debuff) ──────────────────────────────────────────
  wasZeroed?: boolean;
  baseStatsForZero?: Pick<BaseStats, 'atk' | 'def' | 'res'>;

  // Fallback legacy field used in one dead-code branch (never actually read)
  team?: string;
}

// ---------------------------------------------------------------------------
// Status effect display info
// ---------------------------------------------------------------------------
export interface StatusEffectInfo {
  name: string;
  icon: string;
  desc: string;
}

export type StatusEffectsMap = Record<string, StatusEffectInfo>;

export interface DefeatOptions {
  message?: string;
  killer?: Fighter;
  logType?: string;
  awardKill?: boolean;
  setHpZero?: boolean;
}

// ---------------------------------------------------------------------------
// Skill execution context — passed into skill onExecute / afterExecute
// ---------------------------------------------------------------------------
export interface SkillContext {
  user: Fighter;
  target: Fighter;
  currentTargets: Fighter[];
  fighters: Fighter[];
  log: (type: string, text: string) => void;
  getTeamId: (f: Fighter) => string;
  applyDamage: (
    target: Fighter,
    amount: number,
    source: string,
    isTrueDamage?: boolean,
    attacker?: Fighter,
    options?: DamageApplicationOptions,
  ) => number;
  markDefeated: (target: Fighter, options?: DefeatOptions) => boolean;
  handleWaitCounter?: (target: Fighter, user: Fighter, actionName?: string) => boolean;
  handleCounterStatus?: (target: Fighter, user: Fighter) => boolean;
  flushDeferredDamageEvents?: () => void;
  queuePreResolutionLog?: (type: string, text: string) => void;
  /** Whether the current primary target had already entered phase 2 before this skill's damage landed. */
  targetWasTransformedBeforeDamage?: boolean;
  triggerDepth: number;
  executeSkillAction: (
    id: string | null,
    user: Fighter,
    target: Fighter | null,
    depth: number,
  ) => void;
  executeSummonSkill: (
    skill: SkillDefinition,
    user: Fighter,
    userTeamId: string,
  ) => void;
  STATUS_EFFECTS: StatusEffectsMap;
  /** @deprecated legacy callback stub — not used at runtime */
  setLogs?: (updater: unknown) => void;
}

// ---------------------------------------------------------------------------
// Optional stats block for summoned units
// ---------------------------------------------------------------------------
export interface SummonStats {
  hp?: number;
  atk?: number;
  def?: number;
  spd?: number;
  agl?: number;
  mag?: number;
  res?: number;
  wis?: number;
}

// ---------------------------------------------------------------------------
// A single entry in a gacha pool.
// Properties spread over SkillDefinition when the pool is drawn.
// ---------------------------------------------------------------------------
export interface GachaEntry {
  text: string;
  tag?: SkillTag;
  mult?: number;
  hits?: number;
  ignoreDef?: boolean;
  minDamagePct?: number;
  lifesteal?: number;
  status?: string;
  statusSource?: string;
  statBuff?: Partial<Record<StatKey | 'crit', number>>;
  cleanStatus?: boolean;
  selfDmgPct?: number;
  selfDmgCanKill?: boolean;
  isSummon?: boolean;
  summonName?: string;
  summonJob?: string;
  stats?: SummonStats;
  unique?: boolean;
  advancedSummon?: boolean;
  tributes?: number;
  triggerAgain?: number;
  newSkill?: string;
  requiresFriendlySummon?: string;
  requiresAnyFriendlySummon?: boolean;
  requiresOrdinarySummon?: boolean;
  requiresBlueEyesFusion?: boolean;
  onExecute?: (ctx: SkillContext) => boolean;
  afterExecute?: (
    ctx: SkillContext,
    dmg: number,
    hpBeforeDamage?: number,
  ) => void;
}

// ---------------------------------------------------------------------------
// Entry in the TuJuanJuan style-switch pool
// ---------------------------------------------------------------------------
export interface StylePoolEntry {
  text: string;
  status: string;
  statBuff?: Partial<Record<StatKey, number>>;
}

// ---------------------------------------------------------------------------
// Skill definition — one entry in the SKILLS record
// ---------------------------------------------------------------------------
export interface SkillDefinition {
  name: string;
  tag: SkillTag;
  rate?: number;
  mult?: number;
  hits?: number;
  ignoreDef?: boolean;
  minDamagePct?: number;
  lifesteal?: number;
  status?: string;
  statusSource?: string;
  statBuff?: Partial<Record<StatKey | 'crit', number>>;
  text?: string;
  /** Pool is GachaEntry[] for isGacha skills, string[] for isRandomText skills */
  pool?: GachaEntry[] | string[];
  isGacha?: boolean;
  isRandomText?: boolean;
  alwaysCrit?: boolean;
  alwaysHit?: boolean;
  cleanStatus?: boolean;
  selfDmgPct?: number;
  selfDmgCanKill?: boolean;
  isSummon?: boolean;
  summonName?: string;
  summonJob?: string;
  stats?: SummonStats;
  unique?: boolean;
  advancedSummon?: boolean;
  tributes?: number;
  triggerAgain?: number;
  newSkill?: string;
  requiresFriendlySummon?: string;
  requiresAnyFriendlySummon?: boolean;
  requiresOrdinarySummon?: boolean;
  requiresBlueEyesFusion?: boolean;
  condition?: (user: Fighter) => boolean;
  onExecute?: (ctx: SkillContext) => boolean;
  afterExecute?: (
    ctx: SkillContext,
    dmg: number,
    hpBeforeDamage?: number,
  ) => void;
}

// ---------------------------------------------------------------------------
// Subset of namerenaData that BattleEngine actually reads
// ---------------------------------------------------------------------------
export interface BattleEngineData {
  STATUS_EFFECTS: StatusEffectsMap;
  SKILL_TAGS: Record<string, string>;
  GACHA_SSR_POOL: GachaEntry[];
  EXODIA_CARD: GachaEntry;
  CHIMERA_PLUGIN_POOL?: GachaEntry[];
  SUCCUBUS_COUNTER_POOL?: GachaEntry[];
}

// ---------------------------------------------------------------------------
// Subset of namerenaCore that BattleEngine actually calls
// ---------------------------------------------------------------------------
export interface BattleEngineCore {
  generateUUID?: () => string;
}

// ---------------------------------------------------------------------------
// Ref object used to track the spinal-sword drop flag across turns
// ---------------------------------------------------------------------------
export interface SpinalSwordRef {
  current: boolean;
}
