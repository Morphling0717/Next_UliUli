import type { Fighter, StatKey } from '../../../lib/namearena/types';
import {
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
    const victim = makeFighter('持续伤害旁观者@B');
    const { engine, logs } = makeDeathEngine([joker, victim]);
    const godOfTrolls = localProject.jobs.GOD_OF_TROLLS;
    assert(godOfTrolls, 'GOD_OF_TROLLS job should exist for Joker DoT transfer tests');
    const engineJoker = engine.fighters[0];
    engineJoker.job = 'GOD_OF_TROLLS';
    engineJoker.jobData = { ...godOfTrolls, skills: [...(godOfTrolls.skills ?? [])] };
    engineJoker.status.push({ type: 'POISON', duration: 2 });
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
    assert(!engine.fighters[1].status.some((status) => status.type === 'STUN'), 'Joker should not receive the skill status when the hit is transferred');
    assert(!logs.some((entry) => entry.text.includes('屑 被太阳神威压削弱')), 'Transferred Ra divine pressure should not log a debuff on Joker');
    cases.push('Joker transfer suppresses target afterExecute effects');
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
    assert(engine.fighters[0].hpPct <= 0.3, `Ting suicide bomb should still leave Ting heavily damaged, got hpPct ${engine.fighters[0].hpPct}`);
    cases.push('Ting suicide bomb damages without double-removal');
  }

  {
    const tokusatsu = makeFighter('刺猬人@A');
    const { engine, logs } = makeDeathEngine([tokusatsu, makeFighter('变身旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);

    assert(engine.fighters[0].transformed, 'Tokusatsu hook should mark the fighter as transformed');
    assert(engine.fighters[0].job === 'MIRACLE_BUJIN', `Tokusatsu hook should transform to MIRACLE_BUJIN, got ${engine.fighters[0].job}`);
    assert(logs.some((entry) => entry.text.includes('奇迹武刃')), 'Tokusatsu hook should keep the original transform log');
    cases.push('Tokusatsu transform hook');
  }

  {
    const attacker = makeFighter('武神王座攻击者@A');
    const tokusatsu = makeFighter('刺猬人@B');
    attacker.status.push({ type: 'AIM', duration: 3 });
    attacker.atk = 100;
    attacker.agl = 10000;
    tokusatsu.maxHp = 100000;
    localProject.setCurrentHp(tokusatsu, 100000);
    tokusatsu.status.push({ type: 'WAIT_COUNTER', duration: 3 });
    const { engine, logs } = makeDeathEngine([attacker, tokusatsu]);

    engine.executeSkillAction('serious_punch', engine.fighters[0], engine.fighters[1]);

    assert(engine.fighters[1].counterUsed, 'Tokusatsu wait counter hook should consume the counter');
    assert(engine.fighters[1].job === 'MIRACLE_MONSTER_BUJIN', `Tokusatsu wait counter hook should transform to monster form, got ${engine.fighters[1].job}`);
    assert(!engine.fighters[1].status.some((status) => status.type === 'WAIT_COUNTER'), 'Tokusatsu wait counter hook should remove WAIT_COUNTER status');
    assert(engine.fighters[1].hasUsedGreatMonsterVictory, 'Tokusatsu wait counter hook should fire GREAT MONSTER VICTORY once');
    assert(logs.some((entry) => entry.text.includes('GREAT！MONSTER')), 'Tokusatsu wait counter hook should keep the monster transform log');
    cases.push('Tokusatsu wait counter hook');
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
    assert(engine.fighters[0].status.some((status) => status.type === 'LIQUID_BODY'), 'Morphling hook should apply LIQUID_BODY');
    assert(logs.some((entry) => entry.text.includes('显露出')), 'Morphling hook should keep the original transform log');
    cases.push('Morphling transform hook');
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
    const { engine, logs } = makeDeathEngine([gamer, makeFighter('变身旁观者@B')]);
    engine.fighters[0].apm = 10;
    engine.fighters[0].status.push({ type: 'POISON', duration: 3 });
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);

    assert(engine.fighters[0].transformed, 'Gamer hook should mark the fighter as transformed at half HP');
    assert(engine.fighters[0].job === 'ALL_PLATFORM_CHAMPION', `Gamer hook should transform to ALL_PLATFORM_CHAMPION, got ${engine.fighters[0].job}`);
    assert((engine.fighters[0].apm ?? 0) === 12, `Gamer transform should cap APM at 12, got ${engine.fighters[0].apm}`);
    assert(!engine.fighters[0].status.some((status) => status.type === 'POISON'), 'high-APM Gamer transform should cleanse common negative statuses');
    assert(engine.fighters[0].status.some((status) => status.type === 'BKB'), 'high-APM Gamer transform should apply BKB');
    assert(engine.fighters[0].status.some((status) => status.type === 'AIM'), 'high-APM Gamer transform should apply AIM');
    assert(engine.fighters[0].status.some((status) => status.type === 'GAMER_WORLD_STAGE'), 'high-APM Gamer transform should apply world-stage status');
    assert(logs.some((entry) => entry.text.includes('全平台制霸者')), 'Gamer hook should keep the transform log');
    cases.push('Gamer APM-based half-HP transform hook');
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
      engine.fighters[0].status.push({ type: 'AIM', duration: 2 });
      if (skillId === 'gamer_world_combo') {
        engine.fighters[0].status.push({ type: 'GAMER_WORLD_STAGE', duration: 4 });
      }
      if (skillId === 'gamer_estus_cancel' || skillId === 'gamer_clutch_ace') {
        localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.45));
        engine.fighters[0].status.push({ type: 'POISON', duration: 2 });
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
    engine.fighters[0].status.push({ type: 'POISON', duration: 3 });
    engine.applyDamage(engine.fighters[0], engine.fighters[0].maxHp * 3, 'skill', true, engine.fighters[1]);

    assert(engine.fighters[0].currentHp > 0, 'Luck Emperor death save should keep Croc alive');
    assert(engine.fighters[0].hasUsedGachaDeathSave, 'Luck Emperor death save should be marked as used');
    assert((engine.fighters[0].gachaLuck ?? 0) >= 3, 'Luck Emperor death save should grant pity');
    assert(!engine.fighters[0].status.some((status) => status.type === 'POISON'), 'Luck Emperor death save should cleanse common negative statuses');
    assert(logs.some((entry) => entry.text.includes('欧皇护符')), 'Luck Emperor death save should log the charm trigger');
    cases.push('Gacha death save prevents one lethal hit');
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
    engine.fighters[0].status.push({ type: 'GACHA_SUMMON_LIFESTEAL', duration: 4 });
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
    engine.fighters[0].status.push({ type: 'GACHA_SUMMON_LIFESTEAL', duration: 4 });
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

    engine.fighters.filter((fighter) => fighter.name.startsWith('白龙靶')).forEach((target) => {
      target.maxHp = 100000;
      localProject.setCurrentHp(target, 100000);
      target.agl = 0;
    });
    engine.executeSkillAction('blue_eyes_sweeping_breath', blueEyes, engine.fighters[3]);

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
    assert(ra.status.some((status) => status.type === 'RA_PHOENIX'), 'Ra should enter with Phoenix revival armed');
    assert(ra.status.some((status) => status.type === 'SPELL_BLOCK'), 'Ra should enter with spell block');
    assert(ra.status.some((status) => status.type === 'BKB'), 'Ra should enter with short divine immunity');
    assert(ra.status.some((status) => status.type === 'REGEN'), 'Ra should enter with regeneration');
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
    engine.fighters[2].status.push({ type: 'RA_PHOENIX', duration: 3 });
    engine.fighters[0].maxHp = 100000;
    localProject.setCurrentHp(engine.fighters[0], 100000);
    engine.fighters[3].maxHp = 100000;
    localProject.setCurrentHp(engine.fighters[3], 100000);

    engine.applyDamage(engine.fighters[2], 5000, 'skill', true, engine.fighters[0], { actionName: '神不死鸟测试' });

    assert(engine.fighters[2].currentHp > 0 && !engine.fighters[2].isDeadAnnounced, 'Ra Phoenix should keep Ra alive through one lethal hit');
    assert(engine.fighters[2].hasUsedRaPhoenix, 'Ra Phoenix should be marked as consumed after triggering');
    assert(!engine.fighters[2].status.some((status) => status.type === 'RA_PHOENIX'), 'Ra Phoenix status should be removed after triggering');
    assert(logs.some((entry) => entry.text.includes('神不死鸟')), 'Ra Phoenix should produce a named combat log');
    assert(engine.fighters[0].stats.dmgTaken > 0 || engine.fighters[3].stats.dmgTaken > 0, 'Ra Phoenix should retaliate against enemies');
    cases.push('Gacha Ra Phoenix revives and retaliates once');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const ra = makeFighter('翼神龙指令测试体@A');
    const target = makeFighter('召唤指令靶子@B');
    const { engine, logs } = makeDeathEngine([gacha, ra, target]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    bindAsGachaSummon(engine.fighters[0], engine.fighters[1], '翼神龙', true);
    engine.fighters[1].status.push({ type: 'CHARMED', duration: 2 });
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
    bindAsGachaSummon(engine.fighters[0], engine.fighters[1], '史尔特尔');
    engine.fighters[1].atk = 400;
    engine.fighters[1].mag = 400;
    engine.fighters[2].maxHp = 10000;
    localProject.setCurrentHp(engine.fighters[2], 10000);
    const godOfTrolls = localProject.jobs.GOD_OF_TROLLS;
    assert(godOfTrolls, 'GOD_OF_TROLLS job should exist for all-out attack redirect tests');
    engine.fighters[2].job = 'GOD_OF_TROLLS';
    engine.fighters[2].jobData = { ...godOfTrolls, skills: [...(godOfTrolls.skills ?? [])] };
    engine.fighters[0].status.push({ type: 'GACHA_SUMMON_LIFESTEAL', duration: 4 });
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
    assert(lifestealIndex > transferIndex, 'Transferred all-out summon damage should log lifesteal after the transfer landing');
    assert(redirectSummaryIndex > lifestealIndex, 'All-out attack should explain redirected original target after transfer and lifesteal logs');
    assert(!logs.some((entry) => entry.text.includes('进击被 屑 化解，没有造成实际伤害')), 'All-out attack should not imply redirected summon damage did no damage at all');
    cases.push('Gacha all-out attack explains Joker redirected summon damage');
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

    assert(logs.some((entry) => entry.text.includes('黑暗大法师（牢鳄召唤）')), 'Summon-only win log should attribute victory to the summoner');
    cases.push('Summon victory log attributes summoner');
  }

  {
    const succubus = makeFighter('克蕾儿丝菲尔@A');
    const { engine, logs } = makeDeathEngine([succubus, makeFighter('变身旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);

    assert(engine.fighters[0].job === 'CHIMERA', `Succubus hook should transform to CHIMERA, got ${engine.fighters[0].job}`);
    assert(engine.fighters[0].spd === 120, 'Succubus hook should set chimera speed');
    assert(logs.some((entry) => entry.text.includes('肉体开始重组')), 'Succubus hook should keep the original transform log');
    cases.push('Succubus transform hook');
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
    assert(engine.fighters[0].ultPoints === 2 && engine.fighters[0].economy === 2, 'Sigua solo hook should initialize Valorant resources');
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
      assert(engine.fighters[0][key] === 150, `Bunny hook should set ${key} to 150`);
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
    assert(engine.fighters[0].status.some((status) => status.type === 'RABBIT_CALC_HASTE' && status.duration === 3), 'Rabbit calculator haste should add a temporary status');
    engine.processStatus(engine.fighters[0]);
    engine.processStatus(engine.fighters[0]);
    engine.processStatus(engine.fighters[0]);
    assert(!engine.fighters[0].status.some((status) => status.type === 'RABBIT_CALC_HASTE'), 'Rabbit calculator haste should expire on self turns');
    assert(engine.fighters[0].spd === speedBefore, 'Expired rabbit calculator haste should leave speed unchanged');
    cases.push('Rabbit calculator haste is temporary');
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
    assert(engine.fighters[0].status.some((status) => status.type === 'RABBIT_ZERO_HASTE' && status.duration === 2), 'Rabbit zero haste should add a temporary status');
    assert(engine.fighters[1].status.some((status) => status.type === 'ZEROED'), 'Rabbit zero should still zero the target');
    cases.push('Rabbit zero haste is temporary');
  }

  {
    const wt = makeFighter('M1A2_abrams_sep@A');
    const { engine, logs } = makeDeathEngine([wt, makeFighter('变身旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);

    assert(engine.fighters[0].job === 'WT_TOP_TIER', `War Thunder hook should transform to WT_TOP_TIER, got ${engine.fighters[0].job}`);
    assert(engine.fighters[0].status.some((status) => status.type === 'WT_ERA'), 'War Thunder hook should apply WT_ERA');
    assert(engine.fighters[0].status.some((status) => status.type === 'SPELL_BLOCK'), 'War Thunder hook should apply SPELL_BLOCK');
    assert(logs.some((entry) => entry.text.includes('顶级备用载具')), 'War Thunder hook should keep the original transform log');
    cases.push('War Thunder transform hook');
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
    engine.fighters.slice(1).forEach((target) => {
      target.maxHp = 5000;
      localProject.setCurrentHp(target, 5000);
    });

    withRandomSequence([0.5, 0.5, 0.5, 0.5, 0.5], () => {
      engine.executeSkillAction('wt_su30_cas', wt, engine.fighters[1]);
    });

    const damagedTargets = engine.fighters.slice(1).filter((target) => target.stats.dmgTaken > 0);
    const suppressedTargets = engine.fighters.slice(2).filter((target) => target.status.some((status) => status.type === 'WT_SUPPRESS'));
    assert(damagedTargets.length === 4, `Su-30 CAS should hit primary plus up to 3 splash targets, got ${damagedTargets.length}`);
    assert(engine.fighters[1].stats.dmgTaken === Math.floor(280 * 2.8), `Su-30 primary target should take full main damage, got ${engine.fighters[1].stats.dmgTaken}`);
    assert(engine.fighters[1].status.some((status) => status.type === 'WT_AIRBORNE'), 'Su-30 primary target should be knocked airborne');
    assert(suppressedTargets.length === 3, `Su-30 splash targets should be suppressed instead of all knocked airborne, got ${suppressedTargets.length}`);
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

    assert(engineWt.status.some((status) => status.type === 'AIM'), 'Laser rangefinder should still grant AIM designation');
    assert(engineWt.atk === atkBefore, `Laser rangefinder should not permanently stack attack, got ${engineWt.atk} from ${atkBefore}`);
    cases.push('War Thunder laser rangefinder does not permanently stack attack');
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
    wt.status.push({ type: 'AIM', duration: 3 });
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
    assert(!wt.status.some((status) => status.type === 'AIM'), 'Su-30 CAS should consume laser designation AIM');
    cases.push('War Thunder Su-30 CAS limits ammo-rack wipe and consumes laser designation');
  }

  {
    const sigua = makeFighter('丝瓜uli@A');
    const { engine, logs } = makeDeathEngine([sigua, makeFighter('选技旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    engine.fighters[0].ultPoints = 3;
    engine.fighters[0].economy = 0;

    const selectedSkill = withRandomSequence([0], () => engine.selectSkill(engine.fighters[0]));

    assert(selectedSkill === 'valo_ult_showstopper', `Valorant hook should select a charged ult, got ${selectedSkill}`);
    assert(engine.fighters[0].ultPoints === 0, 'Valorant hook should reset ult points after selecting an ult');
    assert(logs.some((entry) => entry.text.includes('大招充能完毕')), 'Valorant hook should keep the original ult-ready log');
    cases.push('Valorant skill-selection hook');
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
    assert(engine.fighters[0].agl > 0, 'Valorant Operator stance should reduce but not zero agility');
    assert(engine.fighters[0].savedAgl && engine.fighters[0].savedAgl > engine.fighters[0].agl, 'Valorant Operator stance should save original agility');
    cases.push('Valorant Operator stance keeps partial agility');
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
    engine.fighters[0].ultPoints = 3;
    engine.fighters[0].economy = 0;

    const selectedSkill = withRandomSequence([0.6, 0], () => engine.selectSkill(engine.fighters[0]));

    assert(selectedSkill === 'valo_ult_showstopper', `Non-gacha own-skill route should keep Valorant skill selection, got ${selectedSkill}`);
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

    engine.applyDamage(engine.fighters[0], engine.fighters[0].currentHp + 1000, 'test', true);
    assert(engine.fighters[0].currentHp === 1, 'Ting defiance should clamp the first lethal hit to 1 HP');
    assert(engine.fighters[0].status.some((status) => status.type === 'TING_DEFIANCE'), 'Ting defiance should add a timed status');

    engine.turnCount = 1;
    engine.finishStep({ current: false });
    engine.applyDamage(engine.fighters[0], 1000, 'test', true);
    assert(engine.fighters[0].currentHp === 1, 'Ting defiance should keep clamping lethal hits while active');

    for (let turn = 2; turn <= 4; turn += 1) {
      engine.turnCount = turn;
      engine.finishStep({ current: false });
    }
    assert(!engine.fighters[0].status.some((status) => status.type === 'TING_DEFIANCE'), 'Ting defiance should expire on the global status clock');
    engine.applyDamage(engine.fighters[0], 1000, 'test', true);
    assert(engine.fighters[0].currentHp <= 0, 'expired Ting defiance should allow lethal damage to defeat Ting');
    assert(logs.some((entry) => entry.text.includes('不甘倒下')), 'Ting defiance should keep its combat log');
    cases.push('Ting defiance expires on global clock');
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

    const selectedSkill = withRandomSequence([0.99], () => engine.selectSkill(engine.fighters[0]));

    assert(selectedSkill === 'chimera_install', `Succubus hook should select chimera_install, got ${selectedSkill}`);
    cases.push('Succubus install skill-selection hook');
  }

  {
    const succubus = makeFighter('克蕾儿丝菲尔@A');
    const { engine } = makeDeathEngine([succubus, makeFighter('选技旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    engine.fighters[0].jobData.skills.push('chimera_devour');

    const selectedSkill = withRandomSequence([0.1, 0.5, 0], () => engine.selectSkill(engine.fighters[0]));

    assert(selectedSkill === 'chimera_devour', `Succubus hook should select an installed chimera plugin, got ${selectedSkill}`);
    cases.push('Succubus plugin skill-selection hook');
  }

  return cases;
}
