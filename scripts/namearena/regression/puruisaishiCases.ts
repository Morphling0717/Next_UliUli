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
    engine.turnCount = 6;
    completeOriginiumBigRound(engine);
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
    engine.turnCount = 6;
    completeOriginiumBigRound(engine);
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
    engine.turnCount = 6;

    notePuruisaishiRoundActor(engine.createPuruisaishiRuntime(), engine.fighters[0]);
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    assert(engine.fighters.filter((fighter) => fighter.isOriginiumCrystal).length === 0, 'Ananna should not grow before a completed big round');

    notePuruisaishiRoundActor(engine.createPuruisaishiRuntime(), engine.fighters[1]);
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    assert(engine.fighters.filter((fighter) => fighter.isOriginiumCrystal).length === 0, 'Ananna should still wait for all active actors');

    notePuruisaishiRoundActor(engine.createPuruisaishiRuntime(), engine.fighters[2]);
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const firstCrystal = engine.fighters.find((fighter) => fighter.isOriginiumCrystal);
    assert(firstCrystal, 'Ananna should grow one crystal after a completed big round');

    engine.turnCount = 7;
    firstCrystal.untargetableUntilTurn = 0;
    engine.applyDamage(firstCrystal, 1, 'skill', false, engine.fighters[0], { actionName: '阻止增殖测试' });
    completeOriginiumBigRound(engine);
    assert(engine.fighters.filter((fighter) => fighter.isOriginiumCrystal).length === 2, 'Attacked crystal should not grow during that big round, while Ananna still grows one crystal');
    cases.push('Originium growth uses completed big rounds and attacked crystals skip growth');
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
    engine.turnCount = 1;
    completeOriginiumBigRound(engine);
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
    const { engine, logs } = makeDeathEngine([
      makeFighter('大回合A@A'),
      makeFighter('大回合B@B'),
      makeFighter('大回合C@C'),
    ]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    engine.turnCount = 50;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const puruisaishi = engine.fighters.find((fighter) => fighter.isPuruisaishi);
    assert(puruisaishi && (puruisaishi.puruisaishiPhase ?? 1) === 2, 'Puruisaishi should be phase 2 before big-round stack test');

    notePuruisaishiRoundActor(engine.createPuruisaishiRuntime(), engine.fighters[0]);
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    assert(engine.fighters.every((fighter) => (fighter.originiumInfectionStacks ?? 0) === 0), 'Puruisaishi phase 2 should not add stacks after only one actor in the big round');

    notePuruisaishiRoundActor(engine.createPuruisaishiRuntime(), engine.fighters[1]);
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    assert(engine.fighters.every((fighter) => (fighter.originiumInfectionStacks ?? 0) === 0), 'Puruisaishi phase 2 should not add stacks before every actor has acted');

    withRandomSequence([0, 0], () => {
      notePuruisaishiRoundActor(engine.createPuruisaishiRuntime(), engine.fighters[2]);
      processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    });

    const totalStacks = engine.fighters.reduce((sum, fighter) => sum + (fighter.originiumInfectionStacks ?? 0), 0);
    assert(totalStacks === 4, `Puruisaishi should add exactly one phase-2 target package after a completed big round, got total stacks ${totalStacks}`);
    assert(logs.some((entry) => entry.text.includes('完成一个大回合')), 'Puruisaishi phase-2 stack log should explain the big-round trigger');
    cases.push('Puruisaishi phase-2 stacks once per completed big round');
  }

  return cases;
}
