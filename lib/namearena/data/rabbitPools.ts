import type { GachaEntry, SkillContext, StylePoolEntry } from '../types';
import { SKILL_TAGS } from './constants';

// Pool entry type for TUJUANJUAN_CALC_POOL — extends GachaEntry
interface CalcPoolEntry extends GachaEntry {
  onExecute?: (ctx: SkillContext) => boolean;
}

export const TUJUANJUAN_CALC_POOL: CalcPoolEntry[] = [
  { text: "🧮 滴—— 1 1 4 5 1 4... {USER} 播放了恶臭数字，{TARGET} 受到 {VAL} 异味伤害并中毒！", mult: 1.5, tag: SKILL_TAGS.MAG, status: 'POISON' },
  { text: "🧮 滴—— 6 6 6 6 6 6... 弹幕共鸣！{USER} 对 {TARGET} 造成全屏 6 段打击（共 {VAL} 伤害）！", mult: 0.5, hits: 6, tag: SKILL_TAGS.MAG },
  { text: "🧮 滴—— 8 8 8 8 8 8... 发发发发！{USER} 给全队发放福利，恢复了生命！", mult: 2.0, tag: SKILL_TAGS.HEAL },
  { text: "🧮 滴—— 5 2 0 1 3 1 4... {USER} 发射极致飞吻！{TARGET} 被深度魅惑了！", mult: 0.1, tag: SKILL_TAGS.MAG, status: 'CHARMED' },
  { text: "🧮 滴—— 2 3 3 3 3 3... {USER} 疯狂嘲笑对手，摆出了反击姿态！", tag: SKILL_TAGS.BUFF, status: 'COUNTER' },
  {
    text: "🧮 滴—— 9 9 6 0 0 7... {USER} 强迫 {TARGET} 加班！造成 {VAL} 伤害并附加灼烧，速度暴跌！",
    mult: 1.8, tag: SKILL_TAGS.MAG, status: 'BURN',
    onExecute: (ctx: SkillContext) => { ctx.target.spd = Math.floor(ctx.target.spd * 0.5); return false; },
  },
];

export const TUJUANJUAN_STYLE_POOL: StylePoolEntry[] = [
  { text: '👓 \u201c这波啊，这波我在第五层。\u201d {USER} 切换为【精明女人】风格！', status: 'STYLE_SMART', statBuff: { wis: 2.0, spd: 2.0 } },
  { text: '💋 \u201c成熟大姐姐来咯~\u201d {USER} 切换为【性感女人】风格！', status: 'STYLE_SEXY', statBuff: { atk: 1.2 } },
  { text: '😡 \u201c你再说一句试试？！\u201d {USER} 切换为【暴躁女人】风格！', status: 'STYLE_ANGRY', statBuff: { def: 0.01, res: 0.01, atk: 3.0 } },
  { text: '🤪 \u201c诶？等等，刚刚发生了什么？\u201d {USER} 切换为【笨蛋女人】风格！', status: 'STYLE_FOOL' },
  { text: '💅 \u201c你看我这身好看吗？\u201d {USER} 切换为【虚荣女人】风格！', status: 'STYLE_VAIN' },
  { text: '🍳 \u201c要好好照顾自己呀~\u201d {USER} 切换为【顾家女人】风格！', status: 'STYLE_FAMILY', statBuff: { def: 3.0, res: 3.0 } },
  { text: '👑 \u201c平身！\u201d {USER} 抽到了 5% 的大奖！穿上龙袍登基为王！化身【帝皇铠甲】风格！', status: 'STYLE_EMPEROR', statBuff: { atk: 3.0, wis: 2.0, spd: 2.0, def: 3.0, res: 3.0 } },
];
