import {
  applyHerobrineWitness,
  captureHerobrineRecentSkill,
  executeHerobrineTurn,
  executeHerobrineCloneTurn,
  getHerobrineDamageMultiplier,
  getWitnessStacks,
  HEROBRINE_DONT_LOOK_BACK,
  HEROBRINE_ISOLATED,
  HEROBRINE_WITHER,
  HEROBRINE_WITNESS,
  noteHerobrineDirectHit,
  processHerobrineGlobalActionEnd,
  processHerobrineLargeRoundEnd,
  spawnHerobrineEvent,
} from '../../../lib/namearena/herobrineMechanics';
import { forceMajorNpcEvent, trySpawnMajorNpcEvent } from '../../../lib/namearena/majorNpcEvents';
import {
  configureNpcUnit,
  getHerobrineEvent,
  isHerobrine,
  isHerobrineClone,
  isHerobrineEventUnit,
  isHerobrineTrace,
  isNpcAoeVulnerable,
  isNpcTargetable,
  hasSettlementBlockingNpc,
  shouldRenderNpcUnit,
} from '../../../lib/namearena/npcCombat';
import { isAoeVulnerableTarget } from '../../../lib/namearena/targeting';
import { resolveHealing } from '../../../lib/namearena/combatState';
import { buildMajorNpcEventPresentation } from '../../../lib/namearena/battlePresentation';
import { buildFighterStatusPresentation } from '../../../lib/namearena/statusPresentation';
import { formatFighterTeamDisplayLabel } from '../../../lib/namearena/teamPresentation';
import {
  applyStatus,
  findIdentity,
  grantBarrier,
  getBarrierTotal,
  removeBarriers,
  removeEffects,
} from '../../../lib/namearena/statusSystem';
import { advanceLargeRoundTimedEffects } from '../../../lib/namearena/statusProcessing';
import type { Fighter, HerobrineEventState, SpinalSwordRef } from '../../../lib/namearena/types';
import { resolveDeclarativeSkillDispel } from '../../../lib/namearena/skillDispel';
import {
  ensureYuzuMarkedTarget,
  ensureYuzuOpeningShield,
  YUZU_BARRIER_IDENTITY,
} from '../../../lib/namearena/yuzuMechanics';
import { getOwlPhaseTwoLightningTargets } from '../../../lib/namearena/owlMechanics';
import {
  assert,
  makeFighter,
  withRandomSequence,
} from '../shared/harness';
import { makeDeathEngine } from './deathAccountingCases';

type Fixture = ReturnType<typeof makeDeathEngine> & {
  herobrine: Fighter;
  event: HerobrineEventState;
};

function fixtureNames(): string[] {
  return ['玄凝@A', '小汀@B', '牢鳄@C', '丝瓜uli@D', 'M1A2_abrams_sep@E'];
}

function spawnFixture(
  names = fixtureNames(),
  traceRolls?: [number, number],
): Fixture {
  const base = makeDeathEngine(names.map(makeFighter));
  const spawn = () => spawnHerobrineEvent(base.engine.createHerobrineRuntime(), 'Herobrine 专项回归强制出场');
  const herobrine = traceRolls
    ? withRandomSequence([
        ...Array.from({ length: 31 }, () => 0.1),
        ...traceRolls,
        ...Array.from({ length: 100 }, () => 0.1),
      ], spawn)
    : spawn();
  const event = getHerobrineEvent(base.engine.battleState);
  assert(herobrine && event, 'Herobrine fixture should create a major event and its hidden actor');
  return { ...base, herobrine, event };
}

function setTurn(fixture: Fixture, turn: number): void {
  fixture.engine.turnCount = turn;
  fixture.engine.battleState.turnCount = turn;
}

function advanceGlobalAction(fixture: Fixture, turn: number, roll = 0): void {
  setTurn(fixture, turn);
  withRandomSequence(Array.from({ length: 80 }, () => roll), () => {
    processHerobrineGlobalActionEnd(fixture.engine.createHerobrineRuntime());
  });
}

function revealHerobrine(fixture: Fixture): void {
  advanceGlobalAction(fixture, fixture.event.startedTurn + 10);
  assert(
    fixture.event.phase === 'phase_one',
    `Herobrine should formally appear after ten global actions: phase=${fixture.event.phase}; fighters=${fixture.engine.fighters.map((fighter) => `${fighter.name}:${fighter.currentHp}:${fighter.isDead ? 'dead' : 'alive'}`).join(',')}`,
  );
}

function enterPhaseTwo(fixture: Fixture): void {
  revealHerobrine(fixture);
  fixture.herobrine.currentHp = Math.floor(fixture.herobrine.maxHp * 0.6);
  fixture.engine.syncHpPct(fixture.herobrine);
  advanceGlobalAction(fixture, fixture.event.startedTurn + 11);
  assert(fixture.event.phase === 'phase_two', 'Herobrine should enter phase two at sixty percent HP');
}

function activeTraces(fixture: Fixture): Fighter[] {
  return fixture.engine.fighters.filter((fighter) =>
    isHerobrineTrace(fighter) &&
    fixture.engine.isActiveCombatant(fighter),
  );
}

function forceFogBehind(fixture: Fixture, attacker = fixture.engine.fighters[0]): void {
  for (let hit = 0; hit < 3; hit += 1) {
    noteHerobrineDirectHit(
      fixture.engine.createHerobrineRuntime(),
      attacker,
      fixture.herobrine,
      1,
      'custom',
    );
  }
  assert(
    (fixture.event.hiddenUntilTurn ?? 0) > fixture.engine.turnCount &&
    !isNpcTargetable(fixture.herobrine) &&
    !shouldRenderNpcUnit(fixture.herobrine),
    `Three direct hits should hide Herobrine inside the tunnel: ${JSON.stringify({
      attacker: attacker.name,
      phase: fixture.event.phase,
      turn: fixture.engine.turnCount,
      largeRound: fixture.engine.battleState.largeRound.number,
      directHits: fixture.event.directHitsSinceFog,
      hiddenUntilTurn: fixture.event.hiddenUntilTurn,
      fogCooldownUntilLargeRound: fixture.event.fogCooldownUntilLargeRound,
      tunnelCount: activeTraces(fixture).filter((trace) => trace.npcUnitState?.traceKind === 'tunnel').length,
      targetable: isNpcTargetable(fixture.herobrine),
      visible: shouldRenderNpcUnit(fixture.herobrine),
    })}`,
  );
}

