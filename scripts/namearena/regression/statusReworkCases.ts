import { healFighter } from '../../../lib/namearena/combatState';
import { missesSkill } from '../../../lib/namearena/actionResolution/guards';
import { GACHA_BLAZE_CANNON_CARD, GACHA_BLUE_EYES_BURST_CARD } from '../../../lib/namearena/gachaMechanics';
import { duelMonsterSkills } from '../../../lib/namearena/skills/duelMonster';
import { emoteSkills } from '../../../lib/namearena/skills/emote';
import { gamerSkills } from '../../../lib/namearena/skills/gamer';
import { owlSkills } from '../../../lib/namearena/skills/owl';
import { rabbitSkills } from '../../../lib/namearena/skills/rabbit';
import { tokusatsuSkills } from '../../../lib/namearena/skills/tokusatsu';
import { buildFighterStatusPresentation } from '../../../lib/namearena/statusPresentation';
import { getStatusIdentityDefinition } from '../../../lib/namearena/statusRegistry';
import { advanceGlobalTimedStatuses, settleSelfOpportunityStatuses } from '../../../lib/namearena/statusProcessing';
import { findActivePuppetProtector, getConfusionTargets, getSelectableTargets } from '../../../lib/namearena/targeting';
import {
  burstTremor,
  changeMorale,
  getActionSpeedMultiplier,
  getAccuracyAgilityMultiplier,
  getAggroMultiplier,
  getEffectiveCombatStat,
  getEvasionMultiplier,
  getIncomingDirectStatusMultiplier,
  getOpeningCritBonus,
  getOutgoingDirectStatusMultiplier,
  resetStatusResourcesOnDeath,
  resetStatusResourcesOnRevive,
  settleBurnAtLargeRound,
  settleSelfOpportunityResources,
  spendCharge,
  triggerBleedBeforeAttack,
  triggerBurn,
} from '../../../lib/namearena/statusMechanics';
import {
  advanceEffects,
  findMechanic,
  getBarrierTotal,
  grantBarrier,
  queryMechanic,
  removeBarriers,
  removeEffects,
} from '../../../lib/namearena/statusSystem';
import type { Fighter } from '../../../lib/namearena/types';
import {
  applySingleTestStatus,
  replaceTestStatuses,
  applyTestStatus,
  assert,
  localProject,
  makeFighter,
  withRandomSequence,
} from '../shared/harness';
import { makeDeathEngine } from './deathAccountingCases';

function prepareFighter(fighter: Fighter, maxHp = 1000): Fighter {
  fighter.maxHp = maxHp;
  localProject.setCurrentHp(fighter, maxHp);
  replaceTestStatuses(fighter, []);
  fighter.isOwl = false;
  fighter.isYuzu = false;
  fighter.isGacha = false;
  fighter.isWT = false;
  fighter.jobData = { ...fighter.jobData, name: '状态测试职业', skills: [...fighter.jobData.skills] };
  return fighter;
}

function countText(text: string, fragment: string): number {
  return text.split(fragment).length - 1;
}

