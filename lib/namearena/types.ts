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

export type StatusTickMode =
  | 'self_opportunity'
  | 'attack_action'
  | 'global_action'
  | 'large_round'
  | 'trigger'
  | 'permanent';

export type StatusExpiryPoint =
  | 'self_opportunity_end'
  | 'attack_action_end'
  | 'global_action_end'
  | 'large_round_end'
  | 'trigger'
  | 'never';

export type StatusPolarity = 'positive' | 'negative' | 'neutral' | 'independent';
export type StatusDispelTier = 'normal' | 'strong_only' | 'none';
export type StatusStackMode = 'add' | 'multiply' | 'highest' | 'refresh' | 'overwrite' | 'replace' | 'exclusive';
export type StatusCalculationStage =
  | 'resource'
  | 'target_selection'
  | 'hit_check'
  | 'panel_stat'
  | 'effective_stat'
  | 'standard_formula'
  | 'post_formula'
  | 'incoming_post_mitigation'
  | 'barrier'
  | 'aftermath'
  | 'lifecycle';

export type DamageSourceKind =
  | 'standard'
  | 'custom'
  | 'manual'
  | 'counter'
  | 'reflect'
  | 'transfer'
  | 'share'
  | 'status'
  | 'self_cost'
  | 'environment';

export interface StatusAttribution {
  effectSourceId: string;
  effectSourceName?: string;
  applierId?: string;
  applierName?: string;
  creditActorId?: string;
  creditOwnerId?: string;
}

// ---------------------------------------------------------------------------
// Canonical status instance stored in fighter.statuses[].
// Every identity is registered in the status catalog before it can be applied.
// ---------------------------------------------------------------------------
export interface StatusInstance {
  instanceId: string;
  identityId: string;
  mechanicId: string;
  /** Strength of one settlement or modifier. */
  potency?: number;
  /** Remaining settlements for dual-value mechanics. */
  count?: number;
  remainingTurns?: number;
  charges?: number;
  tickMode: StatusTickMode;
  expiresOn: StatusExpiryPoint;
  polarity: StatusPolarity;
  dispelTier: StatusDispelTier;
  stackMode: StatusStackMode;
  calculationStage: StatusCalculationStage;
  attribution: StatusAttribution;
  /** Monotonic per-fighter sequence used to detect refreshes during settlement. */
  appliedSequence: number;
  /** Last global/large-round clock that observed this instance. */
  lastAdvancedAt?: number;
  groupId?: string;
  damageSourceMask?: DamageSourceKind[];
  statScope?: Array<StatKey | 'physical' | 'magical' | 'all' | 'accuracy_only' | 'evasion_only'>;
  barrierInteraction?: 'absorb' | 'bypass';
}

