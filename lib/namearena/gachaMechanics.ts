import { clearZeroedStatPenalty, healFighter, isActiveCombatant, resolveHealing } from './combatState';
import { getStatusIdentityIdsByTag } from './statusRegistry';
import type {
  BattleCombatEffectId,
  BattleEngineData,
  BattleLogMetadata,
  DamageApplicationOptions,
  Fighter,
  GachaEntry,
  SkillContext,
} from './types';

import { isSelectableTargetFor } from './targeting';
import { applyStatus, hasIdentity, removeBarriers, removeEffects } from './statusSystem';
import { hasStatusApplication } from './skillEffects';
import { getEffectiveCombatStat } from './statusMechanics';
import { didDamageConnect, isDamageRedirected } from './damageRedirects';
import {
  findSurtrTributeGroups,
  isSurtrOwnedBy,
  SURTR_BASE_STATS,
} from './surtrMechanics';

export const GACHA_LUCK_MAX = 5;
export const GACHA_SUMMON_LIFESTEAL_STATUS = 'GACHA_SUMMON_LIFESTEAL';
export const GACHA_RA_PHOENIX_STATUS = 'RA_PHOENIX';
const GACHA_SUMMON_LIFESTEAL_PCT = 0.30;
export const EXODIA_PIECES = ['被封印者的右腕', '被封印者的左腕', '被封印者的右足', '被封印者的左足', '被封印者本体'] as const;
export const GACHA_ADVANCED_SUMMON_NAMES = ['青眼白龙', '史尔特尔', '翼神龙', '黑暗大法师', '青眼究极龙'] as const;
const EXODIA_NORMAL_PIECE_CHANCES = [0.055, 0.11, 0.21, 0.38, 0.62] as const;
const EXODIA_SMALL_PITY_PIECE_CHANCES = [0.09, 0.18, 0.36, 0.68, 1] as const;
const EXODIA_MAJOR_PITY_PIECE_CHANCES = [0, 0.16, 0.46, 0.86, 1] as const;

function summonPower(fighter: Fighter): number {
  return getEffectiveCombatStat(fighter, 'atk') +
    getEffectiveCombatStat(fighter, 'mag') +
    getEffectiveCombatStat(fighter, 'spd');
}

type LogFn = (type: string, text: string, metadata?: BattleLogMetadata) => void;

type LuckDrawRuntime = {
  fighters?: Fighter[];
  data: BattleEngineData;
  turnCount?: number;
  getTeamId?: (fighter: Fighter) => string;
  isActiveCombatant?: (fighter: Fighter) => boolean;
  log: LogFn;
};

type SummonLifestealRuntime = {
  fighters: Fighter[];
  isActiveCombatant: (fighter: Fighter) => boolean;
  log: LogFn;
};

export type GachaEffectOptions = {
  source?: Fighter;
  targets?: Fighter[];
  links?: Array<{ sourceId: string; targetId: string }>;
  label?: string;
  count?: number;
};

export function gachaEffectMetadata(
  effectId: BattleCombatEffectId,
  source: Fighter,
  targets: Fighter[] = [],
  options: Omit<GachaEffectOptions, 'source' | 'targets'> = {},
): BattleLogMetadata {
  const targetIds = targets.map((target) => target.id);
  return {
    actorId: source.id,
    actorName: source.name,
    targetIds,
    visualCue: {
      kind: 'combat_fx',
      effectId,
      sourceId: source.id,
      targetIds,
      ...options,
    },
  };
}

function gachaActionMetadata(
  effectId: BattleCombatEffectId,
  source: Fighter,
  targets: Fighter[] = [],
  options: Omit<GachaEffectOptions, 'source' | 'targets' | 'links'> = {},
): BattleLogMetadata {
  const targetIds = targets.map((target) => target.id);
  return {
    actorId: source.id,
    actorName: source.name,
    targetIds,
    visualCue: {
      kind: 'combat_action',
      effectId,
      sourceId: source.id,
      targetIds,
      presentation: 'skill',
      ...options,
    },
  };
}

export function gachaReactionMetadata(
  effectId: BattleCombatEffectId,
  source: Fighter,
  targets: Fighter[] = [],
  options: Omit<GachaEffectOptions, 'source' | 'targets' | 'links'> = {},
): BattleLogMetadata {
  const targetIds = targets.map((target) => target.id);
  return {
    actorId: source.id,
    actorName: source.name,
    targetIds,
    visualCue: {
      kind: 'reaction_fx',
      effectId,
      sourceId: source.id,
      targetIds,
      ...options,
    },
  };
}

function logGachaEffect(
  ctx: SkillContext,
  type: string,
  text: string,
  effectId: BattleCombatEffectId,
  options: GachaEffectOptions = {},
): void {
  const { source = ctx.user, targets = [], ...cueOptions } = options;
  ctx.log(type, text, gachaEffectMetadata(effectId, source, targets, cueOptions));
}

function activeFighters(runtime: LuckDrawRuntime): Fighter[] {
  return (runtime.fighters ?? []).filter((fighter) =>
    runtime.isActiveCombatant ? runtime.isActiveCombatant(fighter) : !fighter.isDead && !fighter.isDeadAnnounced && fighter.currentHp > 0,
  );
}

function activeEnemies(runtime: LuckDrawRuntime, user: Fighter): Fighter[] {
  if (runtime.fighters && runtime.getTeamId && runtime.isActiveCombatant && runtime.turnCount !== undefined) {
    return runtime.fighters.filter((fighter) => isSelectableTargetFor({
      fighters: runtime.fighters!,
      turnCount: runtime.turnCount!,
      getTeamId: runtime.getTeamId!,
      isActiveCombatant: runtime.isActiveCombatant!,
    }, user, fighter));
  }
  const userTeamId = runtime.getTeamId?.(user) ?? user.teamId ?? user.id;
  return activeFighters(runtime).filter((fighter) =>
    fighter.id !== user.id &&
    !(fighter.isPuruisaishi && (fighter.puruisaishiPhase ?? 1) <= 1) &&
    (runtime.getTeamId?.(fighter) ?? fighter.teamId ?? fighter.id) !== userTeamId,
  );
}

