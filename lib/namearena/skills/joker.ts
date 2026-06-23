import type { SkillDefinition } from '../types';
import { namerenaData as Data } from '../data';

const {
  SKILL_TAGS,
  COLD_JOKES_POOL,
  HELL_JOKES_POOL,
  CHEESY_LINES_POOL,
} = Data;

export const jokerSkills: Record<string, SkillDefinition> = {
  cold_joke: { name: '冷笑话', tag: SKILL_TAGS.MAG, mult: 1.0, isRandomText: true, pool: COLD_JOKES_POOL, status: 'FREEZE', text: '❄️ {USER} 讲了一个冷笑话：\n"{JOKE}"\n{TARGET} 听完觉得好冷，受到了 {VAL} 魔法伤害并被冻结了！' },
  hell_joke: { name: '地狱笑话', tag: SKILL_TAGS.MAG, mult: 1.5, isRandomText: true, pool: HELL_JOKES_POOL, status: 'BURN', text: '🔥 {USER} 讲了一个地狱笑话：\n"{JOKE}"\n{TARGET} 破防了！受到 {VAL} 真实伤害并燃烧！', ignoreDef: true },
  deadly_prank: { name: '致命恶作剧', tag: SKILL_TAGS.PHYS, mult: 2.0, text: '🤡 {USER} 掏出一个爆炸礼盒丢向 {TARGET}，造成 {VAL} 伤害！' },
  troll_brainwash: { name: '群体洗脑', tag: SKILL_TAGS.DEBUFF, rate: 0.4, status: 'CONFUSED', text: '🌀 {USER} 讲了一个极度扭曲的地狱笑话，{TARGET} 陷入了深深的自我怀疑！(附加混乱)' },
  troll_steal: { name: '乐子偷取', tag: SKILL_TAGS.MAG, rate: 0.3, mult: 1.5, lifesteal: 0.5, text: '🃏 {USER} 以戏耍的姿态攻击了 {TARGET}，并偷取了大量生命力！造成 {VAL} 魔法伤害！' },
  cheesy_charm: { name: '土味情话', tag: SKILL_TAGS.DEBUFF, isRandomText: true, pool: CHEESY_LINES_POOL, status: 'CHARMED', text: '😬 {USER} 一本正经地对 {TARGET} 说：\n"{JOKE}"\n{TARGET} 尬得脚趾扣地，陷入了【魅惑】！' },
};
