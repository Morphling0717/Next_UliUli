import {
  addOriginiumInfection,
  clearAllOriginiumAndRetreat,
  getOriginiumInfectionStacks,
  getPuruisaishiBarrierTotal,
  processPuruisaishiRoundEnd,
  PURUISAISHI_BARRIER_IDENTITY,
  PURUISAISHI_BARRIER_SOURCE,
  spawnPuruisaishiEvent,
} from '../../../lib/namearena/puruisaishiMechanics';
import { consumeCompletedLargeRound, noteLargeRoundActor } from '../../../lib/namearena/battleState';
import { getTargetSelectionWeight } from '../../../lib/namearena/targeting';
import { tryAdvanceYuzuPhaseByHp } from '../../../lib/namearena/yuzuMechanics';
import { activateGachaSummonLifesteal } from '../../../lib/namearena/gachaMechanics';
import type { DamageApplicationOptions } from '../../../lib/namearena/types';
import { grantBarrier, removeEffects } from '../../../lib/namearena/statusSystem';
import {
  applyTestStatus,
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

function setPuruisaishiBarrier(fighter: ReturnType<typeof makeFighter>, value: number): void {
  grantBarrier(fighter, value, {
    identityId: PURUISAISHI_BARRIER_IDENTITY,
    sourceId: PURUISAISHI_BARRIER_SOURCE,
    displayName: '普瑞赛斯护盾',
    tickMode: 'permanent',
    dispelTier: 'none',
    stackMode: 'overwrite',
    attribution: {
      effectSourceId: PURUISAISHI_BARRIER_SOURCE,
      applierId: fighter.id,
      applierName: fighter.name,
    },
  });
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
    applyTestStatus(caster, { identityId: 'AIM', charges: 1 });
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
      makeFighter('兔卷卷@A'),
      makeFighter('源石死亡文案旁观者@B'),
      makeFighter('源石死亡文案旁观者@C'),
    ]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    engine.turnCount = 20;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    engine.turnCount = 50;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const rabbit = engine.fighters[0];
    const crystal = engine.fighters.find((fighter) => fighter.isOriginiumCrystal);
    const core = engine.fighters.find((fighter) => fighter.isOriginiumCore);
    assert(crystal, 'Megaphone NPC wording test requires an Originium Crystal');
    assert(core, 'Megaphone NPC wording test requires Ananna before isolating a direct crystal hit');
    localProject.setCurrentHp(core, 0);
    core.isDead = true;
    core.isDeadAnnounced = true;
    rabbit.mag = 1000;
    crystal.maxHp = 1;
    localProject.setCurrentHp(crystal, 1);

    engine.executeSkillAction('v_rabbit_megaphone', rabbit, crystal);

    const crystalDefeatLog = logs.find((entry) => entry.type === 'death' && entry.text.includes(crystal.name));
    assert(crystalDefeatLog?.text.includes('源石结构') && crystalDefeatLog.text.includes('震碎'), 'Originium Crystal megaphone defeat should describe a shattered crystal structure');
    assert(!crystalDefeatLog?.text.includes('大脑宕机'), 'Originium Crystal megaphone defeat must not use a biological death description');
    cases.push('Rabbit Megaphone uses non-biological defeat wording for Originium NPCs');
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
    const { engine, logs } = makeDeathEngine([
      makeFighter('鸮@A'),
      makeFighter('源石倍率旁观者B@B'),
      makeFighter('源石倍率旁观者C@C'),
    ]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    engine.turnCount = 20;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const owl = engine.fighters[0];
    const core = engine.fighters.find((fighter) => fighter.isOriginiumCore);
    assert(owl.isOwl && core, 'Owl originium multiplier test requires Owl and Ananna');
    const damageOptions: DamageApplicationOptions = { actionName: '鸮源石倍率测试' };

    engine.applyDamage(core, 100, 'skill', true, owl, damageOptions);

    assert(damageOptions.redirectedOriginiumDamage === 135, `Owl's 1.35 outgoing multiplier must apply once through Ananna, got ${damageOptions.redirectedOriginiumDamage}`);
    assert(logs.some((entry) => entry.text.includes('【胜兵】') && entry.text.includes('100') && entry.text.includes('135')), 'Owl outgoing multiplier should be visible before the redirected damage result');
    cases.push('Owl outgoing multiplier applies once through Ananna network');
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
    applyTestStatus(attacker, { identityId: 'AIM', charges: 1 });
    const coreStatsBefore = { atk: core.atk, mag: core.mag, res: core.res };

    engine.executeSkillAction('exodia_seal_chains', attacker, core);

    assert(core.atk === coreStatsBefore.atk && core.mag === coreStatsBefore.mag && core.res === coreStatsBefore.res, 'Ananna redirect should block target-only after-effects from mutating the core');
    assert(!core.statuses.some((status) => status.identityId === 'STUN'), 'Ananna redirect should block target-only control from landing on the core');
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
    applyTestStatus(attacker, { identityId: 'AIM', charges: 1 });
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

    assert(getOriginiumInfectionStacks(attacker) === 3, `Attacking a crystal should infect the attacker for 3 stacks in forced roll, got ${getOriginiumInfectionStacks(attacker)}`);
    assert(attacker.statuses.some((status) => status.identityId === 'ORIGINIUM_DISEASE'), 'Originium disease should use a visible status entry');
    cases.push('Attacking originium crystal can infect attacker');
  }

  {
    const { engine, logs } = makeDeathEngine([
      makeFighter('屑@A'),
      makeFighter('结晶转移攻击者@B'),
      makeFighter('结晶转移旁观者@C'),
    ]);
    const joker = engine.fighters[0];
    const attacker = engine.fighters[1];
    const godOfTrolls = localProject.jobs.GOD_OF_TROLLS;
    assert(godOfTrolls, 'Originium transfer ordering test requires GOD_OF_TROLLS');
    joker.job = 'GOD_OF_TROLLS';
    joker.jobData = { ...godOfTrolls, skills: [...godOfTrolls.skills] };
    joker.transformed = true;
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    engine.turnCount = 20;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const crystal = engine.fighters.find((fighter) => fighter.isOriginiumCrystal);
    assert(crystal, 'Originium transfer ordering test requires a crystal');
    crystal.untargetableUntilTurn = 0;
    const candidates = engine.getSelectableTargets(joker);
    const crystalIndex = candidates.findIndex((fighter) => fighter.id === crystal.id);
    assert(crystalIndex >= 0, 'Originium crystal should be selectable as Joker transfer victim');
    const crystalRoll = (crystalIndex + 0.25) / candidates.length;

    withRandomSequence([0, crystalRoll, 0], () => {
      engine.applyDamage(joker, 100, 'skill', true, attacker, { actionName: '结晶转移时序测试' });
    });

    const outcomeIndex = logs.findIndex((entry) => entry.text.includes(`转移伤害落在 ${crystal.name}`) && entry.text.includes('实际承受'));
    const infectionIndex = logs.findIndex((entry) => entry.text.includes('【矿石病】') && entry.text.includes('被随机恶作剧转移'));
    assert(outcomeIndex >= 0, 'Joker transfer should emit a concrete crystal damage result');
    assert(infectionIndex > outcomeIndex, 'Originium infection aftermath must follow the concrete Joker transfer result');
    cases.push('Joker crystal transfer logs damage before infection aftermath');
  }

  {
    const infected = makeFighter('绝对驱散矿石病目标@A');
    infected.maxHp = 1000;
    infected.atk = 100;
    infected.def = 100;
    infected.res = 100;
    localProject.setCurrentHp(infected, 1000);
    const { engine } = makeDeathEngine([infected, makeFighter('绝对驱散旁观者@B')]);
    const target = engine.fighters[0];
    const baseStats = { maxHp: target.maxHp, atk: target.atk, def: target.def, res: target.res };

    addOriginiumInfection(engine.createPuruisaishiRuntime(), target, 12, '绝对驱散回归测试');
    assert(getOriginiumInfectionStacks(target) === 12, 'Originium infection should establish its unified stack value before dispel');
    assert(target.maxHp < baseStats.maxHp && target.atk > baseStats.atk && target.def < baseStats.def && target.res > baseStats.res, 'Originium infection should project every declared stat shape from its canonical potency');
    engine.dispelStatusEffects(target, {
      strength: 'absolute',
      direction: 'negative',
      includeIndependent: true,
      identityIds: ['ORIGINIUM_DISEASE'],
    });

    assert(getOriginiumInfectionStacks(target) === 0, 'Absolute dispel must clear the canonical originium stack value');
    assert(!target.statuses.some((status) => status.identityId === 'ORIGINIUM_DISEASE'), 'Absolute dispel must remove the visible originium disease status');
    assert(target.maxHp === baseStats.maxHp && target.atk === baseStats.atk && target.def === baseStats.def && target.res === baseStats.res, 'Absolute dispel must restore all stats changed by originium disease');
    cases.push('absolute dispel clears originium disease status, stacks, and stat shape together');
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
    const waiting = makeFighter('增殖等待反击者@A');
    const acting = makeFighter('增殖普通行动者@B');
    applyTestStatus(waiting, { identityId: 'WAIT_COUNTER', charges: 3 });
    const { engine } = makeDeathEngine([waiting, acting]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    engine.turnCount = 20;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const crystal = engine.fighters.find((fighter) => fighter.isOriginiumCrystal);
    assert(crystal, 'Formal-round growth test requires one crystal');
    crystal.originiumSpawnLargeRound = 0;

    noteLargeRoundActor(engine.battleState, engine.fighters, engine.fighters[1]);
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    assert(engine.fighters.filter((fighter) => fighter.isOriginiumCrystal).length === 1, 'Legacy fallback must not grow a crystal while the formal round still waits for a participant');

    removeEffects(engine.fighters[0], { identityIds: ['WAIT_COUNTER'], reason: 'scripted' });
    noteLargeRoundActor(engine.battleState, engine.fighters, engine.fighters[0]);
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    assert(engine.fighters.filter((fighter) => fighter.isOriginiumCrystal).length === 2, 'A completed formal round must grow each eligible crystal at most once');
    cases.push('Formal large round prevents fallback and duplicate crystal growth');
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
      makeFighter('鸮@A'),
      makeFighter('矿石病顺序旁观者B@B'),
      makeFighter('矿石病顺序旁观者C@C'),
    ]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    const owl = engine.fighters[0];
    assert(owl.isOwl, 'Originium mitigation ordering test requires Owl');
    localProject.setCurrentHp(owl, Math.max(1, Math.floor(owl.maxHp * 0.4)));
    engine.handleTransformations(owl);
    assert(owl.owlState?.phase === 2, 'Originium mitigation ordering test requires phase-two Owl mitigation');
    addOriginiumInfection(engine.createPuruisaishiRuntime(), owl, 4, '顺序测试');

    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());

    const mitigationIndex = logs.findIndex((entry) => entry.text.includes('【不怕酸】') && entry.text.includes('削减'));
    const settlementIndex = logs.findIndex((entry) => entry.text.includes('【矿石病侵蚀】') && entry.text.includes(owl.name));
    assert(mitigationIndex >= 0, 'Originium damage should emit Owl mitigation');
    assert(settlementIndex > mitigationIndex, 'Originium mitigation must be explained before the aggregate HP settlement');
    cases.push('Originium damage logs mitigation before aggregate settlement');
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
    assert(getPuruisaishiBarrierTotal(puruisaishi) > 0, 'Puruisaishi phase 2 should grant shield');

    const hpBefore = puruisaishi.currentHp;
    engine.applyDamage(puruisaishi, getPuruisaishiBarrierTotal(puruisaishi) + 1000, 'skill', true, engine.fighters[0], { actionName: '破盾测试' });
    assert(puruisaishi.currentHp === hpBefore, 'Puruisaishi shield floor should prevent overflow damage while crystals exist');
    assert(getPuruisaishiBarrierTotal(puruisaishi) === 1, `Puruisaishi shield should stay at 1 while crystals exist, got ${getPuruisaishiBarrierTotal(puruisaishi)}`);
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
    assert(getOriginiumInfectionStacks(engine.fighters[1]) === 0, 'Puruisaishi retreat should clear originium disease stacks');
    assert(!engine.fighters[1].statuses.some((status) => status.identityId === 'ORIGINIUM_DISEASE'), 'Puruisaishi retreat should remove disease status');
    assert(logs.some((entry) => entry.text.includes('普瑞赛斯退场') && entry.text.includes('清除全场矿石病')), 'Puruisaishi retreat should be logged');
    cases.push('Puruisaishi phase-2 shield floors at 1 and retreat clears disease');
  }

  {
    const { engine, logs } = makeDeathEngine([
      makeFighter('普瑞退场日志攻击者@A'),
      makeFighter('普瑞退场日志旁观者@B'),
      makeFighter('普瑞退场日志旁观者@C'),
    ]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    engine.turnCount = 50;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const puruisaishi = engine.fighters.find((fighter) => fighter.isPuruisaishi);
    assert(puruisaishi, 'Puruisaishi retreat ordering test requires Puruisaishi');
    engine.fighters.filter((fighter) => fighter.isOriginiumCrystal).forEach((fighter) => {
      localProject.setCurrentHp(fighter, 0);
      fighter.isDead = true;
      fighter.isDeadAnnounced = true;
    });
    setPuruisaishiBarrier(puruisaishi, 1);
    engine.fighters[0].agl = 10000;
    applyTestStatus(engine.fighters[0], { identityId: 'AIM', charges: 1 });

    withRandomSequence([0.99, 0.99], () => {
      engine.executeSkillAction('serious_punch', engine.fighters[0], puruisaishi);
    });

    const attackIndex = logs.findIndex((entry) => entry.text.includes('认真一拳') && entry.text.includes('预计造成'));
    const shieldIndex = logs.findIndex((entry) => entry.text.includes('【普瑞赛斯护盾】'));
    const settlementIndex = logs.findIndex((entry) => entry.text.includes('实际结算') && entry.text.includes('完全抵消'));
    const retreatIndex = logs.findIndex((entry) => entry.text.includes('【普瑞赛斯退场】'));
    assert(attackIndex >= 0 && attackIndex < shieldIndex, 'Puruisaishi shield log must follow the incoming attack preview');
    assert(shieldIndex < settlementIndex && settlementIndex < retreatIndex, 'Puruisaishi mitigation, actual settlement, and retreat must stay in causal order');
    cases.push('Puruisaishi retreat logs follow attack and settlement cause');
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
    const totalStacks = engine.fighters.reduce((sum, fighter) => sum + getOriginiumInfectionStacks(fighter), 0);
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
    assert(engine.fighters.every((fighter) => getOriginiumInfectionStacks(fighter) === 0), 'Puruisaishi phase 2 should not add stacks before 20 turns have elapsed');

    engine.turnCount = 70;
    withRandomSequence([0, 0], () => {
      processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    });

    const totalStacks = engine.fighters.reduce((sum, fighter) => sum + getOriginiumInfectionStacks(fighter), 0);
    assert(totalStacks === 4, `Puruisaishi should add exactly one phase-2 target package after 20 turns, got total stacks ${totalStacks}`);
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const totalStacksAfterDuplicateCall = engine.fighters.reduce((sum, fighter) => sum + getOriginiumInfectionStacks(fighter), 0);
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

    assert(getOriginiumInfectionStacks(attacker) === 3, `Destroying a crystal should clear 2 infection stacks, got ${getOriginiumInfectionStacks(attacker)}`);
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
    assert(getTargetSelectionWeight(targetingRuntime, firstCrystal) === 3.05, 'More than 10 crystals should make each crystal a primary cleanup target');
    assert(getTargetSelectionWeight(targetingRuntime, core) === 1.32, 'Ananna should remain a secondary cleanup target while crystals overflow');
    assert(getTargetSelectionWeight(targetingRuntime, puruisaishi) === 1.35, 'Puruisaishi should remain a useful target while her shield is still above its crystal floor');
    assert(getTargetSelectionWeight(targetingRuntime, engine.fighters[1]) === 1, 'Players should remain valid ordinary targets during the event');
    const activeShieldTarget = withRandomSequence([0, 0], () =>
      engine.resolveTarget(engine.fighters[0], null, engine.getSelectableTargets(engine.fighters[0])),
    );
    assert(activeShieldTarget?.target.isPuruisaishi, 'A phase-two response may keep damaging Puruisaishi before her shield reaches its crystal floor');
    setPuruisaishiBarrier(puruisaishi, 1);
    assert(getTargetSelectionWeight(targetingRuntime, puruisaishi) === 0.05, 'Players should stop wasting attacks on Puruisaishi once crystals lock her shield at 1');
    const focusedTarget = withRandomSequence([0, 0], () =>
      engine.resolveTarget(engine.fighters[0], null, engine.getSelectableTargets(engine.fighters[0])),
    );
    assert(
      !!focusedTarget && (focusedTarget.target.isOriginiumCrystal || focusedTarget.target.isOriginiumCore),
      'A phase-two event response should focus a crystal or Ananna while the shield network is active',
    );

    engine.turnCount = 51;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const infectionAfterFirstOverflow = engine.fighters.reduce((sum, fighter) => sum + getOriginiumInfectionStacks(fighter), 0);
    engine.turnCount = 52;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const infectionAfterSecondSmallTurn = engine.fighters.reduce((sum, fighter) => sum + getOriginiumInfectionStacks(fighter), 0);
    const overflowLogs = logs.filter((entry) => entry.text.includes('【源石泛滥】'));
    const dotLogs = logs.filter((entry) => entry.text.includes('【矿石病侵蚀】'));
    assert(overflowLogs.length === 1 && overflowLogs[0]?.text.includes('本轮感染：'), 'Crystal overflow should aggregate all stack gains into one readable log');
    assert(infectionAfterSecondSmallTurn === infectionAfterFirstOverflow, 'Crystal overflow must not add infection again on another small action in the same large round');
    assert(dotLogs.length === 2, `Originium damage should aggregate infected targets into one log on each of the two processed turns, got ${dotLogs.length}`);
    assert(dotLogs.every((entry) => entry.text.includes('本次全局行动结束结算') && entry.text.includes('来源：普瑞赛斯事件')), 'Originium settlement logs should identify their global-action clock and source');
    assert(dotLogs.every((entry) => entry.text.includes('实际损失') || entry.text.includes('生命未减少')), 'Originium settlement logs should state the actual HP outcome');
    assert(!logs.some((entry) => /因\s*源石结晶泛滥\s*感染加深/.test(entry.text)), 'Crystal overflow should not emit one repetitive stack log per target');

    engine.fighters.filter((fighter) => fighter.isOriginiumCrystal).forEach((crystal) => {
      localProject.setCurrentHp(crystal, 0);
      crystal.isDead = true;
      crystal.isDeadAnnounced = true;
    });
    assert(getTargetSelectionWeight(targetingRuntime, core) === 2.32, 'Ananna should draw focus after all crystals are cleared');
    assert(getTargetSelectionWeight(targetingRuntime, puruisaishi) === 2.55, 'Puruisaishi should draw focus after all crystals are cleared');
    const exposedTarget = withRandomSequence([0, 0], () =>
      engine.resolveTarget(engine.fighters[0], null, engine.getSelectableTargets(engine.fighters[0])),
    );
    assert(
      !!exposedTarget && (exposedTarget.target.isPuruisaishi || exposedTarget.target.isOriginiumCore),
      'A phase-two event response should press Puruisaishi or disable Ananna after crystals are cleared',
    );
    const forcedPlayer = engine.fighters[1];
    const forcedResult = withRandomSequence([0], () =>
      engine.resolveTarget(engine.fighters[0], forcedPlayer, engine.getSelectableTargets(engine.fighters[0])),
    );
    assert(forcedResult?.target.id === forcedPlayer.id, 'Explicit forced targets must still override the shared event response');
    cases.push('Puruisaishi phase-2 focus shifts dynamically with crystal pressure');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const ra = makeFighter('翼神龙侵蚀测试体@A');
    const enemy = makeFighter('神不死鸟侵蚀旁观者@B');
    const { engine, logs } = makeDeathEngine([gacha, ra, enemy]);
    const engineGacha = engine.fighters[0];
    const engineRa = engine.fighters[1];
    engineRa.isSummon = true;
    engineRa.isAdvancedSummon = true;
    engineRa.summonerId = engineGacha.id;
    engineRa.summonBaseName = '翼神龙';
    engineRa.maxHp = 1000;
    localProject.setCurrentHp(engineRa, 20);
    applyTestStatus(engineRa, { identityId: 'RA_PHOENIX', remainingTurns: 3 });
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '矿石病与神不死鸟顺序测试');
    addOriginiumInfection(engine.createPuruisaishiRuntime(), engineRa, 79, '顺序测试');

    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());

    const infectionIndex = logs.findIndex((entry) => entry.text.includes('【矿石病侵蚀】') && entry.text.includes(engineRa.name));
    const phoenixIndex = logs.findIndex((entry) => entry.text.includes('【神不死鸟】') && entry.text.includes('致死瞬间'));
    assert(infectionIndex >= 0 && phoenixIndex > infectionIndex, 'Originium lethal settlement must be logged before Ra Phoenix revival and retaliation');
    cases.push('Originium lethal settlement precedes Ra Phoenix reaction');
  }

  {
    const ting = makeFighter('小汀@A');
    const observer = makeFighter('矿石病锁血旁观者@B');
    const grudgeJob = localProject.jobs.GRUDGE_SUICIDER;
    assert(grudgeJob, 'Originium lockblood test requires the transformed Ting job');
    ting.job = 'GRUDGE_SUICIDER';
    ting.jobData = JSON.parse(JSON.stringify(grudgeJob)) as typeof grudgeJob;
    ting.transformed = true;
    ting.hasTriggeredTingDefiance = true;
    localProject.setCurrentHp(ting, 1);
    applyTestStatus(ting, { identityId: 'TING_DEFIANCE', remainingTurns: 3 });
    const { engine, logs } = makeDeathEngine([ting, observer]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '矿石病锁血净伤害测试');
    addOriginiumInfection(engine.createPuruisaishiRuntime(), engine.fighters[0], 4, '锁血测试');

    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());

    const settlementIndex = logs.findIndex((entry) => entry.text.includes('【矿石病侵蚀】') && entry.text.includes(engine.fighters[0].name));
    const defianceIndex = logs.findIndex((entry) => entry.text.includes('【不甘倒下】') && entry.text.includes('压回 1 点生命'));
    assert(engine.fighters[0].currentHp === 1, 'Ting defiance should preserve 1 HP against originium damage');
    assert(settlementIndex >= 0 && logs[settlementIndex]?.text.includes('生命未减少'), 'Originium settlement should report zero net HP loss while Ting is locked at 1 HP');
    assert(!logs[settlementIndex]?.text.includes('实际损失 1 点'), 'Originium settlement must not expose transient zero-HP damage as actual loss');
    assert(defianceIndex > settlementIndex, 'Originium settlement should precede its deferred Ting death-save consequence');
    cases.push('Originium settlement reports Ting defiance net HP loss');
  }

  {
    const { engine, logs } = makeDeathEngine([
      makeFighter('NPC击飞来源@A'),
      makeFighter('NPC击飞旁观者@B'),
    ]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    engine.turnCount = 20;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const crystal = engine.fighters.find((fighter) => fighter.isOriginiumCrystal);
    assert(crystal, 'Static-NPC status clock test requires an originium crystal');
    const hpBefore = crystal.currentHp;

    assert(engine.applyStatus(crystal, { identityId: 'AIRBORNE', remainingTurns: 1, attribution: { applierId: engine.fighters[0].id, applierName: engine.fighters[0].name } }), 'Airborne should apply to a static event NPC');
    const airborne = crystal.statuses.find((status) => status.identityId === 'AIRBORNE');
    assert(airborne?.tickMode === 'global_action' && airborne.expiresOn === 'global_action_end', 'A self-opportunity status on a non-acting NPC must use the global-action fallback clock');
    engine.advanceGlobalTimedStatuses();
    assert(crystal.statuses.some((status) => status.identityId === 'AIRBORNE'), 'A newly applied NPC airborne status must not expire in the same global action');
    engine.turnCount = 21;
    engine.advanceGlobalTimedStatuses();

    assert(!crystal.statuses.some((status) => status.identityId === 'AIRBORNE'), 'Static-NPC airborne must not remain stuck forever');
    assert(crystal.currentHp < hpBefore, 'Static-NPC airborne should settle its landing damage once on the next global action');
    assert(logs.some((entry) => entry.text.includes('【击飞坠地】') && entry.text.includes(crystal.name)), 'Static-NPC airborne should keep an explicit landing result');
    cases.push('Non-acting NPC controls use a global-action fallback and airborne lands once');
  }

  {
    const { engine, logs } = makeDeathEngine([
      makeFighter('护盾下限攻击者@A'),
      makeFighter('护盾下限旁观者@B'),
    ]);
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    engine.turnCount = 20;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    engine.turnCount = 50;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());
    const puruisaishi = engine.fighters.find((fighter) => fighter.isPuruisaishi);
    assert(puruisaishi && engine.fighters.some((fighter) => fighter.isOriginiumCrystal && engine.isActiveCombatant(fighter)), 'Shield-floor test requires phase-2 Puruisaishi and an active crystal');
    setPuruisaishiBarrier(puruisaishi, 1);

    engine.applyDamage(puruisaishi, 300, 'skill', true, engine.fighters[0], { actionName: '护盾下限测试' });

    assert(getPuruisaishiBarrierTotal(puruisaishi) === 1, 'Active crystals should still maintain Puruisaishi shield at one');
    assert(logs.some((entry) => entry.text.includes('维系在最后 1 点') && entry.text.includes('导走全部 300 点冲击')), 'Shield-floor log should explain where the entire hit went');
    assert(!logs.some((entry) => entry.text.includes('护盾吸收 0 点伤害')), 'Shield-floor log must never claim that zero shield absorption was the result');
    cases.push('Puruisaishi shield floor reports crystal diversion without zero-absorb text');
  }

  return cases;
}
