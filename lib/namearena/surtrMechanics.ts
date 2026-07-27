import type { BattleLogMetadata, DefeatOptions, Fighter, SurtrAffiliationMode, SurtrState } from './types';

export const SURTR_BASE_STATS = {
  hp: 2800,
  atk: 180,
  def: 150,
  spd: 140,
  agl: 130,
  mag: 190,
  res: 150,
  wis: 160,
} as const;

export const SURTR_MAGIC_RESISTANCE_PENETRATION = 26;
export const SURTR_TWILIGHT_MAX_HP_GAIN = 5000;
export const SURTR_AFTERGLOW_OPPORTUNITIES = 8;
export const SURTR_AFTERGLOW_SPEED_GAIN = 20;
export const SURTR_CONFLICT_TEAM_PREFIX = 'SURTR_CONFLICT:';
export const SURTR_LEGACY_TEAM_PREFIX = 'SURTR_LEGACY:';

type SurtrRelationRuntime = {
  fighters: Fighter[];
  getTeamId: (fighter: Fighter) => string;
  isActiveCombatant: (fighter: Fighter) => boolean;
};

export interface SurtrLifecycleRuntime extends SurtrRelationRuntime {
  turnCount: number;
  syncHpPct: (fighter: Fighter) => void;
  markDefeated: (target: Fighter, options?: DefeatOptions) => boolean;
  log: (type: string, text: string, metadata?: BattleLogMetadata) => void;
}

export interface SurtrTributeGroup {
  owl: Fighter;
  swire: Fighter;
  specter: Fighter;
}

function isCompetingUnit(fighter: Fighter, runtime: SurtrRelationRuntime): boolean {
  return !fighter.isSurtr &&
    !fighter.isNpc &&
    !fighter.cannotWin &&
    runtime.isActiveCombatant(fighter);
}

function sideHasCompetitiveUnit(
  runtime: SurtrRelationRuntime,
  teamId: string | undefined,
): boolean {
  if (!teamId) return false;
  return runtime.fighters.some((fighter) =>
    isCompetingUnit(fighter, runtime) &&
    runtime.getTeamId(fighter) === teamId,
  );
}

export function getSurtrOwner(fighters: readonly Fighter[], ownerId: string | undefined): Fighter | undefined {
  return ownerId ? fighters.find((fighter) => fighter.id === ownerId) : undefined;
}

export function isSurtrOwnedBy(surtr: Fighter, owner: Fighter): boolean {
  const state = surtr.surtrState;
  if (!surtr.isSurtr || !state || state.ownershipSuspended) return false;
  return state.primaryOwnerId === owner.id || state.owlOwnerId === owner.id;
}

export function getSurtrOwnerSideState(
  runtime: SurtrRelationRuntime,
  surtr: Fighter,
): {
  primaryAlive: boolean;
  owlAlive: boolean;
  sameTeam: boolean;
  conflict: boolean;
  legacy: boolean;
} {
  const state = surtr.surtrState;
  if (!state || state.ownershipSuspended) {
    return { primaryAlive: false, owlAlive: false, sameTeam: true, conflict: false, legacy: false };
  }
  const sameTeam = !state.owlOwnerTeamId || state.primaryOwnerTeamId === state.owlOwnerTeamId;
  const primaryAlive = sideHasCompetitiveUnit(runtime, state.primaryOwnerTeamId);
  const owlAlive = sameTeam
    ? primaryAlive
    : sideHasCompetitiveUnit(runtime, state.owlOwnerTeamId);
  return {
    primaryAlive,
    owlAlive,
    sameTeam,
    conflict: !sameTeam && primaryAlive && owlAlive,
    legacy: !sameTeam && !primaryAlive && !owlAlive,
  };
}

export function getSurtrAffiliationMode(
  runtime: SurtrRelationRuntime,
  surtr: Fighter,
): SurtrAffiliationMode {
  const state = surtr.surtrState;
  if (!state || state.ownershipSuspended) return 'suspended';
  const side = getSurtrOwnerSideState(runtime, surtr);
  if (side.sameTeam) return 'same_team';
  if (side.conflict) return 'conflict';
  if (side.primaryAlive) return 'primary_side';
  if (side.owlAlive) return 'owl_side';
  return 'legacy';
}

