import type { SkillDefinition } from '../types';
import { namerenaData as Data } from '../data';

const {
  SKILL_TAGS,
  RED_FURY_POOL,
  SUICIDE_POOL,
} = Data;

export const tingSkills: Record<string, SkillDefinition> = {
  red_fury_rng: { name: '红温', tag: SKILL_TAGS.SPECIAL, isGacha: true, pool: RED_FURY_POOL, text: '🌡️ {USER} 血压飙升，情绪完全失控...' },
  suicide_rng: { name: '以命换命', tag: SKILL_TAGS.PHYS, isGacha: true, pool: SUICIDE_POOL, text: '🩸 {USER} 豁出去了...' },
  spinal_slash: { name: '脊髓剑·斩', tag: SKILL_TAGS.PHYS, mult: 2.5, text: '🩸 {USER} 挥舞巨大的脊髓剑劈向 {TARGET}，造成 {VAL} 伤害！' },
  blood_mist: {
    name: '血雾爆发', tag: SKILL_TAGS.MAG, mult: 3.0, lifesteal: 1.0,
    text: '🌫️ {USER} 引爆了脊髓剑中的血液！对 {TARGET} 造成 {VAL} 伤害并大量吸血！脊髓剑随之破碎！',
    condition: (user) => !!user.hasSpinalSword || user.status.some((s) => s.type === 'SPINAL_SWORD'),
    onExecute: (ctx) => {
      ctx.user.hasSpinalSword = false;
      ctx.user.spinalSwordTurns = 0;
      ctx.user.status = (ctx.user.status ?? []).filter((s) => s.type !== 'SPINAL_SWORD');
      if (!ctx.user.isTing) {
        ctx.user.jobData.skills = (ctx.user.jobData.skills ?? []).filter((s) => s !== 'summon_puppet_ting');
      }
      return false;
    },
  },
  grudge_rend: {
    name: '怨念裂斩',
    tag: SKILL_TAGS.PHYS,
    mult: 4.2,
    minDamagePct: 0.25,
    lifesteal: 0.25,
    text: '🦴 {USER} 把怨气缠上脊髓剑，撕开 {TARGET} 的防线，造成 {VAL} 伤害！',
  },
  grudge_blood_feast: {
    name: '血怨吞噬',
    tag: SKILL_TAGS.MAG,
    mult: 3.8,
    lifesteal: 0.75,
    text: '🩸 {USER} 将战场血雾卷回体内，吞噬 {TARGET} 的生命，造成 {VAL} 伤害！',
  },
  grudge_wail: {
    name: '怨灵尖啸',
    tag: SKILL_TAGS.DEBUFF,
    mult: 2.4,
    status: 'WEAK',
    lifesteal: 0.25,
    text: '👻 {USER} 发出刺耳尖啸，震碎 {TARGET} 的斗志，造成 {VAL} 伤害并附加虚弱！',
  },
  bone_guard: {
    name: '骨血架势',
    tag: SKILL_TAGS.BUFF,
    status: 'COUNTER',
    text: '🦴 {USER} 用骨血摆出反击架势，下一次受到物理攻击会立刻反弹！',
  },
  suicide_bomb: {
    name: '自爆',
    tag: SKILL_TAGS.PHYS,
    mult: 3.6,
    ignoreDef: true,
    selfDmgPct: 0.9,
    selfDmgCanKill: false,
    condition: (user) => user.hpPct > 0.35,
    text: '💣 {USER} 扑向了 {TARGET}，启动了自毁程序！"我和你爆了！！" 爆炸造成 {VAL} 真实伤害，自己也被反冲炸到濒死！',
  },
  grudge_curse: { name: '怨念诅咒', tag: SKILL_TAGS.DEBUFF, status: 'WEAK', text: '👻 {USER} 发出凄厉的哀嚎，{TARGET} 受到诅咒，攻击力大幅下降！' },
  summon_puppet_ting: { name: '召唤小汀', tag: SKILL_TAGS.SPECIAL, isSummon: true, summonName: '小汀(傀儡)', summonJob: 'WARRIOR', stats: { hp: 5000, atk: 100, def: 500 }, text: '🩸 {USER} 将脊髓剑插入地面... 鲜血汇聚，召唤出了一具名为【小汀(傀儡)】的无意识肉身保护自己！' },
};
