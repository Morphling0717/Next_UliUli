import type {
  SkillTag,
  GachaEntry,
  StylePoolEntry,
  StatusEffectInfo,
  SkillContext,
} from './types';

// ---------------------------------------------------------------------------
// Skill tag constants
// ---------------------------------------------------------------------------
const SKILL_TAGS = {
  PHYS: 'physical' as SkillTag,
  MAG: 'magical' as SkillTag,
  HEAL: 'heal' as SkillTag,
  BUFF: 'buff' as SkillTag,
  DEBUFF: 'debuff' as SkillTag,
  SPECIAL: 'special' as SkillTag,
};

// ---------------------------------------------------------------------------
// Status effect display table
// ---------------------------------------------------------------------------
const STATUS_EFFECTS: Record<string, StatusEffectInfo> = {
  STUN:   { name: '眩晕', icon: '💫', desc: '无法行动' },
  FREEZE: { name: '冰冻', icon: '❄️', desc: '无法行动，物理防御归零' },
  BURN:   { name: '灼烧', icon: '🔥', desc: '持续伤害' },
  POISON: { name: '中毒', icon: '🤢', desc: '持续伤害' },
  BLIND:  { name: '致盲', icon: '🕶️', desc: '命中率降低' },
  INVUL:  { name: '无敌', icon: '🌟', desc: '免疫伤害' },
  COUNTER:{ name: '反击', icon: '💢', desc: '受到物理攻击反弹' },
  REGEN:  { name: '再生', icon: '🌿', desc: '恢复生命' },
  RAGE:   { name: '狂暴', icon: '😡', desc: '攻升防降' },
  SILENCE:{ name: '沉默', icon: '😶', desc: '无法使用技能' },
  AIM:    { name: '锁头', icon: '🎯', desc: '下一次攻击必暴击且必中' },
  CONFUSED: { name: '尴尬', icon: '🥶', desc: '尴尬得脚趾扣地，无法行动' },
  CHARMED: { name: '魅惑', icon: '😍', desc: '被土味情话击中，无法攻击' },
  WAIT_COUNTER: { name: '坐椅子', icon: '🪑', desc: '停止行动，受到攻击时触发终极反击（仅限一次）' },
  BKB:    { name: '黑皇杖', icon: '🟡', desc: '天神下凡：免疫所有控制效果' },
  SPINAL_SWORD: { name: '脊髓剑', icon: '🦴', desc: '手持小汀的脊髓剑，攻击力大幅提升，数回合后将剑掷出引爆' },
  PUPPET_MASTER: { name: '提线者', icon: '🎭', desc: '拥有小汀作为傀儡护卫' },

  VALO_ULT_EMPRESS: { name: '女皇神威', icon: '👑', desc: '攻击/速度翻倍，100%吸血' },
  VALO_ULT_RUN_IT_BACK: { name: '再火一回', icon: '🔥', desc: '受到致命伤可满血复活' },
  VALO_HOLDING_ANGLE: { name: '架枪预瞄', icon: '🔭', desc: '受击截停：受到攻击时强制先手反击' },
  VALO_AIM_PUNCH: { name: '截停', icon: '🎯', desc: '命中率暴降80%' },
  NEURAL_THEFT_DEBUFF: { name: '被窃取情报', icon: '📷', desc: '闪避归零，受到伤害必暴击' },

  CTR_CHARM: { name: '魅惑反击', icon: '💕', desc: '受击时魅惑对手' },
  CTR_STUN:  { name: '震慑反击', icon: '😵', desc: '受击时眩晕对手' },
  CTR_DRAIN: { name: '汲取反击', icon: '🧛', desc: '受击时吸取对手生命' },
  CTR_POISON:{ name: '剧毒反击', icon: '🦠', desc: '受击时使对手中毒' },
  CTR_BURN:  { name: '烈焰反击', icon: '🔥', desc: '受击时点燃对手' },
  CTR_FREEZE:{ name: '极寒反击', icon: '🧊', desc: '受击时冻结对手' },
  CTR_VOID:  { name: '虚空反击', icon: '🌌', desc: '受击时造成真实伤害' },
  CTR_WEAK:  { name: '虚弱反击', icon: '📉', desc: '受击时降低对手攻击力' },
  CTR_CONFUSE:{ name: '混乱反击', icon: '🌀', desc: '受击时使对手混乱' },
  CTR_EXECUTE:{ name: '断头反击', icon: '☠️', desc: '受击时若对手生命低则直接斩杀' },

  PLUG_HEAD: { name: '暴食之口', icon: '🦷', desc: '攻击力/吸血大幅提升' },
  PLUG_ARM:  { name: '斩舰巨刃', icon: '⚔️', desc: '攻击力/暴击大幅提升' },
  PLUG_BACK: { name: '浮游炮阵', icon: '🛸', desc: '魔力/智力大幅提升' },
  PLUG_HEART:{ name: '永动炉心', icon: '☢️', desc: '全属性小幅提升，每回合回血' },
  PLUG_EYE:  { name: '石化魔眼', icon: '👁️', desc: '魔力/命中大幅提升' },
  PLUG_SKIN: { name: '纳米皮肤', icon: '🛡️', desc: '防御/魔抗大幅提升' },
  PLUG_LEG:  { name: '反重力足', icon: '🦶', desc: '速度/闪避大幅提升' },
  PLUG_TAIL: { name: '灾厄毒尾', icon: '🦂', desc: '攻击/魔力提升，附带剧毒' },

  VALO_FLASH: { name: '闪光曲球', icon: '🔆', desc: '被致盲，命中率大幅下降' },
  DIVA_SONG:  { name: '歌姬祝福', icon: '🎵', desc: '受到丝瓜uli的激励，属性提升' },
  Q_BUNNY_IDOL_AGL: { name: '爱豆闪避加成', icon: '✨', desc: '偶像打歌加护：闪避提升20%' },

  LIQUID_BODY: { name: '水之幻影', icon: '💧', desc: '物理伤害强制减半，免疫暴击与物理截停' },
  WATER_PRISON: { name: '深渊水牢', icon: '🌊', desc: '丧失闪避与转移能力，持续窒息溺水' },
  ETHEREAL: { name: '虚无', icon: '👻', desc: '免疫物理，受到魔法伤害翻倍，无法进行物理攻击' },
  SPELL_BLOCK: { name: '法术抵挡', icon: '🔵', desc: '抵挡下一次技能伤害或控制' },
  NO_HEAL: { name: '禁疗', icon: '🥀', desc: '无法恢复生命值' },

  SLACKING: { name: '摸鱼', icon: '🐟', desc: '场外OB，无敌且无法被选中与行动' },
  ZEROED: { name: '归零', icon: '🧮', desc: '全属性强行降至10%' },
  STYLE_SMART: { name: '精明女人', icon: '👓', desc: '智力速度翻倍，高额吸血' },
  STYLE_SEXY: { name: '性感女人', icon: '💋', desc: '永久魅惑反击，普攻真伤' },
  STYLE_ANGRY: { name: '暴躁女人', icon: '😡', desc: '防御归零，攻击翻3倍，必定暴击' },
  STYLE_FOOL: { name: '笨蛋女人', icon: '🤪', desc: '免控，攻击随机附带异常' },
  STYLE_VAIN: { name: '虚荣女人', icon: '💅', desc: '攻击偷取属性' },
  STYLE_FAMILY: { name: '顾家女人', icon: '🍳', desc: '高额双抗，回合结束回血，法术抵挡' },
  STYLE_EMPEROR: { name: '帝皇铠甲', icon: '👑', desc: '融合所有女人风格' },

  WT_SUPPRESS:  { name: '火力压制', icon: '🚧', desc: '被机炮弹雨压制，无法行动，闪避归零' },
  WT_AIRBORNE:  { name: '击飞', icon: '🚀', desc: '被大口径主炮物理击飞，重重摔落，眩晕一回合' },
  WT_REPAIRING: { name: '抢修中', icon: '🔧', desc: '长按F修车中，无法行动，受到伤害增加但疯狂回血' },
  WT_ERA:       { name: '爆反装甲', icon: '🧱', desc: '披挂爆炸反应装甲，获得高额减伤' },
  SYNERGY_SLACKING: { name: '场外OB', icon: '⛺', desc: '手牵手摸鱼中，绝对无敌且无法行动' },
  WEAK: { name: '虚弱', icon: '📉', desc: '攻击力大幅下降' },
};

