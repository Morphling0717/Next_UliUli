import type {
  BattleEngineData,
  BattleLogMetadata,
  DamageApplicationOptions,
  DefeatOptions,
  Fighter,
  SkillDefinition,
  StatusApplicationOptions,
  StatusEffectsMap,
} from '../types';
import type { CharacterHookRuntime } from '../characterHooks';
import type { DamageResult } from '../damageResolution';

export interface ActionResolutionRuntime {
  fighters: Fighter[];
  skills: Record<string, SkillDefinition>;
  skillTags: Record<string, string>;
  data: BattleEngineData;
  statusEffects: StatusEffectsMap;
  turnCount: number;
  largeRound: number;
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
  markDefeated: (target: Fighter, options?: DefeatOptions) => boolean;
  applyStatus: (target: Fighter, type: string, duration: number, options?: StatusApplicationOptions) => boolean;
  calculateDamage: (
    user: Fighter,
    target: Fighter,
    skill: SkillDefinition,
    userTeamId: string,
    usedSkillId: string | null,
  ) => DamageResult;
  handleTransformations: (fighter: Fighter) => void;
  flushDeferredDamageEvents: (fighter: Fighter) => void;
  executeSkillAction: (
    skillId: string | null,
    user: Fighter,
    forcedTarget: Fighter | null,
    triggerDepth: number,
  ) => void;
  executeSummonSkill: (skill: SkillDefinition, user: Fighter, userTeamId: string) => void;
  spreadDivaSupport: (skill: SkillDefinition, user: Fighter, userTeamId: string) => void;
  executeSupportSkill: (
    skill: SkillDefinition,
    user: Fighter,
    forcedTarget: Fighter | null,
    userTeamId: string,
  ) => boolean;
  createCharacterHookRuntime: () => CharacterHookRuntime;
}
