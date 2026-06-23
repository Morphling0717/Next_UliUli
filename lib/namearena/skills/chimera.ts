import type { SkillDefinition } from '../types';
import { namerenaData as Data } from '../data';

const {
  SKILL_TAGS,
  CHIMERA_PLUGIN_POOL,
} = Data;

export const chimeraSkills: Record<string, SkillDefinition> = {
  chimera_install: { name: '插件安装', tag: SKILL_TAGS.BUFF, isGacha: true, pool: CHIMERA_PLUGIN_POOL, text: '⚙️ {USER} 开始进行肉体改造...' },
  chimera_strike: { name: '合成兽打击', tag: SKILL_TAGS.PHYS, mult: 1.5, text: '🧬 {USER} 用异变的肢体痛击 {TARGET}，造成 {VAL} 伤害！' },
  chimera_devour: { name: '暴食·吞界法', tag: SKILL_TAGS.PHYS, mult: 2.5, lifesteal: 0.5, text: '🦷 {USER} 张开巨口吞噬了 {TARGET}，造成 {VAL} 伤害！' },
  chimera_execute: { name: '处刑·断头台', tag: SKILL_TAGS.PHYS, mult: 3.5, ignoreDef: true, text: '⚔️ {USER} 挥下巨刃！无视防御对 {TARGET} 造成 {VAL} 处刑伤害！' },
  chimera_funnels: { name: '歼灭·全弹发射', tag: SKILL_TAGS.MAG, mult: 0.8, hits: 4, text: '🛸 {USER} 的浮游炮齐射！对 {TARGET} 造成 4 次打击，共 {VAL} 伤害！' },
  chimera_reconstruct: { name: '再生·血肉重铸', tag: SKILL_TAGS.HEAL, mult: 3.0, cleanStatus: true, text: '☢️ {USER} 启动炉心，恢复了 {VAL} 点生命并清除了所有异常！' },
  chimera_petrify: { name: '魔眼·石化凝视', tag: SKILL_TAGS.MAG, mult: 1.5, status: 'STUN', text: '👁️ {USER} 凝视 {TARGET}，造成 {VAL} 伤害并使其石化！' },
  chimera_fortress: { name: '铁壁·绝对防御', tag: SKILL_TAGS.BUFF, status: 'BKB', text: '🛡️ {USER} 展开了叹息之墙，免疫后续控制！' },
  chimera_warp: { name: '神速·次元跃迁', tag: SKILL_TAGS.PHYS, mult: 2.0, status: 'AIM', text: '🌌 {USER} 瞬间跃迁至 {TARGET} 背后，造成 {VAL} 必中伤害！' },
  chimera_plague: { name: '灾祸·终焉之毒', tag: SKILL_TAGS.MAG, mult: 1.0, status: 'POISON', text: '☠️ {USER} 释放瘟疫，对 {TARGET} 造成 {VAL} 伤害并附加剧毒！' },
};
