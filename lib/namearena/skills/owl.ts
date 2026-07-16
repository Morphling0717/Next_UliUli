import type { DamageApplicationOptions, Fighter, SkillContext, SkillDefinition } from '../types';
import { healFighter, isActiveCombatant } from '../combatState';
import { namerenaData as Data } from '../data';
import { namerenaJobs } from '../jobs';
import { grantStatus } from '../defenseStatus';
import { isSelectableTargetFor } from '../targeting';
import { CONTROL_STATUS_TYPES, isStatusType } from '../statusRules';
import {
  addOwlWildStack,
  applyOwlRiverMark,
  findOwlEmperor,
  spawnOwlCrickets,
  spawnOwlFurrySquad,
  spawnOwlMeal,
  spawnOwlZhao,
  type OwlRuntime,
} from '../owlMechanics';

const { SKILL_TAGS } = Data;

function asOwlRuntime(ctx: SkillContext): OwlRuntime {
  return {
    fighters: ctx.fighters,
    jobs: namerenaJobs,
    turnCount: ctx.turnCount,
    getTeamId: ctx.getTeamId,
    isActiveCombatant,
    log: (type, text) => ctx.log(type, text),
    syncHpPct: (fighter) => {
      fighter.hpPct = fighter.maxHp > 0 ? fighter.currentHp / fighter.maxHp : 0;
    },
    applyDamage: ctx.applyDamage,
    applyStatus: ctx.applyStatus,
    markDefeated: ctx.markDefeated,
    flushDeferredDamageEvents: () => ctx.flushDeferredDamageEvents?.(),
  };
}

function isRedirected(options: DamageApplicationOptions): boolean {
  return !!(
    options.redirectedByJoker ||
    options.redirectedByOriginiumCore ||
    options.redirectedByOwlEmperor
  );
}

function resolvedDamage(actual: number, options: DamageApplicationOptions): number {
  if (options.redirectedByJoker) return options.redirectedJokerDamage ?? actual;
  if (options.redirectedByOriginiumCore) return options.redirectedOriginiumDamage ?? actual;
  if (options.redirectedByOwlEmperor) return options.redirectedOwlEmperorDamage ?? actual;
  return actual;
}

function applyOwlDamage(
  ctx: SkillContext,
  target: Fighter,
  amount: number,
  actionName: string,
  options: Partial<DamageApplicationOptions> = {},
): { actual: number; redirected: boolean; landed: boolean } {
  if (!isActiveCombatant(ctx.user) || !isActiveCombatant(target)) return { actual: 0, redirected: false, landed: false };
  const damageOptions: DamageApplicationOptions = {
    actionName,
    respectDefenses: true,
    ...options,
  };
  const actual = ctx.applyDamage(target, Math.max(1, Math.floor(amount)), 'skill', false, ctx.user, damageOptions);
  const redirected = isRedirected(damageOptions);
  const resolved = resolvedDamage(actual, damageOptions);
  return { actual: resolved, redirected, landed: actual > 0 && !redirected };
}

function settleOwlDamage(
  ctx: SkillContext,
  target: Fighter,
  result: { actual: number; redirected: boolean; landed: boolean },
  actionName: string,
): void {
  if (result.actual > 0 || (target.pendingDamageEvents?.length ?? 0) > 0) ctx.flushDeferredDamageEvents?.();
  if (!result.redirected && target.currentHp <= 0 && !target.isDead && !target.isDeadAnnounced) {
    ctx.markDefeated(target, {
      message: `💀 【${actionName}】${target.name} 被 ${ctx.user.name} 击败！`,
      killer: ctx.user,
    });
  }
}

function selectableEnemies(ctx: SkillContext): Fighter[] {
  const runtime = {
    fighters: ctx.fighters,
    turnCount: ctx.turnCount,
    getTeamId: ctx.getTeamId,
    isActiveCombatant,
  };
  return ctx.fighters.filter((fighter) => isSelectableTargetFor(runtime, ctx.user, fighter));
}

function canReceiveOwlRiverMark(fighter: Fighter): boolean {
  if (fighter.cannotAct) return false;
  return !fighter.status.some((status) =>
    isStatusType(status.type, CONTROL_STATUS_TYPES) ||
    status.type === 'OWL_FORM_DEFEAT' ||
    status.type === 'OWL_ENJOYING' ||
    status.type === 'OWL_SPALTER_DOLL',
  );
}

