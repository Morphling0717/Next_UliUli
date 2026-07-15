import type { Fighter } from '../types';
import {
  activeOwlSummons,
  ensureOwlState,
  enterOwlPrideAfterKill,
  findOwlEmperor,
  grantOwlHeavenFromDeath,
  OWL_WILD_MAX,
  processOwlGlobalTick,
  rebuildOwlPhaseTwoStats,
  releaseOwlPhaseTwoLightning,
  type OwlRuntime,
} from '../owlMechanics';
import { isSelectableTargetFor } from '../targeting';
import type { CharacterHook, CharacterHookRuntime } from './types';

function asOwlRuntime(runtime: CharacterHookRuntime): OwlRuntime {
  return {
    fighters: runtime.fighters,
    jobs: runtime.jobs,
    turnCount: runtime.turnCount,
    getTeamId: runtime.getTeamId,
    isActiveCombatant: runtime.isActiveCombatant,
    log: runtime.log,
    syncHpPct: runtime.syncHpPct,
    applyDamage: runtime.applyDamage,
    applyStatus: runtime.applyStatus,
    markDefeated: runtime.markDefeated,
    flushDeferredDamageEvents: runtime.flushDeferredDamageEvents,
  };
}

function weightedPick(entries: Array<[string, number]>): string | null {
  const usable = entries.filter(([, weight]) => weight > 0);
  const total = usable.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return null;
  let roll = Math.random() * total;
  for (const [skill, weight] of usable) {
    roll -= weight;
    if (roll <= 0) return skill;
  }
  return usable[usable.length - 1]?.[0] ?? null;
}

function activeEnemies(runtime: CharacterHookRuntime, actor: Fighter): Fighter[] {
  return runtime.fighters.filter((fighter) => isSelectableTargetFor(runtime, actor, fighter));
}

function selectOwlSkill(actor: Fighter, runtime: CharacterHookRuntime): string | null {
  if (activeEnemies(runtime, actor).length === 0) return null;
  const owlRuntime = asOwlRuntime(runtime);
  const state = ensureOwlState(actor, runtime.turnCount);
  if (state.phase === 1) {
    return weightedPick([
      ['owl_nia', 22],
      ['owl_yiling_fire', 18],
      ['owl_shining_hopper', activeOwlSummons(owlRuntime, actor, 'cricket').length < 2 ? 20 : 7],
      ['owl_benevolence_sword', 20],
      ['owl_righteousness_sword', 20],
    ]);
  }
  if (state.phase === 2) {
    const markedAlive = state.riverMarkedTargetId
      ? runtime.fighters.some((fighter) => fighter.id === state.riverMarkedTargetId && runtime.isActiveCombatant(fighter))
      : false;
    return weightedPick([
      ['owl_sweep_furry', state.sweepUsed ? 0 : 28],
      ['owl_crossing_mark', markedAlive ? 12 : 30],
      ['owl_seven_in_seven_out', activeOwlSummons(owlRuntime, actor, 'zhao_adou').length > 0 ? 9 : 27],
      ['owl_benevolence_sword', 13],
      ['owl_righteousness_sword', 13],
    ]);
  }
  const emperor = findOwlEmperor(owlRuntime, actor);
  const emperorNeedsHealing = !!emperor && emperor.currentHp < emperor.maxHp * 0.85;
  const selfNeedsHealing = actor.hpPct < 0.78;
  const wildStacks = emperor?.owlSummonState?.wildStacks ?? 0;
  return weightedPick([
    ['owl_bumper_harvest', selfNeedsHealing || emperorNeedsHealing ? 18 : 0],
    ['owl_desk', emperor && wildStacks < OWL_WILD_MAX ? 13 : 0],
    ['owl_ruthless_sword', 24],
    ['owl_enjoy', actor.hpPct < 0.48 ? 16 : 0],
    ['owl_great_wind', 21],
    ['owl_bone_scrape', emperorNeedsHealing ? 13 : 0],
  ]);
}

export const owlHook: CharacterHook = {
  id: 'owl',

  selectSkill: ({ actor, runtime, phase }) => {
    if (phase !== 'preMechanics') return null;
    if (actor.owlSummonState?.kind === 'zhao_adou') return 'owl_zhao_rampage';
    if (actor.owlSummonState?.kind === 'emperor') {
      return weightedPick([
        ['owl_emperor_claw', 48],
        ['owl_atomic_breath', 30],
        ['owl_dragon_shock', 22],
      ]);
    }
    if (!actor.isOwl) return null;
    return selectOwlSkill(actor, runtime);
  },

  onTransformCheck: ({ fighter, runtime, transform }) => {
    if (!fighter.isOwl || ensureOwlState(fighter, runtime.turnCount).phase !== 1) return false;
    const phaseTwoJob = runtime.jobs.OWL_BOILED_HERO;
    if (!phaseTwoJob) return false;
    transform('OWL_BOILED_HERO', `⚡ ${fighter.name}：“这雷把我吓死了！”转入第二阶段【${phaseTwoJob.name}】！`, () => {
      rebuildOwlPhaseTwoStats(fighter);
    });
    releaseOwlPhaseTwoLightning(asOwlRuntime(runtime), fighter);
    return true;
  },

  onDefeated: ({ fighter, runtime }) => {
    if (fighter.isOwl) {
      runtime.log('death', `🦉 ${fighter.name}：“死是凉爽的夏夜，可供人无忧的安眠。”`);
    }
  },

  onDefeatSettled: ({ fighter, runtime, killer }) => {
    const owlRuntime = asOwlRuntime(runtime);
    if (fighter.owlSummonState?.kind === 'emperor') {
      const owner = fighter.summonerId ? runtime.fighters.find((candidate) => candidate.id === fighter.summonerId) : undefined;
      runtime.log('death', `🐲 ${owner?.name ?? '鸮'}：“不是我害了你，是这乱世害了你啊！爹啊！你死的好惨啊！孩儿对不住你呀！”（毫无感情）`);
    }
    grantOwlHeavenFromDeath(owlRuntime, fighter);
    enterOwlPrideAfterKill(owlRuntime, killer);
  },

  onGlobalTick: ({ runtime }) => {
    processOwlGlobalTick(asOwlRuntime(runtime));
  },
};
