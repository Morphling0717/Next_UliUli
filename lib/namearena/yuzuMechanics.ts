import type { Fighter, StatusEntry } from './types';
import { isSelectableTargetFor } from './targeting';

export type YuzuWeaponId =
  | 'sword'
  | 'knife'
  | 'greatsword'
  | 'hammer'
  | 'shield'
  | 'dagger'
  | 'whip'
  | 'spear'
  | 'spoon'
  | 'scythe';

export type YuzuWeapon = {
  id: YuzuWeaponId;
  name: string;
  weight: number;
  attackMultiplier: number;
  bleedTurns?: number;
  evadeDownTurns?: number;
  defDownTurns?: number;
  shieldFromDamageRatio?: number;
};

export interface YuzuRuntime {
  fighters: Fighter[];
  turnCount: number;
  getTeamId: (fighter: Fighter) => string;
  isActiveCombatant: (fighter: Fighter) => boolean;
  log: (type: string, text: string) => void;
  syncHpPct?: (fighter: Fighter) => void;
}

export const YUZU_WEAPONS: Record<YuzuWeaponId, YuzuWeapon> = {
  sword: { id: 'sword', name: '剑', weight: 10, attackMultiplier: 1.15 },
  knife: { id: 'knife', name: '刀', weight: 10, attackMultiplier: 1.15, bleedTurns: 3 },
  greatsword: { id: 'greatsword', name: '巨剑', weight: 10, attackMultiplier: 1.35, evadeDownTurns: 2 },
  hammer: { id: 'hammer', name: '锤', weight: 10, attackMultiplier: 1.3, evadeDownTurns: 3, defDownTurns: 1 },
  shield: { id: 'shield', name: '盾牌', weight: 10, attackMultiplier: 1.05, shieldFromDamageRatio: 0.75 },
  dagger: { id: 'dagger', name: '匕首', weight: 10, attackMultiplier: 1.1, bleedTurns: 2 },
  whip: { id: 'whip', name: '鞭', weight: 10, attackMultiplier: 1.3, bleedTurns: 5 },
  spear: { id: 'spear', name: '长矛', weight: 10, attackMultiplier: 1.3, evadeDownTurns: 3 },
  spoon: { id: 'spoon', name: '勺子', weight: 1, attackMultiplier: 0.7 },
  scythe: { id: 'scythe', name: '镰刀', weight: 9, attackMultiplier: 1.6, bleedTurns: 3, evadeDownTurns: 3, defDownTurns: 3 },
};

export const YUZU_PHASE_ONE_REDUCTION = 0.15;
export const YUZU_PHASE_THREE_REDUCTION = 0.15;
export const YUZU_TEAM_SHARE_RATIO = 1;
export const YUZU_OPENING_SHIELD_RATIO = 0.2;
export const YUZU_PHASE_TWO_SOLO_SHIELD_RATIO = 0.65;
export const YUZU_PHASE_TWO_TEAM_SHIELD_RATIO = 0.35;
export const YUZU_MARK_DAMAGE_BONUS = 0.2;
export const YUZU_UNMARKED_DAMAGE_PENALTY = 0.2;
export const YUZU_FURIOSO_COUNT = 9;

function scaleStat(value: number, multiplier: number, floor: number): number {
  return Math.max(floor, Math.floor(value * multiplier));
}

function rebuildYuzuPhaseTwoStats(yuzu: Fighter): void {
  yuzu.maxHp = Math.max(3000, Math.min(3500, Math.floor(yuzu.maxHp * 5.8)));
  yuzu.currentHp = yuzu.maxHp;
  yuzu.atk = scaleStat(yuzu.atk, 4.0, 175);
  yuzu.def = scaleStat(yuzu.def, 5.2, 125);
  yuzu.res = scaleStat(yuzu.res, 5.2, 125);
  yuzu.spd = scaleStat(yuzu.spd, 7.0, 115);
  yuzu.agl = scaleStat(yuzu.agl, 5.8, 105);
  yuzu.mag = scaleStat(yuzu.mag, 8.0, 60);
  yuzu.wis = scaleStat(yuzu.wis, 7.5, 150);
}