function executeYilingFire(ctx: SkillContext): boolean {
  const targets = selectableEnemies(ctx);
  ctx.log('skill', `🔥 【夷陵之火】${ctx.user.name}：“好火啊，这火比夷陵之火还要好啊！”烈焰扑向 ${targets.length} 名敌人！`);
  const raw = ctx.user.mag * 1.25 + ctx.user.wis * 0.55;
  targets.forEach((target) => {
    const result = applyOwlDamage(ctx, target, raw, '夷陵之火');
    if (!result.redirected) {
      ctx.log(
        result.actual > 0 ? 'skill' : 'info',
        result.actual > 0
          ? `🔥 夷陵之火命中 ${target.name}，实际造成 ${result.actual} 点伤害。`
          : `🔥 ${target.name} 挡下或化解了夷陵之火，未受到生命伤害。`,
      );
    }
    settleOwlDamage(ctx, target, result, '夷陵之火');
    if (result.landed && isActiveCombatant(target) && ctx.applyStatus(target, 'BURN', 3, { sourceId: ctx.user.id, effectName: '夷陵之火' })) {
      ctx.log('poison', `🔥 ${target.name} 被【夷陵之火】点燃，将灼烧 3 个全局行动回合。`);
    }
  });
  return true;
}

function executeSevenInSevenOut(ctx: SkillContext): boolean {
  const runtime = asOwlRuntime(ctx);
  const summon = spawnOwlZhao(runtime, ctx.user);
  if (!summon) {
    ctx.log('info', `🏇 【七进七出】赵云&阿斗仍在场上冲阵，不能重复召唤。`);
    return true;
  }
  ctx.log('skill', `🏇 【七进七出】${ctx.user.name}：“我本以为吕布已经天下无敌了，没想到有人居然比他还勇猛，这是谁的部将？！”${summon.name} 入场，将无差别冲阵 7 回合！`, { targetIds: [summon.id] });
  return true;
}

function executeSweepFurry(ctx: SkillContext): boolean {
  const runtime = asOwlRuntime(ctx);
  const summons = spawnOwlFurrySquad(runtime, ctx.user);
  if (summons.length === 0) {
    ctx.log('info', `🦈 【我去，扫福瑞】本阶段的四人小队已经召唤过，无法再次发动。`);
    return true;
  }
  ctx.log('skill', `🦈 【我去，扫福瑞】${ctx.user.name}：“真是一对笑面虎，两头乌角鲨！”${summons.map((summon) => summon.name).join('、')} 同时加入战场！`, { targetIds: summons.map((summon) => summon.id) });
  return true;
}

function executeCrossingMark(ctx: SkillContext): boolean {
  const candidates = selectableEnemies(ctx).filter(canReceiveOwlRiverMark);
  const target = candidates[Math.floor(Math.random() * candidates.length)];
  if (!target) {
    ctx.log('info', `🌊 【过江！过江！】场上没有能够正常行动的敌人，${ctx.user.name} 未能留下协同标记。`);
    return true;
  }
  applyOwlRiverMark(asOwlRuntime(ctx), ctx.user, target);
  ctx.log('debuff', `🌊 【过江！过江！】${ctx.user.name}：“好啊，他过江我也过江！”标记 ${target.name} 5 回合；其攻击时鸮会协同攻击同一个受害者。`);
  return true;
}

function executeBumperHarvest(ctx: SkillContext): boolean {
  const runtime = asOwlRuntime(ctx);
  const emperor = findOwlEmperor(runtime, ctx.user);
  const speakers = ctx.fighters.filter((fighter) =>
    fighter.id !== ctx.user.id && !fighter.isNpc && isActiveCombatant(fighter),
  );
  const speaker = speakers[Math.floor(Math.random() * speakers.length)];
  const selfHeal = healFighter(ctx.user, Math.floor(ctx.user.maxHp * 0.2), ctx.log);
  const dragonHeal = emperor ? healFighter(emperor, Math.floor(emperor.maxHp * 0.2), ctx.log) : 0;
  const selfText = selfHeal > 0 ? `${ctx.user.name} 恢复 ${selfHeal} 点生命` : `${ctx.user.name} 生命已满`;
  const dragonText = emperor
    ? dragonHeal > 0 ? `${emperor.name} 恢复 ${dragonHeal} 点生命` : `${emperor.name} 生命已满`
    : '帝王之征已不在场';
  ctx.log('heal', `🌾 【五谷丰登】${ctx.user.name}：“你走了，我们吃什么？”${speaker ? `${speaker.name}：“是啊，吃什么？”` : ''}${selfText}，${dragonText}。`);
  return true;
}