function activeFriendlySummons(runtime: LuckDrawRuntime, user: Fighter): Fighter[] {
  const userTeamId = runtime.getTeamId?.(user) ?? user.teamId ?? user.id;
  return activeFighters(runtime).filter((fighter) =>
    fighter.isSummon &&
    (
      isSurtrOwnedBy(fighter, user) ||
      (
        fighter.summonerId === user.id &&
        (runtime.getTeamId?.(fighter) ?? fighter.teamId ?? fighter.id) === userTeamId
      )
    ),
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
  if (entry.summonName === '史尔特尔') return findSurtrTributeGroups({
    fighters: runtime.fighters ?? [],
    isActiveCombatant: (fighter) => runtime.isActiveCombatant
      ? runtime.isActiveCombatant(fighter)
      : isActiveCombatant(fighter),
  }).length > 0;
  if (entry.summonName === '青眼究极龙') return hasBlueEyesFusionMaterials(runtime, user);
  return (entry.tributes ?? 0) <= activeTributableSummons(runtime, user, entry).length;
}

function usableSummonEntries(runtime: LuckDrawRuntime, user: Fighter, pool: GachaEntry[]): GachaEntry[] {
  return pool.filter((entry) => entry.isSummon && canUseGachaEntry(runtime, user, entry));
}

function tributeSummonEntries(runtime: LuckDrawRuntime, user: Fighter, pool: GachaEntry[]): GachaEntry[] {
  return usableSummonEntries(runtime, user, pool).filter((entry) =>
    (entry.tributes ?? 0) > 0 || entry.summonName === '史尔特尔',
  );
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
  if (entry.summonName === '史尔特尔') {
    if (!isLuckEmperor(user)) return false;
    if ((runtime.fighters ?? []).some((fighter) =>
      fighter.isSurtr &&
      fighter.surtrState?.primaryOwnerId === user.id &&
      (runtime.isActiveCombatant ? runtime.isActiveCombatant(fighter) : isActiveCombatant(fighter)),
    )) return false;
  }
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
  clearZeroedStatPenalty(user);
}

function cleanseLuckEmperor(user: Fighter, strongDispel: (target: Fighter) => void): void {
  restoreZeroedStats(user);
  strongDispel(user);
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
  log(
    'buff',
    `🍀 ${fighter.name} 因${reason}积攒欧气 +${gained}！（${hint}）`,
    { actorId: fighter.id, actorName: fighter.name, targetIds: [fighter.id] },
  );
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
  applyStatus(user, {
    identityId: GACHA_SUMMON_LIFESTEAL_STATUS,
    remainingTurns: turns,
    attribution: { effectSourceId: GACHA_SUMMON_LIFESTEAL_STATUS },
  });
  log(
    'buff',
    `🧛 ${user.name} 抽到吸血牌！接下来 ${turns} 回合内，召唤物造成伤害的 ${Math.floor(GACHA_SUMMON_LIFESTEAL_PCT * 100)}% 会转化为治疗灌回本体！`,
    gachaEffectMetadata('gacha_summon_lifesteal', user, [user]),
  );
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
    hasIdentity(fighter, GACHA_SUMMON_LIFESTEAL_STATUS),
  );
  if (!summoner) return;

  const healPct = summoner.gachaSummonLifestealPct ?? GACHA_SUMMON_LIFESTEAL_PCT;
  const healed = healFighter(summoner, Math.floor(healBase * healPct), runtime.log);
  if (healed > 0) {
    runtime.log(
      'heal',
      `🧛 吸血牌回流！${attacker.name} 的伤害为 ${summoner.name} 恢复了 ${healed} 点生命！`,
      { actorId: attacker.id, actorName: attacker.name, targetIds: [summoner.id] },
    );
  }
}

export function triggerGachaDeathSave(
  fighter: Fighter,
  log: LogFn,
  syncHpPct: (fighter: Fighter) => void,
  strongDispel: (target: Fighter) => void,
): boolean {
  if (!isLuckEmperor(fighter) || fighter.hasUsedGachaDeathSave) return false;

  fighter.hasUsedGachaDeathSave = true;
  fighter.currentHp = Math.max(1, Math.floor(fighter.maxHp * 0.3));
  syncHpPct(fighter);
  log(
    'buff',
    `👑 【欧皇护符】${fighter.name} 在致死瞬间强行改命，锁住了 ${fighter.currentHp} 点生命，并开始清除异常！`,
    gachaReactionMetadata('gacha_death_save', fighter, [fighter]),
  );
  cleanseLuckEmperor(fighter, strongDispel);
  applyStatus(fighter, { identityId: 'SPELL_BLOCK', charges: 3, attribution: { effectSourceId: 'gacha_death_charm' } });
  applyStatus(fighter, { identityId: 'BKB', remainingTurns: 2, attribution: { effectSourceId: 'gacha_death_charm' } });
  applyStatus(fighter, { identityId: 'REGEN', remainingTurns: 3 });
  grantGachaLuck(fighter, 3, log, '死里逃生');
  return true;
}

function activeContextEnemies(ctx: SkillContext): Fighter[] {
  return ctx.fighters.filter((fighter) =>
    isSelectableTargetFor({
      fighters: ctx.fighters,
      turnCount: ctx.turnCount,
      getTeamId: ctx.getTeamId,
      isActiveCombatant,
    }, ctx.user, fighter),
  );
}

function activeContextFriendlySummons(ctx: SkillContext): Fighter[] {
  const myTeamId = ctx.getTeamId(ctx.user);
  return ctx.fighters.filter((fighter) =>
    fighter.isSummon &&
    !fighter.isDead &&
    !fighter.isDeadAnnounced &&
    fighter.currentHp > 0 &&
    (
      isSurtrOwnedBy(fighter, ctx.user) ||
      (
        fighter.summonerId === ctx.user.id &&
        ctx.getTeamId(fighter) === myTeamId
      )
    ),
  );
}

function activeContextOrdinarySummons(ctx: SkillContext): Fighter[] {
  return activeContextFriendlySummons(ctx).filter((fighter) => !isAdvancedSummonName(getSummonBaseName(fighter)));
}