const COLORS: string[] = [
  'from-red-500 to-orange-500', 'from-blue-500 to-cyan-500', 'from-green-500 to-emerald-500',
  'from-purple-500 to-pink-500', 'from-yellow-500 to-amber-500', 'from-gray-500 to-slate-500',
  'from-indigo-500 to-violet-500', 'from-teal-400 to-green-400',
];

const COLD_JOKES_POOL: string[] = [
  "你知道为什么慈禧不喜欢年轻人吗？因为年轻人是young人（洋人）",
  "你知道为什么蜂王手下的小弟都不听话吗？因为蜂工违纪（丰功伟绩）",
  "你知道吗什么人会干活胯下凉凉的吗？骑兵（冰）",
  "你知道为什么潮汕地区的老父亲都不爱潮流的东西吗？因为怕变成潮爸",
  "你知道为什么吟游诗人为什么道德低下吗？因为他们老鞭尸！",
  "老鼠太勤奋为什么会死？因为过劳鼠",
  "为什么夜神月不能吃辣？因为他是基拉（忌辣）",
  "纹身的人为什么聪明？因为他们是纹人(文人)",
  "讲地狱笑话会下地狱为什么讲烂谐音梗也会下地狱？因为你在玩尬的（god）",
  "皮卡丘站起来变成了什么？皮卡兵。",
];

const HELL_JOKES_POOL: string[] = [
  "1945年后日本流行什么食品？铀炸食品和核成食品",
  "肯尼迪坐敞篷车——脑洞大开。",
  "互联网有利有弊人们都看见利了可弊呢？可弊坠机了（科比坠机了）",
  "你知道秦朝最菜的名人是谁吗？是商鞅因为他拉爆了",
  "屈原进地府的时候 阎王:汝楚江? 屈原:嗨！",
  "你知道什么笔会从天而降吗？科比！",
  "为什么路易十六当卧底是失败的吗因为他不会接头",
];

const CHEESY_LINES_POOL: string[] = [
  "你的酒窝没有酒，我却醉得像条狗。",
  "你知道我的缺点是什么吗？缺点你。",
  "你最近是不是又胖了？不然为什么在我心里的分量越来越重。",
  "莫文蔚的阴天，孙燕姿的雨天，都不如你聊天的...",
  "不要抱怨，抱我。",
];

const TOKUSATSU_BASIC_POOL: string[] = [
  "Rider Kick！", "斯派修姆光线！", "超级战队火箭炮！", "变身！Henshin！",
  "奶奶曾经说过...", "你只要看着我变身就好了！", "撒，细数你的罪恶吧！",
  "我要成为王！", "我的强大是会哭泣的！",
];

const RED_FURY_POOL: GachaEntry[] = [
  { text: "😡 {USER} 越想越气，血压升高！攻击力大幅提升！", status: 'RAGE', tag: SKILL_TAGS.BUFF },
  { text: "🧘 {USER} 试图平复心情... 深呼吸恢复了 {VAL} 点生命。", mult: 1.2, tag: SKILL_TAGS.HEAL },
  { text: "🤬 {USER} 破防了！大声咆哮震晕了 {TARGET}！", status: 'STUN', tag: SKILL_TAGS.DEBUFF, mult: 0.5 },
  { text: "🌡️ {USER} 全身发红！进入红温状态，防御力下降但攻击力上升！", status: 'RAGE', tag: SKILL_TAGS.BUFF },
];

