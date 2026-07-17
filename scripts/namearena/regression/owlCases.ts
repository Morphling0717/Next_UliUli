import type { DamageApplicationOptions, Fighter, SkillDefinition } from '../../../lib/namearena/types';
import {
  applyOwlRiverMark,
  consumeOwlFoodForYuzu,
  enterOwlPhaseThree,
  getOwlIncomingMultiplier,
  processOwlGlobalTick,
  spawnOwlCrickets,
  spawnOwlFurrySquad,
  spawnOwlMeal,
} from '../../../lib/namearena/owlMechanics';
import { consumeOwlEvadeOpening, missesSkill } from '../../../lib/namearena/actionResolution/guards';
import {
  assert,
  localProject,
  makeFighter,
  withRandomSequence,
} from '../shared/harness';
import { makeDeathEngine } from './deathAccountingCases';

function enterPhaseTwo(engine: ReturnType<typeof makeDeathEngine>['engine'], owl: Fighter): void {
  localProject.setCurrentHp(owl, Math.max(1, Math.floor(owl.maxHp * 0.4)));
  engine.handleTransformations(owl);
  assert(owl.owlState?.phase === 2, `Owl should enter phase 2, got ${owl.owlState?.phase}`);
  assert(owl.job === 'OWL_BOILED_HERO', `Owl phase 2 job should be OWL_BOILED_HERO, got ${owl.job}`);
}

