import type { DamageApplicationOptions, Fighter, GachaEntry, SkillDefinition, StatKey } from '../../../lib/namearena/types';
import {
  clearYuzuShield,
  clearYuzuMark,
  drawYuzuWeapon,
  ensureYuzuMarkedTarget,
  setYuzuShield,
  YUZU_PHASE_THREE_REDUCTION,
  YUZU_UNMARKED_INCOMING_DAMAGE_MULTIPLIER,
} from '../../../lib/namearena/yuzuMechanics';
import {
  processPuruisaishiRoundEnd,
  spawnPuruisaishiEvent,
} from '../../../lib/namearena/puruisaishiMechanics';
import { ensureOwlState, enterOwlPhaseThree } from '../../../lib/namearena/owlMechanics';
import { GACHA_ASH_BLOSSOM_CARD } from '../../../lib/namearena/gachaMechanics';
import { getEffectiveCombatStat } from '../../../lib/namearena/statusMechanics';
import { advanceGlobalTimedStatuses } from '../../../lib/namearena/statusProcessing';
import { buildFighterStatusPresentation } from '../../../lib/namearena/statusPresentation';
import { getBarrierTotal, queryDispellableStatuses, queryMechanic, removeEffects } from '../../../lib/namearena/statusSystem';
import {
  replaceTestStatuses,
  applyTestStatus,
  assert,
  localProject,
  makeFighter,
  withRandomSequence,
} from '../shared/harness';
import { makeDeathEngine } from './deathAccountingCases';

const STAT_KEYS: StatKey[] = ['atk', 'def', 'spd', 'agl', 'mag', 'res', 'wis'];

function bindAsGachaSummon(owner: Fighter, summon: Fighter, baseName: string, advanced = false): void {
  summon.isSummon = true;
  summon.summonerId = owner.id;
  summon.summonBaseName = baseName;
  summon.isAdvancedSummon = advanced;
}

function forceLuckEmperor(fighter: Fighter): void {
  const luckEmperor = localProject.jobs.LUCK_EMPEROR;
  assert(luckEmperor, 'LUCK_EMPEROR job should exist for gacha guard tests');
  fighter.job = 'LUCK_EMPEROR';
  fighter.jobData = JSON.parse(JSON.stringify(luckEmperor)) as typeof luckEmperor;
  fighter.transformed = true;
  fighter.isGacha = true;
  fighter.gachaLuck = 0;
  fighter.gachaPityPower = 0;
}

function chimeraInstallSkillByStatus(status: string): SkillDefinition {
  const plug = localProject.data.CHIMERA_PLUGIN_POOL?.find((entry) =>
    entry.statusApplications?.some((application) => application.identityId === status),
  );
  assert(plug, `Chimera plugin ${status} should exist`);
  return { name: '插件安装', ...plug } as SkillDefinition;
}

function poolSkillByStatus(poolKey: string, status: string, name: string): SkillDefinition {
  const pool = localProject.data[poolKey] as GachaEntry[] | undefined;
  const entry = pool?.find((candidate) =>
    candidate.statusApplications?.some((application) => application.identityId === status),
  );
  assert(entry, `${poolKey} should contain ${status}`);
  return { name, ...entry } as SkillDefinition;
}

