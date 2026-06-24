import { healFighter } from './combatState';
import {
  COMMON_NEGATIVE_STATUS_TYPES,
  REVIVE_CLEAN_STATUS_TYPES,
} from './statusRules';
import type {
  BattleEngineData,
  Fighter,
  GachaEntry,
  SkillContext,
} from './types';

export const GACHA_LUCK_MAX = 5;
export const GACHA_SUMMON_LIFESTEAL_STATUS = 'GACHA_SUMMON_LIFESTEAL';
const GACHA_SUMMON_LIFESTEAL_PCT = 0.35;

type LogFn = (type: string, text: string) => void;

type LuckDrawRuntime = {
  fighters?: Fighter[];
  data: BattleEngineData;
  getTeamId?: (fighter: Fighter) => string;
  isActiveCombatant?: (fighter: Fighter) => boolean;
  log: LogFn;
};

type SummonLifestealRuntime = {
  fighters: Fighter[];
  isActiveCombatant: (fighter: Fighter) => boolean;
  log: LogFn;
};

function refreshStatus(fighter: Fighter, type: string, duration: number): void {
  const existing = fighter.status.find((status) => status.type === type);
  if (existing) {
    existing.duration = Math.max(existing.duration, duration);
  } else {
    fighter.status.push({ type, duration });
  }
}

function activeFighters(runtime: LuckDrawRuntime): Fighter[] {
  return (runtime.fighters ?? []).filter((fighter) =>
    runtime.isActiveCombatant ? runtime.isActiveCombatant(fighter) : !fighter.isDead && !fighter.isDeadAnnounced && fighter.currentHp > 0,
  );
}

function activeEnemies(runtime: LuckDrawRuntime, user: Fighter): Fighter[] {
  const userTeamId = runtime.getTeamId?.(user) ?? user.teamId ?? user.id;
  return activeFighters(runtime).filter((fighter) =>
    fighter.id !== user.id &&
    (runtime.getTeamId?.(fighter) ?? fighter.teamId ?? fighter.id) !== userTeamId,
  );
}

function activeFriendlySummons(runtime: LuckDrawRuntime, user: Fighter): Fighter[] {
  const userTeamId = runtime.getTeamId?.(user) ?? user.teamId ?? user.id;
  return activeFighters(runtime).filter((fighter) =>
    fighter.isSummon &&
    fighter.summonerId === user.id &&
    (runtime.getTeamId?.(fighter) ?? fighter.teamId ?? fighter.id) === userTeamId,
  );
}

