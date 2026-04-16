import type {
  SkillContext,
  SkillDefinition,
  StatKey,
  StylePoolEntry,
} from './types';
import { namerenaData as Data } from './data';

const {
  SKILL_TAGS,
  RED_FURY_POOL,
  SUICIDE_POOL,
  GACHA_NORMAL_POOL,
  GACHA_SSR_POOL,
  TOKUSATSU_BASIC_POOL,
  COLD_JOKES_POOL,
  HELL_JOKES_POOL,
  CHEESY_LINES_POOL,
  SUCCUBUS_COUNTER_POOL,
  CHIMERA_PLUGIN_POOL,
  DIVA_BUFF_POOL,
  VALORANT_POOL,
  VALORANT_GUNS_POOL,
  BABY_SUPPORT_POOL,
  TUJUANJUAN_CALC_POOL,
  TUJUANJUAN_STYLE_POOL,
} = Data;

// Suppress unused-variable warnings for superseded pools (replaced by individual skill definitions)
void VALORANT_POOL, void VALORANT_GUNS_POOL,
void BABY_SUPPORT_POOL, void TUJUANJUAN_CALC_POOL;

// ---------------------------------------------------------------------------
// Helper: 摸鱼伙伴 synergy engine (丝瓜 ↔ 兔卷卷 bond)
// ---------------------------------------------------------------------------
const executeSlackingSynergy = (ctx: SkillContext): boolean => {
  const isSigua = (f: typeof ctx.user) =>
    f.job === 'VIRTUAL_DIVA' || f.job === 'VALO_JUNIOR' || f.job === 'MY_BABY' || f.name.includes('丝瓜');
  const isBunny = (f: typeof ctx.user) =>
    f.job === 'Q_BUNNY' || f.job === 'VERSATILE_RABBIT' || f.name.includes('兔卷卷') || f.name.includes('curly');

  const meSigua = isSigua(ctx.user);

  const partner = ctx.fighters.find(
    (f) =>
      f.id !== ctx.user.id &&
      !f.isDead &&
      !(f.status ?? []).some((s) => s.type === 'SYNERGY_SLACKING') &&
      !f.hasTriggeredSlacking &&
      (meSigua ? isBunny(f) : isSigua(f)),
  );

  if (partner && !ctx.user.hasTriggeredSlacking) {
    if (ctx.user.willSlackThisGame === undefined) {
      const willSlack = Math.random() < 0.35;
      ctx.user.willSlackThisGame = willSlack;
      partner.willSlackThisGame = willSlack;
      if (!willSlack) {
        ctx.user.hasTriggeredSlacking = true;
        partner.hasTriggeredSlacking = true;
      }
    }

    if (ctx.user.willSlackThisGame && !ctx.user.hasTriggeredSlacking) {
      if (Math.random() < 0.15) {
        ctx.user.hasTriggeredSlacking = true;
        partner.hasTriggeredSlacking = true;
        ctx.log('win', `✨ 【摸鱼伙伴羁绊】触发！战斗进行到一半，${ctx.user.name} 和 ${partner.name} 突然对视了一眼，达成了某种默契...`);
        ctx.log('skill', `⛺ 两人以极快的速度手牵手脱离了战场，去外边悠闲地喝奶茶了！(进入场外OB状态，绝对无敌且无法被选中，5回合后回归)`);

        const applySynergy = (p: typeof ctx.user) => {
          p.status = (p.status ?? []).filter(
            (s) => !['VALO_HOLDING_ANGLE', 'WAIT_COUNTER', 'COUNTER', 'AIM'].includes(s.type) && !s.type.startsWith('CTR_'),
          );
          p.status.push({ type: 'SYNERGY_SLACKING', duration: 5 });
          p.status.push({ type: 'INVUL', duration: 5 });
          p.status.push({ type: 'BKB', duration: 5 });
          p.status.push({ type: 'STUN', duration: 5 });
          p.wasSynergySlacking = true;
        };

        applySynergy(ctx.user);
        applySynergy(partner);
        return true;
      }
    }
  }

  // Fallback: force job-appropriate action
  let fallback = 'bash';
  if (ctx.user.job === 'VIRTUAL_DIVA') {
    fallback = 'diva_song';
  } else if (ctx.user.job === 'VALO_JUNIOR') {
    ctx.user.ultPoints = (ctx.user.ultPoints ?? 0) + 1;
    ctx.user.economy = (ctx.user.economy ?? 0) + 1;
    if (ctx.user.ultPoints >= 5) {
      let validUlts = [
        'valo_ult_showstopper', 'valo_ult_blade_storm', 'valo_ult_cosmic_divide',
        'valo_ult_resurrection', 'valo_ult_lockdown', 'valo_ult_vipers_pit',
        'valo_ult_empress', 'valo_ult_hunters_fury', 'valo_ult_null_cmd',
        'valo_ult_run_it_back', 'valo_ult_orbital_strike', 'valo_ult_neural_theft',
      ];
      if (!ctx.fighters.some((f) => f.isDead && ctx.getTeamId(f) === ctx.getTeamId(ctx.user) && f.id !== ctx.user.id)) {
        validUlts = validUlts.filter((ult) => ult !== 'valo_ult_resurrection');
      }
      ctx.user.ultPoints = 0;
      ctx.log('win', `✨ 大招充能完毕！${ctx.user.name} 准备释放终极技能！`);
      fallback = validUlts[Math.floor(Math.random() * validUlts.length)];
    } else if ((ctx.user.economy ?? 0) >= 6) {
      if (!ctx.user.savedSpd) {
        ctx.user.savedSpd = ctx.user.spd;
        ctx.user.savedAgl = ctx.user.agl;
        ctx.user.spd = Math.floor(ctx.user.spd * 0.5);
        ctx.user.agl = 0;
        ctx.log('win', `🔭 资金充足！${ctx.user.name} 起了一把【冥驹 (Operator)】！进入架枪姿态，速度和闪避大幅降低！`);
      }
      fallback = 'valo_operator_shot';
    } else {
      if (ctx.user.savedSpd) {
        ctx.user.spd = ctx.user.savedSpd;
        ctx.user.agl = ctx.user.savedAgl ?? 0;
        delete ctx.user.savedSpd;
        delete ctx.user.savedAgl;
      }
      fallback = (ctx.user.economy ?? 0) >= 2 ? 'valo_vandal_shot' : 'valo_classic_shot';
    }
  } else if (ctx.user.job === 'MY_BABY') {
    fallback = 'baby_cheer';
  } else if (ctx.user.job === 'Q_BUNNY') {
    fallback = 'q_bunny_attack';
  } else if (ctx.user.job === 'VERSATILE_RABBIT') {
    fallback = 'v_rabbit_calc_rng';
  }

  ctx.executeSkillAction(fallback, ctx.user, ctx.target, ctx.triggerDepth + 1);
  return true;
};

