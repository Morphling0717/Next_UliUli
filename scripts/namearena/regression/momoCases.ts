import { spawnOwlMeal } from '../../../lib/namearena/owlMechanics';
import {
  MOMO_CAPTAIN_HP_BONUS,
  MOMO_DYNAMIC_TEAM_LIMIT,
  addMomoCrowdJoy,
  chooseMomoPartner,
  ensureMomoState,
  grantMomoSword,
  processMomoActorTurnEnd,
  processMomoGlobalTick,
  registerMomoRiderKick,
  tryMomoBanishBlueEyes,
  tryMomoStealYuzuMeal,
} from '../../../lib/namearena/momoMechanics';
import { cleanupOrphanedTimedStatModifiers } from '../../../lib/namearena/statModifiers';
import type { DamageApplicationOptions, Fighter, SpinalSwordRef } from '../../../lib/namearena/types';
import {
  assert,
  localProject,
  makeFighter,
  withRandomSequence,
  type BattleEngineInstance,
} from '../shared/harness';
import { makeDeathEngine } from './deathAccountingCases';

function hasOwnedStatus(fighter: Fighter, type: string, sourceId: string): boolean {
  return fighter.status.some((status) => status.type === type && status.sourceId === sourceId);
}

function enterPhaseTwo(engine: BattleEngineInstance, momo: Fighter): void {
  localProject.setCurrentHp(momo, Math.max(1, Math.floor(momo.maxHp * 0.4)));
  engine.handleTransformations(momo);
  assert(momo.momoState?.phase === 2, `Momo should enter phase 2, got ${momo.momoState?.phase}`);
  assert(momo.transformed, 'Momo phase 2 should consume the standard phase transformation');
  localProject.setCurrentHp(momo, momo.maxHp);
}

function makeBlueEyes(owner: Fighter): Fighter {
  const summon = makeFighter('青眼白龙测试实体');
  summon.name = '青眼白龙';
  summon.displayName = '青眼白龙';
  summon.summonBaseName = '青眼白龙';
  summon.isSummon = true;
  summon.summonerId = owner.id;
  return summon;
}

