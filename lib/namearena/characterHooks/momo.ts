import type { Fighter } from '../types';
import {
  applyMomoPhaseTwoStats,
  clearMomoTeam,
  ensureMomoState,
  handleMomoPartnerDefeat,
  initializeMomoTeam,
  processMomoGlobalTick,
  reviveMomoAsWaterDaughter,
  type MomoRuntime,
} from '../momoMechanics';
import { isSelectableTargetFor } from '../targeting';
import type { CharacterHook, CharacterHookRuntime } from './types';

function asMomoRuntime(runtime: CharacterHookRuntime): MomoRuntime {
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

function weightedPick(items: Array<[string, number]>): string | null {
  const pool = items.filter(([, weight]) => weight > 0);
  const total = pool.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return null;
  let roll = Math.random() * total;
  for (const [skillId, weight] of pool) {
    roll -= weight;
    if (roll <= 0) return skillId;
  }
  return pool[pool.length - 1]?.[0] ?? null;
}

function activeEnemies(runtime: CharacterHookRuntime, actor: Fighter): Fighter[] {
  return runtime.fighters.filter((fighter) => isSelectableTargetFor(runtime, actor, fighter));
}

function activeMomoDragon(actor: Fighter, runtime: CharacterHookRuntime): Fighter | undefined {
  return runtime.fighters.find((fighter) =>
    fighter.summonerId === actor.id &&
    fighter.momoDragonVariant &&
    runtime.isActiveCombatant(fighter),
  );
}

function selectMomoSkill(actor: Fighter, runtime: CharacterHookRuntime): string | null {
  if (activeEnemies(runtime, actor).length === 0) return null;
  const state = ensureMomoState(actor);
  if (state.phase >= 3) {
    return weightedPick([
      ['momo_ten_pull', actor.hpPct < 0.75 ? 40 : 28],
      ['momo_peaches', actor.hpPct > 0.18 ? 36 : 12],
      ['momo_claw_machine', 28],
    ]);
  }
  if (state.phase === 2) {
    return weightedPick([
      ['momo_wps_pillar', 30],
      ['momo_what_is_this', 20],
      ['momo_345', 30],
      ['momo_sweep_furry', activeMomoDragon(actor, runtime) ? 4 : 20],
    ]);
  }
  return weightedPick([
    ['momo_what_zone', 40],
    ['momo_mic_open', 28],
    ['momo_top_rank', 32],
  ]);
}

function selectDragonSkill(dragon: Fighter, runtime: CharacterHookRuntime): string | null {
  const owner = dragon.summonerId
    ? runtime.fighters.find((fighter) => fighter.id === dragon.summonerId && fighter.isMomo && runtime.isActiveCombatant(fighter))
    : undefined;
  if (!owner || activeEnemies(runtime, dragon).length === 0) return 'momo_dragon_strike';
  const hasSword = owner.status.some((status) =>
    status.sourceId === owner.id && (status.type === 'MOMO_VILLAGE_SWORD' || status.type === 'MOMO_AWAKENED_SWORD'),
  );
  const hasGuard = owner.status.some((status) => status.type === 'SPELL_BLOCK' && status.sourceId === 'momo_guard_vent');
  return weightedPick([
    ['momo_sword_vent', hasSword ? 0 : 22],
    ['momo_guard_vent', hasGuard ? 0 : 18],
    ['momo_final_vent', 24],
    ['momo_dragon_strike', 42],
  ]);
}

export const momoHook: CharacterHook = {
  id: 'momo',

  selectSkill: ({ actor, runtime, phase }) => {
    if (phase !== 'preMechanics') return null;
    if (actor.momoDragonVariant) return selectDragonSkill(actor, runtime);
    if (!actor.isMomo) return null;
    initializeMomoTeam(asMomoRuntime(runtime), actor);
    return selectMomoSkill(actor, runtime);
  },

  onTransformCheck: ({ fighter, runtime, transform }) => {
    if (!fighter.isMomo) return false;
    const state = ensureMomoState(fighter);
    if (state.phase !== 1) return false;
    const phaseTwo = runtime.jobs.MOMO_LOVER_KING;
    if (!phaseTwo) return false;
    transform(
      state.waterDaughter ? 'MOMO_WATER_DAUGHTER' : 'MOMO_LOVER_KING',
      state.waterDaughter
        ? `💗 ${fighter.name}：“我有两个可爱，一个是我非常可爱，另一个是我可爱你辣！”以【水人的大女儿】身份觉醒二阶段力量！`
        : `💗 ${fighter.name}：“我有两个可爱，一个是我非常可爱，另一个是我可爱你辣！”进入二阶段【${phaseTwo.name}】！`,
      () => applyMomoPhaseTwoStats(fighter),
    );
    return true;
  },

  onDefeatSettled: ({ fighter, runtime }) => {
    const momoRuntime = asMomoRuntime(runtime);
    handleMomoPartnerDefeat(momoRuntime, fighter);
    if (fighter.isMomo) clearMomoTeam(momoRuntime, fighter);
  },

  onReviveCheck: ({ fighter, runtime }) => {
    if (!fighter.isMomo) return false;
    return reviveMomoAsWaterDaughter(asMomoRuntime(runtime), fighter);
  },

  onGlobalTick: ({ runtime }) => {
    processMomoGlobalTick(asMomoRuntime(runtime));
  },

  resolveReentry: ({ runtime }) => {
    // Slacking resolves first; this pass immediately restores captain benefits
    // for anyone who has just returned from off-field OB.
    processMomoGlobalTick(asMomoRuntime(runtime));
  },
};