// ---------------------------------------------------------------------------
// SKILLS record
// ---------------------------------------------------------------------------
const SKILLS: Record<string, SkillDefinition> = {
  slacking: { name: '寻找摸鱼搭子', tag: SKILL_TAGS.SPECIAL, rate: 1.0, condition: (u) => !u.hasTriggeredSlacking, onExecute: executeSlackingSynergy },
  slack_off: { name: '寻找摸鱼搭子', tag: SKILL_TAGS.SPECIAL, rate: 1.0, condition: (u) => !u.hasTriggeredSlacking, onExecute: executeSlackingSynergy },
  moyu: { name: '寻找摸鱼搭子', tag: SKILL_TAGS.SPECIAL, rate: 1.0, condition: (u) => !u.hasTriggeredSlacking, onExecute: executeSlackingSynergy },

  diva_song: { name: '歌姬演唱', tag: SKILL_TAGS.BUFF, isGacha: true, pool: DIVA_BUFF_POOL, text: '🎤 {USER} 开始演唱...' },

  valo_classic_shot: {
    name: '标配(Classic)', tag: SKILL_TAGS.PHYS, isGacha: true,
    pool: [
      ...Array(9).fill({ text: '🔫 {USER} 使用标配手枪点射了 {TARGET}，造成 {VAL} 伤害！', mult: 0.8 }),
      { text: '🎯 {USER} 手感火热！标配一发爆头击中了 {TARGET}！造成 {VAL} 真实伤害！', mult: 2.5, ignoreDef: true },
    ],
    text: '🔫 {USER} 掏出手枪...',
  },
  valo_vandal_shot: { name: '狂徒(Vandal)', tag: SKILL_TAGS.PHYS, mult: 1.5, text: '🔫 {USER} 使用狂徒步枪扫射 {TARGET}，造成 {VAL} 伤害！' },
  valo_operator_shot: { name: '冥驹(Operator)', tag: SKILL_TAGS.PHYS, mult: 5.0, ignoreDef: true, text: '🔭 {USER} 屏息凝神... 砰！冥驹轰鸣，一枪穿透了 {TARGET}！造成 {VAL} 真实伤害！' },
  valo_holding_angle: { name: '架枪预瞄', tag: SKILL_TAGS.BUFF, status: 'VALO_HOLDING_ANGLE', text: '🔭 {USER} 停止移动，进入了架枪预瞄姿态！' },
  valo_pre_fire: { name: '提前枪', tag: SKILL_TAGS.PHYS, mult: 1.5, status: 'VALO_AIM_PUNCH', text: '🔫 {USER} 扣下扳机，精准的提前枪击中了 {TARGET} 并附加了【截停】！' },

  valo_ult_showstopper: {
    name: '晚安火炮', tag: SKILL_TAGS.PHYS, mult: 3.0, text: '🚀 {USER} 掏出火箭筒："FIRE IN THE HOLE！" 轰炸了 {TARGET}，造成 {VAL} 毁灭伤害！',
    afterExecute: (ctx, dmg) => {
      const otherEnemies = (ctx.currentTargets ?? []).filter((f) => f.id !== ctx.target.id && !f.isDead).sort(() => 0.5 - Math.random()).slice(0, 2);
      if (otherEnemies.length > 0) {
        ctx.log('skill', `🚀 【晚安火炮】爆炸波及了周围的敌人！造成大量范围伤害！`);
        const aoeDmg = Math.floor(dmg * 0.8);
        otherEnemies.forEach((e) => {
          const actualDmg = ctx.applyDamage(e, aoeDmg, 'skill');
          ctx.log('info', `💥 爆炸余波重创了 ${e.name}，造成了 ${actualDmg} 点伤害！`);
          if (e.currentHp <= 0 && !e.isDeadAnnounced && !e.isDead) {
            ctx.log('death', `💀 【范围击杀】${e.name} 被晚安火炮的余波炸碎了！`);
            e.isDeadAnnounced = true;
            ctx.user.stats.kills += 1;
          }
          const idx = (ctx.fighters ?? []).findIndex((x) => x.id === e.id);
          if (idx !== -1) ctx.fighters[idx] = e;
        });
      }
    },
  },

  valo_ult_blade_storm: {
    name: '飓刃', tag: SKILL_TAGS.PHYS, mult: 2.0, ignoreDef: true, text: '🔪 {USER} 召唤出环绕的飓刃！飞刀贯穿了 {TARGET}，造成 {VAL} 真实伤害！',
    afterExecute: (ctx) => {
      if (ctx.target.currentHp <= 0 && !ctx.target.isDead) {
        ctx.log('win', `🔪 【飓刃】收割！${ctx.user.name} 拿到击杀，刷新行动条，立即再次出手！`);
        ctx.executeSkillAction('valo_ult_blade_storm', ctx.user, null, ctx.triggerDepth + 1);
      }
    },
  },

  valo_ult_empress: { name: '女皇神威', tag: SKILL_TAGS.BUFF, status: 'VALO_ULT_EMPRESS', statBuff: { atk: 2.0, spd: 2.0 }, text: '👑 {USER} 进入女皇状态！"绝不留情！" 攻击力与速度翻倍，且获得100%吸血！' },
  valo_ult_run_it_back: { name: '再火一回', tag: SKILL_TAGS.BUFF, status: 'VALO_ULT_RUN_IT_BACK', text: '🔥 {USER} 留下了时空标记："别急，我还会回来的！" 获得了免死金牌！' },
  valo_ult_hunters_fury: { name: '狂猎之怒', tag: SKILL_TAGS.MAG, mult: 1.5, hits: 3, ignoreDef: true, text: '🦅 {USER} 张弓搭箭："我就是猎人！" 三道能量箭穿透了 {TARGET}，共造成 {VAL} 真实伤害！' },

  valo_ult_orbital_strike: {
    name: '天降以此', tag: SKILL_TAGS.MAG, mult: 6.0, text: '🛰️ {USER} 呼叫轨道打击："准备迎接地狱火吧！" 激光炮锁定了 {TARGET}，造成 {VAL} 毁灭伤害！',
    afterExecute: (ctx, dmg, hpBeforeDamage) => {
      if (dmg > (hpBeforeDamage ?? 0)) {
        const overflow = dmg - (hpBeforeDamage ?? 0);
        const otherEnemies = (ctx.currentTargets ?? []).filter((f) => f.id !== ctx.target.id && !f.isDead);
        if (otherEnemies.length > 0) {
          ctx.log('crit', `🛰️ 【天降以此】火力过剩！溢出的 ${overflow} 点伤害溅射给了其他敌人！`);
          const splashDmg = Math.floor(overflow / otherEnemies.length);
          otherEnemies.forEach((e) => {
            const actualDmg = ctx.applyDamage(e, splashDmg, 'skill');
            ctx.log('info', `🔥 轨道炮的炽热余波溅射到了 ${e.name}，造成了 ${actualDmg} 点伤害！`);
            if (e.currentHp <= 0 && !e.isDeadAnnounced && !e.isDead) {
              ctx.log('death', `💀 【溅射击杀】${e.name} 被轨道炮的余波轰成了渣！`);
              e.isDeadAnnounced = true;
              ctx.user.stats.kills += 1;
            }
            const idx = (ctx.fighters ?? []).findIndex((x) => x.id === e.id);
            if (idx !== -1) ctx.fighters[idx] = e;
          });
        }
      }
    },
  },

  valo_ult_cosmic_divide: {
    name: '宇宙分裂', tag: SKILL_TAGS.SPECIAL, text: '🌍 {USER} 撕裂空间...',
    onExecute: (ctx) => {
      const userTeamId = ctx.getTeamId(ctx.user);
      const allies = (ctx.fighters ?? []).filter((f) => !f.isDead && ctx.getTeamId(f) === userTeamId);
      allies.forEach((a) => {
        a.status = a.status ?? [];
        a.status.push({ type: 'INVUL', duration: 1 });
        a.status = a.status.filter(
          (s) => !['STUN', 'FREEZE', 'BURN', 'POISON', 'BLIND', 'SILENCE', 'CONFUSED', 'CHARMED', 'VALO_AIM_PUNCH', 'NEURAL_THEFT_DEBUFF'].includes(s.type),
        );
        const idx = (ctx.fighters ?? []).findIndex((x) => x.id === a.id);
        if (idx !== -1) ctx.fighters[idx] = a;
      });
      ctx.log('win', `🌍 【宇宙分裂】${ctx.user.name} 撕裂了空间！全队获得绝对无敌并净化所有负面状态！`);
      return true;
    },
  },

  valo_ult_resurrection: {
    name: '复活', tag: SKILL_TAGS.SPECIAL, text: '💉 {USER} 注入生命之玉...',
    onExecute: (ctx) => {
      const myTeamId = ctx.getTeamId(ctx.user);
      const deadTeammates = (ctx.fighters ?? []).filter(
        (f) => f.isDead && ctx.getTeamId(f) === myTeamId && f.id !== ctx.user.id,
      );
      if (deadTeammates.length > 0) {
        const targetToRevive = deadTeammates[Math.floor(Math.random() * deadTeammates.length)];
        targetToRevive.isDead = false;
        targetToRevive.isDeadAnnounced = false;
        targetToRevive.currentHp = targetToRevive.maxHp;
        targetToRevive.hpPct = 1.0;
        ctx.log('win', `💉 【复活】${ctx.user.name} 消耗终极点数，复活了 ${targetToRevive.name} (恢复了 ${targetToRevive.maxHp} 点生命)！"你的职责尚未完成！"`);
        const revIdx = (ctx.fighters ?? []).findIndex((f) => f.id === targetToRevive.id);
        if (revIdx !== -1) ctx.fighters[revIdx] = targetToRevive;
      }
      return true;
    },
  },

  valo_ult_lockdown: {
    name: '全面封锁', tag: SKILL_TAGS.SPECIAL, text: '🤖 {USER} 部署封锁装置...',
    onExecute: (ctx) => {
      (ctx.currentTargets ?? []).forEach((e) => {
        e.status = e.status ?? [];
        e.status.push({ type: 'STUN', duration: 2 });
        const idx = (ctx.fighters ?? []).findIndex((x) => x.id === e.id);
        if (idx !== -1) ctx.fighters[idx] = e;
      });
      ctx.log('skill', `🤖 【全面封锁】倒计时结束！${ctx.user.name} 的装置释放次级波，眩晕了所有敌人！`);
      return true;
    },
  },

  valo_ult_vipers_pit: {
    name: '蝰蛇神殿', tag: SKILL_TAGS.SPECIAL, text: '🐍 {USER} 展开毒幕...',
    onExecute: (ctx) => {
      (ctx.currentTargets ?? []).forEach((e) => {
        e.status = e.status ?? [];
        e.status.push({ type: 'POISON', duration: 3 });
        e.status.push({ type: 'BLIND', duration: 3 });
        e.def = Math.floor(e.def * 0.5);
        e.res = Math.floor(e.res * 0.5);
        const idx = (ctx.fighters ?? []).findIndex((x) => x.id === e.id);
        if (idx !== -1) ctx.fighters[idx] = e;
      });
      ctx.log('skill', `🐍 【蝰蛇神殿】全场弥漫剧毒！所有敌人中毒、致盲且防御骤降！`);
      return true;
    },
  },

  valo_ult_null_cmd: {
    name: '全面压制', tag: SKILL_TAGS.SPECIAL, text: '🤖 {USER} 发射抑制脉冲...',
    onExecute: (ctx) => {
      (ctx.currentTargets ?? []).forEach((e) => {
        e.status = e.status ?? [];
        e.status.push({ type: 'SILENCE', duration: 3 });
        const idx = (ctx.fighters ?? []).findIndex((x) => x.id === e.id);
        if (idx !== -1) ctx.fighters[idx] = e;
      });
      ctx.user.atk = Math.floor(ctx.user.atk * 1.5);
      ctx.log('skill', `🤖 【全面压制】抑制脉冲激活！所有敌人被【沉默】，${ctx.user.name} 攻击力上升！`);
      return true;
    },
  },

  valo_ult_neural_theft: {
    name: '神经取缔', tag: SKILL_TAGS.SPECIAL, text: '📷 {USER} 抛出帽子读取记忆...',
    onExecute: (ctx) => {
      (ctx.currentTargets ?? []).forEach((e) => {
        e.status = e.status ?? [];
        e.status.push({ type: 'NEURAL_THEFT_DEBUFF', duration: 2 });
        e.agl = 0;
        const idx = (ctx.fighters ?? []).findIndex((x) => x.id === e.id);
        if (idx !== -1) ctx.fighters[idx] = e;
      });
      ctx.log('skill', `📷 【神经取缔】"我知道你们在哪！" 敌方全体弱点暴露（闪避归零、必吃暴击）！`);
      return true;
    },
  },

  // ── Baby support skills ──────────────────────────────────────────────────
  baby_feed: { name: '喂食Play', tag: SKILL_TAGS.HEAL, mult: 2.0, text: '🍼 {USER} 给 {TARGET} 喂了一口好吃的！恢复了 {VAL} 生命值！' },
  baby_laser: { name: '协助射击', tag: SKILL_TAGS.MAG, mult: 1.5, text: '🔫 {USER} 掏出光线枪补了一发！对 {TARGET} 造成 {VAL} 伤害！' },
  baby_satellite: { name: '卫星打击', tag: SKILL_TAGS.MAG, mult: 2.0, text: '🛰️ {USER} 呼叫了轨道炮支援！轰炸 {TARGET} 造成 {VAL} 伤害！' },
  baby_cheer: { name: '爱的鼓励', tag: SKILL_TAGS.BUFF, statBuff: { atk: 1.5, mag: 1.5 }, text: '💕 {USER} 给 {TARGET} 疯狂打Call！攻击和魔力大幅上升！' },
  baby_scan: { name: '弱点扫描', tag: SKILL_TAGS.DEBUFF, status: 'WEAK', text: '🔎 {USER} 扫描了 {TARGET} 的弱点！' },
  baby_shield: { name: '纳米护盾', tag: SKILL_TAGS.BUFF, status: 'INVUL', text: '🛡️ {USER} 给 {TARGET} 套上了纳米级无敌护盾！' },
  baby_speed: { name: '极速挂载', tag: SKILL_TAGS.BUFF, statBuff: { spd: 2.0, agl: 2.0 }, text: '⚡ {USER} 给 {TARGET} 安装了加速引擎！速度狂飙！' },
  baby_poison: { name: '投毒', tag: SKILL_TAGS.DEBUFF, status: 'POISON', text: '🧪 {USER} 悄悄给 {TARGET} 下了毒！' },
  baby_bandaid: { name: '创可贴', tag: SKILL_TAGS.HEAL, mult: 1.0, cleanStatus: true, text: '🩹 {USER} 给 {TARGET} 贴上了神奇创可贴！恢复了 {VAL} 生命值并解除了所有异常状态！' },

  // ── 乐子人（屑）skills ──────────────────────────────────────────────────
  cold_joke: { name: '冷笑话', tag: SKILL_TAGS.MAG, mult: 1.0, isRandomText: true, pool: COLD_JOKES_POOL, status: 'FREEZE', text: '❄️ {USER} 讲了一个冷笑话：\n"{JOKE}"\n{TARGET} 听完觉得好冷，受到了 {VAL} 魔法伤害并被冻结了！' },
  hell_joke: { name: '地狱笑话', tag: SKILL_TAGS.MAG, mult: 1.5, isRandomText: true, pool: HELL_JOKES_POOL, status: 'BURN', text: '🔥 {USER} 讲了一个地狱笑话：\n"{JOKE}"\n{TARGET} 破防了！受到 {VAL} 真实伤害并燃烧！', ignoreDef: true },
  deadly_prank: { name: '致命恶作剧', tag: SKILL_TAGS.PHYS, mult: 2.0, text: '🤡 {USER} 掏出一个爆炸礼盒丢向 {TARGET}，造成 {VAL} 伤害！' },
  troll_brainwash: { name: '群体洗脑', tag: SKILL_TAGS.DEBUFF, rate: 0.4, status: 'CONFUSED', text: '🌀 {USER} 讲了一个极度扭曲的地狱笑话，{TARGET} 陷入了深深的自我怀疑！(附加混乱)' },
  troll_steal: { name: '乐子偷取', tag: SKILL_TAGS.MAG, rate: 0.3, mult: 1.5, lifesteal: 0.5, text: '🃏 {USER} 以戏耍的姿态攻击了 {TARGET}，并偷取了大量生命力！造成 {VAL} 魔法伤害！' },
  cheesy_charm: { name: '土味情话', tag: SKILL_TAGS.DEBUFF, isRandomText: true, pool: CHEESY_LINES_POOL, status: 'CHARMED', text: '😬 {USER} 一本正经地对 {TARGET} 说：\n"{JOKE}"\n{TARGET} 尬得脚趾扣地，陷入了【魅惑】！' },

  // ── 魅魔（克蕾儿）skills ──────────────────────────────────────────────
  charm: { name: '魅惑', tag: SKILL_TAGS.DEBUFF, status: 'CHARMED', text: '💋 {USER} 向 {TARGET} 抛了个媚眼，{TARGET} 被彻底迷住了！' },
  life_drain: { name: '生命汲取', tag: SKILL_TAGS.MAG, mult: 1.2, lifesteal: 1.0, text: '🧛 {USER} 汲取了 {TARGET} 的生命力，造成 {VAL} 伤害并回复自身！' },
  succubus_counter: { name: '魅魔反制', tag: SKILL_TAGS.BUFF, isGacha: true, pool: SUCCUBUS_COUNTER_POOL, text: '😈 {USER} 摆出了诱惑的防御姿态...' },
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

  // ── 抽卡狂魔（牢鳄）skills ──────────────────────────────────────────────
  gacha_pull: { name: '单抽', tag: SKILL_TAGS.SPECIAL, isGacha: true, pool: GACHA_NORMAL_POOL, text: '🎲 {USER} 消耗阳寿进行了一次单抽...' },
  destiny_draw: { name: '命运抽卡', tag: SKILL_TAGS.SPECIAL, isGacha: true, pool: GACHA_SSR_POOL, text: '✨ {USER} 相信着卡组的羁绊，进行了命运抽卡！' },

  // ── 奇迹武刃（刺猬人）skills ────────────────────────────────────────────
  tokusatsu_basic: { name: '特摄必杀', tag: SKILL_TAGS.PHYS, mult: 1.5, isRandomText: true, pool: TOKUSATSU_BASIC_POOL, text: '⚡ {USER} 大喊："{JOKE}" 向 {TARGET} 发起必杀！造成 {VAL} 点伤害！' },
  rider_kick: { name: '骑士踢', tag: SKILL_TAGS.PHYS, mult: 2.5, text: '🦶 {USER} 飞跃而起，对 {TARGET} 释放了毁天灭地的骑士踢！造成 {VAL} 伤害！' },
  bujin_slash: { name: '武神之刃', tag: SKILL_TAGS.PHYS, mult: 3.0, ignoreDef: true, text: '🗡️ {USER} 拔出黑色的武神之刃，瞬间斩过 {TARGET}！造成 {VAL} 真实伤害！' },
  miracle_magic: { name: '奇迹魔法', tag: SKILL_TAGS.MAG, mult: 2.0, status: 'STUN', text: '✨ {USER} 发动奇迹炼金术！对 {TARGET} 造成 {VAL} 魔法伤害并眩晕！' },
  bujin_chair: { name: '武神王座', tag: SKILL_TAGS.BUFF, status: 'WAIT_COUNTER', text: '🪑 {USER} 召唤出武神王座并坐下，闭上眼睛进入绝对防守反击状态！' },
  monster_punch: { name: '怪兽重拳', tag: SKILL_TAGS.PHYS, mult: 4.0, text: '🦖 {USER} 挥动巨大的星形拳套，一拳将 {TARGET} 轰飞！造成 {VAL} 伤害！' },
  great_monster_victory: { name: '怪兽胜利', tag: SKILL_TAGS.PHYS, mult: 5.0, ignoreDef: true, text: '⭐ {USER} 触发必杀！【GREAT MONSTER VICTORY】！星光粉碎了 {TARGET}，造成 {VAL} 伤害！' },

  // ── 史莱姆（水人）skills ────────────────────────────────────────────────
  universal_acid: { name: '万能酸液', tag: SKILL_TAGS.MAG, mult: 1.5, status: 'POISON', text: '🧪 {USER} 喷出高腐蚀性酸液，对 {TARGET} 造成 {VAL} 伤害并中毒！' },
  liquid_mirage: { name: '镜花水月·波涌', tag: SKILL_TAGS.MAG, mult: 2.0, status: 'INVUL', text: '🌊 枪火在水面上只留下了倒影！{USER} 化作一滩流水穿透了 {TARGET} 的防线！造成 {VAL} 伤害并进入液化无敌状态！' },
  divine_shift: {
    name: '神权·沸腾与绝对零度', tag: SKILL_TAGS.HEAL, mult: 5.0, cleanStatus: true,
    condition: (u) => u.hpPct < 0.3,
    text: '🔄 【神权更迭】！{USER} 的水流躯体剧烈沸腾（蒸发所有负面状态）并瞬间重组！牺牲了部分速度，重塑了 {VAL} 点生命屏障！',
    onExecute: (ctx) => { ctx.user.spd = Math.floor(ctx.user.spd * 0.5); return false; },
  },
  abyssal_prison: {
    name: '深渊水牢', tag: SKILL_TAGS.MAG, mult: 1.5,
    text: '💧 {USER} 抬手升起一座深渊水牢！{TARGET} 引以为傲的反击姿态瞬间瓦解！只能在无尽的窒息中挣扎...',
    onExecute: (ctx) => {
      ctx.target.status = (ctx.target.status ?? []).filter((s) => s.type !== 'WAIT_COUNTER' && !s.type.startsWith('CTR_'));
      ctx.target.status.push({ type: 'WATER_PRISON', duration: 3 });
      if (ctx.target.hpPct < 0.2) {
        ctx.target.currentHp = 0;
        if (!ctx.target.isDeadAnnounced && !ctx.target.isDead) {
          ctx.user.stats.kills += 1; // Bug 3 fix: attribute kill before setting isDeadAnnounced
          ctx.target.isDeadAnnounced = true;
          ctx.log('death', `💀 【溺毙处决】${ctx.target.name} 在深渊水牢中彻底停止了呼吸...`);
        }
      }
      return false;
    },
  },
  apocalyptic_flood: {
    name: '神罚·灭世大洪水', tag: SKILL_TAGS.MAG, mult: 4.0, ignoreDef: true,
    text: '🌊🌊🌊 【神罚·灭世大洪水】！天地倒转，万物归虚！{USER} 掀起吞噬整个战场的狂潮！全场所有敌人在洪水中受到无差别的 {VAL} 点真实伤害！',
    afterExecute: (ctx, dmg) => {
      const otherEnemies = (ctx.currentTargets ?? []).filter((f) => f.id !== ctx.target.id && !f.isDead);
      otherEnemies.forEach((e) => {
        const actualDmg = ctx.applyDamage(e, dmg, 'skill');
        ctx.log('info', `🌊 狂暴洪水吞噬了 ${e.name}，造成了 ${actualDmg} 点真实伤害！`);
        if (e.currentHp <= 0 && !e.isDeadAnnounced && !e.isDead) {
          ctx.log('death', `💀 【吞噬击杀】${e.name} 被狂暴的大洪水吞没溺毙！`);
          e.isDeadAnnounced = true;
          ctx.user.stats.kills += 1;
        }
        const idx = (ctx.fighters ?? []).findIndex((x) => x.id === e.id);
        if (idx !== -1) ctx.fighters[idx] = e;
      });
    },
  },
  ethereal_blade: { name: '虚灵之刃', tag: SKILL_TAGS.MAG, mult: 4.5, status: 'ETHEREAL', text: '👻 【Shotgun连招】！{USER} 祭出虚灵之刃！将 {TARGET} 打入虚无界，随后倾泻毁灭性的属性洪流！造成 {VAL} 点核爆魔法伤害！' },
  manta_style: {
    name: '幻影斧', tag: SKILL_TAGS.PHYS, mult: 1.5, hits: 3, ignoreDef: true,
    text: '🪓 斩断枷锁！{USER} 激活幻影斧，驱散一切污秽并幻化出两道水流残影！幻影齐出，对 {TARGET} 造成 3 次真伤连斩（共 {VAL} 伤害）！',
    onExecute: (ctx) => {
      if ((ctx.user.status ?? []).some((s) => s.type === 'ZEROED') && ctx.user.baseStatsForZero) {
        ctx.user.atk = ctx.user.baseStatsForZero.atk;
        ctx.user.def = ctx.user.baseStatsForZero.def;
        ctx.user.res = ctx.user.baseStatsForZero.res;
        ctx.user.wasZeroed = false;
        delete ctx.user.baseStatsForZero;
      }
      ctx.user.status = (ctx.user.status ?? []).filter((s) => s.type === 'LIQUID_BODY');
      ctx.user.agl = Math.floor(ctx.user.agl * 1.5);
      return false;
    },
  },
  eye_of_skadi: {
    name: '斯嘉蒂之眼', tag: SKILL_TAGS.MAG, mult: 2.5, status: 'FREEZE',
    text: '👁️ 感受极北的寒意！{USER} 凝聚斯嘉蒂之眼，射出霜寒水弹！{TARGET} 被绝对零度击中，生机与速度被彻底封印！',
    onExecute: (ctx) => {
      ctx.target.spd = Math.floor(ctx.target.spd * 0.2);
      ctx.target.atk = Math.floor(ctx.target.atk * 0.5);
      ctx.target.status = ctx.target.status ?? [];
      ctx.target.status.push({ type: 'NO_HEAL', duration: 3 });
      return false;
    },
  },
  linken_sphere: { name: '林肯法球', tag: SKILL_TAGS.BUFF, status: 'SPELL_BLOCK', text: '🔵 庇护之音响起！{USER} 周身凝结出林肯法球的蔚蓝光幕！免疫一切恶意，神明的威压不容侵犯！' },
  khanda: { name: '绝刃', tag: SKILL_TAGS.PHYS, mult: 3.5, ignoreDef: true, alwaysCrit: true, alwaysHit: true, text: '🔪 绝影无形，一击必杀！{USER} 唤醒绝刃，将法术的毁灭与利刃的锋芒融为一体，对 {TARGET} 斩出无法躲避的致命暴击（{VAL}伤害）！' },
  nullifier: {
    name: '否决挂件', tag: SKILL_TAGS.MAG, mult: 2.0, status: 'SILENCE',
    text: '📿 【万法归无】！{USER} 抛出否决挂件！{TARGET} 身上的所有神力、护盾与增益被瞬间强行剥夺！只能以凡人之躯承受降维打击！',
    onExecute: (ctx) => {
      ctx.target.status = (ctx.target.status ?? []).filter(
        (s) => !['INVUL', 'BKB', 'RAGE', 'PLUG_HEAD', 'PLUG_ARM', 'PLUG_BACK', 'PLUG_HEART', 'PLUG_EYE', 'PLUG_SKIN', 'PLUG_LEG', 'PLUG_TAIL', 'SPELL_BLOCK', 'LIQUID_BODY', 'VALO_ULT_EMPRESS', 'VALO_ULT_RUN_IT_BACK', 'DIVA_SONG', 'COUNTER', 'WAIT_COUNTER'].includes(s.type) && !s.type.startsWith('CTR_'),
      );
      return false;
    },
  },
  cosmic_slap: { name: '降维打击', tag: SKILL_TAGS.PHYS, mult: 9.9, ignoreDef: true, text: '🌌 所谓绝对防御，在神明眼中不过是层薄纸！{USER} 伸出高维触手，直接无视了 {TARGET} 的防御！造成 {VAL} 点降维真实伤害！' },

  // ── 小汀 skills ─────────────────────────────────────────────────────────
  red_fury_rng: { name: '红温', tag: SKILL_TAGS.SPECIAL, isGacha: true, pool: RED_FURY_POOL, text: '🌡️ {USER} 血压飙升，情绪完全失控...' },
  suicide_rng: { name: '以命换命', tag: SKILL_TAGS.PHYS, isGacha: true, pool: SUICIDE_POOL, text: '🩸 {USER} 豁出去了...' },
  spinal_slash: { name: '脊髓剑·斩', tag: SKILL_TAGS.PHYS, mult: 2.5, text: '🩸 {USER} 挥舞巨大的脊髓剑劈向 {TARGET}，造成 {VAL} 伤害！' },
  blood_mist: {
    name: '血雾爆发', tag: SKILL_TAGS.MAG, mult: 3.0, lifesteal: 1.0,
    text: '🌫️ {USER} 引爆了脊髓剑中的血液！对 {TARGET} 造成 {VAL} 伤害并大量吸血！脊髓剑随之破碎！',
    onExecute: (ctx) => {
      ctx.user.hasSpinalSword = false;
      ctx.user.status = (ctx.user.status ?? []).filter((s) => s.type !== 'SPINAL_SWORD');
      return false;
    },
  },
  suicide_bomb: { name: '自爆', tag: SKILL_TAGS.PHYS, mult: 8.0, ignoreDef: true, selfDmgPct: 1.0, text: '💣 {USER} 扑向了 {TARGET}，启动了自毁程序！"我和你爆了！！" 造成 {VAL} 真实伤害！' },
  grudge_curse: { name: '怨念诅咒', tag: SKILL_TAGS.DEBUFF, status: 'WEAK', text: '👻 {USER} 发出凄厉的哀嚎，{TARGET} 受到诅咒，攻击力大幅下降！' },
  summon_puppet_ting: { name: '召唤小汀', tag: SKILL_TAGS.SPECIAL, isSummon: true, summonName: '小汀(傀儡)', summonJob: 'WARRIOR', stats: { hp: 5000, atk: 100, def: 500 }, text: '🩸 {USER} 将脊髓剑插入地面... 鲜血汇聚，召唤出了一具名为【小汀(傀儡)】的无意识肉身保护自己！' },

  // ── 高端玩家（玄凝）skills ──────────────────────────────────────────────
  awp_shot: { name: '大狙盲狙', tag: SKILL_TAGS.PHYS, mult: 3.0, ignoreDef: true, text: '🎯 {USER} 掏出AWP，空中转体360度盲狙，一枪爆了 {TARGET} 的头！造成 {VAL} 真实伤害！' },
  flash_lol: { name: '闪现A', tag: SKILL_TAGS.PHYS, mult: 1.5, status: 'AIM', text: '✨ {USER} 极限闪现拉近距离，对 {TARGET} 打出必中一击！造成 {VAL} 伤害！' },
  hook_dota: { name: '肉钩', tag: SKILL_TAGS.PHYS, mult: 1.5, status: 'STUN', text: '🪝 {USER} 盲出肉钩，精准命中了 {TARGET}，造成 {VAL} 伤害并眩晕！' },
  helm_breaker: { name: '登龙剑', tag: SKILL_TAGS.PHYS, mult: 2.5, text: '🐉 {USER} 高高跃起，一招气刃兜割劈在 {TARGET} 身上！造成 {VAL} 伤害！' },
  tcs_mh: { name: '真蓄力斩', tag: SKILL_TAGS.PHYS, mult: 4.0, text: '⚔️ {USER} 完美铁山靠顶住攻击，随后猛力劈下真蓄力斩！对 {TARGET} 造成 {VAL} 伤害！' },
  waterfowl: { name: '水鸟乱舞', tag: SKILL_TAGS.PHYS, mult: 0.8, hits: 5, text: '🦢 {USER} 化身女武神，对 {TARGET} 施展水鸟乱舞！连续劈砍 5 次，共造成 {VAL} 伤害！' },
  bkb_dota: { name: '开启BKB', tag: SKILL_TAGS.BUFF, status: 'BKB', text: '🟡 {USER} 开启了黑皇杖，全身散发金光，免疫一切魔法控制！' },
  rush_b: { name: 'Rush B', tag: SKILL_TAGS.BUFF, statBuff: { spd: 2.0, atk: 1.5 }, text: "🏃 {USER} 大喊一声 \"Rush B, Don't stop!\"，速度和攻击力飙升！" },
  yasuo_q: { name: '哈撒给', tag: SKILL_TAGS.MAG, mult: 1.5, status: 'STUN', text: '🌪️ {USER} 斩出一道龙卷风，将 {TARGET} 高高击飞！造成 {VAL} 伤害！' },
  teemo_shroom: { name: '种蘑菇', tag: SKILL_TAGS.MAG, mult: 1.0, status: 'POISON', text: '🍄 {USER} 偷偷在 {TARGET} 脚下种了个毒蘑菇，造成 {VAL} 伤害并施加剧毒！' },
  divine_sunderer: { name: '神圣分离者', tag: SKILL_TAGS.PHYS, mult: 1.5, lifesteal: 0.5, text: '🔨 {USER} 触发耀光效果重击 {TARGET}，造成 {VAL} 伤害并回复自身血量！' },
  judgment_cut: { name: '次元斩', tag: SKILL_TAGS.MAG, mult: 3.0, ignoreDef: true, text: '🗡️ {USER} 拔刀瞬间切开空间，对 {TARGET} 造成 {VAL} 无视魔抗的次元伤害！' },
  kamehameha: { name: '龟派气功', tag: SKILL_TAGS.MAG, mult: 4.0, text: '🐢 {USER} 双手聚气："龟—派—气—功—波！" 轰穿了 {TARGET}，造成 {VAL} 伤害！' },
  zonia: { name: '金身', tag: SKILL_TAGS.BUFF, status: 'INVUL', text: '⏱️ {USER} 按下了中娅沙漏，化为小金人，进入无敌状态！' },
  aim_bot: { name: '锁头挂', tag: SKILL_TAGS.BUFF, status: 'AIM', statBuff: { crit: 1.0 }, text: '💻 {USER} 偷偷开启了锁头脚本... 下次攻击必定暴击且无法闪避！' },
  lag_switch: { name: '拔网线', tag: SKILL_TAGS.DEBUFF, status: 'STUN', text: '🔌 {USER} 物理拔掉了服务器网线！{TARGET} 掉线了，原地罚站！' },
  roll_dodge: { name: '翻滚无敌帧', tag: SKILL_TAGS.BUFF, status: 'INVUL', text: '🔄 {USER} 熟练地进行翻滚，利用无敌帧规避了即将到来的所有伤害！' },
  tp_scroll: { name: 'TP逃生', tag: SKILL_TAGS.HEAL, mult: 2.0, text: '📜 {USER} 亮起TP光芒，瞬间回到泉水恢复了 {VAL} 点生命值，又TP回了战场！' },
  warcry_dota: { name: '战吼', tag: SKILL_TAGS.BUFF, statBuff: { def: 2.0, res: 2.0 }, text: '吼 {USER} 发出战吼，护甲和魔抗大幅提升！' },

  // ── 兔卷卷 curly skills ─────────────────────────────────────────────────
  q_bunny_idol: {
    name: '偶像打歌', tag: SKILL_TAGS.HEAL, mult: 1.2, text: '🎵 {USER} 开始了爱豆Live！歌声治愈了大家...',
    onExecute: (ctx) => {
      const allies = (ctx.fighters ?? []).filter(
        (f) => !f.isDead && ctx.getTeamId(f) === ctx.getTeamId(ctx.user) && !(f.status ?? []).some((s) => s.type === 'SYNERGY_SLACKING'),
      );
      const healAmt = Math.floor(ctx.user.mag * 1.5);
      allies.forEach((a) => {
        if (!(a.status ?? []).some((s) => s.type === 'NO_HEAL')) a.currentHp = Math.min(a.maxHp, a.currentHp + healAmt);
        a.status = a.status ?? [];
        const existing = a.status.find((s) => s.type === 'Q_BUNNY_IDOL_AGL');
        if (existing) {
          existing.duration = 3;
        } else {
          a.status.push({ type: 'Q_BUNNY_IDOL_AGL', duration: 3 });
        }
      });
      ctx.log('heal', `🎵 【偶像打歌】可爱的歌声治愈了全队 (各恢复了 ${healAmt} 点生命) 并附加了 3 回合闪避加成！`);
      return true;
    },
  },
  q_bunny_attack: {
    name: '萌兔出击', tag: SKILL_TAGS.PHYS, mult: 0.3, alwaysHit: true,
    text: '🥕 {USER} 用短手短脚进行物理攻击... 虽然刮痧但绝对会打中 {TARGET} (造成了 {VAL} 点伤害)！',
  },
  q_bunny_cute: {
    name: '随地卖萌', tag: SKILL_TAGS.DEBUFF, text: '🐰 {USER} 歪头杀！{TARGET} 不忍心下手...',
    onExecute: (ctx) => {
      ctx.target.status = ctx.target.status ?? [];
      if (Math.random() < 0.5) {
        ctx.target.status.push({ type: 'CHARMED', duration: 2 });
        ctx.log('skill', `💕 卖萌暴击！${ctx.target.name} 被迷得神魂颠倒，陷入了魅惑！`);
      } else {
        ctx.target.atk = Math.floor(ctx.target.atk * 0.7);
        ctx.log('skill', `📉 ${ctx.target.name} 被萌化了，攻击力大幅下降！`);
      }
      return true;
    },
  },
  q_bunny_offkey: {
    name: '跑调绝杀', tag: SKILL_TAGS.MAG, mult: 2.0, ignoreDef: true, status: 'SILENCE',
    text: '🎤 {USER} 飙了个极度跑调的高音！魔音贯耳对 {TARGET} 造成了 {VAL} 点真实精神伤害并使其沉默！',
  },
  q_bunny_slide: {
    name: '兔兔滑铲', tag: SKILL_TAGS.BUFF, status: 'INVUL',
    text: '💨 {USER} "弹幕：太矮了根本打不到！" 利用体型优势极限滑铲，获得无敌状态！',
  },
  q_bunny_carrot: {
    name: '狂啃胡萝卜', tag: SKILL_TAGS.BUFF, status: 'REGEN', statBuff: { spd: 1.3, agl: 1.3 },
    text: '🥬 {USER} 掏出一根胡萝卜狂啃！获得了持续回血效果，并且速度和敏捷永久提升！',
  },

  v_rabbit_calc_rng: {
    name: '计算器盲按', tag: SKILL_TAGS.SPECIAL,
    text: '🧮 {USER} 掏出她的发声计算器，开始疯狂盲按...',
    onExecute: (ctx) => {
      const rolls = [
        { type: '114514', text: "🧮 滴—— 1 1 4 5 1 4... {USER} 播放了极其生草的恶臭数字！对 {TARGET} 造成了 {VAL} 点精神伤害并使其深度中毒！" },
        { type: '666666', text: "🧮 滴—— 6 6 6 6 6 6... 弹幕共鸣！{USER} 召唤弹幕狂潮，对 {TARGET} 造成了 6 段魔法打击（共 {VAL} 点伤害）！" },
        { type: '888888', text: "🧮 滴—— 8 8 8 8 8 8... 发发发发！{USER} 给全队发放了豪华恢复福利！" },
        { type: '5201314', text: "🧮 滴—— 5 2 0 1 3 1 4... {USER} 发射了极致的爱心飞吻！对 {TARGET} 造成了 {VAL} 点物理(物理)伤害并深度魅惑！" },
        { type: '233333', text: "🧮 滴—— 2 3 3 3 3 3... {USER} 疯狂嘲笑 {TARGET}，气势大增，摆出了绝对防守反击的姿态！" },
        { type: '996007', text: "🧮 滴—— 9 9 6 0 0 7... {USER} 强迫 {TARGET} 无休加班！重压对其造成了 {VAL} 点魔法伤害并附加灼烧，同时速度永久暴跌！" },
      ];

      const roll = rolls[Math.floor(Math.random() * rolls.length)];

      const doDamage = (baseDmg: number): number => {
        const res = ctx.user.jobData?.name === '欧皇' ? Math.floor(ctx.target.res * 0.5) : ctx.target.res;
        let finalDmg = Math.max(1, Math.floor(baseDmg * (1 + Math.random() * 0.2) - res * 0.5));
        if ((ctx.target.status ?? []).some((s) => s.type === 'ETHEREAL')) finalDmg = Math.floor(finalDmg * 2.0);
        const actualDmg = ctx.applyDamage(ctx.target, finalDmg, 'skill');
        if (ctx.user?.stats) ctx.user.stats.dmgDealt += actualDmg;
        return actualDmg;
      };

      if (roll.type === '114514') {
        const dmg = doDamage(Math.floor(ctx.user.mag * 1.5));
        ctx.log('skill', roll.text.replace(/{USER}/g, ctx.user.name).replace(/{TARGET}/g, ctx.target.name).replace('{VAL}', String(dmg)));
        ctx.target.status = ctx.target.status ?? [];
        ctx.target.status.push({ type: 'POISON', duration: 3 });
      } else if (roll.type === '666666') {
        let totalDmg = 0;
        for (let i = 0; i < 6; i++) {
          if (ctx.target.currentHp > 0) {
            let segDmg = Math.floor(ctx.user.mag * 0.5);
            if (Math.random() < 0.5) segDmg = Math.floor(segDmg * 1.5);
            totalDmg += doDamage(segDmg);
          }
        }
        ctx.log('crit', roll.text.replace(/{USER}/g, ctx.user.name).replace(/{TARGET}/g, ctx.target.name).replace('{VAL}', String(totalDmg)));
      } else if (roll.type === '888888') {
        ctx.log('skill', roll.text.replace(/{USER}/g, ctx.user.name));
        const allies = (ctx.fighters ?? []).filter(
          (f) => !f.isDead && ctx.getTeamId(f) === ctx.getTeamId(ctx.user) && !(f.status ?? []).some((s) => s.type === 'SYNERGY_SLACKING'),
        );
        const healAmt = Math.floor(ctx.user.mag * 2.0);
        const boostedValoNames: string[] = [];
        allies.forEach((a) => {
          if (!(a.status ?? []).some((s) => s.type === 'NO_HEAL')) {
            a.currentHp = Math.min(a.maxHp, a.currentHp + healAmt);
          }
          if (a.job === 'VALO_JUNIOR') {
            a.economy = (a.economy ?? 0) + 3;
            boostedValoNames.push(a.name);
          }
        });
        let logMsg = `✨ 【全队福利】发发发！我方全体各恢复了 ${healAmt} 点生命！`;
        if (boostedValoNames.length > 0) logMsg += `\n💰 联动彩蛋触发：队里的瓦学妹【${boostedValoNames.join('、')}】顺手狂赚了 3 点经济！`;
        ctx.log('heal', logMsg);
      } else if (roll.type === '5201314') {
        const dmg = doDamage(Math.floor(ctx.user.mag * 0.1));
        ctx.log('skill', roll.text.replace(/{USER}/g, ctx.user.name).replace(/{TARGET}/g, ctx.target.name).replace('{VAL}', String(dmg)));
        ctx.target.status = ctx.target.status ?? [];
        ctx.target.status.push({ type: 'CHARMED', duration: 3 });
      } else if (roll.type === '233333') {
        ctx.log('skill', roll.text.replace(/{USER}/g, ctx.user.name).replace(/{TARGET}/g, ctx.target.name));
        ctx.user.status = ctx.user.status ?? [];
        ctx.user.status.push({ type: 'COUNTER', duration: 2 });
      } else if (roll.type === '996007') {
        const dmg = doDamage(Math.floor(ctx.user.mag * 1.8));
        ctx.log('skill', roll.text.replace(/{USER}/g, ctx.user.name).replace(/{TARGET}/g, ctx.target.name).replace('{VAL}', String(dmg)));
        ctx.target.status = ctx.target.status ?? [];
        ctx.target.status.push({ type: 'BURN', duration: 3 });
        ctx.target.spd = Math.max(1, Math.floor(ctx.target.spd * 0.5));
      }

      if (ctx.target.currentHp <= 0 && !ctx.target.isDeadAnnounced && !ctx.target.isDead) {
        ctx.log('death', `💀 【击杀】${ctx.target.name} 承受不住这极其离谱的计算器魔法，当场暴毙！`);
        ctx.target.isDeadAnnounced = true;
        ctx.user.stats.kills += 1;
      }

      ctx.user.spd = Math.floor(ctx.user.spd * 1.15);
      if (ctx.user.baseStatsForStyle) ctx.user.baseStatsForStyle.spd = Math.floor((ctx.user.baseStatsForStyle.spd ?? ctx.user.spd) * 1.15);
      ctx.log('info', `⚡ 伴随着按键的残影，${ctx.user.name} 的运算速度（出手频率）永久提升了 15%！`);

      return true;
    },
  },

  v_rabbit_zero: {
    name: '物理『归零』', tag: SKILL_TAGS.SPECIAL, text: '🔘 {USER} 狠狠按下了计算器最上方的键：『归零！』',
    onExecute: (ctx) => {
      ctx.log('skill', `🧮 咔哒！计算器发出了震耳欲聋的审判之音："【归——零——】！！！"`);

      if (ctx.target.job === 'GOD_SLIME') {
        const actualDmg = ctx.applyDamage(ctx.user, 9999, 'skill', true);
        ctx.log('win', `⚡ 【弑神反噬】警告！！${ctx.user.name} 试图篡改神明【${ctx.target.name}】的数据！\n神明的绝对威压免疫了归零，降下神罚之雷，造成了 ${actualDmg} 点真实伤害！`);
        if (ctx.user.currentHp <= 0) {
          ctx.user.isDeadAnnounced = true;
          ctx.log('death', `💀 【天谴】${ctx.user.name} 遭到反噬，被劈得灰飞烟灭！`);
        }
        return true;
      }

      if ((ctx.target.status ?? []).some((s) => s.type.startsWith('STYLE_')) && ctx.target.baseStatsForStyle) {
        Object.assign(ctx.target, ctx.target.baseStatsForStyle);
        delete ctx.target.baseStatsForStyle;
      }
      const preservedDebuffs = new Set([
        'STUN', 'FREEZE', 'CONFUSED', 'CHARMED', 'WATER_PRISON', 'WT_SUPPRESS', 'WT_AIRBORNE', 'WT_REPAIRING',
        'POISON', 'BURN', 'BLIND', 'SILENCE', 'NO_HEAL', 'VALO_FLASH', 'VALO_AIM_PUNCH', 'NEURAL_THEFT_DEBUFF',
        'ETHEREAL', 'ZEROED',
      ]);
      ctx.target.status = (ctx.target.status ?? []).filter((s) => preservedDebuffs.has(s.type));

      if (!(ctx.target.status ?? []).some((s) => s.type === 'ZEROED')) {
        ctx.target.baseStatsForZero = { atk: ctx.target.atk, def: ctx.target.def, res: ctx.target.res };
        ctx.target.atk = Math.floor(ctx.target.atk * 0.1);
        ctx.target.def = Math.floor(ctx.target.def * 0.1);
        ctx.target.res = Math.floor(ctx.target.res * 0.1);
        ctx.target.status.push({ type: 'ZEROED', duration: 3 });
      } else {
        const zeroStatus = (ctx.target.status ?? []).find((s) => s.type === 'ZEROED');
        if (zeroStatus) zeroStatus.duration = 3;
      }

      ctx.target.wasZeroed = true;
      ctx.user.spd = Math.floor(ctx.user.spd * 1.30);
      if (ctx.user.baseStatsForStyle) ctx.user.baseStatsForStyle.spd = Math.floor((ctx.user.baseStatsForStyle.spd ?? ctx.user.spd) * 1.30);

      ctx.log('skill', `🧮 【归零】降维打击！${ctx.target.name} 的所有正面状态被强行清空，攻击、防御、魔抗在接下来的回合内暴跌至 10%！\n✨ 同时 ${ctx.user.name} 吸收了算力，自身速度永久暴增 30%！`);

      return true;
    },
  },

  v_rabbit_style_switch: {
    name: '切换人设', tag: SKILL_TAGS.SPECIAL, text: '🎭 {USER} 决定换一个人设...',
    condition: () => false,
    onExecute: (ctx) => {
      const pool: StylePoolEntry[] = Data.TUJUANJUAN_STYLE_POOL ?? [];

      if ((ctx.user.status ?? []).some((s) => s.type === 'STYLE_EMPEROR')) {
        ctx.log('info', `👑 ${ctx.user.name} 已登基为王，不再需要切换人设！`);
        ctx.log('win', `⚡ 帝皇不可阻挡！${ctx.user.name} 立即发起了无情追击！`);
        const followUpSkills = ['v_rabbit_calc_rng', 'v_rabbit_calc_smash', 'v_rabbit_zero', 'v_rabbit_megaphone'];
        ctx.executeSkillAction(followUpSkills[Math.floor(Math.random() * followUpSkills.length)], ctx.user, ctx.target, ctx.triggerDepth + 1);
        return true;
      }

      if (!ctx.user.baseStatsForStyle) {
        ctx.user.baseStatsForStyle = { atk: ctx.user.atk, def: ctx.user.def, res: ctx.user.res, mag: ctx.user.mag, spd: ctx.user.spd, wis: ctx.user.wis, agl: ctx.user.agl };
      } else {
        Object.assign(ctx.user, ctx.user.baseStatsForStyle);
      }

      const isEmperor = Math.random() < 0.05;
      const normalPool = pool.filter((p) => p && p.status !== 'STYLE_EMPEROR');

      if (normalPool.length === 0) return true;

      const selectedStyle: StylePoolEntry | undefined = isEmperor
        ? pool.find((p) => p.status === 'STYLE_EMPEROR')
        : normalPool[Math.floor(Math.random() * normalPool.length)];

      ctx.user.status = (ctx.user.status ?? []).filter(
        (s) => !s.type.startsWith('STYLE_') && s.type !== 'CTR_CHARM' && s.type !== 'SPELL_BLOCK' && s.type !== 'RAGE',
      );

      if (selectedStyle) {
        ctx.user.status.push({ type: selectedStyle.status, duration: 999 });

        const effectDesc: string[] = [];

        if (selectedStyle.status === 'STYLE_FAMILY') {
          ctx.user.status.push({ type: 'SPELL_BLOCK', duration: 999 });
          effectDesc.push('免疫魔法控制(林肯)');
        }
        if (selectedStyle.status === 'STYLE_SEXY' || selectedStyle.status === 'STYLE_EMPEROR') {
          ctx.user.status.push({ type: 'CTR_CHARM', duration: 999 });
          effectDesc.push('受击概率魅惑敌人');
        }
        if (selectedStyle.status === 'STYLE_ANGRY') {
          ctx.user.status.push({ type: 'RAGE', duration: 999 });
          effectDesc.push('自带狂暴 & 半血斩杀');
        }

        if (selectedStyle.statBuff) {
          const buff = selectedStyle.statBuff;
          (Object.keys(buff) as StatKey[]).forEach((k) => {
            const val = buff[k];
            if (val !== undefined && ctx.user[k] !== undefined) {
              ctx.user[k] = Math.max(1, Math.floor(ctx.user[k] * val));
            }
          });
          if (buff.atk) effectDesc.push(`攻击力变为 ${buff.atk} 倍`);
          if (buff.spd) effectDesc.push(`速度变为 ${buff.spd} 倍`);
          if (buff.def) effectDesc.push(`防御变为 ${buff.def} 倍`);
          if (buff.mag) effectDesc.push(`魔力变为 ${buff.mag} 倍`);
        }

        const descStr = effectDesc.length > 0 ? ` 【人设特性生效：${effectDesc.join(' | ')}】` : '';
        ctx.log('buff', selectedStyle.text.replace(/{USER}/g, ctx.user.name) + descStr);
      }

      ctx.log('win', `⚡ 【光速切片】换装完毕的 ${ctx.user.name} 并没有浪费回合，立刻无缝衔接了下一次攻击！`);
      const followUpSkills = ['v_rabbit_calc_rng', 'v_rabbit_calc_smash', 'v_rabbit_zero', 'v_rabbit_megaphone'];
      ctx.executeSkillAction(followUpSkills[Math.floor(Math.random() * followUpSkills.length)], ctx.user, ctx.target, ctx.triggerDepth + 1);
      return true;
    },
  },

  v_rabbit_calc_smash: {
    name: '计算器暴击', tag: SKILL_TAGS.PHYS, mult: 3.0,
    text: '💥 {USER} 抡起巨大的发声计算器，狠狠地拍在了 {TARGET} 脸上！造成了 {VAL} 点骨折伤害！',
    alwaysCrit: true,
    afterExecute: (ctx) => {
      const realtimeHpPct = ctx.target.currentHp / ctx.target.maxHp;
      if (
        (ctx.user.status ?? []).some((s) => ['STYLE_ANGRY', 'STYLE_EMPEROR'].includes(s.type)) &&
        ctx.target.currentHp > 0 &&
        realtimeHpPct < 0.5 &&
        !ctx.target.transformed
      ) {
        ctx.target.currentHp = 0;
        if (!ctx.target.isDeadAnnounced) {
          ctx.target.isDeadAnnounced = true;
          ctx.user.stats.kills += 1;
          ctx.log('death', `☠️ 【斩杀处决】处于暴躁女人的极怒状态，${ctx.user.name} 用计算器将残血的 ${ctx.target.name} 直接砸成了肉泥！`);
        }
      }
    },
  },

  v_rabbit_undo: {
    name: '等等按错了！', tag: SKILL_TAGS.HEAL, text: '⏪ "等一下，刚才那个不算！重来！" {USER} 狂按计算器上的【CE（清除）】键...',
    onExecute: (ctx) => {
      ctx.log('skill', `🧮 滴滴滴！屏幕上的【114514】被清空！计算器播报："【CE——】清除完毕！"`);

      const allies = (ctx.fighters ?? []).filter(
        (f) => !f.isDead && ctx.getTeamId(f) === ctx.getTeamId(ctx.user) && !(f.status ?? []).some((s) => s.type === 'SYNERGY_SLACKING'),
      );
      const healAmt = Math.floor(ctx.user.mag * 2.0);
      allies.forEach((a) => {
        a.status = (a.status ?? []).filter((s) => {
          if (s.type === 'ZEROED' && a.baseStatsForZero) {
            a.atk = a.baseStatsForZero.atk;
            a.def = a.baseStatsForZero.def;
            a.res = a.baseStatsForZero.res;
            a.wasZeroed = false;
            delete a.baseStatsForZero;
          }
          return !['STUN', 'FREEZE', 'BURN', 'POISON', 'BLIND', 'SILENCE', 'CONFUSED', 'CHARMED', 'VALO_FLASH', 'VALO_AIM_PUNCH', 'NEURAL_THEFT_DEBUFF', 'ZEROED'].includes(s.type);
        });
        if (!(a.status ?? []).some((s) => s.type === 'NO_HEAL')) a.currentHp = Math.min(a.maxHp, a.currentHp + healAmt);
      });
      ctx.log('heal', `✨ 【CE清除】战局强行回溯！${ctx.user.name} 驱散了我方全员的负面异常状态，并恢复了大量生命（各 ${healAmt} 点）！`);

      ctx.log('win', `⏪ 时间轴回拨！${ctx.user.name} 白嫖了一个行动回合，立即再次出手！`);
      ctx.executeSkillAction('v_rabbit_calc_rng', ctx.user, ctx.target, ctx.triggerDepth + 1);
      return true;
    },
  },

  v_rabbit_megaphone: {
    name: '扩音处刑', tag: SKILL_TAGS.MAG, ignoreDef: true, text: '🔊 {USER} 掏出大喇叭对准计算器收音孔...',
    onExecute: (ctx) => {
      const enemies = ctx.currentTargets ?? [];
      const dmg = Math.floor(ctx.user.mag * 2.5);
      ctx.log('skill', `🔊 【扩音处刑】大喇叭里传出放大了十倍的魔音："【6666...归零！】" 极其刺耳的电子魔音对全场敌人造成真实魔法伤害并强制眩晕！`);
      enemies.forEach((e) => {
        const actualDmg = ctx.applyDamage(e, dmg, 'skill', true);
        ctx.log('info', `🔊 刺耳魔音贯耳！${e.name} 承受了 ${actualDmg} 点真实精神伤害并被眩晕！`);
        if (!(e.status ?? []).some((s) => ['BKB', 'STYLE_FOOL', 'STYLE_EMPEROR'].includes(s.type))) {
          e.status = e.status ?? [];
          e.status.push({ type: 'STUN', duration: 1 });
        }
        if (e.currentHp <= 0 && !e.isDeadAnnounced && !e.isDead) {
          ctx.log('death', `💀 【击杀】${e.name} 被魔音贯耳，大脑宕机而亡！`);
          e.isDeadAnnounced = true;
          ctx.user.stats.kills += 1;
        }
      });

      return true;
    },
  },

  // ── 战雷军迷 skills ─────────────────────────────────────────────────────
  wt_attack_d_point: {
    name: '快捷语音', tag: SKILL_TAGS.BUFF,
    text: '📻 {USER} 疯狂按T-3-4发送无线电："【保卫D点！】【攻击D点！】"\n毫无意义的指令让 {TARGET} 陷入了深深的【混乱】，但队友却莫名感到振奋（全队攻击力上升）！',
    onExecute: (ctx) => {
      ctx.target.status.push({ type: 'CONFUSED', duration: 2 });
      const allies = (ctx.fighters ?? []).filter((f) => !f.isDead && ctx.getTeamId(f) === ctx.getTeamId(ctx.user));
      allies.forEach((a) => { a.atk = Math.floor(a.atk * 1.3); });
      return false;
    },
  },
  wt_repair: {
    name: '长按F修车', tag: SKILL_TAGS.HEAL, condition: (u) => u.hpPct < 0.6,
    text: '🔧 {USER} 载具受损！黑炮管了！"长按F进行战地抢修（50秒）"\n{USER} 原地瘫痪（眩晕），但装甲逐渐恢复，回复了海量生命值！',
    onExecute: (ctx) => {
      ctx.user.status.push({ type: 'STUN', duration: 2 });
      ctx.user.currentHp = Math.min(ctx.user.maxHp, ctx.user.currentHp + Math.floor(ctx.user.maxHp * 0.4));
      ctx.log('heal', `🔧 【战地抢修】履带接上了！炮闩修好了！${ctx.user.name} 恢复了 40% 的生命值！`);
      return true;
    },
  },
  wt_repair_premium: {
    name: '王牌乘员抢修', tag: SKILL_TAGS.HEAL, condition: (u) => u.hpPct < 0.6,
    text: '🔧 {USER} 载具受损！但【王牌乘员组】迅速介入！"履带断了？几秒钟的事！"\n{USER} 瞬间完成抢修，清除了所有负面状态，并恢复了巨量生命值！',
    onExecute: (ctx) => {
      ctx.user.currentHp = Math.min(ctx.user.maxHp, ctx.user.currentHp + Math.floor(ctx.user.maxHp * 0.6));
      ctx.user.status = ctx.user.status.filter(
        (s) => !['STUN', 'FREEZE', 'BURN', 'POISON', 'BLIND', 'SILENCE', 'CONFUSED', 'CHARMED', 'WT_SUPPRESS', 'WT_AIRBORNE', 'WT_REPAIRING'].includes(s.type),
      );
      ctx.log('heal', `🔧 【王牌乘员】顶级金币车待遇！炮闩履带瞬间复原！${ctx.user.name} 恢复了 60% 的生命值并解除了异常状态！`);
      return true;
    },
  },
  wt_apfsds: {
    name: '脱壳穿甲弹', tag: SKILL_TAGS.PHYS, mult: 1.5, ignoreDef: true,
    text: '🎯 {USER} 测距完毕，装填钢针(APFSDS)！\n"出膛！" 一发尾翼稳定脱壳穿甲弹贯穿了 {TARGET}，造成 {VAL} 真实伤害！',
    onExecute: (ctx) => {
      if (Math.random() < 0.05) {
        ctx.log('info', `👻 【安东星魔法】服务器丢包了！${ctx.user.name} 的钢针变成了【幽灵炮弹】，直接穿模透过了 ${ctx.target.name} 的身体！伤害为 0！(血压飙升)`);
        ctx.user.status.push({ type: 'RAGE', duration: 2 });
        return true;
      }
      return false;
    },
  },
  wt_magic_ricochet: {
    name: '魔法跳弹', tag: SKILL_TAGS.BUFF, status: 'INVUL',
    text: '🛡️ {USER} 摆出了刁钻的倾斜装甲角度，大喊："BVVD保佑！"\n触发战雷经典【魔法跳弹】，浑身散发斯大林合金的光辉，免疫接下来的所有伤害！',
  },
  wt_magic_ricochet_premium: {
    name: '顶级魔法跳弹', tag: SKILL_TAGS.BUFF, status: 'INVUL', cleanStatus: true,
    text: '🛡️ {USER} 摆出了无懈可击的完美倾斜角度，复合装甲闪耀着魔法的光辉！\n大喊："BVVD保佑！" 触发【顶级魔法跳弹】，清除了自身负面状态，并绝对免疫接下来的所有伤害！',
  },
  wt_laser_rangefinder: {
    name: '激光测距仪', tag: SKILL_TAGS.BUFF, status: 'AIM', statBuff: { atk: 1.5 },
    text: '🔭 {USER} 开启热成像与激光测距仪，锁定目标！\n接下来的攻击必定暴击、无法闪避，且攻击力大幅上升！',
  },
  wt_bmpt_suppress: {
    name: 'BMPT死亡收割机', tag: SKILL_TAGS.PHYS, mult: 0.6, hits: 5, status: 'WT_SUPPRESS',
    text: '🚜 {USER} 召唤巨大 BMPT 终结者！双联装30毫米机炮狂啸！\n"哒哒哒哒哒！" 对 {TARGET} 倾泻 5 段火力（共 {VAL} 伤害）并形成绝对【火力压制】！',
    onExecute: (ctx) => {
      ctx.target.agl = 0;
      return false;
    },
  },
  wt_t58_knockup: {
    name: 'T-58 碎甲轰击', tag: SKILL_TAGS.PHYS, mult: 4.5, ignoreDef: true, status: 'WT_AIRBORNE',
    text: '💥 {USER} 召唤 T-58 重型坦克！155毫米线膛炮锁定！\n"一发入魂！" 粗壮的钢针瞬间粉碎了 {TARGET} 的装甲，造成 {VAL} 真实伤害并将其当场【击飞】！',
    afterExecute: (ctx) => {
      if (ctx.target.currentHp > 0 && ctx.target.hpPct < 0.35 && !ctx.target.transformed) {
        ctx.target.currentHp = 0;
        if (!ctx.target.isDeadAnnounced) {
          ctx.target.isDeadAnnounced = true;
          ctx.user.stats.kills += 1;
          ctx.log('death', `☠️ 【弹药架殉爆】轰！！！T-58 的动能直接引爆了 ${ctx.target.name} 的弹药架！炮塔被炸飞了十几米高！完成极硬核斩杀！`);
        }
      }
    },
  },
  wt_su30_cas: {
    name: '苏-30SM2 狂暴轰入', tag: SKILL_TAGS.PHYS, ignoreDef: true,
    text: '✈️ 【CAS 请求确认】{USER} 呼叫空中支援！一架 苏-30SM2 呼啸而过...\n"全体目光向我看齐！狂暴轰入！！！"',
    onExecute: (ctx) => {
      const enemies = (ctx.currentTargets ?? []).sort(() => 0.5 - Math.random()).slice(0, 6);
      if (enemies.length === 0) return true;

      ctx.log('skill', `✈️ 【苏-30SM2 洗地】${ctx.user.name} 呼叫的战机投下满载的航弹！整个战场化为火海！`);
      const baseDmg = Math.floor(ctx.user.atk * 3.5);

      enemies.forEach((e) => {
        const actualDmg = ctx.applyDamage(e, baseDmg, 'skill', true);
        ctx.log('crit', `💥 轰炸波及！${e.name} 承受了 ${actualDmg} 点真实伤害并被【击飞】！`);

        if (!e.status.some((s) => s.type === 'BKB' || s.type === 'INVUL')) {
          e.status.push({ type: 'WT_AIRBORNE', duration: 2 });
        }

        // Bug 4 fix: set isDeadAnnounced immediately to prevent double death log
        if (e.currentHp > 0 && e.hpPct < 0.3) {
          e.currentHp = 0;
          if (!e.isDeadAnnounced && !e.isDead) {
            e.isDeadAnnounced = true;
            ctx.user.stats.kills += 1;
            ctx.log('death', `☠️ 【弹药架殉爆】${e.name} 在轰炸中不幸弹药库殉爆，瞬间气化！`);
          }
        }

        if (e.currentHp <= 0 && !e.isDeadAnnounced && !e.isDead) {
          ctx.log('death', `💀 【CAS击杀】${e.name} 被苏-30SM2的航弹炸回了机库！`);
          e.isDeadAnnounced = true;
          ctx.user.stats.kills += 1;
        }
      });
      return true;
    },
  },

  // ── Basic / common skills ────────────────────────────────────────────────
  hero_slash:   { name: '勇者之剑',   tag: SKILL_TAGS.PHYS,  rate: 0.3,  mult: 2.0, text: '🗡️ {USER} 挥舞发光的勇者之剑，劈砍 {TARGET}，造成 {VAL} 伤害！' },
  hero_guard:   { name: '勇者护盾',   tag: SKILL_TAGS.BUFF,  rate: 0.15, status: 'COUNTER', text: '🛡️ {USER} 举起勇者之盾，进入反击姿态！' },
  serious_punch:{ name: '认真一拳',   tag: SKILL_TAGS.PHYS,  rate: 0.5,  mult: 5.0, ignoreDef: true, text: '👊 {USER} 眼神变得犀利... 认真一拳！瞬间粉碎了 {TARGET}，造成 {VAL} 真实伤害！' },
  aim_shot:     { name: '瞄准射击',   tag: SKILL_TAGS.PHYS,  rate: 0.3,  mult: 1.8, text: '🏹 {USER} 屏息凝神，一箭精准射中 {TARGET}，造成 {VAL} 伤害。' },
  multi_shot:   { name: '多重射击',   tag: SKILL_TAGS.PHYS,  rate: 0.2,  mult: 0.8, hits: 3, text: '🏹 {USER} 瞬间射出三支箭矢！对 {TARGET} 造成 {VAL} 伤害。' },
  holy_shield:  { name: '神圣护盾',   tag: SKILL_TAGS.BUFF,  rate: 0.15, status: 'INVUL', text: '🛡️ {USER} 施放神之力量，获得无敌护盾！' },
  bash:         { name: '盾击',        tag: SKILL_TAGS.PHYS,  rate: 0.25, mult: 1.2, status: 'STUN', text: '🛡️ {USER} 举盾猛击，造成 {VAL} 伤害并眩晕了 {TARGET}！' },
  fireball:     { name: '火球术',      tag: SKILL_TAGS.MAG,   rate: 0.3,  mult: 1.5, status: 'BURN', text: '🔥 {USER} 搓出一发大火球，轰炸 {TARGET} 造成 {VAL} 魔法伤害！' },
  heal:         { name: '治疗术',      tag: SKILL_TAGS.HEAL,  rate: 0.35, mult: 1.5, condition: (u) => u.hpPct < 0.7, text: '✨ {USER} 沐浴圣光，恢复了 {VAL} 生命。' },
  smite:        { name: '圣光击',      tag: SKILL_TAGS.MAG,   rate: 0.25, mult: 1.4, text: '⚡ {USER} 圣光打击 {TARGET}，造成 {VAL} 魔法伤害。' },
  smoke_bomb:   { name: '烟雾弹',      tag: SKILL_TAGS.DEBUFF,rate: 0.2,  status: 'BLIND', text: '💨 {USER} 扔下烟雾弹，{TARGET} 丢失视野！' },
  meteor:       { name: '陨石术',      tag: SKILL_TAGS.MAG,   rate: 0.1,  mult: 3.0, status: 'STUN', text: '☄️ {USER} 召唤了巨大的陨石砸向 {TARGET}，造成 {VAL} 魔法伤害并眩晕！' },
  rage:         { name: '狂暴',        tag: SKILL_TAGS.BUFF,  rate: 0.1,  status: 'RAGE', text: '😡 {USER} 双眼通红，进入了狂暴状态！' },
};