const SUICIDE_POOL: GachaEntry[] = [
  { text: "🩸 {USER} 献祭心脏！失去了18%生命，对 {TARGET} 造成毁灭性 {VAL} 伤害！", mult: 3.5, selfDmgPct: 0.18, lifesteal: 0.4, tag: SKILL_TAGS.PHYS },
  { text: "🔥 {USER} 燃血斩！燃烧血液！对自己造成中等伤害，斩断 {TARGET} ({VAL})！", mult: 3.0, selfDmgPct: 0.15, lifesteal: 0.5, tag: SKILL_TAGS.PHYS },
  { text: "💣 {USER} 自爆卡车！冲向 {TARGET} 引爆自己！双方受到巨量伤害 ({VAL})！", mult: 4.5, selfDmgPct: 0.25, lifesteal: 0.3, tag: SKILL_TAGS.PHYS },
  { text: "🔪 {USER} 剖腹产...啊不，切腹谢罪斩！对 {TARGET} 造成 {VAL} 暴击伤害！", mult: 3.8, selfDmgPct: 0.20, lifesteal: 0.4, tag: SKILL_TAGS.PHYS, ignoreDef: true },
  { text: "☠️ {USER} 怨气冲天！以命换命！咒杀 {TARGET} ({VAL}伤害)！", mult: 3.2, selfDmgPct: 0.15, lifesteal: 0.5, tag: SKILL_TAGS.MAG },
  { text: "🧠 {USER} 脑过载！烧毁大脑，对 {TARGET} 释放精神冲击 ({VAL})！", mult: 3.5, selfDmgPct: 0.18, lifesteal: 0.4, tag: SKILL_TAGS.MAG, status: 'CONFUSED' },
  { text: "🦴 {USER} 抽骨为刃！抽出脊椎骨劈向 {TARGET} ({VAL})！好痛啊！", mult: 3.6, selfDmgPct: 0.20, lifesteal: 0.4, tag: SKILL_TAGS.PHYS },
  { text: "💔 {USER} 心碎一击！悲伤逆流成河！对自己和 {TARGET} 造成 {VAL} 伤害！", mult: 3.0, selfDmgPct: 0.12, lifesteal: 0.5, tag: SKILL_TAGS.MAG },
  { text: "⛓️ {USER} 灵魂锁链！链接 {TARGET}，一起感受痛苦吧 ({VAL})！", mult: 2.8, selfDmgPct: 0.10, lifesteal: 0.5, tag: SKILL_TAGS.MAG },
  { text: "💉 {USER} 兴奋剂过量！全属性暴走，对 {TARGET} 乱舞 ({VAL})，然后吐血！", mult: 3.5, selfDmgPct: 0.15, lifesteal: 0.4, hits: 3, tag: SKILL_TAGS.PHYS },
  { text: "🧛 {USER} 逆向吸血！把自己的血喷在这个 {TARGET} 脸上 ({VAL})，造成腐蚀！", mult: 3.0, selfDmgPct: 0.12, lifesteal: 0.6, tag: SKILL_TAGS.MAG, status: 'POISON' },
  { text: "👁️ {USER} 挖眼珠！把眼球当手雷扔向 {TARGET} ({VAL})！", mult: 4.0, selfDmgPct: 0.22, lifesteal: 0.3, tag: SKILL_TAGS.PHYS },
  { text: "🦵 {USER} 断腿踢！踢断自己的腿也要踢死 {TARGET} ({VAL})！", mult: 3.2, selfDmgPct: 0.15, lifesteal: 0.4, tag: SKILL_TAGS.PHYS, status: 'STUN' },
  { text: "🧟 {USER} 尸爆术！引爆自己身体的一部分！对 {TARGET} 造成 {VAL} 伤害！", mult: 3.5, selfDmgPct: 0.18, lifesteal: 0.4, tag: SKILL_TAGS.MAG },
  { text: "👻 {USER} 灵魂出窍！肉体坏死！灵魂冲击 {TARGET} ({VAL})！", mult: 3.8, selfDmgPct: 0.20, lifesteal: 0.3, tag: SKILL_TAGS.MAG },
  { text: "🧊 {USER} 绝对冻结！连同自己一起冻结！对 {TARGET} 造成 {VAL} 冰伤！", mult: 3.0, selfDmgPct: 0.10, lifesteal: 0.5, tag: SKILL_TAGS.MAG, status: 'FREEZE' },
  { text: "⚡ {USER} 人体导电！引雷劈自己，传导给 {TARGET} ({VAL})！", mult: 3.5, selfDmgPct: 0.15, lifesteal: 0.4, tag: SKILL_TAGS.MAG },
  { text: "🦠 {USER} 培养蛊毒！以身为蛊！毒爆 {TARGET} ({VAL})！", mult: 3.2, selfDmgPct: 0.12, lifesteal: 0.5, tag: SKILL_TAGS.MAG, status: 'POISON' },
  { text: "🔨 {USER} 碎颅击！用头猛撞 {TARGET} 的头！同归于尽 ({VAL})！", mult: 3.0, selfDmgPct: 0.15, lifesteal: 0.4, tag: SKILL_TAGS.PHYS, status: 'STUN' },
  { text: "🌑 {USER} 黑洞献祭！把自己半个身子献给黑洞，吞噬 {TARGET} ({VAL})！", mult: 5.0, selfDmgPct: 0.30, lifesteal: 0.3, tag: SKILL_TAGS.MAG },
  { text: "🌪️ {USER} 舍身风暴！化作血肉旋风卷入 {TARGET} ({VAL})！", mult: 3.3, selfDmgPct: 0.12, lifesteal: 0.4, hits: 5, tag: SKILL_TAGS.PHYS },
  { text: "☄️ {USER} 坠落冲击！抱着 {TARGET} 从万米高空坠落 ({VAL})！", mult: 4.5, selfDmgPct: 0.25, lifesteal: 0.3, tag: SKILL_TAGS.PHYS },
  { text: "🔥 {USER} 业火焚身！点燃灵魂！将 {TARGET} 烧尽 ({VAL})！", mult: 3.8, selfDmgPct: 0.20, lifesteal: 0.4, tag: SKILL_TAGS.MAG, status: 'BURN' },
  { text: "🥀 {USER} 凋零之花！生命力枯竭，对 {TARGET} 造成 {VAL} 凋零伤害！", mult: 3.0, selfDmgPct: 0.10, lifesteal: 0.5, tag: SKILL_TAGS.MAG },
  { text: "🎯 {USER} 靶心诅咒！在该死的 {TARGET} 身上画靶子，即使自己受伤也要打中 ({VAL})！", mult: 3.5, selfDmgPct: 0.10, lifesteal: 0.5, tag: SKILL_TAGS.SPECIAL, ignoreDef: true },
  { text: "🦷 {USER} 碎牙咬！咬碎牙齿也要撕下 {TARGET} 一块肉 ({VAL})！", mult: 2.8, selfDmgPct: 0.05, lifesteal: 0.5, tag: SKILL_TAGS.PHYS },
  { text: "🤛 {USER} 禁手·里百八式！以废掉手臂为代价对 {TARGET} 造成终极一击 ({VAL})！", mult: 4.2, selfDmgPct: 0.22, lifesteal: 0.3, tag: SKILL_TAGS.PHYS },
  { text: "🩸 {USER} 血之狂欢！喷洒大量鲜血淹没 {TARGET} ({VAL})！", mult: 3.1, selfDmgPct: 0.11, lifesteal: 0.5, tag: SKILL_TAGS.MAG },
  { text: "🛐 {USER} 邪神契约！献祭一半生命！对 {TARGET} 造成 9999 ({VAL}) 真实伤害！", mult: 6.0, selfDmgPct: 0.40, lifesteal: 0.2, tag: SKILL_TAGS.SPECIAL, ignoreDef: true },
  { text: "🔚 {USER} 终焉之刻！大家的生命都归零吧！(对自己造成伤害，重创 {TARGET} {VAL})", mult: 4.0, selfDmgPct: 0.20, lifesteal: 0.4, tag: SKILL_TAGS.MAG },
];

