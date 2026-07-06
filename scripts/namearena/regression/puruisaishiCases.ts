import {
  addOriginiumInfection,
  notePuruisaishiRoundActor,
  processPuruisaishiRoundEnd,
  spawnPuruisaishiEvent,
} from '../../../lib/namearena/puruisaishiMechanics';
import {
  assert,
  localProject,
  makeFighter,
  withRandomSequence,
} from '../shared/harness';
import { makeDeathEngine } from './deathAccountingCases';

function completeOriginiumBigRound(engine: ReturnType<typeof makeDeathEngine>['engine']): void {
  engine.fighters
    .filter((fighter) => !fighter.isNpc && !fighter.cannotAct && !fighter.isDead && fighter.currentHp > 0)
    .forEach((fighter) => notePuruisaishiRoundActor(engine.createPuruisaishiRuntime(), fighter));
  processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
}

export function runPuruisaishiCases(): string[] {
  const cases: string[] = [];

  {
    const { engine, logs } = makeDeathEngine([
      makeFighter('普瑞测试者A@A'),
      makeFighter('普瑞测试者B@B'),
      makeFighter('普瑞测试者C@C'),
    ]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    const puruisaishi = engine.fighters.find((fighter) => fighter.isPuruisaishi);
    const core = engine.fighters.find((fighter) => fighter.isOriginiumCore);

    assert(puruisaishi, 'Puruisaishi should spawn as an NPC fighter');
    assert(core, 'Ananna should spawn with Puruisaishi');
    assert(puruisaishi.isNpc && puruisaishi.cannotAct && puruisaishi.cannotWin, 'Puruisaishi should be a non-acting non-winning NPC');
    assert(core.isNpc && core.cannotAct && core.cannotWin, 'Ananna should be a non-acting non-winning NPC');
    assert(!engine.getSelectableTargets(engine.fighters[0]).some((target) => target.id === puruisaishi.id || target.id === core.id), 'Phase-1 Puruisaishi and protected Ananna should not be selectable targets');
    assert(logs.some((entry) => entry.text.includes('普瑞赛斯') && entry.text.includes('不会成为胜利者')), 'Puruisaishi entry log should explain NPC victory rules');
    cases.push('Puruisaishi spawns as protected non-winning NPC event');
  }

  {
    const { engine, logs } = makeDeathEngine([
      makeFighter('阿喃那攻击者@A'),
      makeFighter('旁观者B@B'),
      makeFighter('旁观者C@C'),
    ]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    engine.turnCount = 20;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const core = engine.fighters.find((fighter) => fighter.isOriginiumCore);
    const crystal = engine.fighters.find((fighter) => fighter.isOriginiumCrystal);
    assert(core && crystal, 'Ananna growth should create an originium crystal');
    crystal.untargetableUntilTurn = 0;

    const coreHpBefore = core.currentHp;
    const crystalHpBefore = crystal.currentHp;
    const actual = engine.applyDamage(core, 120, 'skill', false, engine.fighters[0], { actionName: '测试攻击' });

    assert(actual > 0, 'Damage redirected from Ananna should still count as actual crystal damage');
    assert(core.currentHp === coreHpBefore, 'Ananna should not take direct damage while crystals exist');
    assert(crystal.currentHp < crystalHpBefore, 'Originium crystal should take the shared damage');
    assert(logs.some((entry) => entry.text.includes('阿喃那') && entry.text.includes('均摊')), 'Ananna damage sharing should be logged');
    cases.push('Ananna redirects incoming damage to crystals');
  }

  {
    const { engine } = makeDeathEngine([
      makeFighter('结晶攻击者@A'),
      makeFighter('旁观者B@B'),
      makeFighter('旁观者C@C'),
    ]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    engine.turnCount = 20;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const attacker = engine.fighters[0];
    const crystal = engine.fighters.find((fighter) => fighter.isOriginiumCrystal);
    assert(crystal, 'Originium crystal should exist for infection-on-attack test');
    crystal.untargetableUntilTurn = 0;

    withRandomSequence([0], () => {
      engine.applyDamage(crystal, 10, 'skill', false, attacker, { actionName: '攻击结晶' });
    });

    assert((attacker.originiumInfectionStacks ?? 0) === 3, `Attacking a crystal should infect the attacker for 3 stacks in forced roll, got ${attacker.originiumInfectionStacks ?? 0}`);
    assert(attacker.status.some((status) => status.type === 'ORIGINIUM_DISEASE'), 'Originium disease should use a visible status entry');
    cases.push('Attacking originium crystal can infect attacker');
  }

  {
    const { engine } = makeDeathEngine([
      makeFighter('增殖A@A'),
      makeFighter('增殖B@B'),
      makeFighter('增殖C@C'),
    ]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    engine.turnCount = 19;

    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    assert(engine.fighters.filter((fighter) => fighter.isOriginiumCrystal).length === 0, 'Ananna should not grow before 20 global turns');

    engine.turnCount = 20;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const firstCrystal = engine.fighters.find((fighter) => fighter.isOriginiumCrystal);
    assert(firstCrystal, 'Ananna should grow one crystal at the 20-turn interval');

    engine.turnCount = 21;
    firstCrystal.untargetableUntilTurn = 0;
    engine.applyDamage(firstCrystal, 1, 'skill', false, engine.fighters[0], { actionName: '阻止增殖测试' });
    completeOriginiumBigRound(engine);
    assert(engine.fighters.filter((fighter) => fighter.isOriginiumCrystal).length === 1, 'Attacked crystal should not grow during that big round, and Ananna should wait for the next 20-turn interval');

    engine.turnCount = 22;
    completeOriginiumBigRound(engine);
    assert(engine.fighters.filter((fighter) => fighter.isOriginiumCrystal).length === 2, 'Unattacked crystals should still use completed big rounds for growth');
    cases.push('Ananna grows every 20 turns and attacked crystals skip big-round growth');
  }

  {
    const { engine, logs } = makeDeathEngine([
      makeFighter('矿石病患者@A'),
      makeFighter('旁观者B@B'),
      makeFighter('旁观者C@C'),
    ]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    const victim = engine.fighters[0];

    addOriginiumInfection(engine.createPuruisaishiRuntime(), victim, 80, '测试堆层');
    engine.handleDeathsAndRevives({ current: false });

    assert(victim.isDead, '80-stack originium disease should finalize death');
    assert(engine.fighters.some((fighter) => fighter.isOriginiumCrystal), 'Infected death should create an originium crystal');
    assert(logs.some((entry) => entry.text.includes('矿石病达到 80 层')), '80-stack death should be logged');
    assert(logs.some((entry) => entry.text.includes('源石析出')), 'Infected death should log crystal creation');
    cases.push('Originium disease at 80 stacks kills and crystallizes carrier');
  }

  {
    const { engine, logs } = makeDeathEngine([
      makeFighter('护盾攻击者@A'),
      makeFighter('感染清理目标@B'),
      makeFighter('旁观者C@C'),
    ]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    engine.turnCount = 20;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    engine.turnCount = 50;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const puruisaishi = engine.fighters.find((fighter) => fighter.isPuruisaishi);
    const crystal = engine.fighters.find((fighter) => fighter.isOriginiumCrystal);
    assert(puruisaishi && crystal, 'Phase-2 shield test should have Puruisaishi and a crystal');
    assert((puruisaishi.puruisaishiPhase ?? 1) === 2, 'Puruisaishi should enter phase 2 at 50 global turns');
    assert((puruisaishi.puruisaishiShield ?? 0) > 0, 'Puruisaishi phase 2 should grant shield');

    const hpBefore = puruisaishi.currentHp;
    engine.applyDamage(puruisaishi, (puruisaishi.puruisaishiShield ?? 0) + 1000, 'skill', true, engine.fighters[0], { actionName: '破盾测试' });
    assert(puruisaishi.currentHp === hpBefore, 'Puruisaishi shield floor should prevent overflow damage while crystals exist');
    assert((puruisaishi.puruisaishiShield ?? 0) === 1, `Puruisaishi shield should stay at 1 while crystals exist, got ${puruisaishi.puruisaishiShield ?? 0}`);

    addOriginiumInfection(engine.createPuruisaishiRuntime(), engine.fighters[1], 12, '退场清理测试');
    engine.fighters.filter((fighter) => fighter.isOriginiumCrystal).forEach((fighter) => {
      localProject.setCurrentHp(fighter, 0);
      fighter.isDead = true;
      fighter.isDeadAnnounced = true;
    });
    engine.applyDamage(puruisaishi, 1, 'skill', true, engine.fighters[0], { actionName: '最终破盾' });

    assert(puruisaishi.isDead, 'Puruisaishi should retreat when phase-2 shield reaches zero without crystals');
    assert((engine.fighters[1].originiumInfectionStacks ?? 0) === 0, 'Puruisaishi retreat should clear originium disease stacks');
    assert(!engine.fighters[1].status.some((status) => status.type === 'ORIGINIUM_DISEASE'), 'Puruisaishi retreat should remove disease status');
    assert(logs.some((entry) => entry.text.includes('普瑞赛斯退场') && entry.text.includes('清除全场矿石病')), 'Puruisaishi retreat should be logged');
    cases.push('Puruisaishi phase-2 shield floors at 1 and retreat clears disease');
  }

  {
    const { engine } = makeDeathEngine([
      makeFighter('转阶段A@A'),
      makeFighter('转阶段B@B'),
      makeFighter('转阶段C@C'),
    ]);
    engine.turnCount = 12;
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    const puruisaishi = engine.fighters.find((fighter) => fighter.isPuruisaishi);
    assert(puruisaishi, 'Puruisaishi should exist for phase threshold test');

    engine.turnCount = 61;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    assert((puruisaishi.puruisaishiPhase ?? 1) === 1, `Puruisaishi should stay phase 1 at 49 turns after spawn, got ${puruisaishi.puruisaishiPhase ?? 1}`);

    engine.turnCount = 62;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    assert((puruisaishi.puruisaishiPhase ?? 1) === 2, `Puruisaishi should enter phase 2 exactly 50 turns after spawn, got ${puruisaishi.puruisaishiPhase ?? 1}`);
    assert(puruisaishi.puruisaishiPhaseTwoStartedTurn === 62, `Puruisaishi phase 2 start turn should be spawn+50, got ${puruisaishi.puruisaishiPhaseTwoStartedTurn}`);
    cases.push('Puruisaishi enters phase 2 exactly 50 turns after spawn');
  }

  {
    const { engine } = makeDeathEngine([
      makeFighter('迟到检查A@A'),
      makeFighter('迟到检查B@B'),
      makeFighter('迟到检查C@C'),
    ]);
    engine.turnCount = 10;
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    const puruisaishi = engine.fighters.find((fighter) => fighter.isPuruisaishi);
    assert(puruisaishi, 'Puruisaishi should exist for late phase threshold test');

    engine.turnCount = 80;
    withRandomSequence([0, 0], () => {
      processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    });

    assert((puruisaishi.puruisaishiPhase ?? 1) === 2, `Puruisaishi should enter phase 2 even when the exact threshold tick was missed, got ${puruisaishi.puruisaishiPhase ?? 1}`);
    assert(puruisaishi.puruisaishiPhaseTwoStartedTurn === 60, `Puruisaishi late phase start should still be spawn+50, got ${puruisaishi.puruisaishiPhaseTwoStartedTurn}`);
    const totalStacks = engine.fighters.reduce((sum, fighter) => sum + (fighter.originiumInfectionStacks ?? 0), 0);
    assert(totalStacks === 4, `Puruisaishi late phase processing should preserve the 20-turn pulse schedule, got ${totalStacks} total stacks`);
    cases.push('Puruisaishi late phase check does not delay phase-2 timing');
  }

  {
    const { engine, logs } = makeDeathEngine([
      makeFighter('二阶段A@A'),
      makeFighter('二阶段B@B'),
      makeFighter('二阶段C@C'),
    ]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    engine.turnCount = 50;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const puruisaishi = engine.fighters.find((fighter) => fighter.isPuruisaishi);
    assert(puruisaishi && (puruisaishi.puruisaishiPhase ?? 1) === 2, 'Puruisaishi should be phase 2 before 20-turn stack test');

    engine.turnCount = 69;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    assert(engine.fighters.every((fighter) => (fighter.originiumInfectionStacks ?? 0) === 0), 'Puruisaishi phase 2 should not add stacks before 20 turns have elapsed');

    engine.turnCount = 70;
    withRandomSequence([0, 0], () => {
      processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    });

    const totalStacks = engine.fighters.reduce((sum, fighter) => sum + (fighter.originiumInfectionStacks ?? 0), 0);
    assert(totalStacks === 4, `Puruisaishi should add exactly one phase-2 target package after 20 turns, got total stacks ${totalStacks}`);
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const totalStacksAfterDuplicateCall = engine.fighters.reduce((sum, fighter) => sum + (fighter.originiumInfectionStacks ?? 0), 0);
    assert(totalStacksAfterDuplicateCall === 4, 'Puruisaishi phase-2 20-turn pulse should not duplicate in the same turn');
    assert(logs.some((entry) => entry.text.includes('已过去 20 回合')), 'Puruisaishi phase-2 stack log should explain the 20-turn trigger');
    cases.push('Puruisaishi phase-2 stacks once per 20 turns');
  }

  return cases;
}