function executeDesk(ctx: SkillContext): boolean {
  const runtime = asOwlRuntime(ctx);
  const emperor = findOwlEmperor(runtime, ctx.user);
  if (!emperor) {
    ctx.log('info', `📜 【伏案】${ctx.user.name} 想让龙撒野，但帝王之征已经不在场。`);
    return true;
  }
  const stacks = addOwlWildStack(runtime, ctx.user);
  ctx.log('buff', `📜 【伏案】${ctx.user.name}：“你捡它作甚！你今天捡起来，他明天还要来撒野的！”${emperor.name} 获得【撒野】${stacks}/5 层，攻击与速度提高。`);
  return true;
}

function executeEnjoy(ctx: SkillContext): boolean {
  const healed = healFighter(ctx.user, Math.floor(ctx.user.maxHp * 0.28), ctx.log);
  grantStatus(ctx.user, 'OWL_ENJOYING', 3, ctx.user.id);
  ctx.log('heal', healed > 0
    ? `🎶 【乐不思蜀】${ctx.user.name}：“我打了一辈子仗就不能享受享受吗！接着奏乐，接着舞！”恢复 ${healed} 点生命，接下来 3 回合不进行攻击。`
    : `🎶 【乐不思蜀】${ctx.user.name}：“我打了一辈子仗就不能享受享受吗！接着奏乐，接着舞！”生命已满，接下来 3 回合不进行攻击。`);
  return true;
}

function executeBoneScrape(ctx: SkillContext): boolean {
  const runtime = asOwlRuntime(ctx);
  const emperor = findOwlEmperor(runtime, ctx.user);
  const speakers = selectableEnemies(ctx).filter((fighter) => !fighter.isNpc);
  const speaker = speakers[Math.floor(Math.random() * speakers.length)];
  const rawCost = Math.max(1, Math.floor(ctx.user.maxHp * 0.09));
  const options: DamageApplicationOptions = {
    actionName: '刮骨',
    respectDefenses: false,
    creditAttacker: false,
    bypassOwlEmperorRedirect: true,
    bypassOwlOutgoingModifier: true,
    bypassOwlIncomingModifier: true,
    suppressOwlCooperation: true,
  };
  const actualCost = ctx.applyDamage(ctx.user, rawCost, 'owl_cost', true, ctx.user, options);
  if (actualCost > 0 || (ctx.user.pendingDamageEvents?.length ?? 0) > 0) ctx.flushDeferredDamageEvents?.();
  const healed = emperor ? healFighter(emperor, Math.floor(actualCost * 1.6), ctx.log) : 0;
  const emperorText = emperor
    ? healed > 0 ? `并为 ${emperor.name} 恢复 ${healed} 点` : `，${emperor.name} 生命已满`
    : '，但已经没有帝王之征可以治疗';
  ctx.log('skill', `🩺 【刮骨】${speaker ? `${speaker.name}：“三日之内不可活动这只伤臂。”` : ''}${ctx.user.name}：→ ↑ ↙ ↗ → ↖ ↻ ↗，自损 ${actualCost} 点生命${emperorText}。`);
  if (ctx.user.currentHp <= 0 && !ctx.user.isDead && !ctx.user.isDeadAnnounced) {
    ctx.markDefeated(ctx.user, { message: `💀 【刮骨】${ctx.user.name} 没能撑过刮骨疗毒！`, awardKill: false });
  }
  return true;
}

function executeZhaoRampage(ctx: SkillContext): boolean {
  const targets = ctx.fighters.filter((fighter) =>
    fighter.id !== ctx.user.id &&
    isActiveCombatant(fighter) &&
    !(fighter.isPuruisaishi && (fighter.puruisaishiPhase ?? 1) <= 1) &&
    (fighter.untargetableUntilTurn ?? -1) < ctx.turnCount &&
    !fighter.status.some((status) => status.type === 'SYNERGY_SLACKING'),
  );
  const target = targets[Math.floor(Math.random() * targets.length)];
  if (!target) return true;
  if (ctx.handleWaitCounter?.(target, ctx.user, '长坂冲阵')) return true;
  if (ctx.handleCounterStatus?.(target, ctx.user) || !isActiveCombatant(ctx.user)) return true;
  const raw = ctx.user.atk * 1.45 + ctx.user.spd * 0.45;
  const result = applyOwlDamage(ctx, target, raw, '长坂冲阵');
  if (!result.redirected) {
    ctx.log(
      result.actual > 0 ? 'skill' : 'info',
      result.actual > 0
        ? `🏇 【无差别冲阵】${ctx.user.name} 不分敌我冲向 ${target.name}，实际造成 ${result.actual} 点伤害！`
        : `🏇 【无差别冲阵】${ctx.user.name} 冲向 ${target.name}，但未能造成生命伤害。`,
    );
  }
  settleOwlDamage(ctx, target, result, '长坂冲阵');
  return true;
}