const GACHA_NORMAL_POOL: GachaEntry[] = [
  { text: "💳 {USER} 十连全是蓝天白云... 愤怒地把手机砸向 {TARGET}，造成 {VAL} 点物理伤害！", mult: 0.8, tag: SKILL_TAGS.PHYS },
  { text: "🧟 {USER} 歪了！小保底抽到了「七七」... 只能给自己加点血了 ({VAL})。", mult: 1.5, tag: SKILL_TAGS.HEAL },
  { text: "🦵 {USER} 抽到了「黑暗大法师的左腿」... 用腿踢了 {TARGET} 一脚 ({VAL}伤害)。", mult: 1.0, tag: SKILL_TAGS.PHYS },
  { text: "🍯 {USER} 抽出了一张「强欲之壶的碎片」... 没啥用，加点防御吧。", mult: 0.0, tag: SKILL_TAGS.BUFF, status: 'COUNTER' },
  { text: "⚔️ {USER} 抽到了「三星武器·以理服人」！物理说服了 {TARGET} ({VAL}伤害)。", mult: 1.1, tag: SKILL_TAGS.PHYS },
  { text: "😿 {USER} 抽卡沉船了... 悲伤逆流成河，对周围造成 {VAL} 点精神伤害。", mult: 1.0, tag: SKILL_TAGS.MAG },
];

const EXODIA_CARD: GachaEntry = {
  text: "🧙‍♂️ {USER} 奇迹！！5.0%的概率！集齐了五张碎片... 召唤「黑暗大法师」加入战场！(HP:4000, 全属性:250, 唯一/不可祭品)",
  isSummon: true,
  summonName: '黑暗大法师',
  summonJob: 'DUEL_MONSTER',
  stats: { hp: 4000, atk: 250, def: 250, mag: 250, res: 250, spd: 250, agl: 250, wis: 250 },
  unique: true,
};

