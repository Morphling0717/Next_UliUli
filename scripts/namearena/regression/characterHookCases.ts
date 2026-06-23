import type { StatKey } from '../../../lib/namearena/types';
import {
  assert,
  localProject,
  makeFighter,
  withRandomSequence,
} from '../shared/harness';
import { makeDeathEngine } from './deathAccountingCases';

const STAT_KEYS: StatKey[] = ['atk', 'def', 'spd', 'agl', 'mag', 'res', 'wis'];

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
    const gacha = makeFighter('牢鳄@A');
    const { engine, logs } = makeDeathEngine([gacha, makeFighter('变身旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);

    assert(engine.fighters[0].job === 'LUCK_EMPEROR', `Gacha hook should transform to LUCK_EMPEROR, got ${engine.fighters[0].job}`);
    assert(engine.fighters[0].wis === 120, 'Gacha hook should set luck emperor wisdom');
    assert(logs.some((entry) => entry.text.includes('觉醒欧皇血统')), 'Gacha hook should keep the original transform log');
    cases.push('Gacha transform hook');
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
    assert(logs.some((entry) => entry.text.includes('同队的克蕾儿')), 'Sigua bond hook should keep the original transform log');
    cases.push('Sigua Claire-bond transform hook');
  }

  {
    const sigua = makeFighter('丝瓜uli@A');
    const { engine, logs } = makeDeathEngine([sigua, makeFighter('变身旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);

    assert(engine.fighters[0].job === 'VALO_JUNIOR', `Sigua solo hook should transform to VALO_JUNIOR, got ${engine.fighters[0].job}`);
    assert(engine.fighters[0].ultPoints === 0 && engine.fighters[0].economy === 0, 'Sigua solo hook should initialize Valorant resources');
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
    const sigua = makeFighter('丝瓜uli@A');
    const { engine, logs } = makeDeathEngine([sigua, makeFighter('选技旁观者@B')]);
    localProject.setCurrentHp(engine.fighters[0], Math.floor(engine.fighters[0].maxHp * 0.4));
    engine.handleTransformations(engine.fighters[0]);
    engine.fighters[0].ultPoints = 4;
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