export function runOwlCases(): string[] {
  const cases: string[] = [];

  {
    const owl = makeFighter('鸮@A');
    const enemy = makeFighter('鸮转阶段靶子@B');
    enemy.maxHp = 10000;
    localProject.setCurrentHp(enemy, 10000);
    const { engine, logs } = makeDeathEngine([owl, enemy]);
    const engineOwl = engine.fighters[0];
    const attacker = engine.fighters[1];
    const originalMaxHp = engineOwl.maxHp;
    localProject.setCurrentHp(engineOwl, 2);
    engine.applyDamage(engineOwl, 99999, 'skill', true, attacker, { actionName: '锁血测试' });

    assert(engineOwl.currentHp > 1, 'Owl phase lock should transform and rebuild HP after preserving 1 HP');
    assert(engineOwl.maxHp > originalMaxHp, 'Owl phase 2 should receive transformed stats');
    assert(engineOwl.owlState?.phase === 2, 'Owl lethal phase-1 hit should enter phase 2');
    assert(logs.some((entry) => entry.text.includes('这雷把我吓死了')), 'Owl phase 2 should retain its transformation quote');
    cases.push('Owl phase-1 lethal hit locks at one HP and transforms');
  }

  {
    const owl = makeFighter('鸮@A');
    const victim = makeFighter('二阶段属性测试靶@B');
    victim.maxHp = 50000;
    localProject.setCurrentHp(victim, 50000);
    const { engine } = makeDeathEngine([owl, victim]);
    const engineOwl = engine.fighters[0];
    enterPhaseTwo(engine, engineOwl);
    const phaseTwoBaseAtk = engineOwl.timedStatBase?.atk ?? engineOwl.atk;
    const phaseTwoBaseDef = engineOwl.timedStatBase?.def ?? engineOwl.def;

    engine.markDefeated(engine.fighters[1], { killer: engineOwl, message: '二阶段击杀测试' });
    assert(engineOwl.owlState?.warForm === 'pride', 'A phase-2 kill should move Owl from Victory into Pride');
    assert(engineOwl.atk >= phaseTwoBaseAtk, `Pride should retain at least phase-2 base ATK ${phaseTwoBaseAtk}, got ${engineOwl.atk}`);
    assert(engineOwl.def >= Math.max(1, Math.floor(phaseTwoBaseDef * 0.55)), 'Pride should reduce the phase-2 DEF layer instead of restoring phase-1 stats');
    cases.push('Owl phase-2 stats survive Victory-to-Pride modifier changes');
  }

  {
    const owl = makeFighter('鸮@A');
    const yuzu = makeFighter('柚子@B');
    const { engine, logs } = makeDeathEngine([owl, yuzu]);
    const engineOwl = engine.fighters[0];
    const engineYuzu = engine.fighters[1];
    const meal = spawnOwlMeal(engine.createOwlRuntime(), engineOwl);

    engine.turnCount = 4;
    processOwlGlobalTick(engine.createOwlRuntime());
    assert(meal.owlSummonState?.kind === 'meal', 'Owl meal should not transform before five global turns');
    engine.turnCount = 5;
    processOwlGlobalTick(engine.createOwlRuntime());
    assert((meal.owlSummonState?.kind as string) === 'rice', 'Owl meal should transform into rice on the fifth global turn');

    localProject.setCurrentHp(engineYuzu, Math.floor(engineYuzu.maxHp * 0.5));
    const hpBefore = engineYuzu.currentHp;
    const healed = consumeOwlFoodForYuzu(engine.fighters, engineYuzu, (type, text) => engine.log(type, text));
    assert(healed === Math.floor(engineYuzu.maxHp * 0.1), `Yuzu should heal 10% from Owl food, got ${healed}`);
    assert(engineYuzu.currentHp === hpBefore + healed, 'Yuzu food heal should be applied before the following attack continues');
    assert(!engine.fighters.some((fighter) => fighter.id === meal.id), 'Consumed Owl food should leave the roster immediately');
    assert(logs.some((entry) => entry.text.includes('消耗退场不计死亡')), 'Yuzu food log should explain that consumption is not a death');
    cases.push('Owl food follows five-turn conversion and Yuzu consumption rules');
  }

  {
    const owl = makeFighter('鸮@A');
    const anchor = makeFighter('天意测试锚点@B');
    anchor.maxHp = 50000;
    localProject.setCurrentHp(anchor, 50000);
    const victims = Array.from({ length: 7 }, (_, index) => makeFighter(`天意祭品${index}@B`));
    victims.forEach((victim) => {
      victim.maxHp = 50000;
      localProject.setCurrentHp(victim, 50000);
    });
    const { engine } = makeDeathEngine([owl, anchor, ...victims]);
    const engineOwl = engine.fighters[0];
    enterPhaseTwo(engine, engineOwl);
    const atkBefore = engineOwl.atk;

    const npcCrystal = makeFighter('天意排除结晶@NPC');
    npcCrystal.isNpc = true;
    npcCrystal.isOriginiumCrystal = true;
    npcCrystal.cannotWin = true;
    engine.fighters.push(npcCrystal);
    engine.markDefeated(npcCrystal, { message: '测试结晶死亡', awardKill: false });
    assert(engineOwl.owlState?.heavenStacks === 0, 'Puruisaishi-line NPC deaths must not grant Heaven');

    for (const victim of engine.fighters.slice(2, 9)) {
      engine.markDefeated(victim, { message: `测试 ${victim.name} 死亡`, killer: engine.fighters[1] });
    }
    assert(engineOwl.atk > atkBefore, 'Owl should inherit six percent of fallen units stats');
    assert(Number(engineOwl.owlState?.heavenStacks) === 7, 'Seven eligible deaths should fill Heaven');
    assert(engineOwl.owlState?.phase === 3, 'Seven Heaven stacks should enter phase 3');
    assert(engineOwl.job === 'OWL_DRAGON_SOVEREIGN', 'Owl phase 3 should install the dragon-sovereign job');
    const emperor = engine.fighters.find((fighter) => fighter.owlSummonState?.kind === 'emperor');
    assert(emperor, 'Owl phase 3 should summon 帝王之征');
    assert(
      emperor.maxHp === 3650 && emperor.atk === 260 && emperor.mag === 260 && emperor.def === 145 && emperor.res === 145,
      '帝王之征 should use the exact current Blue-Eyes Ultimate reference stats',
    );
    cases.push('Owl Heaven excludes Puruisaishi NPCs and enters phase 3 at seven');
  }

  {
    const owl = makeFighter('鸮@A');
    const enemy = makeFighter('帝王承伤攻击者@B');
    const victims = Array.from({ length: 7 }, (_, index) => makeFighter(`帝王承伤祭品${index}@B`));
    enemy.maxHp = 50000;
    localProject.setCurrentHp(enemy, 50000);
    victims.forEach((victim) => {
      victim.maxHp = 50000;
      localProject.setCurrentHp(victim, 50000);
    });
    const { engine } = makeDeathEngine([owl, enemy, ...victims]);
    const engineOwl = engine.fighters[0];
    enterPhaseTwo(engine, engineOwl);
    engine.fighters.slice(2).forEach((victim) => engine.markDefeated(victim, { awardKill: false }));
    const emperor = engine.fighters.find((fighter) => fighter.owlSummonState?.kind === 'emperor');
    assert(emperor, 'Emperor redirect test requires 帝王之征');
    const owlHpBefore = engineOwl.currentHp;
    const emperorHpBefore = emperor.currentHp;
    const redirectOptions: DamageApplicationOptions = { actionName: '帝王承伤测试', respectDefenses: true };
    const actual = engine.applyDamage(engineOwl, 400, 'skill', true, engine.fighters[1], redirectOptions);

    assert(actual === 0, 'Damage redirected from Owl should not reduce Owl HP directly');
    assert(engineOwl.currentHp === owlHpBefore, 'Owl HP should remain unchanged after emperor redirect');
    assert(emperor.currentHp < emperorHpBefore, '帝王之征 should receive redirected damage');
    assert(redirectOptions.redirectedByOwlEmperor, 'Damage options should expose emperor redirection');

    const earHpBefore = engineOwl.currentHp;
    engine.applyDamage(emperor, 100, 'skill', true, engine.fighters[1], { actionName: '直接打龙', respectDefenses: true });
    assert(engineOwl.currentHp === earHpBefore - 10, 'Directly attacking 帝王之征 should cost Owl 10 HP');
    assert(engineOwl.status.some((status) => status.type === 'OWL_EAR_GUARD'), 'Direct dragon attack should grant Owl one-turn ear guard');
    cases.push('帝王之征 redirects Owl damage and direct hits trigger ear cost');
  }

  {
    const owl = makeFighter('鸮@A');
    const morphling = makeFighter('水人@B');
    morphling.agl = 10000;
    morphling.status.push({ type: 'AIM', duration: 1 });
    const { engine, logs } = makeDeathEngine([owl, morphling]);
    const engineOwl = engine.fighters[0];
    enterPhaseTwo(engine, engineOwl);
    assert(enterOwlPhaseThree(engine.createOwlRuntime(), engineOwl), 'Redirected afterExecute test requires Owl phase 3');
    const emperor = engine.fighters.find((fighter) => fighter.owlSummonState?.kind === 'emperor');
    assert(emperor, 'Redirected afterExecute test requires 帝王之征');
    const emperorHpBefore = emperor.currentHp;

    engine.executeSkillAction('abyssal_prison', engine.fighters[1], engineOwl);
    assert(emperor.currentHp < emperorHpBefore, '深渊水牢 damage should be redirected into 帝王之征');
    assert(!engineOwl.status.some((status) => status.type === 'WATER_PRISON'), 'A redirected hit must not apply its afterExecute debuff to Owl');
    assert(!logs.some((entry) => entry.text.includes(`${engineOwl.name} 实际承受 0`)), 'Emperor redirect logs must not claim that Owl took zero damage as a separate result');
    cases.push('帝王之征 redirect suppresses primary-target afterExecute debuffs');
  }

  {
    const owl = makeFighter('鸮@A');
    const enemy = makeFighter('蛐蛐最后攻击者@B');
    enemy.maxHp = 50000;
    localProject.setCurrentHp(enemy, 50000);
    const { engine, logs } = makeDeathEngine([owl, enemy]);
    const engineOwl = engine.fighters[0];
    enterPhaseTwo(engine, engineOwl);
    const crickets = spawnOwlCrickets(engine.createOwlRuntime(), engineOwl);
    assert(crickets.length === 2, 'Shining Hopper should create two crickets when both slots are free');

    engine.applyDamage(crickets[0], 99999, 'skill', true, engine.fighters[1], { actionName: '蛐蛐锁血测试' });
    assert(crickets.every((cricket) => cricket.isDeadAnnounced), 'One cricket reaching ten percent should cause both crickets to self-destruct');
    assert(engineOwl.owlState?.heavenStacks === 2, `Both real cricket deaths should grant two Heaven stacks, got ${engineOwl.owlState?.heavenStacks}`);
    assert(logs.some((entry) => entry.text.includes('【自刎归天】')), 'First cricket should log 自刎归天');
    assert(logs.some((entry) => entry.text.includes('【有情有义】')), 'Partner cricket should log 有情有义');
    cases.push('Cricket threshold produces one locked double self-destruction and two Heaven stacks');
  }

  {
    const owl = makeFighter('鸮@A');
    const markedAttacker = makeFighter('过江标记者@B');
    const victim = makeFighter('过江受害者@C');
    victim.maxHp = 50000;
    localProject.setCurrentHp(victim, 50000);
    markedAttacker.atk = 120;
    markedAttacker.mag = 120;
    markedAttacker.agl = 10000;
    markedAttacker.maxHp = 50000;
    localProject.setCurrentHp(markedAttacker, 50000);
    const { engine, logs } = makeDeathEngine([owl, markedAttacker, victim]);
    const engineOwl = engine.fighters[0];
    enterPhaseTwo(engine, engineOwl);
    engineOwl.agl = 10000;
    engineOwl.status.push({ type: 'AIM', duration: 1 });
    applyOwlRiverMark(engine.createOwlRuntime(), engineOwl, engine.fighters[1]);

    engine.executeSkillAction('triple_dragon_head', engine.fighters[1], engine.fighters[2]);
    const assistLogs = logs.filter((entry) => entry.text.includes('同步过江，复制'));
    assert(assistLogs.length === 1, `A multi-hit action should trigger exactly one Crossing assist, got ${assistLogs.length}`);
    cases.push('Crossing assist triggers once for an entire multi-hit action');
  }

  {
    const owl = makeFighter('鸮@A');
    const markedAttacker = makeFighter('过江反击触发者@B');
    const counterTarget = makeFighter('过江反击持有者@C');
    counterTarget.maxHp = 50000;
    localProject.setCurrentHp(counterTarget, 50000);
    counterTarget.status.push({ type: 'CTR_STUN', duration: 2 });
    const { engine, logs } = makeDeathEngine([owl, markedAttacker, counterTarget]);
    const engineOwl = engine.fighters[0];
    enterPhaseTwo(engine, engineOwl);
    engineOwl.agl = 10000;
    engineOwl.status.push({ type: 'AIM', duration: 1 });
    applyOwlRiverMark(engine.createOwlRuntime(), engineOwl, engine.fighters[1]);

    engine.resolveOwlCrossingAssists({
      id: 'owl-crossing-counter-order',
      actorId: engine.fighters[1].id,
      actorName: engine.fighters[1].name,
      skillId: 'test_attack',
      skillName: '测试攻击',
      presentation: 'skill',
      triggerDepth: 0,
      primaryTargetId: engine.fighters[2].id,
      primaryPreDefenseDamage: 200,
    });

    const causeIndex = logs.findIndex((entry) => entry.text.includes('触发') && entry.text.includes('追击同一个受害者'));
    const counterIndex = logs.findIndex((entry) => entry.text.includes('受到') && entry.text.includes('鸮') && entry.text.includes('震慑反击'));
    assert(causeIndex >= 0, 'Crossing counter flow should log why Owl joined the attack');
    assert(counterIndex > causeIndex, 'Crossing cause must appear before the victim counter log');
    cases.push('Crossing counter logs preserve cause before counter-effect order');
  }

  {
    const owl = makeFighter('鸮@A');
    const marked = makeFighter('过江过期靶@B');
    const { engine, logs } = makeDeathEngine([owl, marked]);
    const engineOwl = engine.fighters[0];
    enterPhaseTwo(engine, engineOwl);
    applyOwlRiverMark(engine.createOwlRuntime(), engineOwl, engine.fighters[1]);
    engine.turnCount += 5;
    processOwlGlobalTick(engine.createOwlRuntime());
    processOwlGlobalTick(engine.createOwlRuntime());

    assert(engineOwl.owlState?.riverMarkedTargetId === undefined, 'Expired Crossing target should be removed from Owl runtime state');
    assert(engineOwl.owlState?.riverMarkExpiresTurn === undefined, 'Expired Crossing timer should be removed from Owl runtime state');
    assert(logs.filter((entry) => entry.text.includes('过江') && entry.text.includes('标记到期')).length === 1, 'Crossing expiration should be logged exactly once');
    cases.push('Crossing expiration clears the live Owl state exactly once');
  }

  {
    const owl = makeFighter('鸮@A');
    const killerTarget = makeFighter('天意形态击杀靶@B');
    const anchor = makeFighter('天意形态锚点@C');
    const { engine } = makeDeathEngine([owl, killerTarget, anchor]);
    const engineOwl = engine.fighters[0];
    engine.markDefeated(engine.fighters[1], { killer: engineOwl });
    assert(engineOwl.owlState?.warForm === 'pride', 'Owl kill in Victory should enter Pride');

    localProject.setCurrentHp(engineOwl, Math.floor(engineOwl.maxHp * 0.5));
    processOwlGlobalTick(engine.createOwlRuntime());
    assert((engineOwl.owlState?.warForm as string) === 'defeat', 'Pride at half HP should enter Defeat');
    assert(getOwlIncomingMultiplier(engineOwl) === 0.15, 'Defeat should provide 85% total damage reduction without stacking phase-2 reduction again');
    engine.turnCount += 10;
    processOwlGlobalTick(engine.createOwlRuntime());
    assert((engineOwl.owlState?.warForm as string) === 'sorrow', 'Defeat should enter Sorrow after ten global turns');
    engine.turnCount += 10;
    processOwlGlobalTick(engine.createOwlRuntime());
    assert((engineOwl.owlState?.warForm as string) === 'victory', 'Sorrow should return to Victory after ten global turns');
    cases.push('Owl war forms follow Victory-Pride-Defeat-Sorrow timing');
  }

  {
    const attacker = makeFighter('大风闪避测试攻击者@A');
    const target = makeFighter('大风闪避测试目标@B');
    attacker.agl = 50;
    target.agl = 100;
    const skill: SkillDefinition = { name: '命中测试', tag: 'physical', mult: 1 };
    const originalRandom = Math.random;
    try {
      Math.random = () => 0.8;
      assert(missesSkill(attacker, target, skill, false), 'The test hit should miss before Owl opening is applied');
      target.status.push({ type: 'OWL_EVADE_DOWN', duration: 2 });
      assert(missesSkill(attacker, target, skill, false), 'OWL_EVADE_DOWN should no longer alter agility');
      assert(consumeOwlEvadeOpening(target, skill, false), 'OWL_EVADE_DOWN should guarantee the next direct single-target hit');
      assert(!target.status.some((status) => status.type === 'OWL_EVADE_DOWN'), 'OWL_EVADE_DOWN should be consumed by that hit');
    } finally {
      Math.random = originalRandom;
    }
    cases.push('大风起兮云飞扬 creates one consumable guaranteed hit');
  }

  {
    const owl = makeFighter('鸮@A');
    const enemy = makeFighter('归溟锁血攻击者@B');
    enemy.maxHp = 50000;
    localProject.setCurrentHp(enemy, 50000);
    const { engine } = makeDeathEngine([owl, enemy]);
    const engineOwl = engine.fighters[0];
    enterPhaseTwo(engine, engineOwl);
    const squad = spawnOwlFurrySquad(engine.createOwlRuntime(), engineOwl);
    const spalter = squad.find((fighter) => fighter.owlSummonState?.kind === 'spalter');
    assert(spalter, 'Furry squad should include 归溟幽灵鲨');
    engine.applyDamage(spalter, 99999, 'skill', true, engine.fighters[1], { actionName: '归溟锁血测试' });
    assert(spalter.currentHp === 1, '归溟幽灵鲨 should lock at one HP on its first lethal hit');
    engine.turnCount += 1;
    processOwlGlobalTick(engine.createOwlRuntime());
    assert(spalter.cannotAct && spalter.owlSummonState?.dollUntilTurn !== undefined, '归溟幽灵鲨 should enter doll form after lock expires');
    engine.turnCount += 3;
    processOwlGlobalTick(engine.createOwlRuntime());
    assert(!spalter.cannotAct && spalter.owlSummonState?.dollUntilTurn === undefined, '归溟幽灵鲨 should return after three doll turns');
    engine.turnCount += 1;
    processOwlGlobalTick(engine.createOwlRuntime());
    assert(!spalter.cannotAct, '归溟幽灵鲨 must not re-enter doll form without another death save');
    cases.push('归溟幽灵鲨 performs one lock-doll-return lifecycle');
  }

  {
    const owl = makeFighter('鸮@A');
    const enemy = makeFighter('三阶段选技目标@B');
    enemy.maxHp = 50000;
    localProject.setCurrentHp(enemy, 50000);
    const { engine } = makeDeathEngine([owl, enemy]);
    const engineOwl = engine.fighters[0];
    enterPhaseTwo(engine, engineOwl);
    assert(enterOwlPhaseThree(engine.createOwlRuntime(), engineOwl), 'Phase-3 skill selection test requires Owl phase 3');
    const emperor = engine.fighters.find((fighter) => fighter.owlSummonState?.kind === 'emperor');
    assert(emperor?.owlSummonState, 'Phase-3 skill selection test requires an active emperor');
    emperor.owlSummonState.wildStacks = 5;

    for (let index = 0; index < 40; index += 1) {
      const selected = engine.selectSkill(engineOwl);
      assert(
        selected === 'owl_ruthless_sword' || selected === 'owl_great_wind',
        `A full-health Owl with a full-health, max-Wild emperor should not choose a no-value support skill, got ${selected}`,
      );
    }

    engine.markDefeated(emperor, { message: '帝王退场选技测试', awardKill: false });
    localProject.setCurrentHp(engineOwl, Math.floor(engineOwl.maxHp * 0.45));
    for (let index = 0; index < 60; index += 1) {
      const selected = engine.selectSkill(engineOwl);
      assert(selected !== 'owl_desk', '帝王之征退场后不得选择伏案');
      assert(selected !== 'owl_bone_scrape', '帝王之征退场后不得选择刮骨');
    }
    cases.push('Owl phase-3 selector excludes support skills with no valid benefit');
  }

  {
    const owl = makeFighter('鸮@A');
    const yuzu = makeFighter('柚子@B');
    const teammate = makeFighter('镜界分摊队友@B');
    const { engine } = makeDeathEngine([owl, yuzu, teammate]);
    const [engineOwl, engineYuzu, engineTeammate] = engine.fighters;
    engineYuzu.yuzuPhase = 2;
    engineYuzu.transformed = true;
    engineYuzu.yuzuShield = 0;
    engineYuzu.status = engineYuzu.status.filter((status) => status.type !== 'YUZU_BARRIER');
    engineTeammate.maxHp = 10000;
    localProject.setCurrentHp(engineTeammate, 10000);
    engineTeammate.yuzuShield = 0;
    engineTeammate.status = engineTeammate.status.filter((status) => status.type !== 'YUZU_BARRIER');
    const hpBefore = engineTeammate.currentHp;

    engine.applyDamage(engineYuzu, 100, 'skill', true, engineOwl, { actionName: '鸮倍率分摊测试' });

    assert(hpBefore - engineTeammate.currentHp === 135, `Owl's 1.35 outgoing multiplier must apply once before Yuzu sharing, got ${hpBefore - engineTeammate.currentHp}`);
    cases.push('Owl outgoing multiplier applies once through Yuzu sharing');
  }

  {
    const owl = makeFighter('鸮@A');
    const joker = makeFighter('屑@B');
    const transferVictim = makeFighter('伤害转移承受者@A');
    const { engine } = makeDeathEngine([owl, joker, transferVictim]);
    const [engineOwl, engineJoker, engineVictim] = engine.fighters;
    const jokerJob = localProject.jobs.GOD_OF_TROLLS;
    assert(jokerJob, 'Owl transfer multiplier test requires GOD_OF_TROLLS');
    engineJoker.job = 'GOD_OF_TROLLS';
    engineJoker.jobData = { ...jokerJob, skills: [...jokerJob.skills] };
    engineJoker.transformed = true;
    engineVictim.maxHp = 10000;
    localProject.setCurrentHp(engineVictim, 10000);
    const options: DamageApplicationOptions = { actionName: '鸮倍率转移测试' };

    withRandomSequence([0, 0.99], () => {
      engine.applyDamage(engineJoker, 100, 'skill', true, engineOwl, options);
    });

    assert(options.redirectedJokerDamage === 135, `Owl's 1.35 outgoing multiplier must not repeat after Joker transfer, got ${options.redirectedJokerDamage}`);
    assert(engineVictim.currentHp === 9865, 'The selected transfer victim should lose exactly the once-modified damage');
    cases.push('Owl outgoing multiplier applies once through Joker transfer');
  }

  {
    const owl = makeFighter('鸮@A');
    const markedEnemy = makeFighter('过江施法抵挡靶@B');
    const { engine } = makeDeathEngine([owl, markedEnemy]);
    const [engineOwl, engineEnemy] = engine.fighters;
    enterPhaseTwo(engine, engineOwl);
    engineEnemy.status.push({ type: 'SPELL_BLOCK', duration: 1, sourceId: 'test_spell_block' });

    engine.executeSkillAction('owl_crossing_mark', engineOwl, engineEnemy);

    assert(!engineEnemy.status.some((status) => status.type === 'SPELL_BLOCK'), 'Crossing Mark should consume the target spell block');
    assert(!engineEnemy.status.some((status) => status.type === 'OWL_RIVER_MARK'), 'A spell-blocked Crossing Mark must not apply its mark');
    cases.push('Crossing Mark respects spell block before applying');
  }

  {
    const owl = makeFighter('鸮@A');
    const markedEnemy = makeFighter('过江自击触发者@B');
    const { engine, logs } = makeDeathEngine([owl, markedEnemy]);
    const [engineOwl, engineEnemy] = engine.fighters;
    enterPhaseTwo(engine, engineOwl);
    applyOwlRiverMark(engine.createOwlRuntime(), engineOwl, engineEnemy);
    engineEnemy.status.push({ type: 'AIM', duration: 1 });

    engine.executeSkillAction('serious_punch', engineEnemy, engineOwl);

    assert(logs.some((entry) => entry.text.includes('不会把协同攻击打向自己')), 'Owl should explicitly suppress a Crossing assist whose victim is Owl itself');
    assert(!logs.some((entry) => entry.text.includes('同步过江') && entry.text.includes(engineOwl.name)), 'Owl must not execute a Crossing assist against itself');
    cases.push('Crossing assist never attacks Owl itself');
  }

  return cases;
}
