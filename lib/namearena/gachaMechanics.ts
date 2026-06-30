import { healFighter, isActiveCombatant } from './combatState';
import {
  COMMON_NEGATIVE_STATUS_TYPES,
  CONTROL_STATUS_TYPES,
  REVIVE_CLEAN_STATUS_TYPES,
  isStatusType,
} from './statusRules';
import type {
  BattleEngineData,
  DamageApplicationOptions,
  Fighter,
  GachaEntry,
  SkillContext,
} from './types';

export const GACHA_LUCK_MAX = 5;
export const GACHA_SUMMON_LIFESTEAL_STATUS = 'GACHA_SUMMON_LIFESTEAL';
export const GACHA_RA_PHOENIX_STATUS = 'RA_PHOENIX';
const GACHA_SUMMON_LIFESTEAL_PCT = 0.35;
export const EXODIA_PIECES = ['被封印者的右腕', '被封印者的左腕', '被封印者的右足', '被封印者的左足', '被封印者本体'] as const;
export const GACHA_ADVANCED_SUMMON_NAMES = ['青眼白龙', '翼神龙', '黑暗大法师', '青眼究极龙'] as const;
const EXODIA_NORMAL_PIECE_CHANCES = [0.055, 0.11, 0.21, 0.38, 0.62] as const;
const EXODIA_SMALL_PITY_PIECE_CHANCES = [0.09, 0.18, 0.36, 0.68, 1] as const;
const EXODIA_MAJOR_PITY_PIECE_CHANCES = [0, 0.16, 0.46, 0.86, 1] as const;

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

function getSummonBaseName(fighter: Fighter): string {
  return fighter.summonBaseName ?? fighter.name;
}

export function isAdvancedSummonName(name: string | undefined): boolean {
  return !!name && (GACHA_ADVANCED_SUMMON_NAMES as readonly string[]).includes(name);
}

function isOrdinaryFriendlySummon(runtime: LuckDrawRuntime, user: Fighter, fighter: Fighter): boolean {
  return !!fighter.isSummon &&
    fighter.summonerId === user.id &&
    !isAdvancedSummonName(getSummonBaseName(fighter)) &&
    activeFriendlySummons(runtime, user).some((summon) => summon.id === fighter.id);
}

function activeOrdinaryFriendlySummons(runtime: LuckDrawRuntime, user: Fighter): Fighter[] {
  return activeFriendlySummons(runtime, user).filter((fighter) => isOrdinaryFriendlySummon(runtime, user, fighter));
}

function activeTributableSummons(runtime: LuckDrawRuntime, user: Fighter, entry: GachaEntry): Fighter[] {
  return activeOrdinaryFriendlySummons(runtime, user).filter((fighter) => {
    const baseName = getSummonBaseName(fighter);
    return entry.summonName !== '青眼白龙' || baseName !== '翼神龙';
  });
}

function canPayTributes(runtime: LuckDrawRuntime, user: Fighter, entry: GachaEntry): boolean {
  if (entry.summonName === '青眼究极龙') return hasBlueEyesFusionMaterials(runtime, user);
  return (entry.tributes ?? 0) <= activeTributableSummons(runtime, user, entry).length;
}

function usableSummonEntries(runtime: LuckDrawRuntime, user: Fighter, pool: GachaEntry[]): GachaEntry[] {
  return pool.filter((entry) => entry.isSummon && canUseGachaEntry(runtime, user, entry));
}

function tributeSummonEntries(runtime: LuckDrawRuntime, user: Fighter, pool: GachaEntry[]): GachaEntry[] {
  return usableSummonEntries(runtime, user, pool).filter((entry) => (entry.tributes ?? 0) > 0);
}

function usableEntries(runtime: LuckDrawRuntime, user: Fighter, pool: GachaEntry[]): GachaEntry[] {
  return pool.filter((entry) => canUseGachaEntry(runtime, user, entry));
}

function supportEntries(runtime: LuckDrawRuntime, user: Fighter, pool: GachaEntry[]): GachaEntry[] {
  return usableEntries(runtime, user, pool).filter((entry) =>
    !!entry.requiresBlueEyesFusion ||
    !!entry.requiresFriendlySummon ||
    !!entry.requiresAnyFriendlySummon ||
    !!entry.requiresOrdinarySummon,
  );
}

function raSupportEntries(runtime: LuckDrawRuntime, user: Fighter, pool: GachaEntry[]): GachaEntry[] {
  if (!activeFriendlySummonByBaseName(runtime, user, '翼神龙')) return [];
  return usableEntries(runtime, user, pool).filter((entry) =>
    entry === GACHA_ANCIENT_CHANT_CARD ||
    entry === GACHA_BLAZE_CANNON_CARD ||
    entry === GACHA_RA_PHOENIX_CARD ||
    entry === GACHA_RA_TRIBUTE_ASCENSION_CARD,
  );
}

function activeFriendlySummonByBaseName(runtime: LuckDrawRuntime, user: Fighter, baseName: string): Fighter | undefined {
  return activeFriendlySummons(runtime, user).find((fighter) => getSummonBaseName(fighter) === baseName);
}

function hasBlueEyesFusionMaterials(runtime: LuckDrawRuntime, user: Fighter): boolean {
  return !!activeFriendlySummonByBaseName(runtime, user, '青眼白龙') &&
    activeOrdinaryFriendlySummons(runtime, user).length >= 2 &&
    !activeFriendlySummonByBaseName(runtime, user, '青眼究极龙');
}