export function syncSurtrAffiliation(
  runtime: SurtrRelationRuntime & Pick<SurtrLifecycleRuntime, 'log'>,
  surtr: Fighter,
  options: { announceInitial?: boolean; resetBaseline?: boolean } = {},
): void {
  const state = surtr.surtrState;
  if (!surtr.isSurtr || !state || surtr.isDead || surtr.isDeadAnnounced) return;
  const mode = getSurtrAffiliationMode(runtime, surtr);
  const previous = options.resetBaseline ? undefined : state.lastAffiliationMode;
  state.lastAffiliationMode = mode;
  if (mode === 'suspended') return;
  if (previous === mode && !options.announceInitial) return;
  if (previous === undefined && !options.announceInitial) return;

  const primary = getSurtrOwner(runtime.fighters, state.primaryOwnerId);
  const owl = getSurtrOwner(runtime.fighters, state.owlOwnerId);
  const primaryName = primary?.name ?? '主要主人';
  const owlName = owl?.name ?? '共同主人';
  const targetIds = [primary?.id, owl?.id].filter((id): id is string => !!id);
  const initialPrefix = previous === undefined ? '共同主人关系初始化' : '共同主人关系变化';
  const text = mode === 'same_team'
    ? `🔥 【${initialPrefix}】${surtr.name} 的两名主人 ${primaryName} 与 ${owlName} 属于同一阵营；史尔特尔归入该阵营，并把阵营成员视为友方。`
    : mode === 'conflict'
      ? `🔥 【${initialPrefix}】${primaryName} 与 ${owlName} 所属阵营都仍有竞争资格，${surtr.name} 进入共同主人冲突：只豁免两名主人本人，双方其他成员仍可互相成为目标。`
      : mode === 'primary_side'
        ? `🔥 【${initialPrefix}】${owlName} 一方已失去竞争资格，${surtr.name} 结束共同主人冲突并归入 ${primaryName} 一方；该方全体单位恢复为友方。`
        : mode === 'owl_side'
          ? `🔥 【${initialPrefix}】${primaryName} 一方已失去竞争资格，${surtr.name} 结束共同主人冲突并归入 ${owlName} 一方；该方全体单位恢复为友方。`
          : `🔥 【${initialPrefix}】${primaryName} 与 ${owlName} 两方都已失去竞争资格，${surtr.name} 成为两名主人的共同遗产；若独自存活到最后，将为双方结算共同胜利。`;
  runtime.log('info', text, {
    actorId: surtr.id,
    actorName: surtr.name,
    targetIds,
  });
}

export function getSurtrResolvedTeamId(
  runtime: SurtrRelationRuntime,
  surtr: Fighter,
): string {
  const state = surtr.surtrState;
  if (!state || state.ownershipSuspended) {
    return surtr.teamId ?? surtr.summonerId ?? surtr.id;
  }
  const side = getSurtrOwnerSideState(runtime, surtr);
  if (side.sameTeam) return state.primaryOwnerTeamId;
  if (side.conflict) return `${SURTR_CONFLICT_TEAM_PREFIX}${surtr.id}`;
  if (side.primaryAlive) return state.primaryOwnerTeamId;
  if (side.owlAlive && state.owlOwnerTeamId) return state.owlOwnerTeamId;
  return `${SURTR_LEGACY_TEAM_PREFIX}${state.primaryOwnerId}:${state.owlOwnerId ?? 'none'}`;
}

export function isSurtrJointConflict(runtime: SurtrRelationRuntime, surtr: Fighter): boolean {
  return !!surtr.isSurtr && getSurtrOwnerSideState(runtime, surtr).conflict;
}

export function isSurtrJointLegacy(runtime: SurtrRelationRuntime, surtr: Fighter): boolean {
  return !!surtr.isSurtr && getSurtrOwnerSideState(runtime, surtr).legacy;
}

export function getSurtrWinnerOwnerNames(runtime: SurtrRelationRuntime, surtr: Fighter): string[] {
  const state = surtr.surtrState;
  if (!state) return [surtr.name];
  const side = getSurtrOwnerSideState(runtime, surtr);
  const primary = getSurtrOwner(runtime.fighters, state.primaryOwnerId);
  const owl = getSurtrOwner(runtime.fighters, state.owlOwnerId);
  if (side.legacy || side.sameTeam) {
    return [primary?.name, owl?.name].filter((name): name is string => !!name);
  }
  if (side.owlAlive) return owl ? [owl.name] : [surtr.name];
  return primary ? [primary.name] : [surtr.name];
}

