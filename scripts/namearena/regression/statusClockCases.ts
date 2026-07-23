import {
  applyTestStatus,
  replaceTestStatuses,
  assert,
  localProject,
  makeFighter,
  withRandomSequence,
} from '../shared/harness';
import { makeDeathEngine } from './deathAccountingCases';
import {
  advanceLargeRoundTimedBarriers,
} from '../../../lib/namearena/statusProcessing';
import { grantBarrier } from '../../../lib/namearena/statusSystem';

export function runStatusClockCases(): string[] {
  const cases: string[] = [];

  {
    const fighter = makeFighter('全局计时测试@A');
    const { engine } = makeDeathEngine([fighter, makeFighter('旁观者@B')]);
    engine.turnCount = 0;
    engine.applyStatus(engine.fighters[0], { identityId: 'INVUL', remainingTurns: 2 });
    engine.advanceGlobalTimedStatuses();
    assert(engine.fighters[0].statuses.find((status) => status.identityId === 'INVUL')?.remainingTurns === 2, 'a global status must not tick at its application clock');
    engine.turnCount = 1;
    engine.advanceGlobalTimedStatuses();
    assert(engine.fighters[0].statuses.find((status) => status.identityId === 'INVUL')?.remainingTurns === 1, 'global status should tick once at the next global action');
    engine.turnCount = 2;
    engine.advanceGlobalTimedStatuses();
    assert(!engine.fighters[0].statuses.some((status) => status.identityId === 'INVUL'), 'global status should expire after its global duration');
    cases.push('global statuses tick on battle turns');
  }

  {
    const fighter = makeFighter('同回合全局测试@A');
    const { engine } = makeDeathEngine([fighter, makeFighter('旁观者@B')]);
    engine.turnCount = 7;
    engine.applyStatus(engine.fighters[0], { identityId: 'BKB', remainingTurns: 1 });
    engine.advanceGlobalTimedStatuses();
    const status = engine.fighters[0].statuses.find((entry) => entry.identityId === 'BKB');
    assert(status && status.remainingTurns === 1 && status.lastAdvancedAt === 7, 'global status should record and skip its application clock');
    engine.turnCount = 8;
    engine.advanceGlobalTimedStatuses();
    assert(!engine.fighters[0].statuses.some((entry) => entry.identityId === 'BKB'), 'global status should tick on the next battle turn');
    cases.push('new global statuses skip their application turn');
  }

  {
    const fighter = makeFighter('全局护盾计时测试@A');
    const { engine, logs } = makeDeathEngine([fighter, makeFighter('全局护盾旁观者@B')]);
    const target = engine.fighters[0];
    grantBarrier(target, 80, {
      sourceId: 'global-clock-barrier',
      displayName: '全局计时屏障',
      remainingTurns: 1,
      tickMode: 'global_action',
    });
    engine.turnCount = 7;
    engine.advanceGlobalTimedStatuses();
    assert(target.barriers?.some((barrier) => barrier.sourceId === 'global-clock-barrier' && barrier.remainingTurns === 1), 'a newly observed global barrier must not lose duration in its application action');
    engine.turnCount = 8;
    engine.advanceGlobalTimedStatuses();
    assert(!target.barriers?.some((barrier) => barrier.sourceId === 'global-clock-barrier'), 'a one-action global barrier should expire at the next global action end');
    assert(logs.some((entry) => entry.text.includes('全局计时屏障') && entry.text.includes('自然消散')), 'global barrier expiry should be visible in the combat log');
    cases.push('global barriers use the shared observed-action clock');
  }

  {
    const fighter = makeFighter('大回合护盾计时测试@A');
    const { engine, logs } = makeDeathEngine([fighter, makeFighter('大回合护盾旁观者@B')]);
    const target = engine.fighters[0];
    grantBarrier(target, 90, {
      sourceId: 'large-round-clock-barrier',
      displayName: '大回合计时屏障',
      remainingTurns: 1,
      tickMode: 'large_round',
    });
    advanceLargeRoundTimedBarriers(engine.fighters, 3, (type, text) => engine.log(type, text));
    assert(target.barriers?.some((barrier) => barrier.sourceId === 'large-round-clock-barrier' && barrier.remainingTurns === 1), 'a newly observed large-round barrier must survive the round in which it was applied');
    advanceLargeRoundTimedBarriers(engine.fighters, 4, (type, text) => engine.log(type, text));
    assert(!target.barriers?.some((barrier) => barrier.sourceId === 'large-round-clock-barrier'), 'a one-round barrier should expire at the following large-round end');
    assert(logs.some((entry) => entry.text.includes('大回合计时屏障') && entry.text.includes('自然消散')), 'large-round barrier expiry should be visible in the combat log');
    cases.push('large-round barriers use the shared observed-round clock');
  }

  {
    const fighter = makeFighter('回合末新增全局状态@A');
    const { engine } = makeDeathEngine([fighter, makeFighter('回合末新增旁观者@B')]);
    engine.turnCount = 7;
    engine.applyStatus(engine.fighters[0], { identityId: 'BKB', remainingTurns: 1 });
    assert(engine.fighters[0].statuses[0]?.lastAdvancedAt === 7, 'A global status created after the regular clock pass should retain its creation clock');

    engine.turnCount = 8;
    engine.advanceGlobalTimedStatuses();
    assert(!engine.fighters[0].statuses.some((status) => status.identityId === 'BKB'), 'A one-turn status created in an end hook should expire on the next action instead of surviving an extra action');
    cases.push('end-hook global status does not gain an extra action');
  }

  {
    const fighter = makeFighter('永久状态测试@A');
    replaceTestStatuses(fighter, [{ identityId: 'STYLE_ANGRY' }, { identityId: 'PLUG_HEAD' }, { identityId: 'LIQUID_BODY' }, { identityId: 'WT_ERA' }]);
    const { engine } = makeDeathEngine([fighter, makeFighter('旁观者@B')]);
    engine.processStatus(engine.fighters[0]);
    engine.turnCount = 1;
    engine.advanceGlobalTimedStatuses();
    ['STYLE_ANGRY', 'PLUG_HEAD', 'LIQUID_BODY', 'WT_ERA'].forEach((type) => {
      const status = engine.fighters[0].statuses.find((entry) => entry.identityId === type);
      assert(status?.tickMode === 'permanent' && status.expiresOn === 'never' && status.remainingTurns === undefined, `${type} should remain permanently registered without a fake duration`);
    });
    cases.push('permanent statuses do not tick');
  }

  {
    const fighter = makeFighter('触发状态测试@A');
    replaceTestStatuses(fighter, [{ identityId: 'AIM', charges: 3 }, { identityId: 'COUNTER', remainingTurns: 2 }, { identityId: 'SPELL_BLOCK', charges: 1 }, { identityId: 'VALO_HOLDING_ANGLE', remainingTurns: 3 }, { identityId: 'WAIT_COUNTER', charges: 3 }]);
    const { engine } = makeDeathEngine([fighter, makeFighter('旁观者@B')]);
    engine.processStatus(engine.fighters[0]);
    engine.turnCount = 1;
    engine.advanceGlobalTimedStatuses();
    const statuses = engine.fighters[0].statuses;
    assert(statuses.find((status) => status.identityId === 'AIM')?.charges === 1, 'AIM should be an explicit one-use trigger');
    assert(statuses.find((status) => status.identityId === 'SPELL_BLOCK')?.charges === 1, 'SPELL_BLOCK should expose one trigger charge');
    assert(statuses.find((status) => status.identityId === 'WAIT_COUNTER')?.charges === 1, 'WAIT_COUNTER should always be a one-use stance');
    assert(statuses.find((status) => status.identityId === 'COUNTER')?.remainingTurns === 1, 'COUNTER should have an explicit owner-turn expiry');
    assert(statuses.find((status) => status.identityId === 'VALO_HOLDING_ANGLE')?.remainingTurns === 2, 'holding angle should have an explicit owner-turn expiry');
    cases.push('status charges and turn duration use separate clocks');
  }

  {
    const waiter = makeFighter('等待反击者@A');
    const mover = makeFighter('普通行动者@B');
    waiter.spd = 999999;
    mover.spd = 1;
    replaceTestStatuses(waiter, [{ identityId: 'WAIT_COUNTER', charges: 4 }]);
    const { engine } = makeDeathEngine([waiter, mover]);
    const alive = engine.fighters.filter((fighter) => engine.isActiveCombatant(fighter));
    for (let i = 0; i < 20; i += 1) {
      assert(engine.determineActor(alive)?.id === engine.fighters[1].id, 'waiting counter holders should yield active turns until someone attacks them');
    }
    cases.push('waiting counter holders yield active turn selection');
  }

  {
    const fighter = makeFighter('个人计时测试@A');
    replaceTestStatuses(fighter, [{ identityId: 'STUN', remainingTurns: 2 }, { identityId: 'POISON', remainingTurns: 2 }, { identityId: 'CTR_CHARM', remainingTurns: 5 }]);
    const { engine } = makeDeathEngine([fighter, makeFighter('旁观者@B')]);
    const canAct = engine.processStatus(engine.fighters[0]);
    assert(!canAct, 'control status should block the owner action while ticking');
    assert(engine.fighters[0].statuses.find((status) => status.identityId === 'STUN')?.remainingTurns === 1, 'self-timed control should tick on owner turn');
    assert(engine.fighters[0].statuses.find((status) => status.identityId === 'POISON')?.remainingTurns === 1, 'self-timed DoT should tick on owner turn');
    assert(engine.fighters[0].statuses.find((status) => status.identityId === 'CTR_CHARM')?.remainingTurns === 4, 'non-passive counter stance should tick down if it is not triggered');
    assert(engine.fighters[0].stats.dmgTaken > 0, 'self-timed DoT should apply damage on owner turn');
    cases.push('self-timed statuses tick on owner turns');
  }

  {
    const fighter = makeFighter('控制末回合测试@A');
    const opponent = makeFighter('控制日志旁观者@B');
    fighter.spd = 100000;
    opponent.spd = 1;
    replaceTestStatuses(fighter, [{ identityId: 'STUN', remainingTurns: 1 }]);
    const { engine, logs } = makeDeathEngine([fighter, opponent]);

    withRandomSequence([0], () => {
      engine.step({ current: false });
    });

    assert(!engine.fighters[0].statuses.some((status) => status.identityId === 'STUN'), 'One-turn control should expire after consuming the owner action');
    assert(logs.some((entry) => entry.text.includes(engine.fighters[0].name) && entry.text.includes('【眩晕】') && entry.text.includes('无法行动')), 'The final control turn should still explain why the fighter lost the action');
    cases.push('expiring control still logs the skipped action cause');
  }

  {
    const tokusatsu = makeFighter('刺猬人@A');
    const opponent = makeFighter('悲愿旁观者@B');
    const monsterJob = localProject.jobs.MIRACLE_MONSTER_BUJIN;
    assert(monsterJob, 'MIRACLE_MONSTER_BUJIN job should exist for status processing defiance tests');
    tokusatsu.job = 'MIRACLE_MONSTER_BUJIN';
    tokusatsu.jobData = JSON.parse(JSON.stringify(monsterJob)) as typeof monsterJob;
    tokusatsu.transformed = true;
    tokusatsu.maxHp = 4000;
    localProject.setCurrentHp(tokusatsu, 100);
    replaceTestStatuses(tokusatsu, [{ identityId: 'CONFUSED', remainingTurns: 2 }, { identityId: 'POISON', remainingTurns: 2 }]);
    const { engine } = makeDeathEngine([tokusatsu, opponent]);
    const canAct = engine.processStatus(engine.fighters[0]);
    const remainingTypes = engine.fighters[0].statuses.map((status) => status.identityId);

    assert(canAct, 'lethal DoT defiance should cleanse soft control and leave the queued instant action available');
    assert(engine.fighters[0].currentHp > 0, 'Tokusatsu defiance should survive lethal DoT during status processing');
    assert(!remainingTypes.includes('CONFUSED'), 'cleansed control should not be restored after lethal DoT defiance');
    assert(!remainingTypes.includes('POISON'), 'cleansed DoT should not be restored after lethal DoT defiance');
    assert(remainingTypes.includes('TOKUSATSU_DEFIANCE'), 'defiance status should remain visible after status processing');
    assert(remainingTypes.includes('BKB'), 'newly granted control immunity should survive status processing');
    assert(engine.fighters[0].tokusatsuInstantActionQueued, 'lethal DoT defiance should queue the instant counter');
    cases.push('lethal DoT defiance cleanses soft control without restoring it');
  }

  {
    const ting = makeFighter('小汀@A');
    const opponent = makeFighter('持续伤害旁观者@B');
    const grudgeJob = localProject.jobs.GRUDGE_SUICIDER;
    assert(grudgeJob, 'GRUDGE_SUICIDER job should exist for active defiance status tests');
    ting.job = 'GRUDGE_SUICIDER';
    ting.jobData = JSON.parse(JSON.stringify(grudgeJob)) as typeof grudgeJob;
    ting.transformed = true;
    ting.maxHp = 3700;
    localProject.setCurrentHp(ting, 1);
    replaceTestStatuses(ting, [{ identityId: 'TING_DEFIANCE', remainingTurns: 3 }, { identityId: 'POISON', remainingTurns: 2 }]);
    const { engine, logs } = makeDeathEngine([ting, opponent]);
    engine.processStatus(engine.fighters[0]);

    assert(engine.fighters[0].currentHp === 1, 'active Ting defiance should keep lethal DoT at 1 HP');
    assert(!engine.fighters[0].isDead && !engine.fighters[0].isDeadAnnounced, 'active Ting defiance should prevent DoT death');
    assert(logs.some((entry) => entry.text.includes('不甘倒下') && entry.text.includes('压回 1 点生命')), 'active Ting defiance should explain the rewritten lethal DoT');
    assert(logs.some((entry) => entry.text.includes('【中毒】') && entry.text.includes('生命未减少')), 'active Ting defiance should report zero net HP loss from lethal DoT');
    assert(!logs.some((entry) => entry.text.includes('【中毒】') && entry.text.includes('实际损失 1 点')), 'active Ting defiance must not report transient zero-HP damage as actual loss');
    cases.push('active Ting defiance rewrites lethal DoT');
  }

  {
    const attacker = makeFighter('锁头攻击者@A');
    const target = makeFighter('锁头靶子@B');
    applyTestStatus(attacker, { identityId: 'AIM', charges: 3 });
    attacker.atk = 100;
    attacker.agl = 10000;
    target.maxHp = 100000;
    localProject.setCurrentHp(target, 100000);
    const { engine } = makeDeathEngine([attacker, target]);
    engine.executeSkillAction('serious_punch', engine.fighters[0], engine.fighters[1]);
    assert(!engine.fighters[0].statuses.some((status) => status.identityId === 'AIM'), 'AIM should be consumed after an offensive action');
    cases.push('AIM is consumed by the next offensive action');
  }

  {
    const attacker = makeFighter('反击攻击者@A');
    const target = makeFighter('反击持有者@B');
    attacker.atk = 100;
    attacker.agl = 10000;
    applyTestStatus(attacker, { identityId: 'AIM', charges: 1 });
    attacker.maxHp = 100000;
    localProject.setCurrentHp(attacker, 100000);
    target.maxHp = 100000;
    localProject.setCurrentHp(target, 100000);
    applyTestStatus(target, { identityId: 'COUNTER', remainingTurns: 2 });
    const { engine } = makeDeathEngine([attacker, target]);
    engine.executeSkillAction('serious_punch', engine.fighters[0], engine.fighters[1]);
    assert(!engine.fighters[1].statuses.some((status) => status.identityId === 'COUNTER'), 'COUNTER should be consumed by reflection');
    cases.push('COUNTER is consumed by reflection');
  }

  {
    const counterCases = [
      { type: 'CTR_CHARM', label: '魅惑反击', appliedStatus: 'CHARMED' },
      { type: 'CTR_STUN', label: '震慑反击', appliedStatus: 'STUN' },
      { type: 'CTR_DRAIN', label: '汲取反击' },
      { type: 'CTR_POISON', label: '剧毒反击', appliedStatus: 'POISON' },
      { type: 'CTR_BURN', label: '烈焰反击', appliedStatus: 'BURN' },
      { type: 'CTR_FREEZE', label: '极寒反击', appliedStatus: 'FREEZE' },
      { type: 'CTR_VOID', label: '虚空反击' },
      { type: 'CTR_WEAK', label: '虚弱反击' },
      { type: 'CTR_CONFUSE', label: '混乱反击', appliedStatus: 'CONFUSED' },
      { type: 'CTR_EXECUTE', label: '断头反击' },
    ];

    counterCases.forEach((counterCase) => {
      const attacker = makeFighter(`反击日志攻击者-${counterCase.type}@A`);
      const target = makeFighter(`反击日志持有者-${counterCase.type}@B`);
      attacker.atk = 100;
      attacker.agl = 10000;
      attacker.maxHp = 100000;
      localProject.setCurrentHp(attacker, 100000);
      target.maxHp = 100000;
      localProject.setCurrentHp(target, 100000);
      applyTestStatus(target, { identityId: counterCase.type, remainingTurns: 5 });

      const { engine, logs } = makeDeathEngine([attacker, target]);
      withRandomSequence([0.5, 0.5, 0.5], () => {
        engine.executeSkillAction('serious_punch', engine.fighters[0], engine.fighters[1]);
      });
      const joinedLogs = logs.map((entry) => entry.text).join('\n');

      assert(
        joinedLogs.includes(`【${counterCase.label}】`) &&
          joinedLogs.includes(engine.fighters[0].name) &&
          joinedLogs.includes(engine.fighters[1].name),
        `${counterCase.type} should log its concrete counter outcome with both fighters`,
      );
      if (counterCase.appliedStatus) {
        assert(
          engine.fighters[0].statuses.some((status) => status.identityId === counterCase.appliedStatus),
          `${counterCase.type} should apply ${counterCase.appliedStatus} to the attacker`,
        );
      }
    });
    cases.push('CTR counter statuses log concrete outcomes');
  }

  {
    const slacker = makeFighter('丝瓜uli@S');
    const enemyA = makeFighter('摸鱼旁观A@A');
    const enemyB = makeFighter('摸鱼旁观B@B');
    slacker.wasSynergySlacking = true;
    replaceTestStatuses(slacker, [
      { identityId: 'SYNERGY_SLACKING', remainingTurns: 1, groupId: 'slacking_off_field', attribution: { effectSourceId: 'slacking_off_field' }, observedAt: { globalAction: 0 } },
      { identityId: 'INVUL', remainingTurns: 1, groupId: 'slacking_off_field', attribution: { effectSourceId: 'slacking_off_field' }, observedAt: { globalAction: 0 } },
      { identityId: 'BKB', remainingTurns: 1, groupId: 'slacking_off_field', attribution: { effectSourceId: 'slacking_off_field' }, observedAt: { globalAction: 0 } },
      { identityId: 'STUN', remainingTurns: 5, groupId: 'slacking_off_field', attribution: { effectSourceId: 'slacking_off_field' }, observedAt: { globalAction: 0 } },
      { identityId: 'SPELL_BLOCK' },
    ]);
    const { engine, logs } = makeDeathEngine([slacker, enemyA, enemyB]);
    engine.turnCount = 1;
    engine.finishStep({ current: false });
    const returned = engine.fighters[0];
    const remaining = returned.statuses.map((status) => status.identityId);
    assert(!returned.wasSynergySlacking, 'slacking fighter should clear slacking marker after natural global expiry');
    ['SYNERGY_SLACKING', 'INVUL', 'BKB', 'STUN', 'SPELL_BLOCK'].forEach((type) => {
      assert(!remaining.includes(type), `${type} should be removed when slacking fighter returns`);
    });
    assert(returned.currentHp === returned.maxHp, 'slacking return should restore full HP');
    assert(logs.filter((entry) => entry.text.includes('【状态结束】') && entry.text.includes('【场外OB】')).length === 1, 'slacking bundle should emit exactly one theme-level expiry log');
    assert(!logs.some((entry) => entry.text.includes('【状态变化】') && entry.text.includes('【场外OB】')), 'slacking bundle must not expose intermediate invulnerability/control components');
    cases.push('slacking global expiry triggers immediate clean return');
  }

  return cases;
}
