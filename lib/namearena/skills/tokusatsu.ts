import type { SkillDefinition } from '../types';
import { namerenaData as Data } from '../data';

const {
  SKILL_TAGS,
  TOKUSATSU_BASIC_POOL,
} = Data;

export const tokusatsuSkills: Record<string, SkillDefinition> = {
  tokusatsu_basic: { name: '特摄必杀', tag: SKILL_TAGS.PHYS, mult: 1.5, isRandomText: true, pool: TOKUSATSU_BASIC_POOL, text: '⚡ {USER} 大喊："{JOKE}" 向 {TARGET} 发起必杀！造成 {VAL} 点伤害！' },
  rider_kick: { name: '骑士踢', tag: SKILL_TAGS.PHYS, mult: 2.5, text: '🦶 {USER} 飞跃而起，对 {TARGET} 释放了毁天灭地的骑士踢！造成 {VAL} 伤害！' },
  bujin_slash: { name: '武神之刃', tag: SKILL_TAGS.PHYS, mult: 3.0, ignoreDef: true, text: '🗡️ {USER} 拔出黑色的武神之刃，瞬间斩过 {TARGET}！造成 {VAL} 真实伤害！' },
  miracle_magic: { name: '奇迹魔法', tag: SKILL_TAGS.MAG, mult: 2.0, status: 'STUN', text: '✨ {USER} 发动奇迹炼金术！对 {TARGET} 造成 {VAL} 魔法伤害并眩晕！' },
  bujin_chair: { name: '武神王座', tag: SKILL_TAGS.BUFF, status: 'WAIT_COUNTER', condition: (u) => !!u.isTokusatsu && !u.counterUsed, text: '🪑 {USER} 召唤出武神王座并坐下，闭上眼睛进入绝对防守反击状态！' },
  monster_punch: { name: '怪兽重拳', tag: SKILL_TAGS.PHYS, mult: 4.0, text: '🦖 {USER} 挥动巨大的星形拳套，一拳将 {TARGET} 轰飞！造成 {VAL} 伤害！' },
  great_monster_victory: {
    name: '怪兽胜利', tag: SKILL_TAGS.PHYS, mult: 5.0, ignoreDef: true,
    condition: (u) => !!u.isTokusatsu && u.job === 'MIRACLE_MONSTER_BUJIN' && !u.hasUsedGreatMonsterVictory,
    text: '⭐ {USER} 触发必杀！【GREAT MONSTER VICTORY】！星光粉碎了 {TARGET}，造成 {VAL} 伤害！',
    onExecute: (ctx) => {
      if (!ctx.user.isTokusatsu || ctx.user.job !== 'MIRACLE_MONSTER_BUJIN') {
        ctx.log('info', `⭐ ${ctx.user.name} 试图发动【GREAT MONSTER VICTORY】，但还没有进化到奇迹怪兽武刃形态！`);
        return true;
      }
      if (ctx.user.hasUsedGreatMonsterVictory) {
        ctx.log('info', `⭐ ${ctx.user.name} 已经释放过【GREAT MONSTER VICTORY】，怪兽胜利的能量没有再次回应。`);
        return true;
      }
      ctx.user.hasUsedGreatMonsterVictory = true;
      return false;
    },
  },
  rainbow_fever: {
    name: '彩虹狂热', tag: SKILL_TAGS.PHYS, mult: 6.5, ignoreDef: true, alwaysHit: true,
    condition: (u) => !!u.isTokusatsu && u.job === 'MIRACLE_MONSTER_BUJIN' && !u.hasUsedRainbowFever,
    text: '🌈 {USER} 点三下彩虹龙头："Gon Gon GonGonGonGon"！推动腰带拉杆发动【彩虹狂热】："GOTCHARD RAINBOW FEVER! FEVER! FEVER! FEVER!"\n🚂 {USER} 使用炼金术将巨型列车用来附身的蒸汽列车模型再炼成，模型巨大化后与脚部一体化，化作火车头骑士踢贯穿 {TARGET}，造成 {VAL} 真实伤害！',
    onExecute: (ctx) => {
      if (!ctx.user.isTokusatsu || ctx.user.job !== 'MIRACLE_MONSTER_BUJIN') {
        ctx.log('info', `🌈 ${ctx.user.name} 试图发动【彩虹狂热】，但还没有进化到奇迹怪兽武刃形态！`);
        return true;
      }
      if (ctx.user.hasUsedRainbowFever) {
        ctx.log('info', `🌈 ${ctx.user.name} 已经释放过【彩虹狂热】，彩虹龙头暂时沉寂了下来。`);
        return true;
      }
      ctx.user.hasUsedRainbowFever = true;
      ctx.user.jobData.skills = (ctx.user.jobData.skills ?? []).filter((s) => s !== 'rainbow_fever');
      return false;
    },
  },
};