function canSummonRespondToCommand(summon: Fighter): boolean {
  if (hasIdentity(summon, 'BKB') || hasIdentity(summon, 'STYLE_FOOL')) return true;
  return !getStatusIdentityIdsByTag('control').some((identityId) => hasIdentity(summon, identityId));
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
  options: {
    deferOutcome?: boolean;
    effectId?: BattleCombatEffectId;
    openingText?: string;
    afterDamage?: (actualDamage: number, redirected: boolean, connected: boolean) => void;
  } = {},
): number {
  let actualDmg = 0;
  let redirected = false;
  ctx.runReactionAction(summon, {
    skillId: 'gacha_summon_card_attack',
    skillName: actionName,
    presentation: 'skill',
    targets: [target],
    triggerDepth: ctx.triggerDepth + 1,
  }, () => {
    if (options.effectId && options.openingText) {
      ctx.log('skill', options.openingText, gachaActionMetadata(options.effectId, summon, [target]));
    }
    const damageOptions: DamageApplicationOptions = { actionName, sourceKind: 'custom' };
    actualDmg = ctx.applyDamage(target, amount, 'skill', trueDamage, summon, damageOptions);
    redirected = isDamageRedirected(damageOptions);
    if (!redirected && !options.deferOutcome) finalizeSummonDamage(ctx, summon, target, actionName);
    options.afterDamage?.(
      redirected ? 0 : actualDmg,
      redirected,
      !redirected && didDamageConnect(actualDmg, damageOptions),
    );
  });
  return redirected ? 0 : actualDmg;
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
  const enemies = ctx.fighters.filter((fighter) =>
    isSelectableTargetFor({
      fighters: ctx.fighters,
      turnCount: ctx.turnCount,
      getTeamId: ctx.getTeamId,
      isActiveCombatant,
    }, summon, fighter),
  );
  if (enemies.length === 0) {
    ctx.log('info', `🎴 【${label}】${ctx.user.name} 发出指令，但场上已经没有可攻击目标。`);
    return;
  }
  const target = enemies[Math.floor(Math.random() * enemies.length)];
  logGachaEffect(
    ctx,
    'skill',
    `🎴 【${label}】${ctx.user.name} 命令 ${summon.name} 立刻压制 ${target.name}！`,
    'gacha_summon_command',
    { targets: [summon], label },
  );
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
  logGachaEffect(
    ctx,
    'buff',
    `🧩 【封印组件】${ctx.user.name} 抽到了「${piece}」！（${count}/${EXODIA_PIECES.length}，不会重复）`,
    'gacha_exodia_piece',
    { targets: [ctx.user], label: piece, count },
  );
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
  { text: "🤖 {USER} 帮帮我，史瓦罗先生！召唤「克拉拉 & 史瓦罗」！", isSummon: true, summonName: '史瓦罗', summonJob: 'HSR_HUNTER', stats: { hp: 1800, atk: 60, def: 100 } },
];

export const GACHA_ORDINARY_SUMMON_NAMES = GACHA_ORDINARY_SUMMON_CARDS
  .map((card) => card.summonName)
  .filter((name): name is string => Boolean(name));

export const GACHA_BLUE_EYES_CARD: GachaEntry = {
  text: "🐲 {USER} 献祭两只普通召唤物！「青眼白龙」降临！强韧！无敌！最强！",
  isSummon: true,
  summonName: '青眼白龙',
  summonJob: 'BLUE_EYES_WHITE_DRAGON',
  stats: { hp: 2800, atk: 180, def: 150, spd: 140, agl: 130, mag: 190, res: 150, wis: 160 },
  tributes: 2,
  advancedSummon: true,
};

export const GACHA_SURTR_CARD: GachaEntry = {
  text: '🔥 {USER} 以诗怀雅与幽灵鲨为祭，完成上级召唤！「史尔特尔」——黄昏的尽头，莱万汀将烧尽一切。',
  isSummon: true,
  summonName: '史尔特尔',
  summonJob: 'ARKNIGHTS_OP',
  stats: { ...SURTR_BASE_STATS },
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
  visualEffect: 'gacha_exodia_piece',
  onExecute: (ctx) => {
    grantExodiaPiece(ctx);
    return true;
  },
};

