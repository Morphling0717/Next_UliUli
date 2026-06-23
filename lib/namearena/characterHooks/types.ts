import type { Fighter, JobDefinition, SpinalSwordRef } from '../types';

export interface CharacterHookRuntime {
  fighters: Fighter[];
  jobs: Partial<Record<string, JobDefinition>>;
  getTeamId: (fighter: Fighter) => string;
  isActiveCombatant: (fighter: Fighter) => boolean;
  log: (type: string, text: string) => void;
  syncHpPct: (fighter: Fighter) => void;
  applyDamage: (target: Fighter, amount: number, source: string, isTrueDamage?: boolean) => number;
  executeSkillAction: (id: string | null, user: Fighter, target: Fighter | null, depth: number) => void;
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
  transform: (jobKey: string, message: string, applyStats: () => void) => void;
}

export interface CharacterDefeatContext {
  fighter: Fighter;
  runtime: CharacterHookRuntime;
  spinalSwordRef: SpinalSwordRef;
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

export interface CharacterHook {
  id: string;
  selectSkill?: (ctx: CharacterSkillSelectionContext) => string | null;
  onTransformCheck?: (ctx: CharacterTransformContext) => boolean;
  onDefeated?: (ctx: CharacterDefeatContext) => void;
  shouldPreventWin?: (ctx: CharacterWinPreventionContext) => boolean;
  onReviveCheck?: (ctx: CharacterReviveContext) => boolean;
  onWaitCounter?: (ctx: CharacterWaitCounterContext) => boolean;
  resolveReentry?: (ctx: CharacterReentryContext) => void;
}