export function findSurtrTributeGroups(
  runtime: Pick<SurtrRelationRuntime, 'fighters' | 'isActiveCombatant'>,
): SurtrTributeGroup[] {
  return runtime.fighters
    .filter((fighter) => fighter.isOwl)
    .flatMap((owl) => {
      const owlSummons = runtime.fighters.filter((fighter) =>
        fighter.isSummon &&
        fighter.summonerId === owl.id &&
        fighter.yuzuProphetControlState?.disposition !== 'controlled' &&
        runtime.isActiveCombatant(fighter),
      );
      const swire = owlSummons.find((fighter) => fighter.owlSummonState?.kind === 'swire');
      const specter = owlSummons.find((fighter) => fighter.owlSummonState?.kind === 'specter');
      return swire && specter ? [{ owl, swire, specter }] : [];
    });
}

export function pickSurtrTributeGroup(
  runtime: Pick<SurtrRelationRuntime, 'fighters' | 'isActiveCombatant'>,
): SurtrTributeGroup | undefined {
  const groups = findSurtrTributeGroups(runtime);
  return groups.length > 0 ? groups[Math.floor(Math.random() * groups.length)] : undefined;
}

export function initializeSurtrState(
  primaryOwner: Fighter,
  primaryOwnerTeamId: string,
  owlOwner: Fighter,
  owlOwnerTeamId: string,
): SurtrState {
  return {
    primaryOwnerId: primaryOwner.id,
    primaryOwnerTeamId,
    owlOwnerId: owlOwner.id,
    owlOwnerTeamId,
    twilightUsed: false,
    twilightDrainOpportunities: 0,
    afterglowActive: false,
    afterglowOpportunities: 0,
    actualKills: 0,
    lastAffiliationMode: primaryOwnerTeamId === owlOwnerTeamId ? 'same_team' : 'conflict',
  };
}

export function isSurtrAfterglowActive(fighter: Fighter): boolean {
  return !!fighter.isSurtr && !!fighter.surtrState?.afterglowActive;
}

export function getSurtrDisplayHp(fighter: Fighter): number {
  return isSurtrAfterglowActive(fighter) ? 0 : Math.max(0, fighter.currentHp);
}

export function getSurtrTacticalHpPct(fighter: Fighter): number {
  return isSurtrAfterglowActive(fighter) ? 1 : fighter.hpPct;
}

export function getSurtrTacticalCurrentHp(fighter: Fighter): number {
  return isSurtrAfterglowActive(fighter) ? fighter.maxHp : fighter.currentHp;
}

export function awardSurtrJointKill(
  runtime: Pick<SurtrLifecycleRuntime, 'fighters' | 'log'>,
  surtr: Fighter,
  defeated: Fighter,
): boolean {
  const state = surtr.surtrState;
  if (!surtr.isSurtr || !state || state.ownershipSuspended) return false;
  state.actualKills += 1;
  const primary = getSurtrOwner(runtime.fighters, state.primaryOwnerId);
  const owl = getSurtrOwner(runtime.fighters, state.owlOwnerId);
  if (primary) primary.stats.kills += 0.5;
  if (owl) owl.stats.kills += 0.5;
  runtime.log(
    'buff',
    `🔥 【共同击杀分账】${surtr.name} 的本次击杀只对应刚才的 1 次死亡结算；${primary?.name ?? '主要主人'} +0.5，${owl?.name ?? '共同主人'} +0.5（史尔特尔实际击杀 ${state.actualKills}）。`,
    {
      actorId: surtr.id,
      actorName: surtr.name,
      targetIds: [defeated.id],
    },
  );
  return true;
}

