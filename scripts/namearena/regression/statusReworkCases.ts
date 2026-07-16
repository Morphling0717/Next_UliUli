import { healFighter } from '../../../lib/namearena/combatState';
import { GACHA_BLAZE_CANNON_CARD, GACHA_BLUE_EYES_BURST_CARD } from '../../../lib/namearena/gachaMechanics';
import { duelMonsterSkills } from '../../../lib/namearena/skills/duelMonster';
import { emoteSkills } from '../../../lib/namearena/skills/emote';
import { gamerSkills } from '../../../lib/namearena/skills/gamer';
import { owlSkills } from '../../../lib/namearena/skills/owl';
import { rabbitSkills } from '../../../lib/namearena/skills/rabbit';
import { tokusatsuSkills } from '../../../lib/namearena/skills/tokusatsu';
import { getConfusionTargets } from '../../../lib/namearena/targeting';
import type { Fighter } from '../../../lib/namearena/types';
import {
  assert,
  localProject,
  makeFighter,
  withRandomSequence,
} from '../shared/harness';
import { makeDeathEngine } from './deathAccountingCases';

function prepareFighter(fighter: Fighter, maxHp = 1000): Fighter {
  fighter.maxHp = maxHp;
  localProject.setCurrentHp(fighter, maxHp);
  fighter.status = [];
  fighter.isOwl = false;
  fighter.isYuzu = false;
  fighter.isGacha = false;
  fighter.isWT = false;
  fighter.jobData = { ...fighter.jobData, name: '状态测试职业', skills: [...fighter.jobData.skills] };
  return fighter;
}