function rebuildYuzuPhaseThreeStats(yuzu: Fighter): void {
  yuzu.maxHp = Math.max(3600, Math.min(4300, Math.floor(yuzu.maxHp * 1.23)));
  yuzu.currentHp = Math.max(yuzu.currentHp, Math.floor(yuzu.maxHp * 0.72));
  yuzu.atk = scaleStat(yuzu.atk, 1.45, 255);
  yuzu.def = scaleStat(yuzu.def, 1.35, 170);
  yuzu.res = scaleStat(yuzu.res, 1.35, 170);
  yuzu.spd = scaleStat(yuzu.spd, 1.25, 145);
  yuzu.agl = scaleStat(yuzu.agl, 1.25, 130);
  yuzu.mag = scaleStat(yuzu.mag, 1.4, 95);
  yuzu.wis = scaleStat(yuzu.wis, 1.35, 220);
}

function refreshStatus(fighter: Fighter, type: string, duration: number, sourceId?: string): void {
  const existing = fighter.status.find((status) =>
    status.type === type && (!sourceId || status.sourceId === sourceId),
  );
  if (existing) {
    existing.duration = Math.max(existing.duration, duration);
    if (sourceId) existing.sourceId = sourceId;
    delete existing.appliedTurn;
    return;
  }
  fighter.status.push({ type, duration, ...(sourceId ? { sourceId } : {}) });
}

function removeStatus(fighter: Fighter, predicate: (status: StatusEntry) => boolean): void {
  fighter.status = fighter.status.filter((status) => !predicate(status));
}

function sameTeam(runtime: Pick<YuzuRuntime, 'getTeamId'>, a: Fighter, b: Fighter): boolean {
  return runtime.getTeamId(a) === runtime.getTeamId(b);
}

export function activeYuzuTeammates(runtime: YuzuRuntime, yuzu: Fighter): Fighter[] {
  return runtime.fighters.filter((fighter) =>
    fighter.id !== yuzu.id &&
    !fighter.isSummon &&
    !fighter.isNpc &&
    !fighter.cannotWin &&
    runtime.isActiveCombatant(fighter) &&
    sameTeam(runtime, yuzu, fighter),
  );
}

export function hasAnyYuzuTeammate(runtime: YuzuRuntime, yuzu: Fighter): boolean {
  return runtime.fighters.some((fighter) =>
    fighter.id !== yuzu.id &&
    !fighter.isSummon &&
    sameTeam(runtime, yuzu, fighter),
  );
}

export function activeYuzuFriendlyUnits(runtime: YuzuRuntime, yuzu: Fighter, includeSelf = true): Fighter[] {
  return runtime.fighters.filter((fighter) =>
    (includeSelf || fighter.id !== yuzu.id) &&
    !fighter.isNpc &&
    !fighter.cannotWin &&
    runtime.isActiveCombatant(fighter) &&
    sameTeam(runtime, yuzu, fighter),
  );
}

export function activeYuzuEnemies(runtime: YuzuRuntime, yuzu: Fighter): Fighter[] {
  return runtime.fighters.filter((fighter) =>
    fighter.id !== yuzu.id &&
    runtime.isActiveCombatant(fighter) &&
    !sameTeam(runtime, yuzu, fighter),
  );
}

function isYuzuMarkEligibleTarget(target: Fighter): boolean {
  if (target.isPuruisaishi || target.isOriginiumCore) return false;
  if (target.isNpc && !target.isOriginiumCrystal) return false;
  if (target.cannotWin && !target.isOriginiumCrystal) return false;
  return true;
}

function activeYuzuMarkTargets(runtime: YuzuRuntime, yuzu: Fighter): Fighter[] {
  return activeYuzuEnemies(runtime, yuzu).filter((target) =>
    isYuzuMarkEligibleTarget(target) &&
    isSelectableTargetFor(runtime, yuzu, target),
  );
}

function weightedPickWeapon(pool: YuzuWeapon[]): YuzuWeapon {
  const totalWeight = pool.reduce((sum, weapon) => sum + weapon.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const weapon of pool) {
    roll -= weapon.weight;
    if (roll <= 0) return weapon;
  }
  return pool[pool.length - 1] ?? YUZU_WEAPONS.sword;
}