export function enterSurtrAfterglow(
  runtime: Pick<SurtrLifecycleRuntime, 'turnCount' | 'syncHpPct' | 'log'>,
  surtr: Fighter,
  source?: Fighter,
): boolean {
  const state = surtr.surtrState;
  if (!surtr.isSurtr || !state || state.afterglowActive || surtr.isDead || surtr.isDeadAnnounced) return false;

  state.afterglowActive = true;
  state.afterglowEnteredTurn = runtime.turnCount;
  state.afterglowOpportunities = 0;
  if (source && source.id !== surtr.id) {
    state.zeroedById = source.id;
    state.zeroedByName = source.name;
  } else {
    delete state.zeroedById;
    delete state.zeroedByName;
  }
  surtr.spd += SURTR_AFTERGLOW_SPEED_GAIN;
  // Keep one internal HP point so the shared turn scheduler continues to treat
  // Surtr as active. Presentation and hpPct remain at zero.
  surtr.currentHp = 1;
  runtime.syncHpPct(surtr);
  const sourceText = state.zeroedByName
    ? `最初归零来源记录为 ${state.zeroedByName}`
    : '本次归零没有可归属的攻击者';
  runtime.log(
    'crit',
    `🌇 【黄昏余命】${surtr.name} 的生命降至 0，但莱万汀仍未熄灭！${sourceText}；速度 +${SURTR_AFTERGLOW_SPEED_GAIN}，将在之后第 ${SURTR_AFTERGLOW_OPPORTUNITIES} 次自身行动机会结束时真正死亡。`,
    { actorId: surtr.id, actorName: surtr.name, targetIds: [surtr.id] },
  );
  return true;
}

function settleSurtrTwilightDrain(runtime: SurtrLifecycleRuntime, surtr: Fighter): void {
  const state = surtr.surtrState;
  if (!state?.twilightUsed || state.afterglowActive || state.twilightActivatedTurn === runtime.turnCount) return;

  state.twilightDrainOpportunities += 1;
  const pct = Math.min(20, state.twilightDrainOpportunities);
  const loss = Math.max(1, Math.floor(surtr.maxHp * pct / 100));
  const before = surtr.currentHp;
  surtr.currentHp = Math.max(0, before - loss);
  runtime.syncHpPct(surtr);
  runtime.log(
    'debuff',
    `🌇 【黄昏流失 ${state.twilightDrainOpportunities}】${surtr.name} 在本次自身行动机会结束时流失最大生命的 ${pct}%（${loss} 点），生命 ${before} -> ${Math.max(0, surtr.currentHp)}。`,
    { actorId: surtr.id, actorName: surtr.name, targetIds: [surtr.id] },
  );
  if (surtr.currentHp <= 0) enterSurtrAfterglow(runtime, surtr);
}

function settleSurtrAfterglow(runtime: SurtrLifecycleRuntime, surtr: Fighter): void {
  const state = surtr.surtrState;
  if (!state?.afterglowActive || state.afterglowEnteredTurn === runtime.turnCount) return;

  state.afterglowOpportunities += 1;
  runtime.log(
    state.afterglowOpportunities >= SURTR_AFTERGLOW_OPPORTUNITIES ? 'crit' : 'info',
    `🌇 【黄昏余命】${surtr.name} 完成第 ${state.afterglowOpportunities}/${SURTR_AFTERGLOW_OPPORTUNITIES} 次余命行动机会。`,
    { actorId: surtr.id, actorName: surtr.name, targetIds: [surtr.id] },
  );
  if (state.afterglowOpportunities < SURTR_AFTERGLOW_OPPORTUNITIES) return;

  const killer = getSurtrOwner(runtime.fighters, state.zeroedById);
  runtime.markDefeated(surtr, {
    message: killer
      ? `💀 【黄昏尽头】${surtr.name} 的八次余命耗尽，最初将其生命压至 0 的 ${killer.name} 获得最终击杀！`
      : `💀 【黄昏尽头】${surtr.name} 的八次余命耗尽，莱万汀彻底熄灭；本次死亡没有击杀者。`,
    killer,
    bypassSurtrAfterglow: true,
    bypassDeathSaves: true,
  });
}

export function settleSurtrScheduledOpportunity(
  runtime: SurtrLifecycleRuntime,
  surtr: Fighter,
): void {
  if (!surtr.isSurtr || !surtr.surtrState || surtr.isDead || surtr.isDeadAnnounced) return;
  if (surtr.surtrState.afterglowActive) {
    settleSurtrAfterglow(runtime, surtr);
    return;
  }
  settleSurtrTwilightDrain(runtime, surtr);
}