export const GACHA_SUMMON_COMMAND_CARD: GachaEntry = {
  text: '🎴 {USER} 抽到「召唤指令」，让场上的召唤物立刻行动！',
  tag: 'buff',
  visualEffect: 'gacha_summon_command',
  requiresAnyFriendlySummon: true,
  onExecute: (ctx) => {
    const summons = responsiveContextFriendlySummons(ctx)
      .sort((a, b) => summonPower(b) - summonPower(a));
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
  visualEffect: 'gacha_all_out_attack',
  requiresOrdinarySummon: true,
  onExecute: (ctx) => {
    const enemies = activeContextEnemies(ctx);
    if (enemies.length === 0) return true;
    const summons = responsiveContextOrdinarySummons(ctx);
    if (summons.length === 0) {
      ctx.log('info', `⚔️ 【全军进击】${ctx.user.name} 试图发起协同攻击，但普通召唤物都被控制，无法压上！`);
      return true;
    }
    logGachaEffect(
      ctx,
      'skill',
      `⚔️ 【全军进击】${ctx.user.name} 命令 ${summons.length} 只普通召唤物发动协同攻击！`,
      'gacha_all_out_attack',
      { targets: summons, count: summons.length },
    );
    for (const summon of summons) {
      if (!isActiveCombatant(ctx.user) || !isActiveCombatant(summon)) continue;
      const activeTargets = enemies.filter((enemy) => isActiveCombatant(enemy));
      const target = activeTargets[Math.floor(Math.random() * activeTargets.length)];
      if (!target) continue;
      ctx.runReactionAction(summon, {
        skillId: 'gacha_all_out_summon_attack',
        skillName: '全军进击',
        presentation: 'skill',
        targets: [target],
        triggerDepth: ctx.triggerDepth + 1,
      }, () => {
        ctx.log(
          'skill',
          `⚔️ ${summon.name} 响应【全军进击】，向 ${target.name} 压上！`,
          gachaActionMetadata('gacha_all_out_attack', summon, [target]),
        );
        const dmg = Math.max(1, Math.floor((
          getEffectiveCombatStat(summon, 'atk', 'custom') +
          getEffectiveCombatStat(summon, 'mag', 'custom')
        ) * 1.05));
        const damageOptions: DamageApplicationOptions = { actionName: '全军进击', sourceKind: 'custom' };
        const actualDmg = ctx.applyDamage(target, dmg, 'skill', false, summon, damageOptions);
        if (isDamageRedirected(damageOptions)) {
          ctx.log('info', `⚔️ ${summon.name} 的进击被 ${target.name} 的防护机制转移，原目标没有受伤；转移伤害已单独结算！`, {
            actorId: summon.id,
            actorName: summon.name,
            targetIds: [target.id],
          });
          return;
        }
        const connected = didDamageConnect(actualDmg, damageOptions);
        ctx.log(
          connected ? 'skill' : 'info',
          actualDmg > 0
            ? `⚔️ ${summon.name} 命中 ${target.name}，实际造成 ${actualDmg} 点伤害！`
            : connected
              ? `⚔️ ${summon.name} 命中 ${target.name}；但【黄昏余命】期间未再损失生命！`
            : `⚔️ ${summon.name} 的进击被 ${target.name} 化解，没有造成实际伤害！`,
          { actorId: summon.id, actorName: summon.name, targetIds: [target.id] },
        );
        ctx.flushDeferredDamageEvents?.();
        if (target.currentHp <= 0) {
          ctx.markDefeated(target, { message: `💀 【全军进击】${target.name} 被 ${summon.name} 击败！`, killer: summon });
        }
      });
    }
    return true;
  },
};

export const GACHA_TRIBUTE_PREP_CARD: GachaEntry = {
  text: '🕯️ {USER} 抽到「献祭准备」，普通召唤物被仪式光芒保护！',
  tag: 'buff',
  visualEffect: 'gacha_tribute_prep',
  requiresOrdinarySummon: true,
  onExecute: (ctx) => {
    const summons = activeContextOrdinarySummons(ctx);
    for (const summon of summons) {
      applyStatus(summon, { identityId: 'SPELL_BLOCK', charges: 2, attribution: { effectSourceId: 'gacha_tribute_compensation' } });
      applyStatus(summon, { identityId: 'REGEN', remainingTurns: 2 });
    }
    logGachaEffect(
      ctx,
      'buff',
      `🕯️ 【献祭准备】${ctx.user.name} 为 ${summons.length} 只普通召唤物套上仪式护盾，并积攒欧气！`,
      'gacha_tribute_prep',
      { targets: summons, count: summons.length },
    );
    grantGachaLuck(ctx.user, 1, ctx.log, '献祭准备');
    return true;
  },
};

export const GACHA_SUMMON_RECYCLE_CARD: GachaEntry = {
  text: '♻️ {USER} 抽到「召唤物回收」，将残血普通召唤物化作资源！',
  tag: 'buff',
  visualEffect: 'gacha_summon_recycle',
  requiresOrdinarySummon: true,
  onExecute: (ctx) => {
    const victim = activeContextOrdinarySummons(ctx).sort((a, b) => a.hpPct - b.hpPct)[0];
    if (!victim) return false;
    logGachaEffect(
      ctx,
      'skill',
      `♻️ 【召唤物回收】${ctx.user.name} 展开回收阵，锁定 ${victim.name} 化作卡组资源！`,
      'gacha_summon_recycle',
      { targets: [victim], label: victim.name },
    );
    ctx.markDefeated(victim, { message: `💀 【召唤物回收】${victim.name} 被 ${ctx.user.name} 回收为卡组资源！`, awardKill: false });
    victim.isDead = true;
    const healing = resolveHealing(ctx.user, Math.floor(ctx.user.maxHp * 0.18), {
      kind: 'direct',
      sourceId: '召唤物回收',
      healer: ctx.user,
    }, ctx.log);
    const healText = healing.actual > 0
      ? `恢复 ${healing.actual} 点生命`
      : healing.outcome === 'blocked'
        ? '治疗被完全阻止'
        : '生命已满，治疗溢出';
    ctx.log(
      healing.actual > 0 ? 'heal' : 'info',
      `♻️ 【召唤物回收】${ctx.user.name} 回收 ${victim.name}，${healText}，并获得 2 点欧气！`,
      { targetIds: [ctx.user.id] },
    );
    grantGachaLuck(ctx.user, 2, ctx.log, '召唤物回收');
    return true;
  },
};

export const GACHA_MONSTER_REBORN_CARD: GachaEntry = {
  text: '⚗️ {USER} 发动「死者苏生」，从墓地拉回一只普通召唤物！',
  tag: 'buff',
  visualEffect: 'gacha_monster_reborn',
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
    target.currentHp = Math.max(1, Math.floor(target.maxHp * 0.55));
    logGachaEffect(
      ctx,
      'heal',
      `⚗️ 【死者苏生】${ctx.user.name} 发动卡片，将 ${target.name} 从墓地拉回战场并开始重塑状态！`,
      'gacha_monster_reborn',
      { targets: [target], label: target.name },
    );
    removeEffects(target, { reason: 'revive' });
    removeBarriers(target);
    target.hpPct = target.currentHp / target.maxHp;
    ctx.log('heal', `⚗️ 【死者苏生完成】${target.name} 已恢复到 ${target.currentHp} 点生命！`, { targetIds: [target.id] });
    return true;
  },
};

export const GACHA_ASH_BLOSSOM_CARD: GachaEntry = {
  text: '🌸 {USER} 抽到「灰流丽」，打断敌方关键行动！',
  tag: 'debuff',
  visualEffect: 'gacha_ash_blossom',
  onExecute: (ctx) => {
    logGachaEffect(
      ctx,
      'skill',
      `🌸 【灰流丽】${ctx.user.name} 抛出手坑，试图无效 ${ctx.target.name} 的下一次关键行动！`,
      'gacha_ash_blossom',
      { targets: [ctx.target] },
    );
    const applied = ctx.applyStatus(ctx.target, {
      identityId: 'STUN',
      remainingTurns: 2,
      effectName: '灰流丽的打断效果',
    });
    ctx.log(
      applied ? 'debuff' : 'info',
      applied
        ? `🌸 【灰流丽结算】${ctx.target.name} 的下一次关键行动已被封锁，陷入眩晕！`
        : `🌸 【灰流丽结算】${ctx.target.name} 抵挡了打断，眩晕未能生效。`,
      { actorId: ctx.user.id, actorName: ctx.user.name, targetIds: [ctx.target.id] },
    );
    return true;
  },
};

