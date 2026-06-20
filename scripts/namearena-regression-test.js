/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const ts = require(path.join(projectRoot, 'node_modules/typescript'));

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      skipLibCheck: true,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const { BattleEngine } = require(path.join(projectRoot, 'lib/namearena/battleEngine.ts'));
const { namerenaJobs } = require(path.join(projectRoot, 'lib/namearena/jobs.ts'));
const { namerenaSkills } = require(path.join(projectRoot, 'lib/namearena/skills.ts'));
const { namerenaData } = require(path.join(projectRoot, 'lib/namearena/data.ts'));
const coreModule = require(path.join(projectRoot, 'lib/namearena/core.ts'));
const { cloneFighters, setCurrentHp } = require(path.join(projectRoot, 'lib/namearena/combatState.ts'));
const { generateNameArenaFighter } = require(path.join(projectRoot, 'lib/namearena/fighterFactory.ts'));

const namerenaCore = coreModule.namerenaCore ?? coreModule;
const SPECIALS = ['水人', '玄凝', '小汀', '牢鳄', '克蕾儿丝菲尔', '丝瓜uli', '兔卷卷', '刺猬人', '屑', 'M1A2_abrams_sep'];
const NO_WATER = SPECIALS.filter((name) => name !== '水人');
const MAX_TURNS = 700;
const FAILURE_DIR = path.join(projectRoot, '.tmp', 'namearena-regression-failures');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function withSeed(seed, fn) {
  const rng = new namerenaCore.SeededRNG(seed);
  const originalRandom = Math.random;
  Math.random = () => rng.next();
  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

function makeFighter(name) {
  const fighter = generateNameArenaFighter(name);
  assert(fighter, `failed to generate fighter: ${name}`);
  return fighter;
}

function makeEngine(fighters, logs, turnCount = 0) {
  return new BattleEngine(
    fighters,
    (entry) => logs.push(entry),
    namerenaJobs,
    namerenaSkills,
    namerenaData,
    namerenaCore,
    turnCount,
  );
}

function snapshot(fighters) {
  return fighters.map((f) => ({
    name: f.name,
    hp: f.currentHp,
    hpPct: f.hpPct,
    dmgTaken: f.stats.dmgTaken,
    status: f.status.map((s) => `${s.type}:${s.duration}`).sort().join(','),
  }));
}

function assertUnchanged(before, fighters, names, options = {}) {
  const checkStatus = options.checkStatus ?? true;
  names.forEach((name) => {
    const prev = before.find((item) => item.name === name);
    const next = fighters.find((item) => item.name === name);
    assert(prev && next, `${name} disappeared`);
    assert(next.currentHp === prev.hp, `${name} HP changed: ${prev.hp} -> ${next.currentHp}`);
    assert(next.hpPct === prev.hpPct, `${name} hpPct changed: ${prev.hpPct} -> ${next.hpPct}`);
    assert(next.stats.dmgTaken === prev.dmgTaken, `${name} dmgTaken changed: ${prev.dmgTaken} -> ${next.stats.dmgTaken}`);
    if (checkStatus) {
      assert(next.status.map((s) => `${s.type}:${s.duration}`).sort().join(',') === prev.status, `${name} status changed unexpectedly`);
    }
  });
}

function applySlacking(fighter) {
  fighter.status = [
    { type: 'SYNERGY_SLACKING', duration: 5 },
    { type: 'INVUL', duration: 5 },
    { type: 'BKB', duration: 5 },
    { type: 'STUN', duration: 5 },
  ];
  fighter.wasSynergySlacking = true;
  return fighter;
}

function checkInvariants(fighters, label) {
  const errors = [];
  fighters.forEach((f) => {
    const hpPct = f.maxHp > 0 ? Math.max(0, f.currentHp) / f.maxHp : 0;
    const hpPctDelta = Math.abs((f.hpPct ?? 0) - hpPct);
    if (!Number.isFinite(f.currentHp) || !Number.isFinite(f.maxHp) || !Number.isFinite(f.hpPct)) errors.push(`${f.name} has non-finite HP`);
    if (['atk', 'def', 'spd', 'agl', 'mag', 'res', 'wis'].some((key) => !Number.isFinite(f[key]))) errors.push(`${f.name} has non-finite stat`);
    if (f.currentHp > f.maxHp) errors.push(`${f.name} currentHp ${f.currentHp} > maxHp ${f.maxHp}`);
    if (f.currentHp < 0) errors.push(`${f.name} currentHp negative: ${f.currentHp}`);
    if (hpPctDelta > 0.0001) errors.push(`${f.name} hpPct mismatch in ${label}: ${f.hpPct} vs ${hpPct}`);
    if (f.isDead && f.currentHp > 0) errors.push(`${f.name} is dead but currentHp is ${f.currentHp}`);
    if (f.status.some((s) => !Number.isFinite(s.duration))) errors.push(`${f.name} has non-finite status duration`);
  });
  return errors;
}

function parseSlackingPair(text) {
  const match = text.match(/战斗进行到一半，(.+?) 和 (.+?) 突然对视/);
  return match ? [match[1], match[2]] : null;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scanLogs(logs, label) {
  const issues = [];
  const activeSlacking = new Set();
  const generalPatterns = [
    ['nan-or-undefined', /\b(?:NaN|undefined|null)\b/],
    ['negative-number-log', /(?:造成|承受|恢复|损失)了? -\d/],
    ['zero-damage-control', /(?:承受了|造成了) 0 点.*(?:并被|并深度|并使其|眩晕|魅惑|击飞|中毒|灼烧|沉默)/],
    ['duplicate-damage-type', /物理\(物理\)|魔法\(魔法\)/],
  ];

  logs.forEach((entry, index) => {
    const text = entry.text;
    generalPatterns.forEach(([type, regex]) => {
      if (regex.test(text)) issues.push({ label, line: index + 1, type, text });
    });

    const pair = parseSlackingPair(text);
    if (pair) pair.forEach((name) => activeSlacking.add(name));

    [...activeSlacking].forEach((name) => {
      if (
        text.includes(`摸鱼时间结束！${name}`) ||
        text.includes(`看到搭子回去打工了，${name}`) ||
        (text.includes(`${name} 赶紧扔掉手里的奶茶`) && text.includes('满血跑回战场假装还在战斗')) ||
        text.includes(`${name} 满血跑回战场假装还在战斗`)
      ) {
        activeSlacking.delete(name);
      }
    });

    activeSlacking.forEach((name) => {
      const n = escapeRegExp(name);
      const suspicious = new RegExp(`(对 ${n}|攻击了 ${n}|${n} 承受|${n} 受到持续伤害|${n} 在深渊水牢|${n} 被(?:魔音|空袭|击中|冻结|眩晕|击飞|抹杀|魅惑|中毒|灼烧|沉默))`);
      const allowed =
        text.includes(`${name} 正在场外OB摸鱼`) ||
        text.includes('摸鱼伙伴羁绊') ||
        text.includes('场外OB状态') ||
        text.includes('摸鱼时间结束') ||
        text.includes('看到搭子回去打工') ||
        text.includes('满血跑回战场');
      if (!allowed && suspicious.test(text)) {
        issues.push({ label, line: index + 1, type: 'slacking-hit-or-targeted', text });
      }
    });
  });

  return issues;
}

function runBattle(spec) {
  return withSeed(spec.seed, () => {
    let fighters = spec.names.map(makeFighter);
    const logs = [];
    const spinalSwordRef = { current: false };
    let turnCount = 0;
    let ended = false;
    let error = null;

    for (let i = 0; i < MAX_TURNS; i += 1) {
      const engine = makeEngine(cloneFighters(fighters), logs, turnCount);
      try {
        ended = engine.step(spinalSwordRef);
        turnCount = engine.turnCount;
        fighters = engine.fighters;
      } catch (err) {
        error = err instanceof Error ? `${err.stack || err.message}` : String(err);
        break;
      }
      if (ended) break;
    }

    return {
      ...spec,
      turns: turnCount,
      ended,
      timedOut: !ended && !error,
      error,
      invariantErrors: checkInvariants(fighters, spec.label),
      logIssues: scanLogs(logs, spec.label),
      logCount: logs.length,
      logs,
    };
  });
}

function assertFactoryMapping() {
  const expected = new Map([
    ['水人', 'SLIME'],
    ['玄凝', 'HIGH_END_GAMER'],
    ['小汀', 'RED_FURY_SAMURAI'],
    ['牢鳄', 'GACHA_ADDICT'],
    ['克蕾儿丝菲尔', 'SUCCUBUS'],
    ['丝瓜uli', 'VIRTUAL_DIVA'],
    ['兔卷卷', 'Q_BUNNY'],
    ['刺猬人', 'TOKU_FAN'],
    ['屑', 'JOKE_KING'],
    ['M1A2_abrams_sep', 'WT_GRINDER'],
  ]);
  expected.forEach((job, name) => {
    assert(makeFighter(name).job === job, `${name} should map to ${job}`);
    assert(makeFighter(`${name}@A`).job === job, `${name}@A should map to ${job}`);
  });
}

function runSlackingIsolation() {
  const cases = [];

  function actionCase(label, action) {
    const logs = [];
    const attacker = makeFighter('M1A2_abrams_sep@attacker');
    const sigua = applySlacking(makeFighter('丝瓜uli@away'));
    const bunny = applySlacking(makeFighter('兔卷卷@away'));
    const dummy = makeFighter('测试靶子@away');
    const fighters = cloneFighters([attacker, sigua, bunny, dummy]);
    const before = snapshot(fighters.filter((f) => f.name === '丝瓜uli' || f.name === '兔卷卷'));
    const engine = makeEngine(fighters, logs);
    action(engine, engine.fighters[0], engine.fighters.find((f) => f.name === '丝瓜uli'));
    assertUnchanged(before, engine.fighters, ['丝瓜uli', '兔卷卷']);
    const joined = logs.map((l) => l.text).join('\n');
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
    const logs = [];
    const attacker = makeFighter('M1A2_abrams_sep@attacker');
    const sigua = applySlacking(makeFighter('丝瓜uli@away'));
    const bunny = applySlacking(makeFighter('兔卷卷@away'));
    const fighters = cloneFighters([attacker, sigua, bunny]);
    const before = snapshot(fighters.filter((f) => f.name === '丝瓜uli' || f.name === '兔卷卷'));
    const engine = makeEngine(fighters, logs);
    engine.executeSkillAction('wt_t58_knockup', engine.fighters[0], engine.fighters[1]);
    assertUnchanged(before, engine.fighters, ['丝瓜uli', '兔卷卷']);
    assert(logs.length === 0, `only slacking enemies should produce no attack logs:\n${logs.map((l) => l.text).join('\n')}`);
    cases.push('only slacking enemies means no valid target');
  }

  ['丝瓜uli', '兔卷卷'].forEach((name, index) => {
    const logs = [];
    const away = applySlacking(makeFighter(`${name}@away`));
    away.spd = 10000;
    const enemyA = makeFighter(`测试敌人${index}A@a`);
    const enemyB = makeFighter(`测试敌人${index}B@b`);
    const fighters = cloneFighters([away, enemyA, enemyB]);
    const before = snapshot([fighters[0]]);
    withSeed(1, () => {
      const engine = makeEngine(fighters, logs);
      engine.step({ current: false });
      assertUnchanged(before, engine.fighters, [name], { checkStatus: false });
      const joined = logs.map((l) => l.text).join('\n');
      assert(joined.includes(`${name} 正在场外OB摸鱼，暂时不参与战斗`), `${name} did not skip while slacking:\n${joined}`);
      assert(!new RegExp(`${name}.*(攻击|凝聚魔力|计算器|萌兔出击|歌姬演唱)`).test(joined), `${name} acted while slacking:\n${joined}`);
    });
    cases.push(`${name} skips own turn while slacking`);
  });

  return cases;
}

function makeDeathEngine(fighters, logs = []) {
  const cloned = cloneFighters(fighters);
  return { engine: makeEngine(cloned, logs), logs };
}

function runDeathAccountingCases() {
  const cases = [];

  {
    const attacker = makeFighter('死亡结算杀手@A');
    const target = makeFighter('死亡结算靶子@B');
    attacker.atk = 10000;
    attacker.agl = 10000;
    target.maxHp = 100;
    setCurrentHp(target, 100);

    const { engine, logs } = makeDeathEngine([attacker, target]);
    engine.executeSkillAction('serious_punch', engine.fighters[0], engine.fighters[1]);
    engine.handleDeathsAndRevives({ current: false });
    engine.handleDeathsAndRevives({ current: false });

    assert(engine.fighters[1].isDead, 'normal lethal hit should finalize target death');
    assert(engine.fighters[0].stats.kills === 1, `normal lethal hit should award exactly one kill, got ${engine.fighters[0].stats.kills}`);
    assert(logs.filter((l) => l.text.includes('无情抹杀')).length === 1, 'normal lethal hit should log one kill message');
    cases.push('normal lethal hit awards exactly one kill');
  }

  {
    const attacker = makeFighter('反伤测试攻击者@A');
    const target = makeFighter('反伤测试目标@B');
    attacker.maxHp = 100;
    setCurrentHp(attacker, 100);
    attacker.atk = 80;
    attacker.agl = 10000;
    target.maxHp = 10000;
    setCurrentHp(target, 10000);
    target.status.push({ type: 'COUNTER', duration: 3 });

    const { engine, logs } = makeDeathEngine([attacker, target]);
    engine.executeSkillAction('serious_punch', engine.fighters[0], engine.fighters[1]);
    engine.handleDeathsAndRevives({ current: false });
    engine.handleDeathsAndRevives({ current: false });

    assert(engine.fighters[0].isDead, 'counter reflection should finalize attacker death');
    assert(engine.fighters[1].stats.kills === 1, `counter reflection should award exactly one kill, got ${engine.fighters[1].stats.kills}`);
    assert(logs.filter((l) => l.text.includes('反弹伤害反死')).length === 1, 'counter reflection should log one death message');
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
    const spinalSwordRef = { current: false };
    const { engine, logs } = makeDeathEngine([attacker, ting]);

    engine.markDefeated(engine.fighters[1], { message: '💀 【测试】小汀受到致命伤。', killer: engine.fighters[0] });
    engine.handleDeathsAndRevives(spinalSwordRef);
    engine.handleDeathsAndRevives(spinalSwordRef);

    assert(engine.fighters[1].isDead, 'Ting should remain dead after finalization');
    assert(engine.fighters[1].hasDroppedSword, 'Ting should mark spinal sword as dropped');
    assert(spinalSwordRef.current, 'Ting death should leave spinal sword on the field');
    assert(engine.fighters[0].stats.kills === 1, `Ting death should award exactly one kill, got ${engine.fighters[0].stats.kills}`);
    assert(logs.filter((l) => l.text.includes('脊髓剑')).length === 1, 'Ting should drop spinal sword exactly once');
    cases.push('Ting death drops spinal sword exactly once');
  }

  {
    const attacker = makeFighter('屑击杀者@A');
    const teammate = makeFighter('屑队友@J');
    const joker = makeFighter('屑@J');
    attacker.maxHp = 200000;
    setCurrentHp(attacker, 200000);
    const spinalSwordRef = { current: false };
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
    assert(logs.filter((l) => l.text.includes('从地狱归来')).length === 1, 'Joker should revive exactly once');
    cases.push('Joker death countdown revives without duplicate accounting');
  }

  return cases;
}

function runStatusClockCases() {
  const cases = [];

  {
    const fighter = makeFighter('全局计时测试@A');
    fighter.status = [{ type: 'INVUL', duration: 2, appliedTurn: 0 }];
    const { engine } = makeDeathEngine([fighter, makeFighter('旁观者@B')]);
    engine.turnCount = 1;
    engine.advanceGlobalTimedStatuses();
    assert(engine.fighters[0].status.find((s) => s.type === 'INVUL')?.duration === 1, 'global status should tick on global battle turns');
    engine.turnCount = 2;
    engine.advanceGlobalTimedStatuses();
    assert(!engine.fighters[0].status.some((s) => s.type === 'INVUL'), 'global status should expire after its global duration');
    cases.push('global statuses tick on battle turns');
  }

  {
    const fighter = makeFighter('同回合全局测试@A');
    fighter.status = [{ type: 'BKB', duration: 1 }];
    const { engine } = makeDeathEngine([fighter, makeFighter('旁观者@B')]);
    engine.turnCount = 7;
    engine.advanceGlobalTimedStatuses();
    const status = engine.fighters[0].status.find((s) => s.type === 'BKB');
    assert(status && status.duration === 1 && status.appliedTurn === 7, 'global status should not tick on the same turn it is first observed');
    engine.turnCount = 8;
    engine.advanceGlobalTimedStatuses();
    assert(!engine.fighters[0].status.some((s) => s.type === 'BKB'), 'global status should tick on the next battle turn');
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
      assert(engine.fighters[0].status.find((s) => s.type === type)?.duration === 999, `${type} should not tick down`);
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
    const before = fighter.status.map((s) => `${s.type}:${s.duration}`).sort().join(',');
    const { engine } = makeDeathEngine([fighter, makeFighter('旁观者@B')]);
    engine.processStatus(engine.fighters[0]);
    engine.turnCount = 1;
    engine.advanceGlobalTimedStatuses();
    const after = engine.fighters[0].status.map((s) => `${s.type}:${s.duration}`).sort().join(',');
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
    assert(engine.fighters[0].status.find((s) => s.type === 'STUN')?.duration === 1, 'self-timed control should tick on owner turn');
    assert(engine.fighters[0].status.find((s) => s.type === 'POISON')?.duration === 1, 'self-timed DoT should tick on owner turn');
    assert(engine.fighters[0].status.find((s) => s.type === 'CTR_CHARM')?.duration === 4, 'non-passive counter stance should tick down if it is not triggered');
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
    setCurrentHp(target, 100000);
    const { engine } = makeDeathEngine([attacker, target]);
    engine.executeSkillAction('serious_punch', engine.fighters[0], engine.fighters[1]);
    assert(!engine.fighters[0].status.some((s) => s.type === 'AIM'), 'AIM should be consumed after an offensive action');
    cases.push('AIM is consumed by the next offensive action');
  }

  {
    const attacker = makeFighter('反击攻击者@A');
    const target = makeFighter('反击持有者@B');
    attacker.atk = 100;
    attacker.agl = 10000;
    attacker.maxHp = 100000;
    setCurrentHp(attacker, 100000);
    target.maxHp = 100000;
    setCurrentHp(target, 100000);
    target.status.push({ type: 'COUNTER', duration: 2 });
    const { engine } = makeDeathEngine([attacker, target]);
    engine.executeSkillAction('serious_punch', engine.fighters[0], engine.fighters[1]);
    assert(!engine.fighters[1].status.some((s) => s.type === 'COUNTER'), 'COUNTER should be consumed after reflecting one physical hit');
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
    const remaining = returned.status.map((s) => s.type);
    assert(!returned.wasSynergySlacking, 'slacking fighter should clear slacking marker after natural global expiry');
    ['SYNERGY_SLACKING', 'INVUL', 'BKB', 'STUN', 'SPELL_BLOCK'].forEach((type) => {
      assert(!remaining.includes(type), `${type} should be removed when slacking fighter returns`);
    });
    assert(returned.currentHp === returned.maxHp, 'slacking return should restore full HP');
    cases.push('slacking global expiry triggers immediate clean return');
  }

  return cases;
}

function buildSpecs() {
  const specs = [];
  for (let i = 0; i < 12; i += 1) specs.push({ phase: 'all-special', label: `all-special-${i}`, names: SPECIALS, seed: 8000 + i });
  for (let i = 0; i < 12; i += 1) specs.push({ phase: 'no-water', label: `no-water-${i}`, names: NO_WATER, seed: 9000 + i });
  SPECIALS.forEach((a, i) => {
    SPECIALS.forEach((b, j) => {
      if (i !== j) specs.push({ phase: '1v1', label: `1v1-${a}-vs-${b}`, names: [a, b], seed: 20000 + i * 97 + j });
    });
  });
  for (let i = 0; i < SPECIALS.length; i += 1) {
    for (let j = i + 1; j < SPECIALS.length; j += 1) {
      specs.push({
        phase: 'pair-team',
        label: `pair-team-${SPECIALS[i]}-${SPECIALS[j]}`,
        names: SPECIALS.map((name, idx) => (idx === i || idx === j ? `${name}@PAIR_${i}_${j}` : name)),
        seed: 30000 + i * 101 + j,
      });
    }
  }
  return specs;
}

function writeFailure(result, index) {
  fs.mkdirSync(FAILURE_DIR, { recursive: true });
  const fileName = `${String(index).padStart(4, '0')}-${result.phase}-${result.label}`.replace(/[^\w.-]+/g, '_').slice(0, 180);
  const outPath = path.join(FAILURE_DIR, `${fileName}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return outPath;
}

function main() {
  assertFactoryMapping();
  const slackingCases = runSlackingIsolation();
  const deathCases = runDeathAccountingCases();
  const statusClockCases = runStatusClockCases();
  const specs = buildSpecs();
  const failures = [];

  specs.forEach((spec, index) => {
    const result = runBattle(spec);
    const hasFailure =
      result.error ||
      result.invariantErrors.length > 0 ||
      result.logIssues.length > 0 ||
      result.timedOut;
    if (hasFailure) {
      failures.push({ index, result, file: writeFailure(result, index) });
    }
  });

  const summary = {
    ok: failures.length === 0,
    slackingCaseCount: slackingCases.length,
    deathCaseCount: deathCases.length,
    statusClockCaseCount: statusClockCases.length,
    battleCount: specs.length,
    failures: failures.map((f) => ({
      label: f.result.label,
      phase: f.result.phase,
      error: f.result.error,
      invariantErrors: f.result.invariantErrors,
      logIssues: f.result.logIssues.slice(0, 5),
      timedOut: f.result.timedOut,
      file: f.file,
    })),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length > 0) process.exitCode = 1;
}

main();