export function runCharacterHookCases(): string[] {
  const cases: string[] = [];

  {
    const joker = makeFighter('屑@A');
    const { engine, logs } = makeDeathEngine([joker, makeFighter('变身旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);

    assert(engine.fighters[0].transformed, 'Joker hook should mark the fighter as transformed');
    assert(engine.fighters[0].job === 'DUAL_JOKER', `Joker hook should transform to DUAL_JOKER, got ${engine.fighters[0].job}`);
    assert(logs.some((entry) => entry.text.includes('摘下了冷笑话面具')), 'Joker hook should keep the original transform log');
    cases.push('Joker transform hook');
  }

  {
    const joker = makeFighter('屑@A');
    const attacker = makeFighter('转移来源@B');
    const { engine, logs } = makeDeathEngine([joker, attacker]);
    const godOfTrolls = localProject.jobs.GOD_OF_TROLLS;
    assert(godOfTrolls, 'GOD_OF_TROLLS job should exist for Joker transfer tests');
    const engineJoker = engine.fighters[0];
    engineJoker.job = 'GOD_OF_TROLLS';
    engineJoker.jobData = { ...godOfTrolls, skills: [...(godOfTrolls.skills ?? [])] };

    withRandomSequence([0, 0], () => {
      engine.applyDamage(engineJoker, 100, 'skill', true, engine.fighters[1], { actionName: '测试直击' });
    });

    assert(logs.some((entry) => entry.text.includes('遭到转移来源的【测试直击】时施展魔术')), 'Joker transfer log should include the incoming skill source');
    assert(logs.some((entry) => entry.text.includes('转移伤害落在 转移来源 身上')), 'Joker transfer should still redirect direct skill damage');
    cases.push('Joker transfer log names incoming skill');
  }

  {
    const joker = makeFighter('屑@A');
    const attacker = makeFighter('转移时序来源@B');
    const owl = makeFighter('鸮@B');
    const { engine, logs } = makeDeathEngine([joker, attacker, owl]);
    const godOfTrolls = localProject.jobs.GOD_OF_TROLLS;
    assert(godOfTrolls, 'GOD_OF_TROLLS job should exist for redirected mitigation ordering tests');
    engine.fighters[0].job = 'GOD_OF_TROLLS';
    engine.fighters[0].jobData = { ...godOfTrolls, skills: [...(godOfTrolls.skills ?? [])] };
    engine.fighters[0].transformed = true;
    engine.fighters[2].isOwl = true;
    engine.fighters[2].owlState = { phase: 2, warForm: 'defeat', warFormStartedTurn: 0, heavenStacks: 0, sweepUsed: false };
    engine.fighters[2].maxHp = 10000;
    localProject.setCurrentHp(engine.fighters[2], 10000);

    withRandomSequence([0, 0.99], () => {
      engine.applyDamage(engine.fighters[0], 400, 'skill', true, engine.fighters[1], { actionName: '转移时序测试' });
    });

    const mitigationIndex = logs.findIndex((entry) => entry.text.includes('败兵阵势'));
    const outcomeIndex = logs.findIndex((entry) => entry.text.includes('转移伤害落在 鸮 身上'));
    assert(mitigationIndex >= 0 && outcomeIndex > mitigationIndex, 'redirected damage mitigation must be narrated before the transfer outcome');
    cases.push('Joker transfer logs victim mitigation before the final outcome');
  }

  {
    const joker = makeFighter('屑@A');
    const attacker = makeFighter('嵌套转移来源@B');
    const owl = makeFighter('鸮@B');
    const { engine, logs } = makeDeathEngine([joker, attacker, owl]);
    const godOfTrolls = localProject.jobs.GOD_OF_TROLLS;
    assert(godOfTrolls, 'GOD_OF_TROLLS job should exist for nested Joker redirect tests');
    const engineJoker = engine.fighters[0];
    const engineOwl = engine.fighters[2];
    engineJoker.job = 'GOD_OF_TROLLS';
    engineJoker.jobData = { ...godOfTrolls, skills: [...(godOfTrolls.skills ?? [])] };
    engineJoker.transformed = true;
    localProject.setCurrentHp(engineOwl, Math.max(1, Math.floor(engineOwl.maxHp * 0.4)));
    engine.handleTransformations(engineOwl);
    assert(enterOwlPhaseThree(engine.createOwlRuntime(), engineOwl), 'Nested Joker redirect test requires phase-3 Owl');
    const emperor = engine.fighters.find((fighter) => fighter.owlSummonState?.kind === 'emperor');
    assert(emperor, 'Nested Joker redirect test requires 帝王之征');
    const emperorHpBefore = emperor.currentHp;
    const options: DamageApplicationOptions = { actionName: '嵌套转移测试' };

    withRandomSequence([0, 0.4], () => {
      engine.applyDamage(engineJoker, 400, 'skill', true, engine.fighters[1], options);
    });

    assert(options.redirectedByJoker, 'The outer Joker redirect should remain visible to its caller');
    assert((options.redirectedJokerDamage ?? 0) > 0, `Nested Joker-to-Emperor damage should report its real settlement, got ${options.redirectedJokerDamage}`);
    assert(emperor.currentHp < emperorHpBefore, '帝王之征 should actually receive the nested redirected hit');
    assert(logs.some((entry) => entry.text.includes('转移伤害落在 鸮') && entry.text.includes('龙实际承受')), 'Nested transfer log should name the Emperor settlement');
    assert(!logs.some((entry) => entry.text.includes('转移伤害落在 鸮') && entry.text.includes('没有造成实际伤害')), 'Nested transfer must not falsely report zero damage on Owl');
    cases.push('Joker redirect preserves nested Emperor damage and causal logs');
  }

  {
    const joker = makeFighter('屑@A');
    const attacker = makeFighter('转移来源@B');
    const bystander = makeFighter('转移受害者@B');
    const { engine, logs } = makeDeathEngine([joker, attacker, bystander]);
    const godOfTrolls = localProject.jobs.GOD_OF_TROLLS;
    assert(godOfTrolls, 'GOD_OF_TROLLS job should exist for Joker pre-resolution log tests');
    const engineJoker = engine.fighters[0];
    const engineAttacker = engine.fighters[1];
    engineJoker.job = 'GOD_OF_TROLLS';
    engineJoker.jobData = { ...godOfTrolls, skills: [...(godOfTrolls.skills ?? [])] };
    engineJoker.maxHp = 10000;
    localProject.setCurrentHp(engineJoker, 10000);
    engineAttacker.atk = 100;
    engineAttacker.agl = 10000;
    engine.fighters[2].maxHp = 10000;
    localProject.setCurrentHp(engine.fighters[2], 10000);

    withRandomSequence([0.5, 0.99, 0, 0], () => {
      engine.executeSkillAction('serious_punch', engineAttacker, engineJoker);
    });

    assert(logs.some((entry) => entry.text.includes('【认真一拳】锁定 屑') && entry.text.includes('预估伤害')), 'Joker-targeting skills should log pre-resolution damage before transfer can happen');
    assert(logs.some((entry) => entry.text.includes('随机恶作剧')), 'Joker should still transfer the forced regression hit');
    assert(!logs.some((entry) => /认真一拳.*屑.*造成/.test(entry.text)), 'Joker-targeting skill text should not claim damage already landed before transfer resolution');
    cases.push('Joker-targeting skill uses pre-resolution damage log');
  }

  {
    const joker = makeFighter('屑@A');
    const attacker = makeFighter('致死状态转移来源@B');
    const bystander = makeFighter('致死状态转移受害者@B');
    const { engine, logs } = makeDeathEngine([joker, attacker, bystander]);
    const godOfTrolls = localProject.jobs.GOD_OF_TROLLS;
    assert(godOfTrolls, 'GOD_OF_TROLLS job should exist for lethal redirected-status tests');
    const engineJoker = engine.fighters[0];
    const engineAttacker = engine.fighters[1];
    const engineBystander = engine.fighters[2];
    engineJoker.job = 'GOD_OF_TROLLS';
    engineJoker.jobData = { ...godOfTrolls, skills: [...(godOfTrolls.skills ?? [])] };
    engineAttacker.atk = 10000;
    engineAttacker.agl = 10000;
    localProject.setCurrentHp(engineAttacker, 1);
    localProject.setCurrentHp(engineBystander, 1);
    applyTestStatus(engineAttacker, { identityId: 'AIM', charges: 1 });

    withRandomSequence(Array(20).fill(0), () => {
      engine.executeSkillAction('bash', engineAttacker, engineJoker);
    });

    assert(logs.some((entry) => entry.text.includes('【随机恶作剧】')), 'Lethal redirected-status fixture must trigger Joker transfer');
    assert(
      engineAttacker.isDead || engineAttacker.isDeadAnnounced || engineBystander.isDead || engineBystander.isDeadAnnounced,
      'The redirected recipient should be defeated in the lethal Joker fixture',
    );
    assert(
      logs.some((entry) => entry.text.includes('状态结算') && entry.text.includes('【眩晕】不会跟随伤害转移')),
      'A hostile status should still explain its omission when Joker transfer defeats the recipient',
    );
    assert(!engineJoker.statuses.some((status) => status.identityId === 'STUN'), 'Joker must not receive the status from a redirected hit');
    cases.push('Joker lethal transfer still explains why target statuses do not follow');
  }

  {
    const joker = makeFighter('屑@A');
    const croc = makeFighter('牢鳄@B');
    const bystander = makeFighter('抽卡转移受害者@B');
    const { engine, logs } = makeDeathEngine([joker, croc, bystander]);
    const godOfTrolls = localProject.jobs.GOD_OF_TROLLS;
    assert(godOfTrolls, 'GOD_OF_TROLLS job should exist for gacha preview tests');
    engine.fighters[0].job = 'GOD_OF_TROLLS';
    engine.fighters[0].jobData = { ...godOfTrolls, skills: [...(godOfTrolls.skills ?? [])] };
    forceLuckEmperor(engine.fighters[1]);
    engine.fighters[1].jobData.skills = ['gacha_pull'];
    engine.fighters[2].maxHp = 10000;
    localProject.setCurrentHp(engine.fighters[2], 10000);

    withRandomSequence([0, 0.5, 0.99, 0, 0], () => {
      engine.executeSkillAction('gacha_pull', engine.fighters[1], engine.fighters[0]);
    });

    assert(logs.some((entry) => entry.text.includes('【牌面揭示】') && entry.text.includes('手机砸向 屑')), 'Redirected gacha attacks should preserve the concrete drawn-card flavor');
    assert(logs.some((entry) => entry.text.includes('伤害数值为转移与防御结算前预估')), 'Gacha preview should label its damage as pre-resolution estimate');
    cases.push('Redirected gacha hit keeps its card reveal before settlement');
  }

  {
    const joker = makeFighter('屑@A');
    const attacker = makeFighter('转移数值来源@B');
    const bystander = makeFighter('转移数值受害者@B');
    const { engine } = makeDeathEngine([joker, attacker, bystander]);
    const godOfTrolls = localProject.jobs.GOD_OF_TROLLS;
    assert(godOfTrolls, 'GOD_OF_TROLLS job should exist for redirected damage output tests');
    engine.fighters[0].job = 'GOD_OF_TROLLS';
    engine.fighters[0].jobData = { ...godOfTrolls, skills: [...(godOfTrolls.skills ?? [])] };
    engine.fighters[0].transformed = true;
    engine.fighters[2].maxHp = 10000;
    localProject.setCurrentHp(engine.fighters[2], 10000);
    const options: DamageApplicationOptions = { actionName: '转移数值测试' };

    withRandomSequence([0, 0.99], () => {
      engine.applyDamage(engine.fighters[0], 400, 'skill', true, engine.fighters[1], options);
    });

    assert(options.redirectedByJoker, 'Forced Joker prank should mark the hit as redirected');
    assert(options.redirectedJokerDamage === 400, `Joker redirect should return the transferred settlement amount, got ${options.redirectedJokerDamage}`);
    cases.push('Joker redirect exposes its actual transferred damage to custom logs');
  }

  {
    const joker = makeFighter('屑@A');
    const attacker = makeFighter('零伤转移来源@B');
    const emote = makeFighter('表情@B');
    const { engine, logs } = makeDeathEngine([joker, attacker, emote]);
    const godOfTrolls = localProject.jobs.GOD_OF_TROLLS;
    assert(godOfTrolls, 'GOD_OF_TROLLS job should exist for zero-damage redirect flush tests');
    engine.fighters[0].job = 'GOD_OF_TROLLS';
    engine.fighters[0].jobData = { ...godOfTrolls, skills: [...(godOfTrolls.skills ?? [])] };
    engine.fighters[0].transformed = true;
    applyTestStatus(engine.fighters[2], { identityId: 'EMOTE_ADAPT', remainingTurns: 2 });
    setYuzuShield(engine.fighters[2], 10000, engine.fighters[2].id, engine.fighters[2].name);

    withRandomSequence([0, 0.99], () => {
      engine.applyDamage(engine.fighters[0], 100, 'skill', true, engine.fighters[1], { actionName: '零伤转移测试' });
    });

    assert(!engine.fighters[2].pendingDamageEvents?.length, 'A fully shielded Joker redirect should flush Emote deferred reactions');
    assert(logs.some((entry) => entry.text.includes('转移伤害落在 表情 身上') && entry.text.includes('没有造成实际伤害')), 'A fully shielded Joker redirect should log its zero-HP settlement');
    assert(logs.some((entry) => entry.text.includes('【适应转轮】表情') && entry.text.includes('零伤转移来源')), 'Emote deferred adaptation should still be explained after a fully shielded redirect');
    cases.push('Joker zero-damage redirect flushes deferred Emote reaction');
  }

  {
    const joker = makeFighter('屑@A');
    const victim = makeFighter('持续伤害旁观者@B');
    const { engine, logs } = makeDeathEngine([joker, victim]);
    const godOfTrolls = localProject.jobs.GOD_OF_TROLLS;
    assert(godOfTrolls, 'GOD_OF_TROLLS job should exist for Joker DoT transfer tests');
    const engineJoker = engine.fighters[0];
    engineJoker.job = 'GOD_OF_TROLLS';
    engineJoker.jobData = { ...godOfTrolls, skills: [...(godOfTrolls.skills ?? [])] };
    applyTestStatus(engineJoker, { identityId: 'POISON', remainingTurns: 2 });
    const hpBefore = engineJoker.currentHp;

    withRandomSequence([0], () => {
      engine.processStatus(engineJoker);
    });

    assert(engineJoker.currentHp < hpBefore, 'Joker should take DoT damage directly');
    assert(!logs.some((entry) => entry.text.includes('随机恶作剧')), 'Joker should not transfer debuff DoT damage');
    assert(victim.stats.dmgTaken === 0, 'Joker DoT should not be redirected to another fighter');
    cases.push('Joker cannot transfer debuff DoT damage');
  }

  {
    const gamer = makeFighter('玄凝@A');
    const joker = makeFighter('屑@B');
    const bystander = makeFighter('连招旁观者@B');
    const { engine, logs } = makeDeathEngine([gamer, joker, bystander]);
    const godOfTrolls = localProject.jobs.GOD_OF_TROLLS;
    assert(godOfTrolls, 'GOD_OF_TROLLS job should exist for Joker wombo summary tests');
    engine.fighters[0].apm = 3;
    engine.fighters[0].atk = 300;
    engine.fighters[0].mag = 300;
    engine.fighters[1].job = 'GOD_OF_TROLLS';
    engine.fighters[1].jobData = { ...godOfTrolls, skills: [...(godOfTrolls.skills ?? [])] };
    engine.fighters[1].maxHp = 10000;
    localProject.setCurrentHp(engine.fighters[1], 10000);
    engine.fighters[2].maxHp = 10000;
    localProject.setCurrentHp(engine.fighters[2], 10000);

    withRandomSequence([0, 0], () => {
      engine.executeSkillAction('gamer_wombo_combo', engine.fighters[0], engine.fighters[1]);
    });

    assert(logs.some((entry) => entry.text.includes('随机恶作剧')), 'Gamer wombo regression should force Joker transfer');
    assert(logs.some((entry) => entry.text.includes('对未被转移的目标总计造成')), 'Gamer wombo summary should clarify totals when Joker redirected one segment');
    assert(!logs.some((entry) => entry.text.includes('本次多线操作总计造成')), 'Gamer wombo summary should not use ambiguous total wording after Joker transfer');
    cases.push('Gamer wombo summary clarifies Joker redirected damage');
  }

  {
    const ra = makeFighter('翼神龙后置测试者@A');
    const joker = makeFighter('屑@B');
    const victim = makeFighter('神威转移受害者@A');
    const { engine, logs } = makeDeathEngine([ra, joker, victim]);
    const godOfTrolls = localProject.jobs.GOD_OF_TROLLS;
    assert(godOfTrolls, 'GOD_OF_TROLLS job should exist for Joker afterExecute transfer tests');
    engine.fighters[1].job = 'GOD_OF_TROLLS';
    engine.fighters[1].jobData = { ...godOfTrolls, skills: [...(godOfTrolls.skills ?? [])] };
    engine.fighters[0].critRate = 0;
    engine.fighters[0].agl = 10000;
    engine.fighters[1].agl = 0;
    const atkBefore = engine.fighters[1].atk;
    const magBefore = engine.fighters[1].mag;

    withRandomSequence([0.5, 0.5, 0.99, 0, 0.99], () => {
      engine.executeSkillAction('ra_divine_pressure', engine.fighters[0], engine.fighters[1]);
    });

    assert(logs.some((entry) => entry.text.includes('随机恶作剧')), 'Joker should transfer Ra divine pressure in this regression');
    assert(engine.fighters[1].atk === atkBefore && engine.fighters[1].mag === magBefore, 'Joker should not receive afterExecute debuffs when the hit is transferred');
    assert(!engine.fighters[1].statuses.some((status) => status.identityId === 'STUN'), 'Joker should not receive the skill status when the hit is transferred');
    assert(!logs.some((entry) => entry.text.includes('【神威压制】屑 的面板')), 'Transferred Ra divine pressure should not log a debuff on Joker');
    cases.push('Joker transfer suppresses target afterExecute effects');
  }

  {
    const ra = makeFighter('翼神龙永久削弱日志@A');
    const target = makeFighter('神威正常承受者@B');
    target.maxHp = 50000;
    localProject.setCurrentHp(target, 50000);
    const { engine, logs } = makeDeathEngine([ra, target]);
    engine.fighters[0].critRate = 0;
    engine.fighters[0].agl = 10000;
    engine.fighters[1].agl = 0;
    applyTestStatus(engine.fighters[0], { identityId: 'AIM', charges: 1 });

    engine.executeSkillAction('ra_divine_pressure', engine.fighters[0], engine.fighters[1]);

    assert(
      logs.some((entry) => entry.text.includes('【神威压制】') && entry.text.includes('永久削弱') && entry.text.includes('18%') && entry.text.includes('10%')),
      '神威压制成功后必须说明面板改写为永久效果及具体比例',
    );
    cases.push('神威压制明确说明永久面板削弱的比例');
  }

  {
    const ting = makeFighter('小汀@A');
    const croc = makeFighter('牢鳄@B');
    const { engine, logs } = makeDeathEngine([ting, croc]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);

    assert(engine.fighters[0].transformed, 'Ting hook should mark the fighter as transformed');
    assert(engine.fighters[0].job === 'EXPLOSIVE_ANTI_CROC', `Ting hook should prefer anti-croc form when croc exists, got ${engine.fighters[0].job}`);
    assert(logs.some((entry) => entry.text.includes('牢鳄！我和你爆了')), 'Ting hook should keep the anti-croc transform log');
    cases.push('Ting anti-croc transform hook');
  }

  {
    const ting = makeFighter('小汀@A');
    const croc = makeFighter('牢鳄@B');
    const summon = makeFighter('护主普通召唤物@B');
    bindAsGachaSummon(croc, summon, 'Saber');
    const { engine, logs } = makeDeathEngine([ting, croc, summon]);
    const engineCroc = engine.fighters[1];
    const engineSummon = engine.fighters[2];
    forceLuckEmperor(engineCroc);
    engineCroc.maxHp = 3000;
    localProject.setCurrentHp(engineCroc, 3000);
    engineSummon.maxHp = 1200;
    localProject.setCurrentHp(engineSummon, 1200);

    const actual = withRandomSequence([0], () => engine.applyDamage(engineCroc, 1000, 'skill', true, engine.fighters[0], { actionName: '护主测试' }));

    assert(actual === 720, `Ordinary summon guard should reduce Ting damage to 720, got ${actual}`);
    assert(engineCroc.currentHp === 2280, `Croc should take the reduced damage after summon guard, got ${engineCroc.currentHp}`);
    assert(engineSummon.currentHp === 920, `Ordinary summon should absorb 280 guard damage, got ${engineSummon.currentHp}`);
    assert(logs.some((entry) => entry.text.includes('召唤物护主') && entry.text.includes('280')), 'Ordinary summon guard should explain the damage split');
    cases.push('Gacha ordinary summon guards against Ting');
  }

  {
    const ting = makeFighter('小汀@A');
    const croc = makeFighter('牢鳄@B');
    const ra = makeFighter('翼神龙护主顺序测试体@B');
    bindAsGachaSummon(croc, ra, '翼神龙', true);
    const { engine, logs } = makeDeathEngine([ting, croc, ra]);
    const engineTing = engine.fighters[0];
    const engineCroc = engine.fighters[1];
    const engineRa = engine.fighters[2];
    forceLuckEmperor(engineCroc);
    localProject.setCurrentHp(engineTing, Math.max(1, Math.floor(engineTing.maxHp * 0.4)));
    engine.handleTransformations(engineTing);
    assert(engineTing.transformed, 'Ra guardian ordering test requires phase-two Ting');
    localProject.setCurrentHp(engineTing, 100);
    engineCroc.maxHp = 3000;
    localProject.setCurrentHp(engineCroc, 500);
    engineRa.maxHp = 5000;
    engineRa.atk = 1000;
    engineRa.mag = 1000;
    localProject.setCurrentHp(engineRa, 5000);

    engine.applyDamage(engineCroc, 2000, 'skill', true, engineTing, { actionName: '翼神龙护主顺序测试' });

    const flareIndex = logs.findIndex((entry) => entry.text.includes('【护主神炎】') && entry.text.includes(engineTing.name));
    const defianceIndex = logs.findIndex((entry) => entry.text.includes('【不甘倒下】') && entry.text.includes(engineTing.name));
    const burnIndex = logs.findIndex((entry) => entry.text.includes('【灼烧】') && entry.text.includes(engineTing.name));
    assert(flareIndex >= 0 && defianceIndex > flareIndex, 'Ra guardian retaliation must report its damage before Ting defiance');
    assert(burnIndex > defianceIndex, 'Ra guardian burn must follow retaliation and lethal-save narration');
    cases.push('Ra guardian retaliation logs damage before Ting defiance and burn');
  }

  {
    const tingJoker = makeFighter('小汀@A');
    const croc = makeFighter('牢鳄@B');
    const ra = makeFighter('翼神龙转伤测试体@B');
    bindAsGachaSummon(croc, ra, '翼神龙', true);
    const { engine, logs } = makeDeathEngine([tingJoker, croc, ra]);
    const godOfTrolls = localProject.jobs.GOD_OF_TROLLS;
    assert(godOfTrolls, 'GOD_OF_TROLLS job should exist for Ra guardian redirect tests');
    const engineTing = engine.fighters[0];
    const engineCroc = engine.fighters[1];
    const engineRa = engine.fighters[2];
    engineTing.job = 'GOD_OF_TROLLS';
    engineTing.jobData = { ...godOfTrolls, skills: [...(godOfTrolls.skills ?? [])] };
    engineTing.transformed = true;
    engineTing.maxHp = 10000;
    localProject.setCurrentHp(engineTing, 10000);
    forceLuckEmperor(engineCroc);
    engineCroc.maxHp = 3000;
    localProject.setCurrentHp(engineCroc, 500);
    engineRa.maxHp = 5000;
    engineRa.atk = 1000;
    engineRa.mag = 1000;
    localProject.setCurrentHp(engineRa, 5000);

    withRandomSequence([0, 0], () => {
      engine.applyDamage(engineCroc, 2000, 'skill', true, engineTing, { actionName: '翼神龙转伤测试' });
    });

    assert(logs.some((entry) => entry.text.includes('随机恶作剧') && entry.text.includes('护主神炎')), 'Ra guardian retaliation should expose the Joker redirect cause');
    assert(logs.some((entry) => entry.text.includes('【护主神炎】') && entry.text.includes('被转伤机制接管')), 'Ra guardian outer log should acknowledge redirected retaliation');
    assert(!logs.some((entry) => entry.text.includes('【护主神炎】') && entry.text.includes(`被 ${engineTing.name} 化解`)), 'Redirected Ra retaliation must not be mislabeled as target mitigation');
    assert(!engineTing.statuses.some((status) => status.identityId === 'BURN'), 'A fully redirected Ra retaliation must not burn the original target');
    cases.push('Ra guardian retaliation preserves redirect context and on-hit ownership');
  }

  {
    const ting = makeFighter('小汀@A');
    const croc = makeFighter('牢鳄@B');
    const exodia = makeFighter('黑暗大法师@B');
    bindAsGachaSummon(croc, exodia, '黑暗大法师', true);
    const { engine, logs } = makeDeathEngine([ting, croc, exodia]);
    const engineCroc = engine.fighters[1];
    const engineExodia = engine.fighters[2];
    forceLuckEmperor(engineCroc);
    engineCroc.maxHp = 3000;
    localProject.setCurrentHp(engineCroc, 500);

    const actual = engine.applyDamage(engineCroc, 1000, 'skill', true, engine.fighters[0], { actionName: '封印护壁测试' });

    assert(actual === 0, `Exodia guard should nullify lethal Ting damage, got ${actual}`);
    assert(engineCroc.currentHp === 500, 'Exodia guard should keep Croc HP unchanged');
    assert(engineExodia.hasUsedExodiaGuard, 'Exodia guard should be marked as used');
    assert(logs.some((entry) => entry.text.includes('封印护壁') && entry.text.includes('无效化')), 'Exodia guard should log the lethal prevention');
    cases.push('Exodia guard nullifies lethal Ting hit once');
  }

  {
    const ting = makeFighter('小汀@A');
    const croc = makeFighter('牢鳄@B');
    const { engine, logs } = makeDeathEngine([ting, croc]);
    const engineCroc = engine.fighters[1];
    forceLuckEmperor(engineCroc);
    engineCroc.maxHp = 3000;
    engineCroc.gachaTingGuardTrapReady = true;
    localProject.setCurrentHp(engineCroc, 3000);

    const actual = engine.applyDamage(engineCroc, 1000, 'skill', true, engine.fighters[0], { actionName: '护主陷阱测试' });
    const trapSummon = engine.fighters.find((fighter) => fighter.summonBaseName === '护主栗子球');

    assert(actual === 640, `Ting guard trap should reduce damage to 640, got ${actual}`);
    assert(trapSummon && trapSummon.currentHp === 840, `Guard trap summon should absorb 360 damage, got ${trapSummon?.currentHp}`);
    assert(!engineCroc.gachaTingGuardTrapReady, 'Ting guard trap should be consumed after flipping');
    assert(logs.some((entry) => entry.text.includes('护主陷阱')), 'Ting guard trap should explain the emergency summon');
    cases.push('Gacha Ting guard trap flips into substitute summon');
  }

  {
    const ting = makeFighter('小汀@A');
    const croc = makeFighter('牢鳄@B');
    const blueEyes = makeFighter('青眼白龙@B');
    bindAsGachaSummon(croc, blueEyes, '青眼白龙', true);
    const { engine, logs } = makeDeathEngine([ting, croc, blueEyes]);
    const engineTing = engine.fighters[0];
    const engineCroc = engine.fighters[1];
    const engineBlueEyes = engine.fighters[2];
    forceLuckEmperor(engineCroc);
    engineCroc.hasUsedGachaDeathSave = true;
    engineTing.maxHp = 10000;
    localProject.setCurrentHp(engineTing, 10000);
    engineBlueEyes.atk = 120;
    engineBlueEyes.mag = 180;
    engineBlueEyes.spd = 140;

    engine.markDefeated(engineCroc, { message: '💀 【测试】小汀击倒牢鳄。', killer: engineTing });

    assert(logs.some((entry) => entry.text.includes('召唤师遗产')), 'Advanced summons should inherit a revenge order when Ting defeats Croc');
    assert(logs.some((entry) => entry.text.includes('复仇指令') && entry.text.includes('青眼白龙')), 'The strongest advanced summon should immediately pressure Ting');
    assert(engineBlueEyes.statuses.some((status) => status.identityId === 'BKB'), 'Gacha revenge should briefly protect advanced summons');
    assert(engineBlueEyes.statuses.some((status) => status.identityId === 'REGEN'), 'Gacha revenge should give advanced summons regeneration');
    cases.push('Gacha advanced summons revenge Ting after Croc defeat');
  }

  {
    const ting = makeFighter('小汀@A');
    const croc = makeFighter('牢鳄@B');
    const { engine, logs } = makeDeathEngine([ting, croc]);
    const engineTing = engine.fighters[0];
    const engineCroc = engine.fighters[1];
    engineTing.maxHp = 4000;
    localProject.setCurrentHp(engineTing, 1000);
    engineTing.atk = 120;
    engineTing.def = 240;
    engineTing.res = 180;
    applyTestStatus(engineTing, { identityId: 'POISON', remainingTurns: 2 });
    applyTestStatus(engineTing, { identityId: 'STUN', remainingTurns: 2 });
    applyTestStatus(engineTing, { identityId: 'NO_HEAL', remainingTurns: 2 });
    applyTestStatus(engineTing, { identityId: 'ZEROED', remainingTurns: 2 });
    assert(Math.abs(getEffectiveCombatStat(engineTing, 'atk') - 12) < 0.001, 'ZEROED should reduce the calculated attack without overwriting the raw stat');

    engine.markDefeated(engineCroc, { message: '💀 【测试】牢鳄被小汀击倒。', killer: engineTing });

    assert(engineTing.stats.kills === 1, `Ting should receive the Croc kill, got ${engineTing.stats.kills}`);
    assert(engineTing.currentHp === 3320, `Ting Croc-kill momentum should heal 58% max HP, got ${engineTing.currentHp}`);
    assert(engineTing.atk === 120 && engineTing.def === 240 && engineTing.res === 180, 'Ting Croc-kill momentum should preserve the raw stats behind ZEROED');
    assert(getEffectiveCombatStat(engineTing, 'atk') === 120, 'Ting Croc-kill momentum should remove the ZEROED calculation penalty');
    assert(!engineTing.statuses.some((status) => ['POISON', 'STUN', 'NO_HEAL', 'ZEROED'].includes(status.identityId)), 'Ting Croc-kill momentum should cleanse dangerous negative statuses');
    assert(['INVUL', 'BKB', 'SPELL_BLOCK', 'REGEN'].every((type) => engineTing.statuses.some((status) => status.identityId === type)), 'Ting Croc-kill momentum should grant short survival statuses');
    assert(logs.some((entry) => entry.text.includes('爆鳄余烬') && entry.text.includes('亲手击倒')), 'Ting Croc-kill momentum should explain the post-kill recovery in logs');
    cases.push('Ting Croc-kill momentum cleanses and heals');
  }

  {
    const ting = makeFighter('小汀@A');
    const target = makeFighter('吸血残血靶子@B');
    const { engine, logs } = makeDeathEngine([ting, target]);
    const engineTing = engine.fighters[0];
    const engineTarget = engine.fighters[1];
    engineTing.transformed = true;
    engineTing.maxHp = 5000;
    localProject.setCurrentHp(engineTing, 1000);
    engineTarget.maxHp = 5000;
    localProject.setCurrentHp(engineTarget, 1);

    engine.applyLifestealEffects(engineTing, engineTarget, engine.SKILLS.grudge_rend, 1000, 1);

    assert(engineTing.currentHp === 2050, `Ting lifesteal should use a capped overkill base against near-dead targets, got ${engineTing.currentHp}`);
    assert(logs.some((entry) => entry.text.includes('触发吸血被动') && entry.text.includes('1050')), 'Ting overkill lifesteal should log the actual recovered amount');
    cases.push('Ting overkill lifesteal has capped heal base');
  }

  {
    const ting = makeFighter('小汀@A');
    const croc = makeFighter('牢鳄@B');
    const { engine } = makeDeathEngine([ting, croc]);
    localProject.setCurrentHp(engine.fighters[1], Math.floor(engine.fighters[1].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[1]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    localProject.setCurrentHp(engine.fighters[0], engine.fighters[0].maxHp);
    localProject.setCurrentHp(engine.fighters[1], engine.fighters[1].maxHp);
    engine.fighters[0].critRate = 0;
    engine.fighters[0].agl = 0;

    withRandomSequence([0, 0.99], () => {
      engine.executeSkillAction('suicide_bomb', engine.fighters[0], engine.fighters[1]);
    });

    assert(engine.fighters[1].currentHp > 0 && !engine.fighters[1].isDeadAnnounced, 'Ting suicide bomb should not one-shot full-health transformed Croc');
    assert(engine.fighters[0].currentHp > 0 && !engine.fighters[0].isDeadAnnounced, 'Ting suicide bomb recoil should not directly remove Ting from the battlefield');
    assert(engine.fighters[0].hpPct >= 0.6 && engine.fighters[0].hpPct <= 0.85, `Ting suicide bomb should leave a meaningful but non-crippling recoil cost after lifesteal, got hpPct ${engine.fighters[0].hpPct}`);
    cases.push('Ting suicide bomb damages without double-removal');
  }

  {
    const tokusatsu = makeFighter('刺猬人@A');
    const { engine, logs } = makeDeathEngine([tokusatsu, makeFighter('变身旁观者@B')]);
    const baseRes = engine.fighters[0].res;
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);

    assert(engine.fighters[0].transformed, 'Tokusatsu hook should mark the fighter as transformed');
    assert(engine.fighters[0].job === 'MIRACLE_BUJIN', `Tokusatsu hook should transform to MIRACLE_BUJIN, got ${engine.fighters[0].job}`);
    assert(engine.fighters[0].res > baseRes && engine.fighters[0].res >= 120, `Tokusatsu transform should raise resistance, got ${baseRes} -> ${engine.fighters[0].res}`);
    assert(engine.fighters[0].statuses.some((status) => status.identityId === 'BKB'), 'Tokusatsu transform should add short BKB protection');
    assert(engine.fighters[0].statuses.some((status) => status.identityId === 'SPELL_BLOCK'), 'Tokusatsu transform should add short spell block protection');
    assert(logs.some((entry) => entry.text.includes('奇迹武刃')), 'Tokusatsu hook should keep the original transform log');
    cases.push('Tokusatsu transform hook');
  }

  {
    const tokusatsu = makeFighter('刺猬人@A');
    const { engine } = makeDeathEngine([tokusatsu, makeFighter('王座共鸣靶@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    engine.fighters[0].tokusatsuThroneResonance = 4;

    const selectedSkill = withRandomSequence([0.09], () => engine.selectSkill(engine.fighters[0]));

    assert(selectedSkill === 'bujin_chair', `Tokusatsu throne resonance should raise high-HP chair chance enough to select bujin_chair, got ${selectedSkill}`);
    cases.push('Tokusatsu throne resonance raises chair selection chance');
  }

  {
    const tokusatsu = makeFighter('刺猬人@A');
    const target = makeFighter('镜界标记决策靶@B');
    const monsterJob = localProject.jobs.MIRACLE_MONSTER_BUJIN;
    assert(monsterJob, 'MIRACLE_MONSTER_BUJIN job should exist for cleanse decision tests');
    tokusatsu.job = 'MIRACLE_MONSTER_BUJIN';
    tokusatsu.jobData = JSON.parse(JSON.stringify(monsterJob)) as typeof monsterJob;
    tokusatsu.isTokusatsu = true;
    tokusatsu.transformed = true;
    tokusatsu.hasUsedRainbowFever = true;
    const { engine } = makeDeathEngine([tokusatsu, target]);
    const engineTokusatsu = engine.fighters[0];
    applyTestStatus(engineTokusatsu, { identityId: 'YUZU_MARKED' });

    assert(
      queryDispellableStatuses(engineTokusatsu, { strength: 'strong', direction: 'negative' }).length === 0,
      'The permanent Yuzu mirror mark must not be classified as a strong-dispellable negative status',
    );
    const markedSelection = withRandomSequence([0.99], () => engine.selectSkill(engineTokusatsu));
    assert(markedSelection !== 'miracle_armor', `Yuzu mirror mark must not force Miracle Armor, got ${markedSelection}`);

    applyTestStatus(engineTokusatsu, { identityId: 'WEAK', remainingTurns: 2 });
    assert(
      queryDispellableStatuses(engineTokusatsu, { strength: 'strong', direction: 'negative' })
        .some((status) => status.identityId === 'WEAK'),
      'A normal-dispellable negative status should remain visible to strong cleanse decisions',
    );
    const debuffedSelection = withRandomSequence([0.99], () => engine.selectSkill(engineTokusatsu));
    assert(debuffedSelection === 'miracle_armor', `A removable negative status should force Miracle Armor, got ${debuffedSelection}`);
    cases.push('Tokusatsu cleanse decisions ignore permanent Yuzu mark but respond to removable debuffs');
  }

  {
    const tokusatsu = makeFighter('刺猬人@A');
    const { engine, logs } = makeDeathEngine([tokusatsu, makeFighter('王座控制靶@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    const engineTokusatsu = engine.fighters[0];
    removeEffects(engineTokusatsu, { identityIds: ['BKB', 'SPELL_BLOCK'], reason: 'scripted' });
    engineTokusatsu.tokusatsuThroneResonance = 4;
    applyTestStatus(engineTokusatsu, { identityId: 'STUN', remainingTurns: 2 });

    const canAct = withRandomSequence([0], () => engine.processStatus(engineTokusatsu));

    assert(canAct, 'Tokusatsu control resonance should convert the skipped action into a throne stance');
    assert(engineTokusatsu.statuses.some((status) => status.identityId === 'WAIT_COUNTER'), 'Tokusatsu control resonance should add WAIT_COUNTER');
    assert(!engineTokusatsu.statuses.some((status) => status.identityId === 'STUN'), 'Tokusatsu control resonance should cleanse the blocking control');
    assert(logs.some((entry) => entry.text.includes('悲愿共鸣') && entry.text.includes('武神王座')), 'Tokusatsu control resonance should explain the throne conversion');
    cases.push('Tokusatsu control skip can become throne stance');
  }

  {
    const tokusatsu = makeFighter('刺猬人@A');
    const target = makeFighter('王座防御靶@B');
    const { engine, logs } = makeDeathEngine([tokusatsu, target]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    const engineTokusatsu = engine.fighters[0];
    engineTokusatsu.tokusatsuThroneResonance = 3;

    engine.executeSkillAction('bujin_chair', engineTokusatsu, engine.fighters[1]);

    assert(engineTokusatsu.statuses.some((status) => status.identityId === 'WAIT_COUNTER' && status.charges === 1), 'Tokusatsu chair should add a one-use wait counter');
    assert(engineTokusatsu.statuses.some((status) => status.identityId === 'BKB' && status.remainingTurns === 2 && status.attribution.effectSourceId === 'tokusatsu_bujin_throne'), 'Tokusatsu chair should add 2-turn throne-sourced control armor');
    assert(engineTokusatsu.statuses.some((status) => status.identityId === 'SPELL_BLOCK' && status.charges === 2 && status.attribution.effectSourceId === 'tokusatsu_bujin_throne'), 'Tokusatsu chair should add two throne-sourced spell-block charges');
    const throneStatuses = engineTokusatsu.statuses.filter((status) =>
      status.groupId === 'tokusatsu_bujin_throne',
    );
    assert(throneStatuses.length === 3 && throneStatuses.every((status) => status.groupId === 'tokusatsu_bujin_throne'), 'Tokusatsu chair mechanics should share one presentation group');
    const throneItems = buildFighterStatusPresentation(engineTokusatsu).filter((item) => item.name === '武神王座');
    assert(throneItems.length === 1 && throneItems[0].members.length === 3, 'Tokusatsu chair should render as one theme with three mechanics');
    assert((engineTokusatsu.tokusatsuThroneResonance ?? -1) === 0, 'Tokusatsu chair should consume stored throne resonance');
    assert(logs.some((entry) => entry.text.includes('悲愿共鸣 3 层')), 'Tokusatsu chair should mention consumed resonance when present');

    removeEffects(engineTokusatsu, { groupIds: ['tokusatsu_bujin_throne'], identityIds: ['SPELL_BLOCK'], reason: 'consumed' });
    const throneArmor = engineTokusatsu.statuses.find((status) =>
      status.identityId === 'BKB' && status.groupId === 'tokusatsu_bujin_throne',
    );
    assert(throneArmor, 'Tokusatsu throne armor should remain before its timed expiry');
    throneArmor.remainingTurns = 1;
    throneArmor.lastAdvancedAt = 0;
    advanceGlobalTimedStatuses(engine.fighters, 1, (type, text) => engine.log(type, text));
    assert(engineTokusatsu.statuses.some((status) => status.identityId === 'WAIT_COUNTER'), 'Tokusatsu wait counter must survive the temporary armor expiry');
    assert(!logs.some((entry) => entry.text.includes('【武神王座】自然结束')), 'temporary throne armor expiry must not claim the whole throne ended');
    assert(logs.some((entry) => entry.text.includes('【状态变化】') && entry.text.includes('【武神王座】') && entry.text.includes('【等待反击】仍在生效')), 'throne expiry log should state that its wait counter remains active');
    cases.push('Tokusatsu chair grants throne-sourced defenses');
  }

  {
    const attacker = makeFighter('武神王座攻击者@A');
    const tokusatsu = makeFighter('刺猬人@B');
    applyTestStatus(attacker, { identityId: 'AIM', charges: 3 });
    attacker.atk = 100;
    attacker.agl = 10000;
    tokusatsu.maxHp = 100000;
    localProject.setCurrentHp(tokusatsu, 100000);
    applyTestStatus(tokusatsu, { identityId: 'WAIT_COUNTER', charges: 3 });
    const { engine, logs } = makeDeathEngine([attacker, tokusatsu]);

    engine.executeSkillAction('serious_punch', engine.fighters[0], engine.fighters[1]);

    assert(engine.fighters[1].counterUsed, 'Tokusatsu wait counter hook should consume the counter');
    assert(engine.fighters[1].job === 'MIRACLE_MONSTER_BUJIN', `Tokusatsu wait counter hook should transform to monster form, got ${engine.fighters[1].job}`);
    assert(!engine.fighters[1].statuses.some((status) => status.identityId === 'WAIT_COUNTER'), 'Tokusatsu wait counter hook should remove WAIT_COUNTER status');
    assert(engine.fighters[1].hasUsedGreatMonsterVictory, 'Tokusatsu wait counter hook should fire GREAT MONSTER VICTORY once');
    assert(logs.some((entry) => entry.text.includes('GREAT！MONSTER')), 'Tokusatsu wait counter hook should keep the monster transform log');
    const monsterVictoryVisuals = engine.events.filter((event) =>
      (event.visualCue?.kind === 'combat_action' || event.visualCue?.kind === 'combat_fx') &&
      event.visualCue.sourceId === engine.fighters[1].id,
    );
    assert(monsterVictoryVisuals.length > 0, 'Tokusatsu wait counter should publish its own Monster Victory visual');
    assert(
      monsterVictoryVisuals.every((event) => event.actorId === engine.fighters[1].id),
      'Nested Monster Victory visuals must retain Tokusatsu as the authoritative actor',
    );
    cases.push('Tokusatsu wait counter hook');
  }

  {
    const attacker = makeFighter('王座范围技攻击者@A');
    const tokusatsu = makeFighter('刺猬人@B');
    const { engine, logs } = makeDeathEngine([attacker, tokusatsu]);
    const engineAttacker = engine.fighters[0];
    const engineTokusatsu = engine.fighters[1];
    engineAttacker.maxHp = 100000;
    localProject.setCurrentHp(engineAttacker, 100000);
    engineTokusatsu.maxHp = 100000;
    localProject.setCurrentHp(engineTokusatsu, 100000);
    applyTestStatus(engineTokusatsu, { identityId: 'WAIT_COUNTER', charges: 3 });

    const actual = engine.applyDamage(engineTokusatsu, 1000, 'skill', true, engineAttacker, { actionName: '范围波及测试' });

    assert(actual === 250, `Tokusatsu throne should reduce active splash damage to 25%, got ${actual}`);
    assert(engineTokusatsu.counterUsed, 'Tokusatsu throne should be consumed by active splash damage');
    assert(engineTokusatsu.job === 'MIRACLE_MONSTER_BUJIN', `Tokusatsu active splash counter should transform to monster form, got ${engineTokusatsu.job}`);
    assert(engineTokusatsu.res >= 128, `Tokusatsu monster form should raise resistance, got ${engineTokusatsu.res}`);
    assert(logs.some((entry) => entry.text.includes('范围波及测试') && entry.text.includes('等待反击判定')), 'Tokusatsu active splash counter should explain the incoming active damage');
    cases.push('Tokusatsu throne catches active splash damage');
  }

  {
    const tokusatsu = makeFighter('刺猬人@A');
    const attacker = makeFighter('悲愿测试者@B');
    const { engine, logs } = makeDeathEngine([tokusatsu, attacker]);
    const monsterJob = localProject.jobs.MIRACLE_MONSTER_BUJIN;
    assert(monsterJob, 'MIRACLE_MONSTER_BUJIN job should exist for Tokusatsu defiance tests');
    const engineTokusatsu = engine.fighters[0];
    const engineAttacker = engine.fighters[1];
    engineTokusatsu.job = 'MIRACLE_MONSTER_BUJIN';
    engineTokusatsu.jobData = JSON.parse(JSON.stringify(monsterJob)) as typeof monsterJob;
    engineTokusatsu.transformed = true;
    engineTokusatsu.maxHp = 5000;
    localProject.setCurrentHp(engineTokusatsu, 120);
    applyTestStatus(engineTokusatsu, { identityId: 'POISON', remainingTurns: 3 });
    applyTestStatus(engineTokusatsu, { identityId: 'WT_SUPPRESS', remainingTurns: 2 });

    engine.applyDamage(engineTokusatsu, 9999, 'skill', true, engineAttacker, { actionName: '悲愿致死测试' });

    assert(engineTokusatsu.currentHp > 0 && !engineTokusatsu.isDeadAnnounced, 'Tokusatsu defiance should prevent the first lethal monster-form hit');
    assert(engineTokusatsu.hasUsedTokusatsuDefiance, 'Tokusatsu defiance should be marked as consumed');
    assert(engineTokusatsu.tokusatsuInstantActionQueued, 'Tokusatsu defiance should queue an instant counter action');
    assert(!engineTokusatsu.statuses.some((status) => status.identityId === 'POISON' || status.identityId === 'WT_SUPPRESS'), 'Tokusatsu defiance should cleanse negative statuses');
    assert(engineTokusatsu.statuses.some((status) => status.identityId === 'TOKUSATSU_DEFIANCE'), 'Tokusatsu defiance should add a visible status');

    engine.finishStep({ current: false });

    assert(!engineTokusatsu.tokusatsuInstantActionQueued, 'Tokusatsu instant counter should resolve during finishStep');
    assert(logs.some((entry) => entry.text.includes('悲愿不倒')), 'Tokusatsu defiance should log the lethal prevention');
    assert(logs.some((entry) => entry.text.includes('悲愿反扑')), 'Tokusatsu defiance should log the instant counter');
    cases.push('Tokusatsu monster defiance queues instant counter');
  }

  {
    const claire = makeFighter('克蕾儿丝菲尔@A');
    const tokusatsu = makeFighter('刺猬人@B');
    const { engine, logs } = makeDeathEngine([claire, tokusatsu]);
    const monsterJob = localProject.jobs.MIRACLE_MONSTER_BUJIN;
    assert(monsterJob, 'MIRACLE_MONSTER_BUJIN job should exist for nested landing-order tests');
    const engineClaire = engine.fighters[0];
    const engineTokusatsu = engine.fighters[1];
    engineClaire.mag = 10000;
    engineClaire.agl = 10000;
    applyTestStatus(engineClaire, { identityId: 'AIM', charges: 1 });
    engineTokusatsu.job = 'MIRACLE_MONSTER_BUJIN';
    engineTokusatsu.jobData = JSON.parse(JSON.stringify(monsterJob)) as typeof monsterJob;
    engineTokusatsu.transformed = true;
    engineTokusatsu.maxHp = 3830;
    localProject.setCurrentHp(engineTokusatsu, 120);
    applyTestStatus(engineTokusatsu, {
      identityId: 'AIRBORNE',
      remainingTurns: 2,
      attribution: { effectSourceId: 'war_thunder_airborne' },
    });

    engine.executeSkillAction('chimera_funnels', engineClaire, engineTokusatsu);

    const previewIndex = logs.findIndex((entry) => entry.text.includes('【歼灭·全弹发射】') && entry.text.includes('结算前预估'));
    const resultIndex = logs.findIndex((entry) => entry.text.includes('📌 实际结算：刺猬人'));
    const defianceIndex = logs.findIndex((entry) => entry.text.includes('【悲愿不倒】刺猬人'));
    const earlyLandingIndex = logs.findIndex((entry) => entry.text.includes('【提前落地】刺猬人'));
    const landingIndex = logs.findIndex((entry) => entry.text.includes('【炮震坠落】刺猬人'));
    assert(previewIndex >= 0 && resultIndex > previewIndex, 'The parent hit must publish its authoritative result after the preview');
    assert(defianceIndex > resultIndex, 'Tokusatsu defiance must resolve after the parent damage result');
    assert(earlyLandingIndex > defianceIndex, 'Strong-dispel landing must be announced after Tokusatsu defiance');
    assert(landingIndex > earlyLandingIndex, 'Airborne landing damage must resolve after its early-landing cause');
    assert(!engineTokusatsu.pendingDamageEvents?.length, 'Nested landing resolution must not leave deferred damage logs behind');
    cases.push('Tokusatsu lethal cleanse defers airborne landing until after the parent hit result');
  }

  {
    const morphling = makeFighter('水人@A');
    const tokusatsu = makeFighter('刺猬人@B');
    const { engine, logs } = makeDeathEngine([morphling, tokusatsu]);
    const engineMorphling = engine.fighters[0];
    const engineTokusatsu = engine.fighters[1];
    engineMorphling.mag = 1;
    engineTokusatsu.maxHp = 4000;
    localProject.setCurrentHp(engineTokusatsu, 700);
    applyTestStatus(engineTokusatsu, { identityId: 'TOKUSATSU_DEFIANCE', remainingTurns: 2 });
    engineTokusatsu.tokusatsuInstantActionQueued = true;
    engineTokusatsu.transformed = true;

    const prison = localProject.skills.abyssal_prison;
    assert(prison?.afterExecute, 'abyssal_prison afterExecute should exist for execution guard tests');
    const ctx = engine.createSkillContext(engineMorphling, engineTokusatsu, [engineTokusatsu], 0, '深渊水牢');
    ctx.targetWasTransformedBeforeDamage = true;
    prison.afterExecute(ctx, 1);

    assert(engineTokusatsu.currentHp === 0, 'Abyssal prison execute should kill through active Tokusatsu defiance');
    assert(engineTokusatsu.isDeadAnnounced, 'Abyssal prison execute should announce death through active death save');
    assert(logs.some((entry) => entry.text.includes('溺毙处决') && entry.text.includes('彻底停止了呼吸')), 'Abyssal prison should log the waterman-only execution');
    assert(!logs.some((entry) => entry.text.includes('溺毙处决') && entry.text.includes('保命机制')), 'Abyssal prison should not treat active Tokusatsu defiance as a blocker for waterman');
    cases.push('Abyssal prison execute pierces active Tokusatsu defiance');
  }

  {
    const morphling = makeFighter('水人@A');
    const ting = makeFighter('小汀@B');
    const { engine, logs } = makeDeathEngine([morphling, ting]);
    const engineMorphling = engine.fighters[0];
    const engineTing = engine.fighters[1];
    engineMorphling.mag = 1;
    engineTing.maxHp = 4000;
    localProject.setCurrentHp(engineTing, 700);
    applyTestStatus(engineTing, { identityId: 'TING_DEFIANCE', remainingTurns: 3 });
    engineTing.transformed = true;

    const prison = localProject.skills.abyssal_prison;
    assert(prison?.afterExecute, 'abyssal_prison afterExecute should exist for Ting execution guard tests');
    const ctx = engine.createSkillContext(engineMorphling, engineTing, [engineTing], 0, '深渊水牢');
    ctx.targetWasTransformedBeforeDamage = true;
    prison.afterExecute(ctx, 1);

    assert(engineTing.currentHp === 0, 'Abyssal prison execute should kill through active Ting defiance');
    assert(engineTing.isDeadAnnounced, 'Abyssal prison execute should announce death through active Ting defiance');
    assert(logs.some((entry) => entry.text.includes('溺毙处决') && entry.text.includes('彻底停止了呼吸')), 'Abyssal prison should log the waterman-only execution against Ting');
    assert(!logs.some((entry) => entry.text.includes('溺毙处决') && entry.text.includes('保命机制')), 'Abyssal prison should not treat active Ting defiance as a blocker for waterman');
    cases.push('Abyssal prison execute pierces active Ting defiance');
  }

  {
    const morphling = makeFighter('水人@A');
    const tokusatsu = makeFighter('刺猬人@B');
    const { engine, logs } = makeDeathEngine([morphling, tokusatsu]);
    const engineMorphling = engine.fighters[0];
    const engineTokusatsu = engine.fighters[1];
    engineMorphling.mag = 1;
    engineTokusatsu.maxHp = 4000;
    engineTokusatsu.transformed = true;
    localProject.setCurrentHp(engineTokusatsu, 700);

    const prison = localProject.skills.abyssal_prison;
    assert(prison?.afterExecute, 'abyssal_prison afterExecute should exist for fresh phase-lock tests');
    const ctx = engine.createSkillContext(engineMorphling, engineTokusatsu, [engineTokusatsu], 0, '深渊水牢');
    ctx.targetWasTransformedBeforeDamage = false;
    prison.afterExecute(ctx, 1);

    assert(engineTokusatsu.currentHp > 0, 'Abyssal prison execute should not bypass a fresh phase-2 transformation lock');
    assert(!engineTokusatsu.isDead && !engineTokusatsu.isDeadAnnounced, 'Abyssal prison execute should leave fresh phase-lock targets alive');
    assert(logs.some((entry) => entry.text.includes('溺毙处决') && entry.text.includes('阶段锁血')), 'Abyssal prison should explain that phase transition lock cannot be skipped');
    cases.push('Abyssal prison execute preserves fresh transform lock');
  }

  {
    const morphling = makeFighter('水人@A');
    const target = makeFighter('普通目标@B');
    const { engine, logs } = makeDeathEngine([morphling, target]);
    const engineMorphling = engine.fighters[0];
    const engineTarget = engine.fighters[1];
    engineTarget.maxHp = 4000;
    localProject.setCurrentHp(engineTarget, 700);

    const prison = localProject.skills.abyssal_prison;
    assert(prison?.afterExecute, 'abyssal_prison afterExecute should exist for normal execute tests');
    const ctx = engine.createSkillContext(engineMorphling, engineTarget, [engineTarget], 0, '深渊水牢');
    ctx.targetWasTransformedBeforeDamage = false;
    prison.afterExecute(ctx, 1);

    assert(engineTarget.currentHp === 0 && engineTarget.isDeadAnnounced, 'Abyssal prison execute should still kill normal non-transform targets');
    assert(!logs.some((entry) => entry.text.includes('溺毙处决') && entry.text.includes('阶段锁血')), 'Abyssal prison should not report phase-lock protection for normal targets');
    cases.push('Abyssal prison execute does not overprotect normal low-health targets');
  }

  {
    const morphling = makeFighter('水人@A');
    const tokusatsu = makeFighter('刺猬人@B');
    const { engine, logs } = makeDeathEngine([morphling, tokusatsu]);
    const engineMorphling = engine.fighters[0];
    const engineTokusatsu = engine.fighters[1];
    engineMorphling.mag = 100000;
    engineMorphling.wis = 100000;
    engineTokusatsu.res = 1;
    engineTokusatsu.maxHp = 1000;
    localProject.setCurrentHp(engineTokusatsu, 100);

    engine.executeSkillAction('nullifier', engineMorphling, engineTokusatsu);

    assert(engineTokusatsu.transformed, 'Nullifier lethal damage should still allow a fresh Tokusatsu phase-2 transformation');
    assert(engineTokusatsu.job === 'MIRACLE_BUJIN', `Nullifier should leave fresh Tokusatsu in MIRACLE_BUJIN, got ${engineTokusatsu.job}`);
    assert(engineTokusatsu.currentHp > 0 && !engineTokusatsu.isDead && !engineTokusatsu.isDeadAnnounced, 'Nullifier should not bypass a fresh phase-transition lock');
    assert(logs.some((entry) => entry.text.includes('锁血保护')), 'Nullifier lethal damage should log fresh phase lock protection');
    assert(logs.some((entry) => entry.text.includes('变身') && entry.text.includes('奇迹武刃')), 'Nullifier lethal damage should still complete the phase-2 transform log');
    cases.push('Nullifier preserves fresh transform lock');
  }

  {
    const tokusatsu = makeFighter('刺猬人@A');
    const attacker = makeFighter('多段追击者@B');
    const { engine, logs } = makeDeathEngine([tokusatsu, attacker]);
    const monsterJob = localProject.jobs.MIRACLE_MONSTER_BUJIN;
    assert(monsterJob, 'MIRACLE_MONSTER_BUJIN job should exist for active Tokusatsu defiance tests');
    const engineTokusatsu = engine.fighters[0];
    const engineAttacker = engine.fighters[1];
    engineTokusatsu.job = 'MIRACLE_MONSTER_BUJIN';
    engineTokusatsu.jobData = JSON.parse(JSON.stringify(monsterJob)) as typeof monsterJob;
    engineTokusatsu.transformed = true;
    engineTokusatsu.hasUsedTokusatsuDefiance = true;
    engineTokusatsu.maxHp = 4160;
    localProject.setCurrentHp(engineTokusatsu, 1);
    applyTestStatus(engineTokusatsu, { identityId: 'TOKUSATSU_DEFIANCE', remainingTurns: 2 });

    engine.applyDamage(engineTokusatsu, 9999, 'skill', true, engineAttacker, { actionName: '多段后续伤害' });

    assert(engineTokusatsu.currentHp === 1, 'active Tokusatsu defiance should keep follow-up lethal damage at 1 HP');
    assert(!engineTokusatsu.isDead && !engineTokusatsu.isDeadAnnounced, 'active Tokusatsu defiance should prevent immediate follow-up death');
    assert(logs.some((entry) => entry.text.includes('悲愿不倒') && entry.text.includes('压回 1 点生命')), 'active Tokusatsu defiance should explain the rewritten follow-up lethal damage');
    cases.push('Active Tokusatsu defiance rewrites follow-up lethal damage');
  }

  {
    const tokusatsu = makeFighter('刺猬人@A');
    const joker = makeFighter('屑@B');
    const { engine, logs } = makeDeathEngine([tokusatsu, joker]);
    const monsterJob = localProject.jobs.MIRACLE_MONSTER_BUJIN;
    const jokerJob = localProject.jobs.GOD_OF_TROLLS;
    assert(monsterJob, 'MIRACLE_MONSTER_BUJIN job should exist for Tokusatsu redirected-rainbow tests');
    assert(jokerJob, 'GOD_OF_TROLLS job should exist for Tokusatsu redirected-rainbow tests');
    const engineTokusatsu = engine.fighters[0];
    const engineJoker = engine.fighters[1];
    engineTokusatsu.job = 'MIRACLE_MONSTER_BUJIN';
    engineTokusatsu.jobData = JSON.parse(JSON.stringify(monsterJob)) as typeof monsterJob;
    engineTokusatsu.transformed = true;
    engineTokusatsu.hasUsedTokusatsuDefiance = true;
    engineTokusatsu.maxHp = 4000;
    localProject.setCurrentHp(engineTokusatsu, 300);
    engineTokusatsu.atk = 260;
    engineTokusatsu.mag = 180;
    engineTokusatsu.spd = 130;
    engineJoker.job = 'GOD_OF_TROLLS';
    engineJoker.jobData = JSON.parse(JSON.stringify(jokerJob)) as typeof jokerJob;
    engineJoker.maxHp = 10000;
    localProject.setCurrentHp(engineJoker, 10000);

    withRandomSequence([0, 0], () => {
      engine.executeSkillAction('rainbow_fever', engineTokusatsu, engineJoker);
    });

    const deathIndex = logs.findIndex((entry) => entry.text.includes('伤害转移') && entry.text.includes('刺猬人 被 屑'));
    assert(deathIndex >= 0, 'Redirected Rainbow Fever should be able to kill Tokusatsu through Joker transfer in this regression');
    const afterDeathTexts = logs.slice(deathIndex + 1).map((entry) => entry.text);
    assert(!afterDeathTexts.some((text) => text.includes('彩虹炼金余波回流')), 'Redirected Rainbow Fever should not heal Tokusatsu after Tokusatsu dies');
    assert(!afterDeathTexts.some((text) => text.includes('彩虹列车余波')), 'Redirected Rainbow Fever should stop splash lines after Tokusatsu dies');
    cases.push('Tokusatsu redirected Rainbow Fever stops after self-death');
  }

  {
    const sigua = makeFighter('丝瓜uli@A');
    const bunny = makeFighter('兔卷卷@B');
    const { engine } = makeDeathEngine([sigua, bunny, makeFighter('摸鱼见证人@C')]);

    const selectedSkill = engine.selectSkill(engine.fighters[0]);

    assert(selectedSkill === 'slacking', `Slacking bond hook should select slacking, got ${selectedSkill}`);
    cases.push('Slacking bond skill-selection hook');
  }

  {
    const morphling = makeFighter('水人@A');
    const { engine, logs } = makeDeathEngine([morphling, makeFighter('变身旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);

    assert(engine.fighters[0].job === 'GOD_SLIME', `Morphling hook should transform to GOD_SLIME, got ${engine.fighters[0].job}`);
    assert(engine.fighters[0].statuses.some((status) => status.identityId === 'LIQUID_BODY'), 'Morphling hook should apply LIQUID_BODY');
    assert(logs.some((entry) => entry.text.includes('显露出')), 'Morphling hook should keep the original transform log');
    cases.push('Morphling transform hook');
  }

  {
    const morphling = makeFighter('水人@A');
    const target = makeFighter('镜花水月测试靶@B');
    applyTestStatus(morphling, { identityId: 'AIM', charges: 1 });
    const { engine } = makeDeathEngine([morphling, target]);

    engine.executeSkillAction('liquid_mirage', engine.fighters[0], engine.fighters[1]);

    assert(engine.fighters[0].statuses.some((status) => status.identityId === 'INVUL' && status.attribution.effectSourceId === 'morphling_liquid_mirage'), 'Liquid Mirage should grant its liquid invulnerability to Morphling');
    assert(!engine.fighters[1].statuses.some((status) => status.identityId === 'INVUL'), 'Liquid Mirage must not grant invulnerability to its enemy target');
    cases.push('attack self-buff ownership keeps Liquid Mirage invulnerability on Morphling');
  }

  {
    const morphling = makeFighter('水人@A');
    const joker = makeFighter('屑@B');
    const redirectVictim = makeFighter('镜花水月转移受害者@A');
    const { engine, logs } = makeDeathEngine([morphling, joker, redirectVictim]);
    const godOfTrolls = localProject.jobs.GOD_OF_TROLLS;
    assert(godOfTrolls, 'GOD_OF_TROLLS job should exist for Liquid Mirage redirect tests');
    const engineMorphling = engine.fighters[0];
    const engineJoker = engine.fighters[1];
    engineMorphling.maxHp = 10000;
    localProject.setCurrentHp(engineMorphling, 10000);
    engineMorphling.agl = 10000;
    applyTestStatus(engineMorphling, { identityId: 'AIM', charges: 1 });
    engineJoker.job = 'GOD_OF_TROLLS';
    engineJoker.jobData = { ...godOfTrolls, skills: [...(godOfTrolls.skills ?? [])] };
    engineJoker.transformed = true;

    withRandomSequence([0.5, 0.99, 0, 0], () => {
      engine.executeSkillAction('liquid_mirage', engineMorphling, engineJoker);
    });

    assert(logs.some((entry) => entry.text.includes('【随机恶作剧】')), 'Liquid Mirage redirect fixture must actually trigger Joker transfer');
    assert(engineMorphling.statuses.some((status) => status.identityId === 'INVUL' && status.attribution.effectSourceId === 'morphling_liquid_mirage'), 'Liquid Mirage should still grant its caster liquid invulnerability after damage is redirected');
    assert(!engineJoker.statuses.some((status) => status.identityId === 'INVUL'), 'Redirected Liquid Mirage must not grant invulnerability to its original target');
    assert(!engine.fighters[2].statuses.some((status) => status.identityId === 'INVUL'), 'Redirected Liquid Mirage must not move its caster-only invulnerability to the transfer victim');
    cases.push('Liquid Mirage keeps its caster self-buff after damage redirection');
  }

  {
    const sigua = makeFighter('丝瓜uli@A');
    const target = makeFighter('瞬风测试靶@B');
    applyTestStatus(sigua, { identityId: 'AIM', charges: 1 });
    const { engine } = makeDeathEngine([sigua, target]);
    engine.SKILLS.test_jett_tailwind = poolSkillByStatus('VALORANT_POOL', 'INVUL', '瞬风');

    engine.executeSkillAction('test_jett_tailwind', engine.fighters[0], engine.fighters[1]);

    assert(engine.fighters[0].statuses.some((status) => status.identityId === 'INVUL' && status.attribution.effectSourceId === 'valorant_jett_tailwind'), 'Jett Tailwind should grant invulnerability to the Valorant user');
    assert(!engine.fighters[1].statuses.some((status) => status.identityId === 'INVUL'), 'Jett Tailwind must not protect the enemy it hits');
    cases.push('attack self-buff ownership keeps Jett Tailwind invulnerability on its user');
  }

  {
    const gamer = makeFighter('玄凝@A');
    const { engine } = makeDeathEngine([gamer, makeFighter('APM旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.65));

    withRandomSequence([0.99], () => {
      for (let i = 0; i < 5; i += 1) engine.selectSkill(engine.fighters[0]);
    });
    engine.handleTransformations(engine.fighters[0]);

    assert(engine.fighters[0].apm === 5, `Gamer should gain 1 APM per skill-selection turn, got ${engine.fighters[0].apm}`);
    assert(!engine.fighters[0].transformed, 'Gamer should not transform before the half-HP threshold');
    assert(engine.fighters[0].job === 'HIGH_END_GAMER', `Gamer should stay in phase one before half HP, got ${engine.fighters[0].job}`);
    cases.push('Gamer APM does not bypass half-HP transform rule');
  }

  {
    const gamer = makeFighter('玄凝@A');
    const target = makeFighter('闪现A测试靶@B');
    gamer.agl = 0;
    target.agl = 10000;
    const { engine, logs } = makeDeathEngine([gamer, target]);

    withRandomSequence([0.999, 0.5, 0.5], () => {
      engine.executeSkillAction('flash_lol', engine.fighters[0], engine.fighters[1]);
    });

    assert(logs.some((entry) => entry.text.includes('【闪现A】') && entry.text.includes('造成')), 'Flash A should be the guaranteed hit described by its skill text');
    assert(!engine.fighters[1].statuses.some((status) => status.identityId === 'AIM'), 'Flash A must not donate an AIM buff to its enemy');
    cases.push('Gamer Flash A is an immediate guaranteed hit without enemy AIM buff');
  }

  {
    const gamer = makeFighter('玄凝@A');
    const { engine, logs } = makeDeathEngine([gamer, makeFighter('变身旁观者@B')]);
    engine.fighters[0].apm = 10;
    applyTestStatus(engine.fighters[0], { identityId: 'POISON', remainingTurns: 3 });
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);

    assert(engine.fighters[0].transformed, 'Gamer hook should mark the fighter as transformed at half HP');
    assert(engine.fighters[0].job === 'ALL_PLATFORM_CHAMPION', `Gamer hook should transform to ALL_PLATFORM_CHAMPION, got ${engine.fighters[0].job}`);
    assert((engine.fighters[0].apm ?? 0) === 12, `Gamer transform should cap APM at 12, got ${engine.fighters[0].apm}`);
    assert(!engine.fighters[0].statuses.some((status) => status.identityId === 'POISON'), 'high-APM Gamer transform should cleanse common negative statuses');
    assert(engine.fighters[0].statuses.some((status) => status.identityId === 'BKB'), 'high-APM Gamer transform should apply BKB');
    assert(engine.fighters[0].statuses.some((status) => status.identityId === 'AIM'), 'high-APM Gamer transform should apply AIM');
    assert(engine.fighters[0].statuses.some((status) => status.identityId === 'GAMER_WORLD_STAGE'), 'high-APM Gamer transform should apply world-stage status');
    assert(logs.some((entry) => entry.text.includes('全平台制霸者')), 'Gamer hook should keep the transform log');
    cases.push('Gamer APM-based half-HP transform hook');
  }

  {
    const caster = makeFighter('水人@A');
    const primaryTarget = makeFighter('洪水主目标@B');
    const gamer = makeFighter('玄凝@C');
    const { engine, logs } = makeDeathEngine([caster, primaryTarget, gamer]);
    const engineGamer = engine.fighters[2];
    const championJob = localProject.jobs.ALL_PLATFORM_CHAMPION;
    assert(championJob, 'Gamer flood-order test requires ALL_PLATFORM_CHAMPION');
    engineGamer.job = 'ALL_PLATFORM_CHAMPION';
    engineGamer.jobData = JSON.parse(JSON.stringify(championJob)) as typeof championJob;
    engineGamer.transformed = true;
    engineGamer.maxHp = 1000;
    localProject.setCurrentHp(engineGamer, 100);
    engine.fighters[0].mag = 2000;
    engine.fighters[0].agl = 10000;
    applyTestStatus(engine.fighters[0], { identityId: 'AIM', charges: 1 });
    engine.fighters[1].maxHp = 100000;
    localProject.setCurrentHp(engine.fighters[1], 100000);

    engine.executeSkillAction('apocalyptic_flood', engine.fighters[0], engine.fighters[1]);

    const damageIndex = logs.findIndex((entry) => entry.text.includes('狂暴洪水吞噬了 玄凝'));
    const continueIndex = logs.findIndex((entry) => entry.text.includes('【CONTINUE?】玄凝'));
    assert(damageIndex >= 0 && continueIndex > damageIndex, 'Flood damage result must be logged before Gamer CONTINUE aftermath');
    cases.push('Gamer CONTINUE follows the lethal area-damage result');
  }

  {
    const rabbit = makeFighter('兔卷卷@A');
    const gamer = makeFighter('玄凝@B');
    const bystander = makeFighter('扩音旁观者@C');
    const { engine, logs } = makeDeathEngine([rabbit, gamer, bystander]);
    const engineGamer = engine.fighters[1];
    const championJob = localProject.jobs.ALL_PLATFORM_CHAMPION;
    assert(championJob, 'Gamer megaphone-order test requires ALL_PLATFORM_CHAMPION');
    engineGamer.job = 'ALL_PLATFORM_CHAMPION';
    engineGamer.jobData = JSON.parse(JSON.stringify(championJob)) as typeof championJob;
    engineGamer.transformed = true;
    engineGamer.maxHp = 1000;
    localProject.setCurrentHp(engineGamer, 100);
    engine.fighters[0].mag = 1000;
    applyTestStatus(engine.fighters[0], { identityId: 'AIM', charges: 1 });

    engine.executeSkillAction('v_rabbit_megaphone', engine.fighters[0], engine.fighters[1]);

    const damageIndex = logs.findIndex((entry) => entry.text.includes('刺耳魔音贯耳！玄凝 实际承受'));
    const continueIndex = logs.findIndex((entry) => entry.text.includes('【CONTINUE?】玄凝'));
    assert(damageIndex >= 0 && continueIndex > damageIndex, 'Megaphone damage result must be logged before Gamer CONTINUE aftermath');
    cases.push('Gamer CONTINUE follows lethal multi-target megaphone damage');
  }

  {
    const gamer = makeFighter('玄凝@A');
    const { engine } = makeDeathEngine([gamer, makeFighter('世界赛旁观者@B')]);
    engine.fighters[0].apm = 10;
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);

    const selectedSkill = withRandomSequence([0.1], () => engine.selectSkill(engine.fighters[0]));

    assert(selectedSkill === 'gamer_world_combo', `Gamer world-stage hook should select gamer_world_combo, got ${selectedSkill}`);
    cases.push('Gamer world-stage skill-selection hook');
  }

  {
    const gamer = makeFighter('玄凝');
    const { engine } = makeDeathEngine([gamer, makeFighter('残局敌人一'), makeFighter('残局敌人二')]);
    engine.fighters[0].apm = 3;
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.6));

    const selectedSkill = withRandomSequence([0.1], () => engine.selectSkill(engine.fighters[0]));

    assert(selectedSkill === 'gamer_clutch_ace', `Gamer solo clutch hook should select gamer_clutch_ace, got ${selectedSkill}`);
    cases.push('Gamer solo clutch skill-selection hook');
  }

  {
    const gamer = makeFighter('玄凝@A');
    const ally = makeFighter('残局队友@A');
    const enemy = makeFighter('残局敌人@B');
    const { engine, logs } = makeDeathEngine([gamer, ally, enemy]);
    const engineGamer = engine.fighters[0];
    engineGamer.apm = 12;
    localProject.setCurrentHp(engineGamer, Math.floor(engineGamer.maxHp * 0.4));
    engine.handleTransformations(engineGamer);
    engineGamer.apm = 12;

    engine.executeSkillAction('gamer_clutch_ace', engineGamer, engine.fighters[2]);

    assert(logs.some((entry) => /【(?:强化)?残局专注】/.test(entry.text)), 'Gamer clutch skill should use the team-fight label while an ally is alive');
    assert(!logs.some((entry) => /【(?:强化)?1vX残局】/.test(entry.text)), 'Gamer clutch skill must not claim 1vX while an ally is alive');
    cases.push('Gamer clutch log distinguishes team fights from true 1vX');
  }

  {
    const gamer = makeFighter('玄凝@A');
    const marked = makeFighter('玄凝已读输入目标@B');
    const other = makeFighter('玄凝随机干扰目标@C');
    const { engine } = makeDeathEngine([gamer, marked, other]);
    engine.fighters[0].job = 'ALL_PLATFORM_CHAMPION';
    engine.fighters[0].gamerMarkedTargetId = engine.fighters[1].id;

    const resolved = withRandomSequence([0.99], () =>
      engine.resolveTarget(engine.fighters[0], null, engine.getSelectableTargets(engine.fighters[0])),
    );

    assert(resolved?.target.id === engine.fighters[1].id, 'Gamer should execute the selected champion skill against the attacker whose inputs were marked');
    cases.push('Gamer marked-target skill selection and action targeting stay aligned');
  }

  {
    const numericResultPattern = /(?:造成(?:了)?|受到|损失|恢复(?:了)?)\s*\d+/;
    const checkedSkills = [
      'gamer_headshot_line',
      'gamer_estus_cancel',
      'gamer_tactical_pause',
      'gamer_wombo_combo',
      'gamer_qte_execute',
      'gamer_read_inputs',
      'gamer_clutch_ace',
      'gamer_world_combo',
    ];

    checkedSkills.forEach((skillId) => {
      const gamer = makeFighter('玄凝@A');
      const targetA = makeFighter(`玄凝日志靶A-${skillId}@B`);
      const targetB = makeFighter(`玄凝日志靶B-${skillId}@B`);
      const targetC = makeFighter(`玄凝日志靶C-${skillId}@B`);
      const { engine, logs } = makeDeathEngine([gamer, targetA, targetB, targetC]);
      engine.fighters.slice(1).forEach((target) => {
        target.maxHp = 100000;
        localProject.setCurrentHp(target, 100000);
        target.agl = 0;
      });
      engine.fighters[0].apm = 12;
      localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
      engine.handleTransformations(engine.fighters[0]);
      engine.fighters[0].apm = 12;
      engine.fighters[0].critRate = 0;
      engine.fighters[0].agl = 10000;
      applyTestStatus(engine.fighters[0], { identityId: 'AIM', charges: 2 });
      if (skillId === 'gamer_world_combo') {
        applyTestStatus(engine.fighters[0], { identityId: 'GAMER_WORLD_STAGE', remainingTurns: 4 });
      }
      if (skillId === 'gamer_estus_cancel' || skillId === 'gamer_clutch_ace') {
        localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.45));
        applyTestStatus(engine.fighters[0], { identityId: 'POISON', remainingTurns: 2 });
      }

      const start = logs.length;
      engine.executeSkillAction(skillId, engine.fighters[0], engine.fighters[1]);
      const skillLogs = logs.slice(start).map((entry) => entry.text);
      assert(skillLogs.some((text) => numericResultPattern.test(text)), `Gamer skill ${skillId} should log a numeric damage or healing result`);
    });
    cases.push('Gamer combat logs include numeric results');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const { engine, logs } = makeDeathEngine([gacha, makeFighter('变身旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);

    assert(engine.fighters[0].job === 'LUCK_EMPEROR', `Gacha hook should transform to LUCK_EMPEROR, got ${engine.fighters[0].job}`);
    assert(engine.fighters[0].wis === 120, 'Gacha hook should set luck emperor wisdom');
    assert((engine.fighters[0].gachaLuck ?? 0) === 2, 'Gacha hook should initialize luck emperor starter pity');
    assert(!engine.fighters[0].hasUsedGachaDeathSave, 'Gacha hook should reset death-save state');
    assert(logs.some((entry) => entry.text.includes('觉醒欧皇血统')), 'Gacha hook should keep the original transform log');
    cases.push('Gacha transform hook');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const target = makeFighter('抽卡靶子@B');
    const { engine, logs } = makeDeathEngine([gacha, target]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    engine.fighters[1].maxHp = 100000;
    localProject.setCurrentHp(engine.fighters[1], 100000);

    engine.executeSkillAction('gacha_pull', engine.fighters[0], engine.fighters[1]);

    assert((engine.fighters[0].gachaLuck ?? 0) >= 1, 'Luck Emperor should gain pity from a low-value normal draw');
    assert(logs.some((entry) => entry.text.includes('抽到低收益牌')), 'Luck Emperor normal draw should log pity gain');
    cases.push('Gacha low-value draw grants pity');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const target = makeFighter('灰流丽靶子@B');
    const { engine, logs } = makeDeathEngine([gacha, target]);
    engine.SKILLS.gacha_ash_blossom_regression = {
      name: '灰流丽',
      ...GACHA_ASH_BLOSSOM_CARD,
      tag: GACHA_ASH_BLOSSOM_CARD.tag ?? 'debuff',
    };

    engine.executeSkillAction('gacha_ash_blossom_regression', engine.fighters[0], engine.fighters[1]);

    const activationIndex = logs.findIndex((entry) => entry.text.includes('【灰流丽】') && entry.text.includes('试图无效'));
    const applicationIndex = logs.findIndex((entry) => entry.text.includes('【状态施加】') && entry.text.includes('【眩晕】'));
    const resultIndex = logs.findIndex((entry) => entry.text.includes('【灰流丽结算】'));
    assert(activationIndex >= 0 && applicationIndex > activationIndex && resultIndex > applicationIndex, 'Ash Blossom must log activation, status application, then its result in causal order');
    cases.push('Ash Blossom logs its cause before stun application');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const ting = makeFighter('小汀@B');
    const { engine, logs } = makeDeathEngine([gacha, ting]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    engine.applyDamage(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.25), 'skill', true, engine.fighters[1]);

    assert((engine.fighters[0].gachaLuck ?? 0) >= 2, `Luck Emperor should gain pity from heavy Ting pressure, got ${engine.fighters[0].gachaLuck ?? 0}`);
    assert(logs.some((entry) => entry.text.includes('承受重创')), 'Luck Emperor should log heavy-hit pity');
    assert(logs.some((entry) => entry.text.includes('被小汀针对')), 'Luck Emperor should log Ting-targeted pity');
    cases.push('Gacha heavy Ting pressure grants pity');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const target = makeFighter('欧气插队靶子@B');
    const { engine, logs } = makeDeathEngine([gacha, target]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    engine.fighters[0].gachaLuck = 4;
    engine.fighters[1].maxHp = 100000;
    localProject.setCurrentHp(engine.fighters[1], 100000);

    engine.applyDamage(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.25), 'skill', true, engine.fighters[1], { actionName: '欧气插队测试' });
    assert(engine.fighters[0].gachaInstantActionQueued, 'Luck Emperor should queue an instant action when luck reaches max');

    engine.finishStep({ current: false });

    const burstIndex = logs.findIndex((entry) => entry.text.includes('【欧气爆发】'));
    const pityIndex = logs.findIndex((entry) => entry.text.includes('大保底启动'));
    assert(burstIndex >= 0, 'Luck Emperor max luck should immediately trigger an extra action');
    assert(pityIndex > burstIndex, 'Instant luck action should immediately spend max luck through major pity');
    assert(!engine.fighters[0].gachaInstantActionQueued, 'Luck Emperor instant action queue should clear after firing');
    cases.push('Gacha max luck queues an immediate destiny action');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const attacker = makeFighter('欧皇护符测试者@B');
    const { engine, logs } = makeDeathEngine([gacha, attacker]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    applyTestStatus(engine.fighters[0], { identityId: 'POISON', remainingTurns: 3 });
    engine.applyDamage(engine.fighters[0], engine.fighters[0].maxHp * 3, 'skill', true, engine.fighters[1]);

    assert(engine.fighters[0].currentHp > 0, 'Luck Emperor death save should keep Croc alive');
    assert(engine.fighters[0].hasUsedGachaDeathSave, 'Luck Emperor death save should be marked as used');
    assert((engine.fighters[0].gachaLuck ?? 0) >= 3, 'Luck Emperor death save should grant pity');
    assert(!engine.fighters[0].statuses.some((status) => status.identityId === 'POISON'), 'Luck Emperor death save should cleanse common negative statuses');
    assert(logs.some((entry) => entry.text.includes('欧皇护符')), 'Luck Emperor death save should log the charm trigger');
    cases.push('Gacha death save prevents one lethal hit');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const observer = makeFighter('欧皇收尾旁观者@B');
    forceLuckEmperor(gacha);
    const { engine } = makeDeathEngine([gacha, observer]);
    localProject.setCurrentHp(engine.fighters[0], 0);
    engine.finalizeFighterDeath(engine.fighters[0], { current: false });

    assert(engine.fighters[0].currentHp > 0, 'Death finalization must preserve the Luck Emperor charm recovery');
    assert(!engine.fighters[0].isDead && !engine.fighters[0].isDeadAnnounced, 'A charm-saved fighter must remain active after death finalization');
    cases.push('Gacha death save survives fallback death finalization');
  }

  {
    const gamer = makeFighter('玄凝@A');
    const observer = makeFighter('续关收尾旁观者@B');
    const { engine } = makeDeathEngine([gamer, observer]);
    localProject.setCurrentHp(engine.fighters[0], 1);
    engine.handleTransformations(engine.fighters[0]);
    localProject.setCurrentHp(engine.fighters[0], 0);
    engine.finalizeFighterDeath(engine.fighters[0], { current: false });

    assert(engine.fighters[0].currentHp > 0, 'Death finalization must preserve Gamer CONTINUE recovery');
    assert(!engine.fighters[0].isDead && !engine.fighters[0].isDeadAnnounced, 'A continued Gamer must remain active after death finalization');
    cases.push('Gamer continue survives fallback death finalization');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const gamer = makeFighter('玄凝@B');
    const { engine } = makeDeathEngine([gacha, gamer]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    engine.fighters[1].mag = 10000;
    applyTestStatus(engine.fighters[1], { identityId: 'AIM', charges: 1 });

    engine.executeSkillAction('teemo_shroom', engine.fighters[1], engine.fighters[0]);

    assert(engine.fighters[0].hasUsedGachaDeathSave, 'Lethal poison skill should trigger the Luck Emperor death save');
    assert(!engine.fighters[0].statuses.some((status) => status.identityId === 'POISON'), 'Luck Emperor cleansing death save must suppress poison from the same lethal hit');
    cases.push('Gacha cleansing death-save suppresses lethal hit poison');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const exodia = makeFighter('黑暗大法师测试体@B');
    const { engine, logs } = makeDeathEngine([gacha, exodia]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    engine.fighters[1].mag = 10000;
    applyTestStatus(engine.fighters[1], { identityId: 'AIM', charges: 1 });
    const atkBefore = engine.fighters[0].atk;

    engine.executeSkillAction('exodia_seal_chains', engine.fighters[1], engine.fighters[0]);

    assert(engine.fighters[0].hasUsedGachaDeathSave && engine.fighters[0].currentHp > 0, 'Seal Chains should trigger and respect the Luck Emperor death save');
    assert(engine.fighters[0].atk === atkBefore, 'A cleansing death-save must suppress direct post-hit stat reduction from the lethal skill');
    assert(!logs.some((entry) => entry.text.includes('【封印锁链】牢鳄 的面板')), 'Suppressed direct stat reduction must not emit a false success log');
    cases.push('cleansing death-save suppresses direct post-hit stat reductions');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const wt = makeFighter('M1A2_abrams_sep@B');
    const { engine, logs } = makeDeathEngine([gacha, wt]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    localProject.setCurrentHp(engine.fighters[1], Math.floor(engine.fighters[1].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[1]);
    engine.fighters[1].atk = 10000;
    applyTestStatus(engine.fighters[1], { identityId: 'AIM', charges: 1 });

    withRandomSequence([0.5, 0], () => {
      engine.executeSkillAction('wt_t58_knockup', engine.fighters[1], engine.fighters[0]);
    });

    assert(engine.fighters[0].hasUsedGachaDeathSave && engine.fighters[0].currentHp > 0, 'T-58 lethal hit should trigger and respect the Luck Emperor death save');
    assert(!engine.fighters[0].statuses.some((status) => ['AIRBORNE', 'WT_AMMO_EXPOSED'].includes(status.identityId)), 'T-58 must not reapply airborne or ammo exposure after a cleansing death-save');
    assert(!logs.some((entry) => entry.text.includes('弹药架殉爆')), 'T-58 must not immediately execute a target that just consumed a cleansing death-save');
    cases.push('cleansing death-save suppresses War Thunder module and execution follow-ups');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const target = makeFighter('大保底召唤靶子@B');
    const { engine, logs } = makeDeathEngine([gacha, target]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    engine.fighters[0].gachaLuck = 5;
    engine.fighters[1].maxHp = 100000;
    localProject.setCurrentHp(engine.fighters[1], 100000);

    withRandomSequence([0, 0], () => {
      engine.executeSkillAction('destiny_draw', engine.fighters[0], engine.fighters[1]);
    });

    assert((engine.fighters[0].gachaLuck ?? 0) <= 1, `Luck Emperor major pity should consume stored luck, got ${engine.fighters[0].gachaLuck ?? 0}`);
    assert(logs.some((entry) => entry.text.includes('大保底启动')), 'Luck Emperor major pity should log activation');
    assert(logs.some((entry) => entry.text.includes('召唤成功')), 'Luck Emperor major pity should be able to force a summon when not in lethal danger');
    cases.push('Gacha major pity can force a summon');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const target = makeFighter('大保底救命靶子@B');
    const { engine, logs } = makeDeathEngine([gacha, target]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.35));
    engine.fighters[0].gachaLuck = 5;

    withRandomSequence([0], () => {
      engine.executeSkillAction('destiny_draw', engine.fighters[0], engine.fighters[1]);
    });

    assert(logs.some((entry) => entry.text.includes('大保底启动')), 'Luck Emperor low-health major pity should log activation');
    assert(logs.some((entry) => entry.text.includes('氪金改命')), 'Luck Emperor low-health major pity should still prioritize the death-swing recovery card');
    cases.push('Gacha major pity protects lethal-range Croc');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const summon = makeFighter('吸血召唤物@A');
    const target = makeFighter('吸血靶子@B');
    const { engine, logs } = makeDeathEngine([gacha, summon, target]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    engine.fighters[1].isSummon = true;
    engine.fighters[1].summonerId = engine.fighters[0].id;
    applyTestStatus(engine.fighters[0], { identityId: 'GACHA_SUMMON_LIFESTEAL', remainingTurns: 4 });
    engine.fighters[0].gachaSummonLifestealPct = 0.35;
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.5));
    const beforeHeal = engine.fighters[0].currentHp;

    engine.applyDamage(engine.fighters[2], 1000, 'skill', false, engine.fighters[1]);

    assert(engine.fighters[0].currentHp > beforeHeal, 'Summon lifesteal card should heal the Luck Emperor from summon damage');
    assert(logs.some((entry) => entry.text.includes('吸血牌回流')), 'Summon lifesteal card should log healing from summon damage');
    cases.push('Gacha summon lifesteal heals from summon damage');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const summon = makeFighter('吸血边界召唤物@A');
    const enemy = makeFighter('吸血边界敌人@B');
    const { engine, logs } = makeDeathEngine([gacha, summon, enemy]);
    forceLuckEmperor(engine.fighters[0]);
    bindAsGachaSummon(engine.fighters[0], engine.fighters[1], '翼神龙', true);
    applyTestStatus(engine.fighters[0], { identityId: 'GACHA_SUMMON_LIFESTEAL', remainingTurns: 4 });
    engine.fighters[0].gachaSummonLifestealPct = 0.3;
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    const hpBefore = engine.fighters[0].currentHp;

    engine.applyDamage(engine.fighters[1], 100, 'self_cost', true, engine.fighters[1], {
      sourceKind: 'self_cost',
      creditAttacker: false,
      bypassShields: true,
    });
    engine.applyDamage(engine.fighters[2], 100, 'status', true, engine.fighters[1], {
      sourceKind: 'status',
    });
    engine.applyDamage(engine.fighters[0], 100, 'momo_share', true, engine.fighters[1], {
      sourceKind: 'share',
      originSourceKind: 'custom',
    });

    assert(engine.fighters[0].currentHp === hpBefore - 100, 'Self-cost, status damage, and friendly redistribution must not trigger summon lifesteal');
    assert(!logs.some((entry) => entry.text.includes('吸血牌回流')), 'Rejected summon lifesteal branches must not emit healing logs');

    const beforeEnemyHit = engine.fighters[0].currentHp;
    engine.applyDamage(engine.fighters[2], 100, 'skill', true, engine.fighters[1], {
      sourceKind: 'transfer',
      originSourceKind: 'custom',
    });
    assert(engine.fighters[0].currentHp > beforeEnemyHit, 'A redirected direct hit that lands on an enemy should still trigger summon lifesteal');
    cases.push('Gacha summon lifesteal only converts legitimate outward enemy damage');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const blueEyes = makeFighter('青眼白龙吸血日志@A');
    const target = makeFighter('吸血日志靶子@B');
    const { engine, logs } = makeDeathEngine([gacha, blueEyes, target]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    bindAsGachaSummon(engine.fighters[0], engine.fighters[1], '青眼白龙', true);
    engine.fighters[1].job = 'BLUE_EYES_WHITE_DRAGON';
    engine.fighters[1].mag = 1000;
    engine.fighters[1].agl = 10000;
    engine.fighters[1].critRate = 0;
    engine.fighters[2].maxHp = 100000;
    engine.fighters[2].agl = 0;
    localProject.setCurrentHp(engine.fighters[2], 100000);
    applyTestStatus(engine.fighters[0], { identityId: 'GACHA_SUMMON_LIFESTEAL', remainingTurns: 4 });
    engine.fighters[0].gachaSummonLifestealPct = 0.35;
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.5));

    withRandomSequence([0.5, 0.5, 0.99], () => {
      engine.executeSkillAction('blue_eyes_burst_stream', engine.fighters[1], engine.fighters[2]);
    });

    const hitIndex = logs.findIndex((entry) => entry.text.includes('毁灭爆裂疾风弹') && entry.text.includes('吸血日志靶子'));
    const lifestealIndex = logs.findIndex((entry) => entry.text.includes('吸血牌回流'));
    assert(hitIndex >= 0 && lifestealIndex >= 0, 'Summon lifesteal order test should produce hit and lifesteal logs');
    assert(hitIndex < lifestealIndex, 'Summon lifesteal should be logged after the damage result');
    cases.push('Gacha summon lifesteal log follows damage result');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const blueEyes = makeFighter('青眼白龙支援牌@A');
    const target = makeFighter('支援牌死亡靶子@B');
    const { engine, logs } = makeDeathEngine([gacha, blueEyes, target]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    bindAsGachaSummon(engine.fighters[0], engine.fighters[1], '青眼白龙', true);
    engine.fighters[1].mag = 1000;
    engine.fighters[1].atk = 1000;
    engine.fighters[2].maxHp = 200;
    localProject.setCurrentHp(engine.fighters[2], 200);
    const supportCard = engine.Data.GACHA_SSR_POOL.find((entry) => entry.text.includes('毁灭爆裂疾风弹'));
    assert(supportCard, 'Gacha SSR pool should include Blue-Eyes support card');
    engine.SKILLS.__test_blue_eyes_support = { name: '测试毁灭爆裂疾风弹', tag: 'special' as const, ...supportCard };

    engine.executeSkillAction('__test_blue_eyes_support', engine.fighters[0], engine.fighters[2]);

    const cardIndex = logs.findIndex((entry) => entry.text.includes('翻开支援牌') && entry.text.includes('支援牌死亡靶子'));
    const damageIndex = logs.findIndex((entry) => entry.text.includes('白龙龙息贯穿 支援牌死亡靶子') && entry.text.includes('实际造成'));
    const deathIndex = logs.findIndex((entry) => entry.text.includes('【毁灭爆裂疾风弹】支援牌死亡靶子 被 青眼白龙支援牌 击败'));
    assert(cardIndex >= 0 && damageIndex >= 0 && deathIndex >= 0, 'Blue-Eyes support order test should produce card, damage and death logs');
    assert(cardIndex < damageIndex && damageIndex < deathIndex, 'Blue-Eyes support card should log actual damage before death');
    cases.push('Gacha support damage log precedes death');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const targetA = makeFighter('黑暗大法师靶A@B');
    const targetB = makeFighter('黑暗大法师靶B@B');
    const { engine, logs } = makeDeathEngine([gacha, targetA, targetB]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    const exodiaCard = { name: '黑暗大法师召唤', tag: 'special' as const, ...engine.Data.EXODIA_CARD };
    engine.executeSummonSkill(exodiaCard, engine.fighters[0], engine.getTeamId(engine.fighters[0]));
    const exodia = engine.fighters.find((fighter) => fighter.name === '黑暗大法师');
    assert(exodia, 'Exodia card should summon 黑暗大法师');
    assert(exodia.job === 'EXODIA_INCARNATE', `Exodia should use EXODIA_INCARNATE job, got ${exodia.job}`);
    assert(exodia.jobData.skills.includes('exodia_obliterate'), 'Exodia should have its dedicated ultimate skill');

    engine.fighters.filter((fighter) => fighter.name.startsWith('黑暗大法师靶')).forEach((target) => {
      target.maxHp = 100000;
      localProject.setCurrentHp(target, 100000);
      target.agl = 0;
    });
    engine.executeSkillAction('exodia_obliterate', exodia, engine.fighters[1]);

    assert(exodia.hasUsedExodiaObliterate, 'Exodia ultimate should be marked as used after firing');
    assert(logs.some((entry) => entry.text.includes('Exodia Obliterate')), 'Exodia ultimate should produce a named combat log');
    assert(logs.some((entry) => /造成 \d+ 点真实伤害/.test(entry.text)), 'Exodia ultimate should log numeric damage');
    cases.push('Exodia summon has dedicated skills');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const target = makeFighter('封印组件靶子@B');
    const { engine, logs } = makeDeathEngine([gacha, target]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    engine.fighters[1].maxHp = 100000;
    localProject.setCurrentHp(engine.fighters[1], 100000);

    for (let i = 0; i < 4; i += 1) {
      withRandomSequence([0, 0], () => {
        engine.executeSkillAction('destiny_draw', engine.fighters[0], engine.fighters[1]);
      });
    }

    assert((engine.fighters[0].exodiaPieces ?? []).length === 4, `Exodia should hold four unique pieces before final draw, got ${(engine.fighters[0].exodiaPieces ?? []).length}`);
    assert(new Set(engine.fighters[0].exodiaPieces ?? []).size === 4, 'Exodia pieces should not repeat before completion');
    assert(!engine.fighters.some((fighter) => fighter.summonBaseName === '黑暗大法师' && !fighter.isDeadAnnounced), 'Exodia should not summon before all five pieces are collected');

    withRandomSequence([0, 0], () => {
      engine.executeSkillAction('destiny_draw', engine.fighters[0], engine.fighters[1]);
    });

    const exodia = engine.fighters.find((fighter) => fighter.summonBaseName === '黑暗大法师');
    assert((engine.fighters[0].exodiaPieces ?? []).length === 5, `Exodia should hold five pieces after final draw, got ${(engine.fighters[0].exodiaPieces ?? []).length}`);
    assert(new Set(engine.fighters[0].exodiaPieces ?? []).size === 5, 'Final Exodia piece should still be non-duplicate');
    assert(exodia && exodia.job === 'EXODIA_INCARNATE', 'Collecting five Exodia pieces should summon 黑暗大法师');
    assert(exodia?.isAdvancedSummon, 'Exodia should be marked as an advanced summon');
    assert(logs.some((entry) => entry.text.includes('不会重复')), 'Exodia piece draw should state the non-duplicate rule');
    cases.push('Gacha Exodia pieces gate a non-duplicate advanced summon');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const tributeA = makeFighter('白龙祭品A@A');
    const tributeB = makeFighter('白龙祭品B@A');
    const targetA = makeFighter('白龙靶A@B');
    const targetB = makeFighter('白龙靶B@B');
    const { engine, logs } = makeDeathEngine([gacha, tributeA, tributeB, targetA, targetB]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    engine.fighters[1].isSummon = true;
    engine.fighters[1].summonerId = engine.fighters[0].id;
    engine.fighters[2].isSummon = true;
    engine.fighters[2].summonerId = engine.fighters[0].id;
    const blueEyesCard = engine.Data.GACHA_SSR_POOL.find((entry) => entry.summonName === '青眼白龙');
    assert(blueEyesCard, 'Gacha SSR pool should include Blue-Eyes White Dragon');

    const blueEyesSkill = { name: '青眼白龙召唤', tag: 'special' as const, ...blueEyesCard };
    engine.executeSummonSkill(blueEyesSkill, engine.fighters[0], engine.getTeamId(engine.fighters[0]));
    const blueEyes = engine.fighters.find((fighter) => fighter.name === '青眼白龙');
    assert(blueEyes, 'Blue-Eyes card should summon 青眼白龙');
    assert(blueEyes.job === 'BLUE_EYES_WHITE_DRAGON', `Blue-Eyes should use BLUE_EYES_WHITE_DRAGON job, got ${blueEyes.job}`);
    assert(blueEyes.jobData.skills.includes('blue_eyes_burst_stream'), 'Blue-Eyes should have a dedicated burst skill');
    blueEyes.agl = 0;
    blueEyes.critRate = 0;
    applyTestStatus(blueEyes, { identityId: 'AIM', charges: 1 });

    engine.fighters.filter((fighter) => fighter.name.startsWith('白龙靶')).forEach((target) => {
      target.maxHp = 100000;
      localProject.setCurrentHp(target, 100000);
      target.agl = 0;
    });
    withRandomSequence([0.5, 0.99], () => {
      engine.executeSkillAction('blue_eyes_sweeping_breath', blueEyes, engine.fighters[3]);
    });

    assert(logs.some((entry) => entry.text.includes('白龙扫射')), 'Blue-Eyes sweeping breath should produce a named combat log');
    assert(logs.some((entry) => /造成 \d+ 点溅射伤害/.test(entry.text)), 'Blue-Eyes sweeping breath should log numeric splash damage');
    cases.push('Blue-Eyes summon has dedicated skills');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const advancedMaterial = makeFighter('高级祭品测试-黑暗大法师@A');
    const ordinaryMaterial = makeFighter('高级祭品测试-普通召唤物@A');
    const target = makeFighter('高级祭品测试靶子@B');
    const { engine, logs } = makeDeathEngine([gacha, advancedMaterial, ordinaryMaterial, target]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    bindAsGachaSummon(engine.fighters[0], engine.fighters[1], '黑暗大法师', true);
    bindAsGachaSummon(engine.fighters[0], engine.fighters[2], '钟离');
    const blueEyesCard = engine.Data.GACHA_SSR_POOL.find((entry) => entry.summonName === '青眼白龙');
    assert(blueEyesCard, 'Gacha SSR pool should include Blue-Eyes White Dragon');

    engine.executeSummonSkill({ name: '青眼白龙高级祭品测试', tag: 'special' as const, ...blueEyesCard }, engine.fighters[0], engine.getTeamId(engine.fighters[0]));

    assert(!engine.fighters.some((fighter) => fighter.summonBaseName === '青眼白龙'), 'Blue-Eyes should not summon with one ordinary plus one advanced summon');
    assert(!engine.fighters[1].isDead && !engine.fighters[1].isDeadAnnounced, 'Advanced summons should not be consumed as tribute');
    assert(!engine.fighters[2].isDead && !engine.fighters[2].isDeadAnnounced, 'Ordinary summon should remain when tribute payment fails');
    assert(logs.some((entry) => entry.text.includes('祭品不足')), 'Failed advanced tribute payment should log insufficient tribute');
    cases.push('Gacha advanced summons cannot pay ordinary tribute costs');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const blueEyes = makeFighter('青眼白龙素材@A');
    const ordinaryA = makeFighter('融合普通素材A@A');
    const ordinaryB = makeFighter('融合普通素材B@A');
    const ra = makeFighter('翼神龙保护素材@A');
    const allySummon = makeFighter('队友普通素材@A');
    const target = makeFighter('融合靶子@B');
    const { engine, logs } = makeDeathEngine([gacha, blueEyes, ordinaryA, ordinaryB, ra, allySummon, target]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    bindAsGachaSummon(engine.fighters[0], engine.fighters[1], '青眼白龙', true);
    bindAsGachaSummon(engine.fighters[0], engine.fighters[2], '钟离');
    bindAsGachaSummon(engine.fighters[0], engine.fighters[3], 'Saber');
    bindAsGachaSummon(engine.fighters[0], engine.fighters[4], '翼神龙', true);
    engine.fighters[5].isSummon = true;
    engine.fighters[5].summonerId = 'ally-summoner-id';
    engine.fighters[5].summonBaseName = '萨姆';
    const ultimateCard = engine.Data.GACHA_SSR_POOL.find((entry) => entry.summonName === '青眼究极龙');
    assert(ultimateCard, 'Gacha SSR pool should include Blue-Eyes Ultimate Dragon');

    engine.executeSummonSkill({ name: '青眼究极龙融合测试', tag: 'special' as const, ...ultimateCard }, engine.fighters[0], engine.getTeamId(engine.fighters[0]));

    const ultimate = engine.fighters.find((fighter) => fighter.summonBaseName === '青眼究极龙');
    assert(ultimate && ultimate.job === 'BLUE_EYES_ULTIMATE_DRAGON', 'Blue-Eyes fusion should summon 青眼究极龙');
    assert(engine.fighters[1].isDead && engine.fighters[2].isDead && engine.fighters[3].isDead, 'Fusion should consume Blue-Eyes and exactly two own ordinary summons');
    assert(!engine.fighters[4].isDead && !engine.fighters[4].isDeadAnnounced, 'Fusion should not consume Ra as material');
    assert(!engine.fighters[5].isDead && !engine.fighters[5].isDeadAnnounced, 'Fusion should not consume teammate summons as material');
    assert(ultimate.isAdvancedSummon, 'Blue-Eyes Ultimate should be marked as an advanced summon');
    assert(logs.some((entry) => entry.text.includes('融合')), 'Blue-Eyes fusion should log its materials');
    cases.push('Gacha Blue-Eyes Ultimate fusion consumes only valid own materials');
  }

  {
    const ultimate = makeFighter('青眼究极龙日志测试@A');
    const target = makeFighter('三重龙首法球靶@B');
    const { engine, logs } = makeDeathEngine([ultimate, target]);
    const engineUltimate = engine.fighters[0];
    const engineTarget = engine.fighters[1];
    engineUltimate.atk = 120;
    engineUltimate.mag = 120;
    engineUltimate.agl = 10000;
    engineUltimate.critRate = 0;
    engineTarget.agl = 0;
    engineTarget.maxHp = 10000;
    localProject.setCurrentHp(engineTarget, 5000);
    applyTestStatus(engineTarget, { identityId: 'SPELL_BLOCK', charges: 2 });

    engine.executeSkillAction('triple_dragon_head', engineUltimate, engineTarget);

    assert(logs.some((entry) => entry.text.includes('第 1 颗龙首撞上') && entry.text.includes('防护，被完全拦截')), 'Triple Dragon Head should log which head consumed spell block');
    assert(!logs.some((entry) => entry.text.includes('林肯法球(或特种装甲)') && entry.text.includes('三重龙首')), 'Triple Dragon Head should not emit a generic block line after a hit line');
    assert(logs.some((entry) => entry.text.includes('第 2 颗龙首命中') || entry.text.includes('第 3 颗龙首命中')), 'Triple Dragon Head should continue after one blocked head');
    cases.push('Blue-Eyes Ultimate triple head logs spell block per head');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const ultimate = makeFighter('青眼究极龙#2@A');
    const target = makeFighter('究极龙击杀靶子@B');
    const { engine, logs } = makeDeathEngine([gacha, ultimate, target]);
    bindAsGachaSummon(engine.fighters[0], engine.fighters[1], '青眼究极龙', true);
    const ultimateJob = localProject.jobs.BLUE_EYES_ULTIMATE_DRAGON;
    assert(ultimateJob, 'Blue-Eyes Ultimate job should exist for log tests');
    engine.fighters[1].job = 'BLUE_EYES_ULTIMATE_DRAGON';
    engine.fighters[1].jobData = { ...ultimateJob, skills: [...(ultimateJob.skills ?? [])] };
    engine.fighters[1].atk = 1000;
    engine.fighters[1].mag = 1000;
    engine.fighters[1].agl = 10000;
    engine.fighters[1].critRate = 0;
    engine.fighters[2].maxHp = 100;
    engine.fighters[2].agl = 0;
    localProject.setCurrentHp(engine.fighters[2], 100);

    withRandomSequence([0.5, 0.5, 0.99], () => {
      engine.executeSkillAction('triple_dragon_head', engine.fighters[1], engine.fighters[2]);
    });

    assert(logs.some((entry) => entry.text.includes('究极龙击杀靶子 被 青眼究极龙#2 撕碎')), 'Blue-Eyes Ultimate death log should keep the concrete summon name');
    cases.push('Blue-Eyes Ultimate death log keeps summon instance name');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const ultimate = makeFighter('青眼究极龙转移测试@A');
    const joker = makeFighter('屑@B');
    const { engine, logs } = makeDeathEngine([gacha, ultimate, joker]);
    bindAsGachaSummon(engine.fighters[0], engine.fighters[1], '青眼究极龙', true);
    const ultimateJob = localProject.jobs.BLUE_EYES_ULTIMATE_DRAGON;
    const godOfTrolls = localProject.jobs.GOD_OF_TROLLS;
    assert(ultimateJob, 'Blue-Eyes Ultimate job should exist for redirect log tests');
    assert(godOfTrolls, 'GOD_OF_TROLLS job should exist for dragon head redirect log tests');
    engine.fighters[1].job = 'BLUE_EYES_ULTIMATE_DRAGON';
    engine.fighters[1].jobData = { ...ultimateJob, skills: [...(ultimateJob.skills ?? [])] };
    engine.fighters[1].atk = 100;
    engine.fighters[1].mag = 100;
    engine.fighters[1].agl = 10000;
    engine.fighters[1].critRate = 0;
    engine.fighters[2].job = 'GOD_OF_TROLLS';
    engine.fighters[2].jobData = { ...godOfTrolls, skills: [...(godOfTrolls.skills ?? [])] };
    engine.fighters[2].maxHp = 10000;
    localProject.setCurrentHp(engine.fighters[2], 10000);

    withRandomSequence([0.99, 0, 0, 0.99], () => {
      engine.executeSkillAction('triple_dragon_head', engine.fighters[1], engine.fighters[2]);
    });

    assert(logs.some((entry) => entry.text.includes('第 2 颗龙首的攻击被 屑 用随机恶作剧转移')), 'Blue-Eyes Ultimate should explain which dragon head was redirected by Joker');
    assert(logs.some((entry) => entry.text.includes('第 1 颗龙首命中 屑')), 'Blue-Eyes Ultimate should still log non-redirected head 1');
    assert(logs.some((entry) => entry.text.includes('第 3 颗龙首命中 屑')), 'Blue-Eyes Ultimate should still log non-redirected head 3');
    cases.push('Blue-Eyes Ultimate labels redirected dragon head');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const tributeA = makeFighter('翼神龙入场祭品A@A');
    const tributeB = makeFighter('翼神龙入场祭品B@A');
    const tributeC = makeFighter('翼神龙入场祭品C@A');
    const target = makeFighter('翼神龙入场靶子@B');
    const { engine, logs } = makeDeathEngine([gacha, tributeA, tributeB, tributeC, target]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    bindAsGachaSummon(engine.fighters[0], engine.fighters[1], '钟离');
    bindAsGachaSummon(engine.fighters[0], engine.fighters[2], 'Saber');
    bindAsGachaSummon(engine.fighters[0], engine.fighters[3], '萨姆');
    const raCard = engine.Data.GACHA_SSR_POOL.find((entry) => entry.summonName === '翼神龙');
    assert(raCard, 'Gacha SSR pool should include Ra');

    engine.executeSummonSkill({ name: '翼神龙入场测试', tag: 'special' as const, ...raCard }, engine.fighters[0], engine.getTeamId(engine.fighters[0]));

    const ra = engine.fighters.find((fighter) => fighter.summonBaseName === '翼神龙');
    assert(ra, 'Ra summon card should summon 翼神龙');
    assert(ra.raChantBoost === 1, 'Ra should enter with one solar chant boost');
    assert(ra.statuses.some((status) => status.identityId === 'RA_PHOENIX'), 'Ra should enter with Phoenix revival armed');
    assert(ra.statuses.some((status) => status.identityId === 'SPELL_BLOCK'), 'Ra should enter with spell block');
    assert(ra.statuses.some((status) => status.identityId === 'BKB'), 'Ra should enter with short divine immunity');
    assert(ra.statuses.some((status) => status.identityId === 'REGEN'), 'Ra should enter with regeneration');
    assert(logs.some((entry) => entry.text.includes('太阳神降临')), 'Ra entrance should log its god-card setup');
    cases.push('Gacha Ra enters as an armed god card');
  }

  {
    const attacker = makeFighter('神不死鸟测试攻击者@B');
    const gacha = makeFighter('牢鳄@A');
    const ra = makeFighter('翼神龙测试体@A');
    const target = makeFighter('神不死鸟余波靶@B');
    const { engine, logs } = makeDeathEngine([attacker, gacha, ra, target]);
    localProject.setCurrentHp(engine.fighters[1], Math.floor(engine.fighters[1].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[1]);
    bindAsGachaSummon(engine.fighters[1], engine.fighters[2], '翼神龙', true);
    engine.fighters[2].maxHp = 3000;
    localProject.setCurrentHp(engine.fighters[2], 100);
    applyTestStatus(engine.fighters[2], { identityId: 'RA_PHOENIX', remainingTurns: 3 });
    engine.fighters[0].maxHp = 100000;
    localProject.setCurrentHp(engine.fighters[0], 100000);
    engine.fighters[3].maxHp = 100000;
    localProject.setCurrentHp(engine.fighters[3], 100000);
    applyTestStatus(engine.fighters[3], { identityId: 'INVUL', remainingTurns: 2 });

    engine.applyDamage(engine.fighters[2], 5000, 'skill', true, engine.fighters[0], { actionName: '神不死鸟测试' });

    assert(engine.fighters[2].currentHp > 0 && !engine.fighters[2].isDeadAnnounced, 'Ra Phoenix should keep Ra alive through one lethal hit');
    assert(engine.fighters[2].hasUsedRaPhoenix, 'Ra Phoenix should be marked as consumed after triggering');
    assert(!engine.fighters[2].statuses.some((status) => status.identityId === 'RA_PHOENIX'), 'Ra Phoenix status should be removed after triggering');
    assert(logs.some((entry) => entry.text.includes('神不死鸟')), 'Ra Phoenix should produce a named combat log');
    assert(engine.fighters[0].stats.dmgTaken > 0 || engine.fighters[3].stats.dmgTaken > 0, 'Ra Phoenix should retaliate against enemies');
    const mitigationIndex = logs.findIndex((entry) => entry.text.includes(engine.fighters[3].name) && entry.text.includes('神不死鸟') && entry.text.includes('避开'));
    const noDamageIndex = logs.findIndex((entry) => entry.text.includes(`火焰扫过 ${engine.fighters[3].name}`) && entry.text.includes('没有造成实际伤害'));
    assert(mitigationIndex >= 0 && noDamageIndex > mitigationIndex, 'Ra Phoenix must explain mitigation before reporting its zero-damage result');
    cases.push('Gacha Ra Phoenix revives and retaliates once');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const ra = makeFighter('翼神龙反扑中断测试体@A');
    const joker = makeFighter('屑@B');
    const bystander = makeFighter('神不死鸟中断旁观者@B');
    const { engine, logs } = makeDeathEngine([gacha, ra, joker, bystander]);
    const godOfTrolls = localProject.jobs.GOD_OF_TROLLS;
    assert(godOfTrolls, 'GOD_OF_TROLLS job should exist for interrupted Ra Phoenix tests');
    bindAsGachaSummon(engine.fighters[0], engine.fighters[1], '翼神龙', true);
    engine.fighters[1].maxHp = 1000;
    localProject.setCurrentHp(engine.fighters[1], 10);
    engine.fighters[1].atk = 1000;
    engine.fighters[1].mag = 1000;
    replaceTestStatuses(engine.fighters[1], [{ identityId: 'RA_PHOENIX', remainingTurns: 3 }, { identityId: 'POISON', remainingTurns: 3 }]);
    engine.fighters[2].job = 'GOD_OF_TROLLS';
    engine.fighters[2].jobData = { ...godOfTrolls, skills: [...(godOfTrolls.skills ?? [])] };
    engine.fighters[2].transformed = true;
    engine.fighters[2].maxHp = 100000;
    localProject.setCurrentHp(engine.fighters[2], 100000);
    engine.fighters[3].maxHp = 100000;
    localProject.setCurrentHp(engine.fighters[3], 100000);

    withRandomSequence([0, 0.99], () => {
      engine.processStatus(engine.fighters[1]);
    });

    const dotIndex = logs.findIndex((entry) => entry.text.includes('翼神龙反扑中断测试体') && entry.text.includes('受到持续伤害'));
    const reviveIndex = logs.findIndex((entry) => entry.text.includes('【神不死鸟】') && entry.text.includes('致死瞬间'));
    const redirectIndex = logs.findIndex((entry) => entry.text.includes('随机恶作剧') && entry.text.includes('翼神龙反扑中断测试体'));
    const deathIndex = logs.findIndex((entry) => entry.type === 'death' && entry.text.includes('【伤害转移】翼神龙反扑中断测试体'));
    const interruptedIndex = logs.findIndex((entry) => entry.text.includes('反扑途中被击倒') && entry.text.includes('余下的太阳火焰'));
    assert(dotIndex >= 0 && reviveIndex > dotIndex, 'Lethal status damage should be logged before Ra Phoenix revival');
    assert(redirectIndex > reviveIndex && deathIndex > redirectIndex, 'Ra Phoenix self-redirect death should follow revival and redirect cause');
    assert(interruptedIndex > deathIndex, 'Ra Phoenix should explicitly stop the remaining retaliation after dying mid-chain');
    assert(!logs.slice(deathIndex + 1).some((entry) => entry.text.includes('神不死鸟中断旁观者') && /(?:反扑|火焰扫过)/.test(entry.text)), 'A defeated Ra must not continue attacking later Phoenix targets');
    assert(engine.fighters[1].isDeadAnnounced && engine.fighters[1].currentHp === 0, 'Ra should remain defeated after its Phoenix damage is redirected back mid-chain');
    cases.push('Ra Phoenix status trigger logs cause first and stops after mid-chain death');
  }

  {
    const attacker = makeFighter('神不死鸟王座攻击者@B');
    const gacha = makeFighter('牢鳄@A');
    const ra = makeFighter('翼神龙王座测试体@A');
    const tokusatsu = makeFighter('刺猬人@B');
    const { engine, logs } = makeDeathEngine([attacker, gacha, ra, tokusatsu]);
    localProject.setCurrentHp(engine.fighters[1], Math.floor(engine.fighters[1].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[1]);
    bindAsGachaSummon(engine.fighters[1], engine.fighters[2], '翼神龙', true);
    engine.fighters[2].maxHp = 3000;
    localProject.setCurrentHp(engine.fighters[2], 100);
    applyTestStatus(engine.fighters[2], { identityId: 'RA_PHOENIX', remainingTurns: 3 });
    engine.fighters[3].maxHp = 100000;
    localProject.setCurrentHp(engine.fighters[3], 100000);
    applyTestStatus(engine.fighters[3], { identityId: 'WAIT_COUNTER', charges: 3 });

    engine.applyDamage(engine.fighters[2], 5000, 'skill', true, engine.fighters[0], { actionName: '神不死鸟王座测试' });

    assert(engine.fighters[3].stats.dmgTaken > 0, 'Ra Phoenix fire should still damage Tokusatsu');
    assert(!engine.fighters[3].counterUsed, 'Ra Phoenix passive retaliation should not consume Tokusatsu throne');
    assert(engine.fighters[3].job !== 'MIRACLE_MONSTER_BUJIN', 'Ra Phoenix passive retaliation should not transform Tokusatsu into monster form');
    assert(!logs.some((entry) => entry.text.includes('神不死鸟') && entry.text.includes('武神王座')), 'Ra Phoenix logs should not claim it triggered Tokusatsu throne');
    cases.push('Gacha Ra Phoenix does not trigger Tokusatsu throne');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const ra = makeFighter('翼神龙指令测试体@A');
    const target = makeFighter('召唤指令靶子@B');
    const { engine, logs } = makeDeathEngine([gacha, ra, target]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    bindAsGachaSummon(engine.fighters[0], engine.fighters[1], '翼神龙', true);
    applyTestStatus(engine.fighters[1], { identityId: 'CHARMED', remainingTurns: 2 });
    engine.fighters[1].atk = 1000;
    engine.fighters[1].mag = 1000;
    engine.fighters[2].maxHp = 100000;
    localProject.setCurrentHp(engine.fighters[2], 100000);
    const commandCard = engine.Data.GACHA_SSR_POOL.find((entry) => entry.text.includes('召唤指令'));
    assert(commandCard, 'Gacha SSR pool should include summon command');
    engine.SKILLS.__test_summon_command = { name: '测试召唤指令', tag: 'buff' as const, ...commandCard };

    engine.executeSkillAction('__test_summon_command', engine.fighters[0], engine.fighters[2]);

    assert(engine.fighters[2].stats.dmgTaken === 0, 'Summon command should not force a controlled summon to attack');
    assert(logs.some((entry) => entry.text.includes('己方召唤物都被控制')), 'Summon command should explain when all summons are controlled');
    cases.push('Gacha summon command cannot bypass controlled summons');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const summon = makeFighter('全军进击召唤物@A');
    const joker = makeFighter('屑@B');
    const { engine, logs } = makeDeathEngine([gacha, summon, joker]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    bindAsGachaSummon(engine.fighters[0], engine.fighters[1], 'Saber');
    engine.fighters[1].atk = 400;
    engine.fighters[1].mag = 400;
    engine.fighters[2].maxHp = 10000;
    localProject.setCurrentHp(engine.fighters[2], 10000);
    const godOfTrolls = localProject.jobs.GOD_OF_TROLLS;
    assert(godOfTrolls, 'GOD_OF_TROLLS job should exist for all-out attack redirect tests');
    engine.fighters[2].job = 'GOD_OF_TROLLS';
    engine.fighters[2].jobData = { ...godOfTrolls, skills: [...(godOfTrolls.skills ?? [])] };
    applyTestStatus(engine.fighters[0], { identityId: 'GACHA_SUMMON_LIFESTEAL', remainingTurns: 4 });
    engine.fighters[0].gachaSummonLifestealPct = 0.35;
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.5));
    const allOutCard = engine.Data.GACHA_SSR_POOL.find((entry) => entry.text.includes('全军进击'));
    assert(allOutCard, 'Gacha SSR pool should include all-out attack');
    engine.SKILLS.__test_all_out_attack = { name: '测试全军进击', tag: 'special' as const, ...allOutCard };

    withRandomSequence([0, 0, 0], () => {
      engine.executeSkillAction('__test_all_out_attack', engine.fighters[0], engine.fighters[2]);
    });

    const transferIndex = logs.findIndex((entry) => entry.text.includes('随机恶作剧'));
    const lifestealIndex = logs.findIndex((entry) => entry.text.includes('吸血牌回流'));
    const redirectSummaryIndex = logs.findIndex((entry) => entry.text.includes('原目标没有受伤；转移伤害已单独结算'));
    assert(transferIndex >= 0, 'All-out attack should trigger Joker transfer in this regression');
    assert(lifestealIndex < 0, 'A summon hit redirected into its own side must not trigger summon lifesteal');
    assert(redirectSummaryIndex > transferIndex, 'All-out attack should explain redirected original target after the transfer settles');
    assert(!logs.some((entry) => entry.text.includes('进击被 屑 化解，没有造成实际伤害')), 'All-out attack should not imply redirected summon damage did no damage at all');
    cases.push('Gacha all-out attack explains friendly Joker transfer without false lifesteal');
  }

  {
    const gacha = makeFighter('牢鳄');
    const target = makeFighter('胜利归属靶');
    const { engine, logs } = makeDeathEngine([gacha, target]);
    const exodiaCard = { name: '黑暗大法师召唤', tag: 'special' as const, ...engine.Data.EXODIA_CARD };
    engine.executeSummonSkill(exodiaCard, engine.fighters[0], engine.getTeamId(engine.fighters[0]));
    const exodia = engine.fighters.find((fighter) => fighter.name === '黑暗大法师');
    assert(exodia, 'Exodia should exist for summon win attribution');

    engine.checkWinCondition([exodia]);

    assert(logs.some((entry) => entry.text.includes('最终胜者：牢鳄') && !entry.text.includes('黑暗大法师')), 'Summon-only win log should name the summoner without listing the summon as a co-winner');
    cases.push('Summon victory log names only the summoner');
  }

  {
    const succubus = makeFighter('克蕾儿丝菲尔@A');
    const { engine, logs } = makeDeathEngine([succubus, makeFighter('变身旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);

    assert(engine.fighters[0].job === 'CHIMERA', `Succubus hook should transform to CHIMERA, got ${engine.fighters[0].job}`);
    assert(engine.fighters[0].spd >= 145, 'Succubus hook should set the balanced chimera speed floor');
    assert(engine.fighters[0].statuses.some((status) => status.identityId === 'BKB' && status.attribution.effectSourceId === 'chimera_startup_core'), 'Succubus transform should add startup core BKB');
    assert(engine.fighters[0].statuses.some((status) => status.identityId === 'SPELL_BLOCK' && status.attribution.effectSourceId === 'chimera_startup_core'), 'Succubus transform should add startup core spell block');
    assert(logs.some((entry) => entry.text.includes('肉体开始重组')), 'Succubus hook should keep the original transform log');
    cases.push('Succubus transform hook');
  }

  {
    const sigua = makeFighter('丝瓜uli@A');
    const teammate = makeFighter('玄凝@A');
    const enemy = makeFighter('光环旁观者@B');
    const { engine, logs } = makeDeathEngine([sigua, teammate, enemy]);
    const singer = engine.fighters[0];
    const ally = engine.fighters[1];
    const allyAtkBefore = getEffectiveCombatStat(ally, 'atk');
    const skill = poolSkillByStatus('DIVA_BUFF_POOL', 'DIVA_FINAL_CHORUS', '歌姬演唱');
    const teamId = engine.getTeamId(singer);

    engine.executeSupportSkill(skill, singer, null, teamId);
    engine.spreadDivaSupport(skill, singer, teamId);

    assert(singer.statuses.some((status) => status.identityId === 'DIVA_FINAL_CHORUS'), 'Diva final chorus should use a diva-owned status on the singer');
    assert(ally.statuses.some((status) => status.identityId === 'DIVA_FINAL_CHORUS'), 'Diva aura should copy the diva-owned status to teammates');
    assert(!engine.fighters.some((fighter) => fighter.statuses.some((status) => status.identityId.startsWith('PLUG_'))), 'Diva support should not grant chimera plug statuses');
    assert(getEffectiveCombatStat(ally, 'atk') > allyAtkBefore, 'Diva final chorus should apply its stat buff to teammates');
    assert(logs.some((entry) => entry.text.includes('歌姬的光环')), 'Diva aura spread should still be logged');
    cases.push('Diva support uses diva-owned status instead of chimera plug');
  }

  {
    const sigua = makeFighter('丝瓜uli@A');
    const enemy = makeFighter('插件旁观者@B');
    const { engine, logs } = makeDeathEngine([sigua, enemy]);
    const singer = engine.fighters[0];
    const teamId = engine.getTeamId(singer);
    const roguePlugSkill: SkillDefinition = {
      name: '错误插件测试',
      tag: 'buff',
      statusApplications: [{ identityId: 'PLUG_HEART' }],
      text: '测试错误插件状态',
    };

    engine.executeSupportSkill(roguePlugSkill, singer, null, teamId);

    assert(!singer.statuses.some((status) => status.identityId === 'PLUG_HEART'), 'Non-succubus support should not receive PLUG_HEART');
    assert(logs.some((entry) => entry.text.includes('状态归属校验') && entry.text.includes('已被拦截')), 'Rogue plug status should be explicitly blocked');
    cases.push('Rogue chimera plug status is blocked outside succubus plugin install');
  }

  {
    const succubus = makeFighter('克蕾儿丝菲尔@A');
    const target = makeFighter('合成兽插件靶@B');
    target.maxHp = 100000;
    localProject.setCurrentHp(target, 100000);
    const { engine, logs } = makeDeathEngine([succubus, target]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    const claire = engine.fighters[0];
    const teamId = engine.getTeamId(claire);

    engine.executeSupportSkill(chimeraInstallSkillByStatus('PLUG_HEAD'), claire, null, teamId);
    engine.executeSupportSkill(chimeraInstallSkillByStatus('PLUG_SKIN'), claire, null, teamId);

    assert(Number(claire.chimeraMilestoneLevel) === 2, `Chimera should reach 2-plugin milestone, got ${claire.chimeraMilestoneLevel}`);
    assert(claire.statuses.some((status) => status.identityId === 'REGEN'), '2-plugin milestone should grant regeneration');
    assert(logs.some((entry) => entry.text.includes('合成稳定')), '2-plugin milestone should be logged');
    assert(!logs.some((entry) => entry.text.includes('合成稳定') && entry.text.includes('恢复 0 点生命')), 'Full-health chimera milestone should describe healing overflow instead of healing 0 HP');
    assert(logs.some((entry) => entry.text.includes('暴食之口启动')), 'Head plugin install should have an immediate combat side effect');
    assert(logs.some((entry) => entry.text.includes('纳米皮肤') && entry.text.includes('自适应硬化')), 'Skin plugin install should have an immediate defensive side effect');
    assert(!logs.some((entry) => entry.text.includes('纳米皮肤') && entry.text.includes('恢复 0 点生命')), 'Full-health Nano Skin should describe healing overflow instead of healing 0 HP');

    engine.executeSupportSkill(chimeraInstallSkillByStatus('PLUG_BACK'), claire, null, teamId);
    engine.executeSupportSkill(chimeraInstallSkillByStatus('PLUG_HEART'), claire, null, teamId);

    assert(Number(claire.chimeraMilestoneLevel) === 4, `Chimera should reach 4-plugin milestone, got ${claire.chimeraMilestoneLevel}`);
    assert(claire.chimeraInstantActionQueued, '4-plugin milestone should queue a chimera instant action');
    withRandomSequence([0, 0, 0, 0], () => {
      engine.finishStep({ current: false });
    });
    assert(!claire.chimeraInstantActionQueued, 'Chimera instant action should resolve during finishStep');
    assert(logs.some((entry) => entry.text.includes('兽性苏醒') && entry.text.includes('追加一次合成兽行动')), '4-plugin milestone instant action should be logged');

    engine.executeSupportSkill(chimeraInstallSkillByStatus('PLUG_EYE'), claire, null, teamId);
    engine.executeSupportSkill(chimeraInstallSkillByStatus('PLUG_LEG'), claire, null, teamId);

    assert(Number(claire.chimeraMilestoneLevel) === 6, `Chimera should reach 6-plugin milestone, got ${claire.chimeraMilestoneLevel}`);
    assert(claire.statuses.some((status) => status.identityId === 'INVUL' && status.attribution.effectSourceId === 'chimera_disaster_omen'), '6-plugin milestone should grant disaster omen invul');
    assert(claire.statuses.some((status) => status.identityId === 'SPELL_BLOCK' && status.attribution.effectSourceId === 'chimera_disaster_omen'), '6-plugin milestone should grant disaster omen spell block');
    assert(logs.some((entry) => entry.text.includes('灾厄预兆')), '6-plugin milestone should be logged');
    cases.push('Succubus chimera plugin milestones');
  }

  {
    const succubus = makeFighter('克蕾儿丝菲尔@A');
    const target = makeFighter('石化魔眼致死靶@B');
    const { engine, logs } = makeDeathEngine([succubus, target]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    localProject.setCurrentHp(engine.fighters[1], 1);

    engine.executeSupportSkill(
      chimeraInstallSkillByStatus('PLUG_EYE'),
      engine.fighters[0],
      null,
      engine.getTeamId(engine.fighters[0]),
    );

    assert(engine.fighters[1].isDead || engine.fighters[1].isDeadAnnounced, 'Lethal Stone Eye calibration should defeat its target');
    assert(!engine.fighters[1].statuses.some((status) => status.identityId === 'WEAK'), 'Stone Eye must not attach Weak after its side damage already defeated the target');
    assert(!logs.some((entry) => entry.text.includes('石化魔眼校准') && entry.text.includes('施加虚弱')), 'Lethal Stone Eye log must not claim a post-death Weak application');
    cases.push('Chimera Stone Eye cannot apply or announce Weak after lethal side damage');
  }

  {
    const succubus = makeFighter('克蕾儿丝菲尔@A');
    const target = makeFighter('毒尾抵挡靶@B');
    applyTestStatus(target, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'generic_spell_block' } });
    const { engine, logs } = makeDeathEngine([succubus, target]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);

    engine.executeSupportSkill(
      chimeraInstallSkillByStatus('PLUG_TAIL'),
      engine.fighters[0],
      null,
      engine.getTeamId(engine.fighters[0]),
    );

    assert(!engine.fighters[1].statuses.some((status) => status.identityId === 'POISON'), 'Blocked Chimera tail strike must not inject poison through spell block');
    assert(!logs.some((entry) => entry.text.includes('灾厄毒尾甩击') && entry.text.includes('被注入剧毒')), 'Blocked Chimera tail log must not claim poison success');
    cases.push('Chimera tail status obeys the resolved damage and defense outcome');
  }

  {
    const succubus = makeFighter('克蕾儿丝菲尔@A');
    const owl = makeFighter('鸮@B');
    const { engine, logs } = makeDeathEngine([succubus, owl]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    const claire = engine.fighters[0];
    const engineOwl = engine.fighters[1];
    replaceTestStatuses(claire, []);
    const existingPlugSkills = (localProject.data.CHIMERA_PLUGIN_POOL ?? [])
      .filter((entry) => !entry.statusApplications?.some((application) => application.identityId === 'PLUG_TAIL'))
      .map((entry) => entry.newSkill)
      .filter((skillId): skillId is string => !!skillId)
      .slice(0, 5);
    claire.jobData.skills.push(...existingPlugSkills.filter((skillId) => !claire.jobData.skills.includes(skillId)));
    claire.chimeraMilestoneLevel = 4;
    localProject.setCurrentHp(claire, 1);
    const owlState = ensureOwlState(engineOwl, engine.turnCount);
    owlState.warForm = 'pride';
    localProject.setCurrentHp(engineOwl, Math.floor(engineOwl.maxHp * 0.5));

    engine.executeSupportSkill(
      chimeraInstallSkillByStatus('PLUG_TAIL'),
      claire,
      null,
      engine.getTeamId(claire),
    );

    const tailIndex = logs.findIndex((entry) => entry.text.includes('【灾厄毒尾甩击】') && entry.text.includes('实际造成'));
    const transformIndex = logs.findIndex((entry) => entry.text.includes('转入第二阶段【煮酒论英雄】'));
    assert(tailIndex >= 0 && transformIndex > tailIndex, 'Chimera side-hit result must be logged before the target transformation it triggers');
    assert(claire.isDead || claire.isDeadAnnounced, 'Owl phase-two lightning should defeat the 1-HP Chimera attacker in this regression');
    assert(claire.currentHp === 0, 'A Chimera killed by a nested transformation reaction must remain at zero HP');
    assert(Number(claire.chimeraMilestoneLevel) === 4, 'A dead Chimera must not continue into the six-plugin milestone');
    assert(!logs.some((entry) => entry.text.includes('【灾厄预兆】') && entry.text.includes(claire.name)), 'A dead Chimera must not heal or grant Disaster Omen after its action is interrupted');
    cases.push('Nested transformation death interrupts Chimera install aftermath');
  }

  {
    const sigua = makeFighter('丝瓜uli@A');
    const claire = makeFighter('克蕾儿丝菲尔@A');
    const { engine, logs } = makeDeathEngine([sigua, claire, makeFighter('变身旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);

    assert(engine.fighters[0].job === 'MY_BABY', `Sigua bond hook should transform to MY_BABY, got ${engine.fighters[0].job}`);
    assert(engine.fighters[0].mag === 300, 'Sigua bond hook should set baby magic');
    assert(engine.fighters[0].def >= 160 && engine.fighters[0].res >= 160, 'Sigua bond hook should set baby defensive floors');
    assert(logs.some((entry) => entry.text.includes('同队的克蕾儿')), 'Sigua bond hook should keep the original transform log');
    cases.push('Sigua Claire-bond transform hook');
  }

  {
    const sigua = makeFighter('丝瓜uli@A');
    const claire = makeFighter('克蕾儿丝菲尔@A');
    const { engine } = makeDeathEngine([sigua, claire, makeFighter('选技旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    localProject.setCurrentHp(engine.fighters[1], Math.floor(engine.fighters[1].maxHp * 0.3));

    const selectedSkill = engine.selectSkill(engine.fighters[0]);

    assert(selectedSkill === 'baby_feed', `Sigua baby support should heal low-health Claire, got ${selectedSkill}`);
    cases.push('Sigua baby support prioritizes Claire healing');
  }

  {
    const sigua = makeFighter('丝瓜uli@A');
    const { engine, logs } = makeDeathEngine([sigua, makeFighter('变身旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);

    assert(engine.fighters[0].job === 'VALO_JUNIOR', `Sigua solo hook should transform to VALO_JUNIOR, got ${engine.fighters[0].job}`);
    assert(engine.fighters[0].def >= 150 && engine.fighters[0].res >= 150, 'Sigua solo hook should set Valorant defensive floors');
    assert(engine.fighters[0].ultPoints === 1 && engine.fighters[0].economy === 2, 'Sigua solo hook should initialize Valorant resources');
    assert(logs.some((entry) => entry.text.includes('拿起了步枪')), 'Sigua solo hook should keep the original transform log');
    cases.push('Sigua solo transform hook');
  }

  {
    const bunny = makeFighter('兔卷卷@A');
    const { engine, logs } = makeDeathEngine([bunny, makeFighter('变身旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);

    assert(engine.fighters[0].job === 'VERSATILE_RABBIT', `Bunny hook should transform to VERSATILE_RABBIT, got ${engine.fighters[0].job}`);
    STAT_KEYS.forEach((key) => {
      assert(engine.fighters[0][key] === 170, `Bunny hook should set ${key} to 170`);
    });
    assert(logs.some((entry) => entry.text.includes('六边形战士')), 'Bunny hook should keep the original transform log');
    cases.push('Bunny transform hook');
  }

  {
    const bunny = makeFighter('兔卷卷@A');
    const target = makeFighter('兔速测试靶@B');
    target.maxHp = 100000;
    localProject.setCurrentHp(target, 100000);
    const { engine } = makeDeathEngine([bunny, target]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    const speedBefore = engine.fighters[0].spd;

    withRandomSequence([0.2, 0.5, 0.5, 0.5, 0.5], () => {
      engine.executeSkillAction('v_rabbit_calc_rng', engine.fighters[0], engine.fighters[1]);
    });

    assert(engine.fighters[0].spd === speedBefore, 'Rabbit calculator haste should not permanently change speed');
    assert(engine.fighters[0].statuses.some((status) => status.identityId === 'RABBIT_CALC_HASTE' && status.remainingTurns === 3), 'Rabbit calculator haste should add a temporary status');
    engine.processStatus(engine.fighters[0]);
    engine.processStatus(engine.fighters[0]);
    engine.processStatus(engine.fighters[0]);
    assert(!engine.fighters[0].statuses.some((status) => status.identityId === 'RABBIT_CALC_HASTE'), 'Rabbit calculator haste should expire on self turns');
    assert(engine.fighters[0].spd === speedBefore, 'Expired rabbit calculator haste should leave speed unchanged');
    cases.push('Rabbit calculator haste is temporary');
  }

  {
    const bunny = makeFighter('兔卷卷@A');
    const ting = makeFighter('小汀@B');
    const { engine, logs } = makeDeathEngine([bunny, ting]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    engine.fighters[0].mag = 1000;
    localProject.setCurrentHp(engine.fighters[1], 20);

    withRandomSequence([0.2, ...Array(20).fill(0.4)], () => {
      engine.executeSkillAction('v_rabbit_calc_rng', engine.fighters[0], engine.fighters[1]);
    });

    const transformIndex = logs.findIndex((entry) => entry.type === 'transform' && entry.text.includes(engine.fighters[1].name));
    const totalIndex = logs.findIndex((entry) => entry.text.includes('【弹幕共鸣】') && entry.text.includes('总计造成'));
    assert(transformIndex >= 0 && totalIndex > transformIndex, 'Rabbit multi-hit should settle a phase transformation before the remaining barrage and aggregate log');
    assert(logs.filter((entry) => entry.text.includes('锁血保护')).length === 1, 'Rabbit multi-hit should not repeatedly hit an unflushed phase-one lock');
    cases.push('Rabbit multi-hit flushes phase transitions between segments');
  }

  {
    const bunny = makeFighter('兔卷卷@A');
    const yuzu = makeFighter('柚子@B');
    const teammate = makeFighter('镜界分摊队友@B');
    const { engine, logs } = makeDeathEngine([bunny, yuzu, teammate]);
    const engineBunny = engine.fighters[0];
    const engineYuzu = engine.fighters[1];
    const engineTeammate = engine.fighters[2];
    localProject.setCurrentHp(engineBunny, Math.floor(engineBunny.maxHp * 0.4));
    engine.handleTransformations(engineBunny);
    engineBunny.mag = 1000;
    const teammateHpBefore = engineTeammate.currentHp;

    withRandomSequence([0.2, ...Array(24).fill(0.4)], () => {
      engine.executeSkillAction('v_rabbit_calc_rng', engineBunny, engineYuzu);
    });

    assert(engineTeammate.currentHp < teammateHpBefore, 'Rabbit barrage against Yuzu should deal its redirected damage to her teammate');
    assert(logs.some((entry) => entry.text.includes('【弹幕共鸣】6 段打击结算完毕') && entry.text.includes('分摊/转移承受者')), 'Rabbit barrage should aggregate redirected Yuzu damage instead of claiming zero damage');
    assert(!logs.some((entry) => entry.text.includes('弹幕狂潮扫过') && entry.text.includes('没有造成实际伤害')), 'Rabbit barrage must not contradict successful mirror-share damage');
    cases.push('Rabbit multi-hit aggregates Yuzu mirror-share damage');
  }

  {
    const bunny = makeFighter('兔卷卷@A');
    const ting = makeFighter('小汀@B');
    const { engine, logs } = makeDeathEngine([bunny, ting]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    localProject.setCurrentHp(engine.fighters[1], Math.floor(engine.fighters[1].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[1]);
    engine.fighters[0].mag = 1200;
    localProject.setCurrentHp(engine.fighters[1], 10);

    withRandomSequence([0.99, 0.5, 0.5, 0.5], () => {
      engine.executeSkillAction('v_rabbit_calc_rng', engine.fighters[0], engine.fighters[1]);
    });

    const damageIndex = logs.findIndex((entry) => entry.text.includes('无休加班压垮') && entry.text.includes('实际造成'));
    const defianceIndex = logs.findIndex((entry) => entry.text.includes('【不甘倒下】'));
    const statusIndex = logs.findIndex((entry) => entry.text.includes('【无休加班】') && entry.type === 'debuff');
    assert(damageIndex >= 0 && defianceIndex > damageIndex, 'Rabbit overtime hit should log its damage before Ting death-save resolution');
    assert(statusIndex > defianceIndex, 'Rabbit overtime post-hit statuses should be logged after Ting death-save resolution');
    cases.push('Rabbit calculator orders damage-save-status causally');
  }

  {
    const bunny = makeFighter('兔卷卷@A');
    const target = makeFighter('爆燃致死测试靶@B');
    const { engine, logs } = makeDeathEngine([bunny, target]);
    const engineBunny = engine.fighters[0];
    const engineTarget = engine.fighters[1];
    localProject.setCurrentHp(engineBunny, Math.floor(engineBunny.maxHp * 0.4));
    engine.handleTransformations(engineBunny);
    engineBunny.mag = 120;
    engineTarget.transformed = true;
    engineTarget.maxHp = 1000;
    applyTestStatus(engineTarget, { identityId: 'BURN', count: 1 });
    localProject.setCurrentHp(engineTarget, 240);

    withRandomSequence([0.99, 0.5, 0.5, 0.5], () => {
      engine.executeSkillAction('v_rabbit_calc_rng', engineBunny, engineTarget);
    });

    const burn = queryMechanic(engineTarget, 'BURN');
    assert(!engineTarget.isDeadAnnounced, 'Rabbit overtime must not auto-explode an existing burn when reapplying it');
    assert(burn.potency > 6 && burn.count > 1, 'Rabbit overtime should add both burn potency and count');
    assert(logs.some((entry) => entry.text.includes('【无休加班】') && entry.text.includes('灼烧') && entry.text.includes('×')), 'Rabbit overtime should log the new burn potency-times-count model');
    cases.push('Rabbit calculator stacks burn without an implicit refresh explosion');
  }

  {
    const bunny = makeFighter('兔卷卷@A');
    const target = makeFighter('换装抵挡测试靶@B');
    applyTestStatus(target, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'morphling_linken_sphere' } });
    const { engine, logs } = makeDeathEngine([bunny, target]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);

    withRandomSequence([0.5, 0, 0], () => {
      engine.executeSkillAction('v_rabbit_style_switch', engine.fighters[0], engine.fighters[1]);
    });

    assert(engine.fighters[0].statuses.some((status) => status.identityId.startsWith('STYLE_')), 'Enemy spell block should not prevent Rabbit from switching styles');
    assert(!logs.some((entry) => entry.text.includes('挡下') && entry.text.includes('【切换人设】')), 'Rabbit self-style switch should never be described as blocked by an enemy defense');
    cases.push('Rabbit style switch cannot be blocked by an enemy spell defense');
  }

  {
    const ting = makeFighter('小汀@A');
    const target = makeFighter('完整抵挡日志靶@B');
    applyTestStatus(target, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'gacha_whale_rewrite' } });
    const { engine, logs } = makeDeathEngine([ting, target]);

    engine.executeSkillAction('suicide_bomb', engine.fighters[0], engine.fighters[1]);

    const intentIndex = logs.findIndex((entry) =>
      entry.text.includes('【技能发动】') &&
      entry.text.includes('小汀') &&
      entry.text.includes('完整抵挡日志靶') &&
      entry.text.includes('【自爆】'),
    );
    const blockIndex = logs.findIndex((entry) => entry.text.includes('挡下了') && entry.text.includes('【自爆】'));
    assert(intentIndex >= 0, 'A fully blocked skill should still log its actor, target, and action before the defense result');
    assert(blockIndex > intentIndex, 'The skill intent must precede the full-block result');
    assert(logs[intentIndex]?.visualCue?.kind === 'combat_action', 'A fully blocked skill should retain its structured combat visual cue');
    cases.push('Precast spell block preserves the attempted action cause and visual cue');
  }

  {
    const bunny = makeFighter('兔卷卷@A');
    const target = makeFighter('归零测试靶@B');
    target.maxHp = 100000;
    localProject.setCurrentHp(target, 100000);
    const { engine } = makeDeathEngine([bunny, target]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    const speedBefore = engine.fighters[0].spd;

    engine.executeSkillAction('v_rabbit_zero', engine.fighters[0], engine.fighters[1]);

    assert(engine.fighters[0].spd === speedBefore, 'Rabbit zero haste should not permanently change speed');
    assert(engine.fighters[0].statuses.some((status) => status.identityId === 'RABBIT_ZERO_HASTE' && status.remainingTurns === 2), 'Rabbit zero haste should add a temporary status');
    assert(engine.fighters[1].statuses.some((status) => status.identityId === 'ZEROED'), 'Rabbit zero should still zero the target');
    cases.push('Rabbit zero haste is temporary');
  }

  {
    const tokusatsu = makeFighter('刺猬人@A');
    const emote = makeFighter('表情@B');
    const monsterJob = localProject.jobs.MIRACLE_MONSTER_BUJIN;
    assert(monsterJob, 'MIRACLE_MONSTER_BUJIN job should exist for deferred event ordering tests');
    tokusatsu.job = 'MIRACLE_MONSTER_BUJIN';
    tokusatsu.jobData = JSON.parse(JSON.stringify(monsterJob)) as typeof monsterJob;
    tokusatsu.isTokusatsu = true;
    tokusatsu.transformed = true;
    tokusatsu.atk = 10000;
    emote.maxHp = 100;
    localProject.setCurrentHp(emote, 50);
    applyTestStatus(emote, { identityId: 'EMOTE_ADAPT', remainingTurns: 2 });
    const { engine, logs } = makeDeathEngine([tokusatsu, emote]);

    engine.executeSkillAction('bujin_monster_combo', engine.fighters[0], engine.fighters[1]);

    const openingIndex = logs.findIndex((entry) => entry.text.includes('以怪兽力量拖动武神之刃'));
    const hitIndex = logs.findIndex((entry) => entry.text.includes('第 1 斩命中'));
    const adaptIndex = logs.findIndex((entry) => entry.text.includes('【适应转轮】') && entry.text.includes('记录'));
    const deathIndex = logs.findIndex((entry) => entry.text.includes('【武神怪兽连斩】') && entry.type === 'death');
    assert(openingIndex >= 0 && adaptIndex > openingIndex && hitIndex > adaptIndex && deathIndex > hitIndex, 'Per-target mitigation should follow the attack cause, then precede final damage and death');
    cases.push('Tokusatsu multi-hit logs cause, mitigation, final damage, and death in order');
  }

  {
    const tokusatsu = makeFighter('刺猬人@A');
    const target = makeFighter('咆哮状态来源测试靶@B');
    const monsterJob = localProject.jobs.MIRACLE_MONSTER_BUJIN;
    assert(monsterJob, 'MIRACLE_MONSTER_BUJIN job should exist for Monster Roar status-log tests');
    tokusatsu.job = 'MIRACLE_MONSTER_BUJIN';
    tokusatsu.jobData = JSON.parse(JSON.stringify(monsterJob)) as typeof monsterJob;
    tokusatsu.isTokusatsu = true;
    tokusatsu.transformed = true;
    target.maxHp = 10000;
    localProject.setCurrentHp(target, 10000);
    const { engine, logs } = makeDeathEngine([tokusatsu, target]);

    withRandomSequence([0], () => {
      engine.executeSkillAction('monster_roar', engine.fighters[0], engine.fighters[1]);
    });

    assert(engine.fighters[1].statuses.some((status) => status.identityId === 'AIRBORNE'), 'Monster Roar forced roll should apply airborne');
    assert(logs.some((entry) => entry.text.includes('【怪兽咆哮】') && entry.text.includes(engine.fighters[1].name) && entry.text.includes('击飞 1 回合')), 'Monster Roar should log the concrete source and duration of airborne');
    cases.push('Monster Roar logs every applied control source');
  }

  {
    const tokusatsu = makeFighter('刺猬人@A');
    const target = makeFighter('咆哮沉沦顺序测试靶@B');
    const monsterJob = localProject.jobs.MIRACLE_MONSTER_BUJIN;
    assert(monsterJob, 'MIRACLE_MONSTER_BUJIN job should exist for Monster Roar aftermath ordering tests');
    tokusatsu.job = 'MIRACLE_MONSTER_BUJIN';
    tokusatsu.jobData = JSON.parse(JSON.stringify(monsterJob)) as typeof monsterJob;
    tokusatsu.isTokusatsu = true;
    tokusatsu.transformed = true;
    const roarDamage = Math.floor(
      getEffectiveCombatStat(tokusatsu, 'mag', 'custom') * 0.95 +
      getEffectiveCombatStat(tokusatsu, 'atk', 'custom') * 0.22 +
      getEffectiveCombatStat(tokusatsu, 'wis', 'custom') * 0.15,
    );
    target.isNpc = true;
    target.morale = undefined;
    target.maxMorale = undefined;
    target.maxHp = roarDamage + 3;
    localProject.setCurrentHp(target, roarDamage + 3);
    applyTestStatus(target, {
      identityId: 'SINKING',
      potency: 15,
      count: 1,
      attribution: {
        effectSourceId: 'monster_roar_sinking_fixture',
        applierId: tokusatsu.id,
        applierName: tokusatsu.name,
      },
    });
    const { engine, logs } = makeDeathEngine([tokusatsu, target]);

    withRandomSequence([0.9], () => {
      engine.executeSkillAction('monster_roar', engine.fighters[0], engine.fighters[1]);
    });

    const hitIndex = logs.findIndex((entry) =>
      entry.text.includes('咆哮冲击命中') && entry.targetIds?.includes(engine.fighters[1].id),
    );
    const sinkingIndex = logs.findIndex((entry, index) =>
      index > hitIndex && entry.text.includes('【沉沦】') && entry.targetIds?.includes(engine.fighters[1].id),
    );
    const defeatIndex = logs.findIndex((entry, index) =>
      index > sinkingIndex && entry.text.includes('被【沉沦】的后续伤害击倒'),
    );
    assert(
      hitIndex >= 0 && sinkingIndex > hitIndex && defeatIndex > sinkingIndex,
      'Monster Roar must report direct damage before lethal sinking aftermath and defeat',
    );
    cases.push('Monster Roar damage precedes lethal sinking aftermath');
  }

  {
    const bunny = makeFighter('兔卷卷@A');
    const claire = makeFighter('克蕾儿丝菲尔@B');
    const { engine, logs } = makeDeathEngine([bunny, claire]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    engine.fighters[0].mag = 1000;
    localProject.setCurrentHp(engine.fighters[1], 200);

    engine.executeSkillAction('v_rabbit_megaphone', engine.fighters[0], engine.fighters[1]);

    const damageIndex = logs.findIndex((entry) => entry.text.includes('刺耳魔音贯耳') && entry.text.includes('实际承受'));
    const transformIndex = logs.findIndex((entry) => entry.type === 'transform' && entry.text.includes(engine.fighters[1].name));
    const immunityIndex = logs.findIndex((entry) => entry.text.includes('异变核心') && entry.text.includes('眩晕'));
    assert(damageIndex >= 0 && transformIndex > damageIndex && immunityIndex > transformIndex, 'Megaphone should settle damage, phase transformation, then the transformed control immunity in order');
    assert(!logs.some((entry) => entry.text.includes(engine.fighters[1].name) && entry.text.includes('被刺耳魔音震晕')), 'Megaphone must not claim stun success before a phase transformation grants immunity');
    cases.push('Rabbit Megaphone logs transformation before final control result');
  }

  {
    const wt = makeFighter('M1A2_abrams_sep@A');
    const { engine, logs } = makeDeathEngine([wt, makeFighter('变身旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);

    assert(engine.fighters[0].job === 'WT_TOP_TIER', `War Thunder hook should transform to WT_TOP_TIER, got ${engine.fighters[0].job}`);
    assert(engine.fighters[0].statuses.some((status) => status.identityId === 'WT_ERA'), 'War Thunder hook should apply WT_ERA');
    assert(engine.fighters[0].statuses.some((status) => status.identityId === 'SPELL_BLOCK'), 'War Thunder hook should apply SPELL_BLOCK');
    assert(logs.some((entry) => entry.text.includes('顶级备用载具')), 'War Thunder hook should keep the original transform log');
    assert(!logs.some((entry) => entry.text.includes('【绝对驱散】') && entry.text.includes(engine.fighters[0].name)), 'War Thunder form rebuild must not be presented as Waterman absolute dispel');
    cases.push('War Thunder transform hook');
  }

  {
    const wt = makeFighter('M1A2_abrams_sep@A');
    const { engine, logs } = makeDeathEngine([wt, makeFighter('抢修旁观者@B')]);
    const engineWt = engine.fighters[0];
    localProject.setCurrentHp(engineWt, Math.floor(engineWt.maxHp * 0.5));
    const hpBeforeRepair = engineWt.currentHp;
    const expectedTickHeal = Math.floor(engineWt.maxHp * 0.2);

    engine.executeSkillAction('wt_repair', engineWt, engine.fighters[1]);

    assert(engineWt.statuses.some((status) => status.identityId === 'WT_REPAIRING'), 'Long-F repair should enter WT_REPAIRING');
    assert(!engineWt.statuses.some((status) => status.identityId === 'STUN'), 'Long-F repair should use its dedicated state instead of generic stun');
    assert(engineWt.currentHp === hpBeforeRepair, 'Long-F repair healing should happen over repair turns instead of instantly');

    const firstCanAct = engine.processStatus(engineWt);
    assert(!firstCanAct, 'War Thunder should not act during the first repair turn');
    assert(engineWt.currentHp === hpBeforeRepair + expectedTickHeal, `First repair turn should heal 20% max HP, got ${engineWt.currentHp - hpBeforeRepair}`);
    assert(engineWt.statuses.some((status) => status.identityId === 'WT_REPAIRING'), 'Repair should remain active after its first healing turn');

    const secondCanAct = engine.processStatus(engineWt);
    assert(!secondCanAct, 'War Thunder should not act during the second repair turn');
    assert(engineWt.currentHp === hpBeforeRepair + expectedTickHeal * 2, `Two repair turns should heal 40% max HP total, got ${engineWt.currentHp - hpBeforeRepair}`);
    assert(!engineWt.statuses.some((status) => status.identityId === 'WT_REPAIRING'), 'Repair should end after two repair turns');
    assert(logs.filter((entry) => entry.text.includes('【抢修进度】')).length === 2, 'Each repair turn should log its healing progress');
    assert(logs.some((entry) => entry.text.includes('【抢修完成】')), 'Repair expiry should log restored mobility');
    cases.push('War Thunder long-F repair heals over two locked turns');
  }

  {
    const wt = makeFighter('M1A2_abrams_sep@A');
    const gamer = makeFighter('玄凝@B');
    const { engine, logs } = makeDeathEngine([wt, gamer]);
    const engineWt = engine.fighters[0];
    const engineGamer = engine.fighters[1];
    engineWt.atk = 1000;
    engineGamer.maxHp = 100000;
    localProject.setCurrentHp(engineGamer, 100000);
    applyTestStatus(engineWt, { identityId: 'AIM', charges: 1 });
    applyTestStatus(engineGamer, { identityId: 'GAMER_WORLD_STAGE', remainingTurns: 2 });
    applyTestStatus(engineGamer, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'gamer_world_stage' } });

    withRandomSequence([0.99], () => {
      engine.executeSkillAction('wt_t58_knockup', engineWt, engineGamer);
    });

    assert(engineGamer.currentHp < engineGamer.maxHp, 'T-58 should still deal damage when World Stage only blocks its airborne control');
    const immunityLog = logs.find((entry) => entry.text.includes('世界赛舞台') && entry.text.includes('免疫了'));
    assert(immunityLog?.text.includes('击飞效果'), 'Declarative control immunity log should name the blocked airborne effect');
    assert(!immunityLog?.text.endsWith('免疫了T-58 碎甲轰击！'), 'Control immunity log must not imply that the entire damaging skill was negated');
    cases.push('Declarative control immunity names the blocked mechanic instead of the whole damaging skill');
  }

  {
    const wt = makeFighter('M1A2_abrams_sep@A');
    const attacker = makeFighter('抢修火力测试@B');
    const { engine, logs } = makeDeathEngine([wt, attacker]);
    const engineWt = engine.fighters[0];
    engineWt.maxHp = 10000;
    localProject.setCurrentHp(engineWt, 5000);
    engine.executeSkillAction('wt_repair', engineWt, engine.fighters[1]);
    localProject.setCurrentHp(engineWt, engineWt.maxHp);

    const directDamage = engine.applyDamage(engineWt, 1000, 'skill', true, engine.fighters[1], { actionName: '抢修暴露测试' });
    const statusDamage = engine.applyDamage(engineWt, 1000, 'status', true, undefined, { actionName: '持续伤害测试' });

    assert(directDamage === 1300, `Repair exposure should amplify direct damage by 30%, got ${directDamage}`);
    assert(statusDamage === 1000, `Repair exposure should not amplify damage-over-time effects, got ${statusDamage}`);
    assert(logs.filter((entry) => entry.text.includes('【抢修暴露】')).length === 1, 'Only direct damage should log repair exposure amplification');
    cases.push('War Thunder repair exposure amplifies direct but not status damage');
  }

  {
    const wt = makeFighter('M1A2_abrams_sep@A');
    const { engine, logs } = makeDeathEngine([wt, makeFighter('维修分类旁观者@B')]);
    const engineWt = engine.fighters[0];
    localProject.setCurrentHp(engineWt, Math.floor(engineWt.maxHp * 0.4));
    engine.handleTransformations(engineWt);
    localProject.setCurrentHp(engineWt, Math.floor(engineWt.maxHp * 0.5));
    applyTestStatus(engineWt, { identityId: 'BURN', count: 2 });
    applyTestStatus(engineWt, { identityId: 'POISON', remainingTurns: 2 });
    engineWt.wtFpeCharges = 1;
    engineWt.wtNbcsCharges = 1;
    engineWt.wtSpawnPoints = 0;

    engine.executeSkillAction('wt_repair_premium', engineWt, engine.fighters[1]);

    assert(!engineWt.statuses.some((status) => status.identityId === 'BURN' || status.identityId === 'POISON'), 'War Thunder repair should clear burn and poison only with matching consumables');
    assert(logs.some((entry) => entry.text.includes('FPE灭火')), 'War Thunder repair should use FPE wording for burn');
    assert(logs.some((entry) => entry.text.includes('核生化洗消')), 'War Thunder repair should use NBCS/decontamination wording for poison');
    assert(!logs.some((entry) => entry.text.includes('FPE灭火') && entry.text.includes('中毒')), 'War Thunder repair should never describe poison as FPE extinguishing');
    cases.push('War Thunder repair separates FPE and NBCS wording');
  }

  {
    const wt = makeFighter('M1A2_abrams_sep@A');
    const { engine, logs } = makeDeathEngine([wt, makeFighter('洗消耗尽旁观者@B')]);
    const engineWt = engine.fighters[0];
    localProject.setCurrentHp(engineWt, Math.floor(engineWt.maxHp * 0.4));
    engine.handleTransformations(engineWt);
    localProject.setCurrentHp(engineWt, Math.floor(engineWt.maxHp * 0.5));
    applyTestStatus(engineWt, { identityId: 'POISON', remainingTurns: 2 });
    engineWt.wtFpeCharges = 2;
    engineWt.wtNbcsCharges = 0;
    engineWt.wtSpawnPoints = 0;

    engine.executeSkillAction('wt_repair_premium', engineWt, engine.fighters[1]);

    assert(engineWt.statuses.some((status) => status.identityId === 'POISON'), 'War Thunder repair should not clear poison when NBCS is exhausted');
    assert(!logs.some((entry) => entry.text.includes('FPE灭火')), 'War Thunder repair should not spend or log FPE for poison');
    assert(logs.some((entry) => entry.text.includes('核生化洗消包已经耗尽')), 'War Thunder repair should explain poison remains when NBCS is exhausted');
    cases.push('War Thunder repair does not use FPE for poison');
  }

  {
    const fighters = [
      makeFighter('M1A2_abrams_sep@A'),
      ...Array.from({ length: 6 }, (_, index) => makeFighter(`CAS高血靶${index + 1}@B`)),
    ];
    const { engine, logs } = makeDeathEngine(fighters);
    const wt = engine.fighters[0];
    localProject.setCurrentHp(wt, Math.floor(wt.maxHp * 0.4));
    engine.handleTransformations(wt);
    wt.atk = 280;
    wt.wtSpawnPoints = 8;
    engine.fighters.slice(1).forEach((target) => {
      target.maxHp = 5000;
      localProject.setCurrentHp(target, 5000);
    });

    withRandomSequence([0.5, 0.5, 0.5, 0.5, 0.5], () => {
      engine.executeSkillAction('wt_su30_cas', wt, engine.fighters[1]);
    });

    const damagedTargets = engine.fighters.slice(1).filter((target) => target.stats.dmgTaken > 0);
    const suppressedTargets = engine.fighters.slice(2).filter((target) => target.statuses.some((status) => status.identityId === 'WT_SUPPRESS'));
    assert(damagedTargets.length === 4, `Su-30 CAS should hit primary plus up to 3 splash targets, got ${damagedTargets.length}`);
    const expectedMainDamage = Math.floor(wt.atk * 2.78);
    const primaryTargets = damagedTargets.filter((target) => target.stats.dmgTaken === expectedMainDamage);
    assert(primaryTargets.length === 1, `Su-30 primary target should take full main damage once, got ${primaryTargets.length}`);
    assert(primaryTargets[0]?.statuses.some((status) => status.identityId === 'AIRBORNE'), 'Su-30 primary target should use canonical airborne');
    assert(suppressedTargets.length >= 2, `Su-30 splash targets should be suppressed instead of all knocked airborne, got ${suppressedTargets.length}`);
    assert(!logs.some((entry) => entry.text.includes('CAS击杀') || entry.text.includes('弹药架殉爆')), 'Su-30 high-health spread test should not randomly wipe targets');
    cases.push('War Thunder Su-30 CAS uses primary-and-splash damage profile');
  }

  {
    const wt = makeFighter('M1A2_abrams_sep@A');
    const { engine } = makeDeathEngine([wt, makeFighter('测距靶子@B')]);
    const engineWt = engine.fighters[0];
    localProject.setCurrentHp(engineWt, Math.floor(engineWt.maxHp * 0.4));
    engine.handleTransformations(engineWt);
    const atkBefore = engineWt.atk;

    engine.executeSkillAction('wt_laser_rangefinder', engineWt, engine.fighters[1]);
    engine.executeSkillAction('wt_laser_rangefinder', engineWt, engine.fighters[1]);

    assert(engineWt.statuses.some((status) => status.identityId === 'AIM'), 'Laser rangefinder should still grant AIM designation');
    assert(engineWt.atk === atkBefore, `Laser rangefinder should not permanently stack attack, got ${engineWt.atk} from ${atkBefore}`);
    cases.push('War Thunder laser rangefinder does not permanently stack attack');
  }

  {
    const wt = makeFighter('M1A2_abrams_sep@A');
    const marked = makeFighter('激光标记目标@B');
    const decoy = makeFighter('随机火控诱饵@C');
    const { engine, logs } = makeDeathEngine([wt, marked, decoy]);
    const engineWt = engine.fighters[0];
    localProject.setCurrentHp(engineWt, Math.floor(engineWt.maxHp * 0.4));
    engine.handleTransformations(engineWt);
    engine.fighters.slice(1).forEach((target) => {
      target.maxHp = 100000;
      localProject.setCurrentHp(target, 100000);
    });
    engineWt.wtMarkedTargetId = engine.fighters[1].id;
    applyTestStatus(engineWt, { identityId: 'AIM', charges: 2 });

    engine.executeSkillAction('wt_t58_knockup', engineWt, null);

    assert(engine.fighters[1].stats.dmgTaken > 0, 'War Thunder fire control should hit its live laser-marked target');
    assert(engine.fighters[2].stats.dmgTaken === 0, 'War Thunder fire control must not choose a random decoy while a live laser mark exists');
    assert(engineWt.wtMarkedTargetId === undefined, 'A non-CAS War Thunder attack should consume its one-use laser mark');
    assert(logs.some((entry) => entry.text.includes('火控优先窗口关闭')), 'War Thunder should log that the one-use fire-control mark was consumed');
    cases.push('War Thunder laser mark prioritizes exactly the next offensive action');
  }

  {
    const fighters = [
      makeFighter('M1A2_abrams_sep@A'),
      ...Array.from({ length: 6 }, (_, index) => makeFighter(`CAS低血靶${index + 1}@B`)),
    ];
    const { engine, logs } = makeDeathEngine(fighters);
    const wt = engine.fighters[0];
    localProject.setCurrentHp(wt, Math.floor(wt.maxHp * 0.4));
    engine.handleTransformations(wt);
    wt.atk = 100;
    wt.wtSpawnPoints = 8;
    applyTestStatus(wt, { identityId: 'AIM', charges: 3 });
    engine.fighters.slice(1).forEach((target) => {
      target.maxHp = 1000;
      localProject.setCurrentHp(target, 360);
    });

    withRandomSequence([0.5, 0.5, 0.5, 0.5, 0.5], () => {
      engine.executeSkillAction('wt_su30_cas', wt, engine.fighters[1]);
    });

    const ammoRackCount = logs.filter((entry) => entry.text.includes('弹药架殉爆')).length;
    const deadTargets = engine.fighters.slice(1).filter((target) => target.isDead || target.isDeadAnnounced);
    assert(ammoRackCount === 1, `Su-30 CAS should trigger at most one ammo-rack detonation, got ${ammoRackCount}`);
    assert(deadTargets.length === 1, `Su-30 designated low-health test should only remove one target, got ${deadTargets.length}`);
    assert(!wt.statuses.some((status) => status.identityId === 'AIM'), 'Su-30 CAS should consume laser designation AIM');
    cases.push('War Thunder Su-30 CAS limits ammo-rack wipe and consumes laser designation');
  }

  {
    const sigua = makeFighter('丝瓜uli@A');
    const { engine, logs } = makeDeathEngine([sigua, makeFighter('选技旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    engine.fighters[0].ultPoints = 4;
    engine.fighters[0].economy = 0;

    const selectedSkill = withRandomSequence([0], () => engine.selectSkill(engine.fighters[0]));

    assert([
      'valo_ult_showstopper',
      'valo_ult_blade_storm',
      'valo_ult_cosmic_divide',
      'valo_ult_lockdown',
      'valo_ult_vipers_pit',
      'valo_ult_empress',
      'valo_ult_hunters_fury',
      'valo_ult_null_cmd',
      'valo_ult_run_it_back',
      'valo_ult_orbital_strike',
      'valo_ult_neural_theft',
    ].includes(selectedSkill ?? ''), `Valorant hook should select a tactical charged ult, got ${selectedSkill}`);
    assert(engine.fighters[0].ultPoints === 0, 'Valorant hook should reset ult points after selecting an ult');
    assert(logs.some((entry) => entry.text.includes('大招充能完毕')), 'Valorant hook should keep the original ult-ready log');
    assert(!logs.some((entry) => /valo_ult_/.test(entry.text)), 'Valorant ult-ready log should not leak internal skill ids');
    cases.push('Valorant skill-selection hook');
  }

  {
    const sigua = makeFighter('丝瓜uli@A');
    const enemy = makeFighter('宇宙分裂抵挡测试靶@B');
    applyTestStatus(enemy, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'morphling_linken_sphere' } });
    const { engine, logs } = makeDeathEngine([sigua, enemy]);

    engine.executeSkillAction('valo_ult_cosmic_divide', engine.fighters[0], engine.fighters[1]);

    assert(engine.fighters[0].statuses.some((status) => status.identityId === 'INVUL'), 'Enemy spell block should not prevent Valorant Cosmic Divide from protecting allies');
    assert(engine.fighters[1].statuses.some((status) => status.identityId === 'SPELL_BLOCK'), 'Cosmic Divide should not consume an unrelated enemy spell block');
    assert(!logs.some((entry) => entry.text.includes('挡下') && entry.text.includes('【宇宙分裂】')), 'Cosmic Divide should never be logged as blocked by an enemy defense');
    cases.push('enemy spell defense cannot block Valorant Cosmic Divide');
  }

  {
    const sigua = makeFighter('丝瓜uli@A');
    const ally = makeFighter('复活队友@A');
    const enemy = makeFighter('复活抵挡测试靶@B');
    ally.currentHp = 0;
    ally.hpPct = 0;
    ally.isDead = true;
    ally.isDeadAnnounced = true;
    applyTestStatus(enemy, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'morphling_linken_sphere' } });
    const { engine, logs } = makeDeathEngine([sigua, ally, enemy]);

    engine.executeSkillAction('valo_ult_resurrection', engine.fighters[0], engine.fighters[2]);

    assert(!engine.fighters[1].isDead && engine.fighters[1].currentHp === engine.fighters[1].maxHp, 'Enemy spell block should not prevent Valorant Resurrection from restoring an ally');
    assert(engine.fighters[2].statuses.some((status) => status.identityId === 'SPELL_BLOCK'), 'Resurrection should not consume an unrelated enemy spell block');
    assert(!logs.some((entry) => entry.text.includes('挡下') && entry.text.includes('【复活】')), 'Resurrection should never be logged as blocked by an enemy defense');
    cases.push('enemy spell defense cannot block Valorant Resurrection');
  }

  {
    const areaStatusUlts = [
      { id: 'valo_ult_lockdown', name: '全面封锁', status: 'STUN' },
      { id: 'valo_ult_vipers_pit', name: '蝰蛇神殿', status: 'POISON' },
      { id: 'valo_ult_null_cmd', name: '全面压制', status: 'SILENCE' },
      { id: 'valo_ult_neural_theft', name: '神经取缔', status: 'NEURAL_THEFT_DEBUFF' },
    ];

    areaStatusUlts.forEach(({ id, name, status }) => {
      const sigua = makeFighter('丝瓜uli@A');
      const blocked = makeFighter(`${name}抵挡目标@B`);
      const exposed = makeFighter(`${name}生效目标@C`);
      applyTestStatus(blocked, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'morphling_linken_sphere' } });
      const { engine, logs } = makeDeathEngine([sigua, blocked, exposed]);

      engine.executeSkillAction(id, engine.fighters[0], engine.fighters[1]);

      assert(!engine.fighters[1].statuses.some((entry) => entry.identityId === status), `${name} should not affect the target whose spell block consumed its own pulse`);
      assert(!engine.fighters[1].statuses.some((entry) => entry.identityId === 'SPELL_BLOCK'), `${name} should consume the protected target's spell block`);
      assert(engine.fighters[2].statuses.some((entry) => entry.identityId === status), `${name} should still affect an unprotected second target`);
      const outcomeLog = logs.find((entry) => entry.type === 'skill' && entry.text.includes(`【${name}】`));
      assert(outcomeLog?.text.includes(engine.fighters[2].name), `${name} outcome should name the target that was actually affected`);
      assert(!outcomeLog?.text.includes(engine.fighters[1].name), `${name} success summary must not claim the blocked target was affected`);
    });
    cases.push('Valorant area status ults settle spell blocks independently per target');
  }

  {
    const sigua = makeFighter('丝瓜uli@A');
    const { engine } = makeDeathEngine([sigua, makeFighter('选技旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    engine.fighters[0].ultPoints = 0;
    engine.fighters[0].economy = 5;

    const selectedSkill = withRandomSequence([0.9], () => engine.selectSkill(engine.fighters[0]));

    assert(selectedSkill === 'valo_operator_shot', `Valorant hook should buy Operator at 6 economy, got ${selectedSkill}`);
    assert(engine.fighters[0].statuses.some((status) => status.identityId === 'VALO_OPERATOR_PENALTY'), 'Valorant Operator stance should use its registered status identity');
    assert(getEffectiveCombatStat(engine.fighters[0], 'agl') >= 90 && getEffectiveCombatStat(engine.fighters[0], 'agl') < engine.fighters[0].agl, 'Valorant Operator stance should reduce but not zero calculated agility');
    cases.push('Valorant Operator stance projects its movement penalty through the status calculator');
  }

  {
    const sigua = makeFighter('丝瓜uli@A');
    const target = makeFighter('冥驹掉落测试目标@B');
    const { engine, logs } = makeDeathEngine([sigua, target]);
    const engineSigua = engine.fighters[0];
    engineSigua.job = 'VALO_JUNIOR';
    engineSigua.economy = 10;

    engine.handleValorantWeaponDrop(engineSigua, Math.floor(engineSigua.maxHp * 0.3));
    assert(engineSigua.economy === 10, 'heavy damage must not drop an Operator that was never equipped');
    assert(!logs.some((entry) => entry.text.includes('冥驹') && entry.text.includes('掉落')), 'unequipped Operator must not produce a drop log');

    const originalSpd = engineSigua.spd;
    const originalAgl = engineSigua.agl;
    applyTestStatus(engineSigua, { identityId: 'VALO_OPERATOR_PENALTY', remainingTurns: 1 });
    assert(getEffectiveCombatStat(engineSigua, 'spd') !== originalSpd || getEffectiveCombatStat(engineSigua, 'agl') !== originalAgl, 'equipped Operator should project a movement penalty');
    engine.handleValorantWeaponDrop(engineSigua, Math.floor(engineSigua.maxHp * 0.3));

    assert(Number(engineSigua.economy) === 5, 'an equipped Operator should still be lost after a qualifying heavy hit');
    assert(getEffectiveCombatStat(engineSigua, 'spd') === originalSpd && getEffectiveCombatStat(engineSigua, 'agl') === originalAgl, 'Operator drop should remove the calculated movement penalty');
    assert(logs.filter((entry) => entry.text.includes('冥驹') && entry.text.includes('掉落')).length === 1, 'only the genuinely equipped Operator should produce one drop log');
    cases.push('Valorant Operator drop requires a genuinely equipped weapon');
  }

  {
    const sigua = makeFighter('丝瓜uli@A');
    const allyA = makeFighter('等待队友甲@A');
    const allyB = makeFighter('等待队友乙@A');
    const emote = makeFighter('表情@B');
    const { engine, logs } = makeDeathEngine([sigua, allyA, allyB, emote]);
    const engineSigua = engine.fighters[0];
    const valoJob = localProject.jobs.VALO_JUNIOR;
    assert(valoJob, 'VALO_JUNIOR job should exist for no-target resource tests');
    engineSigua.job = 'VALO_JUNIOR';
    engineSigua.jobData = { ...valoJob, skills: [...(valoJob.skills ?? [])] };
    engineSigua.transformed = true;
    engineSigua.crosshairFocus = 8;
    engineSigua.ultPoints = 3;
    engineSigua.economy = 7;
    engineSigua.spd = 10000;
    engine.fighters[1].spd = 1;
    engine.fighters[2].spd = 1;

    withRandomSequence([0], () => {
      engine.markDefeated(engine.fighters[3], { message: '💀 【测试】表情进入认主倒计时。', killer: engineSigua });
    });
    engine.handleDeathsAndRevives({ current: false });
    const focusBeforeWait = engineSigua.crosshairFocus ?? 0;
    const ultBeforeWait = engineSigua.ultPoints ?? 0;
    const economyBeforeWait = engineSigua.economy ?? 0;
    withRandomSequence([0], () => {
      engine.step({ current: false });
    });

    assert(engineSigua.crosshairFocus === focusBeforeWait, `No-target wait must preserve Valorant focus, got ${engineSigua.crosshairFocus}`);
    assert(engineSigua.ultPoints === ultBeforeWait, `No-target wait must preserve Valorant ult points, got ${engineSigua.ultPoints}`);
    assert(engineSigua.economy === economyBeforeWait, `No-target wait must preserve Valorant economy, got ${engineSigua.economy}`);
    assert(logs.some((entry) => entry.text.includes('【等待目标】') && entry.text.includes(engineSigua.name)), 'No-target wait should explain why the actor did not act');
    assert(!logs.some((entry) => entry.text.includes('【准星专注】') && entry.text.includes('消耗')), 'No-target wait must not spend Valorant focus');
    cases.push('No-target wait preserves action resources before skill selection');
  }

  {
    const sigua = makeFighter('丝瓜uli@A');
    const target = makeFighter('吸血来源测试目标@B');
    const { engine, logs } = makeDeathEngine([sigua, target]);
    const engineSigua = engine.fighters[0];
    const valoJob = localProject.jobs.VALO_JUNIOR;
    assert(valoJob, 'VALO_JUNIOR job should exist for lifesteal source tests');
    engineSigua.job = 'VALO_JUNIOR';
    engineSigua.jobData = { ...valoJob, skills: [...(valoJob.skills ?? [])] };
    engineSigua.transformed = true;
    engineSigua.maxHp = 5000;
    localProject.setCurrentHp(engineSigua, 1000);
    engineSigua.atk = 1000;
    applyTestStatus(engineSigua, { identityId: 'VALO_ULT_EMPRESS', remainingTurns: 3 });
    applyTestStatus(engineSigua, { identityId: 'AIM', charges: 1 });
    engine.executeSkillAction('valo_vandal_shot', engineSigua, engine.fighters[1]);

    assert(logs.some((entry) => entry.text.includes('吸血被动（来源：【女皇神威】）')), 'Lifesteal log should name Empress as its source');
    cases.push('Lifesteal logs expose exact skill and status sources');
  }

  {
    const morphling = makeFighter('水人@A');
    const primary = makeFighter('洪水残血主目标@B');
    const secondary = makeFighter('洪水健康副目标@B');
    morphling.mag = 300;
    morphling.agl = 10000;
    applyTestStatus(morphling, { identityId: 'AIM', charges: 1 });
    primary.maxHp = 1000;
    localProject.setCurrentHp(primary, 1);
    secondary.maxHp = 5000;
    secondary.res = 0;
    localProject.setCurrentHp(secondary, 5000);
    const { engine } = makeDeathEngine([morphling, primary, secondary]);

    withRandomSequence([0.5, 0.5, 0.5, 0.5], () => {
      engine.executeSkillAction('apocalyptic_flood', engine.fighters[0], engine.fighters[1]);
    });

    assert(engine.fighters[1].stats.dmgTaken === 1, 'the low-HP flood primary should only lose its remaining one HP');
    assert(engine.fighters[2].stats.dmgTaken > 100, `flood secondary damage must use planned damage rather than the primary's capped HP loss, got ${engine.fighters[2].stats.dmgTaken}`);
    cases.push('Apocalyptic Flood secondary damage is independent of primary overkill capping');
  }

  {
    const morphling = makeFighter('水人@A');
    const primary = makeFighter('洪水真伤主目标@B');
    const gacha = makeFighter('牢鳄@B');
    morphling.mag = 300;
    morphling.agl = 10000;
    applyTestStatus(morphling, { identityId: 'AIM', charges: 1 });
    primary.maxHp = 100000;
    localProject.setCurrentHp(primary, 100000);
    gacha.maxHp = 100000;
    localProject.setCurrentHp(gacha, 100000);
    forceLuckEmperor(gacha);
    const { engine, logs } = makeDeathEngine([morphling, primary, gacha]);

    withRandomSequence([0.5, 0.5, 0.5, 0.5], () => {
      engine.executeSkillAction('apocalyptic_flood', engine.fighters[0], engine.fighters[1]);
    });

    assert(
      engine.fighters[2].stats.dmgTaken === engine.fighters[1].stats.dmgTaken,
      `Apocalyptic Flood secondary true damage must ignore Luck Emperor mitigation; primary took ${engine.fighters[1].stats.dmgTaken}, secondary took ${engine.fighters[2].stats.dmgTaken}`,
    );
    assert(
      !logs.some((entry) => entry.text.includes('【欧皇命格】') && entry.targetIds?.includes(engine.fighters[2].id)),
      'Luck Emperor mitigation must not trigger for Apocalyptic Flood secondary true damage',
    );
    cases.push('Apocalyptic Flood secondary hits retain true-damage semantics');
  }

  {
    const sigua = makeFighter('丝瓜uli@A');
    const wounded = makeFighter('瓦学妹残局目标@B');
    const healthy = makeFighter('瓦学妹随机干扰目标@C');
    const { engine } = makeDeathEngine([sigua, wounded, healthy]);
    engine.fighters[0].job = 'VALO_JUNIOR';
    engine.fighters[0].crosshairFocus = 9;
    localProject.setCurrentHp(engine.fighters[1], Math.floor(engine.fighters[1].maxHp * 0.2));

    const resolved = withRandomSequence([0.99], () =>
      engine.resolveTarget(engine.fighters[0], null, engine.getSelectableTargets(engine.fighters[0])),
    );

    assert(resolved?.target.id === engine.fighters[1].id, 'Valorant execute and headshot decisions should resolve against the wounded enemy that triggered them');
    cases.push('Valorant tactical skill selection and action targeting stay aligned');
  }

  {
    const sigua = makeFighter('丝瓜uli@A');
    const { engine } = makeDeathEngine([sigua, makeFighter('选技旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    engine.fighters[0].hasSpinalSword = true;

    const selectedSkill = withRandomSequence([0.4, 0.9], () => engine.selectSkill(engine.fighters[0]));

    assert(selectedSkill === 'spinal_slash', `Non-gacha spinal sword route should select spinal_slash, got ${selectedSkill}`);
    cases.push('Non-gacha spinal sword route selection');
  }

  {
    const sigua = makeFighter('丝瓜uli@A');
    const { engine } = makeDeathEngine([sigua, makeFighter('选技旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    engine.fighters[0].hasSpinalSword = true;
    engine.fighters[0].ultPoints = 4;
    engine.fighters[0].economy = 0;

    const selectedSkill = withRandomSequence([0.6, 0], () => engine.selectSkill(engine.fighters[0]));

    assert([
      'valo_ult_showstopper',
      'valo_ult_blade_storm',
      'valo_ult_cosmic_divide',
      'valo_ult_lockdown',
      'valo_ult_vipers_pit',
      'valo_ult_empress',
      'valo_ult_hunters_fury',
      'valo_ult_null_cmd',
      'valo_ult_run_it_back',
      'valo_ult_orbital_strike',
      'valo_ult_neural_theft',
    ].includes(selectedSkill ?? ''), `Non-gacha own-skill route should keep tactical Valorant skill selection, got ${selectedSkill}`);
    cases.push('Non-gacha own-skill route selection');
  }

  {
    const fighter = makeFighter('脊髓剑测试者@A');
    const { engine } = makeDeathEngine([fighter, makeFighter('选技旁观者@B')]);
    engine.fighters[0].hasSpinalSword = true;

    const selectedSkill = withRandomSequence([0.01, 0.01], () => engine.selectSkill(engine.fighters[0]));

    assert(selectedSkill === 'blood_mist', `Spinal sword mechanic should select blood_mist, got ${selectedSkill}`);
    cases.push('Spinal sword blood-mist selection mechanic');
  }

  {
    const ting = makeFighter('小汀@A');
    const { engine } = makeDeathEngine([ting, makeFighter('血雾旁观者@B')]);
    const bloodMistCondition = engine.SKILLS.blood_mist?.condition;

    assert(bloodMistCondition && !bloodMistCondition(engine.fighters[0]), 'blood_mist should be unavailable before Ting has a spinal sword');
    engine.fighters[0].hasSpinalSword = true;
    assert(bloodMistCondition(engine.fighters[0]), 'blood_mist should become available when Ting has a spinal sword');
    cases.push('Ting blood mist requires spinal sword');
  }

  {
    const ting = makeFighter('小汀@A');
    const attacker = makeFighter('不甘倒下攻击者@B');
    const { engine, logs } = makeDeathEngine([ting, attacker]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);

    const hpBeforeDefiance = engine.fighters[0].currentHp;
    const firstActual = engine.applyDamage(engine.fighters[0], hpBeforeDefiance + 1000, 'test', true);
    assert(engine.fighters[0].currentHp === 1, 'Ting defiance should clamp the first lethal hit to 1 HP');
    assert(firstActual === hpBeforeDefiance - 1, 'Ting defiance should return the net HP loss after preserving 1 HP');
    assert(engine.fighters[0].statuses.some((status) => status.identityId === 'TING_DEFIANCE'), 'Ting defiance should add a timed status');

    engine.turnCount = 1;
    engine.finishStep({ current: false });
    const repeatedActual = engine.applyDamage(engine.fighters[0], 1000, 'test', true);
    assert(engine.fighters[0].currentHp === 1, 'Ting defiance should keep clamping lethal hits while active');
    assert(repeatedActual === 0, 'Ting defiance should report zero actual damage while already locked at 1 HP');
    assert(engine.fighters[0].statuses.some((status) => status.identityId === 'TING_DEFIANCE'), 'early battle-clock ticks should not expire Ting defiance');

    for (let turn = 2; turn <= 10; turn += 1) {
      engine.turnCount = turn;
      engine.finishStep({ current: false });
    }
    assert(!engine.fighters[0].statuses.some((status) => status.identityId === 'TING_DEFIANCE'), 'Ting defiance should expire on the extended battle status clock');
    assert(logs.some((entry) => entry.text.includes('不甘倒下') && entry.text.includes('怨念耗尽')), 'Ting defiance expiry should be visible in the combat log');
    engine.applyDamage(engine.fighters[0], 1000, 'test', true);
    assert(engine.fighters[0].currentHp <= 0, 'expired Ting defiance should allow lethal damage to defeat Ting');
    assert(logs.some((entry) => entry.text.includes('不甘倒下')), 'Ting defiance should keep its combat log');
    cases.push('Ting defiance expires on extended battle clock');
  }

  {
    const ting = makeFighter('小汀@A');
    const rabbit = makeFighter('兔卷卷@B');
    const { engine, logs } = makeDeathEngine([ting, rabbit]);
    applyTestStatus(engine.fighters[0], { identityId: 'TING_DEFIANCE', remainingTurns: 9 });

    engine.executeSkillAction('v_rabbit_zero', engine.fighters[1], engine.fighters[0]);

    assert(engine.fighters[0].statuses.some((status) => status.identityId === 'TING_DEFIANCE'), 'Rabbit strong dispel must preserve independent Ting defiance');
    assert(!logs.some((entry) => entry.text.includes('归零') && entry.text.includes('剥离') && entry.text.includes('不甘倒下')), 'Rabbit zero must not claim that it stripped an independent death-save');
    cases.push('Rabbit zero preserves independent Ting defiance');
  }

  {
    const morphling = makeFighter('水人@A');
    const target = makeFighter('否决目标@B');
    const { engine, logs } = makeDeathEngine([morphling, target]);
    applyTestStatus(engine.fighters[1], { identityId: 'SPELL_BLOCK', charges: 2, attribution: { effectSourceId: 'morphling_linken_sphere' } });
    applyTestStatus(engine.fighters[1], { identityId: 'INVUL', remainingTurns: 1, attribution: { effectSourceId: 'rabbit_slide' } });
    applyTestStatus(engine.fighters[1], { identityId: 'TING_DEFIANCE', remainingTurns: 4 });
    applyTestStatus(engine.fighters[1], { identityId: 'TOKUSATSU_DEFIANCE', remainingTurns: 2 });
    applyTestStatus(engine.fighters[1], { identityId: 'WAIT_COUNTER', charges: 2 });
    engine.fighters[1].tokusatsuInstantActionQueued = true;

    engine.executeSkillAction('nullifier', engine.fighters[0], engine.fighters[1]);

    assert(!engine.fighters[1].statuses.some((status) => ['SPELL_BLOCK', 'INVUL', 'TING_DEFIANCE', 'TOKUSATSU_DEFIANCE', 'WAIT_COUNTER'].includes(status.identityId)), 'Nullifier should strip important defensive statuses before resolution');
    assert(!engine.fighters[1].tokusatsuInstantActionQueued, 'Nullifier should cancel queued Tokusatsu defiance counter action');
    const nullifierCastIndex = logs.findIndex((entry) => entry.text.includes('抛出否决挂件'));
    const nullifierStripIndex = logs.findIndex((entry) => entry.text.includes('万法归无') && entry.text.includes('剥夺') && entry.text.includes('林肯法球') && entry.text.includes('兔兔滑铲') && entry.text.includes('不甘倒下') && entry.text.includes('悲愿不倒') && entry.text.includes('坐椅子'));
    assert(nullifierCastIndex >= 0 && nullifierStripIndex > nullifierCastIndex, 'Nullifier should explicitly log stripped defensive and counter statuses after the cast log');
    cases.push('Nullifier logs stripped defensive statuses');
  }

  {
    const morphling = makeFighter('水人@A');
    const tokusatsu = makeFighter('刺猬人@B');
    applyTestStatus(morphling, { identityId: 'AIM', charges: 1 });
    const { engine, logs } = makeDeathEngine([morphling, tokusatsu]);
    applyTestStatus(engine.fighters[1], { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'tokusatsu_defiance' } });
    applyTestStatus(engine.fighters[1], { identityId: 'TOKUSATSU_DEFIANCE', remainingTurns: 2 });

    engine.executeSkillAction('cosmic_slap', engine.fighters[0], engine.fighters[1]);

    assert(logs.some((entry) => entry.text.includes('强行捏碎') && entry.text.includes('悲愿抗性护层')), 'Cosmic slap should name the broken Tokusatsu defense layer');
    assert(!logs.some((entry) => entry.text.includes('强行捏碎') && entry.text.includes('的悲愿不倒')), 'Cosmic slap should not imply it broke active Tokusatsu defiance itself');
    assert(engine.fighters[1].statuses.some((status) => status.identityId === 'TOKUSATSU_DEFIANCE'), 'Breaking the defense layer should leave active Tokusatsu defiance intact');
    cases.push('Cosmic slap labels Tokusatsu defense layer precisely');
  }

  {
    const fighter = makeFighter('脊髓剑召唤测试者@A');
    const { engine } = makeDeathEngine([fighter, makeFighter('选技旁观者@B')]);
    engine.fighters[0].hasSpinalSword = true;
    engine.fighters[0].jobData.skills.push('summon_puppet_ting');

    const selectedSkill = withRandomSequence([0.01, 0.9, 0.01], () => engine.selectSkill(engine.fighters[0]));

    assert(selectedSkill === 'summon_puppet_ting', `Spinal sword mechanic should select summon_puppet_ting, got ${selectedSkill}`);
    cases.push('Spinal sword puppet selection mechanic');
  }

  {
    const fighter = makeFighter('脊髓剑普通测试者@A');
    const { engine } = makeDeathEngine([fighter, makeFighter('选技旁观者@B')]);
    engine.fighters[0].hasSpinalSword = true;

    const selectedSkill = withRandomSequence([0.6, 0.99], () => engine.selectSkill(engine.fighters[0]));

    assert(selectedSkill === null, `Own-skill route without a selected skill should not fall back to spinal_slash, got ${selectedSkill}`);
    cases.push('Non-gacha own-skill route no implicit sword fallback');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const { engine } = makeDeathEngine([gacha, makeFighter('选技旁观者@B')]);
    engine.fighters[0].hasSpinalSword = true;

    const selectedSkill = withRandomSequence([0.9, 0.9, 0.99], () => engine.selectSkill(engine.fighters[0]));

    assert(selectedSkill === 'spinal_slash', `Gacha spinal sword exception should keep spinal_slash fallback, got ${selectedSkill}`);
    cases.push('Gacha spinal sword exception fallback');
  }

  {
    const succubus = makeFighter('克蕾儿丝菲尔@A');
    const { engine } = makeDeathEngine([succubus, makeFighter('选技旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);

    const selectedSkill = withRandomSequence([0.69], () => engine.selectSkill(engine.fighters[0]));

    assert(selectedSkill === 'chimera_install', `Succubus hook should select chimera_install, got ${selectedSkill}`);
    cases.push('Succubus install skill-selection hook');
  }

  {
    const succubus = makeFighter('克蕾儿丝菲尔@A');
    const { engine } = makeDeathEngine([succubus, makeFighter('选技旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    engine.fighters[0].jobData.skills.push('chimera_devour');

    const selectedSkill = withRandomSequence([0.9, 0.5, 0], () => engine.selectSkill(engine.fighters[0]));

    assert(selectedSkill === 'chimera_devour', `Succubus hook should select an installed chimera plugin, got ${selectedSkill}`);
    cases.push('Succubus plugin skill-selection hook');
  }

  {
    const emote = makeFighter('表情@A');

    assert(emote.job === 'EMOTE_MAHORAGA', `Emote should map to EMOTE_MAHORAGA, got ${emote.job}`);
    assert(emote.jobData.name === '四处认主型魔虚罗', `Emote job display name mismatch: ${emote.jobData.name}`);
    assert(emote.maxHp === 1 && emote.currentHp === 1, `Emote initial HP should be 1/1, got ${emote.currentHp}/${emote.maxHp}`);
    STAT_KEYS.forEach((key) => {
      assert(emote[key] === 1, `Emote initial ${key} should be 1, got ${emote[key]}`);
    });
    cases.push('Emote factory minimum stats');
  }

  {
    const killer = makeFighter('表情击杀者@K');
    const owner = makeFighter('临时主人@O');
    const anchorA = makeFighter('零杀锚点甲@A');
    const anchorB = makeFighter('零杀锚点乙@B');
    const emote = makeFighter('表情@E');
    killer.atk = 100;
    killer.def = 80;
    killer.spd = 60;
    killer.agl = 40;
    killer.mag = 120;
    killer.res = 90;
    killer.wis = 70;
    killer.maxHp = 1000;
    localProject.setCurrentHp(killer, 1000);
    owner.stats.kills = 3;
    const killerAtkBefore = killer.atk;
    const killerMaxHpBefore = killer.maxHp;
    const { engine, logs } = makeDeathEngine([killer, owner, anchorA, anchorB, emote]);
    const ownerAtkBefore = getEffectiveCombatStat(engine.fighters[1], 'atk');
    const ownerMaxHpBefore = engine.fighters[1].maxHp;

    withRandomSequence([0.3], () => {
      engine.markDefeated(engine.fighters[4], { message: '💀 【测试】表情被击倒。', killer: engine.fighters[0] });
    });

    const engineOwner = engine.fighters[1];
    const engineEmote = engine.fighters[4];
    assert(engine.fighters[0].stats.kills === 1, `Killer should receive the kill before emote owner clearing, got ${engine.fighters[0].stats.kills}`);
    assert(engine.fighters[0].atk === killerAtkBefore, 'Emote adaptation should not reduce killer stats');
    assert(engine.fighters[0].maxHp === killerMaxHpBefore, 'Emote adaptation should not reduce killer HP');
    assert(engineEmote.atk === 7, `Emote should copy 6 atk from killer, got ${engineEmote.atk}`);
    assert(engineEmote.maxHp === 63, `Emote should copy 62 max HP from killer, got ${engineEmote.maxHp}`);
    assert((engineEmote.emoteAdaptStats?.atk ?? 0) === 6, `Emote adapt atk should record 6, got ${engineEmote.emoteAdaptStats?.atk}`);
    assert((engineEmote.emoteAdaptStats?.maxHp ?? 0) === 62, `Emote adapt maxHp should record 62, got ${engineEmote.emoteAdaptStats?.maxHp}`);
    assert(engineOwner.stats.kills === 3, `Owner true kill statistics should remain authoritative, got ${engineOwner.stats.kills}`);
    assert(engineOwner.emoteClaimedKills === 3, `Owner recognition ledger should consume all 3 claimable kills, got ${engineOwner.emoteClaimedKills}`);
    assert(getEffectiveCombatStat(engineOwner, 'atk') === ownerAtkBefore + 6, `Owner should receive this death's atk bonus, got ${getEffectiveCombatStat(engineOwner, 'atk')}`);
    assert(engineOwner.maxHp === ownerMaxHpBefore + 62, `Owner should receive this death's max HP bonus, got ${engineOwner.maxHp}`);
    assert(logs.some((entry) => entry.text.includes('属性和生命不会降低')), 'Emote death log should clarify copied stats and HP do not reduce source');
    assert(logs.some((entry) => entry.text.includes('本次击杀者 6.25% 生命与属性')), 'Owner bonus log should say the bonus comes from this death only');

    for (let i = 0; i < 5; i += 1) {
      engine.turnCount += 1;
      engine.finishStep({ current: false });
    }

    assert(!engineEmote.isDead, 'Emote should revive while zero-kill anchors exist and more than two players are alive');
    assert(getEffectiveCombatStat(engineOwner, 'atk') === ownerAtkBefore, `Owner temporary bonus should be removed after emote revive, got ${getEffectiveCombatStat(engineOwner, 'atk')}`);
    assert(engineOwner.maxHp === ownerMaxHpBefore, `Owner temporary HP bonus should be removed after emote revive, got ${engineOwner.maxHp}`);
    assert(engineEmote.atk === 7, `Emote permanent adaptation should remain after revive, got ${engineEmote.atk}`);
    assert(engineEmote.currentHp === Math.floor(engineEmote.maxHp * 0.82) && engineEmote.maxHp === 63, `Emote should revive to 82% copied max HP, got ${engineEmote.currentHp}/${engineEmote.maxHp}`);
    assert(!logs.some((entry) => entry.text.includes('【绝对驱散】') && entry.text.includes(engineEmote.name)), 'Emote revival cleanup must not impersonate Waterman absolute dispel');
    engine.fighters[0].atk = 200;
    engine.fighters[0].maxHp = 500;
    localProject.setCurrentHp(engine.fighters[0], 500);
    const secondOwnerLogStart = logs.length;
    withRandomSequence([0.3], () => {
      engine.markDefeated(engine.fighters[4], { message: '💀 【测试】表情第二次被击倒。', killer: engine.fighters[0] });
    });
    const secondOwnerLogs = logs.slice(secondOwnerLogStart).map((entry) => entry.text);
    assert(secondOwnerLogs.some((text) => text.includes('认主账本余额本已为 0') && text.includes('继续作为复活锚点')), 'Repeated zero-ledger recognition should explain that the reusable anchor remains active');
    assert(!secondOwnerLogs.some((text) => text.includes('认主账本余额 0 -> 0')), 'Repeated zero-ledger recognition should not use a misleading no-op counter');
    assert(getEffectiveCombatStat(engineOwner, 'atk') === ownerAtkBefore + 12, `Owner second bonus should use only the second killer slice, got ${getEffectiveCombatStat(engineOwner, 'atk')}`);
    assert(engineOwner.maxHp === ownerMaxHpBefore + 31, `Owner second HP bonus should use only the second killer slice, got ${engineOwner.maxHp}`);

    for (let i = 0; i < 5; i += 1) {
      engine.turnCount += 1;
      engine.finishStep({ current: false });
    }

    assert(!engineEmote.isDead, 'Emote should be allowed to revive again from the same surviving zero-kill anchors');
    assert(getEffectiveCombatStat(engineOwner, 'atk') === ownerAtkBefore, `Owner second temporary bonus should be removed after emote revives again, got ${getEffectiveCombatStat(engineOwner, 'atk')}`);
    assert(engineOwner.maxHp === ownerMaxHpBefore, `Owner second temporary HP bonus should be removed after emote revives again, got ${engineOwner.maxHp}`);
    cases.push('Emote death adaptation owner bonus and reusable zero-kill anchors');
  }

  {
    const attacker = makeFighter('适应攻击者@A');
    const emote = makeFighter('表情@E');
    attacker.atk = 200;
    attacker.def = 100;
    attacker.spd = 90;
    attacker.agl = 80;
    attacker.mag = 70;
    attacker.res = 60;
    attacker.wis = 50;
    emote.maxHp = 500;
    localProject.setCurrentHp(emote, 500);
    applyTestStatus(emote, { identityId: 'EMOTE_ADAPT', remainingTurns: 2 });
    const { engine, logs } = makeDeathEngine([attacker, emote]);

    const actual = engine.applyDamage(engine.fighters[1], 100, 'skill', false, engine.fighters[0], { actionName: '适应测试' });

    assert(actual === 70, `Emote adaptation should reduce 100 damage to 70, got ${actual}`);
    assert(!engine.fighters[1].statuses.some((status) => status.identityId === 'EMOTE_ADAPT'), 'Emote adaptation status should be consumed after triggering');
    assert((engine.fighters[1].emoteAdaptStats?.atk ?? 0) === 6, `Emote should copy 3% atk from attacker, got ${engine.fighters[1].emoteAdaptStats?.atk}`);
    assert(engine.fighters[0].atk === 200, 'Emote adaptation should not reduce attacker stats');
    assert(logs.some((entry) => entry.text.includes('适应转轮') && entry.text.includes('属性不降低')), 'Adaptation trigger log should clarify source stats are not reduced');
    cases.push('Emote adaptation wheel copies without reducing attacker');
  }

  {
    const killer = makeFighter('终局击杀者@K');
    const owner = makeFighter('终局主人@O');
    const emote = makeFighter('表情@E');
    const { engine, logs } = makeDeathEngine([killer, owner, emote]);

    withRandomSequence([0], () => {
      engine.markDefeated(engine.fighters[2], { message: '💀 【测试】表情终局倒下。', killer: engine.fighters[0] });
    });
    engine.handleDeathsAndRevives({ current: false });

    assert(!engine.fighters[2].isDead, 'Emote should use its one final owner challenge when two players and a zero-kill anchor remain');
    assert(engine.fighters[2].emoteFinalChallengeUsed, 'Emote final owner challenge should be marked as used');
    assert(logs.some((entry) => entry.text.includes('最终认主挑战')), 'Emote should log the final owner challenge');

    const secondDeathLogStart = logs.length;
    withRandomSequence([0], () => {
      engine.markDefeated(engine.fighters[2], { message: '💀 【测试】表情终局第二次倒下。', killer: engine.fighters[0] });
    });
    engine.handleDeathsAndRevives({ current: false });

    assert(engine.fighters[2].emoteFinalDead, 'Emote should truly die in two-player endgame after final challenge is used');
    assert(logs.some((entry) => entry.text.includes('场上只剩 2 名玩家')), 'Emote true-death log should explain the low-player condition');
    const secondDeathLogs = logs.slice(secondDeathLogStart);
    assert(!secondDeathLogs.some((entry) => entry.text.includes('【认主倒计时】')), 'Emote must not announce a three-tick revival after its final challenge is already spent');
    assert(!secondDeathLogs.some((entry) => entry.text.includes('【四处认主】')), 'Emote must not create a temporary owner immediately before unavoidable true death');
    cases.push('Emote final owner challenge then true death in two-player endgame');
  }

  {
    const wt = makeFighter('M1A2_abrams_sep@A');
    const anchor = makeFighter('最终认主零杀锚点@B');
    const emote = makeFighter('表情@E');
    const { engine, logs } = makeDeathEngine([wt, anchor, emote]);
    const engineWt = engine.fighters[0];
    localProject.setCurrentHp(engineWt, Math.floor(engineWt.maxHp * 0.4));
    engine.handleTransformations(engineWt);
    engineWt.atk = 10000;
    applyTestStatus(engineWt, { identityId: 'AIM', charges: 1 });
    engine.fighters[2].maxHp = 100;
    localProject.setCurrentHp(engine.fighters[2], 100);

    engine.executeSkillAction('wt_t58_knockup', engineWt, engine.fighters[2]);

    const revivedEmote = engine.fighters[2];
    assert(revivedEmote.emoteFinalChallengeUsed && !revivedEmote.isDead, 'Lethal T-58 hit should allow Emote to consume its final owner challenge');
    assert(!revivedEmote.statuses.some((status) => ['AIRBORNE', 'WT_AMMO_EXPOSED'].includes(status.identityId)), 'An old T-58 hit must not attach post-hit module effects to Emote after revival');
    const challengeIndex = logs.findIndex((entry) => entry.text.includes('【最终认主挑战】'));
    assert(challengeIndex >= 0, 'T-58 Emote regression should trigger the final owner challenge');
    assert(!logs.slice(challengeIndex + 1).some((entry) => entry.text.includes('弹药架暴露') && entry.text.includes('表情')), 'T-58 must not expose the ammo rack of Emote\'s newly revived body');
    cases.push('post-hit effects cannot follow Emote across a defeat-revive boundary');
  }

  {
    const attacker = makeFighter('致死结算测试者@A');
    const emote = makeFighter('表情@B');
    attacker.atk = 10000;
    applyTestStatus(attacker, { identityId: 'AIM', charges: 1 });
    emote.maxHp = 100;
    localProject.setCurrentHp(emote, 50);
    applyTestStatus(emote, { identityId: 'EMOTE_ADAPT', remainingTurns: 2 });
    const { engine, logs } = makeDeathEngine([attacker, emote]);

    withRandomSequence([0.5, 0.5, 0.5], () => {
      engine.executeSkillAction('rider_kick', engine.fighters[0], engine.fighters[1]);
    });

    const settlementIndex = logs.findIndex((entry) => entry.text.includes('📌 实际结算：表情'));
    const adaptIndex = logs.findIndex((entry) => entry.text.includes('【适应转轮】') && entry.text.includes('记录'));
    const deathIndex = logs.findIndex((entry) => entry.type === 'death' && entry.text.includes('表情'));
    assert(settlementIndex >= 0, 'A mitigated lethal hit should still report its actual HP settlement');
    assert(adaptIndex >= 0 && settlementIndex > adaptIndex, 'Adaptation mitigation should be explained before the final HP settlement');
    assert(deathIndex > settlementIndex, 'Lethal hit death should be announced after final settlement');
    cases.push('mitigated lethal hit logs mitigation before settlement and death');
  }

  {
    const emote = makeFighter('表情@A');
    const tokusatsu = makeFighter('刺猬人@B');
    const anchor = makeFighter('旁观锚点@C');
    applyTestStatus(tokusatsu, { identityId: 'WAIT_COUNTER', charges: 3 });
    const { engine, logs } = makeDeathEngine([emote, tokusatsu, anchor]);

    engine.executeSkillAction('emote_tenth_claim', engine.fighters[0], engine.fighters[1]);

    assert(logs.some((entry) => entry.text.includes('攻势被 刺猬人 的怪兽形态打断')), 'Emote custom skill should respect Tokusatsu wait-counter interruption');
    assert(!logs.some((entry) => entry.text.includes('【十分之一索赔】表情') && entry.text.includes('实际造成')), 'Interrupted emote skill should not log landed damage after being stopped');
    cases.push('Emote custom skill stops on wait-counter interruption');
  }

  {
    const soloWeapon = withRandomSequence([0.45], () => drawYuzuWeapon(false).id);
    assert(soloWeapon !== 'shield', `Yuzu should not draw shield without teammates, got ${soloWeapon}`);
    const teamForcedShield = withRandomSequence([0.1], () => drawYuzuWeapon(true).id);
    assert(teamForcedShield === 'shield', `Yuzu should force shield under teammate shield roll, got ${teamForcedShield}`);
    const teamFallbackWeapon = withRandomSequence([0.9, 0.45], () => drawYuzuWeapon(true).id);
    assert(teamFallbackWeapon !== 'shield', `Yuzu fallback weapon pool should exclude shield after failed teammate shield roll, got ${teamFallbackWeapon}`);
    cases.push('Yuzu shield weapon requires active teammate roll');
  }

  {
    const yuzu = makeFighter('柚子@A');
    const ally = makeFighter('柚子队友@A');
    const enemy = makeFighter('柚子敌人@B');
    const { engine, logs } = makeDeathEngine([yuzu, ally, enemy]);

    assert(engine.fighters[0].job === 'YUZU_MIRROR_PARENT', `Yuzu should map to YUZU_MIRROR_PARENT, got ${engine.fighters[0].job}`);
    assert(engine.fighters[0].jobData.name === '镜世界的食指父辈', `Yuzu job display name mismatch: ${engine.fighters[0].jobData.name}`);
    assert(engine.fighters[0].isYuzu, 'Yuzu flag should be set');
    assert(getBarrierTotal(engine.fighters[0]) > 0, 'Yuzu should receive opening mirror shield');
    assert(getBarrierTotal(engine.fighters[1]) > 0, 'Yuzu teammate should receive opening mirror shield');
    assert(logs.some((entry) => entry.text.includes('镜界开幕')), 'Yuzu opening shield should be logged');
    cases.push('Yuzu factory and opening shield');
  }

  {
    const joker = makeFighter('屑@A');
    const yuzu = makeFighter('柚子@B');
    applyTestStatus(joker, { identityId: 'AIM', charges: 1 });
    const { engine, logs } = makeDeathEngine([joker, yuzu]);

    withRandomSequence([0.5, 0.5], () => {
      engine.executeSkillAction('cheesy_charm', engine.fighters[0], engine.fighters[1]);
    });

    assert(engine.fighters[1].currentHp === engine.fighters[1].maxHp, 'Yuzu opening shield should absorb the low-damage charm hit without HP loss');
    assert(!engine.fighters[1].statuses.some((status) => status.identityId === 'CHARMED'), 'A target status must not land when the shield absorbs all HP damage');
    assert(logs.some((entry) => entry.text.includes('状态结算') && entry.text.includes('【魅惑】未生效')), 'Shielded target-status skills should explicitly log that the status did not land');
    cases.push('fully shielded standard attacks explain failed target statuses');
  }

  {
    const yuzu = makeFighter('柚子@A');
    const tokusatsu = makeFighter('刺猬人@B');
    const monsterJob = localProject.jobs.MIRACLE_MONSTER_BUJIN;
    assert(monsterJob, 'MIRACLE_MONSTER_BUJIN job should exist for Yuzu death-save ordering tests');
    tokusatsu.job = 'MIRACLE_MONSTER_BUJIN';
    tokusatsu.jobData = JSON.parse(JSON.stringify(monsterJob)) as typeof monsterJob;
    tokusatsu.isTokusatsu = true;
    tokusatsu.transformed = true;
    tokusatsu.maxHp = 1000;
    localProject.setCurrentHp(tokusatsu, 20);
    yuzu.atk = 10000;
    const { engine, logs } = makeDeathEngine([yuzu, tokusatsu]);

    withRandomSequence([0.15, 0.5, 0, 0.5], () => {
      engine.executeSkillAction('yuzu_hammer_crush', engine.fighters[0], engine.fighters[1]);
    });

    const hitIndex = logs.findIndex((entry) => entry.text.includes('第 1/2 击抽到 刀'));
    const bleedIndex = logs.findIndex((entry) => entry.text.includes('【刀】') && entry.text.includes('流血'));
    const defianceIndex = logs.findIndex((entry) => entry.text.includes('【悲愿不倒】') && entry.text.includes('清除异常'));
    assert(hitIndex >= 0 && defianceIndex > hitIndex, 'Tokusatsu death-save should resolve after the lethal Yuzu hit is reported');
    assert(bleedIndex < 0, 'A lethal Yuzu hit must not report a bleed that its cleansing death-save suppresses');
    assert(!engine.fighters[1].statuses.some((status) => status.identityId === 'BLEED'), 'Tokusatsu death-save cleanse should remove the lethal Yuzu hit bleed');
    cases.push('cleansing death-save suppresses lethal hit on-hit debuffs');
  }

  {
    const yuzu = makeFighter('柚子@A');
    const ting = makeFighter('小汀@B');
    yuzu.atk = 10000;
    ting.maxHp = 1000;
    localProject.setCurrentHp(ting, 100);
    const { engine, logs } = makeDeathEngine([yuzu, ting]);

    withRandomSequence([0.15, 0.5, 0, 0.5], () => {
      engine.executeSkillAction('yuzu_hammer_crush', engine.fighters[0], engine.fighters[1]);
    });

    const firstHitIndex = logs.findIndex((entry) => entry.text.includes('第 1/2 击抽到 刀'));
    const lockIndex = logs.findIndex((entry) => entry.text.includes('锁血保护'));
    const transformIndex = logs.findIndex((entry) => entry.text.includes('怨气爆发') && entry.text.includes('怨念恶灵'));
    const bleedIndex = logs.findIndex((entry) => entry.text.includes('【刀】') && entry.text.includes('流血'));
    assert(firstHitIndex >= 0, 'Yuzu transform-order regression should log the first knife hit');
    assert(lockIndex > firstHitIndex, 'Yuzu phase-lock reaction should follow the hit that caused it');
    assert(transformIndex > lockIndex, 'Yuzu-triggered phase transformation should follow its lock-blood reaction');
    assert(bleedIndex > transformIndex, 'Yuzu weapon debuff should only apply after the target completes its phase transformation');
    cases.push('Yuzu hit logs phase lock and transform before weapon debuff');
  }

  {
    const yuzu = makeFighter('柚子@A');
    const target = makeFighter('镜界致死测试目标@B');
    yuzu.atk = 10000;
    target.maxHp = 20;
    target.def = 0;
    localProject.setCurrentHp(target, 20);
    const { engine, logs } = makeDeathEngine([yuzu, target]);

    withRandomSequence([0.15, 0.5, 0, 0.5], () => {
      engine.executeSkillAction('yuzu_hammer_crush', engine.fighters[0], engine.fighters[1]);
    });

    const hitIndex = logs.findIndex((entry) => entry.text.includes('第 1/2 击抽到 刀'));
    const deathIndex = logs.findIndex((entry) => entry.type === 'death' && entry.text.includes('镜界致死测试目标'));
    assert(hitIndex >= 0 && deathIndex > hitIndex, 'Yuzu lethal weapon hit should be reported before its death settlement');
    assert(!logs.some((entry) => entry.text.includes('【刀】镜界致死测试目标') && entry.text.includes('流血')), 'Yuzu lethal weapon hit must not apply a debuff to an already defeated target');
    assert(!engine.fighters[1].statuses.some((status) => status.identityId === 'BLEED'), 'Yuzu lethal weapon hit must leave no bleed on the defeated target');
    cases.push('Yuzu lethal weapon hit does not debuff defeated target');
  }

  {
    const yuzu = makeFighter('柚子@A');
    const ting = makeFighter('小汀@B');
    yuzu.atk = 10000;
    ting.maxHp = 1000;
    localProject.setCurrentHp(ting, 1);
    const { engine, logs } = makeDeathEngine([yuzu, ting]);

    withRandomSequence([0.15, 0.5, 0, 0.5], () => {
      engine.executeSkillAction('yuzu_hammer_crush', engine.fighters[0], engine.fighters[1]);
    });

    assert(engine.fighters[1].transformed, 'A zero-HP-damage phase-lock hit should still complete Ting phase transformation');
    const protectedHitIndex = logs.findIndex((entry) => entry.text.includes('第 1/2 击') && entry.text.includes('阶段锁血保护'));
    const lockIndex = logs.findIndex((entry) => entry.text.includes('强制保留最后 1 点生命'));
    const transformIndex = logs.findIndex((entry) => entry.text.includes('怨气爆发') && entry.text.includes('怨念恶灵'));
    assert(protectedHitIndex >= 0 && lockIndex > protectedHitIndex && transformIndex > lockIndex, 'Zero-damage phase lock should log hit, protection, then transformation in order');
    cases.push('Yuzu zero-damage phase lock still transforms target');
  }

  {
    const yuzu = makeFighter('柚子@A');
    const specter = makeFighter('幽灵鲨锁血文案靶@B');
    yuzu.atk = 10000;
    specter.isSummon = true;
    specter.owlSummonState = { kind: 'specter', spawnedTurn: 0, deathSaveUsed: false };
    specter.maxHp = 1000;
    localProject.setCurrentHp(specter, 1);
    const { engine, logs } = makeDeathEngine([yuzu, specter]);

    withRandomSequence([0.15, 0.5, 0, 0.5], () => {
      engine.executeSkillAction('yuzu_hammer_crush', engine.fighters[0], engine.fighters[1]);
    });

    const protectedHit = logs.find((entry) => entry.text.includes('第 1/2 击') && entry.text.includes('锁血'));
    assert(protectedHit?.text.includes('濒死锁血'), `Owl summon death-save result should name 濒死锁血, got ${protectedHit?.text ?? 'missing'}`);
    assert(!protectedHit?.text.includes('阶段锁血保护'), 'Owl summon death-save must not be described as a phase transition lock');
    cases.push('Yuzu names Owl summon death-save lock correctly');
  }

  {
    const yuzu = makeFighter('柚子@A');
    const enemy = makeFighter('拼好饭测试目标@B');
    const { engine, logs } = makeDeathEngine([yuzu, enemy]);
    const engineYuzu = engine.fighters[0];
    const engineEnemy = engine.fighters[1];
    engineYuzu.maxHp = 1000;
    localProject.setCurrentHp(engineYuzu, 500);
    engineEnemy.maxHp = 10000;
    localProject.setCurrentHp(engineEnemy, 10000);
    engineEnemy.def = 0;

    withRandomSequence([0.88, 0.5, 0, 0.5], () => {
      engine.executeSkillAction('yuzu_hammer_crush', engineYuzu, engineEnemy);
    });

    assert(engineYuzu.currentHp === 800, `Yuzu spoon meal should heal 30% max HP before attacking, got ${engineYuzu.currentHp}/1000`);
    const mealIndex = logs.findIndex((entry) => entry.text.includes('【拼好饭】'));
    const spoonHitIndex = logs.findIndex((entry) => entry.text.includes('第 1/2 击抽到 勺子'));
    assert(mealIndex >= 0, 'Yuzu spoon draw should log the meal passive');
    assert(spoonHitIndex > mealIndex, 'Yuzu spoon meal should resolve before the spoon attack log');
    assert(logs[spoonHitIndex]?.text.includes('实际造成') && !logs[spoonHitIndex]?.text.includes('实际造成 0 点'), 'Yuzu spoon hit should still attack after healing');
    cases.push('Yuzu spoon meal heals before the spoon hit still attacks');
  }

  {
    const yuzu = makeFighter('柚子@A');
    const ally = makeFighter('柚子队友@A');
    const claire = makeFighter('克蕾儿丝菲尔@B');
    const { engine, logs } = makeDeathEngine([yuzu, ally, claire]);
    const engineYuzu = engine.fighters[0];
    const engineClaire = engine.fighters[2];
    applyTestStatus(engineClaire, { identityId: 'CTR_DRAIN', remainingTurns: 2 });

    withRandomSequence([0.5], () => {
      engine.executeSkillAction('yuzu_hammer_crush', engineYuzu, engineClaire);
    });

    const triggerIndex = logs.findIndex((entry) => entry.text.includes('触发了【汲取反击】'));
    assert(triggerIndex >= 0, 'Claire drain counter should trigger against Yuzu');
    assert(logs[triggerIndex + 1]?.text.includes('【汲取反击】') && logs[triggerIndex + 1]?.text.includes('先结算对方防护与分摊'), 'Claire drain counter should immediately explain its damage settlement before Yuzu mirror logs');
    cases.push('Claire drain counter logs immediate settlement against Yuzu');
  }

  {
    const yuzu = makeFighter('柚子@A');
    const ally = makeFighter('柚子队友@A');
    const claire = makeFighter('克蕾儿丝菲尔@B');
    const { engine, logs } = makeDeathEngine([yuzu, ally, claire]);
    const engineYuzu = engine.fighters[0];
    const engineClaire = engine.fighters[2];
    applyTestStatus(engineClaire, { identityId: 'CTR_VOID', remainingTurns: 2 });

    withRandomSequence([0.5], () => {
      engine.executeSkillAction('yuzu_hammer_crush', engineYuzu, engineClaire);
    });

    const triggerIndex = logs.findIndex((entry) => entry.text.includes('触发了【虚空反击】'));
    assert(triggerIndex >= 0, 'Claire void counter should trigger against Yuzu');
    assert(logs[triggerIndex + 1]?.text.includes('【虚空反击】') && logs[triggerIndex + 1]?.text.includes('开始结算防护与分摊'), 'Claire void counter should immediately explain its damage settlement before Yuzu mirror logs');
    cases.push('Claire void counter logs immediate settlement against Yuzu');
  }

  {
    const yuzu = makeFighter('柚子@A');
    const enemy = makeFighter('破盾者@B');
    const { engine, logs } = makeDeathEngine([yuzu, enemy]);
    const engineYuzu = engine.fighters[0];
    const attacker = engine.fighters[1];

    engineYuzu.maxHp = 1000;
    localProject.setCurrentHp(engineYuzu, 1000);
    clearYuzuShield(engineYuzu);

    engine.applyDamage(engineYuzu, 400, 'skill', false, attacker, { actionName: '压血测试' });

    assert(engineYuzu.yuzuPhase === 2, `Yuzu should enter phase 2 below 70%, got phase ${engineYuzu.yuzuPhase}`);
    const phaseTwoCue = engine.events.find((event) =>
      event.visualCue?.kind === 'transformation' &&
      event.visualCue.fighterId === engineYuzu.id &&
      event.visualCue.from.phase === 1 &&
      event.visualCue.to.phase === 2,
    );
    assert(phaseTwoCue, 'Yuzu HP-triggered phase 2 must preserve its structured transformation cue through deferred damage logs');
    assert(engineYuzu.maxHp > 1000, `Yuzu phase 2 should rebuild max HP above the test baseline, got ${engineYuzu.maxHp}`);
    assert(engineYuzu.currentHp >= Math.floor(engineYuzu.maxHp * 0.62), `Yuzu phase 2 should recover to a safe HP line after stat rebuild, got ${engineYuzu.currentHp}/${engineYuzu.maxHp}`);
    assert(getBarrierTotal(engineYuzu) > 0, 'Yuzu phase 2 should grant personal shield in solo battle');
    const hpAfterPhaseTwo = engineYuzu.currentHp;
    const maxHpAfterPhaseTwo = engineYuzu.maxHp;
    const phaseTwoShield = getBarrierTotal(engineYuzu);
    const breakAction = engine.beginAction('yuzu-shield-break-test', attacker, engineYuzu, 0, {
      skillName: '破盾测试',
      presentation: 'skill',
      targetIds: [engineYuzu.id],
    });
    const actual = engine.applyDamage(engineYuzu, phaseTwoShield + 500, 'skill', false, attacker, { actionName: '破盾测试' });
    engine.endAction(breakAction);

    assert(actual === 0, `Yuzu solo shield break should invalidate overflow HP damage, got actual ${actual}`);
    assert(engineYuzu.currentHp >= hpAfterPhaseTwo, `Yuzu phase 3 rebuild should not lose HP on shield-break overflow, got ${engineYuzu.currentHp}/${hpAfterPhaseTwo}`);
    assert(engineYuzu.maxHp > maxHpAfterPhaseTwo, `Yuzu phase 3 should rebuild max HP above phase 2, got ${engineYuzu.maxHp}/${maxHpAfterPhaseTwo}`);
    assert(Number(engineYuzu.yuzuPhase) === 3, `Yuzu should enter phase 3 when solo phase-2 shield breaks, got ${engineYuzu.yuzuPhase}`);
    const phaseThreeCue = engine.events.find((event) =>
      event.visualCue?.kind === 'transformation' &&
      event.visualCue.fighterId === engineYuzu.id &&
      event.visualCue.from.phase === 2 &&
      event.visualCue.to.phase === 3,
    );
    assert(phaseThreeCue, 'Yuzu shield-break phase 3 must preserve its structured transformation cue through the damage runtime adapter');
    assert(phaseThreeCue?.actionId === breakAction.id, 'Yuzu phase-3 transition should remain causally attached to the shield-breaking attack');
    assert(
      engine.events.filter((event) =>
        event.visualCue?.kind === 'transformation' &&
        event.visualCue.fighterId === engineYuzu.id &&
        event.visualCue.from.phase === 2 &&
        event.visualCue.to.phase === 3,
      ).length === 1,
      'Yuzu shield break must publish the 2->3 phase edge exactly once',
    );
    const markEvent = engine.events.find((event) => event.visible && event.text.includes('【镜界标记】'));
    assert(markEvent?.actorId === engineYuzu.id, 'Yuzu mirror mark must be attributed to Yuzu rather than the shield-breaking attacker');
    assert(markEvent?.skillId === 'yuzu_mirror_mark' && markEvent.actionId !== breakAction.id, 'Yuzu mirror mark must own a nested reaction action');
    assert(markEvent?.rootEventId === breakAction.id, 'Yuzu mirror mark should still preserve the shield-breaking attack as its causal root');
    assert(logs.some((entry) => entry.text.includes('个人战护盾被击碎')), 'Yuzu shield-break transition should explain overflow invalidation');
    cases.push('Yuzu solo phase 2 shield break enters phase 3');
  }

  {
    const yuzu = makeFighter('柚子@A');
    const enemy = makeFighter('过量伤害者@B');
    const { engine, logs } = makeDeathEngine([yuzu, enemy]);
    const engineYuzu = engine.fighters[0];
    const attacker = engine.fighters[1];

    engineYuzu.maxHp = 1000;
    localProject.setCurrentHp(engineYuzu, 1000);
    clearYuzuShield(engineYuzu);

    const actual = engine.applyDamage(engineYuzu, 5000, 'skill', false, attacker, { actionName: '一阶段过量伤害' });

    assert(actual === 999, `Yuzu phase-1 special lock should cap lethal damage to 999, got ${actual}`);
    assert(engineYuzu.yuzuPhase === 2, `Yuzu should enter phase 2 after phase-1 lock, got phase ${engineYuzu.yuzuPhase}`);
    assert(engineYuzu.currentHp >= Math.floor(engineYuzu.maxHp * 0.62), `Yuzu phase 2 should rebuild away from the 1 HP lock, got ${engineYuzu.currentHp}/${engineYuzu.maxHp}`);
    assert(!engineYuzu.isDead && !engineYuzu.isDeadAnnounced, 'Yuzu should not be marked dead after phase-1 lock');
    assert(getBarrierTotal(engineYuzu) > 0, 'Yuzu should receive phase-2 shield after phase-1 lock');
    assert(logs.some((entry) => entry.text.includes('锁血保护')), 'Yuzu phase-1 overkill should log special lock protection');
    cases.push('Yuzu phase-1 overkill locks HP and enters phase 2');
  }

  {
    const yuzu = makeFighter('柚子@A');
    const ally = makeFighter('分摊队友@A');
    const enemy = makeFighter('分摊敌人@B');
    const { engine, logs } = makeDeathEngine([yuzu, ally, enemy]);
    const engineYuzu = engine.fighters[0];
    const engineAlly = engine.fighters[1];
    const attacker = engine.fighters[2];

    [engineYuzu, engineAlly].forEach((fighter) => {
      fighter.maxHp = 1000;
      localProject.setCurrentHp(fighter, 1000);
      clearYuzuShield(fighter);
    });

    const shareOptions: DamageApplicationOptions = { actionName: '分摊测试' };
    const actual = engine.applyDamage(engineYuzu, 100, 'skill', false, attacker, shareOptions);
    assert(actual === 0, `Yuzu phase-1 reduction plus 100% team share should leave no HP damage on Yuzu, got ${actual}`);
    assert(engineYuzu.currentHp === 1000, `Yuzu should take no HP damage after full sharing, got ${engineYuzu.currentHp}`);
    assert(engineAlly.currentHp === 915, `Yuzu ally should take 85 shared damage, got ${engineAlly.currentHp}`);
    assert(shareOptions.redirectedByYuzu && shareOptions.redirectedYuzuDamage === 85, `Yuzu share should expose 85 actual redirected HP damage, got ${shareOptions.redirectedYuzuDamage}`);
    assert(shareOptions.redirectedYuzuTargetIds?.[0] === engineAlly.id, 'Yuzu share should expose the teammate that actually received the hit');
    assert(logs.some((entry) => entry.text.includes('【镜界分摊结算】分摊队友 分得 85 点伤害') && entry.text.includes('生命实际损失 85 点')), 'Yuzu share should log allocated and actual HP damage for the teammate');

    engineYuzu.yuzuPhase = 2;
    engine.markDefeated(engineAlly, { message: '💀 【测试】分摊队友倒下。', awardKill: false });
    engine.finishStep({ current: false });
    assert(engineYuzu.yuzuPhase === 3, `Yuzu team phase should enter phase 3 when teammates are gone, got ${engineYuzu.yuzuPhase}`);
    cases.push('Yuzu team damage sharing and team-loss phase 3');
  }

  {
    const yuzu = makeFighter('柚子@A');
    const ally = makeFighter('吸血分摊队友@A');
    const succubus = makeFighter('克蕾儿丝菲尔@B');
    const { engine, logs } = makeDeathEngine([yuzu, ally, succubus]);
    const engineYuzu = engine.fighters[0];
    const engineAlly = engine.fighters[1];
    const engineSuccubus = engine.fighters[2];
    [engineYuzu, engineAlly].forEach((fighter) => {
      fighter.maxHp = 5000;
      localProject.setCurrentHp(fighter, 5000);
      clearYuzuShield(fighter);
    });
    engineSuccubus.maxHp = 5000;
    localProject.setCurrentHp(engineSuccubus, 500);
    engineSuccubus.mag = 1000;
    applyTestStatus(engineSuccubus, { identityId: 'AIM', charges: 1 });

    engine.executeSkillAction('life_drain', engineSuccubus, engineYuzu);

    assert(engineYuzu.currentHp === 5000 && engineAlly.currentHp < 5000, 'Yuzu should remain unharmed while her ally receives the life-drain hit');
    assert(engineSuccubus.currentHp > 500, 'Lifesteal should use actual HP damage dealt through Yuzu mirror sharing');
    assert(logs.some((entry) => entry.text.includes('【镜界分摊完成】') && entry.text.includes('1 名队友合计实际承受')), 'Yuzu full-share action should end with an accurate redistribution summary');
    assert(!logs.some((entry) => entry.text.includes('攻击被 柚子 化解')), 'Yuzu full-share action must not claim that teammate damage was negated');
    cases.push('Yuzu full sharing preserves damage credit and accurate action logs');
  }

  {
    const yuzu = makeFighter('柚子@A');
    const allies = [
      makeFighter('分摊队友一@A'),
      makeFighter('分摊队友二@A'),
      makeFighter('分摊队友三@A'),
      makeFighter('分摊队友四@A'),
    ];
    const enemy = makeFighter('分摊敌人@B');
    const { engine } = makeDeathEngine([yuzu, ...allies, enemy]);
    const engineYuzu = engine.fighters[0];
    const engineAllies = engine.fighters.slice(1, 5);
    const attacker = engine.fighters[5];

    [engineYuzu, ...engineAllies].forEach((fighter) => {
      fighter.maxHp = 1000;
      localProject.setCurrentHp(fighter, 1000);
      clearYuzuShield(fighter);
    });

    const actual = withRandomSequence([0, 0, 0], () =>
      engine.applyDamage(engineYuzu, 100, 'skill', false, attacker, { actionName: '三人分摊测试' }),
    );

    assert(actual === 0, `Yuzu should pass all shareable damage to random teammates, got ${actual}`);
    assert(engineYuzu.currentHp === 1000, `Yuzu should not take HP damage when three teammates share everything, got ${engineYuzu.currentHp}`);
    assert(engineAllies[0].currentHp === 971, `First selected ally should take 29 shared damage, got ${engineAllies[0].currentHp}`);
    assert(engineAllies[1].currentHp === 972, `Second selected ally should take 28 shared damage, got ${engineAllies[1].currentHp}`);
    assert(engineAllies[2].currentHp === 972, `Third selected ally should take 28 shared damage, got ${engineAllies[2].currentHp}`);
    assert(engineAllies[3].currentHp === 1000, `Fourth ally should not be selected when three allies already share, got ${engineAllies[3].currentHp}`);
    cases.push('Yuzu team damage sharing picks at most three random teammates');
  }

  {
    const yuzu = makeFighter('柚子@A');
    const emote = makeFighter('表情@A');
    const enemyA = makeFighter('表情击杀者@B');
    const enemyB = makeFighter('表情旁观者@B');
    const { engine, logs } = makeDeathEngine([yuzu, emote, enemyA, enemyB]);
    const engineYuzu = engine.fighters[0];
    const engineEmote = engine.fighters[1];

    assert(engineYuzu.yuzuPhase === 1, `Yuzu should start phase 1 for emote team-loss regression, got ${engineYuzu.yuzuPhase}`);
    withRandomSequence([0], () => {
      engine.markDefeated(engineEmote, { message: '💀 【测试】表情进入认主阶段。', killer: engine.fighters[2] });
    });
    engine.finishStep({ current: false });

    assert(engineEmote.isDead && (engineEmote.emoteReviveTurns ?? 0) > 0, 'Emote should be dead and waiting in owner phase');
    const yuzuPhaseAfterEmoteOwnerPhase: number = engineYuzu.yuzuPhase ?? 1;
    assert(yuzuPhaseAfterEmoteOwnerPhase === 3, `Yuzu should enter phase 3 when emote teammate is in owner phase, got ${yuzuPhaseAfterEmoteOwnerPhase}`);
    assert(logs.some((entry) => entry.text.includes('四处认主')), 'Emote owner phase should be logged before Yuzu team-loss transition');
    assert(logs.some((entry) => entry.text.includes('队友全部阵亡') && entry.text.includes('苦痛啊，你是我的唯一')), 'Yuzu team-loss phase 3 transition should be logged after emote owner phase');
    cases.push('Yuzu enters phase 3 when emote teammate enters owner phase');
  }

  {
    const yuzu = makeFighter('柚子@A');
    const target = makeFighter('定制目标@B');
    const bystander = makeFighter('非目标敌人@C');
    const { engine, logs } = makeDeathEngine([yuzu, target, bystander]);
    const engineYuzu = engine.fighters[0];
    const engineTarget = engine.fighters[1];
    const engineBystander = engine.fighters[2];

    engineYuzu.yuzuPhase = 3;
    clearYuzuShield(engineYuzu);
    withRandomSequence([0], () => {
      engine.finishStep({ current: false });
    });

    assert(engineYuzu.yuzuMarkedTargetId === engineTarget.id, 'Yuzu phase 3 should mark the first available target under deterministic roll');
    const mitigated = engine.applyDamage(engineYuzu, 500, 'skill', false, engineBystander, { actionName: '非目标攻击' });
    const expectedMitigated = Math.floor(
      Math.floor(500 * YUZU_UNMARKED_INCOMING_DAMAGE_MULTIPLIER) * (1 - YUZU_PHASE_THREE_REDUCTION),
    );
    assert(mitigated === expectedMitigated, `Yuzu should apply non-marked mitigation before phase-3 reduction, expected ${expectedMitigated}, got ${mitigated}`);
    assert(logs.some((entry) => entry.text.includes('唯一目标') && entry.text.includes('非目标敌人') && entry.text.includes('剩余 115 点继续结算')), 'Yuzu non-target mitigation should be logged');

    engineTarget.maxHp = 100000;
    localProject.setCurrentHp(engineTarget, 100000);
    engineTarget.def = 0;
    engineYuzu.atk = 278;
    engineYuzu.wis = 220;
    engineYuzu.yuzuMarkedHitCount = 0;
    engineYuzu.yuzuFuriosoReady = false;
    engineYuzu.yuzuFuriosoCountedTurn = undefined;
    engine.turnCount = 77;

    withRandomSequence([0.5], () => {
      engine.executeSkillAction('yuzu_customized_fool', engineYuzu, engineTarget);
    });
    assert(engineYuzu.yuzuMarkedHitCount === 1, `Yuzu multi-hit phase-3 skill should count once, got ${engineYuzu.yuzuMarkedHitCount}`);
    withRandomSequence([0.5], () => {
      engine.executeSkillAction('yuzu_daughter_reckoning', engineYuzu, engineTarget);
    });
    assert(engineYuzu.yuzuMarkedHitCount === 1, `Yuzu should not count twice in the same large round, got ${engineYuzu.yuzuMarkedHitCount}`);
    engine.turnCount = 78;
    engine.battleState.largeRound.number += 1;
    withRandomSequence([0.5], () => {
      engine.executeSkillAction('yuzu_daughter_reckoning', engineYuzu, engineTarget);
    });
    assert(Number(engineYuzu.yuzuMarkedHitCount) === 2, `Yuzu should count again after the large round advances, got ${engineYuzu.yuzuMarkedHitCount}`);

    engineTarget.maxHp = 10000;
    localProject.setCurrentHp(engineTarget, 10000);
    engineTarget.def = 9999;
    engineYuzu.atk = 278;
    engineYuzu.wis = 220;
    engineYuzu.yuzuFuriosoReady = true;
    const hpBeforeFurioso = engineTarget.currentHp;
    withRandomSequence([0.5], () => {
      engine.executeSkillAction('yuzu_furioso_replica', engineYuzu, engineTarget);
    });
    const furiosoDamage = hpBeforeFurioso - engineTarget.currentHp;
    assert(!engineYuzu.yuzuFuriosoReady, 'Furioso should consume its ready flag');
    assert(Number(engineYuzu.yuzuMarkedHitCount) === 0, `Furioso should reset marked hit count, got ${engineYuzu.yuzuMarkedHitCount}`);
    assert(logs.some((entry) => entry.text.includes('【Furioso-Replica】第 9/9 击抽到 镰刀')), 'Furioso final hit should force scythe');
    assert(furiosoDamage >= 1800, `Furioso should retain self-stat floor damage against high defense, got ${furiosoDamage}`);
    cases.push('Yuzu phase 3 mark immunity and Furioso final scythe');
  }

  {
    const yuzu = makeFighter('柚子@A');
    const puppetOwner = makeFighter('傀儡宿主@B');
    const puppet = makeFighter('傀儡护卫@B');
    const { engine, logs } = makeDeathEngine([yuzu, puppetOwner, puppet]);
    const engineYuzu = engine.fighters[0];
    const engineOwner = engine.fighters[1];
    const enginePuppet = engine.fighters[2];

    bindAsGachaSummon(engineOwner, enginePuppet, '小汀(傀儡)');
    enginePuppet.name = '小汀(傀儡)';
    enginePuppet.maxHp = 100000;
    localProject.setCurrentHp(enginePuppet, 100000);
    enginePuppet.def = 0;
    engineOwner.maxHp = 100000;
    localProject.setCurrentHp(engineOwner, 100000);
    engineOwner.def = 0;
    engineYuzu.yuzuPhase = 3;
    engineYuzu.yuzuMarkedTargetId = engineOwner.id;
    engineYuzu.yuzuMarkedHitCount = 0;
    engineYuzu.yuzuFuriosoCountedTurn = undefined;
    applyTestStatus(engineOwner, { identityId: 'YUZU_MARKED' });
    engineYuzu.atk = 1000;
    engineYuzu.wis = 300;

    const ownerHpBeforeGuard = engineOwner.currentHp;
    const puppetHpBeforeGuard = enginePuppet.currentHp;
    withRandomSequence([0.5], () => {
      engine.executeSkillAction('yuzu_customized_fool', engineYuzu, engineOwner);
    });

    assert(engineOwner.currentHp === ownerHpBeforeGuard, `Yuzu marked attacks should not bypass an active puppet, owner lost ${ownerHpBeforeGuard - engineOwner.currentHp} HP`);
    assert(enginePuppet.currentHp < puppetHpBeforeGuard, 'Puppet Ting should take the intercepted Yuzu damage');
    assert(engineYuzu.yuzuMarkedHitCount === 1, `A skill that hits Puppet Ting while aimed at the marked owner should charge Furioso once, got ${engineYuzu.yuzuMarkedHitCount}`);
    assert(logs.some((entry) => entry.text.includes('【傀儡援护】') && entry.text.includes('镜界标记仍保留在宿主身上')), 'Yuzu puppet interception should explain both the guard and retained mark');
    assert(!logs.some((entry) => entry.text.includes('【定制愚者】第') && entry.text.includes('命中 傀儡宿主')), 'A living puppet should keep every hit of the marked skill off its owner');

    const secondSkillLogStart = logs.length;
    localProject.setCurrentHp(enginePuppet, 1);
    engine.battleState.largeRound.number += 1;
    const ownerHpBeforeBreak = engineOwner.currentHp;
    withRandomSequence([0.5], () => {
      engine.executeSkillAction('yuzu_customized_fool', engineYuzu, engineOwner);
    });
    const secondSkillLogs = logs.slice(secondSkillLogStart);

    assert(enginePuppet.currentHp <= 0 || enginePuppet.isDead, 'Puppet Ting should be defeated by the first hit when only 1 HP remains');
    assert(engineOwner.currentHp < ownerHpBeforeBreak, 'Remaining multi-hit attacks should reach the marked owner after the puppet falls');
    assert(Number(engineYuzu.yuzuMarkedHitCount) === 2, `The next large-round skill should add only one more Furioso count after breaking through the puppet, got ${engineYuzu.yuzuMarkedHitCount}`);
    assert(secondSkillLogs.some((entry) => entry.text.includes('命中 小汀(傀儡)')), 'The breaking hit should be logged on Puppet Ting');
    assert(secondSkillLogs.some((entry) => entry.text.includes('命中 傀儡宿主')), 'Later hits should visibly return to the marked owner after the puppet falls');
    cases.push('Yuzu marked multi-hit respects Puppet Ting interception');
  }

  {
    const yuzu = makeFighter('柚子@A');
    const target = makeFighter('镜界击败文案目标@B');
    const { engine, logs } = makeDeathEngine([yuzu, target]);
    const engineYuzu = engine.fighters[0];
    const engineTarget = engine.fighters[1];
    engineYuzu.atk = 10000;
    engineYuzu.agl = 10000;
    engineTarget.agl = 0;
    localProject.setCurrentHp(engineTarget, 1);

    withRandomSequence(Array(12).fill(0.5), () => {
      engine.executeSkillAction('yuzu_customized_fool', engineYuzu, engineTarget);
    });

    const defeatLog = logs.find((entry) => entry.type === 'death' && entry.text.includes(engineTarget.name));
    assert(defeatLog?.text.includes('镜界武器击败'), 'Yuzu lethal hit should use a neutral defeat description after execution was removed');
    assert(!defeatLog?.text.includes('处刑'), 'Yuzu generic lethal logs must not claim the removed execution mechanic');
    assert(logs.some((entry) => entry.text.includes('找不到可以攻击的目标')), 'Yuzu should explain why the remaining multi-hits stop after the final target falls');
    cases.push('Yuzu lethal and exhausted-target logs do not claim execution');
  }

  {
    const yuzu = makeFighter('柚子@A');
    const puppetOwner = makeFighter('Furioso宿主@B');
    const puppet = makeFighter('Furioso傀儡@B');
    const { engine, logs } = makeDeathEngine([yuzu, puppetOwner, puppet]);
    const engineYuzu = engine.fighters[0];
    const engineOwner = engine.fighters[1];
    const enginePuppet = engine.fighters[2];

    bindAsGachaSummon(engineOwner, enginePuppet, '小汀(傀儡)');
    enginePuppet.name = '小汀(傀儡)';
    enginePuppet.maxHp = 1000000;
    localProject.setCurrentHp(enginePuppet, 1000000);
    enginePuppet.def = 0;
    engineOwner.maxHp = 100000;
    localProject.setCurrentHp(engineOwner, 100000);
    engineOwner.def = 0;
    engineYuzu.yuzuPhase = 3;
    engineYuzu.yuzuMarkedTargetId = engineOwner.id;
    engineYuzu.yuzuMarkedHitCount = 9;
    engineYuzu.yuzuFuriosoReady = true;
    applyTestStatus(engineOwner, { identityId: 'YUZU_MARKED' });
    engineYuzu.atk = 1000;
    engineYuzu.wis = 300;

    const ownerHpBefore = engineOwner.currentHp;
    const puppetHpBefore = enginePuppet.currentHp;
    withRandomSequence([0.5], () => {
      engine.executeSkillAction('yuzu_furioso_replica', engineYuzu, engineOwner);
    });
    const furiosoHitLogs = logs.filter((entry) => entry.text.includes('【Furioso-Replica】第'));

    assert(furiosoHitLogs.length === 9, `Furioso should always resolve exactly 9 total hits through a puppet guard, got ${furiosoHitLogs.length}`);
    assert(furiosoHitLogs.every((entry) => entry.text.includes('命中 小汀(傀儡)')), 'A surviving Puppet Ting should absorb all 9 Furioso hits without extra owner hits');
    assert(engineOwner.currentHp === ownerHpBefore, 'Furioso should not add replacement hits against the marked owner after all 9 are intercepted');
    assert(enginePuppet.currentHp < puppetHpBefore, 'Puppet Ting should actually take Furioso damage');
    assert(!engineYuzu.yuzuFuriosoReady && Number(engineYuzu.yuzuMarkedHitCount) === 0, 'Furioso should end and reset normally after its fixed 9 intercepted hits');
    cases.push('Furioso keeps a fixed nine-hit budget through Puppet Ting interception');
  }

  {
    const yuzu = makeFighter('柚子@A');
    const enemy = makeFighter('普通敌人@B');
    const { engine } = makeDeathEngine([yuzu, enemy]);
    const engineYuzu = engine.fighters[0];
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    engine.turnCount = 20;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());

    const puruisaishi = engine.fighters.find((fighter) => fighter.isPuruisaishi);
    const core = engine.fighters.find((fighter) => fighter.isOriginiumCore);
    const crystal = engine.fighters.find((fighter) => fighter.isOriginiumCrystal);
    assert(puruisaishi && core && crystal, 'Puruisaishi event should provide Puruisaishi, Ananna and a crystal for Yuzu mark test');
    crystal.untargetableUntilTurn = 0;

    engineYuzu.yuzuPhase = 3;
    const yuzuRuntime = engine.createCharacterHookRuntime();
    withRandomSequence([0], () => {
      ensureYuzuMarkedTarget(yuzuRuntime, engineYuzu);
    });

    assert(engineYuzu.yuzuMarkedTargetId === engine.fighters[1].id, `Yuzu phase-3 mark should not prefer originium crystal over normal enemies, got ${engineYuzu.yuzuMarkedTargetId}`);
    assert(!puruisaishi.statuses.some((status) => status.identityId === 'YUZU_MARKED'), 'Yuzu should not mark Puruisaishi');
    assert(!core.statuses.some((status) => status.identityId === 'YUZU_MARKED'), 'Yuzu should not mark Ananna');
    assert(!crystal.statuses.some((status) => status.identityId === 'YUZU_MARKED'), 'Yuzu should not force priority onto the originium crystal');

    clearYuzuMark(yuzuRuntime, engineYuzu);
    withRandomSequence([0.99], () => {
      ensureYuzuMarkedTarget(yuzuRuntime, engineYuzu);
    });

    assert(engineYuzu.yuzuMarkedTargetId === crystal.id, `Yuzu phase-3 mark should still allow random originium crystal marks, got ${engineYuzu.yuzuMarkedTargetId}`);
    assert(crystal.statuses.some((status) => status.identityId === 'YUZU_MARKED'), 'Yuzu should keep originium crystal in the random mark pool');
    assert(!puruisaishi.statuses.some((status) => status.identityId === 'YUZU_MARKED'), 'Yuzu should still not mark Puruisaishi after reroll');
    assert(!core.statuses.some((status) => status.identityId === 'YUZU_MARKED'), 'Yuzu should still not mark Ananna after reroll');
    cases.push('Yuzu phase 3 mark allows but does not prefer originium crystals');
  }

  {
    const killer = makeFighter('已退场击杀者@K');
    const emote = makeFighter('表情@E');
    const { engine, logs } = makeDeathEngine([killer, emote]);
    const engineKiller = engine.fighters[0];
    const engineEmote = engine.fighters[1];
    spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '测试强制出场');
    engine.turnCount = 20;
    processPuruisaishiRoundEnd(engine.createPuruisaishiRuntime());

    localProject.setCurrentHp(engineKiller, 0);
    engineKiller.isDead = true;
    engineKiller.isDeadAnnounced = true;
    engine.markDefeated(engineEmote, { message: '💀 【测试】表情被 NPC 锚点包围时倒下。', killer: engineKiller });

    assert(engineEmote.emoteFinalDead, 'Emote should truly die when only Puruisaishi event NPCs remain as zero-kill bodies');
    assert(logs.some((entry) => entry.text.includes('找不到任何还活着的玩家可以认主')), 'Emote should log that NPCs are not valid owner candidates');
    cases.push('Emote zero-kill anchors ignore Puruisaishi event NPCs');
  }

  {
    const emote = makeFighter('表情@A');
    const gamer = makeFighter('玄凝@B');
    const joker = makeFighter('屑@C');
    const victim = makeFighter('转移承伤者@D');
    const godOfTrolls = localProject.jobs.GOD_OF_TROLLS;
    assert(godOfTrolls, 'GOD_OF_TROLLS job should exist for emote all-masters redirect test');
    const { engine, logs } = makeDeathEngine([emote, gamer, joker, victim]);
    const engineEmote = engine.fighters[0];
    const engineGamer = engine.fighters[1];
    const engineJoker = engine.fighters[2];
    const engineVictim = engine.fighters[3];

    engineEmote.mag = 100;
    engineEmote.wis = 100;
    engineEmote.maxHp = 1000;
    localProject.setCurrentHp(engineEmote, 1000);
    [engineGamer, engineJoker, engineVictim].forEach((fighter) => {
      fighter.maxHp = 10000;
      localProject.setCurrentHp(fighter, 10000);
    });
    engineGamer.stats.kills = 2;
    engineJoker.stats.kills = 2;
    engineJoker.job = 'GOD_OF_TROLLS';
    engineJoker.jobData = { ...godOfTrolls, skills: [...(godOfTrolls.skills ?? [])] };
    engineJoker.transformed = true;

    withRandomSequence([0, 0.99, 0.99], () => {
      engine.executeSkillAction('emote_all_masters_return', engineEmote, engineGamer);
    });

    assert(logs.some((entry) => entry.text.includes('屑 遭到表情的【万主归一】')), 'Emote all-masters test should trigger Joker redirect');
    assert(logs.some((entry) => entry.text.includes('账页被随机恶作剧带偏')), 'Emote all-masters should explain redirected ledger page');
    assert(engineJoker.stats.kills === 2, `Redirected Joker should not lose kills, got ${engineJoker.stats.kills}`);
    assert(engineGamer.stats.kills === 2, `Directly hit gamer should retain authoritative kills, got ${engineGamer.stats.kills}`);
    assert(engineGamer.emoteClaimedKills === 1, `Directly hit gamer should lose one recognition-ledger kill, got ${engineGamer.emoteClaimedKills}`);
    assert((engineJoker.emoteClaimedKills ?? 0) === 0, 'Emote all-masters should not consume a redirected Joker ledger entry');
    cases.push('Emote all-masters isolates redirected targets and true kill stats');
  }

  {
    const drawer = makeFighter('强欲套娃测试者@A');
    const target = makeFighter('强欲套娃旁观者@B');
    const { engine, logs } = makeDeathEngine([drawer, target]);
    const pot = engine.Data.GACHA_SSR_POOL.find((entry) => entry.triggerAgain === 2);
    assert(pot, 'Pot-of-Greed chain test requires the triggerAgain card');
    const terminal: GachaEntry = {
      text: '🎁 {USER} 抽到【套娃终点奖励】，获得一次瞄准！',
      tag: 'buff',
      statusApplications: [{ identityId: 'AIM', charges: 1 }],
    };
    engine.SKILLS.gacha_chain_regression = {
      name: '连锁抽卡测试',
      tag: 'special',
      isGacha: true,
      pool: [pot, terminal],
      text: '连锁抽卡测试',
    };

    withRandomSequence([0, 0, 0, 0, 0.99, 0, 0.99, 0, 0.99], () => {
      engine.executeSkillAction('gacha_chain_regression', engine.fighters[0], engine.fighters[1]);
    });

    assert(logs.filter((entry) => entry.text.includes('强欲之壶')).length === 2, 'A Pot drawn by another Pot should activate normally');
    assert(logs.filter((entry) => entry.text.includes('套娃终点奖励')).length === 3, 'Root Pot plus nested Pot should resolve all three resulting terminal draws');
    cases.push('Pot of Greed recursively draws two more cards when it draws itself');
  }

  {
    const ra = makeFighter('翼神龙治疗日志@A');
    const target = makeFighter('翼神龙治疗靶@B');
    const { engine, logs } = makeDeathEngine([ra, target]);
    const raJob = localProject.jobs.RA_WINGED_DRAGON;
    assert(raJob, 'Ra healing log test requires RA_WINGED_DRAGON');
    engine.fighters[0].job = 'RA_WINGED_DRAGON';
    engine.fighters[0].jobData = { ...raJob, skills: [...raJob.skills] };
    engine.fighters[0].maxHp = 5000;
    localProject.setCurrentHp(engine.fighters[0], 4990);
    engine.fighters[0].mag = 1000;
    engine.fighters[0].agl = 10000;
    applyTestStatus(engine.fighters[0], { identityId: 'AIM', charges: 1 });
    engine.fighters[1].maxHp = 100000;
    localProject.setCurrentHp(engine.fighters[1], 100000);

    withRandomSequence([0.99, 0.99], () => {
      engine.executeSkillAction('ra_sun_flare', engine.fighters[0], engine.fighters[1]);
    });

    assert(engine.fighters[0].currentHp === 5000, 'Ra should clamp healing to missing HP');
    assert(logs.some((entry) => entry.text.includes('吸收太阳神火') && entry.text.includes('实际恢复 10 点生命')), 'Ra healing log should report the actual clamped heal');
    cases.push('Ra solar healing log reports actual recovery');
  }

  {
    const ultimate = makeFighter('青眼究极龙反噬日志@A');
    const target = makeFighter('究极龙反噬靶@B');
    const { engine, logs } = makeDeathEngine([ultimate, target]);
    const ultimateJob = localProject.jobs.BLUE_EYES_ULTIMATE_DRAGON;
    assert(ultimateJob, 'Ultimate Dragon recoil test requires BLUE_EYES_ULTIMATE_DRAGON');
    engine.fighters[0].job = 'BLUE_EYES_ULTIMATE_DRAGON';
    engine.fighters[0].jobData = { ...ultimateJob, skills: [...ultimateJob.skills] };
    engine.fighters[0].blueEyesUltimateStrain = 2;
    engine.fighters[0].agl = 10000;
    localProject.setCurrentHp(engine.fighters[0], 1);
    engine.fighters[1].maxHp = 100000;
    localProject.setCurrentHp(engine.fighters[1], 100000);

    withRandomSequence(Array(20).fill(0.5), () => {
      engine.executeSkillAction('triple_dragon_head', engine.fighters[0], engine.fighters[1]);
    });

    assert(engine.fighters[0].currentHp === 1, 'Ultimate Dragon recoil should preserve the one-HP floor');
    assert(logs.some((entry) => entry.text.includes('融合反噬没有继续扣除生命')), 'Ultimate Dragon recoil log should not claim theoretical damage at the one-HP floor');
    cases.push('Ultimate Dragon recoil log reports actual HP loss');
  }

  {
    const attacker = makeFighter('预估日志攻击者@A');
    const yuzu = makeFighter('柚子@B');
    const { engine, logs } = makeDeathEngine([attacker, yuzu]);
    const engineYuzu = engine.fighters[1];
    setYuzuShield(engineYuzu, 99999, engineYuzu.id);
    engine.fighters[0].agl = 10000;
    applyTestStatus(engine.fighters[0], { identityId: 'AIM', charges: 1 });

    withRandomSequence([0.99], () => {
      engine.executeSkillAction('bash', engine.fighters[0], engineYuzu);
    });

    const previewIndex = logs.findIndex((entry) => entry.text.includes('举盾猛击'));
    const shieldIndex = logs.findIndex((entry) => entry.text.includes('镜界护盾') && entry.text.includes('挡下'));
    const statusIndex = logs.findIndex((entry) => entry.text.includes('状态结算') && entry.text.includes('眩晕'));
    assert(previewIndex >= 0 && logs[previewIndex]!.text.includes('预计造成') && logs[previewIndex]!.text.includes('尝试眩晕') && logs[previewIndex]!.text.includes('若伤害发生变化会追加实际结算'), 'Offensive skill preview should label damage and statuses as pending resolution');
    assert(previewIndex < shieldIndex && shieldIndex < statusIndex, 'Skill cause, mitigation, and failed status outcome should appear in causal order');
    cases.push('generic skill logs distinguish preview from actual settlement');
  }

  {
    const attacker = makeFighter('状态结算攻击者@A');
    const target = makeFighter('状态结算目标@B');
    const { engine, logs } = makeDeathEngine([attacker, target]);
    engine.fighters[0].agl = 10000;
    applyTestStatus(engine.fighters[0], { identityId: 'AIM', charges: 1 });

    withRandomSequence([0.99], () => {
      engine.executeSkillAction('bash', engine.fighters[0], engine.fighters[1]);
    });

    assert(logs.some((entry) => entry.text.includes('【状态结算】') && entry.text.includes('【眩晕】') && entry.text.includes('2次自身行动机会')), 'A successful declarative status should be confirmed immediately with its clock');
    cases.push('generic skill logs confirm successful status application immediately');
  }

  {
    const gamer = makeFighter('复合状态结算者@A');
    const { engine, logs } = makeDeathEngine([gamer, makeFighter('复合状态旁观者@B')]);
    const rushB = localProject.skills.rush_b;
    assert(rushB, 'Composite declarative status regression requires rush_b');

    engine.applySkillStatusEffect(rushB, engine.fighters[0], engine.fighters[0]);

    const settlementLogs = logs.filter((entry) => entry.text.includes('【状态结算】') && entry.text.includes('【Rush B】'));
    assert(settlementLogs.length === 1, `A composite declarative status should emit one themed settlement log, got ${settlementLogs.length}`);
    assert(settlementLogs[0]!.text.includes('2次自身行动机会'), 'Composite status settlement should expose its shared lifecycle instead of an arbitrary component potency');
    assert(settlementLogs[0]!.text.includes('来源：Rush B · 复合状态结算者'), 'Composite status settlement should expose its skill and applier source');
    assert(queryMechanic(engine.fighters[0], 'ATK_UP').entries.length === 1 && queryMechanic(engine.fighters[0], 'SPD_UP').entries.length === 1, 'Composite declarative status should still materialize every registered mechanic');
    cases.push('composite declarative status logs one themed lifecycle and source');
  }

  {
    const tokusatsu = makeFighter('刺猬人@A');
    const joker = makeFighter('屑@B');
    const laterTarget = makeFighter('群伤缓存后置目标@C');
    const { engine, logs } = makeDeathEngine([tokusatsu, joker, laterTarget]);
    const jokerJob = localProject.jobs.GOD_OF_TROLLS;
    assert(jokerJob, 'Dead-target AoE regression requires GOD_OF_TROLLS');
    engine.fighters[1].job = 'GOD_OF_TROLLS';
    engine.fighters[1].jobData = { ...jokerJob, skills: [...jokerJob.skills] };
    engine.fighters[1].transformed = true;
    localProject.setCurrentHp(engine.fighters[2], 1);

    withRandomSequence([0, 0.99], () => {
      engine.executeSkillAction('monster_roar', engine.fighters[0], engine.fighters[1]);
    });

    assert(engine.fighters[2].isDeadAnnounced, 'Joker redirect should defeat the later cached AoE target in this regression');
    assert(!logs.some((entry) => entry.text.includes('咆哮冲击') && entry.text.includes(engine.fighters[2].name)), 'The AoE loop must not attack or log a target that died earlier in the same action');
    cases.push('custom AoE skips targets defeated earlier in the same action');
  }

  {
    const tokusatsu = makeFighter('刺猬人@A');
    const joker = makeFighter('屑@B');
    const laterTarget = makeFighter('连斩缓存后置目标@C');
    const { engine, logs } = makeDeathEngine([tokusatsu, joker, laterTarget]);
    const monsterJob = localProject.jobs.MIRACLE_MONSTER_BUJIN;
    const jokerJob = localProject.jobs.GOD_OF_TROLLS;
    assert(monsterJob && jokerJob, 'Cached combo-target regression requires monster Bujin and GOD_OF_TROLLS');
    engine.fighters[0].job = 'MIRACLE_MONSTER_BUJIN';
    engine.fighters[0].jobData = { ...monsterJob, skills: [...monsterJob.skills] };
    engine.fighters[0].transformed = true;
    engine.fighters[1].job = 'GOD_OF_TROLLS';
    engine.fighters[1].jobData = { ...jokerJob, skills: [...jokerJob.skills] };
    engine.fighters[1].transformed = true;
    localProject.setCurrentHp(engine.fighters[2], 1);

    withRandomSequence([0, 0.99], () => {
      engine.executeSkillAction('bujin_monster_combo', engine.fighters[0], engine.fighters[1]);
    });

    assert(engine.fighters[2].isDeadAnnounced, 'Joker redirect should defeat the cached later combo target');
    assert(!logs.some((entry) => entry.text.includes('第 2 斩') && entry.text.includes(engine.fighters[2].name)), 'A cached combo target killed by an earlier redirected hit must not be attacked again');
    cases.push('cached multi-hit list skips targets defeated by an earlier redirected hit');
  }

  {
    const succubus = makeFighter('克蕾儿丝菲尔@A');
    const joker = makeFighter('屑@B');
    const transferVictim = makeFighter('插件转移承受者@C');
    const { engine, logs } = makeDeathEngine([succubus, joker, transferVictim]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    const jokerJob = localProject.jobs.GOD_OF_TROLLS;
    assert(jokerJob, 'Chimera redirected side-damage regression requires GOD_OF_TROLLS');
    engine.fighters[1].job = 'GOD_OF_TROLLS';
    engine.fighters[1].jobData = { ...jokerJob, skills: [...jokerJob.skills] };
    engine.fighters[1].transformed = true;

    withRandomSequence([0, 0, 0.99], () => {
      engine.executeSupportSkill(
        chimeraInstallSkillByStatus('PLUG_HEAD'),
        engine.fighters[0],
        null,
        engine.getTeamId(engine.fighters[0]),
      );
    });

    assert(logs.some((entry) => entry.text.includes('【暴食之口启动】') && entry.text.includes('转移目标实际承受')), 'Chimera side damage should retain the actual damage after Joker transfer');
    assert(!logs.some((entry) => entry.text.includes('【暴食之口启动】') && entry.text.includes('实际造成 0 点')), 'Chimera side-damage log must not turn a successful Joker transfer into a zero-damage hit');
    cases.push('Chimera side damage preserves Joker-redirected settlement');
  }

  return cases;
}
