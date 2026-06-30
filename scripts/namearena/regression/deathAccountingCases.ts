import type { Fighter, SpinalSwordRef } from '../../../lib/namearena/types';
import {
  assert,
  localProject,
  makeEngine,
  makeFighter,
  type BattleEngineInstance,
  type LogEntry,
} from '../shared/harness';

export type DeathEngineFixture = {
  engine: BattleEngineInstance;
  logs: LogEntry[];
};

export function makeDeathEngine(fighters: Fighter[], logs: LogEntry[] = []): DeathEngineFixture {
  const cloned = localProject.cloneFighters(fighters);
  return { engine: makeEngine(cloned, logs), logs };
}

export function runDeathAccountingCases(): string[] {
  const cases: string[] = [];

  {
    const attacker = makeFighter('死亡结算杀手@A');
    const target = makeFighter('死亡结算靶子@B');
    attacker.atk = 10000;
    attacker.agl = 10000;
    target.maxHp = 100;
    localProject.setCurrentHp(target, 100);

    const { engine, logs } = makeDeathEngine([attacker, target]);
    engine.executeSkillAction('serious_punch', engine.fighters[0], engine.fighters[1]);
    engine.handleDeathsAndRevives({ current: false });
    engine.handleDeathsAndRevives({ current: false });

    assert(engine.fighters[1].isDead, 'normal lethal hit should finalize target death');
    assert(engine.fighters[0].stats.kills === 1, `normal lethal hit should award exactly one kill, got ${engine.fighters[0].stats.kills}`);
    assert(logs.filter((entry) => entry.text.includes('【击杀】') && entry.text.includes('击败')).length === 1, 'normal lethal hit should log one kill message');
    cases.push('normal lethal hit awards exactly one kill');
  }

  {
    const attacker = makeFighter('反伤测试攻击者@A');
    const target = makeFighter('反伤测试目标@B');
    attacker.maxHp = 100;
    localProject.setCurrentHp(attacker, 100);
    attacker.atk = 80;
    attacker.agl = 10000;
    target.maxHp = 10000;
    localProject.setCurrentHp(target, 10000);
    target.status.push({ type: 'COUNTER', duration: 3 });

    const { engine, logs } = makeDeathEngine([attacker, target]);
    engine.executeSkillAction('serious_punch', engine.fighters[0], engine.fighters[1]);
    engine.handleDeathsAndRevives({ current: false });
    engine.handleDeathsAndRevives({ current: false });

    assert(engine.fighters[0].isDead, 'counter reflection should finalize attacker death');
    assert(engine.fighters[1].stats.kills === 1, `counter reflection should award exactly one kill, got ${engine.fighters[1].stats.kills}`);
    assert(logs.filter((entry) => entry.text.includes('反弹伤害反死')).length === 1, 'counter reflection should log one death message');
    cases.push('counter reflection awards defender exactly one kill');
  }

  {
    const attacker = makeFighter('再火击杀者@A');
    const target = makeFighter('再火目标@B');
    target.status.push({ type: 'VALO_ULT_RUN_IT_BACK', duration: 3 });

    const { engine } = makeDeathEngine([attacker, target]);
    engine.markDefeated(engine.fighters[1], { message: '💀 【测试】再火目标受到致命伤。', killer: engine.fighters[0] });
    engine.handleDeathsAndRevives({ current: false });
    engine.handleDeathsAndRevives({ current: false });

    assert(!engine.fighters[1].isDead, 'run it back should prevent finalized death');
    assert(!engine.fighters[1].isDeadAnnounced, 'run it back should clear death announcement');
    assert(engine.fighters[1].currentHp === engine.fighters[1].maxHp, 'run it back should restore full HP');
    assert(engine.fighters[0].stats.kills === 1, `run it back should not duplicate kill accounting, got ${engine.fighters[0].stats.kills}`);
    cases.push('run it back restores target without duplicate accounting');
  }

  {
    const attacker = makeFighter('脊髓剑击杀者@A');
    const ting = makeFighter('小汀@B');
    const spinalSwordRef: SpinalSwordRef = { current: false };
    const { engine, logs } = makeDeathEngine([attacker, ting]);

    engine.markDefeated(engine.fighters[1], { message: '💀 【测试】小汀受到致命伤。', killer: engine.fighters[0] });
    engine.handleDeathsAndRevives(spinalSwordRef);
    engine.handleDeathsAndRevives(spinalSwordRef);

    assert(engine.fighters[1].isDead, 'Ting should remain dead after finalization');
    assert(engine.fighters[1].hasDroppedSword, 'Ting should mark spinal sword as dropped');
    assert(spinalSwordRef.current, 'Ting death should leave spinal sword on the field');
    assert(engine.fighters[0].stats.kills === 1, `Ting death should award exactly one kill, got ${engine.fighters[0].stats.kills}`);
    assert(logs.filter((entry) => entry.text.includes('脊髓剑')).length === 1, 'Ting should drop spinal sword exactly once');
    cases.push('Ting death drops spinal sword exactly once');
  }

  {
    const attacker = makeFighter('屑击杀者@A');
    const teammate = makeFighter('屑队友@J');
    const joker = makeFighter('屑@J');
    attacker.maxHp = 200000;
    localProject.setCurrentHp(attacker, 200000);
    const spinalSwordRef: SpinalSwordRef = { current: false };
    const { engine, logs } = makeDeathEngine([attacker, teammate, joker]);

    engine.markDefeated(engine.fighters[2], { message: '💀 【测试】屑受到致命伤。', killer: engine.fighters[0] });
    engine.handleDeathsAndRevives(spinalSwordRef);
    assert(engine.fighters[2].isDead, 'Joker should be dead while revival countdown is active');
    assert((engine.fighters[2].reviveTurns ?? 0) === 4, `Joker countdown should tick to 4 after first settlement, got ${engine.fighters[2].reviveTurns}`);
    assert(engine.fighters[0].stats.kills === 1, `Joker initial death should award exactly one kill, got ${engine.fighters[0].stats.kills}`);

    for (let i = 0; i < 4; i += 1) engine.handleDeathsAndRevives(spinalSwordRef);

    assert(!engine.fighters[2].isDead, 'Joker should revive after countdown');
    assert(engine.fighters[2].hasResurrected, 'Joker should mark resurrection as consumed');
    assert(!engine.fighters[2].isDeadAnnounced, 'Joker revive should clear death announcement');
    assert(engine.fighters[0].stats.kills === 1, `Joker settlement should not duplicate attacker kills, got ${engine.fighters[0].stats.kills}`);
    const countdownIndex = logs.findIndex((entry) => entry.text.includes('返场倒计时'));
    const reviveIndex = logs.findIndex((entry) => entry.text.includes('从地狱归来'));
    assert(countdownIndex >= 0 && reviveIndex >= 0 && countdownIndex < reviveIndex, 'Joker death should explain the revival countdown before returning');
    assert(logs.filter((entry) => entry.text.includes('从地狱归来')).length === 1, 'Joker should revive exactly once');
    cases.push('Joker death countdown revives without duplicate accounting');
  }

  return cases;
}
