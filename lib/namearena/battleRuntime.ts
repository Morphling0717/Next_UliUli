import type {
  BattleEngineCore,
  BattleEngineData,
  BattleLogMetadata,
  DamageApplicationOptions,
  DefeatOptions,
  Fighter,
  JobDefinition,
  SkillDefinition,
  SpinalSwordRef,
  StatusApplicationOptions,
  StatusEffectsMap,
} from './types';
import type { ActionResolutionRuntime } from './actionResolution';
import type { CharacterHookRuntime } from './characterHooks';
import type { DamageResolutionRuntime, DamageResult } from './damageResolution';
import type { StatusProcessingRuntime } from './statusProcessing';
import type { SummonResolutionRuntime } from './summonResolution';
import type { SupportResolutionRuntime } from './supportResolution';
import type { TargetingRuntime } from './targeting';
import type { TurnFlowRuntime } from './turnFlow';

export interface BattleRuntimeHost {
  fighters: Fighter[];
  JOBS: Partial<Record<string, JobDefinition>>;
  SKILLS: Record<string, SkillDefinition>;
  Data: BattleEngineData;
  Core: BattleEngineCore;
  STATUS_EFFECTS: StatusEffectsMap;
  SKILL_TAGS: Record<string, string>;
  turnCount: number;
  battleState: import('./types').BattleState;
  getTeamId: (fighter: Fighter) => string;
  isActiveCombatant: (fighter: Fighter) => boolean;
  getFatigueDamageBonus: () => number;
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
  markDefeated: (target: Fighter, options?: DefeatOptions) => boolean;
  applyStatus: (target: Fighter, type: string, duration: number, options?: StatusApplicationOptions) => boolean;
  calculateDamage: (
    user: Fighter,
    target: Fighter,
    skill: SkillDefinition,
    userTeamId: string,
    usedSkillId: string | null,
  ) => DamageResult;
  clearSpinalSword: (fighter: Fighter) => void;
  createCharacterHookRuntime: () => CharacterHookRuntime;
  executeSkillAction: (skillId: string | null, user: Fighter, forcedTarget: Fighter | null, triggerDepth: number) => void;
  executeSummonSkill: (skill: SkillDefinition, user: Fighter, userTeamId: string) => void;
  executeSupportSkill: (skill: SkillDefinition, user: Fighter, forcedTarget: Fighter | null, userTeamId: string) => boolean;
  finalizeFighterDeath: (
    fighter: Fighter,
    spinalSwordRef: SpinalSwordRef,
    deathMessage?: string,
    killer?: Fighter,
  ) => void;
  formatSkillText: (skill: SkillDefinition, text: string) => string;
  handleTransformations: (fighter: Fighter) => void;
  flushDeferredDamageEvents: (fighter: Fighter, phase?: 'mitigation' | 'all') => void;
  isPassiveCharmCounter: (fighter: Fighter, counterType: string) => boolean;
  spreadDivaSupport: (skill: SkillDefinition, user: Fighter, userTeamId: string) => void;
  syncPuppetMasterStatus: (fighter: Fighter) => void;
}

export function buildCharacterHookRuntime(host: BattleRuntimeHost): CharacterHookRuntime {
  return {
    fighters: host.fighters,
    jobs: host.JOBS,
    turnCount: host.turnCount,
    getTeamId: (fighter) => host.getTeamId(fighter),
    isActiveCombatant: (fighter) => host.isActiveCombatant(fighter),
    log: (type, text) => host.log(type, text),
    syncHpPct: (fighter) => host.syncHpPct(fighter),
    applyDamage: (target, amount, source, isTrueDamage, attacker, options) => host.applyDamage(target, amount, source, isTrueDamage, attacker, options),
    applyStatus: (target, type, duration, options) => host.applyStatus(target, type, duration, options),
    markDefeated: (target, options) => host.markDefeated(target, options),
    handleTransformations: (fighter) => host.handleTransformations(fighter),
    flushDeferredDamageEvents: (fighter) => host.flushDeferredDamageEvents(fighter),
    executeSkillAction: (id, user, target, depth) => host.executeSkillAction(id, user, target, depth),
    finalizeFighterDeath: (fighter, spinalSwordRef, deathMessage, killer) =>
      host.finalizeFighterDeath(fighter, spinalSwordRef, deathMessage, killer),
  };
}

export function buildTargetingRuntime(host: BattleRuntimeHost): TargetingRuntime {
  return {
    fighters: host.fighters,
    turnCount: host.turnCount,
    getTeamId: (fighter) => host.getTeamId(fighter),
    isActiveCombatant: (fighter) => host.isActiveCombatant(fighter),
  };
}

export function buildDamageResolutionRuntime(host: BattleRuntimeHost): DamageResolutionRuntime {
  return {
    skillTags: host.SKILL_TAGS,
    fighters: host.fighters,
    getTeamId: (fighter) => host.getTeamId(fighter),
    isActiveCombatant: (fighter) => host.isActiveCombatant(fighter),
    getFatigueDamageBonus: () => host.getFatigueDamageBonus(),
    log: (type, text) => host.log(type, text),
  };
}