export const GACHA_MIRROR_FORCE_CARD: GachaEntry = {
  text: '🛡️ {USER} 覆盖「圣防护罩·镜之力」，召唤阵进入反击防线！',
  tag: 'buff',
  visualEffect: 'gacha_mirror_force',
  onExecute: (ctx) => {
    applyStatus(ctx.user, { identityId: 'COUNTER', remainingTurns: 2 });
    for (const summon of activeContextFriendlySummons(ctx)) applyStatus(summon, { identityId: 'COUNTER', remainingTurns: 2 });
    const protectedUnits = [ctx.user, ...activeContextFriendlySummons(ctx)];
    logGachaEffect(
      ctx,
      'buff',
      `🛡️ 【圣防护罩·镜之力】${ctx.user.name} 与己方召唤物进入反击防线！`,
      'gacha_mirror_force',
      { targets: protectedUnits, count: protectedUnits.length },
    );
    return true;
  },
};

export const GACHA_BLACK_LOTUS_CARD: GachaEntry = {
  text: '🌸 {USER} 发动「黑莲花」，为召唤物注入爆发魔力！',
  tag: 'buff',
  visualEffect: 'gacha_black_lotus',
  requiresAnyFriendlySummon: true,
  onExecute: (ctx) => {
    const summons = activeContextFriendlySummons(ctx);
    for (const summon of summons) {
      summon.atk = Math.floor(summon.atk * 1.18);
      summon.mag = Math.floor(summon.mag * 1.18);
      summon.spd = Math.floor(summon.spd * 1.08);
    }
    logGachaEffect(
      ctx,
      'buff',
      `🌸 【黑莲花】${ctx.user.name} 为 ${summons.length} 只召唤物充能，攻击、魔力与速度提升！`,
      'gacha_black_lotus',
      { targets: summons, count: summons.length },
    );
    return true;
  },
};

export const GACHA_BLUE_EYES_BURST_CARD: GachaEntry = {
  text: '🐲 {USER} 抽到「毁灭爆裂疾风弹」，命令青眼白龙释放龙息！',
  tag: 'special',
  directTarget: true,
  visualEffect: 'gacha_blue_eyes_burst',
  requiresFriendlySummon: '青眼白龙',
  onExecute: (ctx) => {
    const blueEyes = contextFriendlySummonByBaseName(ctx, '青眼白龙');
    if (!blueEyes) return false;
    if (!canSummonRespondToCommand(blueEyes)) {
      ctx.log('info', `🐲 【毁灭爆裂疾风弹】${ctx.user.name} 翻开支援牌，但 ${blueEyes.name} 正被控制，无法释放龙息！`);
      return true;
    }
    const dmg = Math.floor(
      getEffectiveCombatStat(blueEyes, 'mag', 'custom') * 4.2 +
      getEffectiveCombatStat(blueEyes, 'atk', 'custom') * 2.1,
    );
    damageFromSummon(ctx, blueEyes, ctx.target, dmg, '毁灭爆裂疾风弹', true, {
      deferOutcome: true,
      effectId: 'gacha_blue_eyes_burst',
      openingText: `🐲 【毁灭爆裂疾风弹】${ctx.user.name} 翻开支援牌，${blueEyes.name} 向 ${ctx.target.name} 轰出白色龙息！`,
      afterDamage: (actualDmg, redirected, connected) => {
        if (!redirected && actualDmg > 0) {
          ctx.log('crit', `🐲 白龙龙息贯穿 ${ctx.target.name}，实际造成 ${actualDmg} 点真实伤害！`, {
            actorId: blueEyes.id,
            actorName: blueEyes.name,
            targetIds: [ctx.target.id],
          });
        } else if (connected) {
          ctx.log('crit', `🐲 白龙龙息贯穿 ${ctx.target.name}；但【黄昏余命】期间未再损失生命！`, {
            actorId: blueEyes.id,
            actorName: blueEyes.name,
            targetIds: [ctx.target.id],
          });
        }
        if (!redirected) finalizeSummonDamage(ctx, blueEyes, ctx.target, '毁灭爆裂疾风弹');
      },
    });
    return true;
  },
};

export const GACHA_TRUE_LIGHT_CARD: GachaEntry = {
  text: '💡 {USER} 发动「真之光」，守护青眼白龙！',
  tag: 'buff',
  visualEffect: 'gacha_true_light',
  requiresFriendlySummon: '青眼白龙',
  onExecute: (ctx) => {
    const blueEyes = contextFriendlySummonByBaseName(ctx, '青眼白龙');
    if (!blueEyes) return false;
    applyStatus(blueEyes, { identityId: 'SPELL_BLOCK', charges: 3, attribution: { effectSourceId: 'gacha_true_light' } });
    applyStatus(blueEyes, { identityId: 'BKB', remainingTurns: 2, attribution: { effectSourceId: 'gacha_true_light' } });
    applyStatus(blueEyes, { identityId: 'REGEN', remainingTurns: 3 });
    const healed = blueEyes.hpPct <= 0.55 ? healFighter(blueEyes, Math.floor(blueEyes.maxHp * 0.22), ctx.log) : 0;
    consumeGachaLuck(ctx.user, 1);
    logGachaEffect(
      ctx,
      'buff',
      `💡 【真之光】${ctx.user.name} 守护 ${blueEyes.name}，赋予真之光护壁、控制免疫与再生${healed > 0 ? `，并恢复 ${healed} 点生命` : ''}！`,
      'gacha_true_light',
      { targets: [blueEyes] },
    );
    return true;
  },
};

export const GACHA_ANCIENT_CHANT_CARD: GachaEntry = {
  text: '☀️ {USER} 咏唱「古之咒文」，翼神龙的太阳神力开始升温！',
  tag: 'buff',
  visualEffect: 'gacha_ancient_chant',
  requiresFriendlySummon: '翼神龙',
  onExecute: (ctx) => {
    const ra = contextFriendlySummonByBaseName(ctx, '翼神龙');
    if (!ra) return false;
    ra.raChantBoost = Math.min(3, (ra.raChantBoost ?? 0) + 1);
    applyStatus(ra, { identityId: 'SPELL_BLOCK', charges: 2, attribution: { effectSourceId: 'gacha_ancient_chant' } });
    const healed = healFighter(ra, Math.floor(ra.maxHp * 0.18), ctx.log);
    logGachaEffect(
      ctx,
      'buff',
      `☀️ 【古之咒文】${ctx.user.name} 强化 ${ra.name}，太阳神力 ${ra.raChantBoost}/3，获得法术抵挡${healed > 0 ? `，恢复 ${healed} 点生命` : ''}！`,
      'gacha_ancient_chant',
      { targets: [ra], count: ra.raChantBoost },
    );
    return true;
  },
};