export function drawYuzuWeapon(hasActiveTeammate: boolean, forcedWeapon?: YuzuWeaponId): YuzuWeapon {
  if (forcedWeapon) return YUZU_WEAPONS[forcedWeapon];
  if (hasActiveTeammate && Math.random() < 0.5) return YUZU_WEAPONS.shield;
  const pool = Object.values(YUZU_WEAPONS).filter((weapon) => weapon.id !== 'shield');
  return weightedPickWeapon(pool);
}

export function grantYuzuShield(target: Fighter, amount: number, sourceId?: string): number {
  const gained = Math.max(0, Math.floor(amount));
  if (gained <= 0) return 0;
  target.yuzuShield = Math.max(0, Math.floor(target.yuzuShield ?? 0)) + gained;
  refreshStatus(target, 'YUZU_BARRIER', 999, sourceId);
  return gained;
}

export function setYuzuShield(target: Fighter, amount: number, sourceId?: string): void {
  target.yuzuShield = Math.max(0, Math.floor(amount));
  if ((target.yuzuShield ?? 0) > 0) refreshStatus(target, 'YUZU_BARRIER', 999, sourceId);
  else clearYuzuShield(target);
}

export function clearYuzuShield(target: Fighter): void {
  target.yuzuShield = 0;
  removeStatus(target, (status) => status.type === 'YUZU_BARRIER');
}

export function consumeYuzuShield(target: Fighter, incomingAmount: number): { absorbed: number; remaining: number; broke: boolean } {
  const shield = Math.max(0, Math.floor(target.yuzuShield ?? 0));
  const incoming = Math.max(0, Math.floor(incomingAmount));
  if (shield <= 0 || incoming <= 0) return { absorbed: 0, remaining: incoming, broke: false };

  const absorbed = Math.min(shield, incoming);
  const nextShield = shield - absorbed;
  target.yuzuShield = nextShield;
  if (nextShield <= 0) clearYuzuShield(target);
  return { absorbed, remaining: incoming - absorbed, broke: shield > 0 && nextShield <= 0 };
}

export function ensureYuzuState(yuzu: Fighter): void {
  yuzu.yuzuPhase = Math.max(1, yuzu.yuzuPhase ?? 1);
  yuzu.yuzuShield = Math.max(0, Math.floor(yuzu.yuzuShield ?? 0));
  yuzu.yuzuMarkedHitCount = Math.max(0, yuzu.yuzuMarkedHitCount ?? 0);
  if (yuzu.yuzuFuriosoCountedTurn !== undefined) {
    yuzu.yuzuFuriosoCountedTurn = Math.floor(yuzu.yuzuFuriosoCountedTurn);
  }
  yuzu.yuzuFuriosoReady = !!yuzu.yuzuFuriosoReady;
}

export function ensureYuzuOpeningShield(runtime: YuzuRuntime, yuzu: Fighter): boolean {
  if (!yuzu.isYuzu || yuzu.yuzuOpeningShieldApplied) return false;
  ensureYuzuState(yuzu);
  yuzu.yuzuOpeningShieldApplied = true;

  const targets = activeYuzuFriendlyUnits(runtime, yuzu, true);
  if (targets.length === 0) return false;
  const shield = Math.max(1, Math.floor(yuzu.maxHp * YUZU_OPENING_SHIELD_RATIO));
  targets.forEach((target) => grantYuzuShield(target, shield, yuzu.id));
  runtime.log('buff', `🪞 【镜界开幕】${yuzu.name} 让镜世界展开，${targets.map((target) => target.name).join('、')} 获得 ${shield} 点镜界护盾。`);
  return true;
}