const GACHA_SSR_POOL: GachaEntry[] = [
  { text: "🃏 {USER} 发动魔法卡「强欲之壶」！从卡组再抽两张卡！（技能二连发）", triggerAgain: 2, tag: SKILL_TAGS.BUFF },
  { text: "🌸 {USER} 抽到了「灰流丽」！无效并破坏了对手的行动！(打断/眩晕)", mult: 3.0, tag: SKILL_TAGS.MAG, status: 'STUN' },
  { text: "🐲 {USER} 想要召唤强力怪兽... 需要献祭两只召唤物！「青眼白龙」！强韧！无敌！最强！", isSummon: true, summonName: '青眼白龙', summonJob: 'DUEL_MONSTER', stats: { hp: 2500, atk: 150, def: 120, spd: 100, mag: 100 }, tributes: 2 },
  { text: "🛡️ {USER} 天动万象！召唤「钟离」！此世群魔诸神并起...！", isSummon: true, summonName: '钟离', summonJob: 'GENSHIN_ARCHON', stats: { hp: 2500, def: 150, atk: 30 } },
  { text: "🗡️ {USER} 试问，你是我的Master吗？召唤「Saber」！", isSummon: true, summonName: 'Saber', summonJob: 'FATE_SERVANT', stats: { hp: 1400, atk: 80, spd: 37 } },
  { text: "🔥 {USER} 吟唱古老咒文... 需要献祭三只召唤物！太阳神「拉的翼神龙」降临！", isSummon: true, summonName: '翼神龙', summonJob: 'DUEL_MONSTER', stats: { hp: 3200, atk: 200, def: 200, mag: 200, res: 200, spd: 150 }, tributes: 3 },
  { text: "🤖 {USER} 机甲点燃大海！召唤「流萤 (SAM)」！焦土作战开始！", isSummon: true, summonName: '萨姆', summonJob: 'HSR_HUNTER', stats: { hp: 1500, atk: 85, spd: 45 } },
  { text: "🐉 {USER} 究极龙降临！召唤「巴哈姆特」！毁灭一切！", isSummon: true, summonName: '巴哈姆特', summonJob: 'LEGEND_DRAGON', stats: { hp: 1800, atk: 100, spd: 30 } },
  { text: "🦑 {USER} 撕裂万古！召唤「伊莫库」！奥札奇泰坦降临！", isSummon: true, summonName: '伊莫库', summonJob: 'ELDRAZI_TITAN', stats: { hp: 2000, atk: 75, mag: 75, spd: 25 } },
  { text: "🔥 {USER} 莱瓦汀！召唤「史尔特尔」！黄昏的尽头！", isSummon: true, summonName: '史尔特尔', summonJob: 'ARKNIGHTS_OP', stats: { hp: 800, atk: 125, spd: 32 } },
  { text: "🤖 {USER} 帮帮我，史瓦罗先生！召唤「克拉拉 & 史瓦罗」！", isSummon: true, summonName: '史瓦罗', summonJob: 'HSR_HUNTER', stats: { hp: 1800, atk: 60, def: 100 } },
  { text: "🌊 {USER} 满命「那维莱特」登场！潮水啊，我已归来！水龙王哭泣对 {TARGET} 造成 {VAL} 伤害！", mult: 5.5, tag: SKILL_TAGS.MAG },
  { text: "⚡ {USER} 「雷电将军」无想的一刀！寂灭之时！无视防御对 {TARGET} 造成 {VAL} 伤害！", mult: 6.0, tag: SKILL_TAGS.MAG, ignoreDef: true },
  { text: "👻 {USER} 「胡桃」吃饱喝饱，一路走好！蝶引来生对 {TARGET} 造成 {VAL} 伤害并大量回血！", mult: 4.0, tag: SKILL_TAGS.MAG, lifesteal: 1.0 },
  { text: "⚔️ {USER} 「黄泉」拔刀！虚无命途斩灭 {TARGET}，造成 {VAL} 点真实伤害！", mult: 5.5, tag: SKILL_TAGS.PHYS, ignoreDef: true },
  { text: "🏹 {USER} 「爱莉希雅」始源之矢贯穿 {TARGET} ({VAL}伤害)，因太可爱魅惑了对方！", mult: 4.8, tag: SKILL_TAGS.MAG, status: 'CHARMED' },
  { text: "🔥 {USER} 「琪亚娜」薪炎永燃！Time Runner！对 {TARGET} 造成 {VAL} 点火焰爆发伤害！", mult: 5.2, tag: SKILL_TAGS.MAG, status: 'BURN' },
  { text: "🥬 {USER} 「纳西妲」展开摩耶之殿！扫码连接全场，对 {TARGET} 造成 {VAL} 草元素伤害！", mult: 4.5, tag: SKILL_TAGS.MAG },
  { text: "🐲 {USER} 岁主「今汐」降临！天地同辉，龙息吐向 {TARGET} 造成 {VAL} 点伤害！", mult: 5.2, tag: SKILL_TAGS.MAG },
  { text: "🐦 {USER} 「长离」焚身以火！离火缭乱对 {TARGET} 造成 {VAL} 点热熔伤害！", mult: 5.0, tag: SKILL_TAGS.MAG, status: 'BURN' },
  { text: "🦈 {USER} 代理人「艾伦·乔」！剪刀腿处决 {TARGET} ({VAL}伤害)！", mult: 5.0, tag: SKILL_TAGS.PHYS, status: 'FREEZE' },
  { text: "👮‍♀️ {USER} 「朱鸢」以太霰弹连发！压制射击！对 {TARGET} 造成 {VAL} 伤害！", mult: 4.8, tag: SKILL_TAGS.PHYS },
  { text: "⚡ {USER} 召唤「欧西里斯的天空龙」！召雷弹轰杀 {TARGET}，造成 {VAL} 点毁灭伤害！", mult: 6.0, tag: SKILL_TAGS.MAG, status: 'STUN' },
  { text: "🛡️ {USER} 覆盖了一张陷阱卡「圣大护盾·镜之力」！(进入反击状态)", tag: SKILL_TAGS.BUFF, status: 'COUNTER' },
  { text: "⚗️ {USER} 发动「死者苏生」！从墓地汲取力量，恢复了大量生命 ({VAL})！", mult: 5.0, tag: SKILL_TAGS.HEAL },
  { text: "🌌 {USER} 「吉尔伽美什」Enuma Elish！天地乖离，开辟之星！对 {TARGET} 造成 {VAL} 伤害！", mult: 5.5, tag: SKILL_TAGS.PHYS },
  { text: "🕰️ {USER} 增幅强化！发动「超越时空 (D-Shift)」！获得额外回合并重创 {TARGET} ({VAL}伤害)！", mult: 4.5, tag: SKILL_TAGS.MAG, status: 'STUN' },
  { text: "🌸 {USER} 发动「黑莲花 (Black Lotus)」！法力值爆表！攻击力大幅提升！", mult: 0.0, tag: SKILL_TAGS.BUFF, status: 'RAGE' },
  { text: "🦍 {USER} 「未花」公主驾到！Kyrie Eleison！猩红暴击砸向 {TARGET} ({VAL}伤害)！", mult: 5.0, tag: SKILL_TAGS.PHYS },
];