export const GACHA_BLAZE_CANNON_CARD: GachaEntry = {
  text: '🔥 {USER} 发动「太阳神火焰加农」，命令翼神龙燃烧生命！',
  tag: 'special',
  directTarget: true,
  visualEffect: 'gacha_blaze_cannon',
  requiresFriendlySummon: '翼神龙',
  onExecute: (ctx) => {
    const ra = contextFriendlySummonByBaseName(ctx, '翼神龙');
    if (!ra) return false;
    if (!canSummonRespondToCommand(ra)) {
      ctx.log('info', `🔥 【太阳神火焰加农】${ctx.user.name} 试图命令 ${ra.name} 燃烧生命，但 ${ra.name} 正被控制，无法响应！`);
      return true;
    }
    const burnHp = Math.min(ra.currentHp - 1, Math.max(1, Math.floor(ra.maxHp * 0.22)));
    const burnOptions: DamageApplicationOptions = {
      actionName: '太阳神火焰加农·生命燃烧',
      sourceKind: 'self_cost',
      respectDefenses: false,
      bypassShields: true,
      creditAttacker: false,
      suppressStatusAftermath: true,
      suppressOwlCooperation: true,
      bypassOwlOutgoingModifier: true,
      bypassOwlIncomingModifier: true,
    };
    const actualBurnHp = ctx.applyDamage(ra, burnHp, 'self_cost', true, ra, burnOptions);
    const boost = ra.raChantBoost ?? 0;
    ra.raChantBoost = 0;
    const dmg = Math.floor(
      actualBurnHp * (2.8 + boost * 0.75) +
      getEffectiveCombatStat(ra, 'mag', 'custom') * 3.0,
    );
    damageFromSummon(ctx, ra, ctx.target, dmg, '太阳神火焰加农', true, {
      deferOutcome: true,
      effectId: 'gacha_blaze_cannon',
      openingText: `🔥 【太阳神火焰加农】${ra.name} 燃烧 ${actualBurnHp} 点生命，向 ${ctx.target.name} 释放神炎！（古之咒文强化 ${boost} 层）`,
      afterDamage: (actualDmg, redirected, connected) => {
        if (!redirected && actualDmg > 0) {
          ctx.log('crit', `🔥 神炎命中 ${ctx.target.name}，实际造成 ${actualDmg} 点真实伤害！`, {
            actorId: ra.id,
            actorName: ra.name,
            targetIds: [ctx.target.id],
          });
        } else if (connected) {
          ctx.log('crit', `🔥 神炎命中 ${ctx.target.name}；但【黄昏余命】期间未再损失生命！`, {
            actorId: ra.id,
            actorName: ra.name,
            targetIds: [ctx.target.id],
          });
        }
        if (!redirected) finalizeSummonDamage(ctx, ra, ctx.target, '太阳神火焰加农');
      },
    });
    if (isActiveCombatant(ra)) applyStatus(ra, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'ra_divine_aura' } });
    return true;
  },
};

export const GACHA_RA_PHOENIX_CARD: GachaEntry = {
  text: '🔥 {USER} 唤醒「神不死鸟」，翼神龙将在致死时一场一次复燃！',
  tag: 'buff',
  visualEffect: 'gacha_ra_phoenix',
  requiresFriendlySummon: '翼神龙',
  onExecute: (ctx) => {
    const ra = contextFriendlySummonByBaseName(ctx, '翼神龙');
    if (!ra) return false;
    if (ra.hasUsedRaPhoenix) {
      ctx.log('info', `🔥 ${ra.name} 已经使用过【神不死鸟】，太阳神力无法再次复燃。`);
      return true;
    }
    applyStatus(ra, {
      identityId: GACHA_RA_PHOENIX_STATUS,
      remainingTurns: 6,
      attribution: { effectSourceId: GACHA_RA_PHOENIX_STATUS },
    });
    ra.raChantBoost = Math.min(3, (ra.raChantBoost ?? 0) + 1);
    logGachaEffect(
      ctx,
      'buff',
      `🔥 【神不死鸟】${ctx.user.name} 点燃 ${ra.name} 的不死鸟形态：致死时将一场一次复燃反扑，并获得 1 层太阳神力！`,
      'gacha_ra_phoenix',
      { targets: [ra] },
    );
    return true;
  },
};

export const GACHA_RA_TRIBUTE_ASCENSION_CARD: GachaEntry = {
  text: '🛐 {USER} 发动「献祭升格」，将普通召唤物献给翼神龙！',
  tag: 'buff',
  visualEffect: 'gacha_ra_tribute',
  requiresFriendlySummon: '翼神龙',
  requiresOrdinarySummon: true,
  onExecute: (ctx) => {
    const ra = contextFriendlySummonByBaseName(ctx, '翼神龙');
    const victim = activeContextOrdinarySummons(ctx).sort((a, b) => a.hpPct - b.hpPct)[0];
    if (!ra || !victim) return false;
    logGachaEffect(
      ctx,
      'skill',
      `🛐 【献祭升格】${ctx.user.name} 启动仪式，${victim.name} 正在化作 ${ra.name} 的太阳神力！`,
      'gacha_ra_tribute',
      { source: victim, targets: [ra], label: victim.name },
    );
    ctx.markDefeated(victim, { message: `💀 【献祭升格】${victim.name} 化作 ${ra.name} 的太阳神力！`, awardKill: false });
    victim.isDead = true;
    const healing = resolveHealing(ra, Math.floor(ra.maxHp * 0.28), {
      kind: 'direct',
      sourceId: '献祭升格',
      healer: ctx.user,
    }, ctx.log);
    ra.raChantBoost = Math.min(3, (ra.raChantBoost ?? 0) + 1);
    const healText = healing.actual > 0
      ? `恢复 ${healing.actual} 点生命`
      : healing.outcome === 'blocked'
        ? '治疗被完全阻止'
        : '生命已满，治疗溢出';
    ctx.log(
      'buff',
      `🛐 【献祭升格】${ctx.user.name} 献祭 ${victim.name}，${ra.name} ${healText}，并获得 1 层太阳神力！`,
      { targetIds: [ra.id] },
    );
    return true;
  },
};

