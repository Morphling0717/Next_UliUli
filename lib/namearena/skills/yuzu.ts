import type { DamageApplicationOptions, Fighter, SkillContext, SkillDefinition } from '../types';
import { namerenaData as Data } from '../data';
import {
  activeYuzuTeammates,
  applyYuzuWeaponEffects,
  drawYuzuWeapon,
  ensureYuzuMarkedTarget,
  registerYuzuMarkedSkill,
  YUZU_MARK_DAMAGE_BONUS,
  YUZU_UNMARKED_DAMAGE_PENALTY,
  YUZU_WEAPONS,
  type YuzuRuntime,
  type YuzuWeaponId,
  yuzuWeaponSummary,
} from '../yuzuMechanics';
import { isSelectableTargetFor } from '../targeting';

const { SKILL_TAGS } = Data;

const YUZU_PHASE_TWO_DAMAGE_SCALE = 0.9;
const YUZU_PHASE_THREE_DAMAGE_SCALE = 0.74;
const YUZU_FURIOSO_DAMAGE_SCALE = 0.7;
const YUZU_MARKED_MAX_HP_FLOOR_RATIO = 0.022;
const YUZU_MARKED_ATK_FLOOR_RATIO = 0.18;
const YUZU_FURIOSO_ATK_FLOOR_RATIO = 1.05;
const YUZU_FURIOSO_WIS_FLOOR_RATIO = 0.3;

type YuzuAttackPlan = {
  actionName: string;
  quote: string;
  hits: number;
  preferredWeapon?: YuzuWeaponId;
  preferredBonus?: number;
  damageBonus?: number;
  group?: boolean;
  furioso?: boolean;
  applyRandomDebuff?: boolean;
};

function isActive(fighter: Fighter): boolean {
  return !fighter.isDead && !fighter.isDeadAnnounced && fighter.currentHp > 0;
}

function yuzuRuntime(ctx: SkillContext): YuzuRuntime {
  return {
    fighters: ctx.fighters,
    turnCount: ctx.turnCount,
    getTeamId: ctx.getTeamId,
    isActiveCombatant: isActive,
    log: ctx.log,
  };
}