export function runStatusReworkCases(): string[] {
  const cases: string[] = [];

  {
    const source = prepareFighter(makeFighter('灼烧来源@A'));
    const target = prepareFighter(makeFighter('灼烧目标@B'));
    const { engine } = makeDeathEngine([source, target]);
    const [engineSource, engineTarget] = engine.fighters;

    assert(engine.applyStatus(engineTarget, 'BURN', 2, { applierId: engineSource.id, applierName: engineSource.name }), 'first burn should apply');
    engine.processStatusTurn(engineTarget);
    assert(engineTarget.currentHp === 950, `burn should deal 5% max HP, got ${engineTarget.currentHp}`);
    assert(engine.applyStatus(engineTarget, 'BURN', 2, { applierId: engineSource.id, applierName: engineSource.name }), 'reapplied burn should refresh');
    assert(Number(engineTarget.currentHp) === 920, `burn reapplication should immediately deal 3% max HP, got ${engineTarget.currentHp}`);
    assert(engineSource.stats.dmgDealt === 80, `burn owner should receive all burn damage credit, got ${engineSource.stats.dmgDealt}`);
    cases.push('burn ticks, explodes on refresh, and credits its applier');
  }

  {
    const source = prepareFighter(makeFighter('中毒来源@A'));
    const target = prepareFighter(makeFighter('中毒目标@B'));
    const { engine } = makeDeathEngine([source, target]);
    const [engineSource, engineTarget] = engine.fighters;

    for (let stack = 1; stack <= 3; stack += 1) {
      assert(engine.applyStatus(engineTarget, 'POISON', 3, { applierId: engineSource.id, applierName: engineSource.name }), `poison stack ${stack} should apply`);
      assert(engineTarget.status.find((status) => status.type === 'POISON')?.stacks === stack, `poison should reach ${stack} stacks`);
    }
    engine.processStatusTurn(engineTarget);
    assert(engineTarget.currentHp === 940, `three poison stacks should deal 6% max HP, got ${engineTarget.currentHp}`);
    assert(engineSource.stats.dmgDealt === 60, 'poison damage should be credited to the most recent applier');
    cases.push('poison stacks to three and uses the 4/5/6 percent profile');
  }

  {
    const source = prepareFighter(makeFighter('流血来源@A'));
    const target = prepareFighter(makeFighter('流血目标@B'));
    localProject.setCurrentHp(target, 500);
    const { engine } = makeDeathEngine([source, target]);
    const [engineSource, engineTarget] = engine.fighters;

    engine.applyStatus(engineTarget, 'BLEED', 2, { applierId: engineSource.id, applierName: engineSource.name });
    const healingLogs: string[] = [];
    const healed = healFighter(engineTarget, 100, (_type, text) => healingLogs.push(text));
    assert(healed === 75, `bleed should reduce received healing by 25%, got ${healed}`);
    assert(healingLogs.some((text) => text.includes('流血') && text.includes('100') && text.includes('75')), 'bleed healing reduction should explain both the original and reduced values');
    engine.processStatusTurn(engineTarget);
    assert(engineTarget.currentHp === 535, `bleed should then deal 4% max HP, got ${engineTarget.currentHp}`);
    cases.push('bleed reduces healing and deals its distinct four-percent tick');
  }

  {
    const source = prepareFighter(makeFighter('持续伤害击杀者@A'));
    const target = prepareFighter(makeFighter('持续伤害濒死者@B'), 100);
    localProject.setCurrentHp(target, 4);
    const { engine } = makeDeathEngine([source, target]);
    const [engineSource, engineTarget] = engine.fighters;

    engine.applyStatus(engineTarget, 'BLEED', 1, { applierId: engineSource.id, applierName: engineSource.name });
    engine.processStatusTurn(engineTarget);
    assert(engineTarget.isDeadAnnounced, 'lethal bleed should announce defeat immediately');
    assert(engineSource.stats.kills === 1, `lethal DoT should award one kill, got ${engineSource.stats.kills}`);
    assert(engineSource.stats.dmgDealt === 4, `lethal DoT should award exact damage, got ${engineSource.stats.dmgDealt}`);
    cases.push('lethal DoT awards damage and kill ownership');
  }

  {
    const target = prepareFighter(makeFighter('持续伤害复活者@A'), 100);
    target.spd = 100000;
    target.status = [{ type: 'VALO_ULT_RUN_IT_BACK', duration: 2 }];
    localProject.setCurrentHp(target, 4);
    const source = prepareFighter(makeFighter('复活击飞来源@B'), 100);
    source.spd = 1;
    const { engine, logs } = makeDeathEngine([target, source]);
    const [engineTarget, engineSource] = engine.fighters;
    engine.applyStatus(engineTarget, 'BLEED', 1, { applierId: engineSource.id, applierName: engineSource.name });
    engine.applyStatus(engineTarget, 'AIRBORNE', 1, { applierId: engineSource.id, applierName: engineSource.name });
    withRandomSequence([0], () => engine.step({ current: false }));
    const reviveIndex = logs.findIndex((entry) => entry.text.includes('再火一回'));
    const unableIndex = logs.findIndex((entry) => entry.text.includes('处于【击飞】') && entry.text.includes('无法行动'));
    const landingIndex = logs.findIndex((entry) => entry.text.includes('击飞坠地'));
    assert(reviveIndex >= 0, 'lethal DoT should trigger the prepared revival');
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
    confused.status = [{ type: 'CONFUSED', duration: 1 }];
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
    engine.applyStatus(engineCharmed, 'CHARMED', 2, { applierId: engineCharmer.id, applierName: engineCharmer.name });

    const resolved = engine.resolveTarget(engineCharmed, engineCharmer, engine.getSelectableTargets(engineCharmed));
    assert(resolved?.target.id === engineAlternative.id, 'charmed fighter should avoid the charmer while another legal target exists');
    engineCharmed.status.push({ type: 'AIM', duration: 1 });
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
    assert(!engineCharmed.status.some((status) => status.type === 'CHARMED'), 'charm should end when its source leaves the field');
    cases.push('charm avoids its source, disables crit, reduces damage, and ends with the source');
  }

  {
    const yuzu = prepareFighter(makeFighter('柚子@A'));
    const charmer = prepareFighter(makeFighter('魅惑来源@B'));
    const alternative = prepareFighter(makeFighter('魅惑替代目标@C'));
    yuzu.isYuzu = true;
    yuzu.yuzuPhase = 3;
    yuzu.status = [{ type: 'CHARMED', duration: 2, applierId: charmer.id, applierName: charmer.name }];
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

    engine.applyStatus(engineTarget, 'STUN', 2, { applierId: engineSource.id, applierName: engineSource.name });
    engine.applyStatus(engineTarget, 'WT_AIRBORNE', 9, { applierId: engineSource.id, applierName: engineSource.name });
    const airborne = engineTarget.status.find((status) => status.type === 'AIRBORNE');
    assert(airborne?.duration === 1 && !engineTarget.status.some((status) => status.type === 'WT_AIRBORNE'), 'legacy War Thunder knock-up should normalize to one canonical turn');
    withRandomSequence([0, 0.99], () => engine.step({ current: false }));
    assert(!engineTarget.status.some((status) => status.type === 'AIRBORNE'), 'airborne should expire after consuming the target next action');
    assert(Number(engineTarget.currentHp) === 982, `airborne landing should respect the target general 40% reduction, got ${engineTarget.currentHp}`);
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
    engine.applyStatus(engineTarget, 'OWL_EVADE_DOWN', 8, { applierId: engineSource.id, applierName: engineSource.name });
    const opening = engineTarget.status.find((status) => status.type === 'OWL_EVADE_DOWN');
    assert(opening?.duration === 2, `Owl opening should be capped at two owner actions, got ${opening?.duration}`);
    engineTarget.status.push({ type: 'INVUL', duration: 1 });
    engine.executeSkillAction('serious_punch', engineSource, engineTarget);
    assert(engineTarget.status.some((status) => status.type === 'OWL_EVADE_DOWN'), 'invulnerability should block the attack without consuming Owl opening');
    engineTarget.status = engineTarget.status.filter((status) => status.type !== 'INVUL');
    engineTarget.status.push({ type: 'SPELL_BLOCK', duration: 1 });
    engine.executeSkillAction('serious_punch', engineSource, engineTarget);
    assert(engineTarget.status.some((status) => status.type === 'OWL_EVADE_DOWN'), 'spell block should block the attack without consuming Owl opening');
    engine.executeSkillAction('serious_punch', engineSource, engineTarget);
    assert(!engineTarget.status.some((status) => status.type === 'OWL_EVADE_DOWN'), 'the next unblocked direct single-target attack should consume Owl opening');
    cases.push('Owl evade opening lasts two actions and respects invulnerability and spell block');
  }

  {
    const yuzu = prepareFighter(makeFighter('柚子直攻@A'));
    yuzu.isYuzu = true;
    yuzu.yuzuPhase = 1;
    const target = prepareFighter(makeFighter('乘风直攻目标@B'));
    target.status = [{ type: 'OWL_EVADE_DOWN', duration: 2 }];
    const { engine, logs } = makeDeathEngine([yuzu, target]);
    engine.executeSkillAction('yuzu_spear_impale', engine.fighters[0], engine.fighters[1]);
    assert(!engine.fighters[1].status.some((status) => status.type === 'OWL_EVADE_DOWN'), 'Yuzu custom direct skill should consume Owl opening');
    assert(logs.some((entry) => entry.text.includes('乘风失衡') && entry.text.includes('必定命中')), 'custom direct skill should explain the consumed Owl opening');

    const groupYuzu = prepareFighter(makeFighter('柚子群攻@A'));
    groupYuzu.isYuzu = true;
    groupYuzu.yuzuPhase = 2;
    const groupTarget = prepareFighter(makeFighter('乘风群攻目标@B'));
    groupTarget.status = [{ type: 'OWL_EVADE_DOWN', duration: 2 }];
    const groupEngine = makeDeathEngine([groupYuzu, groupTarget]).engine;
    groupEngine.executeSkillAction('yuzu_waiting_hell', groupEngine.fighters[0], groupEngine.fighters[1]);
    assert(groupEngine.fighters[1].status.some((status) => status.type === 'OWL_EVADE_DOWN'), 'Yuzu group skill must not consume a direct-attack opening');
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
    target.status = [{ type: 'OWL_EVADE_DOWN', duration: 2 }];
    const { engine, logs } = makeDeathEngine([dragon, target]);
    withRandomSequence([0.1, 0.1, 0.1, 0.1], () => {
      engine.executeSkillAction('triple_dragon_head', engine.fighters[0], engine.fighters[1]);
    });
    assert(!engine.fighters[1].status.some((status) => status.type === 'OWL_EVADE_DOWN'), 'non-Yuzu custom direct skill should consume Owl opening');
    assert(logs.filter((entry) => entry.text.includes('乘风失衡')).length === 1, 'multi-hit direct skill should consume and explain Owl opening once');
    cases.push('all custom single-target executors share Owl opening semantics');
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
    engine.applyStatus(engine.fighters[0], 'WT_REPAIRING', 2);
    for (let index = 0; index < 12 && engine.fighters[0].status.some((status) => status.type === 'WT_REPAIRING'); index += 1) {
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
    owl.status = [{ type: 'BURN', duration: 1, applierId: source.id, applierName: source.name }];
    const { engine, logs } = makeDeathEngine([source, owl]);
    engine.processStatusTurn(engine.fighters[1]);
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
    target.status = [{ type: 'BURN', duration: 2, applierId: source.id, applierName: source.name }];
    localProject.setCurrentHp(target, 1);
    const { engine, logs } = makeDeathEngine([source, target]);
    const [engineSource, engineTarget] = engine.fighters;
    engineTarget.yuzuShield = 0;
    engineTarget.status = engineTarget.status.filter((status) => status.type !== 'YUZU_BARRIER');
    engine.applyDamage(engineTarget, 10, 'skill', false, engineSource, { deferTransform: true, actionName: '锁血前置攻击' });
    engine.applyStatus(engineTarget, 'BURN', 2, { applierId: engineSource.id, applierName: engineSource.name });
    const lockLogs = logs.filter((entry) => entry.text.includes('触发了锁血保护'));
    assert(lockLogs.length === 1, `nested burn refresh should emit one lockblood log, got ${lockLogs.length}`);
    cases.push('burn refresh deduplicates nested phase-lock logs');
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
    target.status = [{ type: 'BKB', duration: 2 }];
    const { engine } = makeDeathEngine([source, target]);
    const [engineSource, engineTarget] = engine.fighters;
    for (const type of ['STUN', 'CONFUSED', 'EMBARRASSED', 'CHARMED']) {
      assert(!engine.applyStatus(engineTarget, type, 2, { applierId: engineSource.id, applierName: engineSource.name }), `${type} should be blocked by control immunity`);
      assert(!engineTarget.status.some((status) => status.type === type), `${type} must not remain after being blocked`);
    }
    cases.push('all four primary control families are blocked by control immunity');
  }

  {
    const m1 = prepareFighter(makeFighter('M1A2_abrams_sep@A'));
    m1.isWT = true;
    m1.wtFpeCharges = 1;
    m1.wtNbcsCharges = 1;
    m1.status = [
      { type: 'BURN', duration: 2 },
      { type: 'POISON', duration: 2, stacks: 3 },
      { type: 'BLEED', duration: 2 },
    ];
    localProject.setCurrentHp(m1, 400);
    const enemy = prepareFighter(makeFighter('M1抢修旁观者@B'));
    const { engine, logs } = makeDeathEngine([m1, enemy]);
    engine.executeSkillAction('wt_repair_premium', engine.fighters[0], engine.fighters[1]);
    const joined = logs.map((entry) => entry.text).join('\n');
    assert(!engine.fighters[0].status.some((status) => ['BURN', 'POISON', 'BLEED'].includes(status.type)), 'premium repair should clean burn, poison, and bleed');
    assert(joined.includes('FPE灭火') && joined.includes('核生化洗消') && joined.includes('乘员急救'), 'M1 cleanup should use distinct fire, poison, and bleeding logs');
    cases.push('M1 uses separate FPE, NBCS, and medical cleanup paths');
  }

  return cases;
}
