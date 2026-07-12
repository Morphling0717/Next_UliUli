import {
  consumeCompletedLargeRound,
  createBattleState,
  getLargeRoundPriorityActorIds,
  noteLargeRoundActor,
  syncLargeRoundState,
  withBattleRandom,
} from '../../../lib/namearena/battleState';
import { grantStatus } from '../../../lib/namearena/defenseStatus';
import {
  applyPermanentStatBuff,
  applyTimedStatModifier,
  cleanupOrphanedTimedStatModifiers,
  makeTimedStatModifier,
} from '../../../lib/namearena/statModifiers';
import {
  consumeStatusCharge,
  createLifecycleStatus,
  statusDurationText,
  tickStatusTurn,
} from '../../../lib/namearena/statusLifecycle';
import type { BattleEvent, DamageApplicationOptions, Fighter, SpinalSwordRef } from '../../../lib/namearena/types';
import {
  assert,
  localProject,
  makeFighter,
  makeProjectEngine,
  type LogEntry,
} from '../shared/harness';
import { makeDeathEngine } from './deathAccountingCases';

function activePlayers(fighters: Fighter[]): Fighter[] {
  return fighters.filter((fighter) => !fighter.isDead && !fighter.isDeadAnnounced && fighter.currentHp > 0 && !fighter.isNpc);
}

function seededTrace(seed: number): string {
  const state = createBattleState(seed);
  let fighters = withBattleRandom(state, () => [
    makeFighter('玄凝@回放甲'),
    makeFighter('克蕾儿丝菲尔@回放乙'),
    makeFighter('M1A2_abrams_sep@回放丙'),
  ]);
  const logs: LogEntry[] = [];
  const events: BattleEvent[] = [];
  const spinalSwordRef: SpinalSwordRef = { current: false };

  for (let index = 0; index < 40; index += 1) {
    const engine = makeProjectEngine(
      localProject,
      localProject.cloneFighters(fighters),
      logs,
      state.turnCount,
      state,
      events,
    );
    const ended = engine.step(spinalSwordRef);
    fighters = engine.fighters;
    if (ended) break;
  }

  events.forEach((event, index) => {
    assert(event.sequence === index + 1, `Structured event sequence should be contiguous, got ${event.sequence} at ${index + 1}`);
    assert(event.seed === state.seed, `Structured event should retain battle seed ${state.seed}, got ${event.seed}`);
  });
  assert(events.some((event) => event.kind === 'action_start'), 'Structured replay should contain action_start events');
  assert(events.filter((event) => event.kind === 'action_start').length === events.filter((event) => event.kind === 'action_end').length, 'Structured replay should pair action_start and action_end events');
  assert(events.some((event) => event.kind === 'damage'), 'Structured replay should contain authoritative damage events');

  return JSON.stringify({
    logs: logs.map(({ type, text }) => ({ type, text })),
    events,
    fighters: fighters.map((fighter) => ({
      id: fighter.id,
      name: fighter.name,
      hp: fighter.currentHp,
      dead: fighter.isDead,
      stats: fighter.stats,
      status: fighter.status,
    })),
    state,
  });
}