function canUseGachaEntry(runtime: LuckDrawRuntime, user: Fighter, entry: GachaEntry): boolean {
  if (entry.requiresFriendlySummon && !activeFriendlySummonByBaseName(runtime, user, entry.requiresFriendlySummon)) return false;
  if (entry.requiresAnyFriendlySummon && activeFriendlySummons(runtime, user).length === 0) return false;
  if (entry.requiresOrdinarySummon && activeOrdinaryFriendlySummons(runtime, user).length === 0) return false;
  if (entry.requiresBlueEyesFusion && !hasBlueEyesFusionMaterials(runtime, user)) return false;
  if (entry.isSummon) {
    if ((entry.unique || isAdvancedSummonName(entry.summonName)) &&
      activeFriendlySummonByBaseName(runtime, user, entry.summonName ?? '')) return false;
    return canPayTributes(runtime, user, entry);
  }
  return true;
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
  if (before < GACHA_LUCK_MAX && after >= GACHA_LUCK_MAX) {
    fighter.gachaInstantActionQueued = true;
  }

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
  if (fighter.gachaLuck < GACHA_LUCK_MAX) {
    fighter.gachaInstantActionQueued = false;
  }
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
  } else {
    runtime.log('info', `🧛 吸血牌回流触发，但 ${summoner.name} 生命已满，治疗溢出！`);
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

function activeContextEnemies(ctx: SkillContext): Fighter[] {
  const myTeamId = ctx.getTeamId(ctx.user);
  return ctx.fighters.filter((fighter) =>
    fighter.id !== ctx.user.id &&
    !fighter.isDead &&
    !fighter.isDeadAnnounced &&
    fighter.currentHp > 0 &&
    ctx.getTeamId(fighter) !== myTeamId &&
    !fighter.status.some((status) => status.type === 'SYNERGY_SLACKING'),
  );
}

function activeContextFriendlySummons(ctx: SkillContext): Fighter[] {
  const myTeamId = ctx.getTeamId(ctx.user);
  return ctx.fighters.filter((fighter) =>
    fighter.isSummon &&
    fighter.summonerId === ctx.user.id &&
    !fighter.isDead &&
    !fighter.isDeadAnnounced &&
    fighter.currentHp > 0 &&
    ctx.getTeamId(fighter) === myTeamId,
  );
}

function activeContextOrdinarySummons(ctx: SkillContext): Fighter[] {
  return activeContextFriendlySummons(ctx).filter((fighter) => !isAdvancedSummonName(getSummonBaseName(fighter)));
}

function canSummonRespondToCommand(summon: Fighter): boolean {
  if (summon.status.some((status) => status.type === 'BKB' || status.type === 'STYLE_FOOL')) return true;
  return !summon.status.some((status) => isStatusType(status.type, CONTROL_STATUS_TYPES));
}

function responsiveContextFriendlySummons(ctx: SkillContext): Fighter[] {
  return activeContextFriendlySummons(ctx).filter((summon) => canSummonRespondToCommand(summon));
}

function responsiveContextOrdinarySummons(ctx: SkillContext): Fighter[] {
  return activeContextOrdinarySummons(ctx).filter((summon) => canSummonRespondToCommand(summon));
}

function contextFriendlySummonByBaseName(ctx: SkillContext, baseName: string): Fighter | undefined {
  return activeContextFriendlySummons(ctx).find((fighter) => getSummonBaseName(fighter) === baseName);
}

function canContextFuseBlueEyes(ctx: SkillContext): boolean {
  return !!contextFriendlySummonByBaseName(ctx, '青眼白龙') &&
    activeContextOrdinarySummons(ctx).length >= 2 &&
    !contextFriendlySummonByBaseName(ctx, '青眼究极龙');
}

function executeGachaSummonCard(ctx: SkillContext, entry: GachaEntry, name: string): void {
  ctx.executeSummonSkill({ name, tag: 'special', ...entry }, ctx.user, ctx.getTeamId(ctx.user));
}

function damageFromSummon(
  ctx: SkillContext,
  summon: Fighter,
  target: Fighter,
  amount: number,
  actionName: string,
  trueDamage = false,
  options: { deferOutcome?: boolean } = {},
): number {
  const damageOptions: DamageApplicationOptions = { actionName };
  const actualDmg = ctx.applyDamage(target, amount, 'skill', trueDamage, summon, damageOptions);
  if (damageOptions.redirectedByJoker) return 0;
  if (options.deferOutcome) return actualDmg;
  finalizeSummonDamage(ctx, summon, target, actionName);
  return actualDmg;
}

function finalizeSummonDamage(ctx: SkillContext, summon: Fighter, target: Fighter, actionName: string): void {
  ctx.flushDeferredDamageEvents?.();
  if (target.currentHp <= 0) {
    ctx.markDefeated(target, { message: `💀 【${actionName}】${target.name} 被 ${summon.name} 击败！`, killer: summon });
  }
}

function commandSummon(ctx: SkillContext, summon: Fighter, label: string): void {
  if (!canSummonRespondToCommand(summon)) {
    ctx.log('info', `🎴 【${label}】${ctx.user.name} 命令 ${summon.name} 行动，但 ${summon.name} 正被控制，无法响应召唤指令！`);
    return;
  }
  const enemies = activeContextEnemies(ctx);
  if (enemies.length === 0) {
    ctx.log('info', `🎴 【${label}】${ctx.user.name} 发出指令，但场上已经没有可攻击目标。`);
    return;
  }
  const target = enemies[Math.floor(Math.random() * enemies.length)];
  ctx.log('skill', `🎴 【${label}】${ctx.user.name} 命令 ${summon.name} 立刻压制 ${target.name}！`);
  ctx.executeSkillAction(null, summon, target, ctx.triggerDepth + 1);
}

function missingExodiaPieces(user: Fighter): string[] {
  const owned = new Set(user.exodiaPieces ?? []);
  return EXODIA_PIECES.filter((piece) => !owned.has(piece));
}

function exodiaProgress(user: Fighter): number {
  return Math.max(0, Math.min(EXODIA_PIECES.length - 1, user.exodiaPieces?.length ?? 0));
}

function shouldRevealExodiaPiece(user: Fighter, chances: readonly number[]): boolean {
  return Math.random() < (chances[exodiaProgress(user)] ?? 0);
}

function grantExodiaPiece(ctx: SkillContext): void {
  const missing = missingExodiaPieces(ctx.user);
  if (missing.length === 0) {
    ctx.log('info', `🧩 ${ctx.user.name} 已经集齐所有封印组件，卡组中的封印之力不再重复显现。`);
    return;
  }
  const piece = missing[Math.floor(Math.random() * missing.length)];
  ctx.user.exodiaPieces = [...(ctx.user.exodiaPieces ?? []), piece];
  const count = ctx.user.exodiaPieces.length;
  ctx.log('buff', `🧩 【封印组件】${ctx.user.name} 抽到了「${piece}」！（${count}/${EXODIA_PIECES.length}，不会重复）`);
  if (count >= EXODIA_PIECES.length) {
    ctx.log('crit', `🧙‍♂️ 五张封印组件集齐！${ctx.user.name} 宣告被封印者降临！`);
    ctx.executeSummonSkill({
      name: '黑暗大法师降临',
      tag: 'special',
      text: '🧙‍♂️ {USER} 集齐五张封印组件，召唤「黑暗大法师」加入战场！(唯一/不可祭品)',
      isSummon: true,
      summonName: '黑暗大法师',
      summonJob: 'EXODIA_INCARNATE',
      stats: { hp: 4000, atk: 250, def: 250, mag: 250, res: 250, spd: 250, agl: 250, wis: 250 },
      unique: true,
      advancedSummon: true,
    }, ctx.user, ctx.getTeamId(ctx.user));
  } else {
    grantGachaLuck(ctx.user, 1, ctx.log, '封印组件共鸣');
  }
}

export const GACHA_ORDINARY_SUMMON_CARDS: GachaEntry[] = [
  { text: "🛡️ {USER} 天动万象！召唤「钟离」！此世群魔诸神并起...！", isSummon: true, summonName: '钟离', summonJob: 'GENSHIN_ARCHON', stats: { hp: 2500, def: 150, atk: 30 } },
  { text: "🗡️ {USER} 试问，你是我的Master吗？召唤「Saber」！", isSummon: true, summonName: 'Saber', summonJob: 'FATE_SERVANT', stats: { hp: 1400, atk: 80, spd: 37 } },
  { text: "🤖 {USER} 机甲点燃大海！召唤「流萤 (SAM)」！焦土作战开始！", isSummon: true, summonName: '萨姆', summonJob: 'HSR_HUNTER', stats: { hp: 1500, atk: 85, spd: 45 } },
  { text: "🐉 {USER} 究极龙降临！召唤「巴哈姆特」！毁灭一切！", isSummon: true, summonName: '巴哈姆特', summonJob: 'LEGEND_DRAGON', stats: { hp: 1800, atk: 100, spd: 30 } },
  { text: "🦑 {USER} 撕裂万古！召唤「伊莫库」！奥札奇泰坦降临！", isSummon: true, summonName: '伊莫库', summonJob: 'ELDRAZI_TITAN', stats: { hp: 2000, atk: 75, mag: 75, spd: 25 } },
  { text: "🔥 {USER} 莱瓦汀！召唤「史尔特尔」！黄昏的尽头！", isSummon: true, summonName: '史尔特尔', summonJob: 'ARKNIGHTS_OP', stats: { hp: 800, atk: 125, spd: 32 } },
  { text: "🤖 {USER} 帮帮我，史瓦罗先生！召唤「克拉拉 & 史瓦罗」！", isSummon: true, summonName: '史瓦罗', summonJob: 'HSR_HUNTER', stats: { hp: 1800, atk: 60, def: 100 } },
];

export const GACHA_BLUE_EYES_CARD: GachaEntry = {
  text: "🐲 {USER} 献祭两只普通召唤物！「青眼白龙」降临！强韧！无敌！最强！",
  isSummon: true,
  summonName: '青眼白龙',
  summonJob: 'BLUE_EYES_WHITE_DRAGON',
  stats: { hp: 2800, atk: 180, def: 150, spd: 140, agl: 130, mag: 190, res: 150, wis: 160 },
  tributes: 2,
  advancedSummon: true,
};

export const GACHA_RA_CARD: GachaEntry = {
  text: "🔥 {USER} 献祭三只普通召唤物，咏唱古老咒文！太阳神「拉的翼神龙」降临！神之力开始沸腾！",
  isSummon: true,
  summonName: '翼神龙',
  summonJob: 'RA_WINGED_DRAGON',
  stats: { hp: 4500, atk: 280, def: 230, mag: 330, res: 240, spd: 165, agl: 135, wis: 230 },
  tributes: 3,
  advancedSummon: true,
};

export const GACHA_BLUE_EYES_ULTIMATE_CARD: GachaEntry = {
  text: "🧬 {USER} 发动「融合」！青眼白龙与两只普通召唤物化为三首究极之龙！",
  isSummon: true,
  summonName: '青眼究极龙',
  summonJob: 'BLUE_EYES_ULTIMATE_DRAGON',
  stats: { hp: 3600, atk: 260, def: 145, spd: 135, agl: 100, mag: 260, res: 145, wis: 150 },
  unique: true,
  advancedSummon: true,
  requiresBlueEyesFusion: true,
};

export const GACHA_EXODIA_PIECE_CARD: GachaEntry = {
  text: '🧩 {USER} 抽到了不会重复的封印组件，黑暗大法师的轮廓更近了一步！',
  tag: 'buff',
  onExecute: (ctx) => {
    grantExodiaPiece(ctx);
    return true;
  },
};

export const GACHA_SUMMON_COMMAND_CARD: GachaEntry = {
  text: '🎴 {USER} 抽到「召唤指令」，让场上的召唤物立刻行动！',
  tag: 'buff',
  requiresAnyFriendlySummon: true,
  onExecute: (ctx) => {
    const summons = responsiveContextFriendlySummons(ctx)
      .sort((a, b) => (b.atk + b.mag + b.spd) - (a.atk + a.mag + a.spd));
    const summon = summons[0];
    if (!summon) {
      ctx.log('info', `🎴 【召唤指令】${ctx.user.name} 发出指令，但己方召唤物都被控制，没人能响应！`);
      return true;
    }
    commandSummon(ctx, summon, '召唤指令');
    return true;
  },
};

export const GACHA_ALL_OUT_ATTACK_CARD: GachaEntry = {
  text: '⚔️ {USER} 抽到「全军进击」，普通召唤物一齐压上！',
  tag: 'special',
  requiresOrdinarySummon: true,
  onExecute: (ctx) => {
    const enemies = activeContextEnemies(ctx);
    if (enemies.length === 0) return true;
    const summons = responsiveContextOrdinarySummons(ctx);
    if (summons.length === 0) {
      ctx.log('info', `⚔️ 【全军进击】${ctx.user.name} 试图发起协同攻击，但普通召唤物都被控制，无法压上！`);
      return true;
    }
    ctx.log('skill', `⚔️ 【全军进击】${ctx.user.name} 命令 ${summons.length} 只普通召唤物发动协同攻击！`);
    for (const summon of summons) {
      if (!isActiveCombatant(ctx.user) || !isActiveCombatant(summon)) continue;
      const activeTargets = enemies.filter((enemy) => isActiveCombatant(enemy));
      const target = activeTargets[Math.floor(Math.random() * activeTargets.length)];
      if (!target) continue;
      const dmg = Math.max(1, Math.floor((summon.atk + summon.mag) * 1.05));
      const damageOptions: DamageApplicationOptions = { actionName: '全军进击' };
      const actualDmg = ctx.applyDamage(target, dmg, 'skill', false, summon, damageOptions);
      if (damageOptions.redirectedByJoker) {
        ctx.log('info', `⚔️ ${summon.name} 的进击被 ${target.name} 用随机恶作剧转移，原目标没有受伤；转移伤害已单独结算！`);
        continue;
      }
      ctx.log(actualDmg > 0 ? 'skill' : 'info', actualDmg > 0
        ? `⚔️ ${summon.name} 响应进击，命中 ${target.name}，实际造成 ${actualDmg} 点伤害！`
        : `⚔️ ${summon.name} 的进击被 ${target.name} 化解，没有造成实际伤害！`);
      ctx.flushDeferredDamageEvents?.();
      if (target.currentHp <= 0) {
        ctx.markDefeated(target, { message: `💀 【全军进击】${target.name} 被 ${summon.name} 击败！`, killer: summon });
      }
    }
    return true;
  },
};

export const GACHA_TRIBUTE_PREP_CARD: GachaEntry = {
  text: '🕯️ {USER} 抽到「献祭准备」，普通召唤物被仪式光芒保护！',
  tag: 'buff',
  requiresOrdinarySummon: true,
  onExecute: (ctx) => {
    const summons = activeContextOrdinarySummons(ctx);
    for (const summon of summons) {
      refreshStatus(summon, 'SPELL_BLOCK', 2);
      refreshStatus(summon, 'REGEN', 2);
    }
    ctx.log('buff', `🕯️ 【献祭准备】${ctx.user.name} 为 ${summons.length} 只普通召唤物套上仪式护盾，并积攒欧气！`);
    grantGachaLuck(ctx.user, 1, ctx.log, '献祭准备');
    return true;
  },
};

export const GACHA_SUMMON_RECYCLE_CARD: GachaEntry = {
  text: '♻️ {USER} 抽到「召唤物回收」，将残血普通召唤物化作资源！',
  tag: 'buff',
  requiresOrdinarySummon: true,
  onExecute: (ctx) => {
    const victim = activeContextOrdinarySummons(ctx).sort((a, b) => a.hpPct - b.hpPct)[0];
    if (!victim) return false;
    ctx.markDefeated(victim, { message: `💀 【召唤物回收】${victim.name} 被 ${ctx.user.name} 回收为卡组资源！`, awardKill: false });
    victim.isDead = true;
    const healed = healFighter(ctx.user, Math.floor(ctx.user.maxHp * 0.18));
    ctx.log('heal', `♻️ 【召唤物回收】${ctx.user.name} 回收 ${victim.name}，恢复 ${healed} 点生命并获得 2 点欧气！`);
    grantGachaLuck(ctx.user, 2, ctx.log, '召唤物回收');
    return true;
  },
};

export const GACHA_MONSTER_REBORN_CARD: GachaEntry = {
  text: '⚗️ {USER} 发动「死者苏生」，从墓地拉回一只普通召唤物！',
  tag: 'buff',
  onExecute: (ctx) => {
    const myTeamId = ctx.getTeamId(ctx.user);
    const target = ctx.fighters.find((fighter) =>
      fighter.isSummon &&
      fighter.summonerId === ctx.user.id &&
      ctx.getTeamId(fighter) === myTeamId &&
      !isAdvancedSummonName(getSummonBaseName(fighter)) &&
      (fighter.isDead || fighter.isDeadAnnounced || fighter.currentHp <= 0),
    );
    if (!target) {
      const card = GACHA_ORDINARY_SUMMON_CARDS[Math.floor(Math.random() * GACHA_ORDINARY_SUMMON_CARDS.length)];
      if (card) executeGachaSummonCard(ctx, card, '死者苏生代偿召唤');
      return true;
    }
    target.isDead = false;
    target.isDeadAnnounced = false;
    target.defeatHooksResolved = false;
    target.status = [];
    target.currentHp = Math.max(1, Math.floor(target.maxHp * 0.55));
    target.hpPct = target.currentHp / target.maxHp;
    ctx.log('heal', `⚗️ 【死者苏生】${ctx.user.name} 将 ${target.name} 从墓地拉回战场，恢复到 ${target.currentHp} 点生命！`);
    return true;
  },
};

export const GACHA_ASH_BLOSSOM_CARD: GachaEntry = {
  text: '🌸 {USER} 抽到「灰流丽」，打断敌方关键行动！',
  tag: 'debuff',
  onExecute: (ctx) => {
    if (ctx.target.status.some((status) => status.type === 'BKB')) {
      ctx.log('info', `🌸 【灰流丽】试图打断 ${ctx.target.name}，但对方处于 BKB 状态！`);
      return true;
    }
    ctx.target.status.push({ type: 'STUN', duration: 2 });
    ctx.log('skill', `🌸 【灰流丽】${ctx.user.name} 无效了 ${ctx.target.name} 的下一次关键行动，使其眩晕！`);
    return true;
  },
};

export const GACHA_MIRROR_FORCE_CARD: GachaEntry = {
  text: '🛡️ {USER} 覆盖「圣防护罩·镜之力」，召唤阵进入反击防线！',
  tag: 'buff',
  onExecute: (ctx) => {
    refreshStatus(ctx.user, 'COUNTER', 2);
    for (const summon of activeContextFriendlySummons(ctx)) refreshStatus(summon, 'COUNTER', 2);
    ctx.log('buff', `🛡️ 【圣防护罩·镜之力】${ctx.user.name} 与己方召唤物进入反击防线！`);
    return true;
  },
};

export const GACHA_BLACK_LOTUS_CARD: GachaEntry = {
  text: '🌸 {USER} 发动「黑莲花」，为召唤物注入爆发魔力！',
  tag: 'buff',
  requiresAnyFriendlySummon: true,
  onExecute: (ctx) => {
    const summons = activeContextFriendlySummons(ctx);
    for (const summon of summons) {
      summon.atk = Math.floor(summon.atk * 1.18);
      summon.mag = Math.floor(summon.mag * 1.18);
      summon.spd = Math.floor(summon.spd * 1.08);
    }
    ctx.log('buff', `🌸 【黑莲花】${ctx.user.name} 为 ${summons.length} 只召唤物充能，攻击、魔力与速度提升！`);
    return true;
  },
};

export const GACHA_BLUE_EYES_BURST_CARD: GachaEntry = {
  text: '🐲 {USER} 抽到「毁灭爆裂疾风弹」，命令青眼白龙释放龙息！',
  tag: 'special',
  requiresFriendlySummon: '青眼白龙',
  onExecute: (ctx) => {
    const blueEyes = contextFriendlySummonByBaseName(ctx, '青眼白龙');
    if (!blueEyes) return false;
    if (!canSummonRespondToCommand(blueEyes)) {
      ctx.log('info', `🐲 【毁灭爆裂疾风弹】${ctx.user.name} 翻开支援牌，但 ${blueEyes.name} 正被控制，无法释放龙息！`);
      return true;
    }
    const dmg = Math.floor(blueEyes.mag * 4.2 + blueEyes.atk * 2.1);
    ctx.log('skill', `🐲 【毁灭爆裂疾风弹】${ctx.user.name} 翻开支援牌，${blueEyes.name} 向 ${ctx.target.name} 轰出白色龙息！`);
    const actualDmg = damageFromSummon(ctx, blueEyes, ctx.target, dmg, '毁灭爆裂疾风弹', true, { deferOutcome: true });
    if (actualDmg > 0) ctx.log('crit', `🐲 白龙龙息贯穿 ${ctx.target.name}，实际造成 ${actualDmg} 点真实伤害！`);
    finalizeSummonDamage(ctx, blueEyes, ctx.target, '毁灭爆裂疾风弹');
    return true;
  },
};

export const GACHA_TRUE_LIGHT_CARD: GachaEntry = {
  text: '💡 {USER} 发动「真之光」，守护青眼白龙！',
  tag: 'buff',
  requiresFriendlySummon: '青眼白龙',
  onExecute: (ctx) => {
    const blueEyes = contextFriendlySummonByBaseName(ctx, '青眼白龙');
    if (!blueEyes) return false;
    refreshStatus(blueEyes, 'SPELL_BLOCK', 3);
    refreshStatus(blueEyes, 'BKB', 2);
    refreshStatus(blueEyes, 'REGEN', 3);
    const healed = blueEyes.hpPct <= 0.55 ? healFighter(blueEyes, Math.floor(blueEyes.maxHp * 0.22)) : 0;
    consumeGachaLuck(ctx.user, 1);
    ctx.log('buff', `💡 【真之光】${ctx.user.name} 守护 ${blueEyes.name}，赋予法术抵挡、黑皇杖与再生${healed > 0 ? `，并恢复 ${healed} 点生命` : ''}！`);
    return true;
  },
};

export const GACHA_ANCIENT_CHANT_CARD: GachaEntry = {
  text: '☀️ {USER} 咏唱「古之咒文」，翼神龙的太阳神力开始升温！',
  tag: 'buff',
  requiresFriendlySummon: '翼神龙',
  onExecute: (ctx) => {
    const ra = contextFriendlySummonByBaseName(ctx, '翼神龙');
    if (!ra) return false;
    ra.raChantBoost = Math.min(3, (ra.raChantBoost ?? 0) + 1);
    refreshStatus(ra, 'SPELL_BLOCK', 2);
    const healed = healFighter(ra, Math.floor(ra.maxHp * 0.18));
    ctx.log('buff', `☀️ 【古之咒文】${ctx.user.name} 强化 ${ra.name}，太阳神力 ${ra.raChantBoost}/3，获得法术抵挡${healed > 0 ? `，恢复 ${healed} 点生命` : ''}！`);
    return true;
  },
};

export const GACHA_BLAZE_CANNON_CARD: GachaEntry = {
  text: '🔥 {USER} 发动「太阳神火焰加农」，命令翼神龙燃烧生命！',
  tag: 'special',
  requiresFriendlySummon: '翼神龙',
  onExecute: (ctx) => {
    const ra = contextFriendlySummonByBaseName(ctx, '翼神龙');
    if (!ra) return false;
    if (!canSummonRespondToCommand(ra)) {
      ctx.log('info', `🔥 【太阳神火焰加农】${ctx.user.name} 试图命令 ${ra.name} 燃烧生命，但 ${ra.name} 正被控制，无法响应！`);
      return true;
    }
    const burnHp = Math.min(ra.currentHp - 1, Math.max(1, Math.floor(ra.maxHp * 0.22)));
    ra.currentHp = Math.max(1, ra.currentHp - burnHp);
    ra.hpPct = ra.currentHp / ra.maxHp;
    const boost = ra.raChantBoost ?? 0;
    ra.raChantBoost = 0;
    const dmg = Math.floor(burnHp * (2.8 + boost * 0.75) + ra.mag * 3.0);
    ctx.log('crit', `🔥 【太阳神火焰加农】${ra.name} 燃烧 ${burnHp} 点生命，向 ${ctx.target.name} 释放神炎！（古之咒文强化 ${boost} 层）`);
    const actualDmg = damageFromSummon(ctx, ra, ctx.target, dmg, '太阳神火焰加农', true, { deferOutcome: true });
    if (actualDmg > 0) ctx.log('crit', `🔥 神炎命中 ${ctx.target.name}，实际造成 ${actualDmg} 点真实伤害！`);
    finalizeSummonDamage(ctx, ra, ctx.target, '太阳神火焰加农');
    if (isActiveCombatant(ra)) refreshStatus(ra, 'BKB', 1);
    return true;
  },
};

export const GACHA_RA_PHOENIX_CARD: GachaEntry = {
  text: '🔥 {USER} 唤醒「神不死鸟」，翼神龙将在致死时一场一次复燃！',
  tag: 'buff',
  requiresFriendlySummon: '翼神龙',
  onExecute: (ctx) => {
    const ra = contextFriendlySummonByBaseName(ctx, '翼神龙');
    if (!ra) return false;
    if (ra.hasUsedRaPhoenix) {
      ctx.log('info', `🔥 ${ra.name} 已经使用过【神不死鸟】，太阳神力无法再次复燃。`);
      return true;
    }
    refreshStatus(ra, GACHA_RA_PHOENIX_STATUS, 6);
    ra.raChantBoost = Math.min(3, (ra.raChantBoost ?? 0) + 1);
    ctx.log('buff', `🔥 【神不死鸟】${ctx.user.name} 点燃 ${ra.name} 的不死鸟形态：致死时将一场一次复燃反扑，并获得 1 层太阳神力！`);
    return true;
  },
};

export const GACHA_RA_TRIBUTE_ASCENSION_CARD: GachaEntry = {
  text: '🛐 {USER} 发动「献祭升格」，将普通召唤物献给翼神龙！',
  tag: 'buff',
  requiresFriendlySummon: '翼神龙',
  requiresOrdinarySummon: true,
  onExecute: (ctx) => {
    const ra = contextFriendlySummonByBaseName(ctx, '翼神龙');
    const victim = activeContextOrdinarySummons(ctx).sort((a, b) => a.hpPct - b.hpPct)[0];
    if (!ra || !victim) return false;
    ctx.markDefeated(victim, { message: `💀 【献祭升格】${victim.name} 化作 ${ra.name} 的太阳神力！`, awardKill: false });
    victim.isDead = true;
    const healed = healFighter(ra, Math.floor(ra.maxHp * 0.28));
    ra.raChantBoost = Math.min(3, (ra.raChantBoost ?? 0) + 1);
    ctx.log('buff', `🛐 【献祭升格】${ctx.user.name} 献祭 ${victim.name}，${ra.name} 恢复 ${healed} 点生命并获得 1 层太阳神力！`);
    return true;
  },
};

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
  text: '💰 {USER} 发动「天井兑换」，把攒下来的欧气兑换成召唤师关键动作！',
  tag: 'buff',
  onExecute: (ctx: SkillContext) => {
    const power = getPityPower(ctx.user, GACHA_LUCK_MAX);
    ctx.log('buff', `💰 【天井兑换】${ctx.user.name} 消耗 ${power} 点欧气检索关键召唤动作！`);

    if (canContextFuseBlueEyes(ctx)) {
      executeGachaSummonCard(ctx, GACHA_BLUE_EYES_ULTIMATE_CARD, '天井融合');
      return true;
    }

    const summons = responsiveContextFriendlySummons(ctx).sort((a, b) => (b.atk + b.mag + b.spd) - (a.atk + a.mag + a.spd));
    if (summons.length > 0) {
      const leader = summons[0];
      if (leader) {
        refreshStatus(leader, 'SPELL_BLOCK', 2);
        commandSummon(ctx, leader, '天井指令');
        if (power >= GACHA_LUCK_MAX && isActiveCombatant(leader)) commandSummon(ctx, leader, '天井连携');
      }
      return true;
    }
    if (activeContextFriendlySummons(ctx).length > 0) {
      ctx.log('info', `💰 【天井兑换】${ctx.user.name} 检索到召唤指令，但己方召唤物都被控制，改为补充召唤阵！`);
    }

    const draftCount = power >= GACHA_LUCK_MAX ? 2 : 1;
    for (let i = 0; i < draftCount; i += 1) {
      const card = GACHA_ORDINARY_SUMMON_CARDS[Math.floor(Math.random() * GACHA_ORDINARY_SUMMON_CARDS.length)];
      if (card) executeGachaSummonCard(ctx, card, '天井召唤');
    }
    return true;
  },
};