function canPayTributes(entry: GachaEntry, summonCount: number): boolean {
  return (entry.tributes ?? 0) <= summonCount;
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function getPityPower(user: Fighter, fallback: number): number {
  const power = Math.max(1, user.gachaPityPower ?? fallback);
  delete user.gachaPityPower;
  return power;
}

function restoreZeroedStats(user: Fighter): void {
  if (!user.baseStatsForZero) return;
  user.atk = user.baseStatsForZero.atk;
  user.def = user.baseStatsForZero.def;
  user.res = user.baseStatsForZero.res;
  delete user.baseStatsForZero;
  user.wasZeroed = false;
}

function cleanseLuckEmperor(user: Fighter): void {
  restoreZeroedStats(user);
  const cleanTypes = new Set([
    ...COMMON_NEGATIVE_STATUS_TYPES,
    ...REVIVE_CLEAN_STATUS_TYPES,
    'WATER_PRISON',
    'WT_SUPPRESS',
    'WT_AIRBORNE',
    'WT_REPAIRING',
    'NO_HEAL',
    'WEAK',
    'ZEROED',
  ]);
  user.status = user.status.filter((status) => !cleanTypes.has(status.type));
}

export function isLuckEmperor(fighter: Fighter): boolean {
  return !!fighter.isGacha && !!fighter.transformed && fighter.jobData?.name === '欧皇';
}

export function grantGachaLuck(
  fighter: Fighter,
  amount: number,
  log: LogFn,
  reason: string,
): number {
  if (!isLuckEmperor(fighter) || amount <= 0) return 0;

  const before = Math.max(0, fighter.gachaLuck ?? 0);
  const after = Math.min(GACHA_LUCK_MAX, before + amount);
  fighter.gachaLuck = after;
  const gained = after - before;
  if (gained <= 0) return 0;

  const hint = after >= GACHA_LUCK_MAX
    ? '大保底已就绪'
    : after >= 3
      ? '下一次命运抽卡会强化'
      : `当前欧气 ${after}/${GACHA_LUCK_MAX}`;
  log('buff', `🍀 ${fighter.name} 因${reason}积攒欧气 +${gained}！（${hint}）`);
  return gained;
}

export function consumeGachaLuck(fighter: Fighter, amount: number): number {
  const current = Math.max(0, fighter.gachaLuck ?? 0);
  const spent = Math.min(current, amount);
  fighter.gachaLuck = Math.max(0, current - spent);
  return spent;
}

export function activateGachaSummonLifesteal(
  user: Fighter,
  log: LogFn,
  turns = 4,
): void {
  if (!isLuckEmperor(user)) return;
  user.gachaSummonLifestealPct = GACHA_SUMMON_LIFESTEAL_PCT;
  refreshStatus(user, GACHA_SUMMON_LIFESTEAL_STATUS, turns);
  log('buff', `🧛 ${user.name} 抽到吸血牌！接下来 ${turns} 回合内，召唤物造成伤害的 ${Math.floor(GACHA_SUMMON_LIFESTEAL_PCT * 100)}% 会转化为治疗灌回本体！`);
}

export function applyGachaSummonLifesteal(
  runtime: SummonLifestealRuntime,
  attacker: Fighter | undefined,
  healBase: number,
): void {
  if (!attacker?.isSummon || !attacker.summonerId || healBase <= 0) return;

  const summoner = runtime.fighters.find((fighter) =>
    fighter.id === attacker.summonerId &&
    isLuckEmperor(fighter) &&
    runtime.isActiveCombatant(fighter) &&
    fighter.status.some((status) => status.type === GACHA_SUMMON_LIFESTEAL_STATUS),
  );
  if (!summoner) return;

  if (summoner.status.some((status) => status.type === 'NO_HEAL')) {
    runtime.log('info', `🥀 ${summoner.name} 处于禁疗状态，吸血牌无法回收召唤物造成的伤害！`);
    return;
  }

  const healPct = summoner.gachaSummonLifestealPct ?? GACHA_SUMMON_LIFESTEAL_PCT;
  const healed = healFighter(summoner, Math.floor(healBase * healPct));
  if (healed > 0) {
    runtime.log('heal', `🧛 吸血牌回流！${attacker.name} 的伤害为 ${summoner.name} 恢复了 ${healed} 点生命！`);
  }
}

export function triggerGachaDeathSave(
  fighter: Fighter,
  log: LogFn,
  syncHpPct: (fighter: Fighter) => void,
): boolean {
  if (!isLuckEmperor(fighter) || fighter.hasUsedGachaDeathSave) return false;

  fighter.hasUsedGachaDeathSave = true;
  cleanseLuckEmperor(fighter);
  fighter.currentHp = Math.max(1, Math.floor(fighter.maxHp * 0.25));
  refreshStatus(fighter, 'SPELL_BLOCK', 3);
  refreshStatus(fighter, 'BKB', 2);
  refreshStatus(fighter, 'REGEN', 3);
  syncHpPct(fighter);
  log('buff', `👑 【欧皇护符】${fighter.name} 在致死瞬间强行改命，清除异常并锁住了 ${fighter.currentHp} 点生命！`);
  grantGachaLuck(fighter, 3, log, '死里逃生');
  return true;
}

export const GACHA_SMALL_PITY_CARD: GachaEntry = {
  text: '🍀 {USER} 小保底歪了但没完全歪，保底光芒护住了自己！',
  tag: 'buff',
  onExecute: (ctx: SkillContext) => {
    const power = getPityPower(ctx.user, 3);
    cleanseLuckEmperor(ctx.user);
    const healed = healFighter(ctx.user, Math.floor(ctx.user.maxHp * (0.22 + power * 0.03)));
    refreshStatus(ctx.user, 'SPELL_BLOCK', 2);
    refreshStatus(ctx.user, 'REGEN', 3);
    const healText = healed > 0 ? `恢复了 ${healed} 点生命` : '生命已满，治疗溢出';
    ctx.log('heal', `🍀 【小保底歪了但没完全歪】${ctx.user.name} 被保底光芒护住，${healText}，并获得法术抵挡与再生！`);
    return true;
  },
};

export const GACHA_CEILING_EXCHANGE_CARD: GachaEntry = {
  text: '💰 {USER} 发动「天井兑换」，把攒下来的欧气全部砸向 {TARGET}！',
  tag: 'special',
  onExecute: (ctx: SkillContext) => {
    const power = getPityPower(ctx.user, GACHA_LUCK_MAX);
    const dmg = Math.floor((ctx.user.atk + ctx.user.mag) * (2.6 + power * 0.35));
    const actualDmg = ctx.applyDamage(ctx.target, dmg, 'skill', true);
    if (actualDmg > 0) {
      ctx.log('crit', `💰 【天井兑换】${ctx.user.name} 用 ${power} 点欧气强行兑换胜利，对 ${ctx.target.name} 实际造成 ${actualDmg} 点真实伤害！`);
    } else {
      ctx.log('info', `💰 【天井兑换】${ctx.user.name} 砸出了 ${power} 点欧气，但 ${ctx.target.name} 没有承受实际伤害！`);
    }
    if (actualDmg > 0) {
      const healed = healFighter(ctx.user, Math.floor(actualDmg * 0.45));
      if (healed > 0) ctx.log('heal', `💰 天井返利！${ctx.user.name} 恢复了 ${healed} 点生命！`);
    }
    if (ctx.target.currentHp <= 0) {
      ctx.markDefeated(ctx.target, { message: `💀 【天井兑换】${ctx.target.name} 被 ${ctx.user.name} 的氪金改命砸穿了！`, killer: ctx.user });
    }
    return true;
  },
};

export const GACHA_TEN_PULL_GOLD_CARD: GachaEntry = {
  text: '🌈 {USER} 十连金光！满屏彩光砸向整个战场！',
  tag: 'special',
  onExecute: (ctx: SkillContext) => {
    const power = getPityPower(ctx.user, GACHA_LUCK_MAX);
    const myTeamId = ctx.getTeamId(ctx.user);
    const enemies = ctx.fighters.filter((fighter) =>
      fighter.id !== ctx.user.id &&
      !fighter.isDead &&
      !fighter.isDeadAnnounced &&
      fighter.currentHp > 0 &&
      ctx.getTeamId(fighter) !== myTeamId &&
      !fighter.status.some((status) => status.type === 'SYNERGY_SLACKING'),
    );
    const baseDmg = Math.floor((ctx.user.mag * 2.2 + ctx.user.atk * 1.1) * (1 + power * 0.1));
    let totalDmg = 0;
    ctx.log('crit', `🌈 【十连金光】${ctx.user.name} 开出满屏彩光，对 ${enemies.length} 名敌人释放欧皇轰炸！`);
    enemies.forEach((enemy) => {
      const actualDmg = ctx.applyDamage(enemy, baseDmg, 'skill', true);
      totalDmg += actualDmg;
      if (actualDmg > 0) {
        ctx.log('skill', `🌈 金光命中 ${enemy.name}，实际造成 ${actualDmg} 点真实伤害！`);
      } else {
        ctx.log('info', `🌈 金光扫过 ${enemy.name}，但没有造成实际伤害！`);
      }
      if (enemy.currentHp <= 0) {
        ctx.markDefeated(enemy, { message: `💀 【十连金光】${enemy.name} 被 ${ctx.user.name} 的满屏金光砸没了！`, killer: ctx.user });
      }
    });
    if (totalDmg > 0) {
      const healed = healFighter(ctx.user, Math.floor(totalDmg * 0.25));
      if (healed > 0) ctx.log('heal', `🌈 金光回流！${ctx.user.name} 恢复了 ${healed} 点生命！`);
    }
    return true;
  },
};

export const GACHA_WHALE_REWRITE_CARD: GachaEntry = {
  text: '💳 {USER} 发动「氪金改命」，把这一回合从坏结局里买了回来！',
  tag: 'buff',
  onExecute: (ctx: SkillContext) => {
    const power = getPityPower(ctx.user, 3);
    cleanseLuckEmperor(ctx.user);
    const healed = healFighter(ctx.user, Math.floor(ctx.user.maxHp * (0.18 + power * 0.04)));
    refreshStatus(ctx.user, 'BKB', 1);
    refreshStatus(ctx.user, 'SPELL_BLOCK', 2);
    refreshStatus(ctx.user, 'REGEN', 3);
    const healText = healed > 0 ? `恢复 ${healed} 点生命` : '生命已满，治疗溢出';
    ctx.log('buff', `💳 【氪金改命】${ctx.user.name} 清除异常，${healText}，并获得短暂黑皇杖、法术抵挡与再生！`);
    grantGachaLuck(ctx.user, 1, ctx.log, '氪金改命余波');
    return true;
  },
};

export const GACHA_SUMMON_LIFESTEAL_CARD: GachaEntry = {
  text: '🧛 {USER} 抽到了吸血牌！召唤物的攻势开始回灌生命！',
  tag: 'buff',
  onExecute: (ctx: SkillContext) => {
    activateGachaSummonLifesteal(ctx.user, ctx.log, 4);
    grantGachaLuck(ctx.user, 1, ctx.log, '吸血牌余韵');
    return true;
  },
};

function chooseMajorPityEntry(runtime: LuckDrawRuntime, user: Fighter): GachaEntry {
  const summons = activeFriendlySummons(runtime, user);
  const enemies = activeEnemies(runtime, user);
  const hasSummonLifesteal = user.status.some((status) => status.type === GACHA_SUMMON_LIFESTEAL_STATUS);

  if (user.hpPct <= 0.38) return GACHA_WHALE_REWRITE_CARD;
  if (enemies.length >= 3) return GACHA_TEN_PULL_GOLD_CARD;
  if (summons.length > 0 && !hasSummonLifesteal) return GACHA_SUMMON_LIFESTEAL_CARD;
  return GACHA_CEILING_EXCHANGE_CARD;
}

function chooseEnhancedEntry(runtime: LuckDrawRuntime, user: Fighter, pool: GachaEntry[]): GachaEntry {
  const summons = activeFriendlySummons(runtime, user);
  const summonCount = summons.length;
  const usablePool = pool.filter((entry) => canPayTributes(entry, summonCount));
  const hasSummonLifesteal = user.status.some((status) => status.type === GACHA_SUMMON_LIFESTEAL_STATUS);

  if (user.hpPct <= 0.5) return GACHA_SMALL_PITY_CARD;
  if (summons.length > 0 && !hasSummonLifesteal) return GACHA_SUMMON_LIFESTEAL_CARD;

  const premium = usablePool.filter((entry) =>
    entry.tag === 'heal' ||
    (entry.lifesteal ?? 0) > 0 ||
    (entry.mult ?? 0) >= 5 ||
    entry.ignoreDef ||
    entry.status === 'STUN' ||
    entry.status === 'CHARMED' ||
    entry.triggerAgain,
  );
  return premium.length > 0 ? pickRandom(premium) : GACHA_CEILING_EXCHANGE_CARD;
}

function chooseSmartEntry(runtime: LuckDrawRuntime, user: Fighter, pool: GachaEntry[]): GachaEntry {
  const summons = activeFriendlySummons(runtime, user);
  const summonCount = summons.length;
  const enemies = activeEnemies(runtime, user);
  const usablePool = pool.filter((entry) => canPayTributes(entry, summonCount));
  const candidates = usablePool.length > 0 ? usablePool : pool;

  if (user.hpPct <= 0.45) {
    const defensive = candidates.filter((entry) =>
      entry.tag === 'heal' ||
      (entry.lifesteal ?? 0) >= 0.5 ||
      entry === GACHA_WHALE_REWRITE_CARD ||
      entry === GACHA_SMALL_PITY_CARD,
    );
    if (defensive.length > 0 && Math.random() < 0.65) return pickRandom(defensive);
  }

  if (enemies.length >= 3) {
    const crowdControl = candidates.filter((entry) =>
      entry === GACHA_TEN_PULL_GOLD_CARD ||
      entry.triggerAgain ||
      (entry.mult ?? 0) >= 5 ||
      entry.status === 'STUN' ||
      entry.status === 'CHARMED',
    );
    if (crowdControl.length > 0 && Math.random() < 0.55) return pickRandom(crowdControl);
  }

  if (summonCount >= 2) {
    const tributeCards = pool.filter((entry) => (entry.tributes ?? 0) > 0 && canPayTributes(entry, summonCount));
    if (tributeCards.length > 0 && Math.random() < 0.45) return pickRandom(tributeCards);
  }

  return pickRandom(candidates);
}

export function resolveLuckEmperorSsrDraw(
  runtime: LuckDrawRuntime,
  user: Fighter,
  pool: GachaEntry[],
): GachaEntry {
  const luck = Math.max(0, user.gachaLuck ?? 0);

  if (luck >= GACHA_LUCK_MAX) {
    const spent = consumeGachaLuck(user, GACHA_LUCK_MAX);
    user.gachaPityPower = Math.max(spent, GACHA_LUCK_MAX);
    runtime.log('buff', `👑 大保底启动！${user.name} 消耗 ${spent} 点欧气，强行把命运抽卡改写成翻盘牌！`);
    return chooseMajorPityEntry(runtime, user);
  }

  if (luck >= 3) {
    const spent = consumeGachaLuck(user, 3);
    user.gachaPityPower = Math.max(spent, 3);
    runtime.log('buff', `🍀 小保底启动！${user.name} 消耗 ${spent} 点欧气，让这次命运抽卡必定强化！`);
    return chooseEnhancedEntry(runtime, user, pool);
  }

  return chooseSmartEntry(runtime, user, pool);
}
