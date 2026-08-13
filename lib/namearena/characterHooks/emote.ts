import {
  EMOTE_DEATH_GAIN_KEYS,
  type EmoteStatMap,
  formatEmoteStats,
  consumeEmoteClaimableKills,
  getEmoteAdaptTotal,
  getEmoteClaimableKills,
  grantEmoteAdaptStats,
} from '../emoteMechanics';
import type { Fighter } from '../types';
import type { CharacterHook, CharacterHookRuntime } from './types';
import { hasIdentity, queryMechanic, removeEffects, applyStatus } from '../statusSystem';
import { clearReviveEffects } from '../statusMechanics';

const EMOTE_DEATH_REVIVE_TICKS = 5;
const EMOTE_DEATH_ADAPT_RATIO = 0.0625;

function hasStatus(fighter: Fighter, type: string): boolean {
  return hasIdentity(fighter, type);
}

function activePlayerCandidates(runtime: CharacterHookRuntime, emote: Fighter): Fighter[] {
  return runtime.fighters.filter((candidate) =>
    candidate.id !== emote.id &&
    !candidate.isSummon &&
    !candidate.isNpc &&
    !candidate.cannotWin &&
    runtime.isActiveCombatant(candidate),
  );
}

function activeEnemies(runtime: CharacterHookRuntime, actor: Fighter): Fighter[] {
  const actorTeamId = runtime.getTeamId(actor);
  return runtime.fighters.filter((candidate) =>
    candidate.id !== actor.id &&
    !candidate.isSummon &&
    !candidate.isNpc &&
    !candidate.cannotWin &&
    runtime.isActiveCombatant(candidate) &&
    runtime.getTeamId(candidate) !== actorTeamId,
  );
}

function findKillerFallback(runtime: CharacterHookRuntime, fighter: Fighter, killer?: Fighter): Fighter | undefined {
  if (killer && killer.id !== fighter.id) return killer;
  const attackerId = fighter.lastDamage?.attackerId;
  if (!attackerId || attackerId === fighter.id) return undefined;
  return runtime.fighters.find((candidate) => candidate.id === attackerId && !candidate.isNpc && !candidate.cannotWin);
}

function clearFamiliarMarks(runtime: CharacterHookRuntime, emote: Fighter): void {
  runtime.fighters.forEach((fighter) => {
    removeEffects(fighter, { identityIds: ['EMOTE_FAMILIAR'], effectSourceIds: [emote.id], reason: 'scripted' });
  });
  emote.emoteFamiliarTargetId = undefined;
}

function findPreferredOwner(runtime: CharacterHookRuntime, emote: Fighter, candidates: Fighter[]): Fighter | undefined {
  const byId = emote.emoteFamiliarTargetId
    ? candidates.find((candidate) => candidate.id === emote.emoteFamiliarTargetId)
    : undefined;
  if (byId) return byId;
  return candidates.find((candidate) =>
    queryMechanic(candidate, 'EMOTE_FAMILIAR').entries.some((status) =>
      status.attribution.effectSourceId === emote.id,
    ),
  );
}

function removeOwnerBonus(runtime: CharacterHookRuntime, emote: Fighter, reason = '复活'): boolean {
  const ownerId = emote.emoteOwnerId;
  const bonus = emote.emoteOwnerBonus;
  if (!ownerId || !bonus) return false;

  const owner = runtime.fighters.find((candidate) => candidate.id === ownerId);
  if (owner) {
    const maxHpBonus = Math.max(0, Math.floor(bonus.maxHp ?? 0));
    if (maxHpBonus > 0) {
      owner.maxHp = Math.max(1, owner.maxHp - maxHpBonus);
      owner.currentHp = Math.min(owner.currentHp, owner.maxHp);
      runtime.syncHpPct(owner);
    }
    removeEffects(owner, { identityIds: ['EMOTE_OWNER_BONUS'], effectSourceIds: [emote.id], reason: 'scripted' });
    runtime.log(
      'info',
      `📜 【认主补偿收回】${emote.name} ${reason}，${owner.name} 身上的临时补偿被移除（${formatEmoteStats(bonus)}）。`,
      {
        actorId: emote.id,
        actorName: emote.name,
        targetIds: [owner.id],
      },
    );
  }

  emote.emoteOwnerId = undefined;
  emote.emoteOwnerBonus = undefined;
  return !!owner;
}