export interface BarrierEntry {
  id: string;
  identityId: string;
  sourceId: string;
  displayName: string;
  icon?: string;
  value: number;
  maxValue: number;
  remainingTurns?: number;
  tickMode: StatusTickMode;
  priority?: number;
  appliedSequence: number;
  /** First global action whose end observed this barrier; prevents same-action expiry. */
  lastAdvancedAt?: number;
  polarity: StatusPolarity;
  dispelTier: StatusDispelTier;
  attribution: StatusAttribution;
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

export interface DamageBarrierAbsorption {
  barrierId: string;
  sourceId: string;
  displayName: string;
  amount: number;
  applierId?: string;
  applierName?: string;
}

export interface DamageResolutionRecord {
  eventId?: string;
  rootEventId?: string;
  attempted: number;
  hpDamage: number;
  shieldDamage: number;
  /** Exact barriers that absorbed this hit, in settlement order. */
  barrierAbsorptions?: DamageBarrierAbsorption[];
  overkillDamage: number;
  outcome: DamageResolutionOutcome;
  source: string;
  sourceKind?: DamageSourceKind;
  /** Original attack kind retained when this record is a transfer/share child. */
  originSourceKind?: DamageSourceKind;
  /** Optional direct-damage school used by scoped output modifiers. */
  damageScope?: 'physical' | 'magical';
  actionName?: string;
  attackerId?: string;
  originalTargetId?: string;
  targetId: string;
  actualTargetId?: string;
  statusHitIndex?: number;
  statusHitCount?: number;
  /** This hit was rewritten by a phase/death lock and must not receive same-hit status aftermath. */
  phaseLockTriggered?: boolean;
  /** Player-facing identity of the lock that rewrote this hit. */
  lockbloodLabel?: string;
  phaseTransition?: boolean;
  defeated?: boolean;
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
  eventId?: string;
  rootEventId?: string;
  originalTargetId?: string;
  sourceKind?: DamageSourceKind;
  /** Original attack kind retained through transfer/share descendants. */
  originSourceKind?: DamageSourceKind;
  damageScope?: 'physical' | 'magical';
  statusHitIndex?: number;
  statusHitCount?: number;
  /** Status damage and redistribution must not recursively trigger aftermath mechanics. */
  suppressStatusAftermath?: boolean;
  deferTransform?: boolean;
  actionName?: string;
  respectDefenses?: boolean;
  canTriggerWaitCounter?: boolean;
  redirectedByJoker?: boolean;
  redirectedJokerDamage?: number;
  redirectedByOriginiumCore?: boolean;
  redirectedOriginiumDamage?: number;
  redirectedByOwlEmperor?: boolean;
  redirectedOwlEmperorDamage?: number;
  redirectedByMomo?: boolean;
  redirectedMomoDamage?: number;
  /** Captains that actually received a |OMO share during this hit. */
  redirectedMomoTargetIds?: string[];
  /** Captains defeated while settling this |OMO share. */
  redirectedMomoDefeatedTargetIds?: string[];
  /** Part or all of the hit was distributed to Yuzu's teammates through mirror sharing. */
  redirectedByYuzu?: boolean;
  /** Total HP damage actually suffered by Yuzu's teammates. */
  redirectedYuzuDamage?: number;
  redirectedYuzuTargetIds?: string[];
  redirectedYuzuDefeatedTargetIds?: string[];
  /** Internal guard used while damage is already being paid by 帝王之征. */
  bypassOwlEmperorRedirect?: boolean;
  /** Mechanical costs and copied damage must not recursively create 过江协同. */
  suppressOwlCooperation?: boolean;
  /** Mechanical self-costs do not receive 鸮's offensive form multiplier. */
  bypassOwlOutgoingModifier?: boolean;
  /** Fixed self-costs do not receive 鸮's defensive form multiplier. */
  bypassOwlIncomingModifier?: boolean;
  /** Mechanical self-costs must reduce HP directly instead of consuming shared shields. */
  bypassShields?: boolean;
  /** Filled by the barrier pipeline for causal logs, replay and attribution. */
  barrierAbsorptions?: DamageBarrierAbsorption[];
  targetDefeatedDuringDamage?: boolean;
  /** The hit was capped to preserve a phase or scripted death-save boundary. */
  phaseLockTriggered?: boolean;
  /** Player-facing identity of the phase or death-save boundary. */
  lockbloodLabel?: string;
  /** A cleansing death-save consumed this hit, so its post-hit hostile statuses must not be re-applied. */
  suppressOnHitStatuses?: boolean;
  /** Defaults to true. Set false for mechanical self/team redistribution. */
  creditAttacker?: boolean;
  /** Filled by the damage pipeline for callers that need exact settlement data. */
  resolution?: DamageResolutionRecord;
}

export interface StatusApplication {
  identityId: string;
  effectName?: string;
  logBlocked?: boolean;
  potency?: number;
  /** Per-mechanic strength overrides for composite identities. */
  componentPotencies?: Readonly<Record<string, number>>;
  count?: number;
  charges?: number;
  remainingTurns?: number;
  groupId?: string;
  attribution?: Partial<StatusAttribution>;
  observedAt?: {
    globalAction?: number;
    largeRound?: number;
  };
  /** Callers that emit a domain-specific log may suppress the generic application log. */
  silent?: boolean;
}

export type SkillEffectTarget = 'target' | 'user';

export interface SkillStatusApplication extends Omit<StatusApplication, 'silent'> {
  target?: SkillEffectTarget;
}

export interface SkillBarrierApplication {
  target?: SkillEffectTarget;
  identityId?: string;
  value: number;
  sourceId: string;
  displayName: string;
  icon?: string;
  remainingTurns?: number;
  tickMode?: StatusTickMode;
  priority?: number;
  polarity?: StatusPolarity;
  dispelTier?: StatusDispelTier;
  stackMode?: 'add' | 'refresh' | 'overwrite';
  attribution?: Partial<StatusAttribution>;
}

export interface SkillDispelSpec {
  strength: DispelStrength;
  direction: DispelDirection;
  target?: 'user' | 'target' | 'allies';
  timing?: 'before_action' | 'after_damage' | 'after_recovery';
  includeNeutral?: boolean;
  includeIndependent?: boolean;
  identityIds?: readonly string[];
  excludeIdentityIds?: readonly string[];
}

export type StatusRemovalReason =
  | 'expired'
  | 'consumed'
  | 'dispel'
  | 'strong_dispel'
  | 'absolute_dispel'
  | 'replaced'
  | 'death'
  | 'revive'
  | 'scripted';

export type DispelStrength = 'normal' | 'strong' | 'absolute';
export type DispelDirection = 'negative' | 'positive' | 'all';

export interface DispelOptions {
  strength: DispelStrength;
  direction: DispelDirection;
  reason?: StatusRemovalReason;
  includeNeutral?: boolean;
  includeIndependent?: boolean;
  /** Select exact status instances when several sources share one mechanic. */
  instanceIds?: readonly string[];
  identityIds?: readonly string[];
  mechanicIds?: readonly string[];
  excludeIdentityIds?: readonly string[];
  excludeMechanicIds?: readonly string[];
  barrierSourceIds?: readonly string[];
  excludeBarrierSourceIds?: readonly string[];
  includeBarriers?: boolean;
  /** Routes the exact dispel log through the caller's causal/deferred log queue. */
  emitLog?: (type: string, text: string) => void;
}

export interface DispelResolution {
  removed: StatusInstance[];
  blocked: StatusInstance[];
  removedBarriers: BarrierEntry[];
  blockedBarriers: BarrierEntry[];
}

export type HealingKind = 'direct' | 'regen' | 'lifesteal' | 'summon' | 'status';
export type HealingOutcome = 'healed' | 'blocked' | 'full' | 'no_effect';

export interface HealingResolutionRecord {
  attempted: number;
  modified: number;
  actual: number;
  prevented: number;
  outcome: HealingOutcome;
  kind: HealingKind;
  sourceId?: string;
  healerId?: string;
  targetId: string;
}

export interface PendingDamageEvent {
  type: string;
  text: string;
  metadata?: BattleLogMetadata;
  phase?: 'mitigation' | 'aftermath';
  dedupeKey?: string;
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
  | 'ting_blood_rite'
  | 'ting_grudge_rend'
  | 'ting_detonation'
  | 'ting_detonation_charge'
  | 'ting_rage'
  | 'ting_wail'
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
  | 'toku_rainbow_fever'
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

export type FormTransitionCause = 'phase_advance' | 'form_change' | 'revival' | 'redeploy';

export type SummonCinematicKind = 'reveal' | 'tribute' | 'fusion' | 'exodia';

export type BattleVisualCue =
  | {
      kind: 'transformation';
      fighterId: string;
      fighterName: string;
      from: BattleFormIdentity;
      to: BattleFormIdentity;
      cause: FormTransitionCause;
    }
  | {
      kind: 'form_shift';
      fighterId: string;
      fighterName: string;
      from: BattleFormIdentity;
      to: BattleFormIdentity;
      cause: FormTransitionCause;
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
      kind: 'combat_action';
      sourceId: string;
      targetIds: string[];
      presentation: SkillPresentation;
      effectId?: BattleCombatEffectId;
    }
  | {
      kind: 'combat_fx';
      /** Omitted for a structured generic follow-up hit. */
      effectId?: BattleCombatEffectId;
      sourceId: string;
      targetIds: string[];
      links?: Array<{ sourceId: string; targetId: string }>;
      label?: string;
      count?: number;
    }
  | {
      /** A passive/self reaction which may occur outside an actor action. */
      kind: 'reaction_fx';
      effectId: BattleCombatEffectId;
      sourceId: string;
      targetIds: string[];
      label?: string;
      count?: number;
    };

export type BattleLogMetadata = Partial<Pick<BattleEvent,
  | 'actorId'
  | 'actorName'
  | 'targetIds'
  | 'skillId'
  | 'skillName'
  | 'presentation'
  | 'visualCue'
  | 'visualCueId'
  | 'displayInFeed'
>>;

export interface BattleEvent {
  id: string;
  /** Root action/event that owns this entire causal chain. */
  rootEventId: string;
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
  /** Stable exact-once playback key for the attached visual cue. */
  visualCueId?: string;
}

export type BattleLogEntry = BattleEvent & { visible: true };

export type OwlWarForm = 'victory' | 'pride' | 'defeat' | 'sorrow';

export type OwlSummonKind =
  | 'meal'
  | 'rice'
  | 'cricket'
  | 'zhao_adou'
  | 'swire'
  | 'linlang_swire'
  | 'specter'
  | 'spalter'
  | 'emperor';

export interface OwlState {
  phase: 1 | 2 | 3;
  warForm: OwlWarForm;
  warFormStartedTurn: number;
  heavenStacks: number;
  sweepUsed: boolean;
  riverMarkedTargetId?: string;
  riverMarkExpiresTurn?: number;
}

export interface OwlSummonState {
  kind: OwlSummonKind;
  spawnedTurn: number;
  transformAtTurn?: number;
  expiresAtTurn?: number;
  pairId?: string;
  lastAttackerId?: string;
  suicideTriggered?: boolean;
  deathSaveUsed?: boolean;
  lockUntilTurn?: number;
  dollUntilTurn?: number;
  wildStacks?: number;
}

export type MomoTeamMode = 'uninitialized' | 'explicit' | 'dynamic' | 'water';

export interface MomoState {
  phase: 1 | 2 | 3;
  teamMode: MomoTeamMode;
  riderKickCount: number;
  waterDaughter: boolean;
  /** Successful random team selections, including the opening selection. */
  partnerSelectionCount?: number;
  partnerTargetId?: string;
  partnerAnchorId?: string;
  /** Defers random re-teaming until the current damage/death settlement has completed. */
  partnerReselectPending?: boolean;
  dynamicTeamId?: string;
  /** Fighters whose teamId was temporarily changed by random teaming. */
  assignedMemberIds?: string[];
  /** Original team IDs for assigned members; null means there was no team. */
  originalTeamIds?: Record<string, string | null>;
}

export type MomoDragonVariant = 'normal' | 'alternate';

export interface MomoCaptainBonusState {
  amount: number;
  /** False while the captain is temporarily outside the battlefield. */
  active: boolean;
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
  statuses: StatusInstance[];
  /** Monotonic local counters keep status/barrier ids deterministic per fighter. */
  statusSequence?: number;
  barrierSequence?: number;
  barriers?: BarrierEntry[];
  morale?: number;
  maxMorale?: number;
  moraleLostSinceOpportunity?: boolean;
  stagger?: number;
  staggerThreshold?: number;
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
  isOwl?: boolean;         // 鸮（雾隐罅中鸮）
  isMomo?: boolean;        // 萌月沫沫（泡沫之神）
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
  untargetableUntilTurn?: number;
  originiumParentId?: string;
  originiumSpawnTurn?: number;
  originiumSpawnLargeRound?: number;
  originiumLastGrowthTurn?: number;
  originiumLastGrowthLargeRound?: number;
  originiumGrowthRoundActorIds?: string[];
  originiumWasAttackedTurn?: number;
  originiumWasAttackedThisGrowthRound?: boolean;
  puruisaishiLastOverflowLargeRound?: number;

