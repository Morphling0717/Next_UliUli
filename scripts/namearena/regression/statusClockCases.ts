import {
  assert,
  localProject,
  makeFighter,
  withRandomSequence,
} from '../shared/harness';
import { makeDeathEngine } from './deathAccountingCases';
import { stampNewGlobalTimedStatuses } from '../../../lib/namearena/statusProcessing';

export function runStatusClockCases(): string[] {
  const cases: string[] = [];

  {
    const fighter = makeFighter('全局计时测试@A');
    fighter.status = [{ type: 'INVUL', duration: 2, appliedTurn: 0 }];
    const { engine } = makeDeathEngine([fighter, makeFighter('旁观者@B')]);
    engine.turnCount = 1;
    engine.advanceGlobalTimedStatuses();
    assert(engine.fighters[0].status.find((status) => status.type === 'INVUL')?.duration === 1, 'global status should tick on global battle turns');
    engine.turnCount = 2;
    engine.advanceGlobalTimedStatuses();
    assert(!engine.fighters[0].status.some((status) => status.type === 'INVUL'), 'global status should expire after its global duration');
    cases.push('global statuses tick on battle turns');
  }

  {
    const fighter = makeFighter('同回合全局测试@A');
    fighter.status = [{ type: 'BKB', duration: 1 }];
    const { engine } = makeDeathEngine([fighter, makeFighter('旁观者@B')]);
    engine.turnCount = 7;
    engine.advanceGlobalTimedStatuses();
    const status = engine.fighters[0].status.find((entry) => entry.type === 'BKB');
    assert(status && status.duration === 1 && status.appliedTurn === 7, 'global status should not tick on the same turn it is first observed');
    engine.turnCount = 8;
    engine.advanceGlobalTimedStatuses();
    assert(!engine.fighters[0].status.some((entry) => entry.type === 'BKB'), 'global status should tick on the next battle turn');
    cases.push('new global statuses skip their application turn');
  }

  {
    const fighter = makeFighter('回合末新增全局状态@A');
    const { engine } = makeDeathEngine([fighter, makeFighter('回合末新增旁观者@B')]);
    engine.turnCount = 7;
    engine.fighters[0].status.push({ type: 'BKB', duration: 1 });
    stampNewGlobalTimedStatuses(engine.fighters, engine.turnCount);
    assert(engine.fighters[0].status[0]?.appliedTurn === 7, 'A global status created after the regular clock pass should be stamped in its creation turn');

    engine.turnCount = 8;
    engine.advanceGlobalTimedStatuses();
    assert(!engine.fighters[0].status.some((status) => status.type === 'BKB'), 'A one-turn status created in an end hook should expire on the next action instead of surviving an extra action');
    cases.push('end-hook global status does not gain an extra action');
  }

  {
    const fighter = makeFighter('永久状态测试@A');
    fighter.status = [
      { type: 'STYLE_ANGRY', duration: 999 },
      { type: 'PLUG_HEAD', duration: 999 },
      { type: 'LIQUID_BODY', duration: 999 },
      { type: 'WT_ERA', duration: 999 },
    ];
    const { engine } = makeDeathEngine([fighter, makeFighter('旁观者@B')]);
    engine.processStatus(engine.fighters[0]);
    engine.turnCount = 1;
    engine.advanceGlobalTimedStatuses();
    ['STYLE_ANGRY', 'PLUG_HEAD', 'LIQUID_BODY', 'WT_ERA'].forEach((type) => {
      assert(engine.fighters[0].status.find((status) => status.type === type)?.duration === 999, `${type} should not tick down`);
    });
    cases.push('permanent statuses do not tick');
  }

  {
    const fighter = makeFighter('触发状态测试@A');
    fighter.status = [
      { type: 'AIM', duration: 3 },
      { type: 'COUNTER', duration: 2 },
      { type: 'SPELL_BLOCK', duration: 1 },
      { type: 'VALO_HOLDING_ANGLE', duration: 3 },
      { type: 'WAIT_COUNTER', duration: 3 },
    ];
    const { engine } = makeDeathEngine([fighter, makeFighter('旁观者@B')]);
    engine.processStatus(engine.fighters[0]);
    engine.turnCount = 1;
    engine.advanceGlobalTimedStatuses();
    const statuses = engine.fighters[0].status;
    assert(statuses.find((status) => status.type === 'AIM')?.charges === 1, 'AIM should be an explicit one-use trigger');
    assert(statuses.find((status) => status.type === 'SPELL_BLOCK')?.charges === 1, 'SPELL_BLOCK should expose one trigger charge');
    assert(statuses.find((status) => status.type === 'WAIT_COUNTER')?.charges === 1, 'WAIT_COUNTER should always be a one-use stance');
    assert(statuses.find((status) => status.type === 'COUNTER')?.remainingTurns === 1, 'COUNTER should have an explicit owner-turn expiry');
    assert(statuses.find((status) => status.type === 'VALO_HOLDING_ANGLE')?.remainingTurns === 2, 'holding angle should have an explicit owner-turn expiry');
    cases.push('status charges and turn duration use separate clocks');
  }

  {
    const waiter = makeFighter('等待反击者@A');
    const mover = makeFighter('普通行动者@B');
    waiter.spd = 999999;
    mover.spd = 1;
    waiter.status = [{ type: 'WAIT_COUNTER', duration: 4 }];
    const { engine } = makeDeathEngine([waiter, mover]);
    const alive = engine.fighters.filter((fighter) => engine.isActiveCombatant(fighter));
    for (let i = 0; i < 20; i += 1) {
      assert(engine.determineActor(alive)?.id === engine.fighters[1].id, 'waiting counter holders should yield active turns until someone attacks them');
    }
    cases.push('waiting counter holders yield active turn selection');
  }

  {
    const fighter = makeFighter('个人计时测试@A');
    fighter.status = [
      { type: 'STUN', duration: 2 },
      { type: 'POISON', duration: 2 },
      { type: 'CTR_CHARM', duration: 5 },
    ];
    const { engine } = makeDeathEngine([fighter, makeFighter('旁观者@B')]);
    const canAct = engine.processStatus(engine.fighters[0]);
    assert(!canAct, 'control status should block the owner action while ticking');
    assert(engine.fighters[0].status.find((status) => status.type === 'STUN')?.duration === 1, 'self-timed control should tick on owner turn');
    assert(engine.fighters[0].status.find((status) => status.type === 'POISON')?.duration === 1, 'self-timed DoT should tick on owner turn');
    assert(engine.fighters[0].status.find((status) => status.type === 'CTR_CHARM')?.duration === 4, 'non-passive counter stance should tick down if it is not triggered');
    assert(engine.fighters[0].stats.dmgTaken > 0, 'self-timed DoT should apply damage on owner turn');
    cases.push('self-timed statuses tick on owner turns');
  }

  {
    const fighter = makeFighter('控制末回合测试@A');
    const opponent = makeFighter('控制日志旁观者@B');
    fighter.spd = 100000;
    opponent.spd = 1;
    fighter.status = [{ type: 'STUN', duration: 1 }];
    const { engine, logs } = makeDeathEngine([fighter, opponent]);

    withRandomSequence([0], () => {
      engine.step({ current: false });
    });

    assert(!engine.fighters[0].status.some((status) => status.type === 'STUN'), 'One-turn control should expire after consuming the owner action');
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
    tokusatsu.status = [
      { type: 'CONFUSED', duration: 2 },
      { type: 'POISON', duration: 2 },
    ];
    const { engine } = makeDeathEngine([tokusatsu, opponent]);
    const canAct = engine.processStatus(engine.fighters[0]);
    const remainingTypes = engine.fighters[0].status.map((status) => status.type);

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
    ting.status = [
      { type: 'TING_DEFIANCE', duration: 3 },
      { type: 'BURN', duration: 2 },
    ];
    const { engine, logs } = makeDeathEngine([ting, opponent]);
    engine.processStatus(engine.fighters[0]);

    assert(engine.fighters[0].currentHp === 1, 'active Ting defiance should keep lethal DoT at 1 HP');
    assert(!engine.fighters[0].isDead && !engine.fighters[0].isDeadAnnounced, 'active Ting defiance should prevent DoT death');
    assert(logs.some((entry) => entry.text.includes('不甘倒下') && entry.text.includes('压回 1 点生命')), 'active Ting defiance should explain the rewritten lethal DoT');
    cases.push('active Ting defiance rewrites lethal DoT');
  }

  {
    const attacker = makeFighter('锁头攻击者@A');
    const target = makeFighter('锁头靶子@B');
    attacker.status.push({ type: 'AIM', duration: 3 });
    attacker.atk = 100;
    attacker.agl = 10000;
    target.maxHp = 100000;
    localProject.setCurrentHp(target, 100000);
    const { engine } = makeDeathEngine([attacker, target]);
    engine.executeSkillAction('serious_punch', engine.fighters[0], engine.fighters[1]);
    assert(!engine.fighters[0].status.some((status) => status.type === 'AIM'), 'AIM should be consumed after an offensive action');
    cases.push('AIM is consumed by the next offensive action');
  }

  {
    const attacker = makeFighter('反击攻击者@A');
    const target = makeFighter('反击持有者@B');
    attacker.atk = 100;
    attacker.agl = 10000;
    attacker.status.push({ type: 'AIM', duration: 1 });
    attacker.maxHp = 100000;
    localProject.setCurrentHp(attacker, 100000);
    target.maxHp = 100000;
    localProject.setCurrentHp(target, 100000);
    target.status.push({ type: 'COUNTER', duration: 2 });
    const { engine } = makeDeathEngine([attacker, target]);
    engine.executeSkillAction('serious_punch', engine.fighters[0], engine.fighters[1]);
    assert(!engine.fighters[1].status.some((status) => status.type === 'COUNTER'), 'COUNTER should be consumed by reflection');
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
      target.status.push({ type: counterCase.type, duration: 5 });

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
          engine.fighters[0].status.some((status) => status.type === counterCase.appliedStatus),
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
    slacker.status = [
      { type: 'SYNERGY_SLACKING', duration: 1, appliedTurn: 0 },
      { type: 'INVUL', duration: 1, appliedTurn: 0 },
      { type: 'BKB', duration: 1, appliedTurn: 0 },
      { type: 'STUN', duration: 5 },
      { type: 'SPELL_BLOCK', duration: 999 },
    ];
    const { engine } = makeDeathEngine([slacker, enemyA, enemyB]);
    engine.turnCount = 1;
    engine.finishStep({ current: false });
    const returned = engine.fighters[0];
    const remaining = returned.status.map((status) => status.type);
    assert(!returned.wasSynergySlacking, 'slacking fighter should clear slacking marker after natural global expiry');
    ['SYNERGY_SLACKING', 'INVUL', 'BKB', 'STUN', 'SPELL_BLOCK'].forEach((type) => {
      assert(!remaining.includes(type), `${type} should be removed when slacking fighter returns`);
    });
    assert(returned.currentHp === returned.maxHp, 'slacking return should restore full HP');
    cases.push('slacking global expiry triggers immediate clean return');
  }

  return cases;
}