function applyOwnerBonus(runtime: CharacterHookRuntime, emote: Fighter, owner: Fighter, bonus: EmoteStatMap): void {
  removeOwnerBonus(runtime, emote);
  const maxHpBonus = Math.max(0, Math.floor(bonus.maxHp ?? 0));
  if (maxHpBonus > 0) {
    owner.maxHp += maxHpBonus;
    owner.currentHp += maxHpBonus;
    runtime.syncHpPct(owner);
  }
  removeEffects(owner, { identityIds: ['EMOTE_OWNER_BONUS'], effectSourceIds: [emote.id], reason: 'replaced' });
  applyStatus(owner, {
    identityId: 'EMOTE_OWNER_BONUS',
    componentPotencies: Object.fromEntries(
      (['atk', 'def', 'spd', 'agl', 'mag', 'res', 'wis'] as const).map((key) => [`${key.toUpperCase()}_FLAT_UP`, bonus[key]]),
    ),
    attribution: { effectSourceId: emote.id, applierId: emote.id, applierName: emote.name },
  });
  emote.emoteOwnerId = owner.id;
  emote.emoteOwnerBonus = bonus;
  runtime.log(
    'buff',
    `📜 【认主补偿】${owner.name} 临时获得本次击杀者 6.25% 生命与属性（${formatEmoteStats(bonus)}）；这是死亡认主补偿，${emote.name} 的累计适应值不会借出。`,
    {
      actorId: emote.id,
      actorName: emote.name,
      targetIds: [owner.id],
    },
  );
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
  runtime.log(
    'death',
    `🧿 【认主失败】${emote.name} ${reason}，四处认主型魔虚罗的轮盘停止转动，确认真正退场。`,
    {
      actorId: emote.id,
      actorName: emote.name,
      targetIds: [emote.id],
    },
  );
}

function reviveEmote(runtime: CharacterHookRuntime, emote: Fighter): void {
  runtime.runReactionAction(emote, {
    skillId: 'emote_owner_return',
    skillName: '认主返场',
    presentation: 'skill',
    targets: [emote],
  }, () => {
    removeOwnerBonus(runtime, emote);
    clearFamiliarMarks(runtime, emote);
    emote.isDead = false;
    emote.isDeadAnnounced = false;
    emote.defeatHooksResolved = false;
    emote.emoteReviveTurns = 0;
    emote.emoteReviveAppliedTurn = undefined;
    emote.emoteFinalDead = false;
    emote.currentHp = Math.max(1, Math.floor(emote.maxHp * 0.82));
    runtime.log('buff', `🧿 【四处认主型魔虚罗】场上“认主账本余额为 0”的锚点响应，${emote.name} 开始复活并重整状态！`, {
      actorId: emote.id,
      actorName: emote.name,
      targetIds: [emote.id],
    });
    clearReviveEffects(emote);
    runtime.syncHpPct(emote);
    runtime.log('buff', `🧿 【认主返场】${emote.name} 已复活至 82% 生命：“快让我看血流成河，布瑠布由良由良”。累计适应值仍然保留（总和 ${getEmoteAdaptTotal(emote)}）。`, {
      actorId: emote.id,
      actorName: emote.name,
      targetIds: [emote.id],
    });
  });
}