  // ── Battle-round state ─────────────────────────────────────────────────
  transformed?: boolean;
  isActing?: boolean;
  isHit?: boolean;
  /** Transient target override used only while resolving a confused basic attack. */
  confusedForcedTargetId?: string;
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
  hasUsedGamerContinue?: boolean;

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

  // ── Valorant Junior economy (丝瓜 2nd stage) ──────────────────────────
  ultPoints?: number;
  economy?: number;
  crosshairFocus?: number;
  valoInstantActionQueued?: boolean;
  hasUsedValoRunItBack?: boolean;

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
  yuzuOpeningShieldApplied?: boolean;
  /** Preserves temporary FFA teammates after their dynamic team link is removed. */
  yuzuKnownTeammateIds?: string[];
  yuzuMarkedTargetId?: string;
  yuzuMarkedHitCount?: number;
  yuzuFuriosoCountedTurn?: number;
  yuzuFuriosoReady?: boolean;
  yuzuLastWeapon?: string;

  // ── Owl / Heaven-corrosion and dedicated summon system ───────────────
  owlState?: OwlState;
  owlSummonState?: OwlSummonState;

  // ── Momo / Captain, crowd-joy and contract-dragon system ─────────────
  momoState?: MomoState;
  momoDragonVariant?: MomoDragonVariant;
  /** Source-scoped HP bookkeeping keeps captain grants reversible and idempotent. */
  momoCaptainBonuses?: Record<string, MomoCaptainBonusState>;

