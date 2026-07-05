import {
  addStatsToFighter,
  EMOTE_DEATH_GAIN_KEYS,
  type EmoteStatMap,
  formatEmoteStats,
  getEmoteAdaptTotal,
  grantEmoteAdaptStats,
  removeStatsFromFighter,
} from '../emoteMechanics';
import type { Fighter } from '../types';
import type { CharacterHook, CharacterHookRuntime } from './types';

const EMOTE_DEATH_REVIVE_TICKS = 3;

function hasStatus(fighter: Fighter, type: string): boolean {
  return fighter.status.some((status) => status.type === type);
}

function activePlayerCandidates(runtime: CharacterHookRuntime, emote: Fighter): Fighter[] {
  return runtime.fighters.filter((candidate) =>
    candidate.id !== emote.id &&
    !candidate.isSummon &&
    runtime.isActiveCombatant(candidate),
  );
}

function activeEnemies(runtime: CharacterHookRuntime, actor: Fighter): Fighter[] {
  const actorTeamId = runtime.getTeamId(actor);
  return runtime.fighters.filter((candidate) =>
    candidate.id !== actor.id &&
    !candidate.isSummon &&
    runtime.isActiveCombatant(candidate) &&
    runtime.getTeamId(candidate) !== actorTeamId,
  );
}

function findKillerFallback(runtime: CharacterHookRuntime, fighter: Fighter, killer?: Fighter): Fighter | undefined {
  if (killer && killer.id !== fighter.id) return killer;
  const attackerId = fighter.lastDamage?.attackerId;
  if (!attackerId || attackerId === fighter.id) return undefined;
  return runtime.fighters.find((candidate) => candidate.id === attackerId);
}

function clearFamiliarMarks(runtime: CharacterHookRuntime, emote: Fighter): void {
  runtime.fighters.forEach((fighter) => {
    fighter.status = fighter.status.filter((status) =>
      !(status.type === 'EMOTE_FAMILIAR' && status.sourceId === emote.id),
    );
  });
  emote.emoteFamiliarTargetId = undefined;
}

function findPreferredOwner(runtime: CharacterHookRuntime, emote: Fighter, candidates: Fighter[]): Fighter | undefined {
  const byId = emote.emoteFamiliarTargetId
    ? candidates.find((candidate) => candidate.id === emote.emoteFamiliarTargetId)
    : undefined;
  if (byId) return byId;
  return candidates.find((candidate) =>
    candidate.status.some((status) => status.type === 'EMOTE_FAMILIAR' && status.sourceId === emote.id),
  );
}

function removeOwnerBonus(runtime: CharacterHookRuntime, emote: Fighter, reason = '复活'): boolean {
  const ownerId = emote.emoteOwnerId;
  const bonus = emote.emoteOwnerBonus;
  if (!ownerId || !bonus) return false;

  const owner = runtime.fighters.find((candidate) => candidate.id === ownerId);
  if (owner) {
    removeStatsFromFighter(owner, bonus);
    owner.status = owner.status.filter((status) =>
      !(status.type === 'EMOTE_OWNER_BONUS' && status.sourceId === emote.id),
    );
    runtime.log('info', `📜 【认主补偿收回】${emote.name} ${reason}，${owner.name} 身上的临时补偿被移除（${formatEmoteStats(bonus)}）。`);
  }

  emote.emoteOwnerId = undefined;
  emote.emoteOwnerBonus = undefined;
  return !!owner;
}

function applyOwnerBonus(runtime: CharacterHookRuntime, emote: Fighter, owner: Fighter, bonus: EmoteStatMap): void {
  removeOwnerBonus(runtime, emote);
  addStatsToFighter(owner, bonus);
  owner.status = owner.status.filter((status) =>
    !(status.type === 'EMOTE_OWNER_BONUS' && status.sourceId === emote.id),
  );
  owner.status.push({ type: 'EMOTE_OWNER_BONUS', duration: 999, sourceId: emote.id });
  emote.emoteOwnerId = owner.id;
  emote.emoteOwnerBonus = bonus;
  runtime.log('buff', `📜 【认主补偿】${owner.name} 临时获得本次击杀者 10% 生命与属性（${formatEmoteStats(bonus)}）；这是死亡认主补偿，${emote.name} 的累计适应值不会借出。`);
}

function finalizeEmoteTrueDeath(runtime: CharacterHookRuntime, emote: Fighter, reason: string): void {
  if (emote.emoteFinalDead) return;
  removeOwnerBonus(runtime, emote, '认主失败');
  emote.emoteFinalDead = true;
  emote.emoteReviveTurns = 0;
  emote.emoteReviveAppliedTurn = undefined;
  emote.emoteOwnerId = undefined;
  emote.emoteOwnerBonus = undefined;
  clearFamiliarMarks(runtime, emote);
  runtime.log('death', `🧿 【认主失败】${emote.name} ${reason}，四处认主型魔虚罗的轮盘停止转动，确认真正退场。`);
}

