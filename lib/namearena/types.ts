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

export type StatusTickMode = 'self' | 'global' | 'trigger' | 'permanent';
export type StatusExpiryPoint = 'self_turn_end' | 'global_action_end' | 'trigger' | 'never';

// ---------------------------------------------------------------------------
// Status effect entry stored in fighter.status[]
// The `type` is kept as `string` because the engine uses dynamic prefixes:
// STYLE_*, CTR_*, PLUG_*  — a union would be exhaustively large.
// ---------------------------------------------------------------------------
export interface StatusEntry {
  type: string;
  /**
   * Legacy compatibility mirror. New code should read remainingTurns/charges
   * according to tickMode instead of assuming this number always means turns.
   */
  duration: number;
  /** Remaining owner/global turns for time-limited effects. */
  remainingTurns?: number;
  /** Remaining activations for consumable effects such as spell block. */
  charges?: number;
  /** Explicit lifecycle semantics, derived from the status profile when absent. */
  tickMode?: StatusTickMode;
  expiresOn?: StatusExpiryPoint;
  /**
   * Flavor/mechanical source for defensive statuses such as SPELL_BLOCK,
   * BKB and INVUL. This keeps combat logs from calling every shield
   * "Linken" or every control immunity "BKB".
   */
  sourceId?: string;
  /** Engine turn when a globally-timed status was first observed. */
  appliedTurn?: number;
  /** Optional display metadata for generated temporary effects. */
  displayName?: string;
  displayIcon?: string;
  displayDesc?: string;
  /** Links a visible status to its reversible stat modifier. */
  modifierId?: string;
}

// ---------------------------------------------------------------------------
// Per-fighter match statistics
// ---------------------------------------------------------------------------
export interface FighterStats {
  kills: number;
  /** Effective HP + shield damage credited by the central damage ledger. */
  dmgDealt: number;
  /** Effective HP damage received. */
  dmgTaken: number;
  hpDmgDealt?: number;
  shieldDmgDealt?: number;
  hpDmgTaken?: number;
  shieldDmgTaken?: number;
  overkillDmg?: number;
  damageInstances?: number;
}

export type DamageResolutionOutcome =
  | 'hp_damage'
  | 'shielded'
  | 'invulnerable'
  | 'spell_blocked'
  | 'redistributed'
  | 'redirected'
  | 'lockblood'
  | 'prevented';

export interface DamageResolutionRecord {
  attempted: number;
  hpDamage: number;
  shieldDamage: number;
  overkillDamage: number;
  outcome: DamageResolutionOutcome;
  source: string;
  attackerId?: string;
  targetId: string;
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
  redirectedJokerDamage?: number;
  redirectedByOriginiumCore?: boolean;
  redirectedOriginiumDamage?: number;
  targetDefeatedDuringDamage?: boolean;
  /** A cleansing death-save consumed this hit, so its post-hit hostile statuses must not be re-applied. */
  suppressOnHitStatuses?: boolean;
  /** Defaults to true. Set false for mechanical self/team redistribution. */
  creditAttacker?: boolean;
  /** Filled by the damage pipeline for callers that need exact settlement data. */
  resolution?: DamageResolutionRecord;
}

export interface StatusApplicationOptions {
  sourceId?: string;
  effectName?: string;
  logBlocked?: boolean;
}