function executeAtomicBreath(ctx: SkillContext): boolean {
  if (ctx.handleWaitCounter?.(ctx.target, ctx.user, '原子吐息')) return true;
  if (ctx.handleCounterStatus?.(ctx.target, ctx.user) || !isActiveCombatant(ctx.user)) return true;
  const raw = ctx.user.mag * 1.75 + ctx.user.atk * 0.75 + ctx.user.wis * 0.3;
  const result = applyOwlDamage(ctx, ctx.target, raw, '原子吐息');
  if (!result.redirected) {
    ctx.log(
      result.actual > 0 ? 'skill' : 'info',
      result.actual > 0
        ? `🐲 【原子吐息】${ctx.user.name} 将原子能压缩成龙息轰向 ${ctx.target.name}，实际造成 ${result.actual} 点混合伤害！`
        : `🐲 【原子吐息】${ctx.user.name} 轰向 ${ctx.target.name}，龙息被完全化解，未造成生命伤害。`,
    );
  }
  settleOwlDamage(ctx, ctx.target, result, '原子吐息');
  return true;
}

function executeDragonShock(ctx: SkillContext): boolean {
  const pool = selectableEnemies(ctx);
  const targets: Fighter[] = [];
  while (targets.length < 3 && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length);
    const [target] = pool.splice(index, 1);
    if (target) targets.push(target);
  }
  ctx.log('skill', `🐲 【龙威震荡】${ctx.user.name} 振翼释放帝王威压，震向 ${targets.map((target) => target.name).join('、')}！`);
  targets.forEach((target) => {
    const raw = ctx.user.mag * 0.9 + ctx.user.atk * 0.45;
    const result = applyOwlDamage(ctx, target, raw, '龙威震荡');
    if (!result.redirected) {
      ctx.log(
        result.actual > 0 ? 'skill' : 'info',
        result.actual > 0
          ? `🐲 龙威扫过 ${target.name}，实际造成 ${result.actual} 点伤害。`
          : `🐲 ${target.name} 顶住了龙威震荡，未受到生命伤害。`,
      );
    }
    settleOwlDamage(ctx, target, result, '龙威震荡');
    if (result.landed && isActiveCombatant(target) && ctx.applyStatus(target, 'OWL_DRAGON_SLOW', 2, { sourceId: ctx.user.id, effectName: '龙威震荡' })) {
      ctx.log('debuff', `🐲 ${target.name} 被龙威震慑，行动速度下降 2 回合。`);
    }
  });
  return true;
}