function tryFinalOwnerChallenge(runtime: CharacterHookRuntime, emote: Fighter, alivePlayers: Fighter[]): boolean {
  if (emote.emoteFinalChallengeUsed || alivePlayers.length !== 2) return false;
  const zeroKillAnchors = alivePlayers.filter((player) => getEmoteClaimableKills(player) === 0);
  if (zeroKillAnchors.length === 0) return false;

  emote.emoteFinalChallengeUsed = true;
  runtime.log(
    'buff',
    `🧿 【最终认主挑战】场上只剩 2 名玩家，但 ${zeroKillAnchors.map((player) => player.name).join('、')} 的认主账本余额仍为 0，${emote.name} 抢到最后一次复活机会！`,
    {
      actorId: emote.id,
      actorName: emote.name,
      targetIds: zeroKillAnchors.map((player) => player.id),
    },
  );
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
    runtime.log(
      'info',
      `🧿 【认主倒计时】${emote.name} 的轮盘按回合末节奏转动，剩余 ${emote.emoteReviveTurns} 次回合末结算。`,
      {
        actorId: emote.id,
        actorName: emote.name,
        targetIds: [emote.id],
      },
    );
    return;
  }

  const alivePlayers = activePlayerCandidates(runtime, emote);
  const zeroKillAnchors = alivePlayers.filter((player) => getEmoteClaimableKills(player) === 0);
  if (zeroKillAnchors.length === 0) {
    finalizeEmoteTrueDeath(runtime, emote, '五次回合末结算后场上没有认主账本余额为 0 的玩家作为复活锚点');
    return;
  }

  runtime.log(
    'info',
    `🧿 【零杀锚点】${zeroKillAnchors.map((player) => player.name).join('、')} 的认主账本余额仍为 0（真实击杀统计不变），${emote.name} 找到了复活入口。`,
    {
      actorId: emote.id,
      actorName: emote.name,
      targetIds: zeroKillAnchors.map((player) => player.id),
    },
  );
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
    const killTargets = enemies.filter((enemy) => getEmoteClaimableKills(enemy) > 0);
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
      deathGain = grantEmoteAdaptStats(fighter, source, EMOTE_DEATH_ADAPT_RATIO, [...EMOTE_DEATH_GAIN_KEYS], 1, { healAddedMaxHp: false });
      runtime.log(
        'buff',
        `🧿 【死亡适应】${fighter.name} 被 ${source.name} 击倒，复制并永久获得击杀者 6.25% 生命与属性（${formatEmoteStats(deathGain)}）；${source.name} 的属性和生命不会降低。`,
        {
          actorId: source.id,
          actorName: source.name,
          targetIds: [fighter.id],
        },
      );
    } else {
      runtime.log(
        'info',
        `🧿 【死亡适应】${fighter.name} 没能锁定击杀者，本次死亡没有复制到属性。`,
        {
          actorId: fighter.id,
          actorName: fighter.name,
          targetIds: [fighter.id],
        },
      );
    }

    const candidates = activePlayerCandidates(runtime, fighter);
    if (candidates.length === 0) {
      finalizeEmoteTrueDeath(runtime, fighter, '找不到任何还活着的玩家可以认主');
      return;
    }
    if (candidates.length <= 2 && resolveEmoteEndgameCheck(runtime, fighter)) {
      return;
    }

    const preferredOwner = findPreferredOwner(runtime, fighter, candidates);
    const owner = preferredOwner ?? candidates[Math.floor(Math.random() * candidates.length)];
    if (!owner) {
      finalizeEmoteTrueDeath(runtime, fighter, '认主目标丢失');
      return;
    }

    clearFamiliarMarks(runtime, fighter);
    const killsBefore = getEmoteClaimableKills(owner);
    consumeEmoteClaimableKills(owner, killsBefore);
    const ledgerText = killsBefore > 0
      ? `将其认主账本余额 ${killsBefore} -> 0`
      : '其认主账本余额本已为 0，继续作为复活锚点';
    runtime.log(
      'debuff',
      `📜 【四处认主】${fighter.name} 死亡后认 ${owner.name} 为临时主人，${ledgerText}；${owner.name} 的真实击杀统计保持不变。`,
      {
        actorId: fighter.id,
        actorName: fighter.name,
        targetIds: [owner.id],
      },
    );
    if (deathGain) {
      applyOwnerBonus(runtime, fighter, owner, deathGain);
    } else {
      runtime.log(
        'info',
        `📜 【认主补偿】${fighter.name} 本次没有锁定击杀者，${owner.name} 不获得临时属性补偿。`,
        {
          actorId: fighter.id,
          actorName: fighter.name,
          targetIds: [owner.id],
        },
      );
    }

    fighter.emoteReviveTurns = EMOTE_DEATH_REVIVE_TICKS;
    fighter.emoteReviveAppliedTurn = runtime.turnCount;
    runtime.log(
      'info',
      `🧿 【认主倒计时】${fighter.name} 暂未真正退场：5 次回合末结算后若场上仍有认主账本余额为 0 的玩家且存活玩家数大于 2，就会复活；若只剩 2 名玩家且仍有这种锚点，则可触发一次最终认主挑战。`,
      {
        actorId: fighter.id,
        actorName: fighter.name,
        targetIds: [fighter.id],
      },
    );
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