export interface PendingDamageEvent {
  type: string;
  text: string;
  metadata?: BattleLogMetadata;
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

export interface TimedStatModifier {
  id: string;
  statusType: string;
  statusSourceId?: string;
  multipliers: Partial<Record<StatKey, number>>;
  critBonus: number;
}

export interface TimedStatBase extends BaseStats {
  critRate: number;
}

export interface LargeRoundState {
  number: number;
  startedTurn: number;
  participantIds: string[];
  actedIds: string[];
  /** Normal scheduled actions taken in this large round, including bonus/summon actions. */
  actionCount: number;
}

export interface BattleState {
  schemaVersion: 1;
  seed: number;
  rngState: number;
  turnCount: number;
  eventSequence: number;
  actionSequence: number;
  largeRound: LargeRoundState;
  /** Set only during the action that closed this round, then consumed at round end. */
  completedLargeRound?: number;
}

export type BattleEventKind =
  | 'log'
  | 'action_start'
  | 'action_end'
  | 'damage'
  | 'defeat'
  | 'status'
  | 'round';

/** Visual weight of an action. UI effects must consume this field instead of guessing from log text. */
export type SkillPresentation = 'basic' | 'skill' | 'finisher';

export type BattleCombatEffectId =
  | 'gacha_blue_sky'
  | 'gacha_qiqi'
  | 'gacha_fake_seal'
  | 'gacha_pot_shard'
  | 'gacha_debate_club'
  | 'gacha_shipwreck'
  | 'gacha_pot_of_greed'
  | 'gacha_whale_rewrite'
  | 'gacha_summon_lifesteal'
  | 'gacha_ten_pull_gold'
  | 'gacha_ceiling_exchange'
  | 'gacha_ash_blossom'
  | 'gacha_mirror_force'
  | 'gacha_monster_reborn'
  | 'gacha_black_lotus'
  | 'gacha_summon_command'
  | 'gacha_all_out_attack'
  | 'gacha_tribute_prep'
  | 'gacha_summon_recycle'
  | 'gacha_exodia_piece'
  | 'gacha_small_pity'
  | 'gacha_major_pity'
  | 'gacha_luck_gain'
  | 'gacha_instant_action'
  | 'gacha_death_save'
  | 'gacha_lifesteal_proc'
  | 'gacha_guard_trap'
  | 'gacha_summon_guard'
  | 'gacha_blue_eyes_burst'
  | 'gacha_true_light'
  | 'gacha_ancient_chant'
  | 'gacha_blaze_cannon'
  | 'gacha_ra_phoenix'
  | 'gacha_ra_tribute'
  | 'summon_zhongli_geo'
  | 'summon_saber_slash'
  | 'summon_sam_drive'
  | 'summon_bahamut_flare'
  | 'summon_emrakul_void'
  | 'summon_surtr_laeva'
  | 'summon_svarog_barrage'
  | 'summon_blue_eyes_burst'
  | 'summon_blue_eyes_sweep'
  | 'summon_blue_eyes_roar'
  | 'summon_ultimate_burst'
  | 'summon_triple_heads'
  | 'summon_ra_flare'
  | 'summon_ra_pressure'
  | 'summon_ra_rebirth'
  | 'summon_ra_guard'
  | 'summon_blue_eyes_guard'
  | 'summon_ultimate_guard'
  | 'summon_exodia_guard'
  | 'summon_exodia_blast'
  | 'summon_exodia_chains'
  | 'summon_exodia_obliterate';

export interface BattleFormIdentity {
  jobKey: string;
  jobName: string;
  icon: string;
  phase: number;
}

export type SummonCinematicKind = 'reveal' | 'tribute' | 'fusion' | 'exodia';

export type BattleVisualCue =
  | {
      kind: 'transformation';
      fighterId: string;
      fighterName: string;
      from: BattleFormIdentity;
      to: BattleFormIdentity;
    }
  | {
      kind: 'summon_card';
      summonKind: SummonCinematicKind;
      summonerId: string;
      summonId: string;
      summonName: string;
      materials: string[];
      /** Reserved for the future card art supplied by the site owner. */
      cardImage?: string;
    }
  | {
      kind: 'combat_fx';
      effectId: BattleCombatEffectId;
      sourceId: string;
      targetIds: string[];
      links?: Array<{ sourceId: string; targetId: string }>;
      label?: string;
      count?: number;
    };

export type BattleLogMetadata = Partial<Pick<BattleEvent, 'targetIds' | 'visualCue' | 'displayInFeed'>>;

export interface BattleEvent {
  id: string;
  sequence: number;
  kind: BattleEventKind;
  visible: boolean;
  type: string;
  text: string;
  turn: number;
  largeRound: number;
  seed: number;
  actionId?: string;
  actorId?: string;
  actorName?: string;
  targetIds?: string[];
  skillId?: string | null;
  skillName?: string;
  presentation?: SkillPresentation;
  /** False for a state checkpoint consumed by playback but omitted from visible battle logs. */
  displayInFeed?: boolean;
  triggerDepth?: number;
  damage?: DamageResolutionRecord;
  visualCue?: BattleVisualCue;
}

export type BattleLogEntry = BattleEvent & { visible: true };

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
  isYuzu?: boolean;        // 柚子（镜世界的食指父辈）
  isSummon?: boolean;      // Summoned unit
  isAdvancedSummon?: boolean;
  isSon?: boolean;         // Water god's son
  summonerId?: string;
  summonBaseName?: string;
  isNpc?: boolean;         // Non-player battlefield event unit
  cannotWin?: boolean;     // Active unit that must not count as a winner/team for end condition
  cannotAct?: boolean;     // Active unit that should never be picked by the normal action scheduler