export function enterYuzuPhaseTwo(runtime: YuzuRuntime, yuzu: Fighter, reason: string): boolean {
  ensureYuzuState(yuzu);
  if (!yuzu.isYuzu || (yuzu.yuzuPhase ?? 1) >= 2 || !runtime.isActiveCombatant(yuzu)) return false;

  yuzu.yuzuPhase = 2;
  rebuildYuzuPhaseTwoStats(yuzu);
  runtime.syncHpPct?.(yuzu);
  const teamMode = activeYuzuTeammates(runtime, yuzu).length > 0;
  const targets = teamMode ? activeYuzuFriendlyUnits(runtime, yuzu, true) : [yuzu];
  const shieldRatio = teamMode ? YUZU_PHASE_TWO_TEAM_SHIELD_RATIO : YUZU_PHASE_TWO_SOLO_SHIELD_RATIO;
  const shield = Math.max(1, Math.floor(yuzu.maxHp * shieldRatio));
  targets.forEach((target) => grantYuzuShield(target, shield, yuzu.id));
  runtime.log('transform', `🪞 【一码归一码】${yuzu.name} ${reason}，进入二阶段：镜界肉体完成重构，生命恢复至 ${yuzu.currentHp}/${yuzu.maxHp}，${teamMode ? '为全体友方' : '为自己'}施加 ${shield} 点镜界护盾。`);
  return true;
}

export function clearYuzuMark(runtime: YuzuRuntime, yuzu: Fighter): void {
  runtime.fighters.forEach((fighter) => {
    fighter.status = fighter.status.filter((status) =>
      !(status.type === 'YUZU_MARKED' && status.sourceId === yuzu.id),
    );
  });
  yuzu.yuzuMarkedTargetId = undefined;
}

export function enterYuzuPhaseThree(runtime: YuzuRuntime, yuzu: Fighter, reason: string): boolean {
  ensureYuzuState(yuzu);
  if (!yuzu.isYuzu || (yuzu.yuzuPhase ?? 1) >= 3 || !runtime.isActiveCombatant(yuzu)) return false;

  yuzu.yuzuPhase = 3;
  rebuildYuzuPhaseThreeStats(yuzu);
  yuzu.yuzuMarkedHitCount = 0;
  yuzu.yuzuFuriosoCountedTurn = undefined;
  yuzu.yuzuFuriosoReady = false;
  removeStatus(yuzu, (status) => status.type === 'YUZU_TAUNT');
  runtime.syncHpPct?.(yuzu);
  runtime.log('transform', `🪞 【苦痛啊，你是我的唯一】${yuzu.name} ${reason}，进入三阶段：属性再次重构，生命稳定在 ${yuzu.currentHp}/${yuzu.maxHp}，镜界开始定制唯一目标。`);
  ensureYuzuMarkedTarget(runtime, yuzu);
  return true;
}

export function tryAdvanceYuzuPhaseByHp(runtime: YuzuRuntime, yuzu: Fighter): boolean {
  if (!yuzu.isYuzu || !runtime.isActiveCombatant(yuzu)) return false;
  ensureYuzuState(yuzu);
  if ((yuzu.yuzuPhase ?? 1) === 1 && yuzu.currentHp <= yuzu.maxHp * 0.7) {
    return enterYuzuPhaseTwo(runtime, yuzu, '血量跌破 70%');
  }
  return false;
}

export function tryAdvanceYuzuPhaseByTeamLoss(runtime: YuzuRuntime, yuzu: Fighter): boolean {
  if (!yuzu.isYuzu || !runtime.isActiveCombatant(yuzu)) return false;
  ensureYuzuState(yuzu);
  const phase = yuzu.yuzuPhase ?? 1;
  if (phase >= 3) return false;
  if (!hasAnyYuzuTeammate(runtime, yuzu)) return false;
  if (activeYuzuTeammates(runtime, yuzu).length > 0) return false;
  if (phase < 2) {
    const enteredPhaseTwo = enterYuzuPhaseTwo(runtime, yuzu, '队友全部阵亡，镜界被迫提前重构');
    if (!enteredPhaseTwo && (yuzu.yuzuPhase ?? 1) < 2) return false;
  }
  return enterYuzuPhaseThree(runtime, yuzu, '队友全部阵亡');
}