const DIVA_BUFF_POOL: GachaEntry[] = [
  { text: "🎵 {USER} 唱起了《甩葱歌》！全队心情愉悦，恢复了 {VAL} 生命！", tag: SKILL_TAGS.HEAL, mult: 2.0 },
  { text: "🎤 {USER} 开启演唱会模式！全队攻击力大幅提升！(Buff)", tag: SKILL_TAGS.BUFF, status: 'RAGE' },
  { text: "🎹 {USER} 弹奏治愈之音！全队获得持续恢复效果！(Regen)", tag: SKILL_TAGS.BUFF, status: 'REGEN' },
  { text: "🎼 {USER} 高音爆发！震晕了 {TARGET}，并为队友加油！", tag: SKILL_TAGS.MAG, mult: 1.0, status: 'STUN' },
  { text: "🎸 {USER} 摇滚时刻！全队获得反击护盾！(Counter)", tag: SKILL_TAGS.BUFF, status: 'COUNTER' },
  { text: "🎧 {USER} 戴上耳机，隔绝噪音！全队魔抗大幅提升！", tag: SKILL_TAGS.BUFF, status: 'PLUG_SKIN' },
  { text: "📢 {USER} 大声应援！所有队友技能冷却刷新！（攻击力小幅提升）", tag: SKILL_TAGS.BUFF, statBuff: { atk: 1.2 } },
  { text: "💃 {USER} 绝美舞姿！魅惑了 {TARGET}，让它无法行动！", tag: SKILL_TAGS.DEBUFF, status: 'CHARMED' },
  { text: "🌟 {USER} 星光闪耀！全队获得短暂无敌！", tag: SKILL_TAGS.BUFF, status: 'INVUL' },
  { text: "💊 {USER} 投喂润喉糖！全队解除了所有异常状态！", tag: SKILL_TAGS.HEAL, mult: 0.5, cleanStatus: true },
  { text: "🎶 {USER} 节奏加速！全队速度提升！", tag: SKILL_TAGS.BUFF, statBuff: { spd: 1.5 } },
  { text: "🛡️ {USER} 粉丝护卫队！召唤人墙保护全队（防御提升）！", tag: SKILL_TAGS.BUFF, statBuff: { def: 1.5 } },
  { text: "✨ {USER} 舞台特效！烟雾缭绕，全队闪避率提升！", tag: SKILL_TAGS.BUFF, statBuff: { agl: 1.5 } },
  { text: "❤️ {USER} 粉丝回馈！全队回复大量生命 {VAL}！", tag: SKILL_TAGS.HEAL, mult: 2.5 },
  { text: "🔥 {USER} 燃曲压轴！全队全属性大幅提升！", tag: SKILL_TAGS.BUFF, status: 'PLUG_HEART' },
];

const VALORANT_POOL: GachaEntry[] = [
  { text: "🌪️ {USER} 杰特(Jett)附体！瞬风 (Tailwind)！速度拉满冲向 {TARGET} 造成 {VAL} 伤害！", tag: SKILL_TAGS.PHYS, mult: 2.5, status: 'INVUL' },
  { text: "🔥 {USER} 菲尼克斯(Phoenix)！火冒三丈！投掷火球对自己回血，对 {TARGET} 造成 {VAL} 伤害！", tag: SKILL_TAGS.MAG, mult: 2.0, lifesteal: 1.0, status: 'BURN' },
  { text: "🧛 {USER} 蕾娜(Reyna)！吞噬 (Devour)！处决了 {TARGET} 的一部分灵魂，回复大量生命 {VAL}！", tag: SKILL_TAGS.MAG, mult: 2.5, lifesteal: 1.2 },
  { text: "⚡ {USER} 霓虹(Neon)！极速过载！指尖闪电连射 {TARGET}，造成 {VAL} 点伤害！", tag: SKILL_TAGS.MAG, mult: 3.0, hits: 3 },
  { text: "🏹 {USER} 猎枭(Sova)！寻敌箭！透视全场！下一次攻击必定暴击！", tag: SKILL_TAGS.BUFF, status: 'AIM' },
  { text: "🐍 {USER} 蝰蛇(Viper)！开启毒幕！{TARGET} 吸入毒气，受到 {VAL} 伤害并持续衰弱！", tag: SKILL_TAGS.MAG, mult: 1.5, status: 'POISON' },
  { text: "💣 {USER} 雷兹(Raze)！晚安火炮！轰飞了 {TARGET} ({VAL}伤害)！", tag: SKILL_TAGS.PHYS, mult: 4.0, ignoreDef: true },
  { text: "📷 {USER} 零(Cypher)！这具尸体在哪？获取了 {TARGET} 的位置，降低其防御！", tag: SKILL_TAGS.DEBUFF, status: 'CTR_WEAK' },
  { text: "❄️ {USER} 贤者(Sage)！治愈之球！给自己回复了 {VAL} 生命。", tag: SKILL_TAGS.HEAL, mult: 3.0 },
  { text: "🌫️ {USER} 幽影(Omen)！黑影笼罩！{TARGET} 视野丢失 (致盲)！", tag: SKILL_TAGS.DEBUFF, status: 'BLIND' },
  { text: "🤖 {USER} 奇乐(Killjoy)！全面封锁！倒计时结束... 束缚了所有敌人！", tag: SKILL_TAGS.MAG, mult: 1.0, status: 'STUN' },
  { text: "🌍 {USER} 星礈(Astra)！宇宙分裂！进入星界形态，免疫所有伤害！", tag: SKILL_TAGS.BUFF, status: 'INVUL' },
  { text: "🔨 {USER} 炼狱(Brimstone)！天降以此！轨道激光炮轰炸 {TARGET} 造成 {VAL} 毁灭伤害！", tag: SKILL_TAGS.MAG, mult: 4.5 },
  { text: "🌊 {USER} 海港(Harbor)！狂潮！召唤水墙阻挡伤害！", tag: SKILL_TAGS.BUFF, status: 'PLUG_SKIN' },
  { text: "🔆 {USER} 斯凯(Skye)！追猎之灵！三只绿狗扑向 {TARGET} ({VAL}伤害) 并致盲！", tag: SKILL_TAGS.MAG, mult: 2.0, status: 'VALO_FLASH' },
];