export function runHerobrineCases(): string[] {
  const cases: string[] = [];

  {
    const aoeOnlyNpc = configureNpcUnit(
      makeFighter('AOE能力测试NPC'),
      'herobrine',
      'herobrine_leafless_tree',
      { targetable: false, aoeVulnerable: true },
    );
    assert(!isNpcTargetable(aoeOnlyNpc), 'AOE-only NPC should remain unavailable to single-target selection');
    assert(isAoeVulnerableTarget(aoeOnlyNpc), 'AOE capability must not depend on single-target capability');
    const singleTargetOnlyNpc = configureNpcUnit(
      makeFighter('单体能力测试NPC'),
      'herobrine',
      'herobrine_tunnel',
      { targetable: true, aoeVulnerable: false },
    );
    assert(isNpcTargetable(singleTargetOnlyNpc), 'Single-target NPC should remain selectable');
    assert(!isAoeVulnerableTarget(singleTargetOnlyNpc), 'Single-target capability must not imply AOE vulnerability');
    const attacker = makeFighter('NPC能力测试攻击者');
    const { engine } = makeDeathEngine([attacker, aoeOnlyNpc, singleTargetOnlyNpc]);
    const [runtimeAttacker, runtimeAoeOnly, runtimeSingleOnly] = engine.fighters;
    const aoeDamage = engine.applyDamage(runtimeAoeOnly, 100, 'skill', false, runtimeAttacker, {
      sourceKind: 'standard',
      isAreaDamage: true,
    });
    const blockedSingleDamage = engine.applyDamage(runtimeAoeOnly, 100, 'skill', false, runtimeAttacker, {
      sourceKind: 'standard',
    });
    const blockedAoeDamage = engine.applyDamage(runtimeSingleOnly, 100, 'skill', false, runtimeAttacker, {
      sourceKind: 'standard',
      isAreaDamage: true,
    });
    const singleDamage = engine.applyDamage(runtimeSingleOnly, 100, 'skill', false, runtimeAttacker, {
      sourceKind: 'standard',
    });
    assert(aoeDamage > 0 && blockedSingleDamage === 0, 'AOE-only NPC should accept only area damage');
    assert(blockedAoeDamage === 0 && singleDamage > 0, 'Single-target-only NPC should reject area damage');
    cases.push('NPC single-target and AOE capabilities remain independent');
  }

  {
    const counts = { puruisaishi: 0, herobrine: 0 };
    for (let seed = 1; seed <= 40; seed += 1) {
      const fixture = makeDeathEngine(fixtureNames().map(makeFighter));
      fixture.engine.battleState.seed = seed;
      fixture.engine.battleState.rngState = seed;
      fixture.engine.turnCount = 30;
      fixture.engine.battleState.turnCount = 30;
      const kind = withRandomSequence(Array.from({ length: 180 }, () => 0), () =>
        trySpawnMajorNpcEvent({
          herobrine: fixture.engine.createHerobrineRuntime(),
          puruisaishi: fixture.engine.createPuruisaishiRuntime(),
        }),
      );
      assert(kind, `Seed ${seed} should trigger a forced natural major-event roll`);
      counts[kind] += 1;
    }
    assert(
      counts.puruisaishi >= 14 && counts.herobrine >= 14,
      `Deterministic major-event selection should remain approximately 50/50, got ${JSON.stringify(counts)}`,
    );

    const mutual = makeDeathEngine(fixtureNames().map(makeFighter));
    assert(
      forceMajorNpcEvent({
        herobrine: mutual.engine.createHerobrineRuntime(),
        puruisaishi: mutual.engine.createPuruisaishiRuntime(),
      }, 'puruisaishi', '互斥回归'),
      'The first major event should start',
    );
    assert(
      !forceMajorNpcEvent({
        herobrine: mutual.engine.createHerobrineRuntime(),
        puruisaishi: mutual.engine.createPuruisaishiRuntime(),
      }, 'herobrine', '互斥回归'),
      'A second major event must not replace the active one',
    );
    cases.push('major NPC event selection is deterministic, balanced, and mutually exclusive');
  }

  {
    const fixture = spawnFixture();
    assert(!shouldRenderNpcUnit(fixture.herobrine), 'Fog-stage Herobrine must not render a battlefield card');
    assert(!isNpcTargetable(fixture.herobrine), 'Fog-stage Herobrine must not be selectable');
    assert(!isNpcAoeVulnerable(fixture.herobrine), 'Fog-stage Herobrine must ignore AOE');
    assert(
      fixture.herobrine.morale === undefined &&
      fixture.herobrine.maxMorale === undefined &&
      fixture.herobrine.stagger === undefined &&
      fixture.herobrine.staggerThreshold === undefined,
      'NPC creation must not leave player-only morale or stagger resources on Herobrine',
    );
    const traces = activeTraces(fixture);
    assert(traces.length === 2, `Herobrine should create exactly two initial traces, got ${traces.length}`);
    assert(new Set(traces.map((trace) => trace.npcUnitState?.traceKind)).size === 2, 'Initial traces must be different kinds');
    traces.forEach((trace) => {
      const isPyramid = trace.npcUnitState?.traceKind === 'sand_pyramid';
      assert(isNpcTargetable(trace) === isPyramid, `${trace.name} targetability should match its trace rules`);
      assert(isNpcAoeVulnerable(trace) === isPyramid, `${trace.name} AOE rule should match its trace rules`);
      assert(
        formatFighterTeamDisplayLabel(trace, fixture.engine.fighters) === undefined,
        `${trace.name} must not expose its internal NPC team identifier in the battlefield UI`,
      );
      assert(
        trace.morale === undefined && trace.stagger === undefined,
        `${trace.name} must not inherit player-only morale or stagger resources`,
      );
    });
    const owlAoeTargets = getOwlPhaseTwoLightningTargets(
      fixture.engine.createOwlRuntime(),
      fixture.engine.fighters[0],
    );
    assert(
      !owlAoeTargets.some((target) =>
        isHerobrine(target) ||
        (target.isNpc && !isNpcAoeVulnerable(target))
      ),
      'Full-field AOE target lists must exclude hidden Herobrine and AOE-immune traces before logging',
    );
    assert(!fixture.engine.getSelectableTargets(fixture.engine.fighters[0]).some(isHerobrine), 'Players must not target hidden Herobrine');
    cases.push('fog-stage Herobrine is hidden and initial trace capabilities are authoritative');
  }

  {
    const fixture = spawnFixture();
    revealHerobrine(fixture);
    const attacker = fixture.engine.fighters[0];
    attacker.atk = Math.max(attacker.atk, 300);
    fixture.engine.applyStatus(attacker, {
      identityId: 'AIM',
      charges: 1,
      attribution: {
        effectSourceId: 'herobrine-explicit-damage-regression',
        effectSourceName: '异常事件实际伤害回归',
        applierId: attacker.id,
        applierName: attacker.name,
      },
    });
    const logsBefore = fixture.logs.length;
    withRandomSequence(Array.from({ length: 40 }, () => 0), () => {
      fixture.engine.executeSkillAction(null, attacker, fixture.herobrine);
    });
    const actionLogs = fixture.logs.slice(logsBefore);
    assert(
      actionLogs.some((entry) =>
        entry.text.includes('【异常事件伤害结算】') &&
        entry.text.includes(attacker.name) &&
        entry.text.includes('Herobrine') &&
        entry.text.includes('点物理伤害')
      ),
      `Every ordinary hit on an event unit must state actor, target, type and actual damage: ${JSON.stringify(actionLogs)}`,
    );

    fixture.event.finalPursuit = true;
    fixture.event.finalPursuitContestantId = attacker.id;
    fixture.herobrine.currentHp = 1;
    fixture.engine.syncHpPct(fixture.herobrine);
    fixture.engine.applyStatus(attacker, {
      identityId: 'AIM',
      charges: 1,
      attribution: {
        effectSourceId: 'herobrine-lethal-damage-regression',
        effectSourceName: '异常事件致命伤害回归',
        applierId: attacker.id,
        applierName: attacker.name,
      },
    });
    const lethalStart = fixture.logs.length;
    withRandomSequence(Array.from({ length: 40 }, () => 0), () => {
      fixture.engine.executeSkillAction(null, attacker, fixture.herobrine);
    });
    const lethalLogs = fixture.logs.slice(lethalStart);
    const actualIndex = lethalLogs.findIndex((entry) => entry.text.includes('【异常事件伤害结算】'));
    const removalIndex = lethalLogs.findIndex((entry) => entry.text.includes('【真正退场】'));
    assert(
      actualIndex >= 0 && removalIndex > actualIndex,
      `A lethal event hit must state actual damage before the removal result: ${JSON.stringify(lethalLogs)}`,
    );
    cases.push('ordinary and lethal hits on Herobrine always log explicit typed actual damage before removal');
  }

  {
    const fixture = spawnFixture(['兔卷卷@A', '玄凝@B', '小汀@C'], [0, 0]);
    revealHerobrine(fixture);
    forceFogBehind(fixture);
    const rabbit = fixture.engine.fighters.find((fighter) => fighter.isTuJuanJuan);
    assert(rabbit, 'Hidden clone regression requires Rabbit');
    const clone = configureNpcUnit(
      makeFighter('Herobrine'),
      'herobrine',
      'herobrine_clone',
      {
        actionMode: 'normal',
        visible: true,
        targetable: true,
        aoeVulnerable: true,
      },
    );
    if (clone.npcUnitState) {
      clone.npcUnitState.cloneIndex = 1;
      clone.npcUnitState.revealed = false;
    }
    fixture.engine.fighters.push(clone);
    fixture.event.cloneIds.push(clone.id);

    const blockedOnBody = fixture.engine.applyStatus(fixture.herobrine, {
      identityId: 'ZEROED',
      remainingTurns: 3,
      attribution: {
        effectSourceId: 'hidden-herobrine-status-regression',
        effectSourceName: '隐匿本体状态回归',
        applierId: rabbit.id,
        applierName: rabbit.name,
      },
    });
    assert(
      !blockedOnBody &&
      !findIdentity(fixture.herobrine, 'ZEROED') &&
      fixture.logs.some((entry) =>
        entry.text.includes('【NPC目标规则】') &&
        entry.text.includes('【未知】') &&
        entry.text.includes('【归零】没有生效')
      ),
      'A hostile status must not bypass the hidden NPC targeting boundary',
    );

    const resolvedOnClone = fixture.engine.executeSkillAction('v_rabbit_zero', rabbit, clone);
    assert(
      resolvedOnClone &&
      clone.npcUnitState?.revealed === true &&
      clone.name === '白眼分身#1' &&
      !!findIdentity(clone, 'ZEROED') &&
      !findIdentity(fixture.herobrine, 'ZEROED'),
      'A hostile non-damaging skill should reveal and affect the clone without touching the hidden body',
    );
    assert(
      fixture.logs.some((entry) =>
        entry.text.includes('【错误的玩家】') &&
        entry.text.includes('白眼分身#1') &&
        entry.text.includes('伪装破裂')
      ) &&
      fixture.logs.some((entry) =>
        entry.text.includes('【归零】降维打击') &&
        entry.text.includes('白眼分身#1')
      ),
      'Clone reveal must precede a clear hostile-status result in the battle log',
    );
    cases.push('hidden Herobrine rejects hostile statuses while a disguised clone reveals on hostile non-damage contact');
  }

  {
    const fixture = spawnFixture(['柚子@A', '玄凝@B', '小汀@C', '牢鳄@D', '丝瓜uli@E'], [0, 0]);
    revealHerobrine(fixture);
    const yuzu = fixture.engine.fighters.find((fighter) => fighter.isYuzu);
    assert(yuzu, 'Yuzu interaction regression requires Yuzu');
    yuzu.yuzuPhase = 3;
    for (const fighter of fixture.engine.fighters) {
      if (!fighter.isNpc && fighter.id !== yuzu.id) fighter.teamId = yuzu.teamId;
    }
    const marked = ensureYuzuMarkedTarget(fixture.engine.createCharacterHookRuntime(), yuzu);
    assert(
      marked?.id === fixture.herobrine.id &&
      findIdentity(fixture.herobrine, 'YUZU_MARKED')?.attribution.effectSourceId === yuzu.id,
      'A revealed and targetable Herobrine should be eligible for Yuzu phase-three marking',
    );
    cases.push('Yuzu can mark targetable Herobrine event units without reopening Puruisaishi or Ananna targeting');
  }

  {
    const fixture = spawnFixture();
    advanceGlobalAction(fixture, fixture.event.startedTurn + 5, 0.5);
    assert(fixture.event.hiddenAttackResolved, 'Fog-stage hidden attack should resolve at five global actions');
    assert(
      fixture.logs.some((entry) => entry.text.includes('【未知】') && entry.text.includes('实际生命伤害')),
      'The fog-stage hit should be attributed to 【未知】 and state its actual damage',
    );
    const hiddenAttackStart = fixture.engine.events.find((entry) =>
      entry.kind === 'action_start' && entry.skillId === 'herobrine_unknown_attack'
    );
    const hiddenAttackCue = fixture.logs.find((entry) =>
      entry.visualCue?.kind === 'combat_action' &&
      entry.visualCue.effectId === 'herobrine_hidden_strike'
    );
    assert(
      hiddenAttackStart?.presentation === 'basic' &&
      hiddenAttackCue?.visualCue?.kind === 'combat_action' &&
      hiddenAttackCue.visualCue.presentation === 'basic',
      'Fog-stage ordinary attacks must remain basic attacks in both action and visual metadata',
    );
    advanceGlobalAction(fixture, fixture.event.startedTurn + 10);
    assert(fixture.event.phase === 'phase_one', 'Herobrine should reveal at ten global actions');
    assert(shouldRenderNpcUnit(fixture.herobrine) && isNpcTargetable(fixture.herobrine), 'Revealed Herobrine should render and be targetable');
    assert(
      fixture.logs.filter((entry) => entry.visualCue?.kind === 'form_shift' && entry.visualCue.fighterId === fixture.herobrine.id).length === 1,
      'Fog reveal should emit exactly one short form-shift visual',
    );
    cases.push('fog lifecycle resolves one unknown attack and one authoritative reveal');
  }

  {
    const fixture = spawnFixture(['水人@A', '玄凝@B', '小汀@C', '牢鳄@D', '丝瓜uli@E']);
    const target = fixture.engine.fighters[0];
    applyHerobrineWitness(fixture.engine.createHerobrineRuntime(), target, 8, '目击上限回归');
    assert(getWitnessStacks(target) === 5, 'Witness should cap at five stacks');
    const trace = activeTraces(fixture)[0];
    assert(trace, 'Witness NPC immunity test requires a trace');
    assert(
      !fixture.engine.applyStatus(trace, {
        identityId: HEROBRINE_WITNESS,
        potency: 1,
        attribution: { effectSourceId: 'test', effectSourceName: '测试' },
      }),
      'NPC units must reject Witness',
    );
    const summon = makeFighter('目击召唤物');
    summon.isSummon = true;
    summon.cannotWin = true;
    summon.summonerId = target.id;
    fixture.engine.fighters.push(summon);
    applyHerobrineWitness(fixture.engine.createHerobrineRuntime(), summon, 2, '召唤物独立目击回归');
    assert(getWitnessStacks(summon) === 2, 'A summon should keep its own Witness stacks even when it cannot win');
    assert(getWitnessStacks(target) === 5, 'A summon gaining Witness must not alter its owner stacks');
    const exposedTrace = activeTraces(fixture).find((trace) => trace.npcUnitState?.traceKind === 'sand_pyramid')
      ?? activeTraces(fixture)[0];
    advanceGlobalAction(fixture, fixture.event.startedTurn + 10);
    advanceGlobalAction(fixture, fixture.event.startedTurn + 50);
    const clone = fixture.engine.fighters.find(isHerobrineClone);
    assert(
      exposedTrace &&
      clone &&
      getHerobrineDamageMultiplier(target, fixture.herobrine) === 1.2 &&
      getHerobrineDamageMultiplier(target, exposedTrace) === 1.2 &&
      getHerobrineDamageMultiplier(target, clone) === 1.2,
      'Seen Through should grant the same direct-damage bonus against Herobrine, exposed traces, and clones',
    );

    fixture.engine.applyStatus(target, {
      identityId: 'OUTPUT_UP',
      potency: 20,
      remainingTurns: 3,
      attribution: { effectSourceId: 'test:buff', effectSourceName: '普通限时增益' },
    });
    assert(findIdentity(target, 'OUTPUT_UP')?.remainingTurns === 2, 'Three-plus Witness should shorten an ordinary timed buff by one turn');
    assert(
      !fixture.engine.applyStatus(target, {
        identityId: 'HASTE',
        potency: 15,
        attribution: { effectSourceId: 'implicit-one-turn-buff', effectSourceName: '隐式一回合增益' },
      }) &&
      !findIdentity(target, 'HASTE'),
      'Three-plus Witness should reduce an implicit one-turn ordinary buff to zero instead of leaving it active',
    );
    const directTimedBuff = applyStatus(target, {
      identityId: 'HASTE',
      potency: 15,
      remainingTurns: 3,
      attribution: { effectSourceId: 'direct-service-buff', effectSourceName: '底层状态服务增益' },
    });
    assert(
      directTimedBuff.durationAdjustment?.appliedTurns === 2 &&
      findIdentity(target, 'HASTE')?.remainingTurns === 2,
      'The unified status service must enforce Witness duration reduction even when a character bypasses BattleEngine.applyStatus',
    );
    removeEffects(target, { identityIds: ['HASTE'], reason: 'scripted' });
    const directOneTurnBuff = applyStatus(target, {
      identityId: 'HASTE',
      potency: 15,
      attribution: { effectSourceId: 'direct-one-turn-buff', effectSourceName: '底层一回合增益' },
    });
    assert(
      directOneTurnBuff.blockedReason === 'duration_reduced_to_zero' &&
      directOneTurnBuff.statuses.length === 0 &&
      !findIdentity(target, 'HASTE'),
      'The unified status service must also block direct implicit one-turn buffs at three-plus Witness',
    );
    const ordinaryTarget = fixture.engine.fighters[1];
    applyHerobrineWitness(
      fixture.engine.createHerobrineRuntime(),
      ordinaryTarget,
      3,
      '非水人绝对驱散保护回归',
    );
    const ordinaryWitnessBeforeDispel = getWitnessStacks(ordinaryTarget);
    fixture.engine.dispelStatusEffects(ordinaryTarget, {
      strength: 'absolute',
      direction: 'all',
      includeNeutral: true,
      includeIndependent: true,
    });
    assert(
      ordinaryWitnessBeforeDispel > 0 && getWitnessStacks(ordinaryTarget) === ordinaryWitnessBeforeDispel,
      `Absolute dispel from a non-Morphling lifecycle must not clear Witness: ${ordinaryTarget.name}, morphling=${!!ordinaryTarget.isMorphling}, before=${ordinaryWitnessBeforeDispel}, after=${getWitnessStacks(ordinaryTarget)}`,
    );
    fixture.engine.dispelStatusEffects(target, {
      strength: 'absolute',
      direction: 'negative',
    });
    assert(getWitnessStacks(target) === 0, 'Morphling absolute dispel should clear its own Witness');
    cases.push('Witness caps at five, excludes NPCs, tracks summons independently, shortens ordinary buffs, and only yields to Morphling absolute dispel');
  }

  {
    const fixture = spawnFixture(fixtureNames(), [0.99, 0.99]);
    const pyramid = activeTraces(fixture).find((trace) => trace.npcUnitState?.traceKind === 'sand_pyramid');
    const protectedTrace = activeTraces(fixture).find((trace) => trace.id !== pyramid?.id);
    assert(pyramid && protectedTrace, 'Trace damage regression requires a pyramid and a protected trace');
    const attacker = fixture.engine.fighters[0];
    const controlLogStart = fixture.logs.length;
    assert(
      !fixture.engine.applyStatus(pyramid, {
        identityId: 'STUN',
        remainingTurns: 1,
        attribution: {
          effectSourceId: 'passive-trace-control-regression',
          effectSourceName: '被动痕迹控制回归',
          applierId: attacker.id,
          applierName: attacker.name,
        },
      }) &&
      !findIdentity(pyramid, 'STUN') &&
      fixture.logs.slice(controlLogStart).some((entry) =>
        entry.text.includes('【NPC行动规则】') &&
        entry.text.includes(pyramid.name) &&
        entry.text.includes('本来就不会行动')
      ),
      'A passive trace must reject action-blocking statuses and explain why they cannot take effect',
    );
    const protectedHp = protectedTrace.currentHp;
    const blocked = fixture.engine.applyDamage(
      protectedTrace,
      500,
      'skill',
      true,
      attacker,
      { actionName: '痕迹 AOE 回归', sourceKind: 'custom', isAreaDamage: true },
    );
    assert(blocked === 0 && protectedTrace.currentHp === protectedHp, 'Protected traces must ignore AOE');
    fixture.engine.markDefeated(pyramid, {
      killer: attacker,
      message: '测试摧毁金字塔',
    });
    assert(fixture.event.phase === 'phase_one', 'Destroying the pyramid during fog should force Herobrine to appear');
    assert(attacker.stats.kills === 0, 'Destroying a trace must not grant a normal kill');
    cases.push('passive traces reject action controls, protected traces ignore AOE, and pyramid defeat reveals Herobrine without kill credit');
  }

  {
    const fixture = spawnFixture(['萌月沫沫@A', '目击均摊舰长@A', '小汀@B', '牢鳄@C', '丝瓜uli@D'], [0, 0]);
    const momo = fixture.engine.fighters[0];
    const captain = fixture.engine.fighters[1];
    fixture.engine.initializeMomoTeams();
    momo.currentHp = Math.max(1, Math.floor(momo.maxHp * 0.4));
    fixture.engine.syncHpPct(momo);
    fixture.engine.handleTransformations(momo);
    assert(momo.momoState?.phase === 2, 'Herobrine share regression requires phase-two Momo');
    revealHerobrine(fixture);
    const witnessBefore = getWitnessStacks(momo);
    const momoHpBefore = momo.currentHp;
    const captainHpBefore = captain.currentHp;
    const logStart = fixture.logs.length;
    withRandomSequence(Array.from({ length: 80 }, () => 0), () => {
      executeHerobrineTurn(fixture.engine.createHerobrineRuntime(), fixture.herobrine, momo);
    });
    const actionLogs = fixture.logs.slice(logStart);
    assert(
      momo.currentHp === momoHpBefore &&
      captain.currentHp < captainHpBefore &&
      getWitnessStacks(momo) === Math.min(5, witnessBefore + 1),
      `Empty Gaze shared through |OMO must still count as a successful hit and add Witness to Momo: ${JSON.stringify({
        momoHpBefore,
        momoHpAfter: momo.currentHp,
        captainHpBefore,
        captainHpAfter: captain.currentHp,
        witnessBefore,
        witness: getWitnessStacks(momo),
        logs: actionLogs.map((entry) => entry.text),
      })}`,
    );
    assert(
      actionLogs.some((entry) =>
        entry.text.includes('【空洞凝视结算】') &&
        entry.text.includes('分摊或替代承伤者另承受')
      ),
      'Empty Gaze settlement must disclose redirected HP damage instead of reporting only zero damage to Momo',
    );
    cases.push('Herobrine direct damage shared through Momo remains visible and still applies Witness to the intended target');
  }

  {
    const fixture = spawnFixture(fixtureNames(), [0.99, 0.99]);
    const pyramid = activeTraces(fixture).find((trace) => trace.npcUnitState?.traceKind === 'sand_pyramid');
    assert(pyramid?.npcUnitState?.collapseAfterLargeRound !== undefined, 'Pyramid attribution regression requires a scheduled pyramid');
    assert(
      pyramid.npcUnitState.collapseAfterLargeRound === fixture.engine.battleState.largeRound.number,
      'A pyramid spawned before the opening round should collapse when that first full large round ends',
    );
    withRandomSequence(Array.from({ length: 160 }, () => 0), () => {
      processHerobrineLargeRoundEnd(
        fixture.engine.createHerobrineRuntime(),
        pyramid.npcUnitState!.collapseAfterLargeRound!,
      );
    });
    const witnessed = fixture.engine.fighters.find((fighter) =>
      findIdentity(fighter, HEROBRINE_WITNESS)?.attribution.applierId === pyramid.id,
    );
    assert(witnessed, 'Witness applied by a collapsing pyramid should preserve the pyramid as its structured source');
    assert(
      fixture.logs.some((entry) =>
        entry.actorId === pyramid.id &&
        entry.text.includes('【目击】') &&
        entry.targetIds?.includes(witnessed.id)
      ),
      'Pyramid Witness log should use the same trace actor as the stored status attribution',
    );
    cases.push('pyramid Witness preserves its trace source in status attribution and logs');
  }

  {
    const base = makeDeathEngine(fixtureNames().map(makeFighter));
    base.engine.battleState.largeRound.participantIds = base.engine.fighters.map((fighter) => fighter.id);
    base.engine.battleState.largeRound.actedIds = [base.engine.fighters[0].id];
    base.engine.battleState.largeRound.actionCount = 1;
    withRandomSequence([
      ...Array.from({ length: 31 }, () => 0.1),
      0.99,
      0.99,
      ...Array.from({ length: 100 }, () => 0.1),
    ], () => {
      spawnHerobrineEvent(base.engine.createHerobrineRuntime(), '大回合中途出场回归');
    });
    const pyramid = base.engine.fighters.find((fighter) =>
      isHerobrineTrace(fighter) &&
      fighter.npcUnitState?.traceKind === 'sand_pyramid',
    );
    assert(
      pyramid?.npcUnitState?.collapseAfterLargeRound === base.engine.battleState.largeRound.number + 1,
      'A pyramid spawned during an active large round should wait through the next complete large round',
    );
    cases.push('pyramid collapse timing gives exactly one full large round at both opening and mid-round spawns');
  }

  {
    const fixture = spawnFixture(fixtureNames(), [0, 0]);
    const firstTree = activeTraces(fixture).find((trace) => trace.npcUnitState?.traceKind === 'leafless_tree');
    assert(firstTree, 'Multi-tree regression requires an initial leafless tree');
    const secondTree = configureNpcUnit(
      makeFighter('无叶之树#2'),
      'herobrine',
      'herobrine_leafless_tree',
      {
        actionMode: 'none',
        visible: true,
        targetable: false,
        aoeVulnerable: false,
      },
    );
    secondTree.npcUnitState!.traceKind = 'leafless_tree';
    secondTree.npcUnitState!.exposed = false;
    fixture.engine.fighters.push(secondTree);
    fixture.event.traceIds.push(secondTree.id);

    withRandomSequence(Array.from({ length: 160 }, () => 0), () => {
      processHerobrineLargeRoundEnd(fixture.engine.createHerobrineRuntime(), 1);
    });
    const treeActors = new Set(
      fixture.logs
        .filter((entry) => entry.text.includes('【无叶之树】第 2 个大回合开始时'))
        .map((entry) => entry.actorId),
    );
    assert(
      treeActors.has(firstTree.id) && treeActors.has(secondTree.id) && treeActors.size === 2,
      'Every active leafless tree must resolve exactly once at the same large-round boundary',
    );
    cases.push('multiple leafless trees each resolve once per large round');
  }

  {
    const fixture = spawnFixture(['柚子@A', '玄凝@B', '小汀@C', '牢鳄@D', '丝瓜uli@E'], [0, 0]);
    const yuzu = fixture.engine.fighters.find((fighter) => fighter.isYuzu);
    assert(yuzu, 'Leafless-tree barrier regression requires Yuzu');
    const before = getBarrierTotal(yuzu, { identityIds: [YUZU_BARRIER_IDENTITY] });
    assert(before > 0, 'Yuzu must begin the barrier regression with a mirror barrier');
    withRandomSequence(Array.from({ length: 120 }, () => 0), () => {
      processHerobrineLargeRoundEnd(fixture.engine.createHerobrineRuntime(), 1);
    });
    const after = getBarrierTotal(yuzu, { identityIds: [YUZU_BARRIER_IDENTITY] });
    assert(
      after === before - Math.max(1, Math.floor(before * 0.35)),
      'Leafless Tree must shave thirty-five percent from Yuzu mirror barrier even though the barrier itself is not dispellable',
    );
    assert(
      fixture.logs.some((entry) =>
        entry.text.includes('【无叶之树】') &&
        entry.text.includes('【镜界护盾】') &&
        entry.text.includes('被无叶枝条削去')
      ),
      'Leafless Tree must explain the exact mirror-barrier loss in the combat log',
    );
    cases.push('Leafless Tree can shave an undispellable Yuzu barrier without treating it as a status dispel');
  }

  {
    const fixture = spawnFixture();
    revealHerobrine(fixture);
    const target = fixture.engine.fighters[0];
    fixture.engine.applyStatus(target, {
      identityId: 'HASTE',
      potency: 20,
      remainingTurns: 2,
      attribution: {
        effectSourceId: 'stripped-leaves-log-regression',
        effectSourceName: '树叶文案回归增益',
        applierId: target.id,
        applierName: target.name,
      },
    });
    const logStart = fixture.logs.length;
    withRandomSequence([0, 0, 0.5, ...Array.from({ length: 80 }, () => 0)], () => {
      executeHerobrineTurn(fixture.engine.createHerobrineRuntime(), fixture.herobrine);
    });
    const logs = fixture.logs.slice(logStart);
    assert(
      !findIdentity(target, 'HASTE') && !!findIdentity(target, HEROBRINE_WITHER),
      'Stripped Leaves should remove the selected ordinary buff and then apply Wither',
    );
    assert(
      logs.some((entry) =>
        entry.text.includes('【枯萎】') &&
        entry.text.includes('普通增益或护盾被剥去后')
      ) &&
      !logs.some((entry) => entry.text.includes('【驱散】')) &&
      !logs.some((entry) =>
        entry.text.includes('【枯萎】') &&
        entry.text.includes('没有可剥离的普通增益')
      ),
      'Stripped Leaves must not claim that no removable buff existed after it just removed one',
    );
    cases.push('Stripped Leaves logs the removed benefit before its healing and barrier suppression');
  }

  {
    const fixture = spawnFixture();
    revealHerobrine(fixture);
    const target = fixture.engine.fighters[0];
    fixture.engine.applyStatus(target, {
      identityId: 'GAMER_RUSH_B',
      remainingTurns: 2,
      attribution: {
        effectSourceId: 'stripped-leaves-group-regression',
        effectSourceName: '组合增益剥离回归',
        applierId: target.id,
        applierName: target.name,
      },
    });
    assert(
      target.statuses.filter((status) => status.identityId === 'GAMER_RUSH_B').length === 2,
      'Rush B regression requires a two-mechanic grouped status',
    );
    withRandomSequence([0, 0, 0.5, ...Array.from({ length: 80 }, () => 0)], () => {
      executeHerobrineTurn(fixture.engine.createHerobrineRuntime(), fixture.herobrine);
    });
    assert(
      !findIdentity(target, 'GAMER_RUSH_B') &&
      !target.statuses.some((status) => status.identityId === 'GAMER_RUSH_B'),
      'Stripped Leaves must remove every mechanical member of the selected grouped status',
    );
    cases.push('Stripped Leaves removes a grouped ordinary buff as one complete themed status');
  }

  {
    const fixture = spawnFixture(fixtureNames(), [0, 0]);
    const meal = makeFighter('拼好饭');
    meal.isSummon = true;
    meal.cannotWin = true;
    meal.cannotAct = true;
    meal.owlSummonState = { kind: 'meal', spawnedTurn: fixture.engine.turnCount };
    fixture.engine.fighters.push(meal);
    enterPhaseTwo(fixture);
    assert(
      getWitnessStacks(meal) === 0,
      'Non-combat meal units must not receive the phase-two battlefield Witness pulse',
    );
    cases.push('non-combat food units are excluded from Herobrine target and Witness pools');
  }

  {
    const fixture = spawnFixture(fixtureNames(), [0, 0]);
    enterPhaseTwo(fixture);
    const isolated = fixture.engine.fighters[0];
    const existingTunnel = activeTraces(fixture)
      .find((trace) => trace.npcUnitState?.traceKind === 'tunnel');
    assert(existingTunnel, 'World Seed boundary regression requires an existing tunnel');
    fixture.event.singleWorld = {
      targetId: isolated.id,
      tunnelId: existingTunnel.id,
      startedLargeRound: fixture.engine.battleState.largeRound.number,
      endsAfterLargeRound: fixture.engine.battleState.largeRound.number + 1,
    };
    fixture.event.recentSkills[isolated.id] = {
      sourceActorId: isolated.id,
      sourceActorName: isolated.name,
      sourceSkillId: 'single-world-world-seed-regression',
      sourceSkillName: '单人世界残留回归',
      template: 'self_buff',
      potency: 0.8,
    };
    const beforeTraceIds = new Set(fixture.event.traceIds);
    withRandomSequence([0.5, 0, 0, ...Array.from({ length: 60 }, () => 0)], () => {
      executeHerobrineTurn(fixture.engine.createHerobrineRuntime(), fixture.herobrine);
    });
    const newTunnel = activeTraces(fixture).find((trace) =>
      !beforeTraceIds.has(trace.id) &&
      trace.npcUnitState?.traceKind === 'tunnel'
    );
    assert(
      newTunnel && isNpcTargetable(newTunnel) && isNpcAoeVulnerable(newTunnel),
      'A tunnel created during Single World must immediately be exposed to outside attackers',
    );

    fixture.event.worldSeedCooldownUntilTurn = fixture.engine.turnCount;
    const beforePyramidIds = new Set(fixture.event.traceIds);
    withRandomSequence([0.5, 0, 0.99, 0, ...Array.from({ length: 60 }, () => 0)], () => {
      executeHerobrineTurn(fixture.engine.createHerobrineRuntime(), fixture.herobrine);
    });
    const newPyramid = activeTraces(fixture).find((trace) =>
      !beforePyramidIds.has(trace.id) &&
      trace.npcUnitState?.traceKind === 'sand_pyramid'
    );
    assert(
      newPyramid?.npcUnitState?.markedTargetId !== isolated.id,
      'A pyramid created outside Single World must not mark the isolated participant across the boundary',
    );
    cases.push('World Seed traces inherit Single World exposure and choose boundary-valid pyramid targets');
  }

  {
    const fixture = spawnFixture(fixtureNames(), [0, 0]);
    enterPhaseTwo(fixture);
    const isolated = fixture.engine.fighters[0];
    const outsideSource = activeTraces(fixture).find((trace) => trace.npcUnitState?.traceKind === 'leafless_tree');
    const tunnel = activeTraces(fixture).find((trace) => trace.npcUnitState?.traceKind === 'tunnel');
    assert(outsideSource && tunnel, 'Witness boundary regression requires an outside trace and tunnel');
    fixture.event.singleWorld = {
      targetId: isolated.id,
      tunnelId: tunnel.id,
      startedLargeRound: fixture.engine.battleState.largeRound.number,
      endsAfterLargeRound: fixture.engine.battleState.largeRound.number + 1,
    };
    const beforeStacks = getWitnessStacks(isolated);
    const logsBeforeBlockedWitness = fixture.logs.length;
    const gained = applyHerobrineWitness(
      fixture.engine.createHerobrineRuntime(),
      isolated,
      1,
      '被隔离外的异常痕迹影响',
      outsideSource,
    );
    assert(
      gained === 0 && getWitnessStacks(isolated) === beforeStacks,
      'Witness must not cross the Single World boundary',
    );
    assert(
      !fixture.logs.slice(logsBeforeBlockedWitness).some((entry) => entry.text.includes('增加 0 层目击')),
      'A blocked Witness application must not emit a fake zero-stack gain log',
    );
    cases.push('blocked Witness applications do not cross Single World or emit zero-stack gain logs');
  }

  {
    const fixture = spawnFixture(fixtureNames(), [0, 0]);
    revealHerobrine(fixture);
    const attacker = fixture.engine.fighters[0];
    fixture.engine.battleState.largeRound.number = 4;
    attacker.wtMarkedTargetId = fixture.herobrine.id;
    attacker.gamerMarkedTargetId = fixture.herobrine.id;
    fixture.engine.applyStatus(fixture.herobrine, {
      identityId: 'WT_SCOUTED',
      remainingTurns: 3,
      attribution: {
        effectSourceId: 'herobrine-lock-regression',
        effectSourceName: '锁定回归',
        applierId: attacker.id,
        applierName: attacker.name,
      },
    });
    for (const identityId of ['GAMER_READ_INPUTS', 'VALO_CYPHER_REVEALED']) {
      fixture.engine.applyStatus(fixture.herobrine, {
        identityId,
        remainingTurns: 3,
        attribution: {
          effectSourceId: 'herobrine-lock-regression',
          effectSourceName: '锁定回归',
          applierId: attacker.id,
          applierName: attacker.name,
        },
      });
    }
    fixture.engine.applyDamage(
      fixture.herobrine,
      1,
      'counter',
      true,
      attacker,
      { actionName: '雾后反击命中回归', sourceKind: 'counter' },
    );
    assert(
      (fixture.event.directHitsSinceFog ?? 0) === 1,
      'A visible counterattack hit must count toward the three-hit Fog Behind trigger',
    );
    fixture.engine.applyDamage(
      fixture.herobrine,
      1,
      'transfer',
      true,
      attacker,
      { actionName: '雾后非直接伤害回归', sourceKind: 'transfer' },
    );
    assert(
      shouldRenderNpcUnit(fixture.herobrine) &&
      (fixture.event.directHitsSinceFog ?? 0) === 1,
      'Transferred damage must not count as a direct hit for Fog Behind',
    );
    for (let hit = 0; hit < 2; hit += 1) {
      fixture.engine.applyDamage(
        fixture.herobrine,
        1,
        'skill',
        true,
        attacker,
        { actionName: `雾后直击 ${hit + 1}`, sourceKind: 'custom' },
      );
    }
    assert(!shouldRenderNpcUnit(fixture.herobrine), 'A counterattack plus two direct hits should make Herobrine enter the tunnel');
    assert(
      !findIdentity(fixture.herobrine, 'WT_SCOUTED') &&
      !findIdentity(fixture.herobrine, 'GAMER_READ_INPUTS') &&
      !findIdentity(fixture.herobrine, 'VALO_CYPHER_REVEALED') &&
      attacker.wtMarkedTargetId === undefined &&
      attacker.gamerMarkedTargetId === undefined,
      'Fog Behind should clear every registered tracking lock and its owner pointer',
    );
    assert(fixture.event.hiddenUntilTurn === fixture.engine.turnCount + 5, 'Fog Behind should last five global actions');
    const hiddenHp = fixture.herobrine.currentHp;
    const blockedCounter = fixture.engine.applyDamage(
      fixture.herobrine,
      50,
      'counter',
      true,
      attacker,
      { actionName: '雾后隐藏反击回归', sourceKind: 'counter' },
    );
    assert(
      blockedCounter === 0 && fixture.herobrine.currentHp === hiddenHp,
      'Counterattacks must not hit Herobrine while he is hidden inside the tunnel',
    );
    const settledStatus = fixture.engine.applyDamage(
      fixture.herobrine,
      1,
      'status',
      true,
      attacker,
      { actionName: '雾后既有持续状态回归', sourceKind: 'status' },
    );
    assert(
      settledStatus === 1 && fixture.herobrine.currentHp === hiddenHp - 1,
      'Statuses already attached to Herobrine must keep settling while he is hidden',
    );
    fixture.engine.battleState.largeRound.number = 6;
    advanceGlobalAction(fixture, fixture.event.hiddenUntilTurn);
    assert(shouldRenderNpcUnit(fixture.herobrine), 'Herobrine should return after the hidden duration');
    assert(
      fixture.event.fogCooldownUntilLargeRound === 8,
      'Fog Behind cooldown must begin on return and last two complete large rounds',
    );
    assert(
      fixture.logs.filter((entry) =>
        entry.text.includes('【雾后之人】') &&
        entry.text.includes('连续承受 3 次直接攻击')
      ).length === 1,
      'Fog Behind should not trigger more than once from the same three hits',
    );
    cases.push('Fog Behind triggers on the third direct hit, respects duration, and returns without transforming');
  }

  {
    const fixture = spawnFixture(fixtureNames(), [0, 0]);
    revealHerobrine(fixture);
    const attacker = fixture.engine.fighters[0];
    fixture.engine.battleState.largeRound.number = 4;
    forceFogBehind(fixture, attacker);
    advanceGlobalAction(fixture, fixture.event.hiddenUntilTurn!);
    assert(
      fixture.event.fogCooldownUntilLargeRound === 6,
      'Fog Behind cooldown regression requires a two-round cooldown after return',
    );
    fixture.engine.battleState.largeRound.number = 5;
    for (let hit = 0; hit < 3; hit += 1) {
      noteHerobrineDirectHit(
        fixture.engine.createHerobrineRuntime(),
        attacker,
        fixture.herobrine,
        1,
        'custom',
      );
    }
    assert(
      shouldRenderNpcUnit(fixture.herobrine) &&
      (fixture.event.directHitsSinceFog ?? 0) === 0,
      'Direct hits during Fog Behind cooldown must not be banked',
    );
    fixture.engine.battleState.largeRound.number = 6;
    for (let hit = 0; hit < 2; hit += 1) {
      noteHerobrineDirectHit(
        fixture.engine.createHerobrineRuntime(),
        attacker,
        fixture.herobrine,
        1,
        'custom',
      );
    }
    assert(
      shouldRenderNpcUnit(fixture.herobrine) &&
      fixture.event.directHitsSinceFog === 2,
      'Fog Behind must remain visible until three fresh post-cooldown hits are counted',
    );
    noteHerobrineDirectHit(
      fixture.engine.createHerobrineRuntime(),
      attacker,
      fixture.herobrine,
      1,
      'custom',
    );
    assert(!shouldRenderNpcUnit(fixture.herobrine), 'The third fresh post-cooldown hit should trigger Fog Behind');
    cases.push('Fog Behind never banks direct hits through its cooldown or unavailable window');
  }

  {
    const fixture = spawnFixture(fixtureNames(), [0, 0]);
    revealHerobrine(fixture);
    const attacker = fixture.engine.fighters[0];
    let remainedVisibleThroughSecondHit = false;
    let hiddenAfterThirdHit = false;
    let fourthHitDamage = -1;
    fixture.engine.runReactionAction(attacker, {
      skillId: 'herobrine_fog_multihit_regression',
      skillName: '雾后多段时序回归',
      targets: [fixture.herobrine],
    }, () => {
      for (let hit = 0; hit < 3; hit += 1) {
        const options = {
          actionName: `雾后多段时序回归 ${hit + 1}`,
          sourceKind: 'custom' as const,
          deferTransform: true,
        };
        const actual = fixture.engine.applyDamage(
          fixture.herobrine,
          1,
          'skill',
          true,
          attacker,
          options,
        );
        fixture.engine.flushDeferredDamageEvents(fixture.herobrine, 'mitigation');
        fixture.engine.log('info', `【雾后多段结果】第 ${hit + 1} 击实际造成 ${actual} 点伤害。`);
        fixture.engine.flushDeferredDamageEvents(fixture.herobrine);
        if (hit === 1) remainedVisibleThroughSecondHit = shouldRenderNpcUnit(fixture.herobrine);
        if (hit === 2) hiddenAfterThirdHit = !shouldRenderNpcUnit(fixture.herobrine);
      }
      fourthHitDamage = fixture.engine.applyDamage(
        fixture.herobrine,
        1,
        'skill',
        true,
        attacker,
        { actionName: '雾后多段时序回归 4', sourceKind: 'custom', deferTransform: true },
      );
    });
    const thirdResultIndex = fixture.logs.findIndex((entry) => entry.text.includes('【雾后多段结果】第 3 击'));
    const fogIndex = fixture.logs.findIndex((entry) => entry.text.includes('【雾后之人】'));
    assert(
      remainedVisibleThroughSecondHit && hiddenAfterThirdHit && fourthHitDamage === 0,
      'Fog Behind must enter immediately after the third settled hit and reject later hits in the same combo',
    );
    assert(
      thirdResultIndex >= 0 && fogIndex > thirdResultIndex,
      'The third hit result must be narrated before Fog Behind removes Herobrine from the field',
    );
    cases.push('Fog Behind enters after the third settled hit and interrupts the remaining combo');
  }

  {
    const fixture = spawnFixture(fixtureNames(), [0, 0]);
    revealHerobrine(fixture);
    const attacker = fixture.engine.fighters[0];
    let hiddenAfterNestedCounter = false;
    fixture.engine.runReactionAction(fixture.herobrine, {
      skillId: 'herobrine_fog_outer_action_regression',
      skillName: '雾后外层行动回归',
      targets: [attacker],
    }, () => {
      fixture.engine.runReactionAction(attacker, {
        skillId: 'herobrine_fog_nested_counter_regression',
        skillName: '雾后嵌套反击回归',
        targets: [fixture.herobrine],
      }, () => {
        for (let hit = 0; hit < 3; hit += 1) {
          const options = {
            actionName: `雾后嵌套反击回归 ${hit + 1}`,
            sourceKind: 'counter' as const,
            deferTransform: true,
          };
          fixture.engine.applyDamage(
            fixture.herobrine,
            1,
            'counter',
            true,
            attacker,
            options,
          );
          fixture.engine.flushDeferredDamageEvents(fixture.herobrine);
        }
      });
      hiddenAfterNestedCounter = !shouldRenderNpcUnit(fixture.herobrine);
      fixture.engine.log(
        'skill',
        `◻️ 【雾后外层行动回归】${fixture.herobrine.name} 完成本次技能的剩余结算。`,
      );
    });
    assert(
      hiddenAfterNestedCounter,
      'A nested counter that settles the third direct hit must hide Herobrine before the outer action resumes',
    );
    assert(
      !shouldRenderNpcUnit(fixture.herobrine) &&
      fixture.logs.some((entry) =>
        entry.text.includes('【雾后外层行动回归】【未知】 完成本次技能的剩余结算')
      ),
      'After the counter forces a retreat, any remaining outer narration must use the hidden identity',
    );
    cases.push('Nested counters commit Fog Behind at the third settled hit without leaking the visible identity');
  }

  {
    const fixture = spawnFixture(['测试甲@A', '测试乙@B', '测试丙@C', '测试丁@D', '测试戊@E']);
    revealHerobrine(fixture);
    const target = fixture.engine.fighters.find((fighter) => !fighter.isNpc)!;
    fixture.engine.fighters
      .filter((fighter) => !fighter.isNpc && fighter.id !== target.id)
      .forEach((fighter) => {
        fighter.currentHp = 0;
        fighter.hpPct = 0;
        fighter.isDead = true;
        fighter.isDeadAnnounced = true;
      });
    withRandomSequence(Array.from({ length: 80 }, () => 0.2), () => {
      executeHerobrineTurn(fixture.engine.createHerobrineRuntime(), fixture.herobrine);
    });
    assert(
      fixture.logs.some((entry) =>
        entry.text.includes('【没有脚步声】') &&
        entry.text.includes('本次攻击暴击'),
      ),
      'No Footsteps should add enough critical chance for a 20% roll to crit above Herobrine base 10%',
    );

    fixture.event.attackedThisLargeRoundIds = [target.id];
    const secondActionStart = fixture.logs.length;
    withRandomSequence(Array.from({ length: 80 }, () => 0.2), () => {
      executeHerobrineTurn(fixture.engine.createHerobrineRuntime(), fixture.herobrine);
    });
    assert(
      !fixture.logs.slice(secondActionStart).some((entry) =>
        entry.text.includes('【没有脚步声】') ||
        entry.text.includes('本次攻击暴击'),
      ),
      'The same 20% roll must not crit after the target has already been attacked this large round',
    );
    cases.push('No Footsteps grants conditional damage and twenty-five percentage points of critical chance');
  }

  {
    const fixture = spawnFixture();
    revealHerobrine(fixture);
    const target = fixture.engine.fighters[0];
    const clone = makeFighter('白眼测试分身');
    configureNpcUnit(clone, 'herobrine', 'herobrine_clone', {
      actionMode: 'normal',
      targetable: true,
      aoeVulnerable: true,
    });
    fixture.engine.fighters.push(clone);

    noteHerobrineDirectHit(
      fixture.engine.createHerobrineRuntime(),
      clone,
      target,
      100,
      'custom',
    );
    assert(
      fixture.event.attackedThisLargeRoundIds.includes(target.id),
      'A direct hit from a White-Eyed Clone should cancel No Footsteps',
    );

    fixture.event.attackedThisLargeRoundIds = [];
    noteHerobrineDirectHit(
      fixture.engine.createHerobrineRuntime(),
      target,
      target,
      100,
      'custom',
    );
    noteHerobrineDirectHit(
      fixture.engine.createHerobrineRuntime(),
      fixture.herobrine,
      target,
      100,
      'custom',
    );
    const trace = activeTraces(fixture)[0];
    assert(trace, 'No Footsteps source regression requires an anomaly trace');
    noteHerobrineDirectHit(
      fixture.engine.createHerobrineRuntime(),
      trace,
      target,
      100,
      'custom',
    );
    assert(
      !fixture.event.attackedThisLargeRoundIds.includes(target.id),
      'Herobrine itself, anomaly traces and self-damage must not cancel No Footsteps',
    );

    const contestant = fixture.engine.fighters[1];
    noteHerobrineDirectHit(
      fixture.engine.createHerobrineRuntime(),
      contestant,
      target,
      100,
      'custom',
    );
    assert(
      fixture.event.attackedThisLargeRoundIds.includes(target.id),
      'A direct hit from another non-event combatant should cancel No Footsteps',
    );
    cases.push('No Footsteps treats clone hits as attention but excludes Herobrine, traces and self-damage');
  }

  {
    const fixture = spawnFixture(['小汀@A', '玄凝@B']);
    revealHerobrine(fixture);
    const protectedTarget = fixture.engine.fighters[0];
    const puppet = makeFighter('小汀(傀儡)@A');
    puppet.isSummon = true;
    puppet.cannotWin = true;
    puppet.summonerId = protectedTarget.id;
    puppet.summonBaseName = '小汀(傀儡)';
    puppet.teamId = protectedTarget.teamId;
    fixture.engine.fighters.push(puppet);
    applyHerobrineWitness(
      fixture.engine.createHerobrineRuntime(),
      protectedTarget,
      5,
      '傀儡挡刀回归',
    );
    const protectedHp = protectedTarget.currentHp;
    const puppetHp = puppet.currentHp;

    withRandomSequence(Array.from({ length: 30 }, () => 0), () => {
      executeHerobrineTurn(fixture.engine.createHerobrineRuntime(), fixture.herobrine);
    });

    assert(
      protectedTarget.currentHp === protectedHp && puppet.currentHp < puppetHp,
      'A Ting puppet must intercept Herobrine direct damage before it reaches the protected owner',
    );
    assert(
      fixture.logs.some((entry) =>
        entry.text.includes('【傀儡援护】') &&
        entry.text.includes(protectedTarget.name) &&
        entry.text.includes(puppet.name)
      ),
      'Herobrine puppet interception must name the protector and protected target',
    );
    cases.push('Herobrine attacks pass through authoritative Ting puppet interception');
  }

  {
    const fixture = spawnFixture(fixtureNames(), [0, 0]);
    revealHerobrine(fixture);
    forceFogBehind(fixture);
    const spinalSwordRef: SpinalSwordRef = { current: true };
    const logStart = fixture.logs.length;
    withRandomSequence([0], () => {
      fixture.engine.handleSpinalSwordDrop(fixture.herobrine, spinalSwordRef);
    });
    assert(
      spinalSwordRef.current &&
      !fixture.herobrine.hasSpinalSword &&
      !findIdentity(fixture.herobrine, 'SPINAL_SWORD'),
      'Herobrine and other NPC event units must not pick up Ting’s player-only spinal sword',
    );
    assert(
      fixture.logs.slice(logStart).every((entry) =>
        !entry.text.includes('捡起了小汀留下的脊髓剑') &&
        !entry.text.includes('Herobrine')
      ),
      'A hidden Herobrine must not leak its canonical identity through player-only pickup logs',
    );
    cases.push('major NPC units cannot inherit Ting’s spinal sword or leak a hidden identity through pickup');
  }

  {
    const fixture = spawnFixture(['小汀@A', '玄凝@B']);
    const protectedTarget = fixture.engine.fighters[0];
    const puppet = makeFighter('小汀(傀儡)@A');
    puppet.isSummon = true;
    puppet.cannotWin = true;
    puppet.summonerId = protectedTarget.id;
    puppet.summonBaseName = '小汀(傀儡)';
    puppet.teamId = protectedTarget.teamId;
    fixture.engine.fighters.push(puppet);
    enterPhaseTwo(fixture);
    const clone = fixture.engine.fighters.find((fighter) => isHerobrineClone(fighter));
    assert(clone, 'Clone interception regression requires a phase-two white-eye clone');
    withRandomSequence(Array.from({ length: 80 }, () => 0), () => {
      executeHerobrineCloneTurn(fixture.engine.createHerobrineRuntime(), clone);
    });
    const interceptLog = fixture.logs.find((entry) =>
      entry.text.includes('【傀儡援护】') &&
      entry.actorId === puppet.id &&
      entry.targetIds?.includes(protectedTarget.id),
    );
    assert(
      interceptLog?.actionId && interceptLog.rootEventId,
      'Clone puppet interception must remain inside the clone action root instead of preceding action_start',
    );
    const cloneActionStart = fixture.engine.events.find((entry) =>
      entry.kind === 'action_start' && entry.skillId === 'herobrine_clone_attack'
    );
    const cloneAttackCue = fixture.logs.find((entry) =>
      entry.visualCue?.kind === 'combat_action' &&
      entry.visualCue.effectId === 'herobrine_clone_attack'
    );
    assert(
      cloneActionStart?.presentation === 'basic' &&
      cloneAttackCue?.visualCue?.kind === 'combat_action' &&
      cloneAttackCue.visualCue.presentation === 'basic',
      'White-eye clone ordinary attacks must remain basic attacks in both action and visual metadata',
    );
    cases.push('white-eye clone target replacement and puppet logs stay inside one action root');
  }

  {
    const fixture = spawnFixture(['克蕾儿丝菲尔@A', '玄凝@B']);
    revealHerobrine(fixture);
    const claire = fixture.engine.fighters[0];
    applyHerobrineWitness(
      fixture.engine.createHerobrineRuntime(),
      claire,
      5,
      '克蕾儿反击回归',
    );
    fixture.engine.applyStatus(claire, {
      identityId: 'CTR_BURN',
      remainingTurns: 2,
      attribution: {
        effectSourceId: 'herobrine-claire-counter-regression',
        effectSourceName: '克蕾儿反击回归',
        applierId: claire.id,
        applierName: claire.name,
      },
    });

    withRandomSequence(Array.from({ length: 40 }, () => 0), () => {
      executeHerobrineTurn(fixture.engine.createHerobrineRuntime(), fixture.herobrine);
    });

    assert(findIdentity(fixture.herobrine, 'BURN'), 'Claire flame counter should burn Herobrine through the shared counter pipeline');
    const triggerIndex = fixture.logs.findIndex((entry) =>
      entry.text.includes('触发了【烈焰反击】') && entry.text.includes(claire.name),
    );
    const resultIndex = fixture.logs.findIndex((entry) =>
      entry.text.includes('【烈焰反击】') && entry.text.includes('点燃') && entry.text.includes('Herobrine'),
    );
    assert(triggerIndex >= 0 && resultIndex > triggerIndex, 'Claire counter logs must state both the trigger and its result before the attack continues');
    cases.push('Herobrine attacks use the shared counter pipeline and preserve Claire counter causality');
  }

  {
    const fixture = spawnFixture(['克蕾儿丝菲尔@A', '玄凝@B']);
    enterPhaseTwo(fixture);
    const claire = fixture.engine.fighters[0];
    const clone = fixture.engine.fighters.find((fighter) => isHerobrineClone(fighter));
    assert(clone, 'Claire execution-counter regression requires a phase-two white-eye clone');
    clone.currentHp = Math.max(1, Math.floor(clone.maxHp * 0.3));
    fixture.engine.syncHpPct(clone);
    removeEffects(claire, { reason: 'scripted' });
    fixture.engine.applyStatus(claire, {
      identityId: 'CTR_EXECUTE',
      remainingTurns: 2,
      attribution: {
        effectSourceId: 'herobrine-claire-execution-counter-regression',
        effectSourceName: '克蕾儿断头反击回归',
        applierId: claire.id,
        applierName: claire.name,
      },
    });

    const logStart = fixture.logs.length;
    withRandomSequence(Array.from({ length: 40 }, () => 0), () => {
      fixture.engine.executeSkillAction(null, clone, claire);
    });
    const actionLogs = fixture.logs.slice(logStart);
    const triggerIndex = actionLogs.findIndex((entry) =>
      entry.text.includes('触发了【断头反击】') &&
      entry.text.includes(claire.name),
    );
    const outcomeIndex = actionLogs.findIndex((entry) =>
      entry.text.includes('【断头反击】结算') &&
      entry.text.includes(claire.name) &&
      entry.text.includes('白眼分身') &&
      entry.text.includes('成功直接处决'),
    );
    const removalIndex = actionLogs.findIndex((entry) =>
      entry.text.includes('【分身识破】') &&
      entry.text.includes(claire.name) &&
      entry.text.includes('白眼分身'),
    );
    assert(
      triggerIndex >= 0 && outcomeIndex > triggerIndex && removalIndex > outcomeIndex,
      `A direct execution against an event NPC must preserve trigger, concrete outcome and special exit order: ${JSON.stringify(actionLogs)}`,
    );
    assert(
      actionLogs[outcomeIndex]?.actorId === claire.id &&
      actionLogs[outcomeIndex]?.targetIds?.includes(clone.id),
      'Direct event-NPC execution outcomes must keep structured actor and target metadata',
    );
    cases.push('Claire execution counter preserves its outcome before a white-eye clone exits');
  }

  {
    const fixture = spawnFixture(['克蕾儿丝菲尔@A', '玄凝@B'], [0, 0]);
    revealHerobrine(fixture);
    assert(
      activeTraces(fixture).some((trace) => trace.npcUnitState?.traceKind === 'tunnel'),
      'Hidden-counter regression requires a two-by-two tunnel',
    );
    const claire = fixture.engine.fighters[0];
    applyHerobrineWitness(
      fixture.engine.createHerobrineRuntime(),
      claire,
      5,
      '隐匿反击回归',
    );
    fixture.engine.applyStatus(claire, {
      identityId: 'CTR_DRAIN',
      remainingTurns: 2,
      attribution: {
        effectSourceId: 'herobrine-hidden-counter-regression',
        effectSourceName: '隐匿反击回归',
        applierId: claire.id,
        applierName: claire.name,
      },
    });
    const attacker = fixture.engine.fighters[1];
    for (let hit = 0; hit < 3; hit += 1) {
      noteHerobrineDirectHit(
        fixture.engine.createHerobrineRuntime(),
        attacker,
        fixture.herobrine,
        1,
        'custom',
      );
    }
    assert(
      (fixture.event.hiddenUntilTurn ?? 0) > fixture.engine.turnCount &&
      !isNpcTargetable(fixture.herobrine) &&
      !shouldRenderNpcUnit(fixture.herobrine),
      'Three direct hits should hide Herobrine inside the tunnel',
    );
    const herobrineHp = fixture.herobrine.currentHp;
    withRandomSequence(Array.from({ length: 60 }, () => 0), () => {
      executeHerobrineTurn(fixture.engine.createHerobrineRuntime(), fixture.herobrine);
    });
    assert(
      fixture.herobrine.currentHp === herobrineHp,
      'A reactive counter must not damage Herobrine while he is hidden and untargetable',
    );
    assert(
      fixture.logs.some((entry) => entry.text.includes('【雾后袭击结算】')) &&
      fixture.logs.some((entry) =>
        entry.text.includes('【NPC目标规则】') &&
        entry.text.includes('【未知】') &&
        entry.text.includes('当前无法被选中或攻击')
      ),
      'Hidden Herobrine should finish the fog attack while every nested counter log remains anonymous',
    );
    cases.push('hidden Herobrine can attack from the tunnel while reactive counter damage is explicitly blocked');
  }

  {
    const fixture = spawnFixture(fixtureNames(), [0, 0]);
    revealHerobrine(fixture);
    fixture.engine.fighters
      .filter((fighter) => !fighter.isNpc)
      .forEach((fighter) => {
        fixture.engine.applyStatus(fighter, {
          identityId: 'OUTPUT_UP',
          potency: 10,
          remainingTurns: 2,
          attribution: {
            effectSourceId: 'herobrine-hidden-skill-regression',
            effectSourceName: '隐匿技能回归',
          },
        });
      });
    forceFogBehind(fixture);
    const logsBefore = fixture.logs.length;
    withRandomSequence([0, 0, 0.55, ...Array.from({ length: 80 }, () => 0)], () => {
      executeHerobrineTurn(fixture.engine.createHerobrineRuntime(), fixture.herobrine);
    });
    const actionLogs = fixture.logs.slice(logsBefore);
    assert(
      actionLogs.some((entry) =>
        entry.actorId === fixture.herobrine.id &&
        entry.text.includes('【被剥去的树叶】') &&
        entry.text.includes('【未知】')
      ),
      'Hidden Herobrine should keep the normal phase-one skill pool and identify the actor as unknown',
    );
    assert(
      !actionLogs.some((entry) =>
        entry.actorId === fixture.herobrine.id &&
        entry.text.includes('Herobrine')
      ),
      'No nested log from a hidden Herobrine skill may disclose the real actor name',
    );
    assert(
      fixture.herobrine.name === '【未知】' &&
      !shouldRenderNpcUnit(fixture.herobrine) &&
      (fixture.event.hiddenUntilTurn ?? 0) > fixture.engine.turnCount,
      'An anonymous skill should preserve the hidden identity without revealing the stage card',
    );
    cases.push('hidden Herobrine can use non-basic skills without leaking identity or revealing the stage card');
  }

  {
    const fixture = spawnFixture(fixtureNames(), [0, 0]);
    enterPhaseTwo(fixture);
    const isolated = fixture.engine.fighters[0];
    applyHerobrineWitness(fixture.engine.createHerobrineRuntime(), isolated, 5, '隐匿单人世界回归');
    forceFogBehind(fixture);
    const transformationsBefore = fixture.logs.filter((entry) =>
      entry.visualCue?.kind === 'transformation' &&
      entry.visualCue.fighterId === fixture.herobrine.id
    ).length;
    const logsBefore = fixture.logs.length;
    withRandomSequence([0, 0, 0.5, ...Array.from({ length: 80 }, () => 0)], () => {
      executeHerobrineTurn(fixture.engine.createHerobrineRuntime(), fixture.herobrine);
    });
    const actionLogs = fixture.logs.slice(logsBefore);
    const returnIndex = actionLogs.findIndex((entry) => entry.text.includes('【雾中归来】'));
    const singleWorldIndex = actionLogs.findIndex((entry) => entry.text.startsWith('⬜ 【单人世界】'));
    assert(
      returnIndex >= 0 && singleWorldIndex > returnIndex,
      `A hidden Herobrine must visibly return before opening Single World: ${actionLogs.map((entry) => entry.text).join(' | ')}`,
    );
    assert(
      fixture.event.hiddenUntilTurn === undefined &&
      shouldRenderNpcUnit(fixture.herobrine) &&
      fixture.event.singleWorld?.targetId === isolated.id,
      'Single World should begin only after Herobrine becomes visible and targetable again',
    );
    assert(
      fixture.logs.filter((entry) =>
        entry.visualCue?.kind === 'transformation' &&
        entry.visualCue.fighterId === fixture.herobrine.id
      ).length === transformationsBefore,
      'Returning from Fog Behind to open Single World must not replay a transformation visual',
    );
    cases.push('hidden phase-two Herobrine returns before Single World without replaying a transformation');
  }

  {
    const fixture = spawnFixture(fixtureNames(), [0, 0]);
    revealHerobrine(fixture);
    forceFogBehind(fixture);
    fixture.herobrine.currentHp = Math.floor(fixture.herobrine.maxHp * 0.6);
    fixture.engine.syncHpPct(fixture.herobrine);
    const logStart = fixture.logs.length;
    advanceGlobalAction(fixture, fixture.engine.turnCount + 1);
    const transitionLogs = fixture.logs.slice(logStart);
    const returnIndex = transitionLogs.findIndex((entry) => entry.text.includes('【雾中归来】'));
    const phaseIndex = transitionLogs.findIndex((entry) => entry.text.includes('【你不是一个人在玩】'));
    assert(
      returnIndex >= 0 &&
      phaseIndex > returnIndex &&
      fixture.event.hiddenUntilTurn === undefined &&
      fixture.event.phase === 'phase_two' &&
      shouldRenderNpcUnit(fixture.herobrine),
      `A phase threshold reached during Fog Behind must reveal before transforming: ${transitionLogs.map((entry) => entry.text).join(' | ')}`,
    );
    cases.push('phase-two threshold reached during Fog Behind reveals before the transformation');
  }

  {
    const fixture = spawnFixture(['丝瓜uli@A', '兔卷卷@B', '玄凝@C']);
    revealHerobrine(fixture);
    const sigua = fixture.engine.fighters[0];
    fixture.engine.applyStatus(sigua, {
      identityId: 'SYNERGY_SLACKING',
      remainingTurns: 5,
      attribution: {
        effectSourceId: 'herobrine-ob-regression',
        effectSourceName: '场外 OB 回归',
        applierId: sigua.id,
        applierName: sigua.name,
      },
    });
    applyHerobrineWitness(fixture.engine.createHerobrineRuntime(), fixture.engine.fighters[2], 5, '场外 OB 选敌回归');
    const actionLogStart = fixture.logs.length;

    withRandomSequence(Array.from({ length: 30 }, () => 0), () => {
      executeHerobrineTurn(fixture.engine.createHerobrineRuntime(), fixture.herobrine);
    });

    const offFieldTargetLog = fixture.logs.slice(actionLogStart).find((entry) =>
        entry.actorId === fixture.herobrine.id &&
        entry.targetIds?.includes(sigua.id) &&
        /袭击|空洞凝视|被剥去的树叶/.test(entry.text)
      );
    assert(
      !offFieldTargetLog,
      `Herobrine must not target an off-field OB fighter: ${offFieldTargetLog?.text ?? 'none'}`,
    );
    cases.push('Herobrine targeting and effects exclude off-field OB fighters');
  }

  {
    const fixture = spawnFixture();
    enterPhaseTwo(fixture);
    const phaseTwoCues = fixture.logs.filter((entry) =>
      entry.visualCue?.kind === 'transformation' &&
      entry.visualCue.fighterId === fixture.herobrine.id,
    );
    assert(phaseTwoCues.length === 1, 'Phase two should emit one transformation visual');
    assert(fixture.herobrine.job === 'HEROBRINE_PHASE_TWO', 'Phase two should update the Herobrine job identity');
    const clone = fixture.engine.fighters.find((fighter) => isHerobrineClone(fighter));
    assert(clone, 'Phase two should immediately create white-eye clones');
    const attacker = fixture.engine.fighters[0];
    const killsBefore = attacker.stats.kills;
    fixture.engine.markDefeated(clone, { killer: attacker, message: '分身回归测试' });
    assert(attacker.stats.kills === killsBefore, 'Destroying a clone must not grant a kill');
    advanceGlobalAction(fixture, fixture.event.startedTurn + 12);
    assert(
      fixture.logs.filter((entry) => entry.visualCue?.kind === 'transformation' && entry.visualCue.fighterId === fixture.herobrine.id).length === 1,
      'Later global actions must not repeat the phase-two transformation',
    );
    cases.push('phase two transforms once and clone defeats bypass ordinary death rewards');
  }

  {
    const fixture = spawnFixture(fixtureNames(), [0, 0]);
    enterPhaseTwo(fixture);
    const isolated = fixture.engine.fighters[0];
    const outsider = fixture.engine.fighters[1];
    applyHerobrineWitness(fixture.engine.createHerobrineRuntime(), isolated, 5, '单人世界回归');
    withRandomSequence([0, 0, 0.5, 0, 0], () => {
      executeHerobrineTurn(fixture.engine.createHerobrineRuntime(), fixture.herobrine);
    });
    assert(fixture.event.singleWorld?.targetId === isolated.id, 'Single World should isolate a five-stack target');
    assert(findIdentity(isolated, HEROBRINE_ISOLATED), 'The isolated target should carry the visible Single World identity');
    fixture.engine.dispelStatusEffects(isolated, {
      strength: 'absolute',
      direction: 'all',
      includeNeutral: true,
      includeIndependent: true,
    });
    assert(
      fixture.event.singleWorld?.targetId === isolated.id &&
      !!findIdentity(isolated, HEROBRINE_ISOLATED),
      'No dispel may remove the visible Single World projection while the event boundary remains active',
    );
    assert(
      fixture.engine.getSelectableTargets(isolated).every((target) => target.id === fixture.herobrine.id),
      'The isolated target should only be able to directly target Herobrine',
    );
    assert(
      !fixture.engine.getSelectableTargets(outsider).some((target) => target.id === isolated.id || target.id === fixture.herobrine.id),
      'Outside fighters must not target either participant inside Single World',
    );
    const outsiderHpBeforeForcedAction = outsider.currentHp;
    const herobrineHpBeforeForcedAction = fixture.herobrine.currentHp;
    withRandomSequence(Array.from({ length: 60 }, () => 0), () => {
      fixture.engine.executeSkillAction(null, isolated, outsider);
    });
    assert(
      outsider.currentHp === outsiderHpBeforeForcedAction &&
      fixture.herobrine.currentHp < herobrineHpBeforeForcedAction,
      'The ordinary action pipeline must carry BattleState into target selection and retarget an invalid outside target to Herobrine',
    );
    assert(
      activeTraces(fixture)
        .filter((trace) => trace.npcUnitState?.traceKind !== 'sand_pyramid')
        .every(isNpcTargetable),
      'Every surviving trace should become attackable while Single World is active',
    );
    const hpBefore = isolated.currentHp;
    const blockedDamage = fixture.engine.applyDamage(
      isolated,
      200,
      'skill',
      true,
      outsider,
      { actionName: '单人世界越界攻击', sourceKind: 'custom' },
    );
    assert(blockedDamage === 0 && isolated.currentHp === hpBefore, 'Outside damage must not cross the Single World boundary');
    const existingStatusDamage = fixture.engine.applyDamage(
      isolated,
      25,
      'status',
      true,
      fixture.herobrine,
      { actionName: '既有持续状态', sourceKind: 'status' },
    );
    assert(
      existingStatusDamage > 0,
      `Existing status damage must continue settling inside Single World (actual ${existingStatusDamage})`,
    );
    const outsideShare = fixture.engine.applyDamage(
      outsider,
      25,
      'momo_share',
      true,
      fixture.herobrine,
      {
        actionName: '外界内部均摊',
        sourceKind: 'share',
        originalTargetId: outsider.id,
        originSourceKind: 'status',
      },
    );
    assert(
      outsideShare > 0,
      `A share that begins and ends outside Single World must still settle (actual ${outsideShare})`,
    );
    const outsiderBeforeBlockedShare = outsider.currentHp;
    const escapedShare = fixture.engine.applyDamage(
      outsider,
      25,
      'momo_share',
      true,
      fixture.herobrine,
      {
        actionName: '隔离伤害外送',
        sourceKind: 'share',
        originalTargetId: isolated.id,
        originSourceKind: 'custom',
      },
    );
    assert(
      escapedShare === 0 && outsider.currentHp === outsiderBeforeBlockedShare,
      'An isolated victim must not export damage to an outside share recipient',
    );
    isolated.currentHp = Math.max(1, isolated.currentHp - 100);
    fixture.engine.syncHpPct(isolated);
    const healing = resolveHealing(isolated, 100, {
      kind: 'direct',
      sourceId: '单人世界外援',
      healer: outsider,
    });
    assert(healing.actual === 0, 'Outside healing must not cross the Single World boundary');
    outsider.currentHp = Math.max(1, outsider.currentHp - 100);
    fixture.engine.syncHpPct(outsider);
    const reverseHealing = resolveHealing(outsider, 100, {
      kind: 'direct',
      sourceId: '单人世界内部外援',
      healer: isolated,
    });
    assert(reverseHealing.actual === 0, 'An isolated healer must not support a target outside Single World');
    const barrierBefore = getBarrierTotal(isolated);
    grantBarrier(isolated, 300, {
      identityId: 'BARRIER',
      sourceId: 'single-world-external',
      displayName: '外界护盾',
      attribution: {
        effectSourceId: 'single-world-external',
        effectSourceName: '外界护盾',
        applierId: outsider.id,
        applierName: outsider.name,
      },
    });
    assert(
      getBarrierTotal(isolated) === barrierBefore &&
      !(isolated.barriers ?? []).some((barrier) => barrier.sourceId === 'single-world-external'),
      'Outside barriers must not cross the Single World boundary or leave a zero-value shell',
    );
    assert(
      !fixture.engine.applyStatus(isolated, {
        identityId: 'OUTPUT_UP',
        potency: 25,
        remainingTurns: 2,
        attribution: {
          effectSourceId: 'single-world-external-status',
          effectSourceName: '外界增益',
          applierId: outsider.id,
          applierName: outsider.name,
        },
      }),
      'Outside status support must not cross the Single World boundary',
    );
    isolated.teamId = outsider.teamId;
    const isolatedHpBeforeTeamHeal = isolated.currentHp;
    fixture.engine.executeSkillAction('q_bunny_idol', outsider, null);
    assert(
      isolated.currentHp === isolatedHpBeforeTeamHeal && !findIdentity(isolated, 'Q_BUNNY_IDOL_AGL'),
      'All-team healing and buffs must skip an isolated teammate',
    );
    const outsideMate = fixture.engine.fighters[2];
    outsideMate.teamId = outsider.teamId;
    outsideMate.currentHp = Math.max(1, outsideMate.currentHp - 100);
    fixture.engine.syncHpPct(outsideMate);
    outsider.job = 'VIRTUAL_DIVA';
    delete fixture.event.recentSkills[outsider.id];
    const isolatedHpBeforeBlockedSkill = isolated.currentHp;
    const outsideMateHpBeforeBlockedSkill = outsideMate.currentHp;
    fixture.engine.executeSkillAction('baby_feed', outsider, isolated);
    assert(
      isolated.currentHp === isolatedHpBeforeBlockedSkill &&
      outsideMate.currentHp === outsideMateHpBeforeBlockedSkill,
      'A support skill blocked by Single World must not heal its target or leak through Diva spread',
    );
    assert(
      !fixture.event.recentSkills[outsider.id],
      'A support skill blocked by Single World must not enter the World Seed Error copy pool',
    );
    fixture.engine.applyStatus(isolated, {
      identityId: 'POISON',
      remainingTurns: 2,
      attribution: { effectSourceId: 'single-world-dispel-regression', effectSourceName: '单人世界驱散回归' },
    });
    const dispelResults = resolveDeclarativeSkillDispel(
      fixture.engine.createActionResolutionRuntime(),
      {
        name: '全队净化回归',
        tag: 'buff',
        dispelSpecs: [{ target: 'allies', strength: 'normal', direction: 'negative' }],
      },
      outsider,
      outsider,
      'after_recovery',
      'after_recovery',
    );
    assert(
      dispelResults.every((result) => result.target.id !== isolated.id) && !!findIdentity(isolated, 'POISON'),
      'Declarative all-allies dispel must not cross into Single World',
    );
    outsider.isYuzu = true;
    outsider.yuzuOpeningShieldApplied = false;
    ensureYuzuOpeningShield({
      fighters: fixture.engine.fighters,
      battleState: fixture.engine.battleState,
      turnCount: fixture.engine.turnCount,
      getTeamId: fixture.engine.getTeamId.bind(fixture.engine),
      isActiveCombatant: fixture.engine.isActiveCombatant.bind(fixture.engine),
      log: fixture.engine.log.bind(fixture.engine),
    }, outsider);
    assert(
      getBarrierTotal(isolated, { identityIds: [YUZU_BARRIER_IDENTITY] }) === 0 &&
      getBarrierTotal(outsider, { identityIds: [YUZU_BARRIER_IDENTITY] }) > 0,
      'Yuzu team shields must remain on the provider side of Single World',
    );
    isolated.isOwl = true;
    const emperor = makeFighter('帝王之征');
    emperor.isSummon = true;
    emperor.summonerId = isolated.id;
    emperor.teamId = isolated.teamId;
    emperor.owlSummonState = {
      kind: 'emperor',
      spawnedTurn: fixture.engine.turnCount,
      wildStacks: 0,
    };
    fixture.engine.fighters.push(emperor);
    const emperorAtkBeforeDesk = emperor.atk;
    const emperorSpdBeforeDesk = emperor.spd;
    fixture.engine.executeSkillAction('owl_desk', isolated, null);
    assert(
      emperor.atk === emperorAtkBeforeDesk &&
      emperor.spd === emperorSpdBeforeDesk &&
      !findIdentity(emperor, 'OWL_WILD'),
      'Owl Desk must not permanently buff an Emperor Dragon across the Single World boundary',
    );
    fixture.engine.applyStatus(isolated, {
      identityId: 'OUTPUT_UP',
      potency: 25,
      remainingTurns: 2,
      attribution: {
        effectSourceId: isolated.id,
        effectSourceName: '单人世界内增益',
        applierId: isolated.id,
        applierName: isolated.name,
      },
    });
    const treeBoundaryLogStart = fixture.logs.length;
    withRandomSequence(Array.from({ length: 100 }, () => 0), () => {
      processHerobrineLargeRoundEnd(
        fixture.engine.createHerobrineRuntime(),
        fixture.event.singleWorld!.startedLargeRound,
      );
    });
    const tree = activeTraces(fixture).find((trace) => trace.npcUnitState?.traceKind === 'leafless_tree');
    assert(
      !!findIdentity(isolated, 'OUTPUT_UP') &&
      !fixture.logs.slice(treeBoundaryLogStart).some((entry) =>
        entry.actorId === tree?.id && entry.targetIds?.includes(isolated.id)
      ),
      'Leafless Tree must not strip or debuff the isolated target from outside Single World',
    );
    processHerobrineLargeRoundEnd(
      fixture.engine.createHerobrineRuntime(),
      fixture.event.singleWorld.endsAfterLargeRound,
    );
    assert(!fixture.event.singleWorld && !findIdentity(isolated, HEROBRINE_ISOLATED), 'Single World should end after one large round');
    assert(
      activeTraces(fixture)
        .filter((trace) => trace.npcUnitState?.traceKind !== 'sand_pyramid')
        .every((trace) => !isNpcTargetable(trace)),
      'Protected traces should become hidden targets again after Single World ends',
    );
    cases.push('Single World blocks target, damage, healing, dispel, and team-shield bypasses, then exits cleanly');
  }

  {
    const fixture = spawnFixture(fixtureNames(), [0, 0.99]);
    const pyramid = activeTraces(fixture).find((trace) => trace.npcUnitState?.traceKind === 'sand_pyramid');
    assert(pyramid, 'The pyramid boundary regression requires a sand pyramid trace');
    enterPhaseTwo(fixture);
    const isolated = fixture.engine.fighters[0];
    applyHerobrineWitness(fixture.engine.createHerobrineRuntime(), isolated, 5, '金字塔边界回归');
    withRandomSequence([0, 0, 0.5, 0, 0], () => {
      executeHerobrineTurn(fixture.engine.createHerobrineRuntime(), fixture.herobrine);
    });
    assert(fixture.event.singleWorld?.targetId === isolated.id, 'The pyramid boundary regression requires Single World');
    const isolatedWitnessBefore = getWitnessStacks(isolated);
    const collapseLogStart = fixture.logs.length;
    withRandomSequence(Array.from({ length: 120 }, () => 0), () => {
      processHerobrineLargeRoundEnd(
        fixture.engine.createHerobrineRuntime(),
        fixture.event.singleWorld!.endsAfterLargeRound,
      );
    });
    assert(
      !fixture.logs.slice(collapseLogStart).some((entry) =>
        entry.actorId === pyramid.id &&
        entry.targetIds?.includes(isolated.id)
      ) &&
      getWitnessStacks(isolated) === isolatedWitnessBefore,
      'Sand Pyramid must neither hit nor add Witness across the Single World boundary',
    );
    assert(
      fixture.logs.slice(collapseLogStart).some((entry) =>
        entry.text.includes('【沙土金字塔坍塌】') &&
        entry.text.includes(isolated.name) &&
        entry.text.includes('主冲击') &&
        entry.text.includes('落空')
      ),
      'Sand Pyramid should explain that its marked primary impact missed instead of silently promoting a new primary target',
    );
    cases.push('Leafless Tree and Sand Pyramid respect the Single World event boundary');
  }

  {
    const fixture = spawnFixture();
    enterPhaseTwo(fixture);
    const [contactClone, foresightClone] = fixture.engine.fighters.filter((fighter) => isHerobrineClone(fighter));
    const attacker = fixture.engine.fighters[0];
    assert(contactClone && foresightClone, 'Clone reveal regression requires both phase-two opening clones');
    assert(
      contactClone.name === 'Herobrine' &&
      contactClone.displayName === 'Herobrine' &&
      foresightClone.name === 'Herobrine',
      'Unrevealed white-eye clones must initially present themselves as Herobrine',
    );
    const disguisedActionStart = fixture.logs.length;
    withRandomSequence(Array.from({ length: 60 }, () => 0), () => {
      executeHerobrineCloneTurn(fixture.engine.createHerobrineRuntime(), contactClone);
    });
    assert(
      !fixture.logs.slice(disguisedActionStart).some((entry) =>
        entry.text.includes('白眼分身') ||
        entry.skillName === '白眼分身攻击'
      ),
      'An unrevealed clone must not disclose its identity through its own action log or skill label',
    );

    fixture.engine.applyDamage(
      contactClone,
      1,
      'status',
      true,
      attacker,
      { actionName: '分身持续伤害回归', sourceKind: 'status' },
    );
    assert(
      !contactClone.npcUnitState?.revealed,
      'Status damage must not reveal a white-eye clone as though an attacker made direct contact',
    );
    fixture.engine.applyDamage(
      contactClone,
      1,
      'counter',
      true,
      attacker,
      { actionName: '分身反击接触识破回归', sourceKind: 'counter' },
    );
    assert(
      contactClone.npcUnitState?.revealed &&
      contactClone.name.startsWith('白眼分身#') &&
      fixture.logs.some((entry) => entry.text.includes('【错误的玩家】') && entry.text.includes('伪装破裂')),
      'A clone must become revealed after an attack connects even without Witness',
    );

    applyHerobrineWitness(fixture.engine.createHerobrineRuntime(), attacker, 3, '分身预识破回归');
    withRandomSequence(Array.from({ length: 60 }, () => 0), () => {
      fixture.engine.executeSkillAction(null, attacker, foresightClone);
    });
    assert(
      foresightClone.npcUnitState?.revealed &&
      foresightClone.name.startsWith('白眼分身#') &&
      fixture.logs.some((entry) =>
        entry.text.includes('【看破真相】') &&
        entry.text.includes('出手前识破') &&
        entry.text.includes(foresightClone.name)
      ),
      'Three-plus Witness should be able to reveal a clone before the selected attack resolves',
    );
    cases.push('white-eye clones reveal on contact while high Witness can identify them before impact');
  }

  {
    const fixture = spawnFixture();
    enterPhaseTwo(fixture);
    const marked = fixture.engine.fighters[0];
    const victim = fixture.engine.fighters[1];
    fixture.event.dontLookBackTargetId = marked.id;
    fixture.event.dontLookBackExpiresLargeRound = fixture.engine.battleState.largeRound.number + 1;
    fixture.engine.applyStatus(marked, {
      identityId: HEROBRINE_DONT_LOOK_BACK,
      attribution: {
        effectSourceId: 'herobrine:dont_look_back',
        effectSourceName: '不要回头',
        applierId: fixture.herobrine.id,
        applierName: fixture.herobrine.name,
      },
    });
    withRandomSequence([0.999, ...Array.from({ length: 40 }, () => 0)], () => {
      fixture.engine.executeSkillAction(null, marked, victim);
    });
    assert(
      !findIdentity(marked, HEROBRINE_DONT_LOOK_BACK),
      'Choosing another contestant must consume Don’t Look Back even when the chosen attack misses',
    );
    assert(
      fixture.logs.some((entry) =>
        entry.text.includes('【不要回头】') &&
        entry.text.includes(marked.name) &&
        entry.text.includes(victim.name)
      ),
      'Choosing another contestant must log the resulting Don’t Look Back pursuit',
    );
    assert(
      fixture.logs.some((entry) => entry.skillId === 'herobrine_dont_look_back_followup'),
      'The Don’t Look Back pursuit must execute as a structured Herobrine reaction action',
    );

    fixture.event.dontLookBackTargetId = marked.id;
    fixture.event.dontLookBackExpiresLargeRound = fixture.engine.battleState.largeRound.number + 1;
    fixture.engine.applyStatus(marked, {
      identityId: HEROBRINE_DONT_LOOK_BACK,
      attribution: {
        effectSourceId: 'herobrine:dont_look_back',
        effectSourceName: '不要回头',
        applierId: fixture.herobrine.id,
        applierName: fixture.herobrine.name,
      },
    });
    fixture.engine.dispelStatusEffects(marked, {
      strength: 'absolute',
      direction: 'all',
      includeNeutral: true,
      includeIndependent: true,
    });
    assert(
      !!findIdentity(marked, HEROBRINE_DONT_LOOK_BACK),
      'No dispel may remove Don’t Look Back before its event trigger or expiry resolves',
    );
    const supportLogStart = fixture.logs.length;
    fixture.engine.executeSkillAction('bkb_dota', marked, victim);
    assert(
      !!findIdentity(marked, HEROBRINE_DONT_LOOK_BACK) &&
      !fixture.logs.slice(supportLogStart).some((entry) => entry.skillId === 'herobrine_dont_look_back_followup'),
      'A self-buff must not consume Don’t Look Back merely because the action pipeline preselected an enemy placeholder',
    );

    const summon = makeFighter('普通召唤物');
    summon.isSummon = true;
    summon.cannotWin = true;
    summon.teamId = victim.teamId;
    fixture.engine.fighters.push(summon);
    fixture.engine.executeSkillAction(null, marked, summon);
    assert(
      !!findIdentity(marked, HEROBRINE_DONT_LOOK_BACK),
      'Attacking a normal summon must not count as attacking another contestant for Don’t Look Back',
    );
    cases.push('Don’t Look Back follows structured offensive intent instead of requiring damage to connect');
  }

  {
    const fixture = spawnFixture();
    const target = fixture.engine.fighters[0];
    fixture.engine.applyStatus(target, {
      identityId: HEROBRINE_WITHER,
      remainingTurns: 1,
      attribution: { effectSourceId: 'wither-clock-test', effectSourceName: '枯萎时钟回归' },
    });
    const currentRound = fixture.engine.battleState.largeRound.number;
    advanceLargeRoundTimedEffects(fixture.engine.fighters, currentRound, fixture.engine.log.bind(fixture.engine));
    assert(findIdentity(target, HEROBRINE_WITHER), 'A newly applied Wither must not expire in its application round');
    advanceLargeRoundTimedEffects(fixture.engine.fighters, currentRound + 1, fixture.engine.log.bind(fixture.engine));
    assert(!findIdentity(target, HEROBRINE_WITHER), 'Wither should expire exactly at the next large-round settlement');
    cases.push('Wither uses the unified large-round clock and cannot expire on application');
  }

  {
    const fixture = spawnFixture(['鸮@A', '玄凝@B', '小汀@C', '牢鳄@D', '丝瓜uli@E']);
    revealHerobrine(fixture);
    const owl = fixture.engine.fighters[0];
    owl.owlState = {
      phase: 2,
      warForm: 'defeat',
      warFormStartedTurn: fixture.engine.turnCount,
      heavenStacks: 0,
      sweepUsed: false,
    };
    fixture.engine.applyStatus(owl, {
      identityId: 'HASTE',
      remainingTurns: 2,
      attribution: { effectSourceId: 'wither-resist-test', effectSourceName: '枯萎抵抗回归增益' },
    });
    fixture.engine.fighters
      .filter((fighter) => !fighter.isNpc && fighter.id !== owl.id)
      .forEach((fighter) => {
        fighter.currentHp = 0;
        fighter.hpPct = 0;
        fighter.isDead = true;
        fighter.isDeadAnnounced = true;
      });
    const logStart = fixture.logs.length;
    withRandomSequence([0.1, 0.1, 0.5, 0.1, 0.1, 0.1], () => {
      executeHerobrineTurn(fixture.engine.createHerobrineRuntime(), fixture.herobrine);
    });
    const actionLogs = fixture.logs.slice(logStart);
    assert(
      !findIdentity(owl, 'HASTE') &&
      !findIdentity(owl, HEROBRINE_WITHER) &&
      actionLogs.some((entry) => entry.text.includes('【败兵抗性】') && entry.text.includes('【枯萎】')) &&
      !actionLogs.some((entry) => entry.text.includes('治疗与护盾获取量继续降低')),
      `A resisted Wither must preserve the resistance outcome instead of logging a false healing penalty: ${JSON.stringify({
        haste: !!findIdentity(owl, 'HASTE'),
        wither: !!findIdentity(owl, HEROBRINE_WITHER),
        logs: actionLogs.map((entry) => entry.text),
      })}`,
    );
    cases.push('resisted Wither never logs a healing penalty that did not apply');
  }

  {
    const fixture = spawnFixture();
    const target = fixture.engine.fighters[0];
    target.currentHp = Math.max(1, target.maxHp - 500);
    fixture.engine.syncHpPct(target);
    fixture.engine.applyStatus(target, {
      identityId: HEROBRINE_WITHER,
      remainingTurns: 1,
      attribution: { effectSourceId: 'wither-value-test', effectSourceName: '枯萎数值回归' },
    });
    const healing = resolveHealing(target, 100, {
      kind: 'direct',
      sourceId: 'wither-value-test',
      healer: target,
    });
    const barrierBefore = getBarrierTotal(target);
    const barrier = grantBarrier(target, 100, {
      identityId: 'BARRIER',
      sourceId: 'wither-value-test',
      displayName: '枯萎数值回归护盾',
      attribution: {
        effectSourceId: 'wither-value-test',
        effectSourceName: '枯萎数值回归护盾',
        applierId: target.id,
        applierName: target.name,
      },
    });
    assert(
      healing.actual === 70 &&
      !!barrier &&
      getBarrierTotal(target) - barrierBefore === 70,
      'Wither should reduce both actual healing and actual barrier gain by thirty percent',
    );
    cases.push('Wither reduces actual healing and barrier gain through the unified effect pipeline');
  }

  {
    const yuzu = makeFighter('柚子@A');
    const ally = makeFighter('枯萎护盾日志队友@A');
    const enemy = makeFighter('枯萎护盾日志敌人@B');
    const fixture = makeDeathEngine([yuzu, ally, enemy]);
    const engineYuzu = fixture.engine.fighters[0];
    const engineAlly = fixture.engine.fighters[1];
    removeBarriers(engineYuzu, { identityIds: [YUZU_BARRIER_IDENTITY] });
    removeBarriers(engineAlly, { identityIds: [YUZU_BARRIER_IDENTITY] });
    engineYuzu.yuzuOpeningShieldApplied = false;
    fixture.engine.applyStatus(engineAlly, {
      identityId: HEROBRINE_WITHER,
      remainingTurns: 1,
      attribution: { effectSourceId: 'wither-shield-log-test', effectSourceName: '枯萎护盾日志回归' },
    });
    const expectedYuzuGain = Math.max(1, Math.floor(engineYuzu.maxHp * 0.2));
    const expectedAllyGain = Math.floor(expectedYuzuGain * 0.7);
    const logStart = fixture.logs.length;
    ensureYuzuOpeningShield({
      fighters: fixture.engine.fighters,
      battleState: fixture.engine.battleState,
      turnCount: fixture.engine.turnCount,
      getTeamId: fixture.engine.getTeamId.bind(fixture.engine),
      isActiveCombatant: fixture.engine.isActiveCombatant.bind(fixture.engine),
      log: fixture.engine.log.bind(fixture.engine),
    }, engineYuzu);
    const shieldLog = fixture.logs.slice(logStart)
      .find((entry) => entry.text.includes('【镜界开幕】'));
    assert(
      getBarrierTotal(engineAlly, { identityIds: [YUZU_BARRIER_IDENTITY] }) === expectedAllyGain &&
      shieldLog?.text.includes(`${engineYuzu.name} 实际获得 ${expectedYuzuGain} 点镜界护盾`) &&
      shieldLog.text.includes(`${engineAlly.name} 实际获得 ${expectedAllyGain} 点镜界护盾`),
      'Yuzu shield logs must report each target actual barrier gain after Wither reduction',
    );
    cases.push('Yuzu shield logs report actual per-target gains after Wither reduction');
  }

  {
    const fixture = spawnFixture();
    const target = fixture.engine.fighters[0];
    const trace = activeTraces(fixture)[0];
    assert(trace, 'Multi-source Witness presentation requires an event trace');
    applyHerobrineWitness(fixture.engine.createHerobrineRuntime(), target, 2, '被本体注视');
    applyHerobrineWitness(fixture.engine.createHerobrineRuntime(), target, 2, '被异常痕迹波及', trace);
    const witnessCards = buildFighterStatusPresentation(target)
      .filter((item) => item.name === '目击');
    assert(
      witnessCards.length === 1 &&
      witnessCards[0].detailModel.groupKind === 'multi_source' &&
      witnessCards[0].detailModel.effects.length === 2 &&
      witnessCards[0].detail.includes('4/5层') &&
      witnessCards[0].detailModel.effects.filter((effect) => effect.isCurrentAttribution).length === 1,
      'Witness from several event sources should render as one aggregate card with source contributions',
    );
    cases.push('multi-source Witness renders one aggregate card with total effects and source attribution');
  }

  {
    const fixture = spawnFixture(['甲@A', '乙@B', '丙@C', '丁@D', '戊@E']);
    revealHerobrine(fixture);
    const target = fixture.engine.fighters[0];
    applyHerobrineWitness(fixture.engine.createHerobrineRuntime(), target, 5, '穿盾回归');
    grantBarrier(target, 300, {
      identityId: 'BARRIER',
      sourceId: 'herobrine-bypass-regression',
      displayName: '穿盾回归护盾',
      attribution: {
        effectSourceId: 'herobrine-bypass-regression',
        effectSourceName: '穿盾回归护盾',
        applierId: target.id,
        applierName: target.name,
      },
    });
    const firstHp = target.currentHp;
    fixture.engine.applyDamage(target, 100, 'skill', false, fixture.herobrine, {
      actionName: '五层目击第一次直接攻击',
      sourceKind: 'custom',
    });
    assert(target.currentHp < firstHp && getBarrierTotal(target) === 300, 'The first five-Witness direct hit should bypass an intact ordinary barrier');
    const secondHp = target.currentHp;
    fixture.engine.applyDamage(target, 100, 'skill', false, fixture.herobrine, {
      actionName: '五层目击第二次直接攻击',
      sourceKind: 'custom',
    });
    assert(target.currentHp === secondHp && getBarrierTotal(target) < 300, 'Later Herobrine hits should return to ordinary barrier settlement');
    cases.push('five-Witness shield bypass is centralized, consumed once, and applies to every direct Herobrine hit');
  }

  {
    const fixture = spawnFixture(['甲@A', '乙@B', '丙@C', '丁@D', '戊@E']);
    revealHerobrine(fixture);
    const target = fixture.engine.fighters[0];
    applyHerobrineWitness(
      fixture.engine.createHerobrineRuntime(),
      target,
      3,
      '白色眼睛护盾回归',
    );
    grantBarrier(target, 500, {
      identityId: 'BARRIER',
      sourceId: 'herobrine-witness-barrier-regression',
      displayName: '目击伤害测试护盾',
      attribution: {
        effectSourceId: 'herobrine-witness-barrier-regression',
        effectSourceName: '目击伤害测试护盾',
        applierId: target.id,
        applierName: target.name,
      },
    });
    const hpBefore = target.currentHp;
    processHerobrineLargeRoundEnd(
      fixture.engine.createHerobrineRuntime(),
      fixture.engine.battleState.largeRound.number,
    );
    assert(
      target.currentHp === hpBefore,
      'Three-Witness round damage must be absorbed by an available ordinary barrier',
    );
    assert(
      getBarrierTotal(target) < 500,
      'Three-Witness round damage must consume barrier value when absorbed',
    );
    cases.push('three-Witness round damage is true damage but still settles through ordinary barriers');
  }

  {
    const fixture = spawnFixture(fixtureNames(), [0, 0]);
    revealHerobrine(fixture);
    forceFogBehind(fixture);
    const attacker = fixture.engine.fighters[0];
    const logStart = fixture.logs.length;
    fixture.engine.markDefeated(fixture.herobrine, {
      killer: attacker,
      message: '一阶段越阈值击倒回归',
    });
    const lethalLogs = fixture.logs.slice(logStart);
    const returnIndex = lethalLogs.findIndex((entry) => entry.text.includes('【雾中归来】'));
    const phaseIndex = lethalLogs.findIndex((entry) => entry.text.includes('【你不是一个人在玩】'));
    const removedIndex = lethalLogs.findIndex((entry) => entry.text.includes('【Removed Herobrine.】'));
    assert(fixture.event.phase === 'removed', 'A phase-one lethal hit should still enter Removed');
    assert(fixture.herobrine.job === 'HEROBRINE_PHASE_TWO', 'A phase-one lethal hit must commit the crossed phase-two form before Removed');
    assert(
      returnIndex >= 0 &&
      phaseIndex > returnIndex &&
      removedIndex > phaseIndex &&
      fixture.logs.filter((entry) =>
        entry.visualCue?.kind === 'transformation' &&
        entry.visualCue.fighterId === fixture.herobrine.id
      ).length === 1,
      `Crossing phase two through a hidden lethal hit must reveal, transform once, then enter Removed: ${lethalLogs.map((entry) => entry.text).join(' | ')}`,
    );
    cases.push('hidden phase-one lethal damage reveals, commits phase two once, then enters Removed');
  }

  {
    const fixture = spawnFixture();
    enterPhaseTwo(fixture);
    const actor = fixture.engine.fighters[0];
    captureHerobrineRecentSkill(
      fixture.engine.createHerobrineRuntime(),
      actor,
      'valo_pre_fire',
    );
    const snapshot = fixture.event.recentSkills[actor.id];
    assert(
      snapshot?.template === 'single_physical' &&
      snapshot.statusIdentityId === undefined,
      'World Seed Error must reduce a skill with a character-specific status to plain safe damage',
    );
    cases.push('World Seed Error strips character-specific statuses from captured skill summaries');
  }

  {
    const fixture = spawnFixture();
    enterPhaseTwo(fixture);
    fixture.event.recentSkills[fixture.engine.fighters[0].id] = {
      sourceActorId: fixture.engine.fighters[0].id,
      sourceActorName: fixture.engine.fighters[0].name,
      sourceSkillId: 'world-seed-aoe-regression',
      sourceSkillName: '范围模板回归',
      template: 'limited_aoe',
      potency: 0.8,
      damageSchool: 'magical',
      targetCap: 3,
    };
    withRandomSequence([0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0], () => {
      executeHerobrineTurn(fixture.engine.createHerobrineRuntime(), fixture.herobrine);
    });
    const copiedAction = fixture.logs.find((entry) => entry.skillId === 'herobrine_world_seed_error');
    assert(copiedAction, 'World Seed Error should execute the prepared safe copy template');
    assert((copiedAction.targetIds?.length ?? 0) <= 3, 'A copied area template must never exceed three structured targets');
    cases.push('World Seed Error copies only a bounded safe AOE template with at most three targets');
  }

  {
    const fixture = spawnFixture(['小汀@A', '玄凝@B']);
    enterPhaseTwo(fixture);
    const protectedTarget = fixture.engine.fighters[0];
    const puppet = makeFighter('小汀(傀儡)@A');
    puppet.isSummon = true;
    puppet.cannotWin = true;
    puppet.summonerId = protectedTarget.id;
    puppet.summonBaseName = '小汀(傀儡)';
    puppet.teamId = protectedTarget.teamId;
    fixture.engine.fighters.push(puppet);
    applyHerobrineWitness(
      fixture.engine.createHerobrineRuntime(),
      protectedTarget,
      5,
      '世界种子错误挡刀回归',
    );
    fixture.event.recentSkills[fixture.engine.fighters[1].id] = {
      sourceActorId: fixture.engine.fighters[1].id,
      sourceActorName: fixture.engine.fighters[1].name,
      sourceSkillId: 'world-seed-single-regression',
      sourceSkillName: '单体模板回归',
      template: 'single_magical',
      potency: 0.9,
      damageSchool: 'magical',
    };
    const protectedHp = protectedTarget.currentHp;
    const puppetHp = puppet.currentHp;

    withRandomSequence(Array.from({ length: 80 }, () => 0.65), () => {
      executeHerobrineTurn(fixture.engine.createHerobrineRuntime(), fixture.herobrine);
    });

    assert(
      protectedTarget.currentHp === protectedHp && puppet.currentHp < puppetHp,
      'A direct World Seed copy must pass through Ting puppet interception',
    );
    assert(
      fixture.logs.some((entry) =>
        entry.text.includes('【傀儡援护】') &&
        entry.text.includes('世界种子错误·单体模板回归')
      ),
      'The copied attack interception log must name the copied action',
    );
    cases.push('direct World Seed copies use the same puppet, counter, dodge, and target-resolution pipeline');
  }

  {
    const fixture = spawnFixture();
    enterPhaseTwo(fixture);
    const attacker = fixture.engine.fighters[0];
    const originalMaxHp = fixture.herobrine.maxHp;
    attacker.yuzuMarkedTargetId = fixture.herobrine.id;
    fixture.engine.applyStatus(fixture.herobrine, {
      identityId: 'YUZU_MARKED',
      attribution: {
        effectSourceId: attacker.id,
        effectSourceName: 'Removed 锁定清理回归',
        applierId: attacker.id,
        applierName: attacker.name,
      },
    });
    fixture.engine.applyStatus(fixture.herobrine, {
      identityId: 'POISON',
      potency: 2,
      remainingTurns: 3,
      attribution: {
        effectSourceId: attacker.id,
        effectSourceName: 'Removed 状态清理回归',
        applierId: attacker.id,
        applierName: attacker.name,
      },
    });
    grantBarrier(fixture.herobrine, 300, {
      identityId: 'BARRIER',
      sourceId: 'herobrine-removed-barrier-test',
      displayName: 'Removed 护盾清理回归',
      attribution: {
        effectSourceId: 'herobrine-removed-barrier-test',
        effectSourceName: 'Removed 护盾清理回归',
        applierId: fixture.herobrine.id,
        applierName: fixture.herobrine.name,
      },
    });
    fixture.engine.markDefeated(fixture.herobrine, {
      killer: attacker,
      message: '第一次击倒 Herobrine',
    });
    assert(fixture.event.phase === 'removed', 'The first zero-HP event should enter Removed');
    assert(
      hasSettlementBlockingNpc(fixture.engine.fighters),
      'Removed Herobrine must block settlement through the generic NPC capability even at zero HP',
    );
    assert(
      fixture.herobrine.statuses.length === 0 &&
      getBarrierTotal(fixture.herobrine) === 0 &&
      attacker.yuzuMarkedTargetId === undefined,
      'Entering Removed must clear temporary statuses, barriers and external target pointers instead of freezing them until revival',
    );
    activeTraces(fixture).forEach((trace) => {
      fixture.engine.markDefeated(trace, { killer: attacker, message: 'Removed 期间清除痕迹' });
    });
    assert(activeTraces(fixture).length === 0, 'Removed revival test should clear every trace first');
    advanceGlobalAction(fixture, fixture.event.removedReturnTurn!);
    assert((fixture.event.phase as string) === 'phase_two', 'Herobrine must revive even when every trace is gone');
    assert(
      fixture.herobrine.maxHp === Math.floor(originalMaxHp * 0.7) &&
      fixture.herobrine.currentHp === fixture.herobrine.maxHp,
      'Revival should reduce max HP to seventy percent and restore the new maximum',
    );
    assert(fixture.event.directDamageMultiplier === 1.15, 'The first revival should increase direct damage by fifteen percent');
    cases.push('Removed Herobrine revives on schedule independently of traces with reduced max HP');
  }

  {
    const fixture = spawnFixture(fixtureNames(), [0, 0]);
    revealHerobrine(fixture);
    const attacker = fixture.engine.fighters[0];
    const marked = fixture.engine.fighters[1];
    fixture.engine.applyStatus(marked, {
      identityId: HEROBRINE_DONT_LOOK_BACK,
      attribution: {
        effectSourceId: 'herobrine:removed-lifecycle-regression',
        effectSourceName: 'Removed 生命周期回归',
        applierId: fixture.herobrine.id,
        applierName: fixture.herobrine.name,
      },
    });
    fixture.event.dontLookBackTargetId = marked.id;
    fixture.event.dontLookBackExpiresLargeRound = fixture.engine.battleState.largeRound.number + 1;
    for (let hit = 0; hit < 3; hit += 1) {
      noteHerobrineDirectHit(
        fixture.engine.createHerobrineRuntime(),
        attacker,
        fixture.herobrine,
        1,
        'custom',
      );
    }
    assert(
      fixture.event.hiddenUntilTurn !== undefined &&
      !shouldRenderNpcUnit(fixture.herobrine),
      'Removed lifecycle regression requires Herobrine to be hidden first',
    );
    fixture.engine.markDefeated(fixture.herobrine, {
      killer: attacker,
      message: '隐匿期间的既有持续伤害将 Herobrine 压至零',
    });
    assert(
      fixture.event.phase === 'removed' &&
      fixture.event.hiddenUntilTurn === undefined &&
      fixture.event.dontLookBackTargetId === undefined &&
      !findIdentity(marked, HEROBRINE_DONT_LOOK_BACK),
      'Entering Removed must end Fog Behind and clear an unresolved Don’t Look Back mark',
    );
    const removedReturnTurn = fixture.event.removedReturnTurn!;
    const fogReturnCount = fixture.logs.filter((entry) => entry.text.includes('【雾中归来】')).length;
    advanceGlobalAction(fixture, removedReturnTurn - 1);
    assert(
      fixture.event.phase === 'removed' &&
      fixture.logs.filter((entry) => entry.text.includes('【雾中归来】')).length === fogReturnCount,
      'Removed Herobrine must not emit a false Fog Behind return before revival',
    );
    advanceGlobalAction(fixture, removedReturnTurn);
    assert(
      (fixture.event.phase as string) === 'phase_two' &&
      fixture.logs.some((entry) => entry.text.includes('【你确定吗？】')),
      'Removed should still revive normally after the hidden lifecycle is cancelled',
    );
    cases.push('Removed cancels Fog Behind and Don’t Look Back without suppressing the scheduled revival');
  }

  {
    const fixture = spawnFixture(['玄凝@A', '小汀@B']);
    enterPhaseTwo(fixture);
    const survivor = fixture.engine.fighters[0];
    const defeated = fixture.engine.fighters[1];
    const summon = makeFighter('高目击召唤物@A');
    summon.isSummon = true;
    summon.cannotWin = true;
    summon.summonerId = survivor.id;
    summon.teamId = survivor.teamId;
    fixture.engine.fighters.push(summon);
    applyHerobrineWitness(
      fixture.engine.createHerobrineRuntime(),
      summon,
      5,
      '最终追猎选敌回归',
    );
    withRandomSequence([0, 0, 0.5, ...Array.from({ length: 40 }, () => 0)], () => {
      executeHerobrineTurn(fixture.engine.createHerobrineRuntime(), fixture.herobrine);
    });
    assert(
      fixture.event.singleWorld?.targetId === summon.id &&
      !!findIdentity(summon, HEROBRINE_ISOLATED),
      'Final Pursuit supersession regression requires a summon to be isolated first',
    );
    survivor.maxHp = 100000;
    survivor.currentHp = 100000;
    fixture.engine.syncHpPct(survivor);
    fixture.engine.markDefeated(defeated, {
      killer: survivor,
      message: '💀 【最终追猎准备】小汀 被击倒。',
      awardKill: false,
    });
    assert(
      fixture.event.finalPursuit &&
      !fixture.event.singleWorld &&
      !findIdentity(summon, HEROBRINE_ISOLATED),
      'Exactly one surviving contestant should start Final Pursuit and end an obsolete summon isolation',
    );
    const summonHp = summon.currentHp;
    const pursuitLogStart = fixture.logs.length;
    withRandomSequence(Array.from({ length: 80 }, () => 0), () => {
      executeHerobrineTurn(fixture.engine.createHerobrineRuntime(), fixture.herobrine);
    });
    const pursuitLogs = fixture.logs.slice(pursuitLogStart).filter((entry) =>
      entry.actorId === fixture.herobrine.id
    );
    assert(
      summon.currentHp === summonHp &&
      pursuitLogs.some((entry) =>
        entry.targetIds?.includes(survivor.id) &&
        entry.skillId === 'herobrine_final_pursuit'
      ),
      `Final Pursuit must hunt the sole contestant instead of a higher-Witness summon: summon ${summonHp}->${summon.currentHp}; logs=${JSON.stringify(pursuitLogs.map((entry) => ({ skillId: entry.skillId, targets: entry.targetIds, text: entry.text })))}`,
    );
    fixture.engine.markDefeated(fixture.herobrine, {
      killer: survivor,
      message: '最终追猎击倒 Herobrine',
    });
    assert(
      fixture.event.completed &&
      fixture.event.phase === 'retreated' &&
      fixture.event.outcome === 'true_removal' &&
      !hasSettlementBlockingNpc(fixture.engine.fighters),
      'Herobrine should never revive after losing Final Pursuit',
    );
    assert(
      fixture.logs.some((entry) => entry.text.includes('【最终追猎】')) &&
      fixture.logs.some((entry) => entry.text.includes('【真正退场】')),
      'Final Pursuit should log both its start and conclusive outcome',
    );
    cases.push('Final Pursuit starts with exactly one contestant and either defeat is conclusive');
  }

  {
    const fixture = spawnFixture(['甲@A', '乙@B']);
    enterPhaseTwo(fixture);
    const survivor = fixture.engine.fighters[0];
    const other = fixture.engine.fighters[1];
    fixture.engine.markDefeated(fixture.herobrine, {
      killer: survivor,
      message: '最终追猎前的 Removed 回归',
    });
    assert(fixture.event.phase === 'removed', 'The final-pursuit revival regression requires Removed first');
    fixture.engine.markDefeated(other, {
      killer: survivor,
      message: '最终追猎只剩一人',
      awardKill: false,
      bypassDeathSaves: true,
    });
    assert(
      fixture.event.finalPursuit &&
      (fixture.event.phase as string) === 'phase_two' &&
      fixture.engine.isActiveCombatant(fixture.herobrine),
      'Entering Final Pursuit during Removed must immediately restore Herobrine at the reduced maximum',
    );
    fixture.engine.markDefeated(survivor, {
      killer: fixture.herobrine,
      message: '最终追猎参赛者落败',
      bypassDeathSaves: true,
    });
    assert(
      fixture.event.completed &&
      (fixture.event.phase as string) === 'retreated' &&
      fixture.event.outcome === 'contestants_defeated',
      'The sole contestant losing Final Pursuit must end the event immediately',
    );
    fixture.engine.checkWinCondition(
      fixture.engine.fighters.filter((fighter) => fixture.engine.isActiveCombatant(fighter)),
    );
    assert(
      fixture.logs.some((entry) => entry.text.includes('【猎杀结束】')) &&
      fixture.logs.some((entry) => entry.text.includes('最终胜者：无（参赛者全灭）')) &&
      !fixture.logs.some((entry) => entry.text.includes('最终胜者：无（同归于尽）')) &&
      !fixture.logs.slice(-1)[0]?.text.includes('【真正退场】'),
      'A contestant loss should use the hunt-ending settlement rather than claim Herobrine was defeated or both sides died together',
    );
    const presentation = buildMajorNpcEventPresentation(
      fixture.engine.battleState,
      fixture.engine.fighters,
      fixture.engine.turnCount,
    );
    assert(
      presentation?.phase === '猎杀结束' &&
      presentation.detail.includes('参赛者全灭'),
      'The shared event HUD must not describe a contestant wipe as Herobrine being truly removed',
    );
    cases.push('Removed enters Final Pursuit immediately and a sole-contestant defeat ends the hunt without false victory text');
  }

  {
    const fixture = spawnFixture(['克蕾儿丝菲尔@A', '玄凝@B']);
    enterPhaseTwo(fixture);
    const survivor = fixture.engine.fighters[0];
    const other = fixture.engine.fighters[1];
    survivor.maxHp = 100000;
    survivor.currentHp = 100000;
    fixture.engine.syncHpPct(survivor);

    const puppet = makeFighter('小汀(傀儡)@A');
    puppet.isSummon = true;
    puppet.cannotWin = true;
    puppet.summonerId = survivor.id;
    puppet.summonBaseName = '小汀(傀儡)';
    puppet.teamId = survivor.teamId;
    puppet.maxHp = 1;
    puppet.currentHp = 1;
    fixture.engine.syncHpPct(puppet);
    fixture.engine.fighters.push(puppet);

    fixture.engine.markDefeated(other, {
      killer: survivor,
      message: '最终追猎复合视觉回归只剩一人',
      awardKill: false,
      bypassDeathSaves: true,
    });
    assert(
      fixture.event.finalPursuit && fixture.event.finalPursuitOpeningPending,
      'Final Pursuit visual regression requires its immediate opening action',
    );
    withRandomSequence(Array.from({ length: 120 }, () => 0), () => {
      processHerobrineGlobalActionEnd(fixture.engine.createHerobrineRuntime());
    });

    const openingStart = fixture.engine.events.find((entry) =>
      entry.kind === 'action_start' &&
      entry.skillId === 'herobrine_final_pursuit_opening'
    );
    const openingEvents = fixture.engine.events.filter((entry) =>
      entry.actionId === openingStart?.actionId
    );
    const damageTargets = new Set(openingEvents.flatMap((entry) =>
      entry.kind === 'damage' && entry.damage?.attackerId === fixture.herobrine.id
        ? [entry.damage.targetId]
        : []
    ));
    const visualTargets = new Set(openingEvents.flatMap((entry) =>
      entry.visualCue?.kind === 'combat_action' || entry.visualCue?.kind === 'combat_fx'
        ? entry.visualCue.targetIds
        : []
    ));
    assert(
      damageTargets.has(puppet.id) &&
      damageTargets.has(survivor.id) &&
      [...damageTargets].every((targetId) => visualTargets.has(targetId)),
      `Final Pursuit opening must publish both the intercepted hit and return strike: damage=${JSON.stringify([...damageTargets])}; visual=${JSON.stringify([...visualTargets])}`,
    );
    assert(
      openingEvents.filter((entry) => entry.visualCue?.kind === 'combat_action').length === 1 &&
      openingEvents.some((entry) =>
        entry.visualCue?.kind === 'combat_fx' &&
        entry.visualCue.targetIds.includes(survivor.id)
      ),
      'A compound Final Pursuit opening must retain one primary cue and publish its return strike as secondary combat FX',
    );
    cases.push('Final Pursuit opening keeps puppet interception and return-strike visuals causally complete');
  }

  {
    const fixture = spawnFixture(['玄凝@A', '小汀@B']);
    const survivor = fixture.engine.fighters[0];
    fixture.engine.markDefeated(fixture.engine.fighters[1], {
      killer: survivor,
      message: '雾中阶段最终追猎回归',
      awardKill: false,
      bypassDeathSaves: true,
    });
    assert(
      fixture.event.finalPursuit &&
      fixture.event.phase === 'phase_one' &&
      shouldRenderNpcUnit(fixture.herobrine) &&
      isNpcTargetable(fixture.herobrine),
      'Final Pursuit entered from fog must first commit the authoritative reveal',
    );
    assert(
      fixture.logs.filter((entry) =>
        entry.visualCue?.kind === 'form_shift' &&
        entry.visualCue.fighterId === fixture.herobrine.id
      ).length === 1,
      'Fog-to-Final-Pursuit must emit exactly one reveal cue before the pursuit starts',
    );
    cases.push('Final Pursuit entered during fog performs one authoritative reveal before combat');
  }

  {
    const fixture = spawnFixture(['刺猬人@A', '小汀@B']);
    enterPhaseTwo(fixture);
    const survivor = fixture.engine.fighters[0];
    const defeated = fixture.engine.fighters[1];
    survivor.maxHp = 100000;
    survivor.currentHp = 100000;
    fixture.engine.syncHpPct(survivor);
    applyStatus(survivor, {
      identityId: 'SPELL_BLOCK',
      charges: 2,
      attribution: {
        effectSourceId: 'herobrine:final-pursuit-regression',
        effectSourceName: '奇迹炼成装甲',
      },
    });
    fixture.engine.markDefeated(defeated, {
      killer: survivor,
      message: '最终追猎法术抵挡回归',
      awardKill: false,
      bypassDeathSaves: true,
    });
    const beforeHp = survivor.currentHp;
    const beforeCharges = findIdentity(survivor, 'SPELL_BLOCK')?.charges;
    withRandomSequence(Array.from({ length: 80 }, () => 0), () => {
      executeHerobrineTurn(fixture.engine.createHerobrineRuntime(), fixture.herobrine);
    });
    assert(
      survivor.currentHp < beforeHp &&
      findIdentity(survivor, 'SPELL_BLOCK')?.charges === beforeCharges &&
      fixture.logs.some((entry) =>
        entry.text.includes('【最终追猎】') &&
        entry.text.includes('穿过了') &&
        entry.text.includes('抵挡未被消耗')
      ),
      'Final Pursuit must pierce renewable spell block without consuming it or bypassing unrelated defenses',
    );
    cases.push('Final Pursuit pierces renewable spell block to prevent permanent one-on-one stalls');
  }

  {
    const fixture = spawnFixture(fixtureNames(), [0, 0]);
    enterPhaseTwo(fixture);
    const attacker = fixture.engine.fighters[0];
    fixture.engine.applyStatus(fixture.herobrine, {
      identityId: 'BURN',
      potency: 5,
      count: 2,
      attribution: {
        effectSourceId: 'hidden-removed-order-regression',
        effectSourceName: '隐匿退场顺序回归',
        applierId: attacker.id,
        applierName: attacker.name,
      },
    });
    forceFogBehind(fixture, attacker);
    const logsBefore = fixture.logs.length;
    fixture.engine.applyDamage(
      fixture.herobrine,
      fixture.herobrine.maxHp,
      'status',
      true,
      attacker,
      {
        actionName: '隐匿持续伤害回归',
        sourceKind: 'status',
        respectDefenses: false,
      },
    );
    fixture.engine.markDefeated(fixture.herobrine, {
      killer: attacker,
      message: '💀 【隐匿持续伤害回归】雾中的本体生命归零。',
    });
    const removalLogs = fixture.logs.slice(logsBefore);
    const revealIndex = removalLogs.findIndex((entry) => entry.text.includes('【Removed Herobrine.】'));
    assert(
      fixture.event.phase === 'removed' &&
      revealIndex >= 0 &&
      removalLogs.slice(0, revealIndex).every((entry) =>
        !entry.text.includes('Herobrine') &&
        entry.actorName !== 'Herobrine'
      ),
      `A hidden status defeat must stay anonymous until the Removed announcement: ${JSON.stringify(removalLogs)}`,
    );
    assert(
      !removalLogs.some((entry) => entry.text.includes('【雾中归来】')) &&
      removalLogs.some((entry) =>
        entry.text.includes('【Removed 状态重置】') &&
        entry.text.includes('【未知】')
      ),
      'A hidden status defeat should clean up as unknown without fabricating a fog-return event',
    );
    const revivalTurn = fixture.event.removedReturnTurn;
    assert(revivalTurn !== undefined, 'A non-terminal hidden defeat should schedule Herobrine revival');
    const revivalLogStart = fixture.logs.length;
    advanceGlobalAction(fixture, revivalTurn);
    const revivalLogs = fixture.logs.slice(revivalLogStart);
    assert(
      getHerobrineEvent(fixture.engine.battleState)?.phase === 'phase_two' &&
      fixture.herobrine.name === 'Herobrine' &&
      fixture.herobrine.displayName === 'Herobrine' &&
      shouldRenderNpcUnit(fixture.herobrine) &&
      isNpcTargetable(fixture.herobrine) &&
      revivalLogs.some((entry) =>
        entry.text.includes('【你确定吗？】') &&
        entry.actorName === 'Herobrine'
      ),
      `Removed revival must restore the canonical public identity after a hidden defeat: ${JSON.stringify({
        phase: fixture.event.phase,
        name: fixture.herobrine.name,
        displayName: fixture.herobrine.displayName,
        visible: shouldRenderNpcUnit(fixture.herobrine),
        targetable: isNpcTargetable(fixture.herobrine),
        revivalLogs,
      })}`,
    );
    cases.push('hidden phase-two status defeat stays anonymous until Removed, then revives with its canonical identity');
  }

  {
    const fixture = spawnFixture();
    enterPhaseTwo(fixture);
    const target = fixture.engine.fighters[0];
    applyHerobrineWitness(
      fixture.engine.createHerobrineRuntime(),
      target,
      5,
      '隐匿穿盾身份回归',
    );
    grantBarrier(target, 300, {
      identityId: 'BARRIER',
      sourceId: 'herobrine-hidden-identity-regression',
      displayName: '隐匿身份回归护盾',
      attribution: {
        effectSourceId: target.id,
        effectSourceName: '隐匿身份回归护盾',
        applierId: target.id,
        applierName: target.name,
      },
    });
    forceFogBehind(fixture);
    assert(
      fixture.herobrine.name === '【未知】' &&
      fixture.herobrine.displayName === '【未知】',
      'Fog Behind must persist the anonymous identity across generic engine branches',
    );
    const hiddenLogStart = fixture.logs.length;
    const charmApplied = fixture.engine.applyStatus(fixture.herobrine, {
      identityId: 'CHARMED',
      remainingTurns: 2,
      attribution: {
        effectSourceId: target.id,
        effectSourceName: '隐匿魅惑免疫回归',
        applierId: target.id,
        applierName: target.name,
      },
    });
    fixture.engine.applyDamage(target, 100, 'skill', false, fixture.herobrine, {
      actionName: '隐匿五层目击穿盾',
      sourceKind: 'custom',
    });
    fixture.engine.executeSkillAction(null, fixture.herobrine, target);
    const hiddenLogs = fixture.logs.slice(hiddenLogStart);
    assert(
      !charmApplied &&
      hiddenLogs.some((entry) =>
        entry.text.includes('【异常意志】') &&
        entry.text.includes('【未知】')
      ) &&
      hiddenLogs.some((entry) =>
        entry.text.includes('【孤立目击】') &&
        entry.text.includes('【未知】')
      ) &&
      hiddenLogs.some((entry) => entry.text.includes('【未知】')) &&
      hiddenLogs.every((entry) =>
        !entry.text.includes('Herobrine') &&
        entry.actorName !== 'Herobrine'
      ),
      `Generic actions, immunity logs and metadata during Fog Behind must remain anonymous: ${JSON.stringify(hiddenLogs)}`,
    );
    const returnTurn = fixture.event.hiddenUntilTurn!;
    advanceGlobalAction(fixture, returnTurn);
    assert(
      String(fixture.herobrine.name) === 'Herobrine' &&
      String(fixture.herobrine.displayName) === 'Herobrine',
      'Fog Behind return must restore the canonical identity exactly once',
    );
    cases.push('Fog Behind keeps generic actions, shield bypass, immunity logs and structured metadata anonymous until return');
  }

  {
    const terminalReviveCases = [
      {
        name: 'M1A2_abrams_sep@A',
        prepare: (fighter: Fighter) => {
          fighter.isWT = true;
          fighter.transformed = true;
          fighter.wtSpawnPoints = 8;
          fighter.wtBackupUsed = false;
        },
        forbiddenLog: '【备用载具】',
      },
      {
        name: '丝瓜uli@A',
        prepare: (fighter: Fighter) => {
          applyStatus(fighter, {
            identityId: 'VALO_ULT_RUN_IT_BACK',
            remainingTurns: 2,
            attribution: { effectSourceId: fighter.id },
          });
        },
        forbiddenLog: '【再火一回】',
      },
      {
        name: '屑@A',
        prepare: () => undefined,
        forbiddenLog: '返场倒计时',
      },
      {
        name: '表情@A',
        prepare: () => undefined,
        forbiddenLog: '【四处认主】',
      },
    ] as const;

    for (const scenario of terminalReviveCases) {
      const fixture = spawnFixture([scenario.name, '终局陪练@B']);
      fixture.engine.fighters
        .filter((fighter) => !fighter.isNpc)
        .forEach((fighter) => {
          fighter.maxHp = 100000;
          fighter.currentHp = 100000;
          fixture.engine.syncHpPct(fighter);
        });
      enterPhaseTwo(fixture);
      const survivor = fixture.engine.fighters[0];
      const other = fixture.engine.fighters[1];
      scenario.prepare(survivor);
      fixture.engine.markDefeated(other, {
        killer: survivor,
        message: '最终追猎复活旁路回归：陪练退场',
        awardKill: false,
        bypassDeathSaves: true,
      });
      assert(fixture.event.finalPursuit, `${scenario.name} should enter Final Pursuit before terminal defeat`);
      const logStart = fixture.logs.length;
      fixture.engine.markDefeated(survivor, {
        killer: fixture.herobrine,
        message: `💀 【最终追猎回归】${survivor.name} 被 Herobrine 击倒。`,
      });
      fixture.engine.handleDeathsAndRevives({ current: false });
      const terminalLogs = fixture.logs.slice(logStart);
      assert(
        fixture.event.completed &&
        fixture.event.outcome === 'contestants_defeated' &&
        fixture.event.finalPursuitDefeatedContestantId === survivor.id,
        `${scenario.name} terminal defeat should be recorded as the conclusive Final Pursuit loss`,
      );
      assert(
        survivor.isDead &&
        survivor.currentHp === 0 &&
        !terminalLogs.some((entry) => entry.text.includes(scenario.forbiddenLog)),
        `${scenario.name} must not re-enter through ${scenario.forbiddenLog}: ${JSON.stringify(terminalLogs)}`,
      );
    }
    cases.push('Final Pursuit terminal defeat suppresses backup vehicle, Run It Back, Joker return and Emote ownership revival');
  }

  {
    const fixture = spawnFixture(['表情@A', '玄凝@B', '小汀@C', '牢鳄@D', '丝瓜uli@E']);
    fixture.engine.fighters
      .filter((fighter) => !fighter.isNpc)
      .forEach((fighter) => {
        fighter.maxHp = 100000;
        fighter.currentHp = 100000;
        fixture.engine.syncHpPct(fighter);
      });
    revealHerobrine(fixture);
    const emote = fixture.engine.fighters[0];
    const logStart = fixture.logs.length;
    let resolved = false;
    withRandomSequence(Array.from({ length: 80 }, () => 0), () => {
      resolved = fixture.engine.executeSkillAction('emote_mark_owner', emote, fixture.herobrine);
    });
    const interactionLogs = fixture.logs.slice(logStart);
    assert(
      emote.emoteFamiliarTargetId !== fixture.herobrine.id &&
      !findIdentity(fixture.herobrine, 'EMOTE_FAMILIAR'),
      'Event NPCs must never become Emote owner candidates',
    );
    assert(
      interactionLogs.some((entry) =>
        entry.text.includes('【脸熟失败】') &&
        entry.text.includes('事件单位') &&
        entry.text.includes('不能成为')
      ) &&
      !interactionLogs.some((entry) => entry.text.includes('认主会优先找 Herobrine')),
      `Emote should explain why the NPC cannot become an owner without making a false promise: resolved=${resolved}; targetable=${isNpcTargetable(fixture.herobrine)}; emote=${emote.currentHp}/${emote.isDead}; logs=${JSON.stringify(interactionLogs)}`,
    );
    cases.push('Emote may damage and weaken Herobrine but cannot mark an event NPC as a future owner');
  }

  {
    const emote = makeFighter('表情@A');
    const summon = makeFighter('普通召唤物@B');
    summon.isSummon = true;
    summon.cannotWin = true;
    const fixture = makeDeathEngine([emote, summon]);
    withRandomSequence(Array.from({ length: 80 }, () => 0), () => {
      fixture.engine.executeSkillAction(
        'emote_mark_owner',
        fixture.engine.fighters[0],
        fixture.engine.fighters[1],
      );
    });
    assert(
      fixture.logs.some((entry) =>
        entry.text.includes('【脸熟失败】') &&
        entry.text.includes('属于召唤物') &&
        !entry.text.includes('属于事件单位')
      ),
      `Emote must distinguish an ordinary summon from an event NPC: ${JSON.stringify(fixture.logs)}`,
    );
    cases.push('Emote owner rejection distinguishes ordinary summons from event NPCs');
  }

  {
    const fixture = spawnFixture([
      '混乱靶甲@A',
      '混乱靶乙@B',
      '混乱靶丙@C',
      '混乱靶丁@D',
      '混乱靶戊@E',
    ]);
    revealHerobrine(fixture);
    fixture.herobrine.agl = 100000;
    fixture.engine.fighters.forEach((fighter) => {
      if (fighter.id !== fixture.herobrine.id) {
        fighter.cannotAct = true;
        fighter.agl = 0;
        fighter.maxHp = 100000;
        fighter.currentHp = 100000;
        fixture.engine.syncHpPct(fighter);
      }
    });
    applyStatus(fixture.herobrine, {
      identityId: 'CONFUSED',
      remainingTurns: 1,
      attribution: { effectSourceId: 'herobrine-confusion-regression' },
    });
    const logStart = fixture.logs.length;
    withRandomSequence(Array.from({ length: 120 }, () => 0.1), () => {
      fixture.engine.step({ current: false });
    });
    const actionLogs = fixture.logs.slice(logStart);
    const witnessedTarget = fixture.engine.fighters.find((fighter) =>
      !fighter.isNpc && getWitnessStacks(fighter) > 0,
    );
    assert(
      actionLogs.some((entry) => entry.text.includes('【混乱】') && entry.text.includes('只能用普通攻击')) &&
      actionLogs.some((entry) => entry.text.includes('【空洞凝视结算】') && entry.text.includes('实际生命伤害')) &&
      actionLogs.some((entry) => entry.text.includes('【目击】')) &&
      !actionLogs.some((entry) => entry.text.includes('Herobrine 攻击了') && entry.text.includes('预计造成')) &&
      !!witnessedTarget,
      `Confusion must change Herobrine's target without replacing Empty Gaze mechanics: ${JSON.stringify(actionLogs)}`,
    );
    cases.push('confusion changes visible Herobrine target without bypassing Empty Gaze damage and Witness');
  }

  {
    const fixture = spawnFixture([
      '隐匿混乱靶甲@A',
      '隐匿混乱靶乙@B',
      '隐匿混乱靶丙@C',
      '隐匿混乱靶丁@D',
      '隐匿混乱靶戊@E',
    ], [0, 0]);
    revealHerobrine(fixture);
    forceFogBehind(fixture);
    fixture.herobrine.agl = 100000;
    fixture.engine.fighters.forEach((fighter) => {
      if (fighter.id !== fixture.herobrine.id) {
        fighter.cannotAct = true;
        fighter.agl = 0;
        fighter.maxHp = 100000;
        fighter.currentHp = 100000;
        fixture.engine.syncHpPct(fighter);
      }
    });
    applyStatus(fixture.herobrine, {
      identityId: 'CONFUSED',
      remainingTurns: 1,
      attribution: { effectSourceId: 'hidden-herobrine-confusion-regression' },
    });
    const logStart = fixture.logs.length;
    withRandomSequence(Array.from({ length: 120 }, () => 0.1), () => {
      fixture.engine.step({ current: false });
    });
    const actionLogs = fixture.logs.slice(logStart);
    assert(
      actionLogs.some((entry) => entry.text.includes('【雾后袭击结算】') && entry.text.includes('实际生命伤害')) &&
      actionLogs.some((entry) => entry.text.includes('【目击】')) &&
      actionLogs.every((entry) =>
        entry.actorId !== fixture.herobrine.id ||
        (!entry.text.includes('Herobrine') && entry.actorName !== 'Herobrine')
      ),
      `Confused Fog Behind attacks must retain anonymous Empty Gaze semantics: ${JSON.stringify(actionLogs)}`,
    );
    cases.push('confusion preserves anonymous Fog Behind damage and Witness semantics');
  }

  {
    const fixture = spawnFixture([
      '分身混乱靶甲@A',
      '分身混乱靶乙@B',
      '分身混乱靶丙@C',
      '分身混乱靶丁@D',
      '分身混乱靶戊@E',
    ]);
    enterPhaseTwo(fixture);
    const clone = fixture.engine.fighters.find((fighter) => isHerobrineClone(fighter));
    assert(clone, 'Phase two should provide a clone for confusion dispatch regression');
    clone.agl = 100000;
    fixture.engine.fighters.forEach((fighter) => {
      if (fighter.id !== clone.id) {
        fighter.cannotAct = true;
        fighter.agl = 0;
        fighter.maxHp = 100000;
        fighter.currentHp = 100000;
        fixture.engine.syncHpPct(fighter);
      }
    });
    applyStatus(clone, {
      identityId: 'CONFUSED',
      remainingTurns: 1,
      attribution: { effectSourceId: 'herobrine-clone-confusion-regression' },
    });
    const logStart = fixture.logs.length;
    fixture.engine.step({ current: false });
    const actionLogs = fixture.logs.slice(logStart);
    assert(
      actionLogs.some((entry) => (
        (
          entry.text.includes('【空洞袭击结算】') &&
          entry.text.includes('这次袭击没有增加目击')
        ) ||
        (
          entry.text.includes('【未知玩家】') &&
          entry.text.includes('只抓住了一团散开的雾')
        )
      )) &&
      !actionLogs.some((entry) => entry.text.includes(`${clone.name} 攻击了`) && entry.text.includes('预计造成')),
      `Confused clones must retain their own structured basic attack: ${JSON.stringify(actionLogs)}`,
    );
    cases.push('confusion changes clone target without replacing its structured no-Witness attack');
  }

  {
    const fixture = spawnFixture(['最终追猎幸存者@A', '雾后退场目标@B'], [0, 0]);
    revealHerobrine(fixture);
    const survivor = fixture.engine.fighters[0];
    const defeated = fixture.engine.fighters[1];
    forceFogBehind(fixture, survivor);
    defeated.maxHp = 1;
    defeated.currentHp = 1;
    defeated.def = 0;
    defeated.res = 0;
    defeated.agl = 0;
    fixture.herobrine.agl = 100000;
    fixture.engine.syncHpPct(defeated);
    withRandomSequence(Array.from({ length: 100 }, () => 0), () => {
      executeHerobrineTurn(
        fixture.engine.createHerobrineRuntime(),
        fixture.herobrine,
        defeated,
      );
    });
    assert(
      fixture.event.finalPursuit &&
      fixture.event.finalPursuitContestantId === survivor.id &&
      fixture.herobrine.name === 'Herobrine' &&
      fixture.herobrine.displayName === 'Herobrine' &&
      shouldRenderNpcUnit(fixture.herobrine) &&
      isNpcTargetable(fixture.herobrine),
      'A hidden Herobrine action that starts Final Pursuit must not restore its stale anonymous identity afterward',
    );
    assert(
      fixture.logs
        .slice(fixture.logs.findIndex((entry) => entry.text.startsWith('👁️ 【最终追猎】战场只剩')))
        .filter((entry) => entry.actorId === fixture.herobrine.id)
        .every((entry) => entry.actorName !== '【未知】'),
      'Final Pursuit logs emitted after the transition must use the restored Herobrine identity',
    );
    cases.push('Final Pursuit entered inside a Fog Behind action keeps the canonical identity after the action unwinds');
  }

  {
    const fixture = spawnFixture(['终局幸存者@A', '遗留召唤主人@B', '终局陪练@C']);
    enterPhaseTwo(fixture);
    const survivor = fixture.engine.fighters[0];
    const deadOwner = fixture.engine.fighters[1];
    const other = fixture.engine.fighters[2];
    const alliedSummon = makeFighter('幸存者召唤物@A');
    alliedSummon.isSummon = true;
    alliedSummon.cannotWin = true;
    alliedSummon.summonerId = survivor.id;
    alliedSummon.teamId = survivor.teamId;
    const outsiderSummon = makeFighter('遗留召唤物@B');
    outsiderSummon.isSummon = true;
    outsiderSummon.cannotWin = true;
    outsiderSummon.summonerId = deadOwner.id;
    outsiderSummon.teamId = deadOwner.teamId;
    fixture.engine.fighters.push(alliedSummon, outsiderSummon);

    fixture.engine.markDefeated(deadOwner, {
      killer: survivor,
      message: '最终追猎边界回归：召唤主人退场',
      awardKill: false,
      bypassDeathSaves: true,
    });
    fixture.engine.markDefeated(other, {
      killer: survivor,
      message: '最终追猎边界回归：陪练退场',
      awardKill: false,
      bypassDeathSaves: true,
    });
    assert(
      fixture.event.finalPursuit &&
      fixture.engine.fighters
        .filter((fighter) => isHerobrineEventUnit(fighter) && fighter.id !== fixture.herobrine.id)
        .every((fighter) => !fixture.engine.isActiveCombatant(fighter)),
      'Final Pursuit must retire every trace and clone before the terminal duel begins',
    );

    fixture.herobrine.maxHp = 100;
    fixture.herobrine.currentHp = 100;
    fixture.engine.syncHpPct(fixture.herobrine);
    const blocked = fixture.engine.applyDamage(
      fixture.herobrine,
      1000,
      'skill',
      true,
      outsiderSummon,
      { actionName: '遗留召唤物越界攻击', sourceKind: 'custom' },
    );
    assert(
      blocked === 0 &&
      fixture.herobrine.currentHp === 100 &&
      !fixture.event.completed,
      'A summon left by a defeated contestant must not decide another contestant’s Final Pursuit',
    );

    const lethal = fixture.engine.applyDamage(
      fixture.herobrine,
      1000,
      'skill',
      true,
      alliedSummon,
      { actionName: '幸存者召唤物终局攻击', sourceKind: 'custom' },
    );
    assert(lethal === 100 && Number(fixture.herobrine.currentHp) === 0, 'The survivor’s own summon should remain part of the Final Pursuit side');
    fixture.engine.markDefeated(fixture.herobrine, {
      killer: alliedSummon,
      message: '最终追猎召唤物终结回归',
    });
    fixture.engine.checkWinCondition(
      fixture.engine.fighters.filter((fighter) => fixture.engine.isActiveCombatant(fighter)),
    );
    assert(
      fixture.event.completed &&
      fixture.event.outcome === 'true_removal' &&
      fixture.logs.some((entry) => entry.text.includes(`最终胜者：`) && entry.text.includes(survivor.name)) &&
      !fixture.logs.some((entry) => entry.text.includes('最终胜者：') && entry.text.includes(outsiderSummon.name)),
      'A summon-assisted Final Pursuit victory must settle immediately for the sole contestant',
    );
    cases.push('Final Pursuit clears event helpers, blocks defeated owners’ summons, and credits the survivor side');
  }

  {
    const terminalInlineSaveCases = [
      {
        name: '牢鳄@A',
        prepare: (fighter: Fighter) => {
          fighter.isGacha = true;
          fighter.transformed = true;
          fighter.job = 'LUCK_EMPEROR';
          fighter.jobData = { ...fighter.jobData, name: '欧皇' };
          fighter.hasUsedGachaDeathSave = false;
        },
        forbiddenLogs: ['【欧皇护符】'],
      },
      {
        name: '玄凝@A',
        prepare: (fighter: Fighter) => {
          fighter.isGamer = true;
          fighter.isSon = false;
          fighter.job = 'ALL_PLATFORM_CHAMPION';
          fighter.hasUsedGamerContinue = false;
        },
        forbiddenLogs: ['【CONTINUE?】', '【续关完成】'],
      },
      {
        name: '刺猬人@A',
        prepare: (fighter: Fighter) => {
          fighter.isTokusatsu = true;
          fighter.job = 'MIRACLE_MONSTER_BUJIN';
          fighter.hasUsedTokusatsuDefiance = false;
          applyStatus(fighter, {
            identityId: 'TOKUSATSU_DEFIANCE',
            remainingTurns: 1,
            attribution: { effectSourceId: 'final-pursuit-terminal-save-regression' },
          });
        },
        forbiddenLogs: ['【悲愿不倒】', '【悲愿反扑】'],
      },
    ] as const;

    for (const scenario of terminalInlineSaveCases) {
      const fixture = spawnFixture([scenario.name, '终局陪练@B']);
      enterPhaseTwo(fixture);
      const survivor = fixture.engine.fighters[0];
      const other = fixture.engine.fighters[1];
      scenario.prepare(survivor);
      survivor.maxHp = 100;
      survivor.currentHp = 100;
      fixture.engine.syncHpPct(survivor);
      fixture.engine.markDefeated(other, {
        killer: survivor,
        message: '最终追猎即时续命回归：陪练退场',
        awardKill: false,
        bypassDeathSaves: true,
      });
      const logStart = fixture.logs.length;
      fixture.engine.applyDamage(
        survivor,
        10000,
        'skill',
        true,
        fixture.herobrine,
        { actionName: '最终追猎致命攻击', sourceKind: 'custom' },
      );
      fixture.engine.flushDeferredDamageEvents(survivor);
      if (survivor.currentHp <= 0 && !survivor.isDead && !survivor.isDeadAnnounced) {
        fixture.engine.markDefeated(survivor, {
          killer: fixture.herobrine,
          message: `💀 【最终追猎回归】${survivor.name} 被 Herobrine 击倒。`,
        });
      }
      fixture.engine.handleDeathsAndRevives({ current: false });
      const terminalLogs = fixture.logs.slice(logStart);
      assert(
        fixture.event.completed &&
        fixture.event.outcome === 'contestants_defeated' &&
        survivor.currentHp === 0 &&
        survivor.isDead &&
        scenario.forbiddenLogs.every((text) => !terminalLogs.some((entry) => entry.text.includes(text))),
        `${scenario.name} must not survive Final Pursuit through inline lockblood or revival: ${JSON.stringify(terminalLogs)}`,
      );
    }
    cases.push('Final Pursuit suppresses Gacha charm, Gamer continue and Tokusatsu persistent or fresh death saves');
  }

  return cases;
}