export function runMomoCases(): string[] {
  const cases: string[] = [];

  {
    const canonical = makeFighter('萌月沫沫@A');
    const alias = makeFighter('沫沫@A');
    const statKeys = ['maxHp', 'atk', 'def', 'spd', 'agl', 'mag', 'res', 'wis'] as const;
    assert(canonical.name === '萌月沫沫' && alias.name === '萌月沫沫', 'Both Momo inputs should use the canonical battle name');
    assert(canonical.displayName === '萌月沫沫@A' && alias.displayName === '萌月沫沫@A', 'Momo alias should use the canonical display name');
    assert(canonical.job === 'MOMO_BUBBLE_GOD' && alias.job === 'MOMO_BUBBLE_GOD', 'Both Momo inputs should map to 泡沫之神');
    statKeys.forEach((key) => assert(canonical[key] === alias[key], `Momo alias should preserve seeded ${key}`));
    cases.push('Momo canonical name and alias generate the same special fighter');
  }

  {
    const momo = makeFighter('萌月沫沫');
    const owner = makeFighter('随机队友主人');
    const summon = makeFighter('随机队友召唤物');
    summon.isSummon = true;
    summon.summonerId = owner.id;
    summon.summonBaseName = summon.name;
    const npc = makeFighter('随机队友NPC');
    npc.isNpc = true;
    npc.cannotAct = true;
    npc.cannotWin = true;
    const { engine } = makeDeathEngine([momo, owner, summon, npc]);
    const engineMomo = engine.fighters[0];
    const engineOwner = engine.fighters[1];
    const engineSummon = engine.fighters[2];
    const engineNpc = engine.fighters[3];

    withRandomSequence([0.75], () => engine.initializeMomoTeams());

    assert(engineMomo.momoState?.teamMode === 'dynamic', 'Momo without an explicit team should use dynamic teaming');
    assert(engineMomo.momoState?.partnerTargetId === engineSummon.id, 'Forced random roll should select the summon itself');
    assert(engineMomo.momoState?.partnerAnchorId === engineOwner.id, 'Selecting a summon should anchor the team to its owner');
    assert(engine.getTeamId(engineMomo) === engine.getTeamId(engineOwner), 'Momo should join the selected summon owner team');
    assert(hasOwnedStatus(engineOwner, 'MOMO_CAPTAIN', engineMomo.id), 'Selected summon owner should become a captain');
    assert(hasOwnedStatus(engineSummon, 'MOMO_CAPTAIN', engineMomo.id), 'All summons belonging to the selected owner should become captains');
    assert(!hasOwnedStatus(engineNpc, 'MOMO_CAPTAIN', engineMomo.id), 'NPCs must never become captains through random teaming');
    cases.push('Momo random teaming joins summon owners and excludes NPCs');
  }

  {
    const momo = makeFighter('萌月沫沫');
    const first = makeFighter('沫沫旧队友');
    const second = makeFighter('沫沫未认主队友');
    const firstBaseMaxHp = first.maxHp;
    const { engine, logs } = makeDeathEngine([momo, first, second]);
    const engineMomo = engine.fighters[0];
    const engineFirst = engine.fighters[1];
    const engineSecond = engine.fighters[2];

    withRandomSequence([0], () => engine.initializeMomoTeams());
    assert(engineMomo.momoState?.partnerTargetId === engineFirst.id, 'Initial forced roll should select the first teammate');
    localProject.setCurrentHp(engineMomo, Math.max(1, engineMomo.currentHp - 200));
    const momoHpBeforeReteam = engineMomo.currentHp;
    engine.markDefeated(engineFirst, { message: '测试旧队友退场', awardKill: false });
    assert(engineMomo.momoState?.partnerReselectPending, 'Partner defeat should defer re-teaming until the current settlement ends');
    engine.initializeMomoTeams();

    assert(!engineMomo.momoState?.partnerTargetId, 'Momo should not select another teammate after using the opening selection');
    assert(engineMomo.momoState?.partnerSelectionCount === MOMO_DYNAMIC_TEAM_LIMIT, 'The opening selection should consume the full dynamic team allowance');
    assert(engineMomo.currentHp === momoHpBeforeReteam, 'Dynamic re-teaming must not heal Momo by removing and re-granting her own captain bonus');
    assert(!hasOwnedStatus(engineFirst, 'MOMO_CAPTAIN', engineMomo.id), 'Former teammate should lose Momo captain status');
    assert(engineFirst.maxHp === firstBaseMaxHp, 'Former teammate should lose exactly the temporary 138 max HP bonus');
    assert(engine.getTeamId(engineMomo).startsWith('MOMO_SOLO:'), 'Momo should continue alone after exhausting dynamic teaming');
    assert(!hasOwnedStatus(engineSecond, 'MOMO_CAPTAIN', engineMomo.id), 'Unselected survivors must not become captains after the limit is reached');
    assert(logs.some((entry) => entry.text.includes('认主次数已用尽')), 'Exhausting Momo teaming should produce an explicit causal log');
    cases.push('Momo keeps one opening teammate, then continues alone after that captain leaves');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const ally = makeFighter('沫沫固定队友@A');
    const enemy = makeFighter('沫沫固定队敌人@B');
    const { engine } = makeDeathEngine([momo, ally, enemy]);
    const engineMomo = engine.fighters[0];
    const engineAlly = engine.fighters[1];
    const momoMaxBefore = engineMomo.maxHp;
    const allyMaxBefore = engineAlly.maxHp;

    engine.initializeMomoTeams();
    engine.initializeMomoTeams();

    assert(engineMomo.momoState?.teamMode === 'explicit', 'Momo with an entered team should never reroll teammates');
    assert(engineMomo.maxHp === momoMaxBefore + MOMO_CAPTAIN_HP_BONUS, 'Momo should receive the captain HP bonus exactly once');
    assert(engineAlly.maxHp === allyMaxBefore + MOMO_CAPTAIN_HP_BONUS, 'Explicit ally should receive the captain HP bonus exactly once');
    assert(!hasOwnedStatus(engine.fighters[2], 'MOMO_CAPTAIN', engineMomo.id), 'Enemy should not receive captain status');
    cases.push('Momo respects explicit teams and captain bonuses are idempotent');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const captain = makeFighter('舰长联动测试者@A');
    const enemy = makeFighter('舰长联动承伤者@B');
    enemy.maxHp = 10000;
    localProject.setCurrentHp(enemy, 10000);
    const { engine, logs } = makeDeathEngine([momo, captain, enemy]);
    const engineMomo = engine.fighters[0];
    const engineCaptain = engine.fighters[1];
    const engineEnemy = engine.fighters[2];
    engine.initializeMomoTeams();
    addMomoCrowdJoy(engine.createMomoRuntime(), engineMomo, 50);
    localProject.setCurrentHp(engineMomo, Math.floor(engineMomo.maxHp * 0.5));
    localProject.setCurrentHp(engineCaptain, Math.floor(engineCaptain.maxHp * 0.5));
    const momoHpBefore = engineMomo.currentHp;
    const captainHpBefore = engineCaptain.currentHp;

    const actual = engine.applyDamage(engineEnemy, 100, 'skill', true, engineCaptain, { actionName: '舰长联动测试' });

    assert(actual === 100, `Captain test hit should deal exactly 100 HP damage, got ${actual}`);
    assert(engineCaptain.currentHp === captainHpBefore + 50, '50 Crowd Joy stacks should heal the attacking captain for 50% of damage');
    assert(engineMomo.currentHp === momoHpBefore + 8, 'Captain damage should heal Momo for the configured 8% share');
    assert(logs.some((entry) => entry.text.includes('舰长联动') && entry.text.includes('吸血恢复 50')), 'Captain lifesteal and Momo feedback should have a causal log');

    processMomoActorTurnEnd(engine.createMomoRuntime(), engineCaptain, false);
    let joy = engineCaptain.status.find((status) => status.type === 'MOMO_CROWD_JOY' && status.sourceId === engineMomo.id);
    assert(joy?.stacks === 50, 'A skipped or blocked action must not decay Crowd Joy');
    processMomoActorTurnEnd(engine.createMomoRuntime(), engineCaptain, true);
    joy = engineCaptain.status.find((status) => status.type === 'MOMO_CROWD_JOY' && status.sourceId === engineMomo.id);
    assert(joy?.stacks === 40, `Captain action end should decay Crowd Joy 50 -> 40, got ${joy?.stacks}`);
    cases.push('Momo captain damage grants scoped lifesteal, owner healing, and per-actor decay');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const ally = makeFighter('沫沫锁血队友@A');
    const enemy = makeFighter('沫沫锁血攻击者@B');
    const { engine, logs } = makeDeathEngine([momo, ally, enemy]);
    const engineMomo = engine.fighters[0];
    engine.initializeMomoTeams();
    localProject.setCurrentHp(engineMomo, 2);

    engine.applyDamage(engineMomo, 99999, 'skill', true, engine.fighters[2], { actionName: '沫沫锁血测试' });

    assert(engineMomo.momoState?.phase === 2, 'A lethal phase-1 hit should move Momo into phase 2');
    assert(engineMomo.job === 'MOMO_LOVER_KING', `Phase-2 Momo should use MOMO_LOVER_KING, got ${engineMomo.job}`);
    assert(engineMomo.currentHp > 1, 'Phase-2 stat rebuild should restore Momo above the locked one HP');
    const lockIndex = logs.findIndex((entry) => entry.text.includes('锁血保护'));
    const transformIndex = logs.findIndex((entry) => entry.text.includes('我有两个可爱'));
    assert(lockIndex >= 0 && transformIndex > lockIndex, 'Momo logs should show phase lock before the transformation');
    cases.push('Momo lethal phase-1 damage locks at one HP before phase-2 transformation');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const firstCaptain = makeFighter('伤害均摊舰长甲@A');
    const secondCaptain = makeFighter('伤害均摊舰长乙@A');
    const enemy = makeFighter('伤害均摊攻击者@B');
    const { engine, logs } = makeDeathEngine([momo, firstCaptain, secondCaptain, enemy]);
    const engineMomo = engine.fighters[0];
    const captains = [engine.fighters[1], engine.fighters[2]];
    const attacker = engine.fighters[3];
    engine.initializeMomoTeams();
    enterPhaseTwo(engine, engineMomo);
    const momoHpBefore = engineMomo.currentHp;
    const captainHpBefore = captains.map((captain) => captain.currentHp);
    const options: DamageApplicationOptions = { actionName: '|OMO直接测试', respectDefenses: true };

    const actual = engine.applyDamage(engineMomo, 301, 'skill', true, attacker, options);
    const sharedLoss = captains.reduce((sum, captain, index) => sum + captainHpBefore[index] - captain.currentHp, 0);

    assert(actual === 0 && engineMomo.currentHp === momoHpBefore, 'Phase-2 Momo should take no HP damage while another captain can share it');
    assert(sharedLoss === 301, `|OMO should preserve all 301 effective damage across captains, got ${sharedLoss}`);
    assert(options.redirectedByMomo && options.redirectedMomoDamage === 301, '|OMO should expose an explicit Momo redirect settlement');
    assert(options.resolution?.outcome === 'redistributed', `|OMO should settle as redistributed, got ${options.resolution?.outcome}`);

    const captainHpAfterShare = captains.map((captain) => captain.currentHp);
    const momoCostBefore = engineMomo.currentHp;
    engineMomo.yuzuShield = 100;
    engine.executeSkillAction('momo_top_rank', engineMomo, attacker);
    assert(engineMomo.currentHp === momoCostBefore - 15, 'Momo self-cost should remain on Momo instead of entering |OMO');
    assert(engineMomo.yuzuShield === 100, 'Momo self-cost should bypass rather than consume a shared mirror shield');
    captains.forEach((captain, index) => assert(captain.currentHp === captainHpAfterShare[index], 'Momo self-cost must not damage captains'));

    engineMomo.yuzuShield = 0;
    engine.executeSkillAction('serious_punch', attacker, engineMomo);
    assert(logs.some((entry) => entry.text.includes('【|OMO】')), 'Standard skill flow should retain the |OMO causal log');
    assert(!logs.some((entry) => entry.text.includes(engineMomo.name) && entry.text.includes('完全抵消了这次伤害')), 'Standard skill flow must not mislabel |OMO as full mitigation');
    cases.push('Momo |OMO preserves damage, excludes self-costs, and reports redistribution coherently');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const enemy = makeFighter('沫沫单人二阶段敌人@B');
    const { engine } = makeDeathEngine([momo, enemy]);
    const engineMomo = engine.fighters[0];
    engine.initializeMomoTeams();
    enterPhaseTwo(engine, engineMomo);
    const hpBefore = engineMomo.currentHp;
    const options: DamageApplicationOptions = { actionName: '无舰长测试', respectDefenses: true };

    const actual = engine.applyDamage(engineMomo, 100, 'skill', true, engine.fighters[1], options);

    assert(actual === 100 && engineMomo.currentHp === hpBefore - 100, 'Momo should take damage normally when no other captain exists');
    assert(!options.redirectedByMomo, 'No-captain damage should not expose a false |OMO redirect');
    cases.push('Momo |OMO falls back to normal damage when no other captain exists');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const ally = makeFighter('醒剑测试队友@A');
    const enemy = makeFighter('醒剑测试敌人@B');
    const { engine, logs } = makeDeathEngine([momo, ally, enemy]);
    const engineMomo = engine.fighters[0];
    engine.initializeMomoTeams();
    enterPhaseTwo(engine, engineMomo);

    const swordResult = withRandomSequence([0.9], () => grantMomoSword(engine.createMomoRuntime(), engineMomo));
    assert(swordResult === 'village' && hasOwnedStatus(engineMomo, 'MOMO_VILLAGE_SWORD', engineMomo.id), 'Failed resonance should equip one village sword');
    for (let count = 0; count < 6; count += 1) registerMomoRiderKick(engine.createMomoRuntime(), engineMomo, '测试骑士踢');
    assert(engineMomo.momoState?.phase === 2, 'Momo should remain phase 2 before the seventh rider kick');
    registerMomoRiderKick(engine.createMomoRuntime(), engineMomo, '测试骑士踢');

    assert(Number(engineMomo.momoState?.phase) === 3, 'The seventh rider kick should enter phase 3');
    assert(engineMomo.job === 'MOMO_SAI_Q_RIDER', `Phase-3 Momo should use MOMO_SAI_Q_RIDER, got ${engineMomo.job}`);
    assert(hasOwnedStatus(engineMomo, 'MOMO_AWAKENED_SWORD', engineMomo.id), 'Phase-3 way?! should guarantee an awakened sword');
    assert(!hasOwnedStatus(engineMomo, 'MOMO_VILLAGE_SWORD', engineMomo.id), 'Awakened sword should replace rather than stack with village sword');

    engineMomo.status = engineMomo.status.filter((status) => status.type !== 'MOMO_AWAKENED_SWORD');
    cleanupOrphanedTimedStatModifiers(engineMomo);
    processMomoGlobalTick(engine.createMomoRuntime());
    assert(hasOwnedStatus(engineMomo, 'MOMO_AWAKENED_SWORD', engineMomo.id), 'Phase-3 way?! should restore an awakened sword removed by an external dispel');
    const countLogsBefore = logs.filter((entry) => entry.text.includes('【骑士踢计数】')).length;
    registerMomoRiderKick(engine.createMomoRuntime(), engineMomo, '三阶段测试踢');
    assert(engineMomo.momoState?.riderKickCount === 7, 'Phase-3 rider kick progress must remain capped at seven');
    assert(logs.filter((entry) => entry.text.includes('【骑士踢计数】')).length === countLogsBefore, 'Phase-3 attacks must not keep logging meaningless 7/7 progress');
    cases.push('Momo enters phase 3 on seven rider kicks and replaces village sword with awakened sword');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const enemy = makeFighter('无双龙测试敌人@B');
    enemy.maxHp = 50000;
    localProject.setCurrentHp(enemy, 50000);
    const { engine } = makeDeathEngine([momo, enemy]);
    const engineMomo = engine.fighters[0];
    engine.initializeMomoTeams();
    enterPhaseTwo(engine, engineMomo);

    engine.executeSkillAction('momo_sweep_furry', engineMomo, engine.fighters[1]);
    const dragons = engine.fighters.filter((fighter) => fighter.summonerId === engineMomo.id && fighter.momoDragonVariant);
    assert(dragons.length === 1, `Momo should summon exactly one contract dragon, got ${dragons.length}`);
    const dragon = dragons[0];
    assert(hasOwnedStatus(dragon, 'MOMO_CAPTAIN', engineMomo.id), 'Contract dragon should join Momo as a captain');

    engine.executeSkillAction('momo_sweep_furry', engineMomo, engine.fighters[1]);
    assert(engine.fighters.filter((fighter) => fighter.summonerId === engineMomo.id && fighter.momoDragonVariant).length === 1, 'Momo cannot summon a second active contract dragon');

    engine.executeSkillAction('momo_guard_vent', dragon, engine.fighters[1]);
    engine.executeSkillAction('momo_guard_vent', dragon, engine.fighters[1]);
    assert(engineMomo.status.filter((status) => status.type === 'SPELL_BLOCK' && status.sourceId === 'momo_guard_vent').length === 1, 'GUARD VENT should provide exactly one non-stacking spell block');

    engine.executeSkillAction('momo_sword_vent', dragon, engine.fighters[1]);
    assert(engineMomo.status.filter((status) => status.sourceId === engineMomo.id && (status.type === 'MOMO_VILLAGE_SWORD' || status.type === 'MOMO_AWAKENED_SWORD')).length === 1, 'SWORD VENT should equip exactly one sword state');

    const kicksBefore = ensureMomoState(engineMomo).riderKickCount;
    engine.executeSkillAction('momo_final_vent', dragon, engine.fighters[1]);
    assert(ensureMomoState(engineMomo).riderKickCount === kicksBefore + 1, 'Contract dragon FINAL VENT should count as Momo rider kick progress');
    cases.push('Momo contract dragon is unique and its VENT equipment does not stack');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const yuzu = makeFighter('柚子@B');
    const { engine } = makeDeathEngine([momo, yuzu]);
    const engineMomo = engine.fighters[0];
    const engineYuzu = engine.fighters[1];
    ensureMomoState(engineMomo).phase = 3;
    engineMomo.transformed = true;
    localProject.setCurrentHp(engineMomo, engineMomo.maxHp);
    const hpBefore = engineMomo.currentHp;
    const expectedCost = Math.max(1, Math.floor(engineMomo.maxHp * 0.05));

    const winner = withRandomSequence([0, 0], () => tryMomoStealYuzuMeal(engine.createMomoRuntime(), engineYuzu));

    assert(winner?.id === engineMomo.id, 'Forced successful meal contest should return Momo as winner');
    assert(engineMomo.currentHp === hpBefore - expectedCost, 'Winning Yuzu meal contest should cost Momo 5% max HP');
    assert(engineMomo.status.some((status) => status.type === 'POISON' && status.stacks === 3), 'Winning Yuzu meal contest should grant exactly three poison stacks');
    cases.push('Momo can win Yuzu spoon meal contest and pays the toxic meal cost');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const owl = makeFighter('鸮@B');
    const { engine } = makeDeathEngine([momo, owl]);
    const engineMomo = engine.fighters[0];
    const engineOwl = engine.fighters[1];
    ensureMomoState(engineMomo).phase = 3;
    engineMomo.transformed = true;
    const meal = spawnOwlMeal(engine.createOwlRuntime(), engineOwl);
    const hpBefore = engineMomo.currentHp;

    withRandomSequence([0], () => processMomoActorTurnEnd(engine.createMomoRuntime(), engineMomo, true));

    assert(!engine.fighters.some((fighter) => fighter.id === meal.id), 'Successful Momo food roll should consume one Owl food unit without leaving a corpse');
    assert(engineMomo.currentHp === hpBefore - Math.max(1, Math.floor(engineMomo.maxHp * 0.05)), 'Eating Owl food should cost Momo 5% max HP');
    assert(engineMomo.status.some((status) => status.type === 'POISON' && status.stacks === 3), 'Eating Owl food should grant three poison stacks');
    cases.push('Momo phase-3 action can consume Owl food at its independent toxic-meal roll');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const gacha = makeFighter('牢鳄@A');
    const blueEyes = makeBlueEyes(gacha);
    const enemy = makeFighter('抹杀旁观者@B');
    const { engine, logs } = makeDeathEngine([momo, gacha, blueEyes, enemy]);
    const engineMomo = engine.fighters[0];
    const engineGacha = engine.fighters[1];
    const engineBlueEyes = engine.fighters[2];
    engine.initializeMomoTeams();

    const banisher = withRandomSequence([0], () => tryMomoBanishBlueEyes(engine.createMomoRuntime(), engineBlueEyes, engineGacha));

    assert(banisher?.id === engineMomo.id, 'Forced Crossout roll should attribute the banish to Momo');
    assert(engineBlueEyes.currentHp === 0 && engineBlueEyes.isDeadAnnounced, 'Crossout should immediately announce Blue-Eyes defeat at zero HP');
    assert(engineMomo.stats.kills === 1, `Crossout should award one kill to Momo, got ${engineMomo.stats.kills}`);
    assert(logs.some((entry) => entry.text.includes('抹杀的指名者') && entry.text.includes('青眼白龙')), 'Crossout should log both its cause and declared summon');
    const spinalSwordRef: SpinalSwordRef = { current: false };
    engine.handleDeathsAndRevives(spinalSwordRef);
    assert(engineBlueEyes.isDead, 'Crossout target should pass through normal finalized summon death settlement');
    cases.push('Momo Crossout instantly defeats allied Blue-Eyes with correct kill attribution');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const morphling = makeFighter('水人@B');
    const enemy = makeFighter('大女儿测试敌人@C');
    const { engine } = makeDeathEngine([momo, morphling, enemy]);
    const engineMomo = engine.fighters[0];
    engine.initializeMomoTeams();
    enterPhaseTwo(engine, engineMomo);
    engine.markDefeated(engineMomo, { message: '测试沫沫首次死亡', killer: engine.fighters[2] });
    const spinalSwordRef: SpinalSwordRef = { current: false };
    engine.handleDeathsAndRevives(spinalSwordRef);

    assert(!engineMomo.isDead && !engineMomo.isDeadAnnounced && engineMomo.currentHp === engineMomo.maxHp, 'Active Water should revive Momo at full HP');
    assert(engineMomo.job === 'MOMO_WATER_DAUGHTER', `Revived Momo should become water daughter, got ${engineMomo.job}`);
    assert(engineMomo.momoState?.waterDaughter && engineMomo.momoState.teamMode === 'water', 'Water daughter state should be permanent and use Water team mode');
    assert(engine.getTeamId(engineMomo) === 'WATER_TEAM', 'Water daughter should join the actual Water team');

    engine.markDefeated(engineMomo, { message: '测试沫沫第二次死亡', killer: engine.fighters[2] });
    engine.handleDeathsAndRevives(spinalSwordRef);
    assert(engineMomo.isDead, 'Water daughter revival should only happen once');
    cases.push('Momo revives once as Water daughter and permanently joins the Water team');
  }

  {
    const firstMomo = makeFighter('萌月沫沫');
    const secondMomo = makeFighter('沫沫');
    const enemy = makeFighter('沫沫随机组队普通候选');
    const { engine } = makeDeathEngine([firstMomo, secondMomo, enemy]);
    const selected = withRandomSequence([0], () =>
      chooseMomoPartner(engine.createMomoRuntime(), engine.fighters[0], '测试同角色组队'),
    );
    assert(selected?.id === engine.fighters[1].id, 'Momo random teaming should allow another non-NPC Momo as documented');
    cases.push('Momo random teaming allows any non-NPC fighter, including another Momo');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const bunny = makeFighter('兔卷卷@B');
    const { engine } = makeDeathEngine([momo, bunny]);
    const engineMomo = engine.fighters[0];
    engine.initializeMomoTeams();
    localProject.setCurrentHp(engineMomo, engineMomo.maxHp - 200);
    const maxBeforeZero = engineMomo.maxHp;
    const hpBeforeZero = engineMomo.currentHp;

    engine.executeSkillAction('v_rabbit_zero', engine.fighters[1], engineMomo);
    assert(!hasOwnedStatus(engineMomo, 'MOMO_CAPTAIN', engineMomo.id), 'Rabbit zero should visibly strip captain status until Momo resynchronizes it');
    assert(engineMomo.maxHp === maxBeforeZero && engineMomo.currentHp === hpBeforeZero, 'Stripping captain text must not silently alter its source-scoped HP ledger');
    engine.initializeMomoTeams();
    assert(hasOwnedStatus(engineMomo, 'MOMO_CAPTAIN', engineMomo.id), 'Momo should restore captain status after an external dispel');
    assert(engineMomo.maxHp === maxBeforeZero && engineMomo.currentHp === hpBeforeZero, 'Restoring a dispelled captain status must not stack or heal 138 HP');
    cases.push('Momo captain HP bookkeeping survives Rabbit zero without stacking or healing');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const ally = makeFighter('舰长变身基准@A');
    const enemy = makeFighter('舰长变身敌人@B');
    const baseMaxHp = momo.maxHp;
    const { engine } = makeDeathEngine([momo, ally, enemy]);
    const engineMomo = engine.fighters[0];
    engine.initializeMomoTeams();
    enterPhaseTwo(engine, engineMomo);
    const expectedPhaseTwoMax = Math.max(3800, Math.min(4300, Math.floor(baseMaxHp * 6.2))) + MOMO_CAPTAIN_HP_BONUS;
    assert(engineMomo.maxHp === expectedPhaseTwoMax, `Phase-2 rebuild should exclude then restore the 138 captain bonus, expected ${expectedPhaseTwoMax}, got ${engineMomo.maxHp}`);
    for (let count = 0; count < 7; count += 1) registerMomoRiderKick(engine.createMomoRuntime(), engineMomo, '变身账本测试');
    const phaseTwoBase = expectedPhaseTwoMax - MOMO_CAPTAIN_HP_BONUS;
    const expectedPhaseThreeMax = Math.max(4500, Math.min(5100, Math.floor(phaseTwoBase * 1.22))) + MOMO_CAPTAIN_HP_BONUS;
    assert(engineMomo.maxHp === expectedPhaseThreeMax, `Phase-3 rebuild should restore the captain bonus exactly once, expected ${expectedPhaseThreeMax}, got ${engineMomo.maxHp}`);
    cases.push('Momo transformations rebuild base HP without baking in captain bonuses');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const sigua = makeFighter('丝瓜uli@A');
    const bunny = makeFighter('兔卷卷@B');
    const observer = makeFighter('摸鱼回归旁观者@C');
    const { engine, logs } = makeDeathEngine([momo, sigua, bunny, observer]);
    const engineMomo = engine.fighters[0];
    const engineSigua = engine.fighters[1];
    engine.initializeMomoTeams();
    addMomoCrowdJoy(engine.createMomoRuntime(), engineMomo, 50);
    const activeMaxHp = engineSigua.maxHp;
    const activeHp = engineSigua.currentHp;

    withRandomSequence([0.1, 0.1], () =>
      engine.executeSkillAction('slacking', engineSigua, engine.fighters[2]),
    );
    processMomoGlobalTick(engine.createMomoRuntime());
    assert(engineSigua.status.some((status) => status.type === 'SYNERGY_SLACKING'), 'Forced slacking roll should place Sigua off field');
    assert(!hasOwnedStatus(engineSigua, 'MOMO_CAPTAIN', engineMomo.id), 'Off-field OB should temporarily remove captain status');
    assert(hasOwnedStatus(engineSigua, 'MOMO_CROWD_JOY', engineMomo.id), 'Off-field OB must preserve source-scoped Crowd Joy');
    assert(engineSigua.maxHp === activeMaxHp - MOMO_CAPTAIN_HP_BONUS && engineSigua.currentHp === activeHp - MOMO_CAPTAIN_HP_BONUS, 'Off-field OB should suspend the captain HP bonus exactly once');
    processMomoActorTurnEnd(engine.createMomoRuntime(), engineSigua, false);
    assert(engineSigua.status.find((status) => status.type === 'MOMO_CROWD_JOY' && status.sourceId === engineMomo.id)?.stacks === 50, 'Off-field skipped turns must not decay preserved Crowd Joy');

    let settlementCount = 0;
    while (engineSigua.status.some((status) => status.type === 'SYNERGY_SLACKING') && settlementCount < 8) {
      engine.turnCount += 1;
      engine.finishStep({ current: false });
      settlementCount += 1;
    }
    assert(hasOwnedStatus(engineSigua, 'MOMO_CAPTAIN', engineMomo.id), 'Returning from OB should immediately restore captain status');
    assert(engineSigua.status.find((status) => status.type === 'MOMO_CROWD_JOY' && status.sourceId === engineMomo.id)?.stacks === 50, 'Returning from OB should retain the original Crowd Joy stacks');
    assert(engineSigua.maxHp === activeMaxHp && engineSigua.currentHp === activeHp, 'Returning from OB should restore, not duplicate, the suspended captain HP bonus');
    assert(settlementCount >= 5 && settlementCount <= 6, `Natural OB should last five global turns, settled after ${settlementCount}`);
    assert(logs.some((entry) => entry.text.includes('摸鱼时间结束') && entry.text.includes(engineSigua.name)), 'Natural OB return should retain its explicit return log');
    cases.push('Momo captain pauses during natural off-field OB and returns with Crowd Joy intact');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const blockedDecoy = makeFighter('错误抵挡候选@B');
    const actualTarget = makeFighter('沫沫强制攻击目标@C');
    blockedDecoy.status.push({ type: 'SPELL_BLOCK', duration: 1, sourceId: 'gamer_linken_sphere' });
    actualTarget.maxHp = 10000;
    localProject.setCurrentHp(actualTarget, 10000);
    const { engine } = makeDeathEngine([momo, blockedDecoy, actualTarget]);
    const engineMomo = engine.fighters[0];
    const engineDecoy = engine.fighters[1];
    const engineTarget = engine.fighters[2];
    engine.initializeMomoTeams();
    engineMomo.status.push({ type: 'AIM', duration: 1 });
    const targetHpBefore = engineTarget.currentHp;

    engine.executeSkillAction('momo_what_zone', engineMomo, engineTarget);
    assert(engineTarget.currentHp < targetHpBefore, 'Momo single-target damage should land on the target selected by the shared pipeline');
    assert(engineDecoy.status.some((status) => status.type === 'SPELL_BLOCK'), 'An unrelated target spell block must not cancel Momo attack setup');
    cases.push('Momo attacks use one shared target for selection, defense, and damage');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const owner = makeFighter('傀儡保护宿主@B');
    const puppet = makeFighter('沫沫规则测试傀儡');
    puppet.name = '小汀(傀儡)';
    puppet.displayName = puppet.name;
    puppet.summonBaseName = puppet.name;
    puppet.isSummon = true;
    puppet.summonerId = owner.id;
    puppet.maxHp = 10000;
    localProject.setCurrentHp(puppet, 10000);
    const { engine, logs } = makeDeathEngine([momo, owner, puppet]);
    const engineMomo = engine.fighters[0];
    const engineOwner = engine.fighters[1];
    const enginePuppet = engine.fighters[2];
    engine.initializeMomoTeams();
    engineMomo.status.push({ type: 'AIM', duration: 1 });
    const ownerHpBefore = engineOwner.currentHp;
    const puppetHpBefore = enginePuppet.currentHp;

    engine.executeSkillAction('momo_wps_pillar', engineMomo, engineOwner);
    assert(engineOwner.currentHp === ownerHpBefore && enginePuppet.currentHp < puppetHpBefore, 'Puppet Ting should intercept Momo single-target attacks through the shared target resolver');
    assert(logs.some((entry) => entry.text.includes('援护') && entry.text.includes('小汀(傀儡)')), 'Momo puppet interception should have an explicit causal log');
    cases.push('Momo attacks respect Puppet Ting interception');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const ethereal = makeFighter('沫沫虚无规则目标@B');
    ethereal.status.push({ type: 'ETHEREAL', duration: 2 });
    const { engine, logs } = makeDeathEngine([momo, ethereal]);
    const engineMomo = engine.fighters[0];
    const engineTarget = engine.fighters[1];
    engine.initializeMomoTeams();
    engineMomo.status.push({ type: 'AIM', duration: 1 });
    const hpBefore = engineTarget.currentHp;
    engine.executeSkillAction('momo_wps_pillar', engineMomo, engineTarget);
    assert(engineTarget.currentHp === hpBefore, 'Physical Momo attacks must not touch an ethereal target');
    assert(logs.some((entry) => entry.text.includes('物理攻击无法触碰')), 'Ethereal rejection should be logged for Momo attacks');
    cases.push('Momo physical attacks respect ethereal immunity');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const counterTarget = makeFighter('沫沫物理反击目标@B');
    counterTarget.maxHp = 10000;
    localProject.setCurrentHp(counterTarget, 10000);
    counterTarget.status.push({ type: 'COUNTER', duration: 2 });
    const { engine, logs } = makeDeathEngine([momo, counterTarget]);
    const engineMomo = engine.fighters[0];
    const engineTarget = engine.fighters[1];
    engine.initializeMomoTeams();
    engineMomo.status.push({ type: 'AIM', duration: 1 });
    const momoHpBefore = engineMomo.currentHp;
    const targetHpBefore = engineTarget.currentHp;
    engine.executeSkillAction('momo_what_zone', engineMomo, engineTarget);
    assert(engineTarget.currentHp < targetHpBefore && engineMomo.currentHp < momoHpBefore, 'Momo physical hits should deal damage and then receive COUNTER reflection');
    assert(logs.some((entry) => entry.text.includes('触发反击') && entry.text.includes('反弹伤害')), 'Momo physical reflection should have a complete counter log');
    cases.push('Momo attacks respect physical counter reflection');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const blocked = makeFighter('沫沫骑士踢抵挡目标@B');
    blocked.status.push({ type: 'SPELL_BLOCK', duration: 1, sourceId: 'gamer_linken_sphere' });
    const { engine } = makeDeathEngine([momo, blocked]);
    const engineMomo = engine.fighters[0];
    const engineTarget = engine.fighters[1];
    engine.initializeMomoTeams();
    const hpBefore = engineTarget.currentHp;
    engine.executeSkillAction('momo_345', engineMomo, engineTarget);
    assert(engineTarget.currentHp === hpBefore, 'Spell block should stop the Momo rider-kick impact');
    assert(engineMomo.momoState?.riderKickCount === 1, 'A blocked Momo rider-kick should still count as an attempted rider kick');
    assert(engineMomo.status.find((status) => status.type === 'MOMO_CROWD_JOY' && status.sourceId === engineMomo.id)?.stacks === 5, 'Rider-kick setup should grant its exact Crowd Joy before the block');
    cases.push('Momo rider-kick setup settles once even when spell-blocked');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const target = makeFighter('麦霸公共结算目标@B');
    const { engine } = makeDeathEngine([momo, target]);
    const engineMomo = engine.fighters[0];
    const engineTarget = engine.fighters[1];
    engine.initializeMomoTeams();
    engineMomo.status.push({ type: 'AIM', duration: 1 });
    const hpBefore = engineTarget.currentHp;
    const defBefore = engineTarget.def;
    engine.executeSkillAction('momo_mic_open', engineMomo, engineTarget);
    assert(engineTarget.currentHp === hpBefore, 'Momo Mic Open should be a true no-damage targeted utility skill');
    assert(engineTarget.status.some((status) => status.type === 'MOMO_MIC_DEF_DOWN'), 'Momo Mic Open should apply its named debuff after shared defenses');
    assert(engineTarget.def < defBefore, 'Momo Mic Open should apply its documented 22% defense penalty');
    cases.push('Momo Mic Open uses shared defenses without adding fake chip damage');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const captain = makeFighter('飓刃均摊舰长@A');
    const valo = makeFighter('丝瓜uli@B');
    const { engine, logs } = makeDeathEngine([momo, captain, valo]);
    const engineMomo = engine.fighters[0];
    const engineCaptain = engine.fighters[1];
    const engineValo = engine.fighters[2];
    engine.initializeMomoTeams();
    enterPhaseTwo(engine, engineMomo);
    localProject.setCurrentHp(engineValo, Math.max(1, Math.floor(engineValo.maxHp * 0.4)));
    engine.handleTransformations(engineValo);
    localProject.setCurrentHp(engineValo, engineValo.maxHp);
    assert(engineValo.job === 'VALO_JUNIOR', 'Valo |OMO reward test requires phase-2 Sigua');
    localProject.setCurrentHp(engineCaptain, 1);
    engineValo.status.push({ type: 'AIM', duration: 1 });

    engine.executeSkillAction('valo_ult_blade_storm', engineValo, engineMomo);
    assert(engineValo.stats.kills === 1, `A captain killed through |OMO should count for Valo, got ${engineValo.stats.kills}`);
    assert((engineValo.economy ?? 0) >= 3 && (engineValo.ultPoints ?? 0) >= 1 && (engineValo.crosshairFocus ?? 0) >= 1, 'A |OMO captain kill should grant Valo hit and kill economy');
    assert(logs.some((entry) => entry.text.includes('【飓刃】收割')), 'Blade Storm should refresh when its redirected |OMO damage defeats a captain');
    cases.push('Valo kill rewards and Blade Storm refresh follow |OMO defeated captains');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const captain = makeFighter('轨道炮均摊舰长@A');
    captain.maxHp = 50000;
    localProject.setCurrentHp(captain, 50000);
    const valo = makeFighter('丝瓜uli@B');
    const { engine, logs } = makeDeathEngine([momo, captain, valo]);
    const engineMomo = engine.fighters[0];
    const engineCaptain = engine.fighters[1];
    const engineValo = engine.fighters[2];
    engine.initializeMomoTeams();
    enterPhaseTwo(engine, engineMomo);
    localProject.setCurrentHp(engineValo, Math.max(1, Math.floor(engineValo.maxHp * 0.4)));
    engine.handleTransformations(engineValo);
    localProject.setCurrentHp(engineValo, engineValo.maxHp);
    engineValo.status.push({ type: 'AIM', duration: 1 });
    const momoHpBefore = engineMomo.currentHp;
    const captainHpBefore = engineCaptain.currentHp;

    engine.executeSkillAction('valo_ult_orbital_strike', engineValo, engineMomo);
    assert(engineMomo.currentHp === momoHpBefore && engineCaptain.currentHp < captainHpBefore, 'Orbital strike should redistribute through |OMO without damaging Momo herself');
    assert(!logs.some((entry) => entry.text.includes('【天降以此】火力过剩')), 'Momo HP must not be used to invent false orbital overflow after |OMO redistribution');
    cases.push('Valo orbital overflow does not misread |OMO redistributed damage');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const captain = makeFighter('状态均摊舰长@A');
    captain.maxHp = 50000;
    localProject.setCurrentHp(captain, 50000);
    const attacker = makeFighter('状态均摊攻击者@B');
    const { engine, logs } = makeDeathEngine([momo, captain, attacker]);
    const engineMomo = engine.fighters[0];
    const engineCaptain = engine.fighters[1];
    const engineAttacker = engine.fighters[2];
    engine.initializeMomoTeams();
    enterPhaseTwo(engine, engineMomo);
    engineAttacker.status.push({ type: 'AIM', duration: 1 });

    engine.executeSkillAction('bash', engineAttacker, engineMomo);
    assert(logs.some((entry) => entry.text.includes('状态结算') && entry.text.includes('不会跟随伤害转移')), 'A redirected hostile status should explicitly explain why it did not land');
    logs.splice(0, logs.length);
    engineMomo.status.push({ type: 'BURN', duration: 2, applierId: engineAttacker.id, applierName: engineAttacker.name });
    const momoHpBefore = engineMomo.currentHp;
    const captainHpBefore = engineCaptain.currentHp;
    engine.processStatusTurn(engineMomo);
    assert(engineMomo.currentHp === momoHpBefore && engineCaptain.currentHp < captainHpBefore, 'Momo DOT should redistribute to active captains through |OMO');
    assert(logs.some((entry) => entry.text.includes('触发【|OMO】') && entry.text.includes('本体未受伤')), 'Redirected DOT should log the actual |OMO outcome');
    assert(!logs.some((entry) => entry.text.includes('没有穿透防护')), 'Redirected DOT must not be mislabeled as fully blocked');
    cases.push('Momo redirected statuses and DOT logs state their real outcomes');
  }

  {
    const momo = makeFighter('萌月沫沫@A');
    const target = makeFighter('十连日志高血量目标@B');
    target.maxHp = 1000000;
    localProject.setCurrentHp(target, 1000000);
    target.agl = 0;
    target.jobData.skills = [];
    const { engine, logs } = makeDeathEngine([momo, target]);
    const engineMomo = engine.fighters[0];
    engine.initializeMomoTeams();
    const rolls = [...Array(10).fill(0.985), ...Array(100).fill(0.1)];
    withRandomSequence(rolls, () => engine.executeSkillAction('momo_ten_pull', engineMomo, engine.fighters[1]));
    const revealIndex = logs.findIndex((entry) => entry.text.includes('现在开始逐项结算'));
    const firstSealImpact = logs.findIndex((entry) => entry.text.includes('亮出【神驹宝玺】'));
    assert(revealIndex >= 0 && firstSealImpact > revealIndex, 'Ten-pull prize reveal must appear before any seal damage or death settlement');
    assert(logs.some((entry) => entry.text.includes('【十连结算】')), 'Ten-pull should finish with a separate actual recovery and cleanse settlement');
    cases.push('Momo ten-pull reveals prizes before resolving offensive rewards');
  }

  {
    const ordinary = makeFighter('非沫沫状态污染检查@A');
    const enemy = makeFighter('非沫沫状态污染敌人@B');
    const { engine } = makeDeathEngine([ordinary, enemy]);
    localProject.setCurrentHp(engine.fighters[0], Math.max(1, Math.floor(engine.fighters[0].maxHp * 0.4)));
    engine.handleTransformations(engine.fighters[0]);
    assert(engine.fighters[0].momoState === undefined, 'Momo transform hook must not create Momo state on unrelated fighters');
    cases.push('Momo hooks do not pollute unrelated fighter state');
  }

  return cases;
}