const VALORANT_GUNS_POOL: GachaEntry[] = [
  { text: "🔫 {USER} 掏出「暴徒 (Vandal)」！爆头一击！对 {TARGET} 造成 {VAL} 伤害！", mult: 1.5, tag: SKILL_TAGS.PHYS },
  { text: "🔫 {USER} 掏出「幻象 (Phantom)」！近距离扫射！对 {TARGET} 造成 {VAL} 伤害！", mult: 1.4, tag: SKILL_TAGS.PHYS },
  { text: "🔭 {USER} 架起了「冥驹 (Operator)」！一枪一个！对 {TARGET} 造成 {VAL} 致命伤害！", mult: 2.5, tag: SKILL_TAGS.PHYS, ignoreDef: true },
  { text: "🔫 {USER} 使用「神射 (Sheriff)」！ECO局的神！对 {TARGET} 造成 {VAL} 伤害！", mult: 1.8, tag: SKILL_TAGS.PHYS },
  { text: "🔪 {USER} 掏出「蝴蝶刀」！检视...检视... 背刺 {TARGET} ({VAL}伤害)！", mult: 1.2, tag: SKILL_TAGS.PHYS },
  { text: "💥 {USER} 掏出「奥丁 (Odin)」！穿墙扫射！哒哒哒哒！对 {TARGET} 造成 {VAL} 压制伤害！", mult: 1.6, hits: 2, tag: SKILL_TAGS.PHYS },
];

const BABY_SUPPORT_POOL: GachaEntry[] = [
  { text: "🍼 {USER} 递上「爱心奶瓶」！克蕾儿全属性大幅提升！", tag: SKILL_TAGS.BUFF, status: 'PLUG_HEART' },
  { text: "🛡️ {USER} 展开「绝对溺爱」护盾！克蕾儿获得无敌！", tag: SKILL_TAGS.BUFF, status: 'INVUL' },
  { text: "💋 {USER} 献上「胜利之吻」！克蕾儿下次攻击必暴击！", tag: SKILL_TAGS.BUFF, status: 'AIM' },
  { text: "🩸 {USER} 输送「生命之源」！克蕾儿恢复 {VAL} 点生命！", tag: SKILL_TAGS.HEAL, mult: 4.0 },
  { text: "🧹 {USER} 帮忙「清理战场」！对 {TARGET} 造成 {VAL} 点清扫伤害！", tag: SKILL_TAGS.MAG, mult: 2.5 },
  { text: "🔋 {USER} 充能「魔力电池」！克蕾儿魔力暴涨！", tag: SKILL_TAGS.BUFF, statBuff: { mag: 2.0 } },
  { text: "🔪 {USER} 递上「磨刀石」！克蕾儿攻击力暴涨！", tag: SKILL_TAGS.BUFF, statBuff: { atk: 2.0 } },
  { text: "👀 {USER} 帮忙「寻找弱点」！降低 {TARGET} 的防御和魔抗！", tag: SKILL_TAGS.DEBUFF, status: 'CTR_WEAK' },
  { text: "🛑 {USER} 大喊「不许欺负她」！眩晕了 {TARGET}！", tag: SKILL_TAGS.DEBUFF, status: 'STUN' },
  { text: "🩹 {USER} 贴上「创可贴」！解除了克蕾儿的异常状态！", tag: SKILL_TAGS.HEAL, mult: 1.0, cleanStatus: true },
  { text: "📢 {USER} 呼叫「场外援助」！轰炸 {TARGET} 造成 {VAL} 伤害！", tag: SKILL_TAGS.PHYS, mult: 3.0 },
  { text: "🕰️ {USER} 发动「时间倒流」！重置了克蕾儿的技能冷却！", tag: SKILL_TAGS.BUFF, status: 'REGEN' },
  { text: "⛓️ {USER} 释放「爱的束缚」！{TARGET} 无法移动（冰冻）！", tag: SKILL_TAGS.DEBUFF, status: 'FREEZE' },
  { text: "🧚‍♀️ {USER} 化身「守护精灵」！克蕾儿闪避率大幅提升！", tag: SKILL_TAGS.BUFF, statBuff: { agl: 2.0 } },
  { text: "💕 {USER} 此时此刻！也是无敌的！两人双双进入暴走状态！", tag: SKILL_TAGS.BUFF, status: 'RAGE' },
];

// Pool entry type for TUJUANJUAN_CALC_POOL — extends GachaEntry
interface CalcPoolEntry extends GachaEntry {
  onExecute?: (ctx: SkillContext) => boolean;
}

