import type { Fighter } from '../types';
import {
  ensureYuzuMarkedTarget,
  ensureYuzuOpeningShield,
  ensureYuzuState,
  tryAdvanceYuzuPhaseByHp,
  tryAdvanceYuzuPhaseByTeamLoss,
  type YuzuRuntime,
} from '../yuzuMechanics';
import { isSelectableTargetFor } from '../targeting';
import type { CharacterHook, CharacterHookRuntime } from './types';

const PHASE_ONE_SKILLS = [
  'yuzu_spear_impale',
  'yuzu_hammer_crush',
  'yuzu_sword_devour',
  'yuzu_homeward_scythe',
] as const;

const PHASE_TWO_SKILLS = [
  'yuzu_frozen_blood',
  'yuzu_silent_applause',
  'yuzu_falling_leaf_blade',
  'yuzu_waiting_hell',
] as const;

const PHASE_THREE_SKILLS = [
  'yuzu_customized_fool',
  'yuzu_divine_pursuit',
  'yuzu_daughter_reckoning',
  'yuzu_unbreakable_daughter',
] as const;

function asYuzuRuntime(runtime: CharacterHookRuntime): YuzuRuntime {
  return {
    fighters: runtime.fighters,
    turnCount: runtime.turnCount,
    battleState: runtime.battleState,
    getTeamId: runtime.getTeamId,
    isActiveCombatant: runtime.isActiveCombatant,
    log: runtime.log,
    syncHpPct: runtime.syncHpPct,
    runReactionAction: runtime.runReactionAction,
  };
}

function activeEnemies(runtime: CharacterHookRuntime, actor: Fighter): Fighter[] {
  return runtime.fighters.filter((fighter) =>
    isSelectableTargetFor(runtime, actor, fighter),
  );
}

function weightedPick(items: Array<[string, number]>): string | null {
  const pool = items.filter(([, weight]) => weight > 0);
  const total = pool.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return null;
  let roll = Math.random() * total;
  for (const [skill, weight] of pool) {
    roll -= weight;
    if (roll <= 0) return skill;
  }
  return pool[pool.length - 1]?.[0] ?? null;
}

function selectYuzuSkill(actor: Fighter, runtime: CharacterHookRuntime): string | null {
  const enemies = activeEnemies(runtime, actor);
  if (enemies.length === 0) return null;

  const yuzuRuntime = asYuzuRuntime(runtime);
  ensureYuzuState(actor);
  ensureYuzuOpeningShield(yuzuRuntime, actor);
  tryAdvanceYuzuPhaseByHp(yuzuRuntime, actor);
  tryAdvanceYuzuPhaseByTeamLoss(yuzuRuntime, actor);

  const phase = actor.yuzuPhase ?? 1;
  if (phase >= 3) {
    ensureYuzuMarkedTarget(yuzuRuntime, actor);
    if (actor.yuzuFuriosoReady) return 'yuzu_furioso_replica';
    return weightedPick([
      ['yuzu_customized_fool', 16],
      ['yuzu_divine_pursuit', 16],
      ['yuzu_daughter_reckoning', 14],
      ['yuzu_unbreakable_daughter', 14],
    ]) ?? PHASE_THREE_SKILLS[Math.floor(Math.random() * PHASE_THREE_SKILLS.length)] ?? null;
  }

  if (phase === 2) {
    return weightedPick([
      ['yuzu_frozen_blood', 16],
      ['yuzu_silent_applause', 15],
      ['yuzu_falling_leaf_blade', 15],
      ['yuzu_waiting_hell', enemies.length >= 2 ? 13 : 3],
    ]) ?? PHASE_TWO_SKILLS[Math.floor(Math.random() * PHASE_TWO_SKILLS.length)] ?? null;
  }

  return weightedPick([
    ['yuzu_spear_impale', 16],
    ['yuzu_hammer_crush', 15],
    ['yuzu_sword_devour', 14],
    ['yuzu_homeward_scythe', actor.hpPct < 0.86 ? 12 : 7],
  ]) ?? PHASE_ONE_SKILLS[Math.floor(Math.random() * PHASE_ONE_SKILLS.length)] ?? null;
}

export const yuzuHook: CharacterHook = {
  id: 'yuzu',

  selectSkill: ({ actor, runtime, phase }) => {
    if (phase !== 'preMechanics' || !actor.isYuzu) return null;
    return selectYuzuSkill(actor, runtime);
  },

  onGlobalTick: ({ runtime }) => {
    const yuzuRuntime = asYuzuRuntime(runtime);
    runtime.fighters.forEach((fighter) => {
      if (!fighter.isYuzu || !runtime.isActiveCombatant(fighter)) return;
      ensureYuzuOpeningShield(yuzuRuntime, fighter);
      tryAdvanceYuzuPhaseByHp(yuzuRuntime, fighter);
      tryAdvanceYuzuPhaseByTeamLoss(yuzuRuntime, fighter);
      ensureYuzuMarkedTarget(yuzuRuntime, fighter);
    });
  },
};
