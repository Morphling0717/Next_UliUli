import type { Fighter } from '../../../lib/namearena/types';
import {
  applyTestStatus,
  applySlacking,
  assert,
  assertUnchanged,
  localProject,
  makeEngine,
  makeFighter,
    snapshot,
    withRandomSequence,
    withSeed,
  type BattleEngineInstance,
  type LogEntry,
} from '../shared/harness';

type SlackingAction = (engine: BattleEngineInstance, attacker: Fighter, sigua: Fighter) => void;

export function runSlackingIsolation(): string[] {
  const cases: string[] = [];

  function actionCase(label: string, action: SlackingAction): void {
    const logs: LogEntry[] = [];
    const attacker = makeFighter('M1A2_abrams_sep@attacker');
    const sigua = applySlacking(makeFighter('丝瓜uli@away'));
    const bunny = applySlacking(makeFighter('兔卷卷@away'));
    const dummy = makeFighter('测试靶子@away');
    const fighters = localProject.cloneFighters([attacker, sigua, bunny, dummy]);
    const before = snapshot(fighters.filter((fighter) => fighter.name === '丝瓜uli' || fighter.name === '兔卷卷'));
    const engine = makeEngine(fighters, logs);
    const siguaTarget = engine.fighters.find((fighter) => fighter.name === '丝瓜uli');
    assert(siguaTarget, 'missing slacking sigua target');
    action(engine, engine.fighters[0], siguaTarget);
    assertUnchanged(before, engine.fighters, ['丝瓜uli', '兔卷卷']);
    const joined = logs.map((entry) => entry.text).join('\n');
    assert(!/丝瓜uli.*承受|兔卷卷.*承受|对 丝瓜uli|对 兔卷卷|攻击了 丝瓜uli|攻击了 兔卷卷/.test(joined), `${label} hit a slacking fighter:\n${joined}`);
    cases.push(label);
  }

  actionCase('forced single-target skill cannot hit slacking target', (engine, attacker, sigua) => {
    engine.executeSkillAction('wt_t58_knockup', attacker, sigua);
  });
  actionCase('su30 cas excludes slacking fighters', (engine, attacker) => {
    engine.executeSkillAction('wt_su30_cas', attacker);
  });
  actionCase('megaphone excludes slacking fighters', (engine, attacker) => {
    engine.executeSkillAction('v_rabbit_megaphone', attacker);
  });

  {
    const sigua = makeFighter('丝瓜uli@A');
    const bunny = makeFighter('兔卷卷@B');
    const enemy = makeFighter('摸鱼抵挡测试靶@C');
    applyTestStatus(enemy, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'morphling_linken_sphere' } });
    const logs: LogEntry[] = [];
    const engine = makeEngine(localProject.cloneFighters([sigua, bunny, enemy]), logs);

    withRandomSequence([0.1, 0.1], () => {
      engine.executeSkillAction('slacking', engine.fighters[0], engine.fighters[2]);
    });

    assert(engine.fighters[0].statuses.some((status) => status.identityId === 'SYNERGY_SLACKING'), 'Enemy spell block should not prevent Sigua from leaving the field');
    assert(engine.fighters[1].statuses.some((status) => status.identityId === 'SYNERGY_SLACKING'), 'Enemy spell block should not prevent Bunny from leaving the field');
    assert(engine.fighters[2].statuses.some((status) => status.identityId === 'SPELL_BLOCK'), 'Slacking setup should not consume an unrelated enemy spell block');
    assert(!logs.some((entry) => entry.text.includes('挡下') && entry.text.includes('【寻找摸鱼搭子】')), 'Slacking setup should never be logged as blocked by an enemy defense');
    cases.push('enemy spell defense cannot block the slacking partnership');
  }

  {
    const logs: LogEntry[] = [];
    const attacker = makeFighter('M1A2_abrams_sep@attacker');
    const sigua = applySlacking(makeFighter('丝瓜uli@away'));
    const bunny = applySlacking(makeFighter('兔卷卷@away'));
    const fighters = localProject.cloneFighters([attacker, sigua, bunny]);
    const before = snapshot(fighters.filter((fighter) => fighter.name === '丝瓜uli' || fighter.name === '兔卷卷'));
    const engine = makeEngine(fighters, logs);
    engine.executeSkillAction('wt_t58_knockup', engine.fighters[0], engine.fighters[1]);
    assertUnchanged(before, engine.fighters, ['丝瓜uli', '兔卷卷']);
    assert(logs.length === 0, `only slacking enemies should produce no attack logs:\n${logs.map((entry) => entry.text).join('\n')}`);
    cases.push('only slacking enemies means no valid target');
  }

  ['丝瓜uli', '兔卷卷'].forEach((name, index) => {
    const logs: LogEntry[] = [];
    const away = applySlacking(makeFighter(`${name}@away`));
    away.spd = 10000;
    const enemyA = makeFighter(`测试敌人${index}A@a`);
    const enemyB = makeFighter(`测试敌人${index}B@b`);
    const fighters = localProject.cloneFighters([away, enemyA, enemyB]);
    const before = snapshot([fighters[0]]);
    withSeed(1, () => {
      const engine = makeEngine(fighters, logs);
      engine.step({ current: false });
      assertUnchanged(before, engine.fighters, [name], { checkStatus: false });
      const joined = logs.map((entry) => entry.text).join('\n');
      assert(!new RegExp(`${name}.*(攻击|凝聚魔力|计算器|萌兔出击|歌姬演唱)`).test(joined), `${name} acted while slacking:\n${joined}`);
    });
    cases.push(`${name} skips own turn while slacking`);
  });

  {
    const logs: LogEntry[] = [];
    const bunny = applySlacking(makeFighter('兔卷卷@away'));
    bunny.job = 'VERSATILE_RABBIT';
    bunny.jobData.name = '百变兔娘';
    bunny.styleTurnCounter = 3;
    applyTestStatus(bunny, { identityId: 'STYLE_FOOL' });
    bunny.spd = 10000;
    const enemyA = makeFighter('测试敌人A@a');
    const enemyB = makeFighter('测试敌人B@b');
    const fighters = localProject.cloneFighters([bunny, enemyA, enemyB]);
    const before = snapshot([fighters[0]]);
    withSeed(1, () => {
      const engine = makeEngine(fighters, logs);
      engine.step({ current: false });
      assertUnchanged(before, engine.fighters, ['兔卷卷'], { checkStatus: false });
      const joined = logs.map((entry) => entry.text).join('\n');
      assert(!/人设时钟|光速换装|光速切片|计算器/.test(joined), `slacking versatile bunny advanced style clock or acted:\n${joined}`);
    });
    cases.push('slacking versatile bunny cannot act through style fool or style clock');
  }

  return cases;
}
