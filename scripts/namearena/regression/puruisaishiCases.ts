import {
  addOriginiumInfection,
  clearAllOriginiumAndRetreat,
  processPuruisaishiRoundEnd,
  spawnPuruisaishiEvent,
} from '../../../lib/namearena/puruisaishiMechanics';
import { consumeCompletedLargeRound, noteLargeRoundActor } from '../../../lib/namearena/battleState';
import { getTargetSelectionWeight } from '../../../lib/namearena/targeting';
import { tryAdvanceYuzuPhaseByHp } from '../../../lib/namearena/yuzuMechanics';
import { activateGachaSummonLifesteal } from '../../../lib/namearena/gachaMechanics';
import type { DamageApplicationOptions } from '../../../lib/namearena/types';
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
    .forEach((fighter) => noteLargeRoundActor(engine.battleState, engine.fighters, fighter));
  processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
  consumeCompletedLargeRound(engine.battleState, engine.fighters);
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
      makeFighter('群伤测试者@A'),
      makeFighter('普通受击者@B'),
      makeFighter('旁观者C@C'),
    ]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    const caster = engine.fighters[0];
    const normalTarget = engine.fighters[1];
    const puruisaishi = engine.fighters.find((fighter) => fighter.isPuruisaishi);
    const core = engine.fighters.find((fighter) => fighter.isOriginiumCore);
    assert(puruisaishi && core, 'Puruisaishi AoE test should have phase-1 Puruisaishi and Ananna');
    const puruHpBefore = puruisaishi.currentHp;
    const coreHpBefore = core.currentHp;
    const targetHpBefore = normalTarget.currentHp;

    caster.mag = 500;
    caster.atk = 300;
    caster.status.push({ type: 'AIM', duration: 1 });
    engine.executeSkillAction('exodia_obliterate', caster, normalTarget);

    assert(normalTarget.currentHp < targetHpBefore, 'AoE skill should still hit normal selectable enemies');
    assert(puruisaishi.currentHp === puruHpBefore, 'Phase-1 Puruisaishi should not take AoE damage');
    assert(core.currentHp === coreHpBefore, 'Protected Ananna should not take AoE damage');
    assert(!logs.some((entry) => entry.text.includes('怒火命中 普瑞赛斯')), 'AoE logs should not claim a hit on phase-1 Puruisaishi');
    assert(!logs.some((entry) => entry.text.includes('怒火命中 阿喃那')), 'AoE logs should not claim a hit on protected Ananna');
    cases.push('Phase-1 Puruisaishi and protected Ananna ignore hostile AoE');
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
    const damageOptions: DamageApplicationOptions = { actionName: '测试攻击' };
    const actual = engine.applyDamage(core, 120, 'skill', false, engine.fighters[0], damageOptions);

    assert(actual === 0, `Damage redirected from Ananna should count as zero damage to the core body, got ${actual}`);
    assert(damageOptions.redirectedByOriginiumCore, 'Ananna redirect should be exposed to custom skill resolution');
    assert((damageOptions.redirectedOriginiumDamage ?? 0) > 0, 'Ananna redirect should report the separately resolved crystal damage');
    assert(core.currentHp === coreHpBefore, 'Ananna should not take direct damage while crystals exist');
    assert(crystal.currentHp < crystalHpBefore, 'Originium crystal should take the shared damage');
    assert(logs.some((entry) => entry.text.includes('阿喃那') && entry.text.includes('均摊')), 'Ananna damage sharing should be logged');
    cases.push('Ananna redirects incoming damage to crystals');
  }

  {
    const owner = makeFighter('牢鳄@A');
    const summon = makeFighter('阿喃那分流召唤物@A');
    const observer = makeFighter('延迟日志旁观者@B');
    const { engine, logs } = makeDeathEngine([owner, summon, observer]);
    const luckEmperor = localProject.jobs.LUCK_EMPEROR;
    assert(luckEmperor, 'LUCK_EMPEROR job should exist for Ananna deferred-log tests');
    const engineOwner = engine.fighters[0];
    const engineSummon = engine.fighters[1];
    engineOwner.job = 'LUCK_EMPEROR';
    engineOwner.jobData = { ...luckEmperor, skills: [...luckEmperor.skills] };
    engineOwner.isGacha = true;
    engineOwner.transformed = true;
    engineSummon.isSummon = true;
    engineSummon.summonerId = engineOwner.id;
    localProject.setCurrentHp(engineOwner, Math.floor(engineOwner.maxHp * 0.5));
    activateGachaSummonLifesteal(engineOwner, (type, text) => engine.log(type, text));

    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    engine.turnCount = 20;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const core = engine.fighters.find((fighter) => fighter.isOriginiumCore);
    const crystal = engine.fighters.find((fighter) => fighter.isOriginiumCrystal);
    assert(core && crystal, 'Ananna deferred-log test should have a core and crystal');

    engine.applyDamage(core, 120, 'skill', false, engineSummon, { actionName: '召唤物分流测试' });
    const lifestealCountAfterRedirect = logs.filter((entry) => entry.text.includes('吸血牌回流') && entry.text.includes(engineSummon.name)).length;
    assert(lifestealCountAfterRedirect === 1, `Ananna redirect should flush summon lifesteal immediately once, got ${lifestealCountAfterRedirect}`);
    assert((crystal.pendingDamageEvents?.length ?? 0) === 0, 'Ananna redirect must not leave deferred logs attached to a crystal');

    engine.applyDamage(crystal, 1, 'skill', true, engine.fighters[2], { actionName: '后续结晶命中' });
    engine.flushDeferredDamageEvents(crystal);
    const lifestealCountAfterLaterHit = logs.filter((entry) => entry.text.includes('吸血牌回流') && entry.text.includes(engineSummon.name)).length;
    assert(lifestealCountAfterLaterHit === 1, 'A later crystal hit must not replay stale summon lifesteal from an earlier Ananna redirect');
    cases.push('Ananna redirect flushes per-crystal deferred logs immediately');
  }

  {
    const { engine, logs } = makeDeathEngine([
      makeFighter('表情@A'),
      makeFighter('阿喃那日志旁观者B@B'),
      makeFighter('阿喃那日志旁观者C@C'),
    ]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    engine.turnCount = 20;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const attacker = engine.fighters[0];
    const core = engine.fighters.find((fighter) => fighter.isOriginiumCore);
    const crystal = engine.fighters.find((fighter) => fighter.isOriginiumCrystal);
    assert(core && crystal, 'Ananna custom-log test should have a core and crystal');
    core.untargetableUntilTurn = 0;
    crystal.untargetableUntilTurn = 0;
    attacker.atk = 2400;
    attacker.mag = 2400;
    const coreHpBefore = core.currentHp;

    engine.executeSkillAction('emote_tenth_claim', attacker, core);

    assert(core.currentHp === coreHpBefore, 'Custom skill redirected through Ananna should not damage the core body');
    assert(crystal.isDeadAnnounced, 'Lethal damage redirected through Ananna should immediately settle crystal destruction');
    assert(logs.some((entry) => entry.text.includes('十分之一索赔') && entry.text.includes('源石网络')), 'Ananna redirect should retain the custom action name before crystal death settlement');
    assert(logs.some((entry) => entry.text.includes('阿喃那本体未受伤')), 'Custom skill result should explicitly say Ananna took no damage');
    assert(!logs.some((entry) => /向 阿喃那.+实际造成/.test(entry.text)), 'Custom skill log must not claim redirected damage landed on Ananna');
    assert(logs.some((entry) => entry.text.includes('源石破拆') && entry.text.includes(attacker.name)), 'Crystal killed through Ananna should grant cleanup reward to the original attacker');
    cases.push('Ananna redirect logs and crystal rewards preserve the original attacker');
  }

  {
    const { engine } = makeDeathEngine([
      makeFighter('分流后续测试者@A'),
      makeFighter('分流后续旁观者B@B'),
      makeFighter('分流后续旁观者C@C'),
    ]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    engine.turnCount = 20;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const attacker = engine.fighters[0];
    const core = engine.fighters.find((fighter) => fighter.isOriginiumCore);
    const crystal = engine.fighters.find((fighter) => fighter.isOriginiumCrystal);
    assert(core && crystal, 'Redirected target-effect test should have a core and crystal');
    core.untargetableUntilTurn = 0;
    crystal.untargetableUntilTurn = 0;
    attacker.mag = 800;
    attacker.agl = 10000;
    attacker.status.push({ type: 'AIM', duration: 1 });
    const coreStatsBefore = { atk: core.atk, mag: core.mag, res: core.res };

    engine.executeSkillAction('exodia_seal_chains', attacker, core);

    assert(core.atk === coreStatsBefore.atk && core.mag === coreStatsBefore.mag && core.res === coreStatsBefore.res, 'Ananna redirect should block target-only after-effects from mutating the core');
    assert(!core.status.some((status) => status.type === 'STUN'), 'Ananna redirect should block target-only control from landing on the core');
    cases.push('Ananna redirect blocks target-only skill after-effects');
  }

  {
    const { engine, logs } = makeDeathEngine([
      makeFighter('分流范围测试者@A'),
      makeFighter('分流范围旁观者B@B'),
      makeFighter('分流范围旁观者C@C'),
    ]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    engine.turnCount = 20;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const attacker = engine.fighters[0];
    const bystander = engine.fighters[1];
    const core = engine.fighters.find((fighter) => fighter.isOriginiumCore);
    const crystal = engine.fighters.find((fighter) => fighter.isOriginiumCrystal);
    assert(core && crystal, 'Redirected area-effect test should have a core and crystal');
    core.untargetableUntilTurn = 0;
    crystal.untargetableUntilTurn = 0;
    attacker.mag = 500;
    attacker.agl = 10000;
    attacker.status.push({ type: 'AIM', duration: 1 });
    bystander.maxHp = 10000;
    localProject.setCurrentHp(bystander, 10000);
    const hpBefore = bystander.currentHp;

    engine.executeSkillAction('apocalyptic_flood', attacker, core);

    assert(bystander.currentHp < hpBefore, 'Ananna redirect should not erase an area skill\'s independent follow-up damage');
    assert(logs.some((entry) => entry.text.includes('狂暴洪水吞噬了') && entry.text.includes(bystander.name)), 'Redirected area follow-up should retain a concrete bystander damage log');
    cases.push('Ananna redirect preserves independent area follow-ups');
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
    const secondHit = engine.applyDamage(puruisaishi, 1000, 'skill', true, engine.fighters[0], { actionName: '护盾地板复测' });
    assert(secondHit === 0, `Puruisaishi shield floor should handle later hits at 1 shield, got ${secondHit} damage`);
    assert(puruisaishi.currentHp === hpBefore, 'Puruisaishi should not lose HP from later hits while crystals sustain the shield floor');
    assert(logs.some((entry) => entry.text.includes('维系最后 1 点护盾') && entry.text.includes('导走')), 'Shield-floor log should explain where overflow damage went');

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

  {
    const { engine } = makeDeathEngine([
      makeFighter('柚子@A'),
      makeFighter('感染转阶段B@B'),
      makeFighter('感染转阶段C@C'),
    ]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    const yuzu = engine.fighters[0];
    const puruisaishi = engine.fighters.find((fighter) => fighter.isPuruisaishi);
    assert(yuzu.isYuzu && puruisaishi, 'Infection transition test should have Yuzu and Puruisaishi');

    addOriginiumInfection(engine.createPuruisaishiRuntime(), yuzu, 10, '转阶段属性测试');
    localProject.setCurrentHp(yuzu, Math.floor(yuzu.maxHp * 0.6));
    const advanced = tryAdvanceYuzuPhaseByHp(engine.createCharacterHookRuntime(), yuzu);
    assert(advanced && yuzu.yuzuPhase === 2, 'Infected Yuzu should still advance to phase 2');
    assert(yuzu.maxHp >= 2805, `10-stack infected Yuzu should retain phase-2 HP scale, got ${yuzu.maxHp}`);
    assert(yuzu.atk >= 192, `10-stack infected Yuzu should retain phase-2 attack scale, got ${yuzu.atk}`);
    const infectedPhaseMaxHp = yuzu.maxHp;
    const infectedPhaseAtk = yuzu.atk;

    engine.turnCount = 1;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    assert(yuzu.maxHp === infectedPhaseMaxHp && yuzu.atk === infectedPhaseAtk, `Originium tick should preserve transformed Yuzu stats, got ${yuzu.maxHp} HP / ${yuzu.atk} ATK`);

    clearAllOriginiumAndRetreat(engine.createPuruisaishiRuntime(), puruisaishi);
    assert(yuzu.maxHp >= 3000 && yuzu.atk >= 175, `Clearing infection should restore phase-2 base stats, got ${yuzu.maxHp} HP / ${yuzu.atk} ATK`);
    assert(Math.abs(infectedPhaseMaxHp - Math.floor(yuzu.maxHp * 0.935)) <= 1, 'Cleared phase-2 HP should be the uninfected source of the 10-stack value');
    assert(Math.abs(infectedPhaseAtk - Math.floor(yuzu.atk * 1.1)) <= 1, 'Cleared phase-2 attack should be the uninfected source of the 10-stack value');
    cases.push('Originium stat shape preserves transformations and clears to current phase stats');
  }

  {
    const { engine, logs } = makeDeathEngine([
      makeFighter('丝瓜uli@A'),
      makeFighter('结晶奖励旁观者B@B'),
      makeFighter('结晶奖励旁观者C@C'),
    ]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    engine.turnCount = 20;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const attacker = engine.fighters[0];
    const crystal = engine.fighters.find((fighter) => fighter.isOriginiumCrystal);
    const valoJob = localProject.jobs.VALO_JUNIOR;
    assert(crystal && valoJob, 'Crystal reward test should have a crystal and Valorant Junior job');
    attacker.job = 'VALO_JUNIOR';
    attacker.jobData = { ...valoJob, skills: [...valoJob.skills] };
    attacker.economy = 0;
    attacker.ultPoints = 0;
    attacker.crosshairFocus = 0;
    addOriginiumInfection(engine.createPuruisaishiRuntime(), attacker, 5, '结晶奖励测试');
    localProject.setCurrentHp(attacker, Math.floor(attacker.maxHp * 0.5));
    const hpBefore = attacker.currentHp;

    localProject.setCurrentHp(crystal, 0);
    engine.handlePrimaryTargetDefeat(attacker, crystal);

    assert((attacker.originiumInfectionStacks ?? 0) === 3, `Destroying a crystal should clear 2 infection stacks, got ${attacker.originiumInfectionStacks ?? 0}`);
    assert(attacker.currentHp > hpBefore, 'Destroying a crystal should heal its player beneficiary');
    assert(attacker.stats.kills === 0, `Originium NPC death should not count as a player kill, got ${attacker.stats.kills}`);
    assert((attacker.economy ?? 0) === 0 && (attacker.ultPoints ?? 0) === 0 && (attacker.crosshairFocus ?? 0) === 0, 'Originium NPC death should not grant Valorant kill economy, ult charge, or focus');
    assert(logs.some((entry) => entry.text.includes('源石破拆') && entry.text.includes('矿石病 -2 层')), 'Crystal break reward should explain infection relief');
    assert(!logs.some((entry) => entry.text.includes('拿到击杀')), 'Originium NPC death should not emit Valorant player-kill text');
    cases.push('Crystal destruction rewards cleanup without player-kill farming');
  }

  {
    const { engine, logs } = makeDeathEngine([
      makeFighter('集火权重A@A'),
      makeFighter('集火权重B@B'),
      makeFighter('集火权重C@C'),
    ]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    engine.turnCount = 20;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    engine.turnCount = 50;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const puruisaishi = engine.fighters.find((fighter) => fighter.isPuruisaishi);
    const core = engine.fighters.find((fighter) => fighter.isOriginiumCore);
    const firstCrystal = engine.fighters.find((fighter) => fighter.isOriginiumCrystal);
    assert(puruisaishi && core && firstCrystal, 'Target-weight test should have all originium NPC types');

    for (let index = 2; index <= 11; index += 1) {
      const crystal = localProject.cloneFighters([firstCrystal])[0];
      crystal.id = `target-weight-crystal-${index}`;
      crystal.name = `源石结晶#${index}`;
      crystal.displayName = crystal.name;
      crystal.untargetableUntilTurn = 0;
      engine.fighters.push(crystal);
    }
    firstCrystal.untargetableUntilTurn = 0;
    core.untargetableUntilTurn = 0;
    const targetingRuntime = engine.createActionResolutionRuntime();
    assert(getTargetSelectionWeight(targetingRuntime, firstCrystal) === 2.8, 'More than 10 crystals should make each crystal a primary cleanup target');
    assert(getTargetSelectionWeight(targetingRuntime, core) === 1.2, 'Ananna should remain a secondary target while crystals overflow');
    assert(getTargetSelectionWeight(targetingRuntime, puruisaishi) === 0.35, 'Puruisaishi should be deprioritized while crystals sustain her shield');
    assert(getTargetSelectionWeight(targetingRuntime, engine.fighters[1]) === 1, 'Players should remain valid ordinary targets during the event');

    engine.turnCount = 51;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const overflowLogs = logs.filter((entry) => entry.text.includes('【源石泛滥】'));
    const dotLogs = logs.filter((entry) => entry.text.includes('【矿石病侵蚀】'));
    assert(overflowLogs.length === 1 && overflowLogs[0]?.text.includes('本轮感染：'), 'Crystal overflow should aggregate all stack gains into one readable log');
    assert(dotLogs.length === 1, `Originium damage should aggregate infected targets into one log per turn, got ${dotLogs.length}`);
    assert(!logs.some((entry) => entry.text.includes('因源石结晶泛滥感染加深')), 'Crystal overflow should not emit one repetitive stack log per target');

    engine.fighters.filter((fighter) => fighter.isOriginiumCrystal).forEach((crystal) => {
      localProject.setCurrentHp(crystal, 0);
      crystal.isDead = true;
      crystal.isDeadAnnounced = true;
    });
    assert(getTargetSelectionWeight(targetingRuntime, core) === 2.2, 'Ananna should draw focus after all crystals are cleared');
    assert(getTargetSelectionWeight(targetingRuntime, puruisaishi) === 2.4, 'Puruisaishi should draw focus after all crystals are cleared');
    cases.push('Puruisaishi phase-2 focus shifts dynamically with crystal pressure');
  }

  return cases;
}