export const GACHA_TEN_PULL_GOLD_CARD: GachaEntry = {
  text: '🌈 {USER} 十连金光！卡组展开，召唤阵连锁启动！',
  tag: 'buff',
  onExecute: (ctx: SkillContext) => {
    const power = getPityPower(ctx.user, GACHA_LUCK_MAX);
    const summonSlots = activeContextFriendlySummons(ctx).length <= 1 ? 2 : 1;
    ctx.log('buff', `🌈 【十连金光】${ctx.user.name} 展开 ${summonSlots} 次召唤阵，并为召唤物充能！`);
    for (let i = 0; i < summonSlots; i += 1) {
      const card = GACHA_ORDINARY_SUMMON_CARDS[Math.floor(Math.random() * GACHA_ORDINARY_SUMMON_CARDS.length)];
      if (card) executeGachaSummonCard(ctx, card, '十连召唤');
    }
    for (const summon of activeContextFriendlySummons(ctx)) {
      summon.atk = Math.floor(summon.atk * (1.08 + power * 0.01));
      summon.mag = Math.floor(summon.mag * (1.08 + power * 0.01));
      refreshStatus(summon, 'REGEN', 2);
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
  const summonCount = summons.length;
  const enemies = activeEnemies(runtime, user);
  const hasSummonLifesteal = user.status.some((status) => status.type === GACHA_SUMMON_LIFESTEAL_STATUS);
  const summonCards = usableSummonEntries(runtime, user, runtime.data.GACHA_SSR_POOL);
  const tributeCards = tributeSummonEntries(runtime, user, runtime.data.GACHA_SSR_POOL);
  const supports = supportEntries(runtime, user, runtime.data.GACHA_SSR_POOL);
  const raSupports = raSupportEntries(runtime, user, runtime.data.GACHA_SSR_POOL);

  if (user.hpPct <= 0.38) return GACHA_WHALE_REWRITE_CARD;
  if (summonCount < 2 && summonCards.length > 0) return GACHA_TEN_PULL_GOLD_CARD;
  if (raSupports.length > 0 && Math.random() < 0.82) return pickRandom(raSupports);
  if (hasBlueEyesFusionMaterials(runtime, user) && Math.random() < 0.78) return GACHA_BLUE_EYES_ULTIMATE_CARD;
  if (supports.length > 0 && Math.random() < 0.68) return pickRandom(supports);
  if (tributeCards.length > 0 && Math.random() < 0.72) return pickRandom(tributeCards);
  if (summons.length > 0 && !hasSummonLifesteal) return GACHA_SUMMON_LIFESTEAL_CARD;
  if (summonCards.length > 0 && Math.random() < 0.58) return pickRandom(summonCards);
  if (enemies.length >= 3) return GACHA_TEN_PULL_GOLD_CARD;
  return GACHA_CEILING_EXCHANGE_CARD;
}

function chooseEnhancedEntry(runtime: LuckDrawRuntime, user: Fighter, pool: GachaEntry[]): GachaEntry {
  const summons = activeFriendlySummons(runtime, user);
  const summonCount = summons.length;
  const usablePool = usableEntries(runtime, user, pool);
  const hasSummonLifesteal = user.status.some((status) => status.type === GACHA_SUMMON_LIFESTEAL_STATUS);
  const summonCards = usableSummonEntries(runtime, user, pool);
  const tributeCards = tributeSummonEntries(runtime, user, pool);
  const supports = supportEntries(runtime, user, pool);
  const raSupports = raSupportEntries(runtime, user, pool);

  if (user.hpPct <= 0.5) return GACHA_SMALL_PITY_CARD;
  if (summonCount < 2 && summonCards.length > 0 && Math.random() < 0.72) return GACHA_TEN_PULL_GOLD_CARD;
  if (raSupports.length > 0 && Math.random() < 0.58) return pickRandom(raSupports);
  if (hasBlueEyesFusionMaterials(runtime, user) && Math.random() < 0.45) return GACHA_BLUE_EYES_ULTIMATE_CARD;
  if (supports.length > 0 && Math.random() < 0.42) return pickRandom(supports);
  if (tributeCards.length > 0 && Math.random() < 0.56) return pickRandom(tributeCards);
  if (summons.length > 0 && !hasSummonLifesteal) return GACHA_SUMMON_LIFESTEAL_CARD;
  if (summonCards.length > 0 && Math.random() < 0.44) return pickRandom(summonCards);

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
  const usablePool = usableEntries(runtime, user, pool);
  const candidates = usablePool.length > 0 ? usablePool : pool;
  const summonCards = usableSummonEntries(runtime, user, candidates);
  const tributeCards = tributeSummonEntries(runtime, user, pool);
  const hasSummonLifesteal = user.status.some((status) => status.type === GACHA_SUMMON_LIFESTEAL_STATUS);
  const supports = supportEntries(runtime, user, pool);
  const raSupports = raSupportEntries(runtime, user, pool);

  if (user.hpPct <= 0.45) {
    const defensive = candidates.filter((entry) =>
      entry.tag === 'heal' ||
      (entry.lifesteal ?? 0) >= 0.5 ||
      entry === GACHA_WHALE_REWRITE_CARD ||
      entry === GACHA_SMALL_PITY_CARD,
    );
    if (defensive.length > 0 && Math.random() < 0.65) return pickRandom(defensive);
  }

  if (summonCount < 2 && summonCards.length > 0 && Math.random() < 0.55) return GACHA_TEN_PULL_GOLD_CARD;
  if (raSupports.length > 0 && Math.random() < 0.36) return pickRandom(raSupports);
  if (hasBlueEyesFusionMaterials(runtime, user) && Math.random() < 0.32) return GACHA_BLUE_EYES_ULTIMATE_CARD;
  if (supports.length > 0 && Math.random() < 0.24) return pickRandom(supports);
  if (tributeCards.length > 0 && Math.random() < 0.42) return pickRandom(tributeCards);
  if (summons.length > 0 && !hasSummonLifesteal && Math.random() < 0.3) return GACHA_SUMMON_LIFESTEAL_CARD;
  if (summonCards.length > 0 && Math.random() < 0.36) return pickRandom(summonCards);

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

  return pickRandom(candidates);
}

export function resolveLuckEmperorSsrDraw(
  runtime: LuckDrawRuntime,
  user: Fighter,
  pool: GachaEntry[],
): GachaEntry {
  const luck = Math.max(0, user.gachaLuck ?? 0);
  const missingPieces = missingExodiaPieces(user);

  if (luck >= GACHA_LUCK_MAX) {
    const spent = consumeGachaLuck(user, GACHA_LUCK_MAX);
    user.gachaPityPower = Math.max(spent, GACHA_LUCK_MAX);
    runtime.log('buff', `👑 大保底启动！${user.name} 消耗 ${spent} 点欧气，强行把命运抽卡改写成翻盘牌！`);
    if (missingPieces.length > 0 && shouldRevealExodiaPiece(user, EXODIA_MAJOR_PITY_PIECE_CHANCES)) return GACHA_EXODIA_PIECE_CARD;
    return chooseMajorPityEntry(runtime, user);
  }

  if (luck >= 3) {
    const spent = consumeGachaLuck(user, 3);
    user.gachaPityPower = Math.max(spent, 3);
    runtime.log('buff', `🍀 小保底启动！${user.name} 消耗 ${spent} 点欧气，让这次命运抽卡必定强化！`);
    if (missingPieces.length > 0 && shouldRevealExodiaPiece(user, EXODIA_SMALL_PITY_PIECE_CHANCES)) return GACHA_EXODIA_PIECE_CARD;
    return chooseEnhancedEntry(runtime, user, pool);
  }

  if (missingPieces.length > 0 && shouldRevealExodiaPiece(user, EXODIA_NORMAL_PIECE_CHANCES)) return GACHA_EXODIA_PIECE_CARD;
  return chooseSmartEntry(runtime, user, pool);
}