export const GACHA_SMALL_PITY_CARD: GachaEntry = {
  text: '🍀 {USER} 小保底歪了但没完全歪，保底光芒护住了自己！',
  tag: 'buff',
  visualEffect: 'gacha_small_pity',
  onExecute: (ctx: SkillContext) => {
    const power = getPityPower(ctx.user, 3);
    logGachaEffect(
      ctx,
      'heal',
      `🍀 【小保底歪了但没完全歪】${ctx.user.name} 被保底光芒护住，开始改写异常状态！`,
      'gacha_small_pity',
      { targets: [ctx.user], count: power },
    );
    cleanseLuckEmperor(ctx.user, (target) => {
      ctx.dispelStatusEffects(target, { strength: 'strong', direction: 'negative' });
    });
    const healing = resolveHealing(ctx.user, Math.floor(ctx.user.maxHp * (0.22 + power * 0.03)), {
      kind: 'direct',
      sourceId: '小保底',
      healer: ctx.user,
    }, ctx.log);
    applyStatus(ctx.user, { identityId: 'SPELL_BLOCK', charges: 2, attribution: { effectSourceId: 'gacha_small_pity' } });
    applyStatus(ctx.user, { identityId: 'REGEN', remainingTurns: 3 });
    const healText = healing.actual > 0
      ? `恢复了 ${healing.actual} 点生命`
      : healing.outcome === 'blocked'
        ? '治疗被完全阻止'
        : '生命已满，治疗溢出';
    ctx.log(healing.outcome === 'blocked' ? 'info' : 'heal', `🍀 【小保底结算】${ctx.user.name} ${healText}，并获得法术抵挡与再生！`, { targetIds: [ctx.user.id] });
    return true;
  },
};