export function runArchitectureCases(): string[] {
  const cases: string[] = [];

  {
    const fighters = [
      makeFighter('大回合极速者@A'),
      makeFighter('大回合慢速者甲@B'),
      makeFighter('大回合慢速者乙@C'),
      makeFighter('大回合慢速者丙@D'),
    ];
    fighters[0].spd = 100000;
    fighters.slice(1).forEach((fighter) => { fighter.spd = 1; });
    const state = createBattleState(17);
    const engine = makeProjectEngine(localProject, fighters, [], 0, state);
    const participantCount = state.largeRound.participantIds.length;
    let completedRound: number | undefined;
    let actions = 0;

    while (completedRound === undefined && actions <= participantCount * 2) {
      const priorityIds = getLargeRoundPriorityActorIds(state, engine.fighters);
      const actor = withBattleRandom(state, () => engine.determineActor(activePlayers(engine.fighters), priorityIds));
      assert(actor, 'Large-round scheduler should always find an active participant');
      completedRound = noteLargeRoundActor(state, engine.fighters, actor);
      actions += 1;
    }

    assert(completedRound === 1, 'Large round should complete under an extreme speed skew');
    assert(actions <= participantCount * 2, `Large round exceeded its ${participantCount * 2}-action hard cap with ${actions} actions`);
    assert(state.largeRound.actedIds.length === participantCount, 'Every snapshotted participant should act before round completion');
    assert(state.largeRound.number === 1, 'Completed round should remain visible until its final action settles');
    consumeCompletedLargeRound(state, engine.fighters);
    assert(Number(state.largeRound.number) === 2 && state.largeRound.actedIds.length === 0, 'Next large round should start only after completion is consumed');
    cases.push('large rounds are bounded and advance after final-action settlement');
  }

  {
    const playerA = makeFighter('轮次快照甲@A');
    const playerB = makeFighter('轮次快照乙@B');
    const slacker = makeFighter('轮次场外者@C');
    const summon = makeFighter('轮次召唤物@D');
    const npc = makeFighter('轮次NPC@E');
    slacker.status.push(createLifecycleStatus('SYNERGY_SLACKING', 5));
    summon.isSummon = true;
    npc.isNpc = true;
    npc.cannotAct = true;
    npc.cannotWin = true;
    const fighters = [playerA, playerB, slacker, summon, npc];
    const state = createBattleState(23);
    syncLargeRoundState(state, fighters);
    assert(state.largeRound.participantIds.length === 2, 'Large-round roster should exclude field-away players, summons, and NPCs');

    const newcomer = makeFighter('轮次中途入场者@F');
    fighters.push(newcomer);
    syncLargeRoundState(state, fighters);
    assert(!state.largeRound.participantIds.includes(newcomer.id), 'Mid-round entrants should not extend the active large round');
    noteLargeRoundActor(state, fighters, playerA);
    noteLargeRoundActor(state, fighters, playerB);
    consumeCompletedLargeRound(state, fighters);
    assert(state.largeRound.participantIds.includes(newcomer.id), 'Mid-round entrants should join the next large-round snapshot');
    cases.push('large-round roster snapshots exclude off-field entities and defer entrants');
  }

  {
    const actor = makeFighter('退场收束行动者@A');
    const defeatedA = makeFighter('退场收束目标甲@B');
    const defeatedB = makeFighter('退场收束目标乙@C');
    const fighters = [actor, defeatedA, defeatedB];
    const state = createBattleState(29);
    syncLargeRoundState(state, fighters);
    noteLargeRoundActor(state, fighters, actor);
    [defeatedA, defeatedB].forEach((fighter) => {
      fighter.currentHp = 0;
      fighter.isDead = true;
    });
    const completed = syncLargeRoundState(state, fighters);
    assert(completed === 1 && state.completedLargeRound === 1, 'Removing every unacted participant should complete the current large round immediately');
    assert(state.largeRound.actedIds.length === 1 && state.largeRound.participantIds.length === 1, 'Roster contraction should preserve the actor that already moved');
    cases.push('large rounds complete immediately when all unacted participants leave');
  }

  {
    const fighter = makeFighter('临时属性测试@A');
    fighter.atk = 100;
    fighter.status = [createLifecycleStatus('TEMP_STAT_BUFF', 3, 'architecture')];
    applyTimedStatModifier(fighter, makeTimedStatModifier('architecture-atk', 'TEMP_STAT_BUFF', { atk: 1.5 }, 'architecture'));
    assert(fighter.atk === 150, `Temporary modifier should apply once, got ${fighter.atk}`);
    applyTimedStatModifier(fighter, makeTimedStatModifier('architecture-atk', 'TEMP_STAT_BUFF', { atk: 2 }, 'architecture'));
    assert(Number(fighter.atk) === 200, `Refreshing a modifier should recompute from base instead of stacking exponentially, got ${fighter.atk}`);
    applyPermanentStatBuff(fighter, { atk: 1.5 });
    assert(Number(fighter.atk) === 300, `Permanent growth should update the unmodified base before reapplying the temporary layer, got ${fighter.atk}`);
    fighter.status = [];
    cleanupOrphanedTimedStatModifiers(fighter);
    assert(Number(fighter.atk) === 150, `Expired temporary modifier should restore the updated permanent base, got ${fighter.atk}`);
    cases.push('temporary stat modifiers refresh and roll back against a permanent base');
  }

  {
    const fighter = makeFighter('状态生命周期测试@A');
    const spellBlock = createLifecycleStatus('SPELL_BLOCK', 2, 'architecture');
    fighter.status = [spellBlock];
    assert(spellBlock.charges === 2 && spellBlock.remainingTurns === undefined, 'Spell block should expose charges without a turn duration');
    assert(statusDurationText(spellBlock) === '2次', `Spell block UI should display charges, got ${statusDurationText(spellBlock)}`);
    consumeStatusCharge(fighter, spellBlock);
    assert(fighter.status.includes(spellBlock) && Number(spellBlock.charges) === 1, 'First spell block trigger should consume exactly one charge');
    consumeStatusCharge(fighter, spellBlock);
    assert(!fighter.status.includes(spellBlock), 'Second spell block trigger should remove the exhausted status');

    const counter = createLifecycleStatus('CTR_CHARM', 5);
    fighter.status = [counter];
    assert(counter.remainingTurns === 5 && counter.charges === 1, 'Counter stance should separate owner-turn expiry from its one trigger');
    assert(statusDurationText(counter) === '5回合 · 1次', `Counter UI should display both clocks, got ${statusDurationText(counter)}`);
    consumeStatusCharge(fighter, counter);
    assert(fighter.status.length === 0, 'Counter stance should disappear after its single trigger even with turns remaining');

    const permanentRage = createLifecycleStatus('RAGE', 999);
    assert(permanentRage.expiresOn === 'never' && !tickStatusTurn(permanentRage), '999-turn non-trigger statuses should be truly permanent');
    assert(statusDurationText(permanentRage) === undefined, 'Permanent statuses should not expose a fake 999-turn UI label');
    cases.push('status duration, trigger charges, and UI labels are independent');
  }

  {
    const attacker = makeFighter('权威统计攻击者@A');
    const target = makeFighter('权威统计目标@B');
    target.maxHp = 100;
    localProject.setCurrentHp(target, 100);
    const { engine } = makeDeathEngine([attacker, target]);
    const options: DamageApplicationOptions = {};
    const actual = engine.applyDamage(engine.fighters[1], 150, 'skill', true, engine.fighters[0], options);
    assert(actual === 100 && engine.fighters[1].currentHp === 0, `Lethal settlement should clamp to 100 actual HP damage, got ${actual}`);
    assert(options.resolution?.outcome === 'hp_damage' && options.resolution.overkillDamage === 50, 'Damage resolution should retain HP damage and overkill separately');
    assert(engine.fighters[0].stats.dmgDealt === 100 && engine.fighters[0].stats.overkillDmg === 50, 'Attacker ledger should count effective damage and overkill separately');
    assert(engine.fighters[1].stats.dmgTaken === 100, 'Target ledger should count actual HP loss only');

    const shieldAttacker = makeFighter('护盾统计攻击者@A');
    const shieldTarget = makeFighter('护盾统计目标@B');
    shieldTarget.yuzuShield = 40;
    const shieldFixture = makeDeathEngine([shieldAttacker, shieldTarget]);
    const shieldOptions: DamageApplicationOptions = {};
    const shieldActual = shieldFixture.engine.applyDamage(
      shieldFixture.engine.fighters[1],
      30,
      'skill',
      true,
      shieldFixture.engine.fighters[0],
      shieldOptions,
    );
    assert(shieldActual === 0 && shieldOptions.resolution?.outcome === 'shielded', 'Fully absorbed damage should have an explicit shielded outcome');
    assert(shieldFixture.engine.fighters[0].stats.shieldDmgDealt === 30, 'Shield damage should be credited without inventing HP damage');

    const blockedAttacker = makeFighter('抵挡统计攻击者@A');
    const blockedTarget = makeFighter('抵挡统计目标@B');
    grantStatus(blockedTarget, 'SPELL_BLOCK', 1, 'morphling_linken_sphere');
    const blockedFixture = makeDeathEngine([blockedAttacker, blockedTarget]);
    const blockedOptions: DamageApplicationOptions = { respectDefenses: true };
    const blockedActual = blockedFixture.engine.applyDamage(
      blockedFixture.engine.fighters[1],
      50,
      'skill',
      false,
      blockedFixture.engine.fighters[0],
      blockedOptions,
    );
    assert(blockedActual === 0 && blockedOptions.resolution?.outcome === 'spell_blocked', 'Spell block should produce a typed zero-damage outcome');
    assert(blockedFixture.engine.fighters[0].stats.dmgDealt === 0, 'Blocked damage should not inflate attacker damage statistics');
    cases.push('damage ledger separates HP, shields, overkill, and blocked outcomes');
  }

  {
    const first = seededTrace(20260712);
    const replay = seededTrace(20260712);
    assert(first === replay, 'The same roster and seed should reproduce an identical structured battle trace');
    cases.push('seeded structured events replay deterministically');
  }

  return cases;
}