export const owlSkills: Record<string, SkillDefinition> = {
  owl_benevolence_sword: {
    name: '仁之剑', tag: SKILL_TAGS.PHYS, rate: 1, mult: 1.5,
    text: '⚔️ 【仁之剑】{USER} 以仁兵之势斩向 {TARGET}，造成 {VAL} 点物理伤害！',
  },
  owl_righteousness_sword: {
    name: '义之剑', tag: SKILL_TAGS.MAG, rate: 1, mult: 1.5,
    text: '🗡️ 【义之剑】{USER} 引天意剑气击中 {TARGET}，造成 {VAL} 点魔法伤害！',
  },
  owl_nia: {
    name: 'nia↗！', tag: SKILL_TAGS.SPECIAL, rate: 1, mult: 1.45,
    text: '🍚 【nia↗！】{USER} 怪叫着袭向 {TARGET}，造成 {VAL} 点伤害！',
    afterExecute: (ctx) => {
      const summon = spawnOwlMeal(asOwlRuntime(ctx), ctx.user);
      ctx.log('skill', `🍚 ${ctx.user.name} 随手留下 ${summon.name}；5 回合后会变成被扒回碗里的米饭。`, { targetIds: [summon.id] });
    },
  },
  owl_yiling_fire: {
    name: '夷陵之火', tag: SKILL_TAGS.MAG, presentation: 'skill', rate: 1,
    spellBlockMode: 'perHit', onExecute: executeYilingFire,
  },
  owl_shining_hopper: {
    name: 'shining hopper!', tag: SKILL_TAGS.PHYS, rate: 1, mult: 1.35,
    text: '🦗 【shining hopper!】{USER} 让蛐蛐跃击 {TARGET}，造成 {VAL} 点伤害！',
    afterExecute: (ctx) => {
      const summons = spawnOwlCrickets(asOwlRuntime(ctx), ctx.user);
      ctx.log(summons.length > 0 ? 'skill' : 'info', summons.length > 0
        ? `🦗 ${ctx.user.name}：“我的这些个蛐蛐们，个个都有情有义！”${summons.map((summon) => summon.name).join('、')} 入场。`
        : `🦗 场上已有两只蛐蛐，${ctx.user.name} 无法继续召唤。`, summons.length > 0 ? { targetIds: summons.map((summon) => summon.id) } : undefined);
    },
  },
  owl_seven_in_seven_out: { name: '七进七出', tag: SKILL_TAGS.BUFF, rate: 1, onExecute: executeSevenInSevenOut },
  owl_sweep_furry: { name: '我去，扫福瑞', tag: SKILL_TAGS.BUFF, rate: 1, onExecute: executeSweepFurry },
  owl_crossing_mark: { name: '过江！过江！', tag: SKILL_TAGS.DEBUFF, rate: 1, spellBlockMode: 'afterSetup', onExecute: executeCrossingMark },
  owl_crossing_assist: { name: '过江协同', tag: SKILL_TAGS.SPECIAL, rate: 0, presentation: 'skill' },
  owl_bumper_harvest: { name: '五谷丰登', tag: SKILL_TAGS.HEAL, rate: 1, onExecute: executeBumperHarvest },
  owl_desk: { name: '伏案', tag: SKILL_TAGS.BUFF, rate: 1, onExecute: executeDesk },
  owl_ruthless_sword: {
    name: '无情剑', tag: SKILL_TAGS.PHYS, rate: 1, mult: 2.0,
    text: '⚔️ 【无情剑】{USER}：“我刘备别无所长，剑法却是当世一流，可别逼我使出无情剑来！”斩中 {TARGET}，造成 {VAL} 点伤害！',
  },
  owl_enjoy: { name: '乐不思蜀', tag: SKILL_TAGS.HEAL, rate: 1, onExecute: executeEnjoy },
  owl_great_wind: {
    name: '大风起兮云飞扬', tag: SKILL_TAGS.MAG, rate: 1, mult: 1.8, status: 'OWL_EVADE_DOWN',
    text: '🍃 【大风起兮云飞扬】{USER}：“好风啊，风从虎，云从龙，龙虎英雄傲苍穹！”风刃击中 {TARGET}，造成 {VAL} 点伤害并扰乱闪避！',
  },
  owl_bone_scrape: { name: '刮骨', tag: SKILL_TAGS.HEAL, rate: 1, onExecute: executeBoneScrape },
  owl_cricket_strike: {
    name: '蛐蛐猛扑', tag: SKILL_TAGS.PHYS, rate: 0.8, mult: 1.25,
    text: '🦗 {USER} 奋力扑向 {TARGET}，造成 {VAL} 点伤害！',
  },
  owl_zhao_rampage: { name: '长坂冲阵', tag: SKILL_TAGS.SPECIAL, rate: 1, directTarget: true, onExecute: executeZhaoRampage },
  owl_swire_strike: { name: '笑面虎强袭', tag: SKILL_TAGS.PHYS, rate: 0.9, mult: 1.65, text: '🐯 {USER} 猛攻 {TARGET}，造成 {VAL} 点伤害！' },
  owl_linlang_strike: { name: '琳琅重击', tag: SKILL_TAGS.PHYS, rate: 0.9, mult: 1.85, text: '💰 {USER} 以重装火力压向 {TARGET}，造成 {VAL} 点伤害！' },
  owl_specter_saw: { name: '链锯狂袭', tag: SKILL_TAGS.PHYS, rate: 0.9, mult: 1.7, text: '🦈 {USER} 挥动链锯切向 {TARGET}，造成 {VAL} 点伤害！' },
  owl_spalter_saw: { name: '归溟回旋', tag: SKILL_TAGS.PHYS, rate: 0.9, mult: 1.75, text: '🌊 {USER} 旋身切开 {TARGET}，造成 {VAL} 点伤害！' },
  owl_emperor_claw: { name: '帝征爪击', tag: SKILL_TAGS.PHYS, rate: 1, mult: 1.7, text: '🐲 【帝征爪击】{USER} 以龙爪撕击 {TARGET}，造成 {VAL} 点物理伤害！' },
  owl_atomic_breath: { name: '原子吐息', tag: SKILL_TAGS.SPECIAL, rate: 1, presentation: 'skill', directTarget: true, spellBlockMode: 'perHit', onExecute: executeAtomicBreath },
  owl_dragon_shock: { name: '龙威震荡', tag: SKILL_TAGS.MAG, rate: 1, presentation: 'skill', spellBlockMode: 'perHit', onExecute: executeDragonShock },
};