export const GACHA_CEILING_EXCHANGE_CARD: GachaEntry = {
  text: '💰 {USER} 发动「天井兑换」，把攒下来的欧气兑换成召唤师关键动作！',
  tag: 'buff',
  visualEffect: 'gacha_ceiling_exchange',
  onExecute: (ctx: SkillContext) => {
    const power = getPityPower(ctx.user, GACHA_LUCK_MAX);
    logGachaEffect(
      ctx,
      'buff',
      `💰 【天井兑换】${ctx.user.name} 消耗 ${power} 点欧气检索关键召唤动作！`,
      'gacha_ceiling_exchange',
      { targets: [ctx.user], count: power },
    );

    if (canContextFuseBlueEyes(ctx)) {
      executeGachaSummonCard(ctx, GACHA_BLUE_EYES_ULTIMATE_CARD, '天井融合');
      return true;
    }

    const summons = responsiveContextFriendlySummons(ctx).sort((a, b) => summonPower(b) - summonPower(a));
    if (summons.length > 0) {
      const leader = summons[0];
      if (leader) {
        applyStatus(leader, { identityId: 'SPELL_BLOCK', charges: 2, attribution: { effectSourceId: 'gacha_heavenly_exchange' } });
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
  visualEffect: 'gacha_ten_pull_gold',
  onExecute: (ctx: SkillContext) => {
    const power = getPityPower(ctx.user, GACHA_LUCK_MAX);
    const summonSlots = activeContextFriendlySummons(ctx).length <= 1 ? 2 : 1;
    logGachaEffect(
      ctx,
      'buff',
      `🌈 【十连金光】${ctx.user.name} 展开 ${summonSlots} 次召唤阵，并为召唤物充能！`,
      'gacha_ten_pull_gold',
      { targets: [ctx.user], count: summonSlots },
    );
    for (let i = 0; i < summonSlots; i += 1) {
      const card = GACHA_ORDINARY_SUMMON_CARDS[Math.floor(Math.random() * GACHA_ORDINARY_SUMMON_CARDS.length)];
      if (card) executeGachaSummonCard(ctx, card, '十连召唤');
    }
    for (const summon of activeContextFriendlySummons(ctx)) {
      summon.atk = Math.floor(summon.atk * (1.08 + power * 0.01));
      summon.mag = Math.floor(summon.mag * (1.08 + power * 0.01));
      applyStatus(summon, { identityId: 'REGEN', remainingTurns: 2 });
    }
    return true;
  },
};

export const GACHA_WHALE_REWRITE_CARD: GachaEntry = {
  text: '💳 {USER} 发动「氪金改命」，把这一回合从坏结局里买了回来！',
  tag: 'buff',
  visualEffect: 'gacha_whale_rewrite',
  onExecute: (ctx: SkillContext) => {
    const power = getPityPower(ctx.user, 3);
    logGachaEffect(
      ctx,
      'buff',
      `💳 【氪金改命】${ctx.user.name} 把这一回合从坏结局里买了回来，开始重写异常与伤势！`,
      'gacha_whale_rewrite',
      { targets: [ctx.user], count: power },
    );
    cleanseLuckEmperor(ctx.user, (target) => {
      ctx.dispelStatusEffects(target, { strength: 'strong', direction: 'negative' });
    });
    const healing = resolveHealing(ctx.user, Math.floor(ctx.user.maxHp * (0.18 + power * 0.04)), {
      kind: 'direct',
      sourceId: '氪金改命',
      healer: ctx.user,
    }, ctx.log);
    applyStatus(ctx.user, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'gacha_whale_rewrite' } });
    applyStatus(ctx.user, { identityId: 'SPELL_BLOCK', charges: 2, attribution: { effectSourceId: 'gacha_whale_rewrite' } });
    applyStatus(ctx.user, { identityId: 'REGEN', remainingTurns: 3 });
    const healText = healing.actual > 0
      ? `恢复 ${healing.actual} 点生命`
      : healing.outcome === 'blocked'
        ? '治疗被完全阻止'
        : '生命已满，治疗溢出';
    ctx.log('buff', `💳 【氪金改命结算】${ctx.user.name} ${healText}，并获得改命抗性、法术抵挡与再生！`, { targetIds: [ctx.user.id] });
    grantGachaLuck(ctx.user, 1, ctx.log, '氪金改命余波');
    return true;
  },
};

export const GACHA_SUMMON_LIFESTEAL_CARD: GachaEntry = {
  text: '🧛 {USER} 抽到了吸血牌！召唤物的攻势开始回灌生命！',
  tag: 'buff',
  visualEffect: 'gacha_summon_lifesteal',
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
  const hasSummonLifesteal = hasIdentity(user, GACHA_SUMMON_LIFESTEAL_STATUS);
  const summonCards = usableSummonEntries(runtime, user, runtime.data.GACHA_SSR_POOL);
  const tributeCards = tributeSummonEntries(runtime, user, runtime.data.GACHA_SSR_POOL);
  const supports = supportEntries(runtime, user, runtime.data.GACHA_SSR_POOL);
  const raSupports = raSupportEntries(runtime, user, runtime.data.GACHA_SSR_POOL);

  if (user.hpPct <= 0.38) return GACHA_WHALE_REWRITE_CARD;
  if (summonCount < 2 && summonCards.length > 0) return GACHA_TEN_PULL_GOLD_CARD;
  if (raSupports.length > 0 && Math.random() < 0.68) return pickRandom(raSupports);
  if (hasBlueEyesFusionMaterials(runtime, user) && Math.random() < 0.51) return GACHA_BLUE_EYES_ULTIMATE_CARD;
  if (supports.length > 0 && Math.random() < 0.54) return pickRandom(supports);
  if (tributeCards.length > 0 && Math.random() < 0.46) return pickRandom(tributeCards);
  if (summons.length > 0 && !hasSummonLifesteal) return GACHA_SUMMON_LIFESTEAL_CARD;
  if (summonCards.length > 0 && Math.random() < 0.45) return pickRandom(summonCards);
  if (enemies.length >= 3) return GACHA_TEN_PULL_GOLD_CARD;
  return GACHA_CEILING_EXCHANGE_CARD;
}

function chooseEnhancedEntry(runtime: LuckDrawRuntime, user: Fighter, pool: GachaEntry[]): GachaEntry {
  const summons = activeFriendlySummons(runtime, user);
  const summonCount = summons.length;
  const usablePool = usableEntries(runtime, user, pool);
  const hasSummonLifesteal = hasIdentity(user, GACHA_SUMMON_LIFESTEAL_STATUS);
  const summonCards = usableSummonEntries(runtime, user, pool);
  const tributeCards = tributeSummonEntries(runtime, user, pool);
  const supports = supportEntries(runtime, user, pool);
  const raSupports = raSupportEntries(runtime, user, pool);

  if (user.hpPct <= 0.5) return GACHA_SMALL_PITY_CARD;
  if (summonCount < 2 && summonCards.length > 0 && Math.random() < 0.62) return GACHA_TEN_PULL_GOLD_CARD;
  if (raSupports.length > 0 && Math.random() < 0.42) return pickRandom(raSupports);
  if (hasBlueEyesFusionMaterials(runtime, user) && Math.random() < 0.27) return GACHA_BLUE_EYES_ULTIMATE_CARD;
  if (supports.length > 0 && Math.random() < 0.32) return pickRandom(supports);
  if (tributeCards.length > 0 && Math.random() < 0.34) return pickRandom(tributeCards);
  if (summons.length > 0 && !hasSummonLifesteal) return GACHA_SUMMON_LIFESTEAL_CARD;
  if (summonCards.length > 0 && Math.random() < 0.36) return pickRandom(summonCards);

  const premium = usablePool.filter((entry) =>
    entry.tag === 'heal' ||
    (entry.lifesteal ?? 0) > 0 ||
    (entry.mult ?? 0) >= 5 ||
    entry.ignoreDef ||
    hasStatusApplication(entry, 'STUN') ||
    hasStatusApplication(entry, 'CHARMED') ||
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
  const hasSummonLifesteal = hasIdentity(user, GACHA_SUMMON_LIFESTEAL_STATUS);
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

  if (summonCount < 2 && summonCards.length > 0 && Math.random() < 0.48) return GACHA_TEN_PULL_GOLD_CARD;
  if (raSupports.length > 0 && Math.random() < 0.28) return pickRandom(raSupports);
  if (hasBlueEyesFusionMaterials(runtime, user) && Math.random() < 0.24) return GACHA_BLUE_EYES_ULTIMATE_CARD;
  if (supports.length > 0 && Math.random() < 0.2) return pickRandom(supports);
  if (tributeCards.length > 0 && Math.random() < 0.28) return pickRandom(tributeCards);
  if (summons.length > 0 && !hasSummonLifesteal && Math.random() < 0.25) return GACHA_SUMMON_LIFESTEAL_CARD;
  if (summonCards.length > 0 && Math.random() < 0.32) return pickRandom(summonCards);

  if (enemies.length >= 3) {
    const crowdControl = candidates.filter((entry) =>
      entry === GACHA_TEN_PULL_GOLD_CARD ||
      entry.triggerAgain ||
      (entry.mult ?? 0) >= 5 ||
      hasStatusApplication(entry, 'STUN') ||
      hasStatusApplication(entry, 'CHARMED'),
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
    runtime.log(
      'buff',
      `👑 大保底启动！${user.name} 消耗 ${spent} 点欧气，强行把命运抽卡改写成翻盘牌！`,
      gachaEffectMetadata('gacha_major_pity', user, [user], { count: spent }),
    );
    if (missingPieces.length > 0 && shouldRevealExodiaPiece(user, EXODIA_MAJOR_PITY_PIECE_CHANCES)) return GACHA_EXODIA_PIECE_CARD;
    return chooseMajorPityEntry(runtime, user);
  }

  if (luck >= 3) {
    const spent = consumeGachaLuck(user, 3);
    user.gachaPityPower = Math.max(spent, 3);
    runtime.log(
      'buff',
      `🍀 小保底启动！${user.name} 消耗 ${spent} 点欧气，让这次命运抽卡必定强化！`,
      gachaEffectMetadata('gacha_small_pity', user, [user], { count: spent }),
    );
    if (missingPieces.length > 0 && shouldRevealExodiaPiece(user, EXODIA_SMALL_PITY_PIECE_CHANCES)) return GACHA_EXODIA_PIECE_CARD;
    return chooseEnhancedEntry(runtime, user, pool);
  }

  if (missingPieces.length > 0 && shouldRevealExodiaPiece(user, EXODIA_NORMAL_PIECE_CHANCES)) return GACHA_EXODIA_PIECE_CARD;
  return chooseSmartEntry(runtime, user, pool);
}