function reviveEmote(runtime: CharacterHookRuntime, emote: Fighter): void {
  removeOwnerBonus(runtime, emote);
  clearFamiliarMarks(runtime, emote);
  emote.isDead = false;
  emote.isDeadAnnounced = false;
  emote.defeatHooksResolved = false;
  emote.emoteReviveTurns = 0;
  emote.emoteReviveAppliedTurn = undefined;
  emote.emoteFinalDead = false;
  emote.currentHp = emote.maxHp;
  emote.status = [];
  runtime.syncHpPct(emote);
  runtime.log('buff', `🧿 【四处认主型魔虚罗】${emote.name} 借着场上的 0 击杀锚点满血复活！累计适应值仍然保留（总和 ${getEmoteAdaptTotal(emote)}）。`);
}

function tryFinalOwnerChallenge(runtime: CharacterHookRuntime, emote: Fighter, alivePlayers: Fighter[]): boolean {
  if (emote.emoteFinalChallengeUsed || alivePlayers.length !== 2) return false;
  const zeroKillAnchors = alivePlayers.filter((player) => player.stats.kills === 0);
  if (zeroKillAnchors.length === 0) return false;

  emote.emoteFinalChallengeUsed = true;
  runtime.log('buff', `🧿 【最终认主挑战】场上只剩 2 名玩家，但 ${zeroKillAnchors.map((player) => player.name).join('、')} 仍是 0 击杀，${emote.name} 抢到最后一次复活机会！`);
  reviveEmote(runtime, emote);
  return true;
}

function resolveEmoteEndgameCheck(runtime: CharacterHookRuntime, emote: Fighter): boolean {
  const alivePlayers = activePlayerCandidates(runtime, emote);
  if (alivePlayers.length > 2) return false;
  if (tryFinalOwnerChallenge(runtime, emote, alivePlayers)) return true;
  finalizeEmoteTrueDeath(runtime, emote, `等待复活时场上只剩 ${alivePlayers.length} 名玩家`);
  return true;
}

function advanceEmoteGlobalReviveClock(runtime: CharacterHookRuntime, emote: Fighter): void {
  if (!emote.isEmote || !emote.isDead || emote.emoteFinalDead || (emote.emoteReviveTurns ?? 0) <= 0) return;
  if (resolveEmoteEndgameCheck(runtime, emote)) return;

  const appliedTurn = emote.emoteReviveAppliedTurn ?? runtime.turnCount;
  emote.emoteReviveAppliedTurn = appliedTurn;
  if (appliedTurn >= runtime.turnCount) return;

  emote.emoteReviveTurns = Math.max(0, (emote.emoteReviveTurns ?? 0) - 1);
  if ((emote.emoteReviveTurns ?? 0) > 0) {
    runtime.log('info', `🧿 【认主倒计时】${emote.name} 的轮盘按回合末节奏转动，剩余 ${emote.emoteReviveTurns} 次回合末结算。`);
    return;
  }

  const alivePlayers = activePlayerCandidates(runtime, emote);
  const zeroKillAnchors = alivePlayers.filter((player) => player.stats.kills === 0);
  if (zeroKillAnchors.length === 0) {
    finalizeEmoteTrueDeath(runtime, emote, '三次回合末结算后场上没有 0 击杀玩家作为复活锚点');
    return;
  }

  runtime.log('info', `🧿 【零杀锚点】${zeroKillAnchors.map((player) => player.name).join('、')} 仍是 0 击杀，${emote.name} 找到了复活入口。`);
  reviveEmote(runtime, emote);
}

function weightedPick(items: Array<[string, number]>): string | null {
  const pool = items.filter(([, weight]) => weight > 0);
  const total = pool.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return null;
  let roll = Math.random() * total;
  for (const [skill, weight] of pool) {
    roll -= weight;
    if (roll <= 0) return skill;
  }
  return pool[pool.length - 1]?.[0] ?? null;
}