export function buildStatusProcessingRuntime(host: BattleRuntimeHost): StatusProcessingRuntime {
  return {
    fighters: host.fighters,
    statusEffects: host.STATUS_EFFECTS,
    turnCount: host.turnCount,
    log: (type, text) => host.log(type, text),
    applyDamage: (target, amount, source, isTrueDamage, attacker, options) => host.applyDamage(target, amount, source, isTrueDamage, attacker, options),
    markDefeated: (target, options) => host.markDefeated(target, options),
    flushDeferredDamageEvents: (fighter, phase) => host.flushDeferredDamageEvents(fighter, phase),
    syncHpPct: (fighter) => host.syncHpPct(fighter),
    isActiveCombatant: (fighter) => host.isActiveCombatant(fighter),
  };
}

export function buildSummonResolutionRuntime(host: BattleRuntimeHost): SummonResolutionRuntime {
  return {
    fighters: host.fighters,
    jobs: host.JOBS,
    core: host.Core,
    getTeamId: (fighter) => host.getTeamId(fighter),
    isActiveCombatant: (fighter) => host.isActiveCombatant(fighter),
    markDefeated: (target, options) => host.markDefeated(target, options),
    clearSpinalSword: (fighter) => host.clearSpinalSword(fighter),
    syncPuppetMasterStatus: (fighter) => host.syncPuppetMasterStatus(fighter),
    formatSkillText: (skill, text) => host.formatSkillText(skill, text),
    log: (type, text, metadata) => host.log(type, text, metadata),
  };
}

export function buildSupportResolutionRuntime(host: BattleRuntimeHost): SupportResolutionRuntime {
  return {
    fighters: host.fighters,
    skillTags: host.SKILL_TAGS,
    data: host.Data,
    turnCount: host.turnCount,
    getTeamId: (fighter) => host.getTeamId(fighter),
    isActiveCombatant: (fighter) => host.isActiveCombatant(fighter),
    syncHpPct: (fighter) => host.syncHpPct(fighter),
    applyDamage: (target, amount, source, isTrueDamage, attacker, options) => host.applyDamage(target, amount, source, isTrueDamage, attacker, options),
    applyStatus: (target, type, duration, options) => host.applyStatus(target, type, duration, options),
    markDefeated: (target, options) => host.markDefeated(target, options),
    formatSkillText: (skill, text) => host.formatSkillText(skill, text),
    log: (type, text) => host.log(type, text),
  };
}

export function buildActionResolutionRuntime(host: BattleRuntimeHost): ActionResolutionRuntime {
  return {
    fighters: host.fighters,
    skills: host.SKILLS,
    skillTags: host.SKILL_TAGS,
    data: host.Data,
    statusEffects: host.STATUS_EFFECTS,
    turnCount: host.turnCount,
    largeRound: host.battleState.largeRound.number,
    getTeamId: (fighter) => host.getTeamId(fighter),
    isActiveCombatant: (fighter) => host.isActiveCombatant(fighter),
    log: (type, text, metadata) => host.log(type, text, metadata),
    syncHpPct: (fighter) => host.syncHpPct(fighter),
    applyDamage: (target, amount, source, isTrueDamage, attacker, options) => host.applyDamage(target, amount, source, isTrueDamage, attacker, options),
    markDefeated: (target, options) => host.markDefeated(target, options),
    applyStatus: (target, type, duration, options) => host.applyStatus(target, type, duration, options),
    calculateDamage: (user, target, skill, userTeamId, usedSkillId) =>
      host.calculateDamage(user, target, skill, userTeamId, usedSkillId),
    handleTransformations: (fighter) => host.handleTransformations(fighter),
    flushDeferredDamageEvents: (fighter, phase) => host.flushDeferredDamageEvents(fighter, phase),
    executeSkillAction: (skillId, user, forcedTarget, triggerDepth) =>
      host.executeSkillAction(skillId, user, forcedTarget, triggerDepth),
    executeSummonSkill: (skill, user, userTeamId) => host.executeSummonSkill(skill, user, userTeamId),
    spreadDivaSupport: (skill, user, userTeamId) => host.spreadDivaSupport(skill, user, userTeamId),
    executeSupportSkill: (skill, user, forcedTarget, userTeamId) =>
      host.executeSupportSkill(skill, user, forcedTarget, userTeamId),
    createCharacterHookRuntime: () => host.createCharacterHookRuntime(),
  };
}

export function buildTurnFlowRuntime(host: BattleRuntimeHost): TurnFlowRuntime {
  return {
    fighters: host.fighters,
    statusEffects: host.STATUS_EFFECTS,
    getTeamId: (fighter) => host.getTeamId(fighter),
    isActiveCombatant: (fighter) => host.isActiveCombatant(fighter),
    createCharacterHookRuntime: () => host.createCharacterHookRuntime(),
    log: (type, text) => host.log(type, text),
    isPassiveCharmCounter: (fighter, counterType) => host.isPassiveCharmCounter(fighter, counterType),
  };
}