const TUJUANJUAN_CALC_POOL: CalcPoolEntry[] = [
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

const TUJUANJUAN_STYLE_POOL: StylePoolEntry[] = [
  { text: '👓 \u201c这波啊，这波我在第五层。\u201d {USER} 切换为【精明女人】风格！', status: 'STYLE_SMART', statBuff: { wis: 2.0, spd: 2.0 } },
  { text: '💋 \u201c成熟大姐姐来咯~\u201d {USER} 切换为【性感女人】风格！', status: 'STYLE_SEXY', statBuff: { atk: 1.2 } },
  { text: '😡 \u201c你再说一句试试？！\u201d {USER} 切换为【暴躁女人】风格！', status: 'STYLE_ANGRY', statBuff: { def: 0.01, res: 0.01, atk: 3.0 } },
  { text: '🤪 \u201c诶？等等，刚刚发生了什么？\u201d {USER} 切换为【笨蛋女人】风格！', status: 'STYLE_FOOL' },
  { text: '💅 \u201c你看我这身好看吗？\u201d {USER} 切换为【虚荣女人】风格！', status: 'STYLE_VAIN' },
  { text: '🍳 \u201c要好好照顾自己呀~\u201d {USER} 切换为【顾家女人】风格！', status: 'STYLE_FAMILY', statBuff: { def: 3.0, res: 3.0 } },
  { text: '👑 \u201c平身！\u201d {USER} 抽到了 5% 的大奖！穿上龙袍登基为王！化身【帝皇铠甲】风格！', status: 'STYLE_EMPEROR', statBuff: { atk: 3.0, wis: 2.0, spd: 2.0, def: 3.0, res: 3.0 } },
];

export const namerenaData = {
  SKILL_TAGS, STATUS_EFFECTS, COLORS,
  COLD_JOKES_POOL, HELL_JOKES_POOL, CHEESY_LINES_POOL, TOKUSATSU_BASIC_POOL,
  RED_FURY_POOL, SUICIDE_POOL, GACHA_NORMAL_POOL, EXODIA_CARD, GACHA_SSR_POOL,
  DIVA_BUFF_POOL, VALORANT_POOL, VALORANT_GUNS_POOL, BABY_SUPPORT_POOL,
  TUJUANJUAN_CALC_POOL,
  TUJUANJUAN_STYLE_POOL,

  SUCCUBUS_COUNTER_POOL: [
    { text: "💕 {USER} 摆出诱惑姿态，准备【魅惑反击】！", tag: SKILL_TAGS.BUFF, status: 'CTR_CHARM' },
    { text: "😵 {USER} 散发恐怖气场，准备【震慑反击】！", tag: SKILL_TAGS.BUFF, status: 'CTR_STUN' },
    { text: "🧛 {USER} 张开鲜血结界，准备【汲取反击】！", tag: SKILL_TAGS.BUFF, status: 'CTR_DRAIN' },
    { text: "🦠 {USER} 涂抹致命毒素，准备【剧毒反击】！", tag: SKILL_TAGS.BUFF, status: 'CTR_POISON' },
    { text: "🔥 {USER} 召唤地狱烈焰，准备【烈焰反击】！", tag: SKILL_TAGS.BUFF, status: 'CTR_BURN' },
    { text: "🧊 {USER} 凝结极寒冰霜，准备【极寒反击】！", tag: SKILL_TAGS.BUFF, status: 'CTR_FREEZE' },
    { text: "🌌 {USER} 扭曲周围空间，准备【虚空反击】！", tag: SKILL_TAGS.BUFF, status: 'CTR_VOID' },
    { text: "📉 {USER} 释放虚弱诅咒，准备【虚弱反击】！", tag: SKILL_TAGS.BUFF, status: 'CTR_WEAK' },
    { text: "🌀 {USER} 制造幻象迷宫，准备【混乱反击】！", tag: SKILL_TAGS.BUFF, status: 'CTR_CONFUSE' },
    { text: "☠️ {USER} 磨亮了处刑镰刀，准备【断头反击】！", tag: SKILL_TAGS.BUFF, status: 'CTR_EXECUTE' },
  ] as GachaEntry[],

  CHIMERA_PLUGIN_POOL: [
    { text: "🦷 {USER} 安装了头部插件【暴食之口】！(获得吸血被动，习得「暴食·吞界法」)", tag: SKILL_TAGS.BUFF, status: 'PLUG_HEAD', newSkill: 'chimera_devour', statBuff: { atk: 1.5 } },
    { text: "⚔️ {USER} 安装了手臂插件【斩舰巨刃】！(攻击暴击大增，习得「处刑·断头台」)", tag: SKILL_TAGS.BUFF, status: 'PLUG_ARM', newSkill: 'chimera_execute', statBuff: { atk: 1.3, crit: 0.2 } },
    { text: "🛸 {USER} 安装了背部插件【浮游炮阵】！(魔力智力大增，习得「歼灭·全弹发射」)", tag: SKILL_TAGS.BUFF, status: 'PLUG_BACK', newSkill: 'chimera_funnels', statBuff: { mag: 1.5, wis: 1.5 } },
    { text: "☢️ {USER} 安装了心脏插件【永动炉心】！(全属性强化，习得「再生·血肉重铸」)", tag: SKILL_TAGS.BUFF, status: 'PLUG_HEART', newSkill: 'chimera_reconstruct', statBuff: { atk: 1.2, def: 1.2, spd: 1.2, mag: 1.2 } },
    { text: "👁️ {USER} 安装了眼部插件【石化魔眼】！(魔力命中提升，习得「魔眼·美杜莎」)", tag: SKILL_TAGS.BUFF, status: 'PLUG_EYE', newSkill: 'chimera_petrify', statBuff: { mag: 1.3, agl: 1.3 } },
    { text: "🛡️ {USER} 安装了皮肤插件【纳米皮肤】！(双抗大幅提升，习得「堡垒·绝对力场」)", tag: SKILL_TAGS.BUFF, status: 'PLUG_SKIN', newSkill: 'chimera_fortress', statBuff: { def: 1.5, res: 1.5 } },
    { text: "🦶 {USER} 安装了腿部插件【反重力足】！(速度闪避提升，习得「极速·缩地成寸」)", tag: SKILL_TAGS.BUFF, status: 'PLUG_LEG', newSkill: 'chimera_warp', statBuff: { spd: 1.5, agl: 1.5 } },
    { text: "🦂 {USER} 安装了尾部插件【灾厄毒尾】！(攻击魔力提升，习得「灾厄·病毒君王」)", tag: SKILL_TAGS.BUFF, status: 'PLUG_TAIL', newSkill: 'chimera_plague', statBuff: { atk: 1.3, mag: 1.3 } },
  ] as GachaEntry[],
};
