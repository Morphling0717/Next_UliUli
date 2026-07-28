import { spawnOwlFurrySquad } from '../../../lib/namearena/owlMechanics';
import {
  addOriginiumInfection,
  getActiveOriginiumCrystals,
  getOriginiumInfectionStacks,
  getPuruisaishiBarrierTotal,
  grantPuruisaishiBarrier,
  ORIGINIUM_CRYSTAL_MAX_COUNT,
  ORIGINIUM_DISEASE_STATUS,
  ORIGINIUM_MAX_STACKS,
  PURUISAISHI_BARRIER_IDENTITY,
  spawnPuruisaishiEvent,
  trySpawnOriginiumCrystal,
} from '../../../lib/namearena/puruisaishiMechanics';
import { resolveTarget } from '../../../lib/namearena/targeting';
import {
  enterYuzuProphetPhaseTwo,
  eraseLowestOriginiumCrystalForProphet,
  getActiveYuzuProphetControlledSummons,
  isYuzuProphetControlledSummon,
  retreatYuzuProphetEvent,
  trySpawnYuzuProphet,
  YUZU_PROPHET_EVENT_TEAM,
  YUZU_PROPHET_PHASE_ONE_STATS,
  YUZU_PROPHET_PHASE_TWO_STATS,
  YUZU_PROPHET_SKILLS,
} from '../../../lib/namearena/yuzuProphetMechanics';
import { GACHA_SURTR_CARD } from '../../../lib/namearena/gachaMechanics';
import { hasIdentity, removeBarriers } from '../../../lib/namearena/statusSystem';
import type { Fighter } from '../../../lib/namearena/types';
import {
  applyTestStatus,
  assert,
  localProject,
  makeFighter,
  withRandomSequence,
  type BattleEngineInstance,
  type LogEntry,
} from '../shared/harness';
import { makeDeathEngine } from './deathAccountingCases';

type ProphetTestEngine = {
  selectYuzuProphetPlayerTarget: (prophet: Fighter) => Fighter | undefined;
  executeYuzuProphetPhaseTwoClash: (
    prophet: Fighter,
    skillId: string,
    target: Fighter,
  ) => boolean;
  executeYuzuProphetUnderstandPuruisaishi: (
    prophet: Fighter,
    triggerDepth: number,
  ) => void;
  previewYuzuProphetOriginiumPlan: (prophet: Fighter) => string[];
  executeYuzuProphetPhaseTwoTurn: (prophet: Fighter) => boolean;
};

type ProphetFixture = {
  engine: BattleEngineInstance;
  logs: LogEntry[];
  prophet: Fighter;
  yuzu: Fighter;
  puruisaishi: Fighter;
};

function makeOwlSummon(
  name: string,
  owner: Fighter,
  kind: 'swire' | 'linlang_swire' | 'specter' | 'spalter' = 'swire',
): Fighter {
  const summon = makeFighter(`${name}@${owner.teamId ?? owner.id}`);
  summon.name = name;
  summon.displayName = name;
  summon.isSummon = true;
  summon.isAdvancedSummon = true;
  summon.summonerId = owner.id;
  summon.teamId = owner.teamId;
  summon.cannotWin = true;
  summon.owlSummonState = { kind, spawnedTurn: 0 };
  return summon;
}

function spawnProphetFixture(
  names: string[] = ['柚子@A', '预言家测试敌人@B', '预言家测试旁观者@C'],
  extraFighters: Fighter[] = [],
): ProphetFixture {
  const fighters = [...names.map(makeFighter), ...extraFighters];
  const { engine, logs } = makeDeathEngine(fighters);
  const yuzu = engine.fighters.find((fighter) => fighter.isYuzu);
  assert(yuzu, 'Prophet fixture requires an active Yuzu');
  const puruisaishi = spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '预言家回归测试强制出场');
  puruisaishi.puruisaishiPhase = 2;
  puruisaishi.puruisaishiPhaseTwoStartedTurn = engine.turnCount;
  delete puruisaishi.untargetableUntilTurn;
  grantPuruisaishiBarrier(puruisaishi, 6000, '预言家回归测试');
  const prophet = withRandomSequence([0], () =>
    trySpawnYuzuProphet(engine.createYuzuProphetRuntime(), puruisaishi, { force: true }),
  );
  assert(prophet, 'Forced Yuzu Prophet spawn should succeed');
  return { engine, logs, prophet, yuzu, puruisaishi };
}

function enterPhaseTwo(fixture: ProphetFixture, reason = '预言家回归测试强制转阶段'): void {
  const entered = enterYuzuProphetPhaseTwo(
    fixture.engine.createYuzuProphetRuntime(),
    fixture.prophet,
    reason,
  );
  assert(entered, 'Prophet should enter phase two in the fixture');
}

function activeCrystals(engine: BattleEngineInstance): Fighter[] {
  return getActiveOriginiumCrystals(engine.createPuruisaishiRuntime());
}

