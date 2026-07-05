import {
  assert,
  makeFighter,
} from '../shared/harness';

export function assertFactoryMapping(): string[] {
  const expected = new Map<string, string>([
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
    ['表情', 'EMOTE_MAHORAGA'],
  ]);
  expected.forEach((job, name) => {
    assert(makeFighter(name).job === job, `${name} should map to ${job}`);
    assert(makeFighter(`${name}@A`).job === job, `${name}@A should map to ${job}`);
  });
  return [...expected.keys()];
}