export function ensureYuzuMarkedTarget(runtime: YuzuRuntime, yuzu: Fighter): Fighter | undefined {
  if (!yuzu.isYuzu || (yuzu.yuzuPhase ?? 1) < 3 || !runtime.isActiveCombatant(yuzu)) return undefined;

  const current = yuzu.yuzuMarkedTargetId
    ? runtime.fighters.find((fighter) =>
      fighter.id === yuzu.yuzuMarkedTargetId &&
      runtime.isActiveCombatant(fighter) &&
      isYuzuMarkEligibleTarget(fighter) &&
      isSelectableTargetFor(runtime, yuzu, fighter) &&
      !sameTeam(runtime, yuzu, fighter),
    )
    : undefined;
  if (current) {
    refreshStatus(current, 'YUZU_MARKED', 999, yuzu.id);
    return current;
  }

  clearYuzuMark(runtime, yuzu);
  const enemies = activeYuzuMarkTargets(runtime, yuzu);
  const target = enemies[Math.floor(Math.random() * enemies.length)];
  if (!target) return undefined;
  yuzu.yuzuMarkedTargetId = target.id;
  refreshStatus(target, 'YUZU_MARKED', 999, yuzu.id);
  runtime.log('debuff', `🎯 【镜界标记】${yuzu.name} 将 ${target.name} 定制为唯一目标。`);
  return target;
}

export function registerYuzuMarkedSkill(runtime: YuzuRuntime, yuzu: Fighter, target: Fighter): void {
  if (!yuzu.isYuzu || (yuzu.yuzuPhase ?? 1) < 3 || yuzu.yuzuMarkedTargetId !== target.id) return;
  if (yuzu.yuzuFuriosoCountedTurn === runtime.turnCount) return;
  yuzu.yuzuFuriosoCountedTurn = runtime.turnCount;
  yuzu.yuzuMarkedHitCount = Math.min(YUZU_FURIOSO_COUNT, (yuzu.yuzuMarkedHitCount ?? 0) + 1);
  if ((yuzu.yuzuMarkedHitCount ?? 0) >= YUZU_FURIOSO_COUNT && !yuzu.yuzuFuriosoReady) {
    yuzu.yuzuFuriosoReady = true;
    runtime.log('buff', `🪞 【Furioso-Replica】${yuzu.name} 已用三阶段技能命中定制目标 ${YUZU_FURIOSO_COUNT} 次，终幕复写准备完成。`);
  }
}

export function applyYuzuWeaponEffects(runtime: YuzuRuntime, user: Fighter, target: Fighter, weapon: YuzuWeapon, actualDamage: number): void {
  if (actualDamage <= 0) return;

  if (weapon.bleedTurns) refreshStatus(target, 'BLEED', weapon.bleedTurns, user.id);
  if (weapon.evadeDownTurns) refreshStatus(target, 'YUZU_EVADE_DOWN', weapon.evadeDownTurns, user.id);
  if (weapon.defDownTurns) refreshStatus(target, 'YUZU_DEF_DOWN', weapon.defDownTurns, user.id);

  if (weapon.shieldFromDamageRatio) {
    refreshStatus(user, 'YUZU_TAUNT', 2, user.id);
    const shieldAmount = Math.max(1, Math.floor(actualDamage * weapon.shieldFromDamageRatio));
    const targets = activeYuzuFriendlyUnits(runtime, user, true);
    targets.forEach((ally) => grantYuzuShield(ally, shieldAmount, user.id));
    runtime.log('buff', `🛡️ 【盾牌】${user.name} 把 ${actualDamage} 点命中伤害折成镜界护盾，${targets.map((ally) => ally.name).join('、')} 获得 ${shieldAmount} 点护盾，并把嘲讽拉满。`);
  }

  if (weapon.bleedTurns || weapon.evadeDownTurns || weapon.defDownTurns) {
    const effects = [
      weapon.bleedTurns ? `${weapon.bleedTurns} 回合流血` : '',
      weapon.evadeDownTurns ? `${weapon.evadeDownTurns} 回合闪避破坏` : '',
      weapon.defDownTurns ? `${weapon.defDownTurns} 回合防御破坏` : '',
    ].filter(Boolean).join('、');
    runtime.log('debuff', `🪞 【${weapon.name}】${target.name} 被附加${effects}。`);
  }
}

export function yuzuWeaponSummary(weapon: YuzuWeapon): string {
  const pct = Math.round((weapon.attackMultiplier - 1) * 100);
  return pct >= 0 ? `${weapon.name}（伤害+${pct}%）` : `${weapon.name}（伤害${pct}%）`;
}
