import {
  assert,
  localProject,
  makeFighter,
} from '../shared/harness';
import { makeDeathEngine } from './deathAccountingCases';

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
    const before = fighter.status.map((status) => `${status.type}:${status.duration}`).sort().join(',');
    const { engine } = makeDeathEngine([fighter, makeFighter('旁观者@B')]);
    engine.processStatus(engine.fighters[0]);
    engine.turnCount = 1;
    engine.advanceGlobalTimedStatuses();
    const after = engine.fighters[0].status.map((status) => `${status.type}:${status.duration}`).sort().join(',');
    assert(after === before, `trigger statuses should wait for their trigger, before=${before}, after=${after}`);
    cases.push('trigger statuses do not tick down passively');
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