  // ── Slacking synergy (丝瓜 + 兔卷卷 bond) ────────────────────────────
  willSlackThisGame?: boolean;
  hasTriggeredSlacking?: boolean;
  wasSynergySlacking?: boolean;

  // ── TuJuanJuan style-switch system ───────────────────────────────────
  styleTurnCounter?: number;
  rabbitStyleBaseStats?: Record<StatKey, number>;
}

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
  /** Planned primary-hit damage before the target's mitigation and redirection pipeline. */
  preMitigationDamage?: number;
  targetWasIntercepted?: boolean;
  interceptedProtectedTargetId?: string;
  currentTargets: Fighter[];
  fighters: Fighter[];
  turnCount: number;
  largeRound: number;
  log: (type: string, text: string, metadata?: BattleLogMetadata) => void;
  /** Declares every intended target before the action's first player-visible log is emitted. */
  setVisualTargets: (targets: readonly Fighter[]) => void;
  getTeamId: (f: Fighter) => string;
  /** Reads a combat stat after all active generic stat modifiers. */
  getEffectiveStat: (fighter: Fighter, key: StatKey) => number;
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
    application: StatusApplication,
  ) => boolean;
  dispelStatusEffects: (target: Fighter, options: DispelOptions) => DispelResolution;
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
  /** The primary hit was taken by 帝王之征 instead of landing on 鸮. */
  damageRedirectedByOwlEmperor?: boolean;
  /** Damage actually suffered by 帝王之征 for the redirected primary hit. */
  redirectedOwlEmperorDamage?: number;
  /** The primary hit was distributed to 萌月沫沫's other captains through |OMO. */
  damageRedirectedByMomo?: boolean;
  /** Total HP damage suffered by captains for the redirected primary hit. */
  redirectedMomoDamage?: number;
  redirectedMomoTargetIds?: string[];
  redirectedMomoDefeatedTargetIds?: string[];
  /** The primary hit was distributed to Yuzu's teammates through mirror sharing. */
  damageRedirectedByYuzu?: boolean;
  /** Total HP damage suffered by Yuzu's teammates for the primary hit. */
  redirectedYuzuDamage?: number;
  redirectedYuzuTargetIds?: string[];
  redirectedYuzuDefeatedTargetIds?: string[];
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
  runReactionAction: (
    actor: Fighter,
    descriptor: {
      skillId: string;
      skillName: string;
      presentation?: SkillPresentation;
      targets?: readonly Fighter[];
      triggerDepth?: number;
    },
    callback: () => void,
  ) => void;
  executeSummonSkill: (
    skill: SkillDefinition,
    user: Fighter,
    userTeamId: string,
  ) => void;
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
  statusApplications?: readonly SkillStatusApplication[];
  barrierApplications?: readonly SkillBarrierApplication[];
  dispelSpecs?: readonly SkillDispelSpec[];
  permanentStatMultiplier?: Partial<Record<StatKey | 'crit', number>>;
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
  /** Custom executor resolves one direct target; used by shared hit-opening rules. */
  directTarget?: boolean;
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
  identityId: string;
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
  statusApplications?: readonly SkillStatusApplication[];
  barrierApplications?: readonly SkillBarrierApplication[];
  permanentStatMultiplier?: Partial<Record<StatKey | 'crit', number>>;
  /** Number of status-aftermath settlements represented by one damage event. */
  statusHitCount?: number;
  /** Number of bleed settlements caused by this attack action. Defaults to one. */
  bleedTriggerCount?: number;
  damageSourceKind?: Extract<DamageSourceKind, 'standard' | 'custom' | 'manual'>;
  text?: string;
  /** Pool is GachaEntry[] for isGacha skills, string[] for isRandomText skills */
  pool?: GachaEntry[] | string[];
  /** Visual variants aligned by index with a random-text string pool. */
  randomTextVisualEffects?: BattleCombatEffectId[];
  isGacha?: boolean;
  isRandomText?: boolean;
  alwaysCrit?: boolean;
  alwaysHit?: boolean;
  /** Character-specific formula that still uses the shared targeting/defense pipeline. */
  damageFormula?: (
    user: Fighter,
    target: Fighter,
    fighters: readonly Fighter[],
    getEffectiveStat: (fighter: Fighter, key: StatKey) => number,
  ) => number;
  /** Some deterministic character attacks intentionally cannot roll critical hits. */
  cannotCrit?: boolean;
  /** A targeted utility skill that resolves guards and then applies status without damage. */
  noDamage?: boolean;
  dispelSpecs?: readonly SkillDispelSpec[];
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
  /** Custom executor resolves one direct target; used by shared hit-opening rules. */
  directTarget?: boolean;
  condition?: (user: Fighter) => boolean;
  onExecute?: (ctx: SkillContext) => boolean;
  /** Runs once when an attempted action settles, including block, miss, or counter. */
  onActionSettled?: (ctx: SkillContext) => void;
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