export const emoteHook: CharacterHook = {
  id: 'emote',

  selectSkill: ({ actor, runtime, phase }) => {
    if (phase !== 'preMechanics' || !actor.isEmote) return null;
    const enemies = activeEnemies(runtime, actor);
    if (enemies.length === 0) return null;

    const adaptTotal = getEmoteAdaptTotal(actor);
    const killTargets = enemies.filter((enemy) => enemy.stats.kills > 0);
    const hasLiveFamiliar = !!actor.emoteFamiliarTargetId && enemies.some((enemy) => enemy.id === actor.emoteFamiliarTargetId);
    const canUlt = !hasStatus(actor, 'EMOTE_ULT_COOLDOWN') && ((actor.emoteDeathCount ?? 0) >= 2 || adaptTotal >= 80);

    if (actor.hpPct < 0.45 && !hasStatus(actor, 'EMOTE_ADAPT') && Math.random() < 0.72) return 'emote_adaptation_wheel';
    if (canUlt && killTargets.length >= 2 && Math.random() < 0.58) return 'emote_all_masters_return';
    if (killTargets.length > 0 && Math.random() < 0.62) return 'emote_tenth_claim';
    if (!hasLiveFamiliar && Math.random() < 0.42) return 'emote_mark_owner';
    if (adaptTotal >= 25 && Math.random() < 0.58) return 'emote_wheel_cleave';

    return weightedPick([
      ['emote_meme_slap', 18],
      ['emote_tenth_claim', killTargets.length > 0 ? 18 : 2],
      ['emote_adaptation_wheel', hasStatus(actor, 'EMOTE_ADAPT') ? 0 : 12],
      ['emote_mark_owner', hasLiveFamiliar ? 2 : 10],
      ['emote_wheel_cleave', adaptTotal >= 10 ? 14 : 5],
      ['emote_all_masters_return', canUlt && killTargets.length > 0 ? 8 : 0],
    ]);
  },

  onDefeatSettled: ({ fighter, runtime, killer }) => {
    if (!fighter.isEmote || fighter.emoteFinalDead || (fighter.emoteReviveTurns ?? 0) > 0) return;

    fighter.emoteDeathCount = (fighter.emoteDeathCount ?? 0) + 1;
    const source = findKillerFallback(runtime, fighter, killer);
    let deathGain: EmoteStatMap | null = null;
    if (source) {
      deathGain = grantEmoteAdaptStats(fighter, source, 0.1, [...EMOTE_DEATH_GAIN_KEYS], 1, { healAddedMaxHp: false });
      runtime.log('buff', `🧿 【死亡适应】${fighter.name} 被 ${source.name} 击倒，复制并永久获得击杀者 10% 生命与属性（${formatEmoteStats(deathGain)}）；${source.name} 的属性和生命不会降低。`);
    } else {
      runtime.log('info', `🧿 【死亡适应】${fighter.name} 没能锁定击杀者，本次死亡没有复制到属性。`);
    }

    const candidates = activePlayerCandidates(runtime, fighter);
    if (candidates.length === 0) {
      finalizeEmoteTrueDeath(runtime, fighter, '找不到任何还活着的玩家可以认主');
      return;
    }

    const preferredOwner = findPreferredOwner(runtime, fighter, candidates);
    const owner = preferredOwner ?? candidates[Math.floor(Math.random() * candidates.length)];
    if (!owner) {
      finalizeEmoteTrueDeath(runtime, fighter, '认主目标丢失');
      return;
    }

    clearFamiliarMarks(runtime, fighter);
    const killsBefore = owner.stats.kills;
    owner.stats.kills = 0;
    runtime.log('debuff', `📜 【四处认主】${fighter.name} 死亡后认 ${owner.name} 为临时主人，${owner.name} 的击杀数 ${killsBefore} -> 0。`);
    if (deathGain) {
      applyOwnerBonus(runtime, fighter, owner, deathGain);
    } else {
      runtime.log('info', `📜 【认主补偿】${fighter.name} 本次没有锁定击杀者，${owner.name} 不获得临时属性补偿。`);
    }

    fighter.emoteReviveTurns = EMOTE_DEATH_REVIVE_TICKS;
    fighter.emoteReviveAppliedTurn = runtime.turnCount;
    runtime.log('info', `🧿 【认主倒计时】${fighter.name} 暂未真正退场：3 次回合末结算后若场上仍有 0 击杀玩家且存活玩家数大于 2，就会复活；若只剩 2 名玩家且仍有 0 杀锚点，则可触发一次最终认主挑战。`);
  },

  shouldPreventWin: ({ fighter, runtime }) => {
    if (!fighter.isEmote || !fighter.isDead || fighter.emoteFinalDead || (fighter.emoteReviveTurns ?? 0) <= 0) return false;
    if (resolveEmoteEndgameCheck(runtime, fighter)) return !fighter.emoteFinalDead;
    return true;
  },

  onReviveCheck: ({ fighter, runtime }) => {
    if (!fighter.isEmote || !fighter.isDead || fighter.emoteFinalDead || (fighter.emoteReviveTurns ?? 0) <= 0) return false;
    resolveEmoteEndgameCheck(runtime, fighter);
    return true;
  },

  onGlobalTick: ({ runtime }) => {
    runtime.fighters.forEach((fighter) => advanceEmoteGlobalReviveClock(runtime, fighter));
  },
};
