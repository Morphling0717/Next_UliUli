import type { BattleLogMetadata, DamageApplicationOptions, DefeatOptions, DispelOptions, DispelResolution, Fighter, JobDefinition, SkillPresentation, SpinalSwordRef, StatusApplication } from '../types';

export interface ReactionActionDescriptor {
  skillId: string;
  skillName: string;
  presentation?: SkillPresentation;
  targets?: readonly Fighter[];
  triggerDepth?: number;
}

export interface CharacterHookRuntime {
  fighters: Fighter[];
  jobs: Partial<Record<string, JobDefinition>>;
  turnCount: number;
  getTeamId: (fighter: Fighter) => string;
  isActiveCombatant: (fighter: Fighter) => boolean;
  log: (type: string, text: string, metadata?: BattleLogMetadata) => void;
  syncHpPct: (fighter: Fighter) => void;
  applyDamage: (
    target: Fighter,
    amount: number,
    source: string,
    isTrueDamage?: boolean,
    attacker?: Fighter,
    options?: DamageApplicationOptions,
  ) => number;
  applyStatus: (target: Fighter, application: StatusApplication) => boolean;
  dispelStatusEffects: (target: Fighter, options: DispelOptions) => DispelResolution;
  markDefeated: (target: Fighter, options?: DefeatOptions) => boolean;
  handleTransformations: (fighter: Fighter) => void;
  flushDeferredDamageEvents: (fighter: Fighter, phase?: 'mitigation' | 'all') => void;
  executeSkillAction: (id: string | null, user: Fighter, target: Fighter | null, depth: number) => void;
  runReactionAction: (actor: Fighter, descriptor: ReactionActionDescriptor, callback: () => void) => void;
  finalizeFighterDeath: (
    fighter: Fighter,
    spinalSwordRef: SpinalSwordRef,
    deathMessage?: string,
    killer?: Fighter,
  ) => void;
}

export interface CharacterTransformContext {
  fighter: Fighter;
  runtime: CharacterHookRuntime;
  transform: (
    jobKey: string,
    message: string,
    applyForm: () => void,
    afterCommit?: () => void,
  ) => void;
}

export interface CharacterDefeatContext {
  fighter: Fighter;
  runtime: CharacterHookRuntime;
  spinalSwordRef: SpinalSwordRef;
}

export interface CharacterDefeatSettledContext {
  fighter: Fighter;
  runtime: CharacterHookRuntime;
  killer?: Fighter;
}

export interface CharacterWinPreventionContext {
  fighter: Fighter;
  runtime: CharacterHookRuntime;
  aliveCombatants: Fighter[];
  activeTeams: Set<string>;
}

export interface CharacterReviveContext {
  fighter: Fighter;
  runtime: CharacterHookRuntime;
  spinalSwordRef: SpinalSwordRef;
}

export interface CharacterWaitCounterContext {
  target: Fighter;
  user: Fighter;
  runtime: CharacterHookRuntime;
  triggerDepth: number;
}

export type CharacterSkillSelectionPhase = 'preMechanics' | 'postMechanics';

export interface CharacterSkillSelectionContext {
  actor: Fighter;
  runtime: CharacterHookRuntime;
  phase: CharacterSkillSelectionPhase;
}

export interface CharacterReentryContext {
  runtime: CharacterHookRuntime;
}

export interface CharacterGlobalTickContext {
  runtime: CharacterHookRuntime;
}

export interface CharacterHook {
  id: string;
  selectSkill?: (ctx: CharacterSkillSelectionContext) => string | null;
  onTransformCheck?: (ctx: CharacterTransformContext) => boolean;
  onDefeated?: (ctx: CharacterDefeatContext) => void;
  onDefeatSettled?: (ctx: CharacterDefeatSettledContext) => void;
  shouldPreventWin?: (ctx: CharacterWinPreventionContext) => boolean;
  onReviveCheck?: (ctx: CharacterReviveContext) => boolean;
  onWaitCounter?: (ctx: CharacterWaitCounterContext) => boolean;
  resolveReentry?: (ctx: CharacterReentryContext) => void;
  onGlobalTick?: (ctx: CharacterGlobalTickContext) => void;
}