export function runStatusReworkCases(): string[] {
  const cases: string[] = [];

  {
    const source = prepareFighter(makeFighter('灼烧来源@A'));
    const target = prepareFighter(makeFighter('灼烧目标@B'));
    const { engine } = makeDeathEngine([source, target]);
    const [engineSource, engineTarget] = engine.fighters;

    assert(engine.applyStatus(engineTarget, { identityId: 'BURN', potency: 4, count: 2, attribution: { applierId: engineSource.id, applierName: engineSource.name } }), 'first burn should apply');
    engine.processStatusTurn(engineTarget);
    assert(engineTarget.currentHp === 1000, `burn must not tick on the owner's opportunity, got ${engineTarget.currentHp}`);
    settleBurnAtLargeRound(engine.createStatusMechanicsRuntime(), 1);
    assert(Number(engineTarget.currentHp) === 976, `burn should settle potency x 6 at large-round end, got ${engineTarget.currentHp}`);
    assert(engine.applyStatus(engineTarget, { identityId: 'BURN', potency: 3, count: 2, attribution: { applierId: engineSource.id, applierName: engineSource.name } }), 'reapplied burn should stack');
    assert(Number(engineTarget.currentHp) === 976, `burn reapplication must not explode automatically, got ${engineTarget.currentHp}`);
    settleBurnAtLargeRound(engine.createStatusMechanicsRuntime(), 2);
    assert(Number(engineTarget.currentHp) === 934, `stacked burn should settle the combined potency, got ${engineTarget.currentHp}`);
    assert(engineSource.stats.dmgDealt === 66, `burn owner should receive all burn damage credit, got ${engineSource.stats.dmgDealt}`);
    localProject.setCurrentHp(engineTarget, 0);
    engineTarget.isDead = true;
    engineTarget.isDeadAnnounced = true;
    const statusCountAfterDefeat = engineTarget.statuses.length;
    assert(!engine.applyStatus(engineTarget, { identityId: 'STUN', remainingTurns: 1, attribution: { applierId: engineSource.id, applierName: engineSource.name } }), 'defeated targets must reject newly applied statuses');
    assert(engineTarget.statuses.length === statusCountAfterDefeat, 'rejected post-defeat status must not mutate the status list');
    cases.push('burn settles on large rounds, credits its applier, and the pipeline rejects post-defeat statuses');
  }

  {
    const source = prepareFighter(makeFighter('中毒来源@A'));
    const target = prepareFighter(makeFighter('中毒目标@B'));
    const { engine, logs } = makeDeathEngine([source, target]);
    const [engineSource, engineTarget] = engine.fighters;

    for (let stack = 1; stack <= 3; stack += 1) {
      assert(engine.applyStatus(engineTarget, { identityId: 'POISON', remainingTurns: 3, attribution: { applierId: engineSource.id, applierName: engineSource.name } }), `poison stack ${stack} should apply`);
      assert(queryMechanic(engineTarget, 'POISON').potency === stack, `poison should reach ${stack} stacks`);
    }
    engine.processStatusTurn(engineTarget);
    assert(engineTarget.currentHp === 940, `three poison stacks should deal 6% max HP, got ${engineTarget.currentHp}`);
    assert(engineSource.stats.dmgDealt === 60, 'poison damage should be credited to the most recent applier');
    assert(logs.some((entry) =>
      entry.text.includes('【中毒】') &&
      entry.text.includes('最新施加者 中毒来源') &&
      entry.text.includes('本次行动结束后衰减 1 次')
    ), 'poison settlement should identify its latest applier and exact decay clock');
    cases.push('poison stacks to three and uses the 4/5/6 percent profile');
  }

  {
    const firstSource = prepareFighter(makeFighter('旧灼烧来源@A'));
    const latestSource = prepareFighter(makeFighter('新灼烧来源@C'));
    const target = prepareFighter(makeFighter('多来源灼烧目标@B'));
    const { engine, logs } = makeDeathEngine([firstSource, latestSource, target]);
    const [engineFirstSource, engineLatestSource, engineTarget] = engine.fighters;

    engine.applyStatus(engineTarget, { identityId: 'BURN', potency: 2, count: 2, attribution: { applierId: engineFirstSource.id, applierName: engineFirstSource.name } });
    engine.applyStatus(engineTarget, { identityId: 'BURN', potency: 3, count: 2, attribution: { applierId: engineLatestSource.id, applierName: engineLatestSource.name } });
    settleBurnAtLargeRound(engine.createStatusMechanicsRuntime(), 1);

    const settlement = logs.find((entry) => entry.text.includes('【灼烧】') && entry.text.includes('实际损失'));
    assert(settlement?.text.includes('最新施加者 新灼烧来源'), 'multi-source burn settlement should identify the latest applier');
    assert(engineLatestSource.stats.dmgDealt === 30, 'latest burn applier should receive settlement damage credit');
    cases.push('multi-source status settlements expose and credit the latest applier');
  }

  {
    const source = prepareFighter(makeFighter('流血来源@A'));
    const target = prepareFighter(makeFighter('流血目标@B'));
    localProject.setCurrentHp(target, 500);
    const { engine } = makeDeathEngine([source, target]);
    const [engineSource, engineTarget] = engine.fighters;

    engine.applyStatus(engineTarget, { identityId: 'BLEED', potency: 4, count: 2, attribution: { applierId: engineSource.id, applierName: engineSource.name } });
    const healingLogs: string[] = [];
    const healed = healFighter(engineTarget, 100, (_type, text) => healingLogs.push(text));
    assert(healed === 100, `bleed must not reduce healing, got ${healed}`);
    engine.processStatusTurn(engineTarget);
    assert(engineTarget.currentHp === 600, `bleed must not tick on an owner opportunity without an attack, got ${engineTarget.currentHp}`);
    triggerBleedBeforeAttack(engine.createStatusMechanicsRuntime(), engineTarget);
    assert(Number(engineTarget.currentHp) === 576, `bleed should deal potency x 6 immediately before an active attack, got ${engineTarget.currentHp}`);
    cases.push('bleed preserves healing and triggers only before an active attack');
  }

  {
    const source = prepareFighter(makeFighter('持续伤害击杀者@A'));
    const target = prepareFighter(makeFighter('持续伤害濒死者@B'), 100);
    localProject.setCurrentHp(target, 4);
    const { engine } = makeDeathEngine([source, target]);
    const [engineSource, engineTarget] = engine.fighters;

    engine.applyStatus(engineTarget, { identityId: 'BLEED', count: 1, attribution: { applierId: engineSource.id, applierName: engineSource.name } });
    triggerBleedBeforeAttack(engine.createStatusMechanicsRuntime(), engineTarget);
    assert(engineTarget.isDeadAnnounced, 'lethal bleed should announce defeat immediately');
    assert(engineSource.stats.kills === 1, `lethal DoT should award one kill, got ${engineSource.stats.kills}`);
    assert(engineSource.stats.dmgDealt === 4, `lethal DoT should award exact damage, got ${engineSource.stats.dmgDealt}`);
    cases.push('lethal DoT awards damage and kill ownership');
  }

  {
    const makeOrderedTarget = (name: string, regenFirst: boolean) => {
      const target = prepareFighter(makeFighter(name), 1000);
      localProject.setCurrentHp(target, 30);
      const regen = { identityId: 'REGEN', remainingTurns: 1 } as const;
      const bleed = { identityId: 'BLEED', potency: 6, count: 1 } as const;
      if (regenFirst) {
        applyTestStatus(target, regen);
        applyTestStatus(target, { ...bleed, attribution: { applierId: name } });
      } else {
        applyTestStatus(target, { ...bleed, attribution: { applierId: name } });
        applyTestStatus(target, regen);
      }
      return target;
    };
    const sourceA = prepareFighter(makeFighter('状态顺序来源A@B'));
    const sourceB = prepareFighter(makeFighter('状态顺序来源B@B'));
    const first = makeOrderedTarget('先恢复插入目标@A', true);
    const second = makeOrderedTarget('先流血插入目标@A', false);
    first.statuses.find((status) => status.identityId === 'BLEED')!.attribution.applierId = sourceA.id;
    second.statuses.find((status) => status.identityId === 'BLEED')!.attribution.applierId = sourceB.id;
    const firstBattle = makeDeathEngine([first, sourceA]);
    const secondBattle = makeDeathEngine([second, sourceB]);

    firstBattle.engine.processStatusTurn(firstBattle.engine.fighters[0]);
    secondBattle.engine.processStatusTurn(secondBattle.engine.fighters[0]);

    assert(!firstBattle.engine.fighters[0].isDeadAnnounced && !secondBattle.engine.fighters[0].isDeadAnnounced, 'bleed must not trigger during a non-attacking owner opportunity');
    assert(firstBattle.engine.fighters[0].currentHp === secondBattle.engine.fighters[0].currentHp, 'Equivalent status sets must have identical HP outcomes');
    assert(firstBattle.engine.fighters[0].currentHp === 80, 'regeneration should settle normally while dormant bleed remains queued');
    cases.push('status settlement order is deterministic and dormant bleed does not preempt recovery');
  }

  {
    const target = prepareFighter(makeFighter('持续伤害复活者@A'), 100);
    target.spd = 100000;
    replaceTestStatuses(target, [{ identityId: 'VALO_ULT_RUN_IT_BACK', remainingTurns: 2 }]);
    localProject.setCurrentHp(target, 4);
    const source = prepareFighter(makeFighter('复活击飞来源@B'), 100);
    source.spd = 1;
    const { engine, logs } = makeDeathEngine([target, source]);
    const [engineTarget, engineSource] = engine.fighters;
    engine.applyStatus(engineTarget, { identityId: 'POISON', remainingTurns: 1, attribution: { applierId: engineSource.id, applierName: engineSource.name } });
    engine.applyStatus(engineTarget, { identityId: 'AIRBORNE', remainingTurns: 1, attribution: { applierId: engineSource.id, applierName: engineSource.name } });
    withRandomSequence([0], () => engine.step({ current: false }));
    const poisonIndex = logs.findIndex((entry) => entry.text.includes('【中毒】') && entry.text.includes('实际损失'));
    const reviveIndex = logs.findIndex((entry) => entry.text.includes('再火一回'));
    const unableIndex = logs.findIndex((entry) => entry.text.includes('处于【击飞】') && entry.text.includes('无法行动'));
    const landingIndex = logs.findIndex((entry) => entry.text.includes('击飞坠地'));
    assert(reviveIndex >= 0, 'lethal DoT should trigger the prepared revival');
    assert(poisonIndex >= 0 && poisonIndex < reviveIndex, 'DoT must log its final HP loss before the resulting revival');
    assert(reviveIndex < unableIndex && unableIndex < landingIndex, 'a fighter revived during DoT processing must still finish the pending airborne skip and landing');
    cases.push('DoT revival continues the same status turn through airborne landing');
  }

  {
    const confused = prepareFighter(makeFighter('混乱者@A'));
    const ally = prepareFighter(makeFighter('混乱友军@A'));
    const enemy = prepareFighter(makeFighter('混乱敌军@B'));
    confused.teamId = ally.teamId = 'A';
    enemy.teamId = 'B';
    confused.agl = 10000;
    replaceTestStatuses(confused, [{ identityId: 'CONFUSED', remainingTurns: 1 }]);
    const { engine } = makeDeathEngine([confused, ally, enemy]);
    const [engineConfused, engineAlly] = engine.fighters;

    const turn = engine.processStatusTurn(engineConfused);
    assert(turn.canAct && turn.confused, 'confusion should issue a forced-basic directive without hard-stunning the owner');
    const candidates = getConfusionTargets(engine.createTargetingRuntime(), engineConfused);
    assert(candidates.some((candidate) => candidate.id === engineAlly.id), 'confusion target pool should include allies');
    engineConfused.confusedForcedTargetId = engineAlly.id;
    withRandomSequence([0, 0, 0, 0], () => engine.executeSkillAction(null, engineConfused, engineAlly));
    delete engineConfused.confusedForcedTargetId;
    assert(engineAlly.stats.dmgTaken > 0, 'confused forced basic attack should resolve friendly fire through the normal damage pipeline');
    cases.push('confusion forces a normal basic attack and permits friendly fire');
  }

  {
    const confused = prepareFighter(makeFighter('食物混乱者@A'));
    const enemy = prepareFighter(makeFighter('食物混乱敌人@B'));
    const meal = prepareFighter(makeFighter('拼好饭@B'));
    meal.isSummon = true;
    meal.owlSummonState = { kind: 'meal', spawnedTurn: 0 };
    const { engine } = makeDeathEngine([confused, enemy, meal]);
    const candidates = getConfusionTargets(engine.createTargetingRuntime(), engine.fighters[0]);
    assert(candidates.some((candidate) => candidate.name.includes('敌人')), 'confusion should retain normal selectable targets');
    assert(!candidates.some((candidate) => candidate.owlSummonState?.kind === 'meal'), 'confusion must exclude Owl food units');
    cases.push('confusion excludes untargetable Owl food units');
  }

  {
    const charmed = prepareFighter(makeFighter('魅惑受害者@A'));
    const charmer = prepareFighter(makeFighter('魅惑来源@B'));
    const alternative = prepareFighter(makeFighter('魅惑替代目标@C'));
    charmed.teamId = 'A';
    charmer.teamId = 'B';
    alternative.teamId = 'C';
    const { engine, logs } = makeDeathEngine([charmed, charmer, alternative]);
    const [engineCharmed, engineCharmer, engineAlternative] = engine.fighters;
    engine.applyStatus(engineCharmed, { identityId: 'CHARMED', remainingTurns: 2, attribution: { applierId: engineCharmer.id, applierName: engineCharmer.name } });

    const resolved = engine.resolveTarget(engineCharmed, engineCharmer, engine.getSelectableTargets(engineCharmed));
    assert(resolved?.target.id === engineAlternative.id, 'charmed fighter should avoid the charmer while another legal target exists');
    applyTestStatus(engineCharmed, { identityId: 'AIM', charges: 1 });
    const damageResult = withRandomSequence([0, 0], () => engine.calculateDamage(
      engineCharmed,
      engineCharmer,
      { name: '魅惑禁暴测试', tag: 'physical', mult: 1, alwaysCrit: true },
      engine.getTeamId(engineCharmed),
      'charm_test',
    ));
    assert(damageResult.logType !== 'crit', 'attacks against the charmer must not crit');
    const actual = engine.applyDamage(engineCharmer, 100, 'skill', true, engineCharmed, { deferTransform: true });
    assert(actual === 40, `damage against the charmer should be reduced by 60%, got ${actual}`);
    engine.log('skill', '魅惑伤害结果测试');
    engine.flushDeferredDamageEvents(engineCharmer);
    const charmLogIndex = logs.findIndex((entry) => entry.text.includes('魅惑牵制'));
    const charmResultIndex = logs.findIndex((entry) => entry.text.includes('魅惑伤害结果测试'));
    assert(charmLogIndex >= 0 && charmLogIndex < charmResultIndex, '魅惑减伤的前因日志应先于伤害结果');
    engineCharmer.isDead = true;
    localProject.setCurrentHp(engineCharmer, 0);
    engine.processStatusTurn(engineCharmed);
    assert(!engineCharmed.statuses.some((status) => status.identityId === 'CHARMED'), 'charm should end when its source leaves the field');
    cases.push('charm avoids its source, disables crit, reduces damage, and ends with the source');
  }

  {
    const yuzu = prepareFighter(makeFighter('柚子@A'));
    const charmer = prepareFighter(makeFighter('魅惑来源@B'));
    const alternative = prepareFighter(makeFighter('魅惑替代目标@C'));
    yuzu.isYuzu = true;
    yuzu.yuzuPhase = 3;
    replaceTestStatuses(yuzu, [{ identityId: 'CHARMED', remainingTurns: 2, attribution: { applierId: charmer.id, applierName: charmer.name } }]);
    yuzu.yuzuMarkedTargetId = charmer.id;
    const { engine } = makeDeathEngine([yuzu, charmer, alternative]);
    const [engineYuzu, engineCharmer, engineAlternative] = engine.fighters;
    const charmerHpBefore = engineCharmer.currentHp;
    const alternativeHpBefore = engineAlternative.currentHp;
    withRandomSequence([0.1, 0.1, 0.1, 0.1, 0.1, 0.1], () => {
      engine.executeSkillAction('yuzu_spear_impale', engineYuzu, engineCharmer);
    });
    assert(engineCharmer.currentHp === charmerHpBefore, 'phase-three Yuzu must not override charm avoidance with her marked target');
    assert(engineAlternative.currentHp < alternativeHpBefore, 'phase-three Yuzu should redirect the custom skill to a legal charm alternative');
    cases.push('Yuzu phase-three mark respects charm target avoidance');
  }

  {
    const source = prepareFighter(makeFighter('M1A2_abrams_sep@A'));
    source.isWT = true;
    const target = prepareFighter(makeFighter('击飞目标@B'));
    target.jobData = { ...target.jobData, name: '欧皇' };
    target.spd = 100000;
    source.spd = 1;
    const { engine, logs } = makeDeathEngine([target, source]);
    const [engineTarget, engineSource] = engine.fighters;

    engine.applyStatus(engineTarget, { identityId: 'STUN', remainingTurns: 2, attribution: { applierId: engineSource.id, applierName: engineSource.name } });
    engine.applyStatus(engineTarget, { identityId: 'AIRBORNE', remainingTurns: 1, attribution: { effectSourceId: 'war_thunder_airborne', applierId: engineSource.id, applierName: engineSource.name } });
    const airborne = engineTarget.statuses.find((status) => status.identityId === 'AIRBORNE');
    assert(airborne?.remainingTurns === 1, 'War Thunder knock-up should use the canonical one-opportunity AIRBORNE identity');
    withRandomSequence([0, 0.99], () => engine.step({ current: false }));
    assert(!engineTarget.statuses.some((status) => status.identityId === 'AIRBORNE'), 'airborne should expire after consuming the target next action');
    assert(Number(engineTarget.currentHp) === 982, `airborne landing should respect the target general 37% reduction, got ${engineTarget.currentHp}`);
    assert(logs.some((entry) => entry.text.includes('炮震坠落')), 'War Thunder airborne should retain a source-specific landing log');
    const unableIndex = logs.findIndex((entry) => entry.text.includes('无法行动'));
    const landingIndex = logs.findIndex((entry) => entry.text.includes('炮震坠落'));
    assert(logs[unableIndex]?.text.includes('处于【击飞】'), 'airborne landing should take priority in the unable-to-act explanation when another control is also present');
    assert(unableIndex >= 0 && unableIndex < landingIndex, '击飞应先说明行动被跳过，再结算坠地伤害');
    cases.push('airborne skips the next action, then lands for mitigated three-percent damage');
  }

  {
    const source = prepareFighter(makeFighter('鸮@A'));
    const target = prepareFighter(makeFighter('乘风目标@B'));
    const { engine } = makeDeathEngine([source, target]);
    const [engineSource, engineTarget] = engine.fighters;
    engine.applyStatus(engineTarget, { identityId: 'OWL_EVADE_DOWN', remainingTurns: 8, attribution: { applierId: engineSource.id, applierName: engineSource.name } });
    const opening = engineTarget.statuses.find((status) => status.identityId === 'OWL_EVADE_DOWN');
    assert(opening?.remainingTurns === 2, `Owl opening should be capped at two owner actions, got ${opening?.remainingTurns}`);
    applyTestStatus(engineTarget, { identityId: 'INVUL', remainingTurns: 1 });
    engine.executeSkillAction('serious_punch', engineSource, engineTarget);
    assert(engineTarget.statuses.some((status) => status.identityId === 'OWL_EVADE_DOWN'), 'invulnerability should block the attack without consuming Owl opening');
    removeEffects(engineTarget, { identityIds: ['INVUL'], reason: 'scripted' });
    applyTestStatus(engineTarget, { identityId: 'SPELL_BLOCK', charges: 1 });
    engine.executeSkillAction('serious_punch', engineSource, engineTarget);
    assert(engineTarget.statuses.some((status) => status.identityId === 'OWL_EVADE_DOWN'), 'spell block should block the attack without consuming Owl opening');
    engine.executeSkillAction('serious_punch', engineSource, engineTarget);
    assert(!engineTarget.statuses.some((status) => status.identityId === 'OWL_EVADE_DOWN'), 'the next unblocked direct single-target attack should consume Owl opening');
    cases.push('Owl evade opening lasts two actions and respects invulnerability and spell block');
  }

  {
    const yuzu = prepareFighter(makeFighter('柚子直攻@A'));
    yuzu.isYuzu = true;
    yuzu.yuzuPhase = 1;
    const target = prepareFighter(makeFighter('乘风直攻目标@B'));
    replaceTestStatuses(target, [{ identityId: 'OWL_EVADE_DOWN', remainingTurns: 2 }]);
    const { engine, logs } = makeDeathEngine([yuzu, target]);
    engine.executeSkillAction('yuzu_spear_impale', engine.fighters[0], engine.fighters[1]);
    assert(!engine.fighters[1].statuses.some((status) => status.identityId === 'OWL_EVADE_DOWN'), 'Yuzu custom direct skill should consume Owl opening');
    assert(logs.some((entry) => entry.text.includes('乘风失衡') && entry.text.includes('必定命中')), 'custom direct skill should explain the consumed Owl opening');

    const groupYuzu = prepareFighter(makeFighter('柚子群攻@A'));
    groupYuzu.isYuzu = true;
    groupYuzu.yuzuPhase = 2;
    const groupTarget = prepareFighter(makeFighter('乘风群攻目标@B'));
    replaceTestStatuses(groupTarget, [{ identityId: 'OWL_EVADE_DOWN', remainingTurns: 2 }]);
    const groupEngine = makeDeathEngine([groupYuzu, groupTarget]).engine;
    groupEngine.executeSkillAction('yuzu_waiting_hell', groupEngine.fighters[0], groupEngine.fighters[1]);
    assert(groupEngine.fighters[1].statuses.some((status) => status.identityId === 'OWL_EVADE_DOWN'), 'Yuzu group skill must not consume a direct-attack opening');
    cases.push('custom Yuzu skills distinguish direct attacks from group attacks for Owl opening');
  }

  {
    const directSkills = [
      duelMonsterSkills.triple_dragon_head,
      emoteSkills.emote_meme_slap,
      emoteSkills.emote_tenth_claim,
      emoteSkills.emote_mark_owner,
      emoteSkills.emote_wheel_cleave,
      owlSkills.owl_zhao_rampage,
      owlSkills.owl_atomic_breath,
      gamerSkills.gamer_headshot_line,
      gamerSkills.gamer_crack_confirm,
      gamerSkills.gamer_qte_execute,
      gamerSkills.gamer_read_inputs,
      gamerSkills.gamer_clutch_ace,
      rabbitSkills.v_rabbit_calc_rng,
      tokusatsuSkills.adversity_flash,
      tokusatsuSkills.energy_crush,
      tokusatsuSkills.great_monster_victory,
      GACHA_BLUE_EYES_BURST_CARD,
      GACHA_BLAZE_CANNON_CARD,
    ];
    assert(directSkills.every((skill) => skill?.directTarget), 'every custom single-target damage executor must opt into shared direct-hit rules');

    const dragon = prepareFighter(makeFighter('青眼究极龙@A'), 5000);
    dragon.atk = 100;
    dragon.mag = 100;
    const target = prepareFighter(makeFighter('三重龙首目标@B'), 5000);
    replaceTestStatuses(target, [{ identityId: 'OWL_EVADE_DOWN', remainingTurns: 2 }]);
    const { engine, logs } = makeDeathEngine([dragon, target]);
    withRandomSequence([0.1, 0.1, 0.1, 0.1], () => {
      engine.executeSkillAction('triple_dragon_head', engine.fighters[0], engine.fighters[1]);
    });
    assert(!engine.fighters[1].statuses.some((status) => status.identityId === 'OWL_EVADE_DOWN'), 'non-Yuzu custom direct skill should consume Owl opening');
    assert(logs.filter((entry) => entry.text.includes('乘风失衡')).length === 1, 'multi-hit direct skill should consume and explain Owl opening once');
    cases.push('all custom single-target executors share Owl opening semantics');
  }

  {
    const gamer = makeFighter('玄凝@B');
    gamer.apm = 12;
    gamer.atk = 1000;
    gamer.mag = 1000;
    gamer.wis = 1000;
    gamer.agl = 10000;
    applyTestStatus(gamer, { identityId: 'AIM', charges: 1 });
    const yuzu = makeFighter('柚子@A');
    yuzu.yuzuPhase = 3;
    yuzu.transformed = true;
    yuzu.maxHp = 5000;
    localProject.setCurrentHp(yuzu, 5000);
    const teammate = makeFighter('镜界同步队友@A');
    teammate.maxHp = 5000;
    localProject.setCurrentHp(teammate, 5000);
    const { engine, logs } = makeDeathEngine([gamer, yuzu, teammate]);
    const engineGamer = engine.fighters[0];
    const engineYuzu = engine.fighters[1];

    engine.executeSkillAction('gamer_headshot_line', engineGamer, engineYuzu);

    const damageEvent = engine.events.find((event) =>
      event.kind === 'damage' &&
      event.damage?.actionName === '冠军爆头线' &&
      event.damage.targetId === engineYuzu.id,
    );
    const stateCommit = logs.find((entry) =>
      entry.displayInFeed === false &&
      entry.text === `state-sync:${engineYuzu.id}` &&
      (entry.sequence ?? 0) > (damageEvent?.sequence ?? Number.MAX_SAFE_INTEGER),
    );
    assert(damageEvent?.damage?.outcome === 'redistributed', 'Gamer/Yuzu fixture should fully redistribute the headshot through Yuzu team sharing');
    assert(stateCommit, 'A fully redistributed custom Gamer hit must publish a hidden fighter snapshot after its damage event');
    cases.push('custom Gamer damage publishes a playback snapshot after full Yuzu redistribution');
  }

  {
    const rabbit = makeFighter('兔卷卷@A');
    const water = makeFighter('水人@B');
    water.job = 'GOD_SLIME';
    rabbit.maxHp = 500;
    localProject.setCurrentHp(rabbit, 500);
    const { engine } = makeDeathEngine([rabbit, water]);
    const engineRabbit = engine.fighters[0];
    const engineWater = engine.fighters[1];

    engine.executeSkillAction('v_rabbit_zero', engineRabbit, engineWater);

    const backlashDamage = engine.events.find((event) =>
      event.kind === 'damage' &&
      event.damage?.actionName === '弑神反噬',
    );
    const backlashStart = engine.events.find((event) =>
      event.kind === 'action_start' &&
      event.actionId === backlashDamage?.actionId,
    );
    const backlashVisual = engine.events.find((event) =>
      event.actionId === backlashDamage?.actionId &&
      event.visualCue?.kind === 'combat_action',
    );
    assert(backlashDamage?.actorId === engineWater.id, 'Water must remain the authoritative attacker for divine backlash');
    assert(backlashStart?.actorId === engineWater.id && backlashStart.skillName === '弑神反噬', 'Divine backlash must run as Water\'s nested reaction action');
    assert(backlashVisual?.visualCue?.kind === 'combat_action' && backlashVisual.visualCue.sourceId === engineWater.id, 'Divine backlash must carry a structured Water combat cue');
    cases.push('Water divine backlash is a nested reaction action with authoritative ownership');
  }

  {
    const m1 = prepareFighter(makeFighter('M1A2_abrams_sep@A'));
    m1.isWT = true;
    m1.spd = 10000;
    m1.def = 10000;
    localProject.setCurrentHp(m1, 400);
    const enemy = prepareFighter(makeFighter('抢修时序敌人@B'));
    enemy.spd = 1;
    enemy.atk = 1;
    const { engine, logs } = makeDeathEngine([m1, enemy]);
    engine.applyStatus(engine.fighters[0], { identityId: 'WT_REPAIRING', remainingTurns: 2 });
    for (let index = 0; index < 12 && engine.fighters[0].statuses.some((status) => status.identityId === 'WT_REPAIRING'); index += 1) {
      withRandomSequence([0], () => engine.step({ current: false }));
    }
    const completionIndex = logs.findIndex((entry) => entry.text.includes('抢修完成'));
    const unableIndices = logs
      .map((entry, index) => entry.text.includes('抢修中') && entry.text.includes('无法行动') ? index : -1)
      .filter((index) => index >= 0);
    const lastUnableIndex = unableIndices[unableIndices.length - 1] ?? -1;
    assert(lastUnableIndex >= 0 && completionIndex > lastUnableIndex, 'repair completion must be logged after the final skipped action');
    cases.push('repair completion follows the final repair action skip');
  }

  {
    const source = prepareFighter(makeFighter('时序灼烧来源@A'));
    const owl = prepareFighter(makeFighter('时序鸮@B'));
    owl.isOwl = true;
    owl.owlState = { phase: 2, warForm: 'defeat', warFormStartedTurn: 0, heavenStacks: 0, sweepUsed: false };
    replaceTestStatuses(owl, [{ identityId: 'BURN', count: 1, attribution: { applierId: source.id, applierName: source.name } }]);
    const { engine, logs } = makeDeathEngine([source, owl]);
    settleBurnAtLargeRound(engine.createStatusMechanicsRuntime(), 1);
    const mitigationIndex = logs.findIndex((entry) => entry.text.includes('败兵阵势'));
    const resultIndex = logs.findIndex((entry) => entry.text.includes('实际损失'));
    assert(mitigationIndex >= 0 && resultIndex > mitigationIndex, 'DoT mitigation should be explained before final HP loss');
    cases.push('DoT mitigation logs precede the final damage result');
  }

  {
    const source = prepareFighter(makeFighter('爆燃锁血来源@A'));
    const target = prepareFighter(makeFighter('爆燃锁血目标@B'));
    target.isYuzu = true;
    target.yuzuPhase = 1;
    replaceTestStatuses(target, [{ identityId: 'BURN', count: 2, attribution: { applierId: source.id, applierName: source.name } }]);
    localProject.setCurrentHp(target, 1);
    const { engine, logs } = makeDeathEngine([source, target]);
    const engineTarget = engine.fighters[1];
    removeBarriers(engineTarget);
    const events = triggerBurn(engine.createStatusMechanicsRuntime(), engineTarget, 3);
    const lockLogs = logs.filter((entry) => entry.text.includes('触发了锁血保护'));
    assert(lockLogs.length === 1, `explicit burn settlement should emit one lockblood log, got ${lockLogs.length}`);
    assert(events.length === 1, `phase lock should stop the remaining forced burn settlements, got ${events.length}`);
    cases.push('explicit burn settlement deduplicates nested phase-lock logs');
  }

  {
    const source = prepareFighter(makeFighter('爆燃致死来源@A'), 100);
    const target = prepareFighter(makeFighter('爆燃致死目标@B'), 100);
    replaceTestStatuses(target, [{ identityId: 'BURN', count: 1, attribution: { applierId: source.id, applierName: source.name } }]);
    localProject.setCurrentHp(target, 2);
    const { engine, logs } = makeDeathEngine([source, target]);
    const engineTarget = engine.fighters[1];

    triggerBurn(engine.createStatusMechanicsRuntime(), engineTarget);

    assert(engineTarget.isDeadAnnounced, 'explicit burn settlement should defeat the low-health target');
    const resultIndex = logs.findIndex((entry) => entry.text.includes('爆燃致死目标') && entry.text.includes('实际损失'));
    const defeatIndex = logs.findIndex((entry) => entry.text.includes('爆燃致死目标') && entry.text.includes('后续伤害击倒'));
    assert(resultIndex >= 0 && defeatIndex > resultIndex, 'burn damage must be explained before its defeat log');
    cases.push('explicit burn settlement logs damage before defeat');
  }

  {
    const attacker = prepareFighter(makeFighter('最低伤害攻击者@A'));
    const yuzu = prepareFighter(makeFighter('唯一目标柚子@B'));
    const marked = prepareFighter(makeFighter('镜界标记@C'));
    yuzu.isYuzu = true;
    yuzu.yuzuPhase = 3;
    yuzu.yuzuMarkedTargetId = marked.id;
    const { engine, logs } = makeDeathEngine([attacker, yuzu, marked]);
    engine.applyDamage(engine.fighters[1], 1, 'skill', false, engine.fighters[0], { deferTransform: true, actionName: '一点伤害' });
    assert(!logs.some((entry) => entry.text.includes('偏折 0 点')), 'minimum damage should not emit a zero-value Unique Target reduction');
    cases.push('minimum damage omits zero-value Unique Target reduction logs');
  }

  {
    const source = prepareFighter(makeFighter('控制施加者@A'));
    const target = prepareFighter(makeFighter('控制免疫者@B'));
    replaceTestStatuses(target, [{ identityId: 'BKB', remainingTurns: 2 }]);
    const { engine } = makeDeathEngine([source, target]);
    const [engineSource, engineTarget] = engine.fighters;
    for (const type of ['STUN', 'CONFUSED', 'EMBARRASSED', 'CHARMED']) {
      assert(!engine.applyStatus(engineTarget, {
        identityId: type,
        remainingTurns: 2,
        attribution: { applierId: engineSource.id, applierName: engineSource.name },
      }), `${type} should be blocked by control immunity`);
      assert(!engineTarget.statuses.some((status) => status.identityId === type), `${type} must not remain after being blocked`);
    }
    cases.push('all four primary control families are blocked by control immunity');
  }

  {
    const fighter = prepareFighter(makeFighter('部分净化控制目标@A'));
    const observer = prepareFighter(makeFighter('部分净化旁观者@B'));
    replaceTestStatuses(fighter, [
      { identityId: 'BKB', remainingTurns: 2 },
      { identityId: 'STUN', remainingTurns: 2 },
      { identityId: 'WT_REPAIRING', remainingTurns: 2 },
    ]);
    const { engine } = makeDeathEngine([fighter, observer]);
    const result = engine.processStatusTurn(engine.fighters[0]);

    assert(!engine.fighters[0].statuses.some((status) => status.identityId === 'STUN'), 'BKB should cleanse the spell-immunity-blocked stun');
    assert(engine.fighters[0].statuses.some((status) => status.identityId === 'WT_REPAIRING'), 'BKB should leave the independent repairing lock in place');
    assert(!result.canAct && result.blockingStatusType === 'WT_REPAIRING', 'Removing one control must not bypass another action-blocking status that remains');
    cases.push('partial control cleansing recalculates the remaining action lock');
  }

  {
    const m1 = prepareFighter(makeFighter('M1A2_abrams_sep@A'));
    m1.isWT = true;
    m1.wtFpeCharges = 1;
    m1.wtNbcsCharges = 1;
    replaceTestStatuses(m1, [{ identityId: 'BURN', count: 2 }, { identityId: 'POISON', remainingTurns: 2, potency: 3 }, { identityId: 'BLEED', count: 2 }]);
    localProject.setCurrentHp(m1, 400);
    const enemy = prepareFighter(makeFighter('M1抢修旁观者@B'));
    const { engine, logs } = makeDeathEngine([m1, enemy]);
    engine.executeSkillAction('wt_repair_premium', engine.fighters[0], engine.fighters[1]);
    const joined = logs.map((entry) => entry.text).join('\n');
    assert(!engine.fighters[0].statuses.some((status) => ['BURN', 'POISON', 'BLEED'].includes(status.identityId)), 'premium repair should clean burn, poison, and bleed');
    assert(joined.includes('FPE灭火') && joined.includes('核生化洗消') && joined.includes('乘员急救'), 'M1 cleanup should use distinct fire, poison, and bleeding logs');
    const repairCauseIndex = logs.findIndex((entry) => entry.text.includes('FPE灭火'));
    const repairStartIndex = logs.findIndex((entry) => entry.text.includes('【战地抢修】'));
    const repairDispelIndex = logs.findIndex((entry) => entry.text.includes('【强驱散】'));
    const repairCompletionIndex = logs.findIndex((entry) => entry.text.includes('【抢修完成】'));
    assert(repairStartIndex >= 0 && repairCauseIndex > repairStartIndex, 'M1 repair must announce the repair action before its subsystem outcomes');
    assert(repairDispelIndex > repairCauseIndex, 'M1 repair should announce the specific cleanup system before listing its exact dispel result');
    assert(repairCompletionIndex > repairDispelIndex, 'M1 repair completion must follow its concrete cleanup and dispel results');
    cases.push('M1 uses separate FPE, NBCS, and medical cleanup paths');
  }

  {
    const attacker = prepareFighter(makeFighter('续关保护攻击者@A'));
    const gamer = prepareFighter(makeFighter('玄凝@B'));
    replaceTestStatuses(gamer, [{ identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'gamer_continue' } }]);
    const { engine, logs } = makeDeathEngine([attacker, gamer]);

    engine.executeSkillAction('serious_punch', engine.fighters[0], engine.fighters[1]);

    assert(logs.some((entry) => entry.text.includes('【CONTINUE?】') && entry.text.includes('续关保护')), 'Gamer continue spell block should keep its own source identity');
    assert(!logs.some((entry) => entry.text.includes('防护光幕') && entry.text.includes('续关保护攻击者')), 'Gamer continue spell block must not fall back to the generic defense name');
    cases.push('Gamer continue protection uses its dedicated defense identity');
  }

  {
    const sourceA = prepareFighter(makeFighter('毒素来源甲@A'));
    const sourceB = prepareFighter(makeFighter('毒素来源乙@B'));
    const target = prepareFighter(makeFighter('多来源中毒目标@C'));
    const { engine } = makeDeathEngine([sourceA, sourceB, target]);
    const [engineSourceA, engineSourceB, engineTarget] = engine.fighters;

    engine.applyStatus(engineTarget, { identityId: 'POISON', remainingTurns: 3, attribution: { effectSourceId: 'poison-a', applierId: engineSourceA.id, applierName: engineSourceA.name } });
    engine.applyStatus(engineTarget, { identityId: 'POISON', remainingTurns: 3, attribution: { effectSourceId: 'poison-a', applierId: engineSourceA.id, applierName: engineSourceA.name } });
    engine.applyStatus(engineTarget, { identityId: 'POISON', remainingTurns: 1, attribution: { effectSourceId: 'poison-b', applierId: engineSourceB.id, applierName: engineSourceB.name } });
    const poisonEntries = engineTarget.statuses.filter((status) => status.identityId === 'POISON');
    assert(poisonEntries.length === 2, `poison should retain two source instances, got ${poisonEntries.length}`);
    assert(poisonEntries.reduce((sum, status) => sum + (status.potency ?? 0), 0) === 3, 'poison should keep one global three-stack cap');

    engine.processStatusTurn(engineTarget);
    assert(Number(engineTarget.currentHp) === 940, 'the newest poison source should settle the shared three-stack tick once');
    assert(engineSourceB.stats.dmgDealt === 60, 'the newest poison source should receive the first tick credit');
    assert(!engineTarget.statuses.some((status) => status.attribution.effectSourceId === 'poison-b'), 'the one-turn newest poison source should expire independently');

    engine.processStatusTurn(engineTarget);
    assert(Number(engineTarget.currentHp) === 890, 'the older two-stack poison should continue at the five-percent profile');
    assert(engineSourceA.stats.dmgDealt === 50, 'poison ownership should fall back to the newest remaining source');
    cases.push('poison retains per-source lifetimes, one global cap, and latest-source credit fallback');
  }

  {
    const target = prepareFighter(makeFighter('旧状态乘区目标@A'));
    target.def = 100;
    applySingleTestStatus(target, { identityId: 'BABY_WEAKNESS_MARK', remainingTurns: 3, attribution: { effectSourceId: 'baby', applierId: 'baby' } });
    applySingleTestStatus(target, { identityId: 'VALO_VIPER_DECAY', remainingTurns: 3, attribution: { effectSourceId: 'viper', applierId: 'viper' } });
    applySingleTestStatus(target, { identityId: 'YUZU_DEF_DOWN', remainingTurns: 3, attribution: { effectSourceId: 'yuzu', applierId: 'yuzu' } });
    const legacyStandardDef = getEffectiveCombatStat(target, 'def', 'standard');
    assert(Math.abs(legacyStandardDef - 21.7) < 0.001, `legacy defense skins must preserve sequential multiplication, got ${legacyStandardDef}`);
    assert(getEffectiveCombatStat(target, 'def', 'custom') === 100, 'standard-only legacy defense skins must not leak into custom formulas');

    const generic = prepareFighter(makeFighter('通用状态加区目标@A'));
    generic.def = 100;
    applySingleTestStatus(generic, { identityId: 'DEF_DOWN', potency: 10, remainingTurns: 2, attribution: { effectSourceId: 'generic-a', applierId: 'a' } });
    applySingleTestStatus(generic, { identityId: 'DEF_DOWN', potency: 20, remainingTurns: 2, attribution: { effectSourceId: 'generic-b', applierId: 'b' } });
    assert(getEffectiveCombatStat(generic, 'def', 'custom') === 70, 'new same-direction numeric statuses should add before becoming one multiplier');

    const genericSpeed = prepareFighter(makeFighter('通用迅捷目标@A'));
    applySingleTestStatus(genericSpeed, { identityId: 'HASTE', potency: 10, remainingTurns: 2, attribution: { effectSourceId: 'haste-a', applierId: 'a' } });
    applySingleTestStatus(genericSpeed, { identityId: 'HASTE', potency: 20, remainingTurns: 2, attribution: { effectSourceId: 'haste-b', applierId: 'b' } });
    assert(Math.abs(getActionSpeedMultiplier(genericSpeed) - 1.3) < 0.001, 'generic haste sources should add to thirty percent');

    const legacySpeed = prepareFighter(makeFighter('旧迅捷目标@A'));
    applySingleTestStatus(legacySpeed, { identityId: 'RABBIT_CALC_HASTE', remainingTurns: 2, attribution: { effectSourceId: 'calc' } });
    applySingleTestStatus(legacySpeed, { identityId: 'RABBIT_ZERO_HASTE', remainingTurns: 2, attribution: { effectSourceId: 'zero' } });
    assert(Math.abs(getActionSpeedMultiplier(legacySpeed) - 1.13 * 1.26) < 0.001, 'legacy Rabbit haste skins should retain multiplicative timing');
    cases.push('generic numeric states add while migrated legacy skins preserve their old multiplication and scope');
  }

  {
    const momo = prepareFighter(makeFighter('萌月沫沫@A'));
    const target = prepareFighter(makeFighter('麦霸双算目标@B'));
    target.def = 100;
    const { engine } = makeDeathEngine([momo, target]);
    engine.executeSkillAction('momo_mic_open', engine.fighters[0], engine.fighters[1]);
    const engineTarget = engine.fighters[1];
    const micStatus = engineTarget.statuses.find((status) => status.identityId === 'MOMO_MIC_DEF_DOWN');
    assert(engineTarget.def === 100, `Momo Mic must leave the raw defense untouched, got ${engineTarget.def}`);
    assert(!!micStatus, 'Momo Mic should expose its registered themed status');
    assert(getEffectiveCombatStat(engineTarget, 'def', 'standard') === 78, 'Momo Mic should be applied exactly once by the unified status calculator');
    cases.push('themed stat identities use the unified effective-stat calculator exactly once');
  }

  {
    const target = prepareFighter(makeFighter('多屏障目标@A'));
    grantBarrier(target, 50, {
      sourceId: 'generic:test-barrier',
      displayName: '通用测试屏障',
      tickMode: 'permanent',
    });
    grantBarrier(target, 100, {
      sourceId: 'yuzu:test-owner',
      displayName: '镜界护盾',
      tickMode: 'permanent',
      dispelTier: 'none',
    });
    assert(getBarrierTotal(target) === 150, `independent barrier sources should add to 150, got ${getBarrierTotal(target)}`);
    const barrierItems = buildFighterStatusPresentation(target).filter((item) => item.kind === 'barrier');
    assert(barrierItems.length === 2 && barrierItems.every((item) => item.valueLabel?.includes('/')), 'each generic barrier should have a precise blue-bar presentation entry');
    cases.push('generic and themed barriers coexist in the one barrier container');
  }

  {
    const source = prepareFighter(makeFighter('破裂来源@A'));
    const target = prepareFighter(makeFighter('破裂目标@B'));
    const { engine } = makeDeathEngine([source, target]);
    const [engineSource, engineTarget] = engine.fighters;
    engine.applyStatus(engineTarget, { identityId: 'RUPTURE', potency: 5, count: 2, attribution: { effectSourceId: 'rupture-test', applierId: engineSource.id, applierName: engineSource.name } });
    grantBarrier(engineTarget, 100, { sourceId: 'rupture-shield', displayName: '破裂测试屏障', tickMode: 'permanent' });
    engine.applyDamage(engineTarget, 50, 'skill', true, engineSource, { sourceKind: 'custom', actionName: '屏障命中' });
    assert(queryMechanic(engineTarget, 'RUPTURE').count === 2, 'a shield-only direct hit must not consume or trigger rupture');
    removeBarriers(engineTarget);
    engine.applyDamage(engineTarget, 50, 'skill', true, engineSource, { sourceKind: 'custom', actionName: '生命命中' });
    assert(Number(engineTarget.currentHp) === 920, `a life-damaging direct hit should add 30 rupture damage, got ${engineTarget.currentHp}`);
    assert(queryMechanic(engineTarget, 'RUPTURE').count === 1, 'one valid direct hit should consume one rupture count');
    cases.push('rupture triggers only after direct HP damage and ignores shield-only hits');
  }

  {
    const source = prepareFighter(makeFighter('转移攻击来源@A'));
    const originalTarget = prepareFighter(makeFighter('转移原目标@B'));
    const actualTarget = prepareFighter(makeFighter('转移实际承伤者@C'));
    const { engine } = makeDeathEngine([source, originalTarget, actualTarget]);
    const [engineSource, engineOriginalTarget, engineActualTarget] = engine.fighters;
    engine.applyStatus(engineActualTarget, { identityId: 'RUPTURE', potency: 5, count: 1, attribution: { effectSourceId: 'redirected-rupture', applierId: engineSource.id, applierName: engineSource.name } });
    const options: import('../../../lib/namearena/types').DamageApplicationOptions = {
      sourceKind: 'transfer',
      originSourceKind: 'custom',
      originalTargetId: engineOriginalTarget.id,
      actionName: '直接攻击转移',
    };
    engine.applyDamage(engineActualTarget, 50, 'transfer', true, engineSource, options);
    assert(Number(engineActualTarget.currentHp) === 920, 'the actual receiver of a transferred direct attack should trigger its own rupture');
    assert(!engineActualTarget.statuses.some((status) => status.mechanicId === 'RUPTURE'), 'redirected direct damage should consume the actual receiver rupture count');
    assert(
      options.resolution?.sourceKind === 'transfer' &&
      options.resolution.originSourceKind === 'custom' &&
      options.resolution.originalTargetId === engineOriginalTarget.id &&
      options.resolution.actualTargetId === engineActualTarget.id,
      'a transfer record must preserve transfer kind, original direct kind, original target, and actual receiver',
    );
    cases.push('transferred direct attacks settle aftermath on the actual receiver with full lineage');
  }

  {
    const source = prepareFighter(makeFighter('转阶伤口来源@A'));
    const yuzu = prepareFighter(makeFighter('柚子@B'));
    yuzu.isYuzu = true;
    yuzu.yuzuPhase = 1;
    localProject.setCurrentHp(yuzu, 700);
    const { engine } = makeDeathEngine([source, yuzu]);
    const [engineSource, engineYuzu] = engine.fighters;
    removeBarriers(engineYuzu);
    engine.applyStatus(engineYuzu, { identityId: 'RUPTURE', potency: 20, count: 1, attribution: { applierId: engineSource.id, applierName: engineSource.name } });
    engine.applyStatus(engineYuzu, { identityId: 'SINKING', potency: 10, count: 1, attribution: { applierId: engineSource.id, applierName: engineSource.name } });
    engine.applyDamage(engineYuzu, 1, 'skill', true, engineSource, { sourceKind: 'custom', actionName: '转阶伤口测试' });
    assert(engineYuzu.yuzuPhase === 2, 'rupture aftermath should be able to cause the intended phase transition');
    assert(engineYuzu.morale === 100 && queryMechanic(engineYuzu, 'SINKING').count === 1, 'later same-hit aftermath must stop after rupture transitions the target to a new phase');
    cases.push('same-hit aftermath stops before touching a newly entered phase');
  }

  {
    const source = prepareFighter(makeFighter('沉沦来源@A'));
    const target = prepareFighter(makeFighter('沉沦玩家@B'));
    const npc = prepareFighter(makeFighter('沉沦NPC@C'));
    npc.isNpc = true;
    const { engine } = makeDeathEngine([source, target, npc]);
    const [engineSource, engineTarget, engineNpc] = engine.fighters;
    engine.applyStatus(engineTarget, { identityId: 'SINKING', potency: 12, count: 2, attribution: { applierId: engineSource.id, applierName: engineSource.name } });
    engine.applyDamage(engineTarget, 20, 'skill', true, engineSource, { sourceKind: 'custom', actionName: '沉沦触发' });
    assert(engineTarget.morale === 88, `player sinking should reduce morale by potency, got ${engineTarget.morale}`);
    assert(queryMechanic(engineTarget, 'SINKING').count === 1, 'player sinking should consume one count');

    engine.applyStatus(engineNpc, { identityId: 'SINKING', potency: 10, count: 1, attribution: { applierId: engineSource.id, applierName: engineSource.name } });
    grantBarrier(engineNpc, 5, { sourceId: 'npc-sinking-shield', displayName: 'NPC屏障', tickMode: 'permanent' });
    engine.applyDamage(engineNpc, 1, 'skill', true, engineSource, { sourceKind: 'custom', bypassShields: true, actionName: 'NPC沉沦触发' });
    assert(engineNpc.morale === undefined, 'NPCs must not gain a morale resource');
    assert(Number(engineNpc.currentHp) === 994, `NPC sinking should become potency damage after its shield absorbs five, got ${engineNpc.currentHp}`);
    cases.push('sinking reduces player morale and becomes shieldable fixed damage on NPCs');
  }

  {
    const attacker = prepareFighter(makeFighter('踉跄测试攻击者@A'));
    const target = prepareFighter(makeFighter('踉跄测试目标@B'));
    const puppet = prepareFighter(makeFighter('小汀(傀儡)@B'));
    puppet.isSummon = true;
    puppet.summonerId = target.id;
    puppet.summonBaseName = '小汀(傀儡)';
    const { engine } = makeDeathEngine([attacker, target, puppet]);
    const [engineAttacker, engineTarget, enginePuppet] = engine.fighters;
    applySingleTestStatus(engineTarget, { identityId: 'COUNTER', remainingTurns: 2 });
    applySingleTestStatus(engineTarget, { identityId: 'WAIT_COUNTER', charges: 2 });
    engine.applyStatus(engineTarget, { identityId: 'TREMOR', potency: 20, count: 2, attribution: { applierId: engineAttacker.id, applierName: engineAttacker.name } });
    burstTremor(engineTarget, 2);
    assert(engineTarget.statuses.some((status) => status.mechanicId === 'STAGGERED'), 'two twenty-point tremor bursts should cross the forty-point stagger threshold');
    assert(getIncomingDirectStatusMultiplier(engineTarget, 'custom', 'physical') === 1.25, 'stagger should add twenty-five percent incoming direct damage');
    assert(!engine.handleCounterStatus(engineTarget, engineAttacker), 'staggered targets must not fire an ordinary counter stance');
    assert(engineTarget.statuses.some((status) => status.identityId === 'COUNTER'), 'an inert counter should remain available after stagger ends');

    applySingleTestStatus(enginePuppet, { identityId: 'STAGGERED', remainingTurns: 1 });
    assert(!findActivePuppetProtector(engine.createTargetingRuntime(), engineTarget, engineAttacker), 'a staggered Puppet Ting must not intercept attacks');
    const statusTurn = engine.processStatusTurn(engineTarget, { deferSelfOpportunitySettlement: true });
    assert(engineTarget.statuses.some((status) => status.mechanicId === 'STAGGERED'), 'stagger must remain active throughout the owner next action opportunity');
    settleSelfOpportunityStatuses(
      engine.createStatusProcessingRuntime(),
      engineTarget,
      statusTurn.selfOpportunityStatuses,
      statusTurn.selfOpportunityBarriers,
      statusTurn.selfOpportunityStatusVersions,
      statusTurn.selfOpportunityBarrierVersions,
    );
    assert(!engineTarget.statuses.some((status) => status.mechanicId === 'STAGGERED'), 'stagger should end only after that action opportunity settles');
    cases.push('tremor stagger covers one full opportunity and disables evasion, counters, and interception');
  }

  {
    const fighter = prepareFighter(makeFighter('充能测试者@A'));
    applySingleTestStatus(fighter, { identityId: 'CHARGE', potency: 5, attribution: { effectSourceId: 'charge-test' } });
    const chargeStatus = findMechanic(fighter, 'CHARGE');
    const chargePresentation = buildFighterStatusPresentation(fighter).find((entry) => entry.name === '充能');
    assert(
      chargeStatus?.tickMode === 'self_opportunity' && chargeStatus.expiresOn === 'self_opportunity_end',
      'charge must use its declared self-opportunity resource clock without a fake permanent duration',
    );
    assert(chargePresentation?.clockLabel === '每次自身行动机会后', 'charge UI should expose its real decay clock instead of claiming permanence');
    assert(!spendCharge(fighter, 6) && queryMechanic(fighter, 'CHARGE').potency === 5, 'an unaffordable charge cost must fail without partial payment');
    assert(spendCharge(fighter, 3) && queryMechanic(fighter, 'CHARGE').potency === 2, 'an affordable charge cost should deduct atomically');
    advanceEffects(fighter, { tickMode: 'self_opportunity', instanceIds: chargeStatus ? [chargeStatus.instanceId] : [] });
    assert(queryMechanic(fighter, 'CHARGE').potency === 1, 'charge should decay by one after a self opportunity');
    assert(spendCharge(fighter, 1) && !fighter.statuses.some((status) => status.mechanicId === 'CHARGE'), 'charge should remove itself after reaching zero');

    const moraleFighter = prepareFighter(makeFighter('士气测试者@A'));
    const moraleTarget = prepareFighter(makeFighter('士气伤害目标@B'));
    const { engine } = makeDeathEngine([moraleFighter, moraleTarget]);
    const [engineMoraleFighter, engineMoraleTarget] = engine.fighters;
    const breakdown = changeMorale(engineMoraleFighter, -100);
    assert(breakdown.breakdown && engineMoraleFighter.morale === 50, 'zero morale should create breakdown and reset morale to fifty');
    assert(engine.selectSkill(engineMoraleFighter) === null, 'mental breakdown should force a normal non-critical attack selection');
    settleSelfOpportunityResources(engineMoraleFighter, true);
    assert(!engineMoraleFighter.statuses.some((status) => status.mechanicId === 'MENTAL_BREAKDOWN'), 'breakdown should be consumed only after a completed action');
    engineMoraleFighter.morale = 20;
    engine.applyDamage(engineMoraleTarget, 100, 'skill', true, engineMoraleFighter, { sourceKind: 'custom', actionName: '低士气直击' });
    assert(Number(engineMoraleTarget.currentHp) === 915, `low morale should reduce direct output by fifteen percent, got ${engineMoraleTarget.currentHp}`);
    cases.push('charge spending is atomic and the complete morale breakdown loop is active');
  }

  {
    const source = prepareFighter(makeFighter('驱散来源@A'));
    const target = prepareFighter(makeFighter('驱散目标@B'));
    const { engine, logs } = makeDeathEngine([source, target]);
    const [engineSource, engineTarget] = engine.fighters;
    engine.applyStatus(engineTarget, { identityId: 'BURN', count: 2, attribution: { applierId: engineSource.id, applierName: engineSource.name } });
    engine.applyStatus(engineTarget, { identityId: 'STUN', remainingTurns: 2, attribution: { applierId: engineSource.id, applierName: engineSource.name } });
    applySingleTestStatus(engineTarget, { identityId: 'TING_DEFIANCE', remainingTurns: 3 });
    const normal = engine.dispelStatusEffects(engineTarget, { strength: 'normal', direction: 'negative', identityIds: ['BURN', 'STUN'] });
    assert(normal.removed.some((status) => status.identityId === 'BURN'), 'normal dispel should remove normally dispellable negatives');
    assert(normal.blocked.some((status) => status.identityId === 'STUN'), 'normal dispel should report strong-only control as blocked');
    const strong = engine.dispelStatusEffects(engineTarget, { strength: 'strong', direction: 'negative', identityIds: ['STUN'] });
    assert(strong.removed.some((status) => status.identityId === 'STUN'), 'strong dispel should remove strong-only control');
    const absolute = engine.dispelStatusEffects(engineTarget, {
      strength: 'absolute',
      direction: 'all',
      includeIndependent: true,
      identityIds: ['TING_DEFIANCE'],
    });
    assert(absolute.removed.some((status) => status.identityId === 'TING_DEFIANCE'), 'absolute dispel should remove an explicitly selected independent lock state');

    applySingleTestStatus(engineTarget, { identityId: 'LIQUID_BODY' });
    const excludedStatus = engine.dispelStatusEffects(engineTarget, {
      strength: 'absolute',
      direction: 'all',
      includeIndependent: true,
      identityIds: ['LIQUID_BODY'],
      excludeIdentityIds: ['LIQUID_BODY'],
    });
    assert(engineTarget.statuses.some((status) => status.identityId === 'LIQUID_BODY'), 'an explicitly excluded status must remain active');
    assert(excludedStatus.removed.length === 0 && excludedStatus.blocked.length === 0, 'an excluded status must be omitted rather than misreported as resisting dispel');

    grantBarrier(engineTarget, 80, { sourceId: 'excluded-barrier', displayName: '排除屏障' });
    const excludedBarrier = engine.dispelStatusEffects(engineTarget, {
      strength: 'absolute',
      direction: 'positive',
      barrierSourceIds: ['excluded-barrier'],
      excludeBarrierSourceIds: ['excluded-barrier'],
    });
    assert(getBarrierTotal(engineTarget) === 80, 'an explicitly excluded barrier must remain active');
    assert(excludedBarrier.removedBarriers.length === 0 && excludedBarrier.blockedBarriers.length === 0, 'an excluded barrier must not be misreported as resisting dispel');
    removeBarriers(engineTarget, { sourceIds: ['excluded-barrier'] });

    engine.applyStatus(engineTarget, { identityId: 'AIRBORNE', remainingTurns: 1, attribution: { applierId: engineSource.id, applierName: engineSource.name } });
    const hpBeforeLanding = engineTarget.currentHp;
    const blockedLanding = engine.dispelStatusEffects(engineTarget, { strength: 'normal', direction: 'negative', identityIds: ['AIRBORNE'] });
    assert(blockedLanding.blocked.some((status) => status.identityId === 'AIRBORNE'), 'normal dispel must not remove airborne');
    engine.dispelStatusEffects(engineTarget, { strength: 'strong', direction: 'negative', identityIds: ['AIRBORNE'] });
    assert(engineTarget.currentHp === hpBeforeLanding - 30, 'strong-dispelling airborne should immediately deal three-percent landing damage');
    assert(logs.some((entry) => entry.text.includes('提前落地')) && logs.some((entry) => entry.text.includes('击飞坠地')), 'airborne strong dispel should log both cause and landing result');
    cases.push('normal, strong, and absolute dispels obey tiers, exclusions, and strong airborne landing');
  }

  {
    const water = prepareFighter(makeFighter('水人@A'));
    const gamer = prepareFighter(makeFighter('玄凝@A'));
    const enemy = prepareFighter(makeFighter('显式组队敌人@B'));
    const { engine } = makeDeathEngine([water, gamer, enemy]);
    const targets = getSelectableTargets(engine.createTargetingRuntime(), engine.fighters[0]);

    assert(engine.getTeamId(engine.fighters[0]) === 'A', 'an explicitly teamed Waterman should preserve the declared team id');
    assert(!targets.some((target) => target.id === engine.fighters[1].id), 'Waterman must not target an explicitly declared teammate');
    assert(targets.some((target) => target.id === engine.fighters[2].id), 'Waterman should still target fighters on another declared team');
    cases.push('Waterman respects explicit team input during target selection');
  }

  {
    const water = prepareFighter(makeFighter('水人@A'));
    water.isMorphling = true;
    const gamer = prepareFighter(makeFighter('玄凝@B'));
    gamer.isGamer = true;
    replaceTestStatuses(gamer, [{ identityId: 'WATER_PRISON', remainingTurns: 3, attribution: { applierId: water.id, applierName: water.name } }, { identityId: 'POISON', remainingTurns: 2, attribution: { applierId: water.id, applierName: water.name } }]);
    localProject.setCurrentHp(gamer, 0);
    gamer.isDeadAnnounced = true;
    const { engine, logs } = makeDeathEngine([water, gamer]);
    const engineGamer = engine.fighters[1];

    assert(engine.tryMorphlingSonRescue(engineGamer), 'an active Waterman should rescue the defeated original Gamer once');
    assert(engine.getTeamId(engineGamer) === engine.getTeamId(engine.fighters[0]), 'a rescued Gamer should inherit the active Waterman\'s actual team');
    const rescueIndex = logs.findIndex((entry) => entry.text.includes('被水人救起并转职'));
    const cleanseIndex = logs.findIndex((entry) => entry.text.includes('【绝对驱散】'));
    assert(rescueIndex >= 0 && cleanseIndex > rescueIndex, 'Waterman rescue must explain the revival before listing its exact cleanse result');
    assert(!engineGamer.statuses.some((status) => status.identityId === 'WATER_PRISON' || status.identityId === 'POISON'), 'Waterman rescue should still clear the rescued fighter statuses');
    cases.push('Waterman rescue explains revival before its exact absolute-dispel result');
  }

  {
    const water = prepareFighter(makeFighter('水人@A'));
    water.isMorphling = true;
    const gamer = prepareFighter(makeFighter('玄凝@B'));
    gamer.isGamer = true;
    gamer.hasUsedGamerContinue = true;
    const { engine } = makeDeathEngine([water, gamer]);
    const [engineWater, engineGamer] = engine.fighters;
    localProject.setCurrentHp(engineGamer, 0);

    engine.finalizeFighterDeath(engineGamer, { current: false }, '完整死亡入口救子测试', engineWater);

    assert(engineGamer.isSon && engineGamer.job === 'MORPHLING_SON', 'full death finalization should still trigger Waterman son rescue');
    assert(engine.getTeamId(engineGamer) === engine.getTeamId(engineWater), 'full death finalization should preserve Waterman team inheritance');
    assert(!engineGamer.isDead && !engineGamer.isDeadAnnounced && engineGamer.currentHp === engineGamer.maxHp, 'outer death finalization must not overwrite a synchronous Waterman rescue');
    cases.push('Waterman son rescue survives the complete outer death finalization path');
  }

  {
    const succubus = prepareFighter(makeFighter('克蕾儿丝菲尔@A'));
    succubus.isSuccubus = true;
    replaceTestStatuses(succubus, [{ identityId: 'BURN', potency: 6, count: 2 }]);
    localProject.setCurrentHp(succubus, 400);
    const observer = prepareFighter(makeFighter('变身日志旁观者@B'));
    const { engine, logs } = makeDeathEngine([succubus, observer]);

    engine.handleTransformations(engine.fighters[0]);
    const transformIndex = logs.findIndex((entry) => entry.type === 'transform' && entry.text.includes('合成兽'));
    const cleanseIndex = logs.findIndex((entry) => entry.text.includes('【强驱散】'));
    assert(transformIndex >= 0 && cleanseIndex > transformIndex, 'a phase transformation must be narrated before its built-in cleanup result');
    cases.push('phase transformation narration precedes its exact cleanup result');
  }

  {
    const gacha = prepareFighter(makeFighter('牢鳄@A'));
    gacha.isGacha = true;
    gacha.transformed = true;
    gacha.jobData = { ...gacha.jobData, name: '欧皇' };
    replaceTestStatuses(gacha, [{ identityId: 'BURN', potency: 6, count: 2 }]);
    localProject.setCurrentHp(gacha, 0);
    const observer = prepareFighter(makeFighter('护符日志旁观者@B'));
    const { engine, logs } = makeDeathEngine([gacha, observer]);

    assert(!engine.markDefeated(engine.fighters[0]), 'the first lethal outcome should be intercepted by the Luck Emperor charm');
    const charmIndex = logs.findIndex((entry) => entry.text.includes('【欧皇护符】'));
    const cleanseIndex = logs.findIndex((entry) => entry.text.includes('【强驱散】'));
    assert(charmIndex >= 0 && cleanseIndex > charmIndex, 'the Luck Emperor charm must explain the death save before listing its cleanup result');
    cases.push('Luck Emperor death save narration precedes its exact cleanup result');
  }

  {
    const attacker = prepareFighter(makeFighter('护符实战攻击者@A'));
    const gacha = prepareFighter(makeFighter('护符实战牢鳄@B'));
    gacha.isGacha = true;
    gacha.transformed = true;
    gacha.jobData = { ...gacha.jobData, name: '欧皇' };
    replaceTestStatuses(gacha, [{ identityId: 'POISON', remainingTurns: 2, potency: 3 }]);
    localProject.setCurrentHp(gacha, 40);
    const { engine, logs } = makeDeathEngine([attacker, gacha]);
    const [engineAttacker, engineGacha] = engine.fighters;
    const damageOptions: import('../../../lib/namearena/types').DamageApplicationOptions = {
      deferTransform: true,
      actionName: '护符延迟日志测试',
      sourceKind: 'custom',
    };

    engine.applyDamage(engineGacha, 100, 'skill', true, engineAttacker, damageOptions);
    assert(!logs.some((entry) => entry.text.includes('【强驱散】')), 'deferred lethal damage must not leak its dispel result ahead of the queued death-save cause');
    engine.flushDeferredDamageEvents(engineGacha);
    const charmIndex = logs.findIndex((entry) => entry.text.includes('【欧皇护符】'));
    const cleanseIndex = logs.findIndex((entry) => entry.text.includes('【强驱散】'));
    assert(charmIndex >= 0 && cleanseIndex > charmIndex, 'deferred lethal damage must keep the Luck Emperor cause ahead of its exact cleanup result');
    cases.push('deferred death-save logs keep cause and exact dispel in one ordered chain');
  }

  {
    const source = prepareFighter(makeFighter('精确驱散来源@A'));
    const target = prepareFighter(makeFighter('精确驱散目标@B'));
    const { engine } = makeDeathEngine([source, target]);
    const [engineSource, engineTarget] = engine.fighters;
    const firstPoison = applySingleTestStatus(engineTarget, { identityId: 'POISON', remainingTurns: 3, attribution: { effectSourceId: 'poison:first', applierId: engineSource.id, applierName: engineSource.name } });
    const secondPoison = applySingleTestStatus(engineTarget, { identityId: 'POISON', remainingTurns: 3, attribution: { effectSourceId: 'poison:second', applierId: engineSource.id, applierName: engineSource.name } });
    const precise = engine.dispelStatusEffects(engineTarget, {
      strength: 'normal',
      direction: 'negative',
      instanceIds: [firstPoison.instanceId!],
    });
    assert(precise.removed.length === 1 && precise.removed[0] === firstPoison, 'instance-targeted dispel should remove exactly the selected source instance');
    assert(engineTarget.statuses.includes(secondPoison), 'instance-targeted dispel must preserve a same-type status from another source');
    cases.push('instance-targeted dispel preserves same-type statuses from other sources');
  }

  {
    const healer = prepareFighter(makeFighter('净化治疗者@A'));
    const target = prepareFighter(makeFighter('净化治疗目标@A'));
    const enemy = prepareFighter(makeFighter('净化状态来源@B'));
    const { engine, logs } = makeDeathEngine([healer, target, enemy]);
    const [engineHealer, engineTarget, engineEnemy] = engine.fighters;
    localProject.setCurrentHp(engineTarget, 500);
    engine.applyStatus(engineTarget, { identityId: 'POISON', remainingTurns: 3, attribution: { applierId: engineEnemy.id, applierName: engineEnemy.name } });
    engine.applyStatus(engineTarget, { identityId: 'STUN', remainingTurns: 2, attribution: { applierId: engineEnemy.id, applierName: engineEnemy.name } });
    engine.executeSupportSkill({
      name: '净化治疗测试',
      tag: 'heal',
      mult: 1,
      dispelSpecs: [{ strength: 'normal', direction: 'negative', target: 'target', timing: 'after_recovery' }],
      text: '✨ {USER} 治疗 {TARGET} {VAL} 点生命，并进行一次异常净化！',
    }, engineHealer, engineTarget, engine.getTeamId(engineHealer));

    assert(!engineTarget.statuses.some((status) => status.identityId === 'POISON'), 'ordinary cleansing heal should remove normally dispellable poison');
    assert(engineTarget.statuses.some((status) => status.identityId === 'STUN'), 'ordinary cleansing heal must preserve strong-dispel-only stun');
    const healIndex = logs.findIndex((entry) => entry.text.includes('净化治疗测试') || entry.text.includes('并进行一次异常净化'));
    const dispelIndex = logs.findIndex((entry) => entry.text.includes('【驱散】') && entry.text.includes('中毒'));
    assert(healIndex >= 0 && dispelIndex > healIndex, 'cleansing heal should announce the action before its exact dispel outcome');
    assert(!logs.some((entry) => /(?:解除|清除)了所有异常状态/.test(entry.text)), 'partial cleansing must never claim that every abnormal status was removed');
    cases.push('cleansing heals narrate their action before the exact partial-dispel outcome');
  }

  {
    const attacker = prepareFighter(makeFighter('声明驱散攻击者@A'));
    const target = prepareFighter(makeFighter('声明驱散目标@B'));
    const { engine, logs } = makeDeathEngine([attacker, target]);
    const [engineAttacker, engineTarget] = engine.fighters;
    engine.applyStatus(engineAttacker, { identityId: 'POISON', remainingTurns: 3, attribution: { effectSourceId: 'declarative:self-poison' } });
    engine.applyStatus(engineTarget, { identityId: 'REGEN', remainingTurns: 3, attribution: { effectSourceId: 'declarative:target-regen' } });
    engine.SKILLS.__status_before_dispel = {
      name: '行动前净化测试',
      tag: 'physical',
      mult: 0.1,
      alwaysHit: true,
      dispelSpecs: [{ strength: 'normal', direction: 'negative', target: 'user', timing: 'before_action' }],
      text: '{USER} 对 {TARGET} 发起净化后攻击，造成 {VAL} 点伤害。',
    };
    engine.executeSkillAction('__status_before_dispel', engineAttacker, engineTarget);
    assert(!engineAttacker.statuses.some((status) => status.identityId === 'POISON'), 'before-action declarative dispel should cleanse the declared user');
    const beforeDispelIndex = logs.findIndex((entry) => entry.text.includes('【驱散】') && entry.text.includes(engineAttacker.name));
    const attackIndex = logs.findIndex((entry) => entry.text.includes('净化后攻击'));
    assert(beforeDispelIndex >= 0 && attackIndex > beforeDispelIndex, 'before-action dispel must be logged before the attack begins');

    engine.SKILLS.__status_after_damage_dispel = {
      name: '伤害后驱散测试',
      tag: 'physical',
      mult: 0.1,
      alwaysHit: true,
      dispelSpecs: [{ strength: 'normal', direction: 'positive', target: 'target', timing: 'after_damage' }],
      text: '{USER} 对 {TARGET} 发动破除攻击，造成 {VAL} 点伤害。',
    };
    const secondStart = logs.length;
    engine.executeSkillAction('__status_after_damage_dispel', engineAttacker, engineTarget);
    assert(!engineTarget.statuses.some((status) => status.identityId === 'REGEN'), 'after-damage declarative dispel should remove the target positive status');
    const secondLogs = logs.slice(secondStart);
    const secondAttackIndex = secondLogs.findIndex((entry) => entry.text.includes('破除攻击'));
    const afterDispelIndex = secondLogs.findIndex((entry) => entry.text.includes('【驱散】') && entry.text.includes(engineTarget.name));
    assert(secondAttackIndex >= 0 && afterDispelIndex > secondAttackIndex, 'after-damage dispel must be logged after the damage action');
    cases.push('declarative attack dispels honor user/target selection and before/after timing');
  }

  {
    const healer = prepareFighter(makeFighter('全队净化者@A'));
    const ally = prepareFighter(makeFighter('全队净化友军@A'));
    const enemy = prepareFighter(makeFighter('全队净化敌军@B'));
    const { engine } = makeDeathEngine([healer, ally, enemy]);
    const [engineHealer, engineAlly, engineEnemy] = engine.fighters;
    [engineHealer, engineAlly, engineEnemy].forEach((fighter) => {
      engine.applyStatus(fighter, { identityId: 'POISON', remainingTurns: 3, attribution: { effectSourceId: `team-cleanse:${fighter.id}` } });
    });
    localProject.setCurrentHp(engineAlly, 500);
    engine.executeSupportSkill({
      name: '全队净化测试',
      tag: 'heal',
      mult: 0.1,
      dispelSpecs: [{ strength: 'normal', direction: 'negative', target: 'allies', timing: 'after_recovery' }],
      text: '{USER} 为 {TARGET} 恢复 {VAL} 点生命并展开全队净化。',
    }, engineHealer, engineAlly, engine.getTeamId(engineHealer));
    assert(!engineHealer.statuses.some((status) => status.identityId === 'POISON'), 'allies dispel should include the caster');
    assert(!engineAlly.statuses.some((status) => status.identityId === 'POISON'), 'allies dispel should include active teammates');
    assert(engineEnemy.statuses.some((status) => status.identityId === 'POISON'), 'allies dispel must not cleanse enemy units');
    cases.push('declarative allies dispel affects the full active team without touching enemies');
  }

  {
    const source = prepareFighter(makeFighter('驱散等级来源@A'));
    const target = prepareFighter(makeFighter('驱散等级目标@B'));
    const { engine } = makeDeathEngine([source, target]);
    const engineTarget = engine.fighters[1];
    const strongOnlyTypes = [
      'WEAK', 'NO_HEAL', 'WT_BREECH_DAMAGED', 'WT_TRACK_DAMAGED',
      'WT_AMMO_EXPOSED', 'WT_SCOUTED', 'WT_REPAIRING', 'ZEROED',
    ];
    strongOnlyTypes.forEach((type) => applySingleTestStatus(engineTarget, { identityId: type, remainingTurns: 2, attribution: { effectSourceId: `tier:${type}` } }));
    applySingleTestStatus(engineTarget, { identityId: 'RAGE', remainingTurns: 2, attribution: { effectSourceId: 'tier:rage' } });

    const normal = engine.dispelStatusEffects(engineTarget, { strength: 'normal', direction: 'all', includeNeutral: true });
    strongOnlyTypes.forEach((type) => {
      assert(normal.blocked.some((status) => status.identityId === type), `normal dispel should report ${type} as blocked`);
      assert(engineTarget.statuses.some((status) => status.identityId === type), `normal dispel must preserve ${type}`);
    });
    assert(engineTarget.statuses.some((status) => status.identityId === 'RAGE'), 'ordinary dispel must preserve the independent rage resource');

    const strong = engine.dispelStatusEffects(engineTarget, { strength: 'strong', direction: 'all', includeNeutral: true });
    strongOnlyTypes.forEach((type) => assert(strong.removed.some((status) => status.identityId === type), `strong dispel should remove ${type}`));
    assert(engineTarget.statuses.some((status) => status.identityId === 'RAGE'), 'strong dispel must preserve the independent rage resource');
    const absolute = engine.dispelStatusEffects(engineTarget, {
      strength: 'absolute',
      direction: 'all',
      includeNeutral: true,
      identityIds: ['RAGE'],
    });
    assert(absolute.removed.some((status) => status.identityId === 'RAGE'), 'absolute dispel should remove explicitly selected rage');
    cases.push('legacy controls, vehicle modules, and resources obey their intended dispel tiers');
  }

  {
    const source = prepareFighter(makeFighter('归零驱散来源@A'));
    const target = prepareFighter(makeFighter('归零驱散目标@B'));
    target.atk = 200;
    target.def = 160;
    target.res = 120;
    const { engine } = makeDeathEngine([source, target]);
    const engineTarget = engine.fighters[1];
    applySingleTestStatus(engineTarget, { identityId: 'ZEROED', remainingTurns: 2, attribution: { effectSourceId: 'zeroed:restore-test' } });
    assert(engineTarget.atk === 200 && engineTarget.def === 160 && engineTarget.res === 120, 'ZEROED must not rewrite raw combat stats');
    assert(
      Math.abs(getEffectiveCombatStat(engineTarget, 'atk') - 20) < 0.001 &&
      Math.abs(getEffectiveCombatStat(engineTarget, 'def') - 16) < 0.001 &&
      Math.abs(getEffectiveCombatStat(engineTarget, 'res') - 12) < 0.001,
      'ZEROED should apply its penalty through the unified stat calculator',
    );
    engine.dispelStatusEffects(engineTarget, { strength: 'strong', direction: 'negative', identityIds: ['ZEROED'] });
    assert(
      getEffectiveCombatStat(engineTarget, 'atk') === 200 &&
      getEffectiveCombatStat(engineTarget, 'def') === 160 &&
      getEffectiveCombatStat(engineTarget, 'res') === 120,
      'strong-dispelling ZEROED should remove every calculated penalty',
    );
    cases.push('strong-dispelling ZEROED removes its unified calculation layer');
  }

  {
    const reader = prepareFighter(makeFighter('复合状态读取者@A'));
    const target = prepareFighter(makeFighter('复合状态目标@B'));
    reader.agl = 100;
    target.agl = 100;
    target.res = 200;
    applySingleTestStatus(reader, { identityId: 'Q_BUNNY_IDOL_AGL', remainingTurns: 2, attribution: { effectSourceId: 'idol-agility' } });
    applySingleTestStatus(target, { identityId: 'GAMER_READ_INPUTS', remainingTurns: 2, attribution: { effectSourceId: 'read-inputs' } });
    assert(getEffectiveCombatStat(reader, 'agl') === 100, 'idol agility must not leak into generic agility or custom skill scaling');
    assert(getAccuracyAgilityMultiplier(reader) === 1.2, 'idol agility should raise attacker-side hit-check agility exactly once');
    assert(getEvasionMultiplier(reader) === 1.2, 'idol agility should raise target-side evasion agility exactly once');
    assert(getEvasionMultiplier(target) === 0, 'read inputs should project its zero-evasion component');
    assert(getEffectiveCombatStat(target, 'res', 'standard') === 180, 'read inputs should project ten-percent standard-formula resistance loss');
    assert(getEffectiveCombatStat(target, 'res', 'custom') === 200, 'read inputs resistance loss must not leak into custom formulas');

    const neuralTarget = prepareFighter(makeFighter('神经取缔目标@B'));
    neuralTarget.agl = 10000;
    applySingleTestStatus(neuralTarget, { identityId: 'NEURAL_THEFT_DEBUFF', remainingTurns: 2, attribution: { effectSourceId: 'neural-theft' } });
    assert(getEvasionMultiplier(neuralTarget) === 0, 'neural theft should project zero evasion');
    assert(getOpeningCritBonus(neuralTarget) === 1, 'neural theft should project a one-hundred-point critical opening');
    assert(!!findMechanic(neuralTarget, 'SURE_HIT_TAKEN'), 'neural theft should project a guaranteed-hit marker');
    assert(!withRandomSequence([0.999], () => missesSkill(reader, neuralTarget, { name: '锁定测试', tag: 'physical', mult: 1 }, false)), 'neural theft should guarantee hit through the shared hit-check mechanic');

    const items = buildFighterStatusPresentation(neuralTarget);
    const neuralCard = items.find((item) => item.name === '被窃取情报');
    assert(!!neuralCard && items.filter((item) => item.name === '被窃取情报').length === 1, 'a composite theme should remain one visible status card');
    assert(neuralCard.detail.includes('闪避能力降为 0') && neuralCard.detail.includes('必定暴击') && neuralCard.detail.includes('必定命中'), 'composite status details should expose every mechanic in Chinese');

    const highestTarget = prepareFighter(makeFighter('多源破绽目标@B'));
    applySingleTestStatus(highestTarget, { identityId: 'NEURAL_THEFT_DEBUFF', remainingTurns: 2, attribution: { effectSourceId: 'neural-theft-first' } });
    applySingleTestStatus(highestTarget, { identityId: 'NEURAL_THEFT_DEBUFF', remainingTurns: 2, attribution: { effectSourceId: 'neural-theft-second' } });
    assert(getOpeningCritBonus(highestTarget) === 1, 'highest-only opening projections from multiple sources must not add together');

    const rageTarget = prepareFighter(makeFighter('狂暴复合目标@C'));
    applySingleTestStatus(rageTarget, { identityId: 'RAGE', remainingTurns: 2, attribution: { effectSourceId: 'rage:first' } });
    applySingleTestStatus(rageTarget, { identityId: 'RAGE', remainingTurns: 2, attribution: { effectSourceId: 'rage:second' } });
    assert(getOutgoingDirectStatusMultiplier(rageTarget, 'standard', 'physical', 'standard_formula') === 1.5, 'multiple rage sources should preserve the original single fifty-percent physical multiplier');
    assert(getOutgoingDirectStatusMultiplier(rageTarget, 'standard', 'magical', 'standard_formula') === 1, 'rage must not buff standard magical damage');
    assert(getOutgoingDirectStatusMultiplier(rageTarget, 'custom', 'physical', 'standard_formula') === 1, 'rage must not leak into custom damage formulas');
    applySingleTestStatus(rageTarget, { identityId: 'YUZU_TAUNT', remainingTurns: 2, attribution: { effectSourceId: 'hard-taunt' } });
    assert(getAggroMultiplier(rageTarget) === 1, 'Yuzu hard taunt must not silently become generic aggro weighting');
    cases.push('themed composite statuses project mechanics once while remaining one readable status card');
  }

  {
    const attacker = prepareFighter(makeFighter('呼吸暴击者@A'));
    const target = prepareFighter(makeFighter('呼吸目标@B'));
    const { engine } = makeDeathEngine([attacker, target]);
    const [engineAttacker, engineTarget] = engine.fighters;
    applySingleTestStatus(engineAttacker, { identityId: 'POISE', potency: 2, count: 2, remainingTurns: 2, attribution: { effectSourceId: 'poise-test' } });
    const critical = engine.calculateDamage(
      engineAttacker,
      engineTarget,
      { name: '呼吸必暴', tag: 'physical', mult: 1, alwaysCrit: true },
      engine.getTeamId(engineAttacker),
      'poise_crit_test',
    );
    assert(critical.logType === 'crit' && queryMechanic(engineAttacker, 'POISE').count === 1, 'a real critical hit should consume exactly one poise count');
    engine.calculateDamage(
      engineAttacker,
      engineTarget,
      { name: '禁止暴击', tag: 'physical', mult: 1, alwaysCrit: true, cannotCrit: true },
      engine.getTeamId(engineAttacker),
      'poise_no_crit_test',
    );
    assert(queryMechanic(engineAttacker, 'POISE').count === 1, 'an attack forbidden from critting must not consume poise');

    applySingleTestStatus(engineAttacker, { identityId: 'PARALYSIS', potency: 1, charges: 1, remainingTurns: 1, attribution: { effectSourceId: 'paralysis-test' } });
    const paralyzed = withRandomSequence([0.99], () => engine.calculateDamage(
      engineAttacker,
      engineTarget,
      { name: '麻痹攻击', tag: 'physical', mult: 1, alwaysCrit: true },
      engine.getTeamId(engineAttacker),
      'paralysis_test',
    ));
    assert(paralyzed.logType !== 'crit', 'paralysis should suppress even a forced critical hit');
    assert(!engineAttacker.statuses.some((status) => status.mechanicId === 'PARALYSIS'), 'paralysis should consume one charge after the attack calculation');

    applySingleTestStatus(engineAttacker, { identityId: 'PARALYSIS', potency: 1, charges: 1, remainingTurns: 1, attribution: { effectSourceId: 'paralysis-control-test' } });
    withRandomSequence([0.99], () => missesSkill(
      engineAttacker,
      engineTarget,
      { name: '纯控制判定', tag: 'debuff', noDamage: true },
      false,
    ));
    assert(engineAttacker.statuses.some((status) => status.mechanicId === 'PARALYSIS'), 'a pure no-damage control check must not consume paralysis even when it misses');
    cases.push('poise consumes only on real critical hits and paralysis forces a non-critical minimum roll');
  }

  {
    const attacker = prepareFighter(makeFighter('输出修正者@A'));
    const target = prepareFighter(makeFighter('承伤修正目标@B'));
    const { engine } = makeDeathEngine([attacker, target]);
    const [engineAttacker, engineTarget] = engine.fighters;
    applySingleTestStatus(engineAttacker, { identityId: 'OUTPUT_UP', potency: 25, remainingTurns: 2, attribution: { effectSourceId: 'output-up' } });
    applySingleTestStatus(engineAttacker, { identityId: 'OUTPUT_DOWN', potency: 10, remainingTurns: 2, attribution: { effectSourceId: 'output-down' } });
    applySingleTestStatus(engineTarget, { identityId: 'VULNERABILITY', potency: 20, remainingTurns: 2, attribution: { effectSourceId: 'vulnerable' } });
    applySingleTestStatus(engineTarget, { identityId: 'PROTECTION', potency: 10, remainingTurns: 2, attribution: { effectSourceId: 'protection' } });
    assert(Math.abs(getOutgoingDirectStatusMultiplier(engineAttacker, 'custom') - 1.125) < 0.001, 'output up and down should combine through the outgoing stage');
    assert(Math.abs(getIncomingDirectStatusMultiplier(engineTarget, 'custom') - 1.08) < 0.001, 'vulnerability and protection should combine through the incoming stage');
    engine.applyDamage(engineTarget, 100, 'skill', true, engineAttacker, { sourceKind: 'custom', actionName: '双向状态修正' });
    assert(Number(engineTarget.currentHp) === 880, `outgoing and incoming modifiers should resolve in order to 120 damage, got ${engineTarget.currentHp}`);

    const healingTarget = prepareFighter(makeFighter('治疗修正目标@A'));
    localProject.setCurrentHp(healingTarget, 500);
    applySingleTestStatus(healingTarget, { identityId: 'VITALITY', potency: 50, remainingTurns: 2, attribution: { effectSourceId: 'vitality' } });
    applySingleTestStatus(healingTarget, { identityId: 'EXHAUSTION', potency: 20, remainingTurns: 2, attribution: { effectSourceId: 'exhaustion' } });
    assert(healFighter(healingTarget, 100) === 120, 'vitality and exhaustion should modify direct healing through the shared healing pipeline');
    applySingleTestStatus(healingTarget, { identityId: 'NO_HEAL', remainingTurns: 2, attribution: { effectSourceId: 'no-heal' } });
    assert(healFighter(healingTarget, 100) === 0, 'a one-hundred-percent no-heal skin should stop healing even when vitality is active');
    cases.push('outgoing, incoming, vitality, and exhaustion modifiers run through shared combat pipelines');
  }

  {
    const attacker = prepareFighter(makeFighter('汲取攻击者@A'));
    const target = prepareFighter(makeFighter('汲取目标@B'));
    const { engine } = makeDeathEngine([attacker, target]);
    const [engineAttacker, engineTarget] = engine.fighters;
    localProject.setCurrentHp(engineAttacker, 500);
    engineAttacker.atk = 1000;
    engineTarget.def = 0;
    applySingleTestStatus(engineAttacker, { identityId: 'DRAIN', potency: 50, charges: 1, remainingTurns: 1, attribution: { effectSourceId: 'drain-test' } });
    applySingleTestStatus(engineTarget, { identityId: 'AGGRO', potency: 150, remainingTurns: 2, attribution: { effectSourceId: 'aggro-test' } });
    assert(getAggroMultiplier(engineTarget) === 2.5, 'one-hundred-fifty aggro should create a 2.5 target-weight multiplier');
    withRandomSequence([0, 0, 0, 0], () => engine.executeSkillAction(null, engineAttacker, engineTarget));
    assert(engineAttacker.currentHp > 500, 'drain should heal from actual direct HP damage');
    assert(!engineAttacker.statuses.some((status) => status.mechanicId === 'DRAIN'), 'one-charge drain should be consumed by its successful attack');
    cases.push('aggro affects target weight and drain consumes only after successful direct damage');
  }

  {
    const source = prepareFighter(makeFighter('场外状态来源@A'));
    const target = prepareFighter(makeFighter('场外OB目标@B'));
    const { engine } = makeDeathEngine([source, target]);
    const [engineSource, engineTarget] = engine.fighters;
    engine.applyStatus(engineTarget, { identityId: 'BURN', potency: 4, count: 2, attribution: { applierId: engineSource.id, applierName: engineSource.name } });
    applySingleTestStatus(engineTarget, { identityId: 'SYNERGY_SLACKING', remainingTurns: 5, attribution: { effectSourceId: 'off-field-test' } });
    const burnBefore = queryMechanic(engineTarget, 'BURN');
    settleBurnAtLargeRound(engine.createStatusMechanicsRuntime(), 1);
    assert(engineTarget.currentHp === engineTarget.maxHp && queryMechanic(engineTarget, 'BURN').count === burnBefore.count, 'off-field burn must pause without damage or count loss');
    assert(!engine.applyStatus(engineTarget, { identityId: 'POISON', remainingTurns: 2, attribution: { applierId: engineSource.id, applierName: engineSource.name } }), 'off-field units must reject newly applied statuses');
    assert(engine.applyDamage(engineTarget, 100, 'skill', true, engineSource, { sourceKind: 'custom' }) === 0, 'off-field units must reject every damage plane');
    cases.push('off-field units pause existing statuses and reject new statuses and damage');
  }

  {
    const rabbit = prepareFighter(makeFighter('顾家女人机械测试@A'));
    const observer = prepareFighter(makeFighter('顾家女人旁观者@B'));
    const { engine, logs } = makeDeathEngine([rabbit, observer]);
    const engineRabbit = engine.fighters[0];
    localProject.setCurrentHp(engineRabbit, 500);
    assert(engine.applyStatus(engineRabbit, { identityId: 'STYLE_FAMILY', attribution: { applierId: engineRabbit.id, applierName: engineRabbit.name } }), 'Family style should apply through the status service');
    engine.processStatusTurn(engineRabbit);
    assert(engineRabbit.currentHp === 550, `Family style must settle exactly one 5% regeneration tick, got ${engineRabbit.currentHp}`);
    assert(logs.filter((entry) => entry.text.includes(`${engineRabbit.name} 自动回复了`)).length === 1, 'A composite Family style card must emit one regeneration settlement instead of one per component');
    cases.push('composite Family style settles its registered regeneration mechanic exactly once');
  }

  {
    const fighter = prepareFighter(makeFighter('多来源再生测试@A'));
    const observer = prepareFighter(makeFighter('多来源再生旁观者@B'));
    const { engine, logs } = makeDeathEngine([fighter, observer]);
    const engineFighter = engine.fighters[0];
    localProject.setCurrentHp(engineFighter, 500);
    assert(engine.applyStatus(engineFighter, {
      identityId: 'REGEN',
      remainingTurns: 2,
      attribution: { effectSourceId: 'regen-source-a', effectSourceName: '合成稳定' },
    }), 'First regeneration source should apply');
    assert(engine.applyStatus(engineFighter, {
      identityId: 'REGEN',
      remainingTurns: 2,
      attribution: { effectSourceId: 'regen-source-b', effectSourceName: '彩虹余波' },
    }), 'Second regeneration source should apply independently');

    engine.processStatusTurn(engineFighter);

    const regenLogs = logs.filter((entry) => entry.text.includes(`【再生】${engineFighter.name} 自动回复了`));
    assert(regenLogs.length === 2, `Two regeneration sources should produce two attributable settlements, got ${regenLogs.length}`);
    assert(regenLogs.some((entry) => entry.text.includes('来源：合成稳定')) && regenLogs.some((entry) => entry.text.includes('来源：彩虹余波')), 'Every regeneration settlement should identify its exact source');
    cases.push('multi-source regeneration logs identify each healing source');
  }

  {
    const fighter = prepareFighter(makeFighter('死亡状态清理目标@A'));
    applySingleTestStatus(fighter, { identityId: 'BURN', potency: 4, count: 2, remainingTurns: 2, attribution: { effectSourceId: 'death-negative' } });
    applySingleTestStatus(fighter, { identityId: 'DIVA_HEADPHONE_GUARD', remainingTurns: 2, attribution: { effectSourceId: 'death-positive' } });
    applySingleTestStatus(fighter, { identityId: 'CHARGE', potency: 8, attribution: { effectSourceId: 'death-neutral' } });
    applySingleTestStatus(fighter, { identityId: 'MOMO_CAPTAIN', attribution: { effectSourceId: 'death-independent' } });
    grantBarrier(fighter, 100, { sourceId: 'death-barrier', displayName: '死亡测试屏障', tickMode: 'permanent' });
    fighter.morale = 23;
    fighter.stagger = 31;

    resetStatusResourcesOnDeath(fighter);
    assert(!fighter.statuses.some((status) => ['BURN', 'DIVA_HEADPHONE_GUARD'].includes(status.identityId)), 'true death should clear ordinary positive and negative statuses');
    assert(fighter.statuses.some((status) => status.identityId === 'CHARGE') && fighter.statuses.some((status) => status.identityId === 'MOMO_CAPTAIN'), 'true death should preserve neutral resources and independent identities for their own revive rules');
    assert(getBarrierTotal(fighter) === 0 && fighter.morale === undefined && fighter.maxMorale === undefined && fighter.stagger === 0, 'true death should clear barriers, morale, and stagger resources');

    resetStatusResourcesOnRevive(fighter);
    assert(fighter.morale === 100 && fighter.maxMorale === 100 && fighter.stagger === 0, 'a player revival should re-enter with full morale and no stagger');
    const npc = prepareFighter(makeFighter('死亡资源NPC@B'));
    npc.isNpc = true;
    resetStatusResourcesOnDeath(npc);
    resetStatusResourcesOnRevive(npc);
    assert(npc.morale === undefined && npc.maxMorale === undefined, 'NPC revival must not create a morale resource');
    cases.push('true death clears ordinary effects and revive restores only eligible morale resources');
  }

  {
    const sourceA = prepareFighter(makeFighter('展示来源甲@A'));
    const sourceB = prepareFighter(makeFighter('展示来源乙@B'));
    const target = prepareFighter(makeFighter('状态展示目标@C'));
    applySingleTestStatus(target, { identityId: 'POISON', effectName: '毒术甲', remainingTurns: 3, attribution: { effectSourceId: 'internal_poison_a', applierId: sourceA.id, applierName: sourceA.name } });
    applySingleTestStatus(target, { identityId: 'POISON', effectName: '毒术乙', remainingTurns: 2, attribution: { effectSourceId: 'internal_poison_b', applierId: sourceB.id, applierName: sourceB.name } });
    grantBarrier(target, 80, { sourceId: 'internal_barrier', displayName: '展示屏障', tickMode: 'self_opportunity' });
    applySingleTestStatus(target, {
      identityId: 'BABY_LOVE_BOTTLE',
      remainingTurns: 2,
      attribution: { effectSourceId: 'timed-ui-detail', effectSourceName: '爱心瓶' },
    });
    const items = buildFighterStatusPresentation(target);
    const poisonItems = items.filter((item) => item.name === '中毒');
    assert(poisonItems.length === 1, 'multi-source poison should render as one stable status card');
    assert(poisonItems[0].detail.includes('当前结算归属') && poisonItems[0].detail.includes(sourceA.name) && poisonItems[0].detail.includes(sourceB.name), 'expanded poison details should identify both sources and the current owner');
    assert(!items.some((item) => item.detail.includes('internal_poison_') || item.detail.includes('internal_barrier')), 'status UI must never leak internal source IDs');
    assert(items.some((item) => item.kind === 'barrier' && item.name === '展示屏障'), 'generic barriers should share the same presentation model as statuses');
    assert(
      getStatusIdentityDefinition('VALO_OPERATOR_PENALTY').polarity === 'negative' &&
      getStatusIdentityDefinition('VALO_OPERATOR_PENALTY').dispelTier === 'none',
      'the Operator mobility penalty should display as a negative identity without becoming generally dispellable',
    );
    const zeroStatNpc = prepareFighter(makeFighter('零属性NPC@Z'));
    zeroStatNpc.def = 0;
    zeroStatNpc.res = 0;
    zeroStatNpc.agl = 0;
    assert(
      getEffectiveCombatStat(zeroStatNpc, 'def') === 0 &&
      getEffectiveCombatStat(zeroStatNpc, 'res') === 0 &&
      getEffectiveCombatStat(zeroStatNpc, 'agl') === 0,
      'the unified stat projection must preserve legitimate zero-valued NPC stats unless a status declares a floor',
    );
    const positiveStatFloor = prepareFighter(makeFighter('正数属性下限@Z'));
    positiveStatFloor.def = 50;
    positiveStatFloor.res = 50;
    applySingleTestStatus(positiveStatFloor, { identityId: 'STYLE_ANGRY' });
    assert(
      getEffectiveCombatStat(positiveStatFloor, 'def') === 1 &&
      getEffectiveCombatStat(positiveStatFloor, 'res') === 1,
      'positive combat stats reduced by a status multiplier must retain the historical minimum value of one',
    );
    assert(
      getStatusIdentityDefinition('OWL_EAR_GUARD').polarity === 'positive' &&
      getStatusIdentityDefinition('OWL_EAR_GUARD').dispelTier === 'normal',
      'Owl ear guard should be a readable temporary positive effect',
    );
    for (const identity of ['EMOTE_ULT_COOLDOWN', 'OWL_RIVER_MARK', 'OWL_ACID_FEARLESS', 'OWL_IMPERIAL_SEAL', 'OWL_SPECTER_LOCK', 'OWL_SPALTER_LOCK', 'OWL_SPALTER_DOLL', 'OWL_WILD', 'OWL_ENJOYING']) {
      assert(getStatusIdentityDefinition(identity).polarity === 'independent', `${identity} should display as an independent identity instead of an unclassified neutral status`);
    }
    const timedItem = items.find((item) => item.members.some((member) => member.name === getStatusIdentityDefinition('BABY_LOVE_BOTTLE').displayName));
    assert(
      !!timedItem &&
      timedItem.detailModel.groupKind === 'composite' &&
      timedItem.detail.includes('效果') &&
      timedItem.detail.includes('18%') &&
      timedItem.detail.includes('12%'),
      'composite stat status details should list their compact effect rows and exact values',
    );

    const timedTurnTarget = prepareFighter(makeFighter('限时状态时钟目标@D'));
    const { engine: timedEngine } = makeDeathEngine([timedTurnTarget, prepareFighter(makeFighter('限时时钟旁观者@E'))]);
    const engineTimedTarget = timedEngine.fighters[0];
    const baseTimedAtk = engineTimedTarget.atk;
    const oneTurnStatus = applySingleTestStatus(engineTimedTarget, {
      identityId: 'DIVA_CHEER',
      remainingTurns: 1,
      componentPotencies: { ATK_UP: 50 },
      attribution: { effectSourceId: 'one-opportunity-buff' },
    });
    grantBarrier(engineTimedTarget, 30, {
      sourceId: 'opportunity-start-barrier',
      displayName: '本回合旧屏障',
      remainingTurns: 1,
      tickMode: 'self_opportunity',
    });
    applySingleTestStatus(engineTimedTarget, { identityId: 'DIVA_HEADPHONE_GUARD', remainingTurns: 1, attribution: { effectSourceId: 'refreshed-during-opportunity-status' } });
    grantBarrier(engineTimedTarget, 20, {
      sourceId: 'refreshed-during-opportunity-barrier',
      displayName: '行动中刷新屏障',
      remainingTurns: 1,
      tickMode: 'self_opportunity',
    });
    const oneTurnResult = timedEngine.processStatusTurn(engineTimedTarget, { deferSelfOpportunitySettlement: true });
    assert(getEffectiveCombatStat(engineTimedTarget, 'atk') === Math.floor(baseTimedAtk * 1.5) && engineTimedTarget.statuses.includes(oneTurnStatus), 'a one-opportunity buff must remain active throughout the opportunity it is about to consume');
    grantBarrier(engineTimedTarget, 40, {
      sourceId: 'new-during-opportunity-barrier',
      displayName: '本回合新屏障',
      remainingTurns: 1,
      tickMode: 'self_opportunity',
    });
    applySingleTestStatus(engineTimedTarget, { identityId: 'DIVA_HEADPHONE_GUARD', remainingTurns: 3, attribution: { effectSourceId: 'refreshed-during-opportunity-status' } });
    grantBarrier(engineTimedTarget, 10, {
      sourceId: 'refreshed-during-opportunity-barrier',
      displayName: '行动中刷新屏障',
      remainingTurns: 3,
      tickMode: 'self_opportunity',
      stackMode: 'refresh',
    });
    settleSelfOpportunityStatuses(
      timedEngine.createStatusProcessingRuntime(),
      engineTimedTarget,
      oneTurnResult.selfOpportunityStatuses,
      oneTurnResult.selfOpportunityBarriers,
      oneTurnResult.selfOpportunityStatusVersions,
      oneTurnResult.selfOpportunityBarrierVersions,
    );
    assert(getEffectiveCombatStat(engineTimedTarget, 'atk') === baseTimedAtk && !engineTimedTarget.statuses.includes(oneTurnStatus), 'the one-opportunity buff should expire and restore calculated stats only after that opportunity ends');
    assert(!engineTimedTarget.barriers?.some((barrier) => barrier.sourceId === 'opportunity-start-barrier'), 'a barrier present at opportunity start should consume its final duration afterward');
    assert(engineTimedTarget.barriers?.some((barrier) => barrier.sourceId === 'new-during-opportunity-barrier' && barrier.remainingTurns === 1), 'a barrier created during the action must not lose duration immediately');
    assert(engineTimedTarget.statuses.some((status) => status.attribution.effectSourceId === 'refreshed-during-opportunity-status' && status.remainingTurns === 3), 'a status refreshed during the action must keep its full refreshed duration');
    assert(engineTimedTarget.barriers?.some((barrier) => barrier.sourceId === 'refreshed-during-opportunity-barrier' && barrier.remainingTurns === 3), 'a barrier refreshed during the action must keep its full refreshed duration');

    const { engine } = makeDeathEngine([sourceA, target]);
    const engineTarget = engine.fighters[1];
    grantBarrier(engineTarget, 60, {
      sourceId: 'first-barrier-source',
      displayName: '第一层屏障',
      tickMode: 'self_opportunity',
      priority: 1,
      attribution: {
        effectSourceId: 'first-barrier-source',
        effectSourceName: '第一屏障技能',
        applierId: sourceA.id,
        applierName: sourceA.name,
      },
    });
    grantBarrier(engineTarget, 80, {
      sourceId: 'second-barrier-source',
      displayName: '第二层屏障',
      tickMode: 'self_opportunity',
      priority: 2,
      attribution: {
        effectSourceId: 'second-barrier-source',
        effectSourceName: '第二屏障技能',
        applierId: engineTarget.id,
        applierName: engineTarget.name,
      },
    });
    const shieldedOptions: import('../../../lib/namearena/types').DamageApplicationOptions = {
      sourceKind: 'custom',
      actionName: '屏障来源记录测试',
    };
    engine.applyDamage(engineTarget, 100, 'skill', true, engine.fighters[0], shieldedOptions);
    assert(shieldedOptions.resolution?.shieldDamage === 100 && shieldedOptions.resolution.hpDamage === 0, 'a fully shielded hit should record shield damage without HP damage');
    assert(
      shieldedOptions.resolution?.barrierAbsorptions?.length === 2 &&
      shieldedOptions.resolution.barrierAbsorptions[0].sourceId === 'first-barrier-source' &&
      shieldedOptions.resolution.barrierAbsorptions[0].amount === 60 &&
      shieldedOptions.resolution.barrierAbsorptions[1].sourceId === 'second-barrier-source' &&
      shieldedOptions.resolution.barrierAbsorptions[1].amount === 40 &&
      shieldedOptions.resolution.barrierAbsorptions[0].applierId === sourceA.id,
      'damage records should preserve exact barrier settlement order, absorbed amounts, and applier attribution',
    );
    engine.executeSkillAction(null, engine.fighters[0], engine.fighters[1]);
    const actionEvents = engine.events.filter((event) => !!event.actionId);
    assert(actionEvents.length > 2, 'one attack should emit an action chain with logs and damage events');
    assert(new Set(actionEvents.map((event) => event.rootEventId)).size === 1, 'every event in one causal action chain should share one root event id');
    const damageEvent = actionEvents.find((event) => event.damage);
    assert(damageEvent?.damage?.rootEventId === damageEvent?.rootEventId, 'damage resolution and its battle event should expose the same root event id');
    cases.push('status and barrier presentation expose exact effects and every settlement keeps causal attribution');
  }

  {
    const sourceA = prepareFighter(makeFighter('多源火焰甲@A'));
    const sourceB = prepareFighter(makeFighter('多源火焰乙@B'));
    const target = prepareFighter(makeFighter('多源火焰目标@C'));
    const { engine, logs } = makeDeathEngine([sourceA, sourceB, target]);
    const [engineSourceA, engineSourceB, engineTarget] = engine.fighters;
    engine.applyStatus(engineTarget, { identityId: 'BURN', potency: 12, count: 2, attribution: { effectSourceId: 'burn:first', applierId: engineSourceA.id, applierName: engineSourceA.name } });
    const secondStart = logs.length;
    engine.applyStatus(engineTarget, { identityId: 'BURN', potency: 6, count: 1, attribution: { effectSourceId: 'burn:second', applierId: engineSourceB.id, applierName: engineSourceB.name } });
    const secondApplication = logs.slice(secondStart).find((entry) => entry.text.includes('【状态叠加】'));
    assert(secondApplication?.text.includes('18×3'), `multi-source application must show the aggregate 18×3 burn, got ${secondApplication?.text}`);
    settleBurnAtLargeRound(engine.createStatusMechanicsRuntime(), 1);
    const settlement = logs.find((entry) => entry.text.includes('本次强度 18'));
    assert(settlement?.text.includes('结算后剩余 2 次'), 'burn settlement should separate triggering potency from the remaining count');
    assert(!settlement?.text.includes('18×2'), 'burn settlement must not present its remaining count as the damage formula');
    cases.push('multi-source status logs show aggregate application values and unambiguous settlement values');
  }

  {
    const rushUser = prepareFighter(makeFighter('玄凝@A'));
    applySingleTestStatus(rushUser, {
      identityId: 'GAMER_RUSH_B',
      remainingTurns: 2,
      attribution: {
        effectSourceId: 'presentation-rush-b',
        effectSourceName: 'Rush B',
        applierId: rushUser.id,
        applierName: rushUser.name,
      },
    });
    const rushCard = buildFighterStatusPresentation(rushUser).find((item) => item.name === 'Rush B');
    assert(rushCard?.detailModel.groupKind === 'composite', 'Rush B should use the composite detail model');
    assert(
      rushCard.detailModel.effects.map((effect) => effect.name).sort().join(',') === '强攻,疾行',
      'Rush B should render one compact row for attack and speed',
    );
    assert(
      countText(rushCard.detail, '来源：') === 1 &&
      countText(rushCard.detail, '分类：') === 1 &&
      countText(rushCard.detail, '速度翻倍且攻击提高 50%') === 1,
      'Rush B should show its shared source, classification, and theme summary exactly once',
    );

    const throneUser = prepareFighter(makeFighter('刺猬人@B'));
    const throneAttribution = {
      effectSourceId: 'tokusatsu_bujin_throne',
      effectSourceName: '武神王座',
      applierId: throneUser.id,
      applierName: throneUser.name,
    };
    applySingleTestStatus(throneUser, { identityId: 'BKB', remainingTurns: 2, groupId: 'presentation-throne', attribution: throneAttribution });
    applySingleTestStatus(throneUser, { identityId: 'SPELL_BLOCK', charges: 2, groupId: 'presentation-throne', attribution: throneAttribution });
    applySingleTestStatus(throneUser, { identityId: 'WAIT_COUNTER', charges: 1, groupId: 'presentation-throne', attribution: throneAttribution });
    const throneCard = buildFighterStatusPresentation(throneUser).find((item) => item.name === '武神王座');
    assert(
      throneCard?.detailModel.effects.length === 3 &&
      throneCard.detailModel.effects.some((effect) => effect.name === '坐椅子' && effect.facts.some((fact) => fact.value.includes('不可驱散'))) &&
      throneCard.detailModel.effects.some((effect) => effect.name === '法术抵挡' && effect.facts.some((fact) => fact.value === '2次')) &&
      throneCard.detailModel.effects.some((effect) => effect.name === '控制免疫' && effect.facts.some((fact) => fact.value === '2次全局行动')),
      'Tokusatsu throne should preserve all three mechanics and their differing lifecycle or dispel facts',
    );
    assert(countText(throneCard.detail, '来源：') === 1, 'Tokusatsu throne should show its shared source exactly once');

    const slackingUser = prepareFighter(makeFighter('丝瓜uli@C'));
    const slackingAttribution = { effectSourceId: 'slacking_off_field' };
    ['SYNERGY_SLACKING', 'INVUL', 'BKB', 'STUN'].forEach((identityId) => {
      applySingleTestStatus(slackingUser, {
        identityId,
        remainingTurns: 5,
        groupId: 'presentation-slacking',
        attribution: slackingAttribution,
      });
    });
    const slackingCard = buildFighterStatusPresentation(slackingUser).find((item) => item.name === '场外OB');
    assert(slackingCard, 'off-field bundle should render one themed card');
    assert(
      slackingCard.detailModel.effects.some((effect) => effect.description?.includes('不能成为任何攻击或技能的目标')) &&
      slackingCard.detailModel.effects.some((effect) => effect.description?.includes('无法行动')) &&
      slackingCard.detailModel.effects.some((effect) => effect.name === '无敌') &&
      slackingCard.detailModel.effects.some((effect) => effect.name === '控制免疫'),
      'off-field detail should expose unselectability, inability to act, invulnerability, and control immunity',
    );
    assert(!/SYNERGY_SLACKING|INVUL|BKB|STUN/.test(slackingCard.detail), 'off-field detail must not expose internal status ids');

    const burnSourceA = prepareFighter(makeFighter('火焰甲@D'));
    const burnSourceB = prepareFighter(makeFighter('火焰乙@E'));
    const burnTarget = prepareFighter(makeFighter('火焰目标@F'));
    applySingleTestStatus(burnTarget, {
      identityId: 'BURN',
      potency: 12,
      count: 2,
      attribution: { effectSourceId: 'presentation-burn-a', applierId: burnSourceA.id, applierName: burnSourceA.name },
    });
    applySingleTestStatus(burnTarget, {
      identityId: 'BURN',
      potency: 6,
      count: 1,
      attribution: { effectSourceId: 'presentation-burn-b', applierId: burnSourceB.id, applierName: burnSourceB.name },
    });
    const burnCard = buildFighterStatusPresentation(burnTarget).find((item) => item.name === '灼烧');
    assert(
      burnCard?.valueLabel === '18×3' &&
      burnCard.detailModel.groupKind === 'multi_source' &&
      burnCard.detailModel.effects.length === 2 &&
      burnCard.detailModel.effects.filter((effect) => effect.isCurrentAttribution).length === 1,
      'multi-source burn should show one aggregate total, one row per source, and one current attribution',
    );
    assert(countText(burnCard.detail, '每个大回合结束时造成强度×6') === 1, 'multi-source burn must not repeat its mechanic description per source');

    const originiumTarget = prepareFighter(makeFighter('多来源矿石病目标@H'));
    applySingleTestStatus(originiumTarget, {
      identityId: 'ORIGINIUM_DISEASE',
      potency: 4,
      attribution: { effectSourceId: 'presentation-originium-a', applierId: burnSourceA.id, applierName: burnSourceA.name },
    });
    applySingleTestStatus(originiumTarget, {
      identityId: 'ORIGINIUM_DISEASE',
      potency: 25,
      attribution: { effectSourceId: 'presentation-originium-b', applierId: burnSourceB.id, applierName: burnSourceB.name },
    });
    const originiumCards = buildFighterStatusPresentation(originiumTarget)
      .filter((item) => item.name === '矿石病');
    assert(
      originiumCards.length === 1 &&
      originiumCards[0].valueLabel === '29/80层' &&
      originiumCards[0].detailModel.groupKind === 'multi_source' &&
      originiumCards[0].detailModel.effects.length === 2,
      'multi-source Originium disease should show one aggregate total with one contribution row per source',
    );
    assert(countText(originiumCards[0].detail, '80 层时死亡') === 1, 'multi-source Originium disease must not repeat its mechanic description per source');

    const simpleTarget = prepareFighter(makeFighter('单状态目标@G'));
    applySingleTestStatus(simpleTarget, {
      identityId: 'STUN',
      remainingTurns: 1,
      attribution: { effectSourceId: 'presentation-stun', applierId: rushUser.id, applierName: rushUser.name },
    });
    grantBarrier(simpleTarget, 80, {
      sourceId: 'presentation-barrier',
      displayName: '测试屏障',
      remainingTurns: 2,
      attribution: { effectSourceId: 'presentation-barrier', applierId: rushUser.id, applierName: rushUser.name },
    });
    const simpleItems = buildFighterStatusPresentation(simpleTarget);
    const simpleStatus = simpleItems.find((item) => item.kind === 'status');
    const simpleBarrier = simpleItems.find((item) => item.kind === 'barrier');
    assert(
      simpleStatus?.detailModel.groupKind === 'single' &&
      simpleStatus.detail.includes('无法行动') &&
      simpleStatus.detail.includes('来源：玄凝') &&
      simpleStatus.detail.includes('仅强驱散'),
      'single status detail should retain description, source, and dispel information',
    );
    assert(
      simpleBarrier?.detailModel.groupKind === 'barrier' &&
      simpleBarrier.valueLabel === '80/80 · 2次自身行动机会' &&
      simpleBarrier.detail.includes('先于生命承受') &&
      simpleBarrier.detail.includes('来源：玄凝'),
      'barrier detail should retain value, lifecycle, description, and source information',
    );
    cases.push('structured status details deduplicate composite and multi-source text without losing single status or barrier facts');
  }

  {
    const attacker = prepareFighter(makeFighter('组合护符攻击者@A'));
    const target = prepareFighter(makeFighter('组合护符目标@B'));
    const { engine, logs } = makeDeathEngine([attacker, target]);
    const engineTarget = engine.fighters[1];
    const bkb = applySingleTestStatus(engineTarget, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'gacha_death_charm' } });
    applySingleTestStatus(engineTarget, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'gacha_death_charm' } });
    bkb.lastAdvancedAt = 0;
    const themedItems = buildFighterStatusPresentation(engineTarget).filter((item) => item.name === '欧皇护符');
    assert(themedItems.length === 1 && themedItems[0].members.length === 2, 'one themed defense must render as one card with two readable mechanics');

    advanceGlobalTimedStatuses(engine.fighters, 1, (type, text) => engine.log(type, text));
    assert(!engineTarget.statuses.some((status) => status.identityId === 'BKB'), 'the timed control-immunity component should expire');
    assert(engineTarget.statuses.some((status) => status.identityId === 'SPELL_BLOCK'), 'the unspent spell-block component should remain active');
    assert(!logs.some((entry) => entry.text.includes('【欧皇护符】自然结束')), 'a surviving sibling mechanic must prevent a false whole-theme expiry');
    assert(logs.some((entry) => entry.text.includes('【状态变化】') && entry.text.includes('失去【控制免疫】') && entry.text.includes('【法术抵挡】仍在生效')), 'partial theme expiry should name both the expired and surviving mechanics');
    cases.push('composite defenses expire by component without falsely ending the whole theme');
  }

  {
    const ting = prepareFighter(makeFighter('小汀@A'));
    const gacha = prepareFighter(makeFighter('牢鳄@B'));
    const alternative = prepareFighter(makeFighter('混乱指定目标@C'));
    ting.isTing = true;
    ting.transformed = true;
    ting.job = 'EXPLOSIVE_ANTI_CROC';
    gacha.isGacha = true;
    const { engine } = makeDeathEngine([ting, gacha, alternative]);
    const [engineTing, engineGacha, engineAlternative] = engine.fighters;
    engineTing.confusedForcedTargetId = engineAlternative.id;
    withRandomSequence([0, 0, 0, 0], () => engine.executeSkillAction(null, engineTing, engineAlternative));
    delete engineTing.confusedForcedTargetId;
    assert(engineAlternative.stats.dmgTaken > 0, 'confusion must preserve the exact target named by its preceding log');
    assert(engineGacha.stats.dmgTaken === 0, 'Ting anti-Gacha targeting must not override a confusion-forced target');
    cases.push('confusion target narration cannot be overridden by Ting anti-Gacha priority');
  }

  {
    const source = prepareFighter(makeFighter('水牢来源@A'));
    const target = prepareFighter(makeFighter('水牢目标@B'));
    const { engine, logs } = makeDeathEngine([source, target]);
    const [engineSource, engineTarget] = engine.fighters;

    assert(engine.applyStatus(engineTarget, { identityId: 'WATER_PRISON', remainingTurns: 3, attribution: { applierId: engineSource.id, applierName: engineSource.name } }), 'Deep Water Prison should apply through the unified status API');
    assert(logs.some((entry) =>
      entry.text.includes('【状态施加】') &&
      entry.text.includes(`${engineTarget.name} 的【深渊水牢】`) &&
      entry.text.includes(`来源：${engineSource.name}`)
    ), 'A themed legacy status without a core registry entry should still receive one exact Chinese application log');
    cases.push('all unified status applications receive player-facing cause logs');
  }

  {
    const attacker = prepareFighter(makeFighter('挡刀日志攻击者@A'));
    const owner = prepareFighter(makeFighter('挡刀宿主@B'));
    const puppet = prepareFighter(makeFighter('小汀(傀儡)@B'));
    puppet.isSummon = true;
    puppet.summonerId = owner.id;
    puppet.summonBaseName = '小汀(傀儡)';
    attacker.agl = 10000;
    applyTestStatus(attacker, { identityId: 'AIM', charges: 1 });
    const { engine, logs } = makeDeathEngine([attacker, owner, puppet]);

    engine.executeSkillAction(null, engine.fighters[0], engine.fighters[1]);

    assert(logs.some((entry) =>
      entry.text.includes('【援护】小汀(傀儡)') &&
      entry.text.includes('替 挡刀宿主 挡下')
    ), 'Puppet interception should name the protected host instead of saying only "host"');
    cases.push('Puppet interception logs name the protected fighter');
  }

  return cases;
}