export function runYuzuProphetCases(): string[] {
  const cases: string[] = [];

  {
    const noYuzu = makeFighter('预言家缺席测试者@A');
    const { engine, logs } = makeDeathEngine([noYuzu]);
    const puruisaishi = spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '无柚子登场测试');
    puruisaishi.puruisaishiPhase = 2;

    const first = trySpawnYuzuProphet(engine.createYuzuProphetRuntime(), puruisaishi, { force: true });
    assert(!first, 'Prophet must not spawn without an active Yuzu');
    assert(puruisaishi.yuzuProphetSpawnChecked, 'Failed no-Yuzu check must consume the only spawn check');
    const lateYuzu = makeFighter('柚子@B');
    engine.fighters.push(lateYuzu);
    const retry = trySpawnYuzuProphet(engine.createYuzuProphetRuntime(), puruisaishi, { force: true });
    assert(!retry, 'Prophet spawn must never retry after the first check');
    assert(logs.filter((entry) => entry.text.includes('预言家登场判定')).length === 1, 'No-Yuzu spawn failure should log exactly once');
    cases.push('Prophet spawn check is one-shot and requires an active Yuzu');
  }

  {
    const { engine, logs, prophet, yuzu, puruisaishi } = spawnProphetFixture();
    const synthetic = engine.fighters.find((fighter) =>
      fighter.isSurtr && fighter.yuzuProphetControlState?.synthetic,
    );
    assert(prophet.yuzuProphetState?.boundYuzuId === yuzu.id, 'Forced spawn should bind the only Yuzu');
    assert(yuzu.yuzuMarkedTargetId === prophet.id, 'Prophet should overwrite Yuzu mark target');
    assert(hasIdentity(prophet, 'YUZU_MARKED'), 'Prophet should carry the bound Yuzu mark');
    assert(prophet.maxHp === YUZU_PROPHET_PHASE_ONE_STATS.hp, 'Phase-one HP must use fixed Prophet stats');
    assert(prophet.mag === YUZU_PROPHET_PHASE_ONE_STATS.mag, 'Phase-one MAG must use fixed Prophet stats');
    assert(prophet.isNpc && prophet.cannotWin, 'Prophet must be an acting non-winning NPC');
    assert(synthetic, 'Prophet should create fallback Surtr when no eligible summon exists');
    assert(isYuzuProphetControlledSummon(synthetic, prophet.id), 'Fallback Surtr should immediately be controlled');
    assert(synthetic.surtrState?.ownershipSuspended, 'Fallback Surtr must not expose ordinary owner relations');
    assert(puruisaishi.yuzuProphetAppeared, 'Puruisaishi should remember that Prophet appeared');
    assert(!trySpawnYuzuProphet(engine.createYuzuProphetRuntime(), puruisaishi, { force: true }), 'A second Prophet must never spawn');
    assert(logs.some((entry) => entry.text.includes('【柚子·预言家登场】')), 'Successful spawn needs an explicit entrance log');
    assert(logs.some((entry) => entry.text.includes('【预言家保底召唤】')), 'Fallback Surtr needs an explicit log');
    cases.push('Prophet spawn fixes stats, mark, NPC state, and fallback Surtr exactly once');
  }

  {
    const owner = makeFighter('鸮@O');
    const summon = makeOwlSummon('诗怀雅测试体', owner, 'swire');
    summon.currentHp = Math.max(1, summon.currentHp - 37);
    applyTestStatus(summon, { identityId: 'BURN', count: 3 });
    const beforeHp = summon.currentHp;
    const { engine, prophet } = spawnProphetFixture(
      ['柚子@A', '接管测试敌人@B', '接管测试旁观者@C'],
      [owner, summon],
    );
    const engineOwner = engine.fighters.find((fighter) => fighter.id === owner.id)!;
    const controlled = engine.fighters.find((fighter) => fighter.id === summon.id)!;

    assert(!engine.fighters.some((fighter) => fighter.isSurtr), 'Existing eligible summon should suppress fallback Surtr');
    assert(controlled.currentHp === beforeHp && hasIdentity(controlled, 'BURN'), 'Takeover must preserve HP and statuses');
    assert(controlled.summonerId === prophet.id && controlled.teamId === YUZU_PROPHET_EVENT_TEAM, 'Takeover should detach owner and move summon to event team');
    assert(controlled.yuzuProphetControlState?.originalSummonerId === engineOwner.id, 'Takeover must retain original owner for return');
    cases.push('Prophet takeover preserves summon state and records the original owner without fallback duplication');
  }

  {
    const { engine, logs, prophet } = spawnProphetFixture([
      '柚子@A',
      '牢鳄@G',
      '鸮@O',
      '即时接管测试敌人@B',
    ]);
    const gacha = engine.fighters.find((fighter) => fighter.isGacha)!;
    const owl = engine.fighters.find((fighter) => fighter.isOwl)!;
    owl.maxHp = 50000;
    localProject.setCurrentHp(owl, 20000);
    engine.handleTransformations(owl);
    const furry = spawnOwlFurrySquad(engine.createOwlRuntime(), owl);

    assert(furry.length === 4, 'Owl fixture should create four Arknights summons');
    assert(
      furry.every((summon) => isYuzuProphetControlledSummon(summon, prophet.id)),
      'Every Owl summon must be controlled at the exact creation callback',
    );
    const surtrCountBefore = engine.fighters.filter((fighter) => fighter.isSurtr).length;
    engine.executeSummonSkill({
      name: '预言家接管期间的史尔特尔上级召唤测试',
      tag: 'special',
      ...GACHA_SURTR_CARD,
    }, gacha, engine.getTeamId(gacha));
    assert(
      engine.fighters.filter((fighter) => fighter.isSurtr).length === surtrCountBefore,
      'Controlled Swire and Specter must not be valid Surtr tribute materials',
    );
    assert(
      logs.filter((entry) => entry.text.includes('【预言家接管】') && entry.text.includes('新的鸮召唤物完成召唤')).length === 4,
      'Each new Owl summon should receive its own immediate takeover log',
    );
    cases.push('New Owl summons are captured immediately and cannot be used as Surtr tributes');
  }

  {
    const { engine, logs, prophet, yuzu } = spawnProphetFixture();
    const outsider = engine.fighters.find((fighter) => !fighter.isNpc && fighter.id !== yuzu.id)!;
    const hpBefore = prophet.currentHp;
    const blockedDamage = engine.applyDamage(prophet, 500, 'skill', false, outsider, { actionName: '非绑定来源测试' });
    assert(blockedDamage === 0 && prophet.currentHp === hpBefore, 'Non-bound direct damage must be rejected');
    assert(
      !engine.applyStatus(prophet, {
        identityId: 'WEAK',
        remainingTurns: 2,
        attribution: { applierId: outsider.id, applierName: outsider.name },
      }),
      'Non-bound hostile status must be rejected',
    );
    applyTestStatus(prophet, { identityId: 'REGEN', remainingTurns: 3 });
    engine.executeSkillAction('nullifier', outsider, prophet);
    assert(hasIdentity(prophet, 'REGEN'), 'Non-bound absolute dispel must be cancelled before it consumes defenses');

    localProject.setCurrentHp(prophet, 0);
    assert(!engine.markDefeated(prophet, { killer: outsider }), 'Non-bound forced defeat must be rejected');
    assert(prophet.currentHp === 1 && !prophet.yuzuProphetState?.retreatCompleted, 'Rejected forced defeat should restore Prophet to one HP');

    localProject.setCurrentHp(prophet, hpBefore);
    const acceptedDamage = engine.applyDamage(prophet, 200, 'skill', false, yuzu, { actionName: '绑定来源测试' });
    assert(acceptedDamage > 0 && prophet.currentHp < hpBefore, 'Bound Yuzu damage must pass source immunity');
    assert(
      engine.applyStatus(prophet, {
        identityId: 'WEAK',
        remainingTurns: 2,
        attribution: { applierId: yuzu.id, applierName: yuzu.name },
      }),
      'Bound Yuzu hostile status must pass source immunity',
    );
    assert(logs.filter((entry) => entry.text.includes('【绑定来源免疫】')).length >= 4, 'Every rejected source branch needs explicit context');
    cases.push('Source immunity rejects non-bound damage, status, dispel, and defeat while accepting bound Yuzu effects');
  }

  {
    const { engine, logs, prophet, yuzu } = spawnProphetFixture();
    localProject.setCurrentHp(yuzu, 0);
    yuzu.isDead = true;
    yuzu.isDeadAnnounced = true;

    const gained = addOriginiumInfection(
      engine.createPuruisaishiRuntime(),
      prophet,
      ORIGINIUM_MAX_STACKS,
      '预言家矿石病免疫回归测试',
    );
    const directApplied = engine.applyStatus(prophet, {
      identityId: ORIGINIUM_DISEASE_STATUS,
      potency: 10,
      attribution: { effectSourceId: 'regression_originium', effectSourceName: '回归测试源石' },
    });

    assert(gained === 0 && !directApplied, 'Prophet must reject Originium infection through both mechanic and generic status entrypoints');
    assert(getOriginiumInfectionStacks(prophet) === 0, 'Prophet must never retain Originium infection');
    assert(!prophet.yuzuProphetState?.retreatCompleted, 'Rejected Originium infection must not retreat the Prophet');
    assert(logs.some((entry) => entry.text.includes('【源石同源】')), 'Generic infection rejection should explain the permanent immunity');

    localProject.setCurrentHp(prophet, 0);
    engine.markDefeated(prophet, {
      causeName: '战场崩塌',
      message: '💀 【测试】战场崩塌令预言家生命归零。',
      awardKill: false,
    });
    const retreatLog = logs.find((entry) => entry.text.includes('【预言家共同退场启动】'))?.text ?? '';
    assert(prophet.yuzuProphetState?.retreatCompleted, 'A legal environmental lethal effect should retreat the unbound Prophet');
    assert(retreatLog.includes('战场崩塌'), 'Environmental retreat must retain its player-facing cause');
    assert(!retreatLog.includes('无归属效果') && !retreatLog.includes('未知效果'), 'Environmental retreat must not lose its cause');
    cases.push('Prophet permanently rejects Originium infection while legal environmental retreat preserves its cause');
  }

  {
    const { engine, prophet, yuzu } = spawnProphetFixture([
      '柚子@A',
      '柚子@C',
      '优先级测试敌人@B',
    ]);
    const otherYuzu = engine.fighters.find((fighter) => fighter.isYuzu && fighter.id !== yuzu.id)!;
    applyTestStatus(otherYuzu, { identityId: 'YUZU_TAUNT', remainingTurns: 2 });
    const puppet = makeFighter('小汀(傀儡)@A');
    puppet.isSummon = true;
    puppet.summonerId = yuzu.id;
    puppet.teamId = yuzu.teamId;
    puppet.cannotWin = true;
    engine.fighters.push(puppet);

    const normalSelection = resolveTarget(
      engine.createTargetingRuntime(),
      prophet,
      null,
      engine.getSelectableTargets(prophet),
    );
    assert(normalSelection?.protectedTarget?.id === yuzu.id, 'Prophet priority should choose bound Yuzu despite another Yuzu taunt');
    assert(normalSelection?.target.id === puppet.id, 'Puppet interception must still redirect the selected bound Yuzu');

    const forcedSelection = resolveTarget(
      engine.createTargetingRuntime(),
      prophet,
      otherYuzu,
      engine.getSelectableTargets(prophet),
    );
    assert(forcedSelection?.target.id === otherYuzu.id, 'An explicit legal forced target must outrank Prophet priority');

    enterPhaseTwo({ engine, logs: [], prophet, yuzu, puruisaishi: engine.fighters.find((fighter) => fighter.isPuruisaishi)! });
    applyTestStatus(prophet, {
      identityId: 'CHARMED',
      remainingTurns: 2,
      attribution: { applierId: yuzu.id, applierName: yuzu.name },
    });
    const selectedWhileCharmed = (engine as unknown as ProphetTestEngine).selectYuzuProphetPlayerTarget(prophet);
    assert(selectedWhileCharmed && selectedWhileCharmed.id !== yuzu.id, 'Charm must remove its source from Prophet custom target selection when alternatives exist');
    cases.push('Prophet priority ignores taunt but still obeys forced targets, puppet interception, and charm legality');
  }

  {
    const owner = makeFighter('鸮@O');
    const swire = makeOwlSummon('诗怀雅死亡测试体', owner, 'swire');
    swire.maxHp = 100;
    localProject.setCurrentHp(swire, 100);
    const { engine, logs, prophet } = spawnProphetFixture(
      ['柚子@A', '接管死亡击杀者@B', '接管死亡旁观者@C'],
      [owner, swire],
    );
    const killer = engine.fighters.find((fighter) => fighter.name.includes('接管死亡击杀者'))!;
    const controlled = engine.fighters.find((fighter) => fighter.id === swire.id)!;
    killer.atk = 10000;
    applyTestStatus(killer, { identityId: 'AIM', charges: 1 });
    const crystalsBefore = activeCrystals(engine).length;

    engine.executeSkillAction('serious_punch', killer, controlled);
    engine.handleDeathsAndRevives({ current: false });

    assert(controlled.isDead && controlled.currentHp === 0, 'Controlled ordinary summon should complete a real death');
    assert(controlled.yuzuProphetControlState?.disposition === 'withdrawn', 'Dead controlled summon should leave Prophet control');
    assert(killer.stats.kills === 1, 'Real controlled summon death should award its ordinary kill exactly once');
    assert(activeCrystals(engine).length === crystalsBefore + 1, 'Real controlled summon death should generate one dedicated crystal');
    assert(
      getActiveYuzuProphetControlledSummons(engine.createYuzuProphetRuntime(), prophet).length === 0,
      'The dead summon must no longer count as controlled',
    );
    const conversionIndex = logs.findIndex((entry) => entry.text.includes('【接管召唤物死亡转化】'));
    const defeatIndex = logs.findIndex((entry) => entry.text.includes(controlled.name) && entry.text.includes('击败'));
    assert(conversionIndex >= 0 && defeatIndex >= 0 && conversionIndex > defeatIndex, 'Death conversion log must follow the real defeat log');
    cases.push('Controlled summon real death settles kill and death context before exactly one dedicated crystal conversion');
  }

  {
    const owner = makeFighter('鸮@O');
    const surtr = makeOwlSummon('史尔特尔接管测试体', owner, 'swire');
    surtr.isSurtr = true;
    surtr.summonBaseName = '史尔特尔';
    surtr.surtrState = {
      primaryOwnerId: owner.id,
      primaryOwnerTeamId: owner.teamId ?? owner.id,
      twilightUsed: true,
      twilightDrainOpportunities: 7,
      afterglowActive: true,
      afterglowOpportunities: 6,
      actualKills: 2,
      ownershipSuspended: false,
      lastAffiliationMode: 'same_team',
    };
    localProject.setCurrentHp(surtr, 1);
    const specter = makeOwlSummon('幽灵鲨接管测试体', owner, 'specter');
    const { engine, logs, prophet } = spawnProphetFixture(
      ['柚子@A', '抹杀测试敌人@B', '抹杀测试旁观者@C'],
      [owner, surtr, specter],
    );
    const controlledBefore = getActiveYuzuProphetControlledSummons(engine.createYuzuProphetRuntime(), prophet);
    assert(controlledBefore.length === 2, 'Erasure fixture should begin with two controlled summons');
    while (activeCrystals(engine).length < ORIGINIUM_CRYSTAL_MAX_COUNT) {
      trySpawnOriginiumCrystal(engine.createPuruisaishiRuntime(), prophet.id, '抹杀上限回归测试');
    }
    const ownerKillsBefore = engine.fighters.find((fighter) => fighter.id === owner.id)!.stats.kills;

    assert(
      enterYuzuProphetPhaseTwo(engine.createYuzuProphetRuntime(), prophet, '抹杀与结晶上限回归测试'),
      'Prophet should enter phase two',
    );
    for (const controlled of controlledBefore) {
      assert(controlled.isDead && controlled.currentHp === 0, 'Phase transition erasure must remove every controlled summon');
      assert(controlled.yuzuProphetControlState?.disposition === 'erased', 'Erased summon should retain explicit disposition');
      assert(controlled.defeatHooksResolved, 'Erasure must pre-resolve and bypass all ordinary death hooks');
    }
    const controlledSurtr = controlledBefore.find((fighter) => fighter.isSurtr);
    assert(controlledSurtr && !controlledSurtr.surtrState?.afterglowActive, 'Erasure must bypass and clear Surtr afterglow');
    assert(engine.fighters.find((fighter) => fighter.id === owner.id)!.stats.kills === ownerKillsBefore, 'Erasure must not award kills');
    assert(activeCrystals(engine).length === ORIGINIUM_CRYSTAL_MAX_COUNT, 'Erasure must never exceed the crystal cap');
    assert(
      logs.filter((entry) => entry.text.includes('【阶段抹杀】')).length === 2 &&
      logs.filter((entry) => entry.text.includes('【源石网络已达上限】')).length >= 2,
      'Each erased summon and each cap-blocked crystal needs its own log',
    );
    assert(prophet.maxHp === YUZU_PROPHET_PHASE_TWO_STATS.hp, 'Phase-two max HP should be rebuilt exactly');
    assert(prophet.currentHp >= YUZU_PROPHET_PHASE_TWO_STATS.hpFloor, 'Phase-two current HP should respect its floor');
    assert(
      retreatYuzuProphetEvent(engine.createYuzuProphetRuntime(), prophet, '二阶段退场文案回归测试') &&
      logs.some((entry) =>
        entry.text.includes('【共同退场完成】') &&
        entry.text.includes('二阶段开始时被接管的召唤物均已抹杀') &&
        !entry.text.includes('一阶段幸存召唤物'),
      ),
      'Phase-two retreat log must describe erasure instead of phase-one control return',
    );
    cases.push('Phase transition erases summons cleanly and its retreat log never claims phase-one control return');
  }

  {
    const fixture = spawnProphetFixture();
    enterPhaseTwo(fixture);
    const crystal = activeCrystals(fixture.engine)[0];
    assert(crystal, 'Synthetic Surtr erasure should provide a crystal for pre-cost tests');
    const target = fixture.yuzu;
    target.jobData = { ...target.jobData!, skills: ['serious_punch'] };
    target.atk = 200;
    target.wis = 10000;
    const internal = fixture.engine as unknown as ProphetTestEngine;

    withRandomSequence([0, 0.999, 0.999, 0, 0], () => {
      internal.executeYuzuProphetPhaseTwoClash(
        fixture.prophet,
        YUZU_PROPHET_SKILLS.originiumLand,
        target,
      );
    });
    assert(!fixture.engine.isActiveCombatant(crystal), 'Originium Land crystal cost must be paid before the clash');
    assert(getOriginiumInfectionStacks(target) === 0, 'Prophet losing the clash must cancel Originium Land effects');
    assert(fixture.logs.some((entry) => entry.text.includes('拼点失败也不会返还')), 'Crystal non-refund must be explicit in logs');
    cases.push('Originium Land pays its crystal before clash and never refunds it on loss');
  }

  {
    const fixture = spawnProphetFixture();
    enterPhaseTwo(fixture);
    const target = fixture.yuzu;
    target.jobData = { ...target.jobData!, skills: ['serious_punch'] };
    target.atk = 200;
    target.wis = 10000;
    const barrierBefore = getPuruisaishiBarrierTotal(fixture.puruisaishi);
    const internal = fixture.engine as unknown as ProphetTestEngine;

    withRandomSequence([0, 0.999, 0.999, 0.999, 0, 0], () => {
      internal.executeYuzuProphetPhaseTwoClash(
        fixture.prophet,
        YUZU_PROPHET_SKILLS.understandPuruisaishi,
        target,
      );
    });
    assert(
      getPuruisaishiBarrierTotal(fixture.puruisaishi) === barrierBefore + 300,
      'Understand Puruisaishi barrier must remain after Prophet loses the clash',
    );
    assert(fixture.logs.some((entry) => entry.text.includes('即使拼点失败也不会撤回')), 'Barrier non-refund must be explicit in logs');
    cases.push('Understand Puruisaishi grants its 300 barrier before clash and keeps it on loss');
  }

  {
    const winFixture = spawnProphetFixture();
    enterPhaseTwo(winFixture);
    eraseLowestOriginiumCrystalForProphet(winFixture.engine.createYuzuProphetRuntime(), winFixture.prophet);
    localProject.setCurrentHp(winFixture.yuzu, 0);
    winFixture.yuzu.isDead = true;
    winFixture.yuzu.isDeadAnnounced = true;
    const winAttacker = winFixture.engine.fighters.find((fighter) =>
      !fighter.isNpc && fighter.id !== winFixture.yuzu.id,
    )!;
    winAttacker.atk = 200;
    winAttacker.wis = 10000;
    applyTestStatus(winAttacker, { identityId: 'AIM', charges: 1 });
    const hpBeforeWin = winFixture.prophet.currentHp;
    withRandomSequence([0, 0, 0, 0.999], () => {
      winFixture.engine.executeSkillAction('serious_punch', winAttacker, winFixture.prophet);
    });
    assert(winFixture.prophet.currentHp === hpBeforeWin, 'Prophet defensive clash win should cancel the whole incoming branch');
    assert(winFixture.logs.some((entry) => entry.text.includes('【拼点裁定·整枝闪避】')), 'Defensive win needs whole-branch dodge context');

    const loseFixture = spawnProphetFixture();
    enterPhaseTwo(loseFixture);
    eraseLowestOriginiumCrystalForProphet(loseFixture.engine.createYuzuProphetRuntime(), loseFixture.prophet);
    localProject.setCurrentHp(loseFixture.yuzu, 0);
    loseFixture.yuzu.isDead = true;
    loseFixture.yuzu.isDeadAnnounced = true;
    const loseAttacker = loseFixture.engine.fighters.find((fighter) =>
      !fighter.isNpc && fighter.id !== loseFixture.yuzu.id,
    )!;
    loseAttacker.atk = 200;
    loseAttacker.wis = 10000;
    applyTestStatus(loseAttacker, { identityId: 'AIM', charges: 1 });
    const hpBeforeLoss = loseFixture.prophet.currentHp;
    withRandomSequence([0.999, 0.999, 0.999, 0, 0], () => {
      loseFixture.engine.executeSkillAction('serious_punch', loseAttacker, loseFixture.prophet);
    });
    const loss = hpBeforeLoss - loseFixture.prophet.currentHp;
    assert(loss > 0, 'Attacker winning defensive clash should still release its skill');
    assert(loseFixture.logs.some((entry) => entry.text.includes('【拼点失败减伤】')), 'Defensive loss needs an explicit multiplicative half-damage log');
    cases.push('Phase-two defense cancels an entire branch on win and applies post-mitigation 50% damage on loss');
  }

  {
    const fixture = spawnProphetFixture([
      '柚子@A',
      '源石公式目标@B',
      '源石公式旁观者@C',
    ]);
    enterPhaseTwo(fixture);
    const target = fixture.engine.fighters.find((fighter) => fighter.name.includes('源石公式目标'))!;
    target.maxHp = 10000;
    localProject.setCurrentHp(target, 10000);
    target.res = 200;
    const unblocked = fixture.engine.fighters.find((fighter) => fighter.name.includes('源石公式旁观者'))!;
    unblocked.maxHp = 10000;
    localProject.setCurrentHp(unblocked, 10000);
    fixture.prophet.critRate = 0;
    fixture.prophet.agl = 0;
    const understand = fixture.engine.SKILLS.yuzu_prophet_understand_hit;
    const execute = fixture.engine.SKILLS.yuzu_prophet_execute_hit;
    assert(understand && execute, 'Prophet hidden damage skills must be registered');
    const expectedUnderstand = Math.floor(fixture.prophet.mag * 1.25 + target.maxHp * 0.035 - target.res * 0.35);
    const expectedExecute = Math.floor(fixture.prophet.mag * 2.25 + target.maxHp * 0.1 - target.res * 0.3);
    const understandDamage = withRandomSequence([0.999], () =>
      fixture.engine.calculateDamage(
        fixture.prophet,
        target,
        understand,
        fixture.engine.getTeamId(fixture.prophet),
        'yuzu_prophet_understand_hit',
      ).dmg,
    );
    const executeDamage = withRandomSequence([0], () =>
      fixture.engine.calculateDamage(
        fixture.prophet,
        target,
        execute,
        fixture.engine.getTeamId(fixture.prophet),
        'yuzu_prophet_execute_hit',
      ).dmg,
    );
    assert(understandDamage === expectedUnderstand, 'Understand formula must have no ordinary damage variance');
    assert(executeDamage === expectedExecute, 'Execution formula must have no variance and cannot crit');

    applyTestStatus(target, { identityId: 'SPELL_BLOCK', charges: 1 });
    const internal = fixture.engine as unknown as ProphetTestEngine;
    withRandomSequence([0.999, 0.999, 0.999], () => {
      internal.executeYuzuProphetUnderstandPuruisaishi(fixture.prophet, 1);
    });
    assert(!hasIdentity(target, 'SINKING') && getOriginiumInfectionStacks(target) === 0, 'A fully cancelled AOE branch must not receive statuses');
    assert(
      hasIdentity(unblocked, 'SINKING') && getOriginiumInfectionStacks(unblocked) === 15,
      'Connected AOE branches should receive exact infection and Sinking',
    );
    cases.push('Prophet damage formulas are exact and AOE statuses only follow a connected branch');
  }

  {
    const fixture = spawnProphetFixture([
      '柚子@A',
      '源石计划斩杀目标@B',
      '源石计划安全目标@C',
      '源石计划旁观者@D',
    ]);
    enterPhaseTwo(fixture);
    localProject.setCurrentHp(fixture.yuzu, 0);
    fixture.yuzu.isDead = true;
    fixture.yuzu.isDeadAnnounced = true;
    const doomed = fixture.engine.fighters.find((fighter) => fighter.name.includes('源石计划斩杀目标'))!;
    doomed.maxHp = 1000;
    doomed.res = 0;
    localProject.setCurrentHp(doomed, 100);
    const safe = fixture.engine.fighters.find((fighter) => fighter.name.includes('源石计划安全目标'))!;
    safe.maxHp = 10000;
    localProject.setCurrentHp(safe, 10000);
    const internal = fixture.engine as unknown as ProphetTestEngine;
    const preview = internal.previewYuzuProphetOriginiumPlan(fixture.prophet);
    assert(preview.includes(doomed.name), 'Execution preview should identify a strictly lethal target');
    assert(!preview.includes(safe.name), 'Execution preview should not identify a surviving target');

    withRandomSequence([0.1, 0.7, 0.3, 0.9, 0.5], () => {
      internal.executeYuzuProphetPhaseTwoTurn(fixture.prophet);
    });
    assert(doomed.isDead || doomed.isDeadAnnounced || doomed.currentHp <= 0, 'Execution plan should formally defeat the predicted target');
    assert(fixture.logs.some((entry) => entry.text.includes('【斩杀预判成立】') && entry.text.includes(doomed.name)), 'Prediction log must name the executable target');
    assert(fixture.logs.some((entry) => entry.text.includes('【必须执行源石计划】') && entry.text.includes('正式结算顺序')), 'Formal execution order must be logged');
    assert(
      fixture.logs.some((entry) => entry.text.includes('成功命中并击败') && entry.text.includes(doomed.name)) &&
      !fixture.logs.some((entry) => entry.text.includes(doomed.name) && entry.text.includes('受击分支被完全取消')),
      'A lethal connected branch must not be mislabeled as fully cancelled',
    );
    cases.push('Execution preview names a genuinely lethal target and formal resolution logs its randomized order');
  }

  {
    const owner = makeFighter('鸮@O');
    const summon = makeOwlSummon('控制权返还测试体', owner, 'spalter');
    const { engine, logs, prophet, yuzu } = spawnProphetFixture(
      ['柚子@A', '退场测试敌人@B', '退场测试旁观者@C'],
      [owner, summon],
    );
    const controlled = engine.fighters.find((fighter) => fighter.id === summon.id)!;
    addOriginiumInfection(engine.createPuruisaishiRuntime(), yuzu, 20, '共同退场清除测试');
    const ownerKillsBefore = engine.fighters.find((fighter) => fighter.id === owner.id)!.stats.kills;

    assert(
      retreatYuzuProphetEvent(engine.createYuzuProphetRuntime(), prophet, '共同退场回归测试'),
      'First common retreat call should settle the event',
    );
    assert(controlled.yuzuProphetControlState?.disposition === 'returned', 'Living phase-one summon should be returned');
    assert(controlled.summonerId === owner.id && controlled.teamId === owner.teamId, 'Returned summon should recover original owner and team');
    assert(engine.isActiveCombatant(controlled), 'Returned summon should remain alive with its current state');
    assert(getOriginiumInfectionStacks(yuzu) === 0, 'Common retreat should clear all Originium infection');
    assert(!engine.isActiveCombatant(prophet) && !engine.isActiveCombatant(engine.fighters.find((fighter) => fighter.isPuruisaishi)!), 'Prophet and Puruisaishi should leave together');
    assert(engine.fighters.find((fighter) => fighter.id === owner.id)!.stats.kills === ownerKillsBefore, 'Common retreat must not award kills');
    assert(yuzu.yuzuMarkedTargetId !== prophet.id, 'Retreat should clear the Prophet-only Yuzu mark');
    assert(
      logs.filter((entry) => entry.text.includes('【文明尽头的约定】')).length === 1,
      'The long retreat quote should play exactly once',
    );
    assert(
      logs.some((entry) =>
        entry.text.includes('【共同退场完成】') &&
        entry.text.includes('1 名返还原主人') &&
        entry.text.includes('0 名无原主保底召唤物随事件退场'),
      ),
      'Phase-one retreat summary should report returned and withdrawn summon counts exactly',
    );
    assert(
      !retreatYuzuProphetEvent(engine.createYuzuProphetRuntime(), prophet, '重复退场测试') &&
      logs.filter((entry) => entry.text.includes('【文明尽头的约定】')).length === 1,
      'Repeated retreat calls must be idempotent',
    );
    cases.push('Common retreat returns survivors, clears infection and marks, awards no kills, and plays its quote once');
  }

  {
    const fixture = spawnProphetFixture();
    const synthetic = fixture.engine.fighters.find((fighter) =>
      fighter.isSurtr && fighter.yuzuProphetControlState?.synthetic,
    )!;
    synthetic.surtrState!.afterglowActive = true;
    localProject.setCurrentHp(synthetic, 1);
    retreatYuzuProphetEvent(fixture.engine.createYuzuProphetRuntime(), fixture.prophet, '保底史尔特尔退场回归测试');
    assert(synthetic.isDead && synthetic.currentHp === 0, 'Fallback Surtr should withdraw at zero HP');
    assert(!synthetic.surtrState?.afterglowActive, 'Fallback withdrawal must clear afterglow before HP synchronization');
    assert(synthetic.yuzuProphetControlState?.disposition === 'withdrawn', 'Fallback Surtr should be marked withdrawn, not killed');
    assert(
      fixture.logs.some((entry) =>
        entry.text.includes('【共同退场完成】') &&
        entry.text.includes('0 名返还原主人') &&
        entry.text.includes('1 名无原主保底召唤物随事件退场'),
      ),
      'Fallback-only retreat summary should report withdrawal without claiming a returned summon',
    );
    cases.push('Fallback Surtr retreat clears afterglow before zeroing HP');
  }

  {
    const gacha = makeFighter('牢鳄@G');
    const owl = makeFighter('鸮@O');
    const surtr = makeOwlSummon('史尔特尔返还测试体', gacha, 'swire');
    surtr.isSurtr = true;
    surtr.summonBaseName = '史尔特尔';
    surtr.surtrState = {
      primaryOwnerId: gacha.id,
      primaryOwnerTeamId: gacha.teamId ?? gacha.id,
      owlOwnerId: owl.id,
      owlOwnerTeamId: owl.teamId ?? owl.id,
      twilightUsed: false,
      twilightDrainOpportunities: 0,
      afterglowActive: false,
      afterglowOpportunities: 0,
      actualKills: 0,
      ownershipSuspended: false,
      lastAffiliationMode: 'conflict',
    };
    const fixture = spawnProphetFixture(
      ['柚子@A', '双主人返还测试敌人@B', '双主人返还测试旁观者@C'],
      [gacha, owl, surtr],
    );
    const controlled = fixture.engine.fighters.find((fighter) => fighter.id === surtr.id)!;
    assert(controlled.surtrState?.ownershipSuspended, 'Prophet takeover should suspend both Surtr owner relations');
    const takeoverLog = fixture.logs.find((entry) =>
      entry.text.includes('【预言家接管】') &&
      entry.text.includes(controlled.name),
    )?.text ?? '';
    assert(
      takeoverLog.includes('共同主人 牢鳄、鸮') &&
      !takeoverLog.includes(gacha.id) &&
      !takeoverLog.includes(owl.id),
      'Surtr takeover log should name both owners without exposing internal IDs',
    );

    retreatYuzuProphetEvent(
      fixture.engine.createYuzuProphetRuntime(),
      fixture.prophet,
      '双主人史尔特尔返还回归测试',
    );

    assert(
      !controlled.surtrState?.ownershipSuspended &&
      controlled.surtrState?.primaryOwnerId === gacha.id &&
      controlled.surtrState?.owlOwnerId === owl.id,
      'Surtr return should restore both owner relations',
    );
    const returnLog = fixture.logs.find((entry) =>
      entry.text.includes('【控制权返还】') &&
      entry.text.includes(controlled.name),
    )?.text ?? '';
    assert(
      returnLog.includes('共同主人 牢鳄、鸮') &&
      returnLog.includes('共同控制与阵营关系') &&
      !returnLog.includes(gacha.id) &&
      !returnLog.includes(owl.id),
      'Surtr return log should name both owners without exposing internal IDs',
    );
    cases.push('Prophet retreat restores and names both Surtr owners without leaking internal IDs');
  }

  {
    const fixture = spawnProphetFixture();
    const attacker = fixture.engine.fighters.find((fighter) =>
      !fighter.isNpc && fighter.id !== fixture.yuzu.id,
    )!;
    removeBarriers(fixture.puruisaishi, { identityIds: [PURUISAISHI_BARRIER_IDENTITY] });
    grantPuruisaishiBarrier(fixture.puruisaishi, 1, '护盾归零日志顺序测试');

    fixture.engine.applyDamage(
      fixture.puruisaishi,
      10,
      'skill',
      false,
      attacker,
      { actionName: '护盾归零日志顺序测试' },
    );
    fixture.engine.flushDeferredDamageEvents(fixture.puruisaishi);

    const shieldIndex = fixture.logs.findIndex((entry) =>
      entry.text.includes('【普瑞赛斯护盾】') &&
      entry.text.includes('吸收 1 点伤害') &&
      entry.text.includes('剩余 0'),
    );
    const retreatIndex = fixture.logs.findIndex((entry) => entry.text.includes('【预言家共同退场启动】'));
    const retreatEndIndex = fixture.logs.findIndex((entry) => entry.text.includes('【共同退场完成】'));
    assert(
      shieldIndex >= 0 && retreatIndex > shieldIndex,
      'Puruisaishi shield depletion must be logged before the common retreat it triggers',
    );
    assert(
      retreatEndIndex > retreatIndex &&
      fixture.logs.slice(retreatEndIndex + 1).every((entry) =>
        !entry.text.includes(fixture.puruisaishi.name) &&
        !entry.text.includes(fixture.prophet.name)),
      'Retired Prophet event units must not emit deferred damage or status logs after common retreat completes',
    );
    cases.push('Puruisaishi shield depletion precedes retreat and retired event units leave no deferred logs');
  }

  {
    const fixture = spawnProphetFixture();
    const attacker = fixture.engine.fighters.find((fighter) =>
      !fighter.isNpc && fighter.id !== fixture.yuzu.id,
    )!;
    removeBarriers(fixture.puruisaishi, { identityIds: [PURUISAISHI_BARRIER_IDENTITY] });
    grantPuruisaishiBarrier(fixture.puruisaishi, 1, 'AOE 退场日志顺序测试');
    attacker.atk = 1000;
    attacker.mag = 1000;

    fixture.engine.executeSkillAction('ultimate_burst_stream', attacker, fixture.puruisaishi);

    const retreatEndIndex = fixture.logs.findIndex((entry) => entry.text.includes('【共同退场完成】'));
    assert(retreatEndIndex >= 0, 'AOE shield depletion should complete the Prophet event retreat');
    assert(
      fixture.logs.slice(retreatEndIndex + 1).every((entry) =>
        !entry.text.includes(`究极龙息扫过 ${fixture.puruisaishi.name}`),
      ),
      'The resolving AOE must not append an outcome for a Puruisaishi target that already retired',
    );
    cases.push('AOE resolution stops reporting a Puruisaishi target after its shield triggers immediate retreat');
  }

  return cases;
}