// ---------------------------------------------------------------------------
// Global lifecycle interceptor — wraps every skill's onExecute with
// fighter-state bookkeeping (零归还 + 摸鱼伙伴 re-entry logic)
// ---------------------------------------------------------------------------
Object.values(SKILLS).forEach((skill) => {
  const origOnExecute = skill.onExecute;
  skill.onExecute = (ctx: SkillContext): boolean => {
    if (ctx.fighters) {
      // 1. Scan all fighters for expired ZEROED state
      ctx.fighters.forEach((f) => {
        if (f.wasZeroed && !(f.status ?? []).some((s) => s.type === 'ZEROED')) {
          if (f.baseStatsForZero) {
            f.atk = f.baseStatsForZero.atk;
            f.def = f.baseStatsForZero.def;
            f.res = f.baseStatsForZero.res;
            delete f.baseStatsForZero;
          }
          f.wasZeroed = false;
          ctx.log('heal', `🔄 【算力恢复】降维打击的封锁时间结束，${f.name} 的各项底层属性已恢复正常！`);
        }
      });

      // 2. Scan for 摸鱼伙伴 synergy re-entry
      const activeFighters = ctx.fighters.filter((f) => !f.isDead && !(f.status ?? []).some((s) => s.type === 'SYNERGY_SLACKING'));
      const activeTeams = new Set(activeFighters.map((f) => ctx.getTeamId(f))).size;

      const currentlySlacking = ctx.fighters.filter(
        (f) => !f.isDead && f.wasSynergySlacking && (f.status ?? []).some((s) => s.type === 'SYNERGY_SLACKING'),
      );
      const naturallyFinished = ctx.fighters.filter(
        (f) => !f.isDead && f.wasSynergySlacking && !(f.status ?? []).some((s) => s.type === 'SYNERGY_SLACKING'),
      );

      if (currentlySlacking.length > 0 && (activeTeams <= 1 || activeFighters.length <= 1)) {
        ctx.log('win', `🚨 【突发状况】打工的队友快死光了！（场外判定：仅存 ${activeTeams} 支队伍/阵营）`);
        currentlySlacking.forEach((p) => {
          p.status = (p.status ?? []).filter((s) => !['SYNERGY_SLACKING', 'INVUL', 'STUN', 'BKB', 'SPELL_BLOCK'].includes(s.type));
          p.currentHp = p.maxHp;
          p.wasSynergySlacking = false;
          ctx.log('heal', `🏃‍♀️ 惊呼"完了！要被发现我们在摸鱼了！" ${p.name} 赶紧扔掉手里的奶茶，满血跑回战场假装还在战斗！`);
        });
        naturallyFinished.forEach((p) => { p.wasSynergySlacking = false; });
      } else if (naturallyFinished.length > 0) {
        naturallyFinished.forEach((f) => {
          f.wasSynergySlacking = false;
          f.currentHp = f.maxHp;
          f.status = (f.status ?? []).filter((s) => !['INVUL', 'STUN', 'BKB', 'SPELL_BLOCK'].includes(s.type));
          ctx.log('heal', `⛺ 摸鱼时间结束！${f.name} 悠闲地散步回到了战场，并且状态绝佳（恢复满血）！`);
        });
        currentlySlacking.forEach((f) => {
          f.wasSynergySlacking = false;
          f.currentHp = f.maxHp;
          f.status = (f.status ?? []).filter((s) => !['SYNERGY_SLACKING', 'INVUL', 'STUN', 'BKB', 'SPELL_BLOCK'].includes(s.type));
          ctx.log('heal', `⛺ 看到搭子回去打工了，${f.name} 也赶紧喝完最后一口奶茶，跟着溜回了战场！`);
        });
      }
    }

    if (origOnExecute) {
      return origOnExecute(ctx);
    }
    return false;
  };
});

export const namerenaSkills = SKILLS;