function enemyTargets(ctx: SkillContext): Fighter[] {
  return ctx.fighters.filter((fighter) =>
    isSelectableTargetFor(yuzuRuntime(ctx), ctx.user, fighter),
  );
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

function chooseYuzuTarget(ctx: SkillContext, plan: YuzuAttackPlan): Fighter | undefined {
  const runtime = yuzuRuntime(ctx);
  if ((ctx.user.yuzuPhase ?? 1) >= 3 && !plan.group) {
    const marked = ensureYuzuMarkedTarget(runtime, ctx.user);
    if (marked && isActive(marked)) return marked;
  }

  if (plan.group) {
    const targets = enemyTargets(ctx);
    return targets[Math.floor(Math.random() * targets.length)];
  }

  if (ctx.target && isActive(ctx.target) && ctx.getTeamId(ctx.target) !== ctx.getTeamId(ctx.user)) {
    return ctx.target;
  }
  const targets = enemyTargets(ctx);
  return targets[Math.floor(Math.random() * targets.length)];
}

function applyRandomYuzuDebuff(ctx: SkillContext, target: Fighter): void {
  const pool = [
    ['YUZU_SLOW', 2, '减速'],
    ['BLIND', 2, '命中率下降'],
    ['YUZU_EVADE_DOWN', 2, '闪避率下降'],
    ['YUZU_ATK_DOWN', 2, '攻击力下降'],
    ['YUZU_DEF_DOWN', 2, '防御力下降'],
    ['YUZU_RES_DOWN', 2, '魔抗下降'],
    ['BLEED', 3, '一层流血'],
  ] as const;
  const [status, duration, label] = pool[Math.floor(Math.random() * pool.length)] ?? pool[0];
  refreshStatus(target, status, duration, ctx.user.id);
  ctx.log('debuff', `🪞 【地狱刑具】${target.name} 被追加 ${label}。`);
}

function resolveYuzuAttackGuards(ctx: SkillContext, target: Fighter, actionName: string): boolean {
  if (!isActive(ctx.user) || !isActive(target)) return false;
  if (ctx.handleWaitCounter?.(target, ctx.user, actionName)) return false;
  const interruptedByCounter = ctx.handleCounterStatus?.(target, ctx.user) ?? false;
  return !interruptedByCounter && isActive(ctx.user);
}

function calculateYuzuHitDamage(ctx: SkillContext, target: Fighter, plan: YuzuAttackPlan, weaponId?: YuzuWeaponId): { amount: number; weaponName: string } {
  const runtime = yuzuRuntime(ctx);
  const hasTeammate = activeYuzuTeammates(runtime, ctx.user).length > 0;
  const weapon = drawYuzuWeapon(hasTeammate, weaponId);
  ctx.user.yuzuLastWeapon = weapon.name;

  const baseRoll = 0.9 + Math.random() * 0.2;
  const raw = ctx.user.atk * 0.86 + ctx.user.wis * 0.1 + ctx.user.maxHp * 0.016;
  const defended = Math.max(1, raw * baseRoll - target.def * 0.28);
  const preferredBonus = plan.preferredWeapon === weapon.id ? (plan.preferredBonus ?? 0) : 0;
  let multiplier = weapon.attackMultiplier * (1 + (plan.damageBonus ?? 0) + preferredBonus);
  let isMarkedPhaseThreeTarget = false;

  if ((ctx.user.yuzuPhase ?? 1) >= 3) {
    const markedTargetId = ensureYuzuMarkedTarget(runtime, ctx.user)?.id;
    isMarkedPhaseThreeTarget = !!markedTargetId && target.id === markedTargetId;
    if (isMarkedPhaseThreeTarget) multiplier *= (1 + YUZU_MARK_DAMAGE_BONUS);
    else multiplier *= (1 - YUZU_UNMARKED_DAMAGE_PENALTY);
  }
  if ((ctx.user.yuzuPhase ?? 1) === 2) multiplier *= YUZU_PHASE_TWO_DAMAGE_SCALE;
  if ((ctx.user.yuzuPhase ?? 1) >= 3) multiplier *= plan.furioso ? YUZU_FURIOSO_DAMAGE_SCALE : YUZU_PHASE_THREE_DAMAGE_SCALE;

  let amount = Math.max(1, Math.floor(defended * multiplier));
  if (isMarkedPhaseThreeTarget) {
    if (plan.furioso) {
      const selfStatFloor = ctx.user.atk * YUZU_FURIOSO_ATK_FLOOR_RATIO + ctx.user.wis * YUZU_FURIOSO_WIS_FLOOR_RATIO;
      amount = Math.max(amount, Math.floor(selfStatFloor));
    } else {
      const maxHpFloor = target.maxHp * YUZU_MARKED_MAX_HP_FLOOR_RATIO;
      const statFloor = ctx.user.atk * YUZU_MARKED_ATK_FLOOR_RATIO;
      amount = Math.max(amount, Math.floor(maxHpFloor + statFloor));
    }
  }

  return {
    amount,
    weaponName: yuzuWeaponSummary(weapon),
  };
}

type YuzuHitResult = {
  canContinue: boolean;
  hitMarkedTarget: boolean;
};

function isCurrentMarkedTarget(ctx: SkillContext, target: Fighter): boolean {
  return (ctx.user.yuzuPhase ?? 1) >= 3 && ctx.user.yuzuMarkedTargetId === target.id;
}

function executeYuzuHit(ctx: SkillContext, target: Fighter, plan: YuzuAttackPlan, index: number, forcedWeapon?: YuzuWeaponId): YuzuHitResult {
  if (!resolveYuzuAttackGuards(ctx, target, plan.actionName)) {
    return { canContinue: false, hitMarkedTarget: false };
  }

  const { amount, weaponName } = calculateYuzuHitDamage(ctx, target, plan, forcedWeapon);
  const weapon = forcedWeapon ? YUZU_WEAPONS[forcedWeapon] : Object.values(YUZU_WEAPONS).find((candidate) => weaponName.startsWith(candidate.name)) ?? YUZU_WEAPONS.sword;
  const options: DamageApplicationOptions = {
    actionName: plan.actionName,
    respectDefenses: true,
  };
  const actual = ctx.applyDamage(target, amount, 'skill', false, ctx.user, options);
  const redirected = !!options.redirectedByJoker;
  if (actual > 0) ctx.user.stats.dmgDealt += actual;

  const hitLabel = `${index + 1}/${plan.hits}`;
  if (redirected) {
    ctx.log('skill', `🪞 【${plan.actionName}】第 ${hitLabel} 击抽到 ${weaponName}，刀路被随机恶作剧带偏，原目标实际造成 ${actual} 点伤害。`);
  } else {
    ctx.log(actual > 0 ? 'skill' : 'info', `🪞 【${plan.actionName}】第 ${hitLabel} 击抽到 ${weaponName}，命中 ${target.name}，实际造成 ${actual} 点伤害。`);
  }
  if (actual > 0) ctx.flushDeferredDamageEvents?.();

  if (actual > 0 && !redirected) {
    applyYuzuWeaponEffects(yuzuRuntime(ctx), ctx.user, target, weapon, actual);
    if (plan.applyRandomDebuff) applyRandomYuzuDebuff(ctx, target);
  }

  if (!redirected && target.currentHp <= 0 && !target.isDead && !target.isDeadAnnounced) {
    ctx.markDefeated(target, {
      message: `💀 【${plan.actionName}】${target.name} 被 ${ctx.user.name} 的镜界武器处刑！`,
      killer: ctx.user,
    });
  }
  return {
    canContinue: isActive(ctx.user),
    hitMarkedTarget: actual > 0 && !redirected && isCurrentMarkedTarget(ctx, target),
  };
}

function executeYuzuAttackPlan(ctx: SkillContext, plan: YuzuAttackPlan): boolean {
  ctx.log('skill', `🪞 【${plan.actionName}】${ctx.user.name}：${plan.quote}`);
  let markedTargetHitThisSkill: Fighter | undefined;

  const registerMarkedSkillIfNeeded = () => {
    if (plan.furioso || !markedTargetHitThisSkill) return;
    registerYuzuMarkedSkill(yuzuRuntime(ctx), ctx.user, markedTargetHitThisSkill);
  };

  for (let i = 0; i < plan.hits; i += 1) {
    const target = chooseYuzuTarget(ctx, plan);
    if (!target) {
      ctx.log('info', `🪞 【${plan.actionName}】镜界里已经找不到可以处刑的目标。`);
      registerMarkedSkillIfNeeded();
      return true;
    }
    const forcedWeapon = plan.furioso && i === plan.hits - 1 ? 'scythe' : undefined;
    const hitResult = executeYuzuHit(ctx, target, plan, i, forcedWeapon);
    if (hitResult.hitMarkedTarget) markedTargetHitThisSkill = target;
    if (!hitResult.canContinue) {
      registerMarkedSkillIfNeeded();
      return true;
    }
  }

  registerMarkedSkillIfNeeded();

  if (plan.furioso) {
    ctx.user.yuzuMarkedHitCount = 0;
    ctx.user.yuzuFuriosoReady = false;
    ctx.log('info', `🪞 【Furioso-Replica】${ctx.user.name} 的终幕复写结束，镜界计数重新归零。`);
  }
  return true;
}

function makeYuzuSkill(plan: YuzuAttackPlan, rate: number): SkillDefinition {
  return {
    name: plan.actionName,
    tag: SKILL_TAGS.SPECIAL,
    rate,
    onExecute: (ctx) => executeYuzuAttackPlan(ctx, plan),
  };
}

export const yuzuSkills: Record<string, SkillDefinition> = {
  yuzu_spear_impale: makeYuzuSkill({
    actionName: '长矛刺穿',
    quote: '“用长矛刺穿心脏，再倒吊起来。”',
    hits: 2,
    preferredWeapon: 'spear',
    preferredBonus: 0.1,
  }, 0.34),
  yuzu_hammer_crush: makeYuzuSkill({
    actionName: '钝器重压',
    quote: '“挥动钝器，在千钧重压之下被碾碎吧。”',
    hits: 2,
    preferredWeapon: 'hammer',
    preferredBonus: 0.1,
  }, 0.32),
  yuzu_sword_devour: makeYuzuSkill({
    actionName: '剑啄吞噬',
    quote: '“用剑猛烈啄刺，撕碎吞噬吧。”',
    hits: 3,
    preferredWeapon: 'sword',
    preferredBonus: 0.1,
  }, 0.3),
  yuzu_homeward_scythe: makeYuzuSkill({
    actionName: '回家的路',
    quote: '“出路只有一条。那就是让你来到这里的，回家的路。”',
    hits: 4,
    preferredWeapon: 'scythe',
    preferredBonus: 0.1,
  }, 0.24),

  yuzu_frozen_blood: makeYuzuSkill({
    actionName: '冻结血液',
    quote: '“将冻结的血液，缓缓缠绕。”',
    hits: 2,
    preferredWeapon: 'whip',
    preferredBonus: 0.15,
  }, 0.32),
  yuzu_silent_applause: makeYuzuSkill({
    actionName: '无声鼓掌',
    quote: '“无声地鼓掌，无言地斩下。”',
    hits: 2,
    preferredWeapon: 'greatsword',
    preferredBonus: 0.15,
  }, 0.3),
  yuzu_falling_leaf_blade: makeYuzuSkill({
    actionName: '落叶锋刃',
    quote: '“以锋利之刃，如落叶的香气、瀑布的轰鸣般哭嚎吧。”',
    hits: 3,
    preferredWeapon: 'knife',
    preferredBonus: 0.15,
  }, 0.28),
  yuzu_waiting_hell: makeYuzuSkill({
    actionName: '该待的地狱',
    quote: '“无需踏上旅途、这里就是你该待的地狱不是吗。”',
    hits: 4,
    preferredWeapon: 'scythe',
    preferredBonus: 0.15,
    group: true,
    applyRandomDebuff: true,
  }, 0.22),

  yuzu_customized_fool: makeYuzuSkill({
    actionName: '定制愚者',
    quote: '“活在被定制的人生中的愚蠢之人。那正是你。也是我啊。”',
    hits: 3,
    damageBonus: 0.15,
  }, 0.28),
  yuzu_divine_pursuit: makeYuzuSkill({
    actionName: '神兵追捕',
    quote: '“事到如今你已经无法自由地活下去了。就算你逃跑，神的兵卒也会来追捕你。”',
    hits: 3,
    damageBonus: 0.15,
  }, 0.28),
  yuzu_daughter_reckoning: makeYuzuSkill({
    actionName: '一码归一码',
    quote: '“女儿。别怨恨我。一码归一码。”',
    hits: 4,
    damageBonus: 0.15,
  }, 0.25),
  yuzu_unbreakable_daughter: makeYuzuSkill({
    actionName: '无法斩断',
    quote: '“这是无法被斩断的，女儿。……你不能擅自斩断它。”',
    hits: 4,
    damageBonus: 0.15,
  }, 0.25),
  yuzu_furioso_replica: makeYuzuSkill({
    actionName: 'Furioso-Replica',
    quote: '“Furioso-Replica”',
    hits: 9,
    damageBonus: 0.15,
    preferredWeapon: 'scythe',
    preferredBonus: 0.1,
    furioso: true,
  }, 0.08),
};