  // ── Puruisaishi / originium battlefield-event system ────────────────
  isPuruisaishi?: boolean;
  isOriginiumCore?: boolean;
  isOriginiumCrystal?: boolean;
  puruisaishiPhase?: number;
  puruisaishiEnteredTurn?: number;
  puruisaishiPhaseTwoStartedTurn?: number;
  puruisaishiLastPhaseTwoPulseTurn?: number;
  puruisaishiAppeared?: boolean;
  puruisaishiShield?: number;
  untargetableUntilTurn?: number;
  originiumParentId?: string;
  originiumSpawnTurn?: number;
  originiumSpawnLargeRound?: number;
  originiumLastGrowthTurn?: number;
  originiumGrowthRoundActorIds?: string[];
  originiumWasAttackedTurn?: number;
  originiumWasAttackedThisGrowthRound?: boolean;
  originiumInfectionStacks?: number;
  originiumStatMultipliers?: Pick<BaseStats, 'atk' | 'def' | 'res'> & { maxHp: number };

  // ── Battle-round state ─────────────────────────────────────────────────
  transformed?: boolean;
  isActing?: boolean;
  isHit?: boolean;
  defeatHooksResolved?: boolean;
  lastDamage?: LastDamageRecord;
  pendingDamageEvents?: PendingDamageEvent[];
  timedStatBase?: TimedStatBase;
  timedStatModifiers?: TimedStatModifier[];

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
  /** Gameplay-only recognition debt; never mutates settlement kill statistics. */
  emoteClaimedKills?: number;

  // ── Yuzu / mirror-world weapon and shield system ──────────────────────
  yuzuPhase?: number;
  yuzuShield?: number;
  yuzuOpeningShieldApplied?: boolean;
  yuzuMarkedTargetId?: string;
  yuzuMarkedHitCount?: number;
  yuzuFuriosoCountedTurn?: number;
  yuzuFuriosoReady?: boolean;
  yuzuLastWeapon?: string;

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
  turnCount: number;
  largeRound: number;
  log: (type: string, text: string, metadata?: BattleLogMetadata) => void;
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
  applyStatus: (
    target: Fighter,
    type: string,
    duration: number,
    options?: StatusApplicationOptions,
  ) => boolean;
  handleWaitCounter?: (target: Fighter, user: Fighter, actionName?: string) => boolean;
  handleCounterStatus?: (target: Fighter, user: Fighter) => boolean;
  flushDeferredDamageEvents?: () => void;
  queuePreResolutionLog?: (type: string, text: string) => void;
  /** Whether the current primary target had already entered phase 2 before this skill's damage landed. */
  targetWasTransformedBeforeDamage?: boolean;
  /** The primary hit was absorbed by Ananna's crystal network instead of landing on Ananna. */
  damageRedirectedByOriginiumCore?: boolean;
  /** Total damage resolved across originium crystals for the redirected primary hit. */
  redirectedOriginiumDamage?: number;
  /** Settlement result for the most recent hit in this skill context. */
  suppressOnHitStatuses?: boolean;
  suppressOnHitStatusTargetId?: string;
  /** The primary target was defeated during this action, even if a hook immediately revived it. */
  targetDefeatedDuringAction?: boolean;
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
  visualEffect?: BattleCombatEffectId;
  tag?: SkillTag;
  mult?: number;
  hits?: number;
  ignoreDef?: boolean;
  minDamagePct?: number;
  lifesteal?: number;
  status?: string;
  statusSource?: string;
  /** Attack skills default to affecting the target; set to user for post-attack self buffs. */
  statusTarget?: 'target' | 'user';
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
  /** Default skills are blocked before casting; custom multi-hit skills resolve each impact themselves. */
  spellBlockMode?: 'precast' | 'afterSetup' | 'perHit';
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
  visualEffect?: BattleCombatEffectId;
  /** Defaults to `skill`; basic attacks are represented by a null skill id. */
  presentation?: Exclude<SkillPresentation, 'basic'>;
  rate?: number;
  mult?: number;
  hits?: number;
  ignoreDef?: boolean;
  minDamagePct?: number;
  lifesteal?: number;
  status?: string;
  statusSource?: string;
  /** Attack skills default to affecting the target; set to user for post-attack self buffs. */
  statusTarget?: 'target' | 'user';
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
  /** Default skills are blocked before casting; custom multi-hit skills resolve each impact themselves. */
  spellBlockMode?: 'precast' | 'afterSetup' | 'perHit';
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
