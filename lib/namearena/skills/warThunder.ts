import type { DamageApplicationOptions, Fighter, SkillContext, SkillDefinition } from '../types';
import { namerenaData as Data } from '../data';
import { isActiveCombatant, resolveHealing } from '../combatState';
import { consumeSpellBlock, findDefenseStatus, formatControlBlocked, formatInvul, formatSpellBlock } from '../defenseStatus';
import { tryExecuteDefeat } from '../executionGuards';
import { isSelectableTargetFor } from '../targeting';
import { applyStatus, consumeStatusValue, hasIdentity, hasMechanic, queryMechanic } from '../statusSystem';
import { getPanelCombatStat, WT_REPAIRING_PROFILE } from '../statusMechanics';
import { didDamageConnect, isDamageRedirected } from '../damageRedirects';
import { getSurtrTacticalHpPct, isSurtrAfterglowActive } from '../surtrMechanics';

const { SKILL_TAGS } = Data;

const CAS_MAX_TARGETS = 4;
const CAS_MAIN_DAMAGE_MULT = 2.78;
const CAS_DESIGNATED_MAIN_DAMAGE_MULT = 3.14;
const CAS_SPLASH_DAMAGE_MULT = 1.25;
const CAS_DESIGNATED_SPLASH_DAMAGE_MULT = 1.54;
const CAS_MAIN_AMMO_RACK_PCT = 0.22;
const CAS_DESIGNATED_MAIN_AMMO_RACK_PCT = 0.30;
const CAS_SPLASH_AMMO_RACK_PCT = 0.10;
const CAS_DESIGNATED_SPLASH_AMMO_RACK_PCT = 0.15;
const WT_SP_MAX = 8;
const WT_CAS_COST = 5;
const WT_PRECISE_CAS_COST = 4;

const WT_CONTROL_CLEAN = new Set([
  'STUN', 'FREEZE', 'CONFUSED', 'EMBARRASSED', 'CHARMED', 'WT_SUPPRESS', 'AIRBORNE', 'VALO_AIM_PUNCH', 'VALO_CYPHER_REVEALED', 'NEURAL_THEFT_DEBUFF', 'BABY_WEAKNESS_MARK', 'ZEROED',
]);

const WT_ORIGINIUM_MODULE_IDENTITIES: Record<string, string> = {
  WT_BREECH_DAMAGED: 'WT_ORIGINIUM_BREECH_DAMAGED',
  WT_TRACK_DAMAGED: 'WT_ORIGINIUM_TRACK_DAMAGED',
  WT_AMMO_EXPOSED: 'WT_ORIGINIUM_AMMO_EXPOSED',
};
const WT_MODULE_STATUSES = new Set([
  'WT_BREECH_DAMAGED', 'WT_TRACK_DAMAGED', 'WT_AMMO_EXPOSED',
  'WT_ORIGINIUM_BREECH_DAMAGED', 'WT_ORIGINIUM_TRACK_DAMAGED',
  'WT_ORIGINIUM_AMMO_EXPOSED', 'WT_SCOUTED',
]);

function hasStatus(fighter: Fighter, type: string): boolean {
  return hasIdentity(fighter, type);
}

function isTopTierWt(fighter: Fighter): boolean {
  return !!fighter.isWT && fighter.job === 'WT_TOP_TIER';
}

function gainSpawnPoints(user: Fighter, amount: number): number {
  if (!isTopTierWt(user) || amount <= 0) return user.wtSpawnPoints ?? 0;
  user.wtSpawnPoints = Math.min(WT_SP_MAX, (user.wtSpawnPoints ?? 0) + amount);
  return user.wtSpawnPoints;
}

function spendSpawnPoints(user: Fighter, amount: number): boolean {
  if ((user.wtSpawnPoints ?? 0) < amount) return false;
  user.wtSpawnPoints = Math.max(0, (user.wtSpawnPoints ?? 0) - amount);
  return true;
}

function activeEnemies(ctx: SkillContext): Fighter[] {
  const teamId = ctx.getTeamId(ctx.user);
  return (ctx.currentTargets ?? ctx.fighters ?? [])
    .filter((fighter) => isCasEligibleTarget(ctx, fighter) && ctx.getTeamId(fighter) !== teamId);
}

function threatScore(fighter: Fighter): number {
  let score = getPanelCombatStat(fighter, 'atk') +
    getPanelCombatStat(fighter, 'mag') +
    getPanelCombatStat(fighter, 'spd') * 0.55 +
    getPanelCombatStat(fighter, 'wis') * 0.35;
  if (fighter.hpPct < 0.35) score += 260;
  if (hasStatus(fighter, 'WT_SCOUTED')) score += 260;
  if (hasMechanic(fighter, 'WT_AMMO_EXPOSED')) score += 320;
  if (fighter.isGacha || fighter.isGamer || fighter.isSigua || fighter.isJoker || fighter.isTuJuanJuan) score += 180;
  if (fighter.isSummon && fighter.isAdvancedSummon) score += 220;
  if (hasStatus(fighter, 'SYNERGY_SLACKING')) score -= 9999;
  return score;
}

function preferredTarget(ctx: SkillContext, fallback = ctx.target): Fighter {
  const marked = (ctx.fighters ?? []).find((fighter) =>
    fighter.id === ctx.user.wtMarkedTargetId &&
    isCasEligibleTarget(ctx, fighter),
  );
  if (marked) return marked;
  const enemies = activeEnemies(ctx);
  return enemies.sort((a, b) => threatScore(b) - threatScore(a))[0] ?? fallback;
}

function isOriginiumEntity(target: Fighter): boolean {
  return !!(target.isOriginiumCrystal || target.isOriginiumCore || target.isPuruisaishi);
}

function describeOriginiumModuleHit(ctx: SkillContext, target: Fighter, identityId: string): string | null {
  if (!isOriginiumEntity(target)) return null;
  if (identityId === 'WT_AMMO_EXPOSED') {
    return `💠 【源石核心暴露】${ctx.user.name} 的火力震裂 ${target.name} 外层晶格，内部源石核心完全暴露！`;
  }
  if (identityId === 'WT_BREECH_DAMAGED') {
    return `🔹 【晶格破损】${ctx.user.name} 的钢针震裂 ${target.name} 的源石晶格，结构输出下降！`;
  }
  if (identityId === 'WT_TRACK_DAMAGED') {
    return `◆ 【结晶锚点断裂】${ctx.user.name} 的火力打断 ${target.name} 的固定锚点，闪避归零！`;
  }
  return null;
}

function exposeModule(ctx: SkillContext, target: Fighter, moduleIdentityId: string, remainingTurns: number, text: string): void {
  if (!isActiveCombatant(target) || hasStatus(target, 'BKB')) return;
  const identityId = isOriginiumEntity(target)
    ? (WT_ORIGINIUM_MODULE_IDENTITIES[moduleIdentityId] ?? moduleIdentityId)
    : moduleIdentityId;
  const applied = ctx.applyStatus(target, {
    identityId,
    remainingTurns,
    attribution: { effectSourceId: identityId, applierId: ctx.user.id, applierName: ctx.user.name },
  });
  if (applied) ctx.log('info', describeOriginiumModuleHit(ctx, target, moduleIdentityId) ?? text);
}

function grantDamageSpawnPoint(ctx: SkillContext, actualDmg: number, target: Fighter): void {
  if (!isTopTierWt(ctx.user) || actualDmg < Math.max(520, Math.floor(target.maxHp * 0.18)) || Math.random() < 0.48) return;
  const before = ctx.user.wtSpawnPoints ?? 0;
  const current = gainSpawnPoints(ctx.user, 1);
  if (current > before) {
    ctx.log('buff', `🪖 【有效命中】${ctx.user.name} 打出有效毁伤，出生点 +1！（当前 SP ${current}/${WT_SP_MAX}）`);
  }
}

function maybeAmmoRack(ctx: SkillContext, target: Fighter, actualDmg: number, actionName: string): boolean {
  if (!isActiveCombatant(target) || actualDmg <= 0 || target.transformed) return false;
  const exposed = hasMechanic(target, 'WT_AMMO_EXPOSED') || hasStatus(target, 'WT_SCOUTED');
  const threshold = exposed ? 0.34 : 0.24;
  const chance = exposed ? 0.34 : 0.18;
  if (getSurtrTacticalHpPct(target) >= threshold || Math.random() >= chance) return false;
  const originium = isOriginiumEntity(target);
  return tryExecuteDefeat(ctx, target, originium ? '源石核心崩解' : '弹药架殉爆', {
    message: originium
      ? `◆ 【源石核心崩解】${actionName} 精准命中 ${target.name} 暴露的源石核心，整体晶格碎裂！`
      : `☠️ 【弹药架殉爆】${actionName} 精准命中 ${target.name} 的弹药区，炮塔飞上天！`,
    killer: ctx.user,
  });
}

function consumeAim(user: Fighter): boolean {
  const aim = queryMechanic(user, 'AIM').entries.find((entry) => (entry.charges ?? 0) > 0);
  if (!aim) return false;
  consumeStatusValue(user, aim, 'charges');
  return true;
}

function isCasEligibleTarget(ctx: SkillContext, fighter: SkillContext['target'] | undefined): boolean {
  if (!fighter) return false;
  return isSelectableTargetFor({
    fighters: ctx.fighters,
    turnCount: ctx.turnCount,
    battleState: ctx.battleState,
    getTeamId: ctx.getTeamId,
    isActiveCombatant,
  }, ctx.user, fighter);
}

export const warThunderSkills: Record<string, SkillDefinition> = {
  wt_attack_d_point: {
    name: '快捷语音', tag: SKILL_TAGS.BUFF,
    text: '📻 {USER} 疯狂按T-3-4发送无线电："【保卫D点！】【攻击D点！】"\n毫无意义的指令让 {USER} 自己陷入了深深的【混乱】，同时己方火力系统莫名振奋（攻击力上升）！',
    onExecute: (ctx) => {
      const confused = ctx.applyStatus(ctx.user, { identityId: 'CONFUSED', remainingTurns: 2, effectName: 'D点无线电混乱', attribution: { applierId: ctx.user.id, applierName: ctx.user.name } });
      const allies = (ctx.fighters ?? []).filter(
        (f) =>
          isActiveCombatant(f) &&
          ctx.getTeamId(f) === ctx.getTeamId(ctx.user) &&
          ctx.canProvideSupport(f),
      );
      allies.forEach((ally) => {
        ctx.applyStatus(ally, { identityId: 'WT_RADIO_MORALE', remainingTurns: 3 });
      });
      ctx.log('buff', confused
        ? `📻 ${ctx.user.name} 疯狂按T-3-4发送无线电："【保卫D点！】【攻击D点！】"\n毫无意义的指令让 ${ctx.user.name} 自己陷入了深深的【混乱】，同时己方火力系统莫名振奋（攻击力上升）！`
        : `📻 ${ctx.user.name} 疯狂按T-3-4发送无线电："【保卫D点！】【攻击D点！】"\n控制免疫滤掉了无线电噪声，但己方火力系统仍然受到动员（攻击力上升）！`);
      return true;
    },
  },
  wt_repair: {
    name: '长按F修车', tag: SKILL_TAGS.HEAL, condition: (u) => u.hpPct < 0.6,
    text: '🔧 {USER} 载具受损！黑炮管了！"长按F进行战地抢修（50秒）"\n{USER} 停车抢修，装甲正在逐步恢复！',
    onExecute: (ctx) => {
      applyStatus(ctx.user, { identityId: 'WT_REPAIRING', remainingTurns: WT_REPAIRING_PROFILE.remainingTurns });
      ctx.log('buff', `🔧 【战地抢修】${ctx.user.name} 停车长按 F：接下来 ${WT_REPAIRING_PROFILE.remainingTurns} 次行动机会无法行动，每次恢复 20% 最大生命；停车暴露期间受到非持续伤害提高 30%！`);
      return true;
    },
  },
  wt_repair_premium: {
    name: '王牌乘员抢修', tag: SKILL_TAGS.HEAL,
    condition: (u) =>
      u.hpPct < 0.72 ||
      ['BURN', 'POISON', 'BLEED', ...WT_CONTROL_CLEAN, ...WT_MODULE_STATUSES]
        .some((identityId) => hasIdentity(u, identityId)),
    text: '🔧 {USER} 载具受损！但【王牌乘员组】迅速介入！"履带断了？几秒钟的事！"\n{USER} 瞬间完成抢修，清除了所有负面状态，并恢复了巨量生命值！',
    onExecute: (ctx) => {
      ctx.log('skill', `🔧 【战地抢修】${ctx.user.name} 停车检修，王牌乘员组开始处理伤员、履带与受损模块！`);
      const hadBurn = hasStatus(ctx.user, 'BURN');
      const hadPoison = hasStatus(ctx.user, 'POISON');
      const hadBleed = hasStatus(ctx.user, 'BLEED');
      const fpeUsed = hadBurn && (ctx.user.wtFpeCharges ?? 0) > 0;
      const nbcsUsed = hadPoison && (ctx.user.wtNbcsCharges ?? 0) > 0;
      const hadCrewControl = [...WT_CONTROL_CLEAN].some((identityId) => hasIdentity(ctx.user, identityId));
      const hadModuleDamage = [...WT_MODULE_STATUSES].some((identityId) => hasIdentity(ctx.user, identityId));
      const spentSp = (ctx.user.wtSpawnPoints ?? 0) >= 2 && (ctx.user.hpPct < 0.34 || (hadCrewControl && ctx.user.hpPct < 0.56) || (hadModuleDamage && ctx.user.hpPct < 0.56));

      if (fpeUsed) ctx.user.wtFpeCharges = Math.max(0, (ctx.user.wtFpeCharges ?? 0) - 1);
      if (nbcsUsed) ctx.user.wtNbcsCharges = Math.max(0, (ctx.user.wtNbcsCharges ?? 0) - 1);
      if (spentSp) spendSpawnPoints(ctx.user, 2);

      const repairTargets = new Set([
        ...WT_CONTROL_CLEAN,
        ...WT_MODULE_STATUSES,
        'BLEED', 'BLIND', 'SILENCE', 'WT_REPAIRING', 'NO_HEAL', 'WEAK',
      ]);
      if (fpeUsed) repairTargets.add('BURN');
      if (nbcsUsed) repairTargets.add('POISON');
      if (fpeUsed) {
        ctx.log('heal', `🧯 【FPE灭火】${ctx.user.name} 拉下灭火系统，扑灭舱内火势！（剩余 FPE ${ctx.user.wtFpeCharges ?? 0}）`);
      } else if (hadBurn) {
        ctx.log('info', `🔥 ${ctx.user.name} 舱内仍在燃烧，但 FPE 已经打空，只能靠乘员硬修！`);
      }
      if (nbcsUsed) {
        ctx.log('heal', `☣️ 【核生化洗消】${ctx.user.name} 启动滤毒与洗消流程，压下中毒侵蚀！（剩余洗消 ${ctx.user.wtNbcsCharges ?? 0}）`);
      } else if (hadPoison) {
        ctx.log('info', `☣️ ${ctx.user.name} 仍受到毒性侵蚀，核生化洗消包已经耗尽！`);
      }
      if (hadBleed) {
        ctx.log('heal', `🩹 【乘员急救】${ctx.user.name} 的乘员完成压迫止血与伤口包扎，清除了流血状态！`);
      }
      if (hadCrewControl || hadModuleDamage) {
        ctx.log('buff', `🔧 【王牌乘员】${ctx.user.name} 更换乘员、接上履带、修复炮闩，重新获得作战能力！`);
      }
      ctx.dispelStatusEffects(ctx.user, {
        strength: 'strong',
        direction: 'negative',
        identityIds: [...repairTargets],
      });

      const healPct = spentSp ? 0.46 : 0.26;
      const healing = resolveHealing(ctx.user, Math.floor(ctx.user.maxHp * healPct), {
        kind: 'direct',
        sourceId: '王牌乘员抢修',
        healer: ctx.user,
      }, ctx.log);
      const healText = healing.actual > 0
        ? `实际恢复 ${healing.actual} 点生命`
        : healing.outcome === 'blocked'
          ? '治疗被完全阻止'
          : '生命已满，治疗溢出';
      applyStatus(ctx.user, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'war_thunder_repair' } });
      if (spentSp) applyStatus(ctx.user, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'war_thunder_repair' } });
      ctx.log('heal', `🔧 【抢修完成】${ctx.user.name} ${healText}${spentSp ? `，消耗 2 SP 强化抢修（当前 SP ${ctx.user.wtSpawnPoints ?? 0}/${WT_SP_MAX}）` : ''}！`);
      return true;
    },
  },
  wt_apfsds: {
    name: '脱壳穿甲弹', tag: SKILL_TAGS.PHYS, mult: 2.05, ignoreDef: true,
    text: '🎯 {USER} 测距完毕，装填钢针(APFSDS)！\n"出膛！" 一发尾翼稳定脱壳穿甲弹贯穿了 {TARGET}，造成 {VAL} 真实伤害！',
    onExecute: (ctx) => {
      if (Math.random() < (isTopTierWt(ctx.user) ? 0.03 : 0.05)) {
        ctx.log('info', `👻 【安东星魔法】服务器丢包了！${ctx.user.name} 的钢针变成了【幽灵炮弹】，直接穿模透过了 ${ctx.target.name} 的身体！伤害为 0！(血压飙升)`);
        applyStatus(ctx.user, { identityId: 'RAGE', remainingTurns: 2 });
        return true;
      }
      return false;
    },
    afterExecute: (ctx, actualDmg) => {
      const connected = actualDmg > 0 || ctx.primaryHitConnectedWithoutHpDamage;
      if (ctx.damageRedirectedByOriginiumCore || ctx.damageRedirectedByOwlEmperor || !isTopTierWt(ctx.user) || !connected || !isActiveCombatant(ctx.target)) return;
      if (actualDmg > 0) grantDamageSpawnPoint(ctx, actualDmg, ctx.target);
      if (ctx.suppressOnHitStatuses || ctx.targetDefeatedDuringAction) return;
      const moduleRoll = Math.random();
      if (moduleRoll < 0.5) {
        exposeModule(ctx, ctx.target, 'WT_BREECH_DAMAGED', 3, `🔩 【模块破坏】${ctx.user.name} 的钢针击穿炮闩，${ctx.target.name} 主武器输出下降！`);
      } else {
        exposeModule(ctx, ctx.target, 'WT_AMMO_EXPOSED', 3, `💥 【模块破坏】${ctx.user.name} 的钢针擦过弹药区，${ctx.target.name} 弹药架暴露！`);
      }
      if (actualDmg > 0) maybeAmmoRack(ctx, ctx.target, actualDmg, '脱壳穿甲弹');
    },
  },
  wt_magic_ricochet: {
    name: '魔法跳弹', tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'INVUL', attribution: { effectSourceId: 'war_thunder_ricochet' } }],
    text: '🛡️ {USER} 摆出了刁钻的倾斜装甲角度，大喊："BVVD保佑！"\n触发战雷经典【魔法跳弹】，浑身散发斯大林合金的光辉，免疫接下来的所有伤害！',
    onExecute: (ctx) => {
      applyStatus(ctx.user, { identityId: 'INVUL', remainingTurns: 1, attribution: { effectSourceId: 'war_thunder_ricochet' } });
      ctx.log('buff', `🛡️ ${ctx.user.name} 摆出了刁钻的倾斜装甲角度，大喊："BVVD保佑！" 触发战雷经典【魔法跳弹】，免疫接下来的所有伤害！`);
      return true;
    },
  },
  wt_magic_ricochet_premium: {
    name: '顶级魔法跳弹', tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'INVUL', attribution: { effectSourceId: 'war_thunder_top_ricochet' } }],
    dispelSpecs: [{ strength: 'strong', direction: 'negative' }],
    text: '🛡️ {USER} 摆出了无懈可击的完美倾斜角度，复合装甲闪耀着魔法的光辉！\n大喊："BVVD保佑！" 触发【顶级魔法跳弹】，清除了自身负面状态，并绝对免疫接下来的所有伤害！',
    onExecute: (ctx) => {
      ctx.log('buff', `🛡️ 【顶级魔法跳弹】${ctx.user.name} 摆出完美倾斜角度，复合装甲与烟幕开始清除控制和模块异常！`);
      ctx.dispelStatusEffects(ctx.user, { strength: 'strong', direction: 'negative' });
      applyStatus(ctx.user, { identityId: 'INVUL', remainingTurns: 1, attribution: { effectSourceId: 'war_thunder_top_ricochet' } });
      applyStatus(ctx.user, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'war_thunder_top_ricochet' } });
      const before = ctx.user.wtSpawnPoints ?? 0;
      const current = Math.random() < 0.35 ? gainSpawnPoints(ctx.user, 1) : before;
      ctx.log('buff', `🛡️ 【跳弹窗口】${ctx.user.name} 已完成清理并进入绝对防护窗口！`);
      if (current > before) ctx.log('buff', `🪖 【生存收益】跳弹骗炮成功，出生点 +1！（当前 SP ${current}/${WT_SP_MAX}）`);
      return true;
    },
  },
  wt_laser_rangefinder: {
    name: '激光测距仪', tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'AIM' }],
    text: '🔭 {USER} 开启热成像与激光测距仪，锁定目标！\n下一次攻击必定暴击、无法闪避；若呼叫苏-30SM2，将获得精确CAS引导！',
    onExecute: (ctx) => {
      const target = preferredTarget(ctx);
      applyStatus(ctx.user, { identityId: 'AIM', charges: 2 });
      ctx.applyStatus(target, { identityId: 'WT_SCOUTED', remainingTurns: 3 });
      ctx.user.wtMarkedTargetId = target.id;
      const before = ctx.user.wtSpawnPoints ?? 0;
      const current = Math.random() < 0.45 ? gainSpawnPoints(ctx.user, 1) : before;
      ctx.log('buff', `🔭 【激光测距仪】${ctx.user.name} 开启热成像与激光测距仪，锁定 ${target.name}！下一轮火控/精确 CAS 会优先处理该目标。`);
      if (current > before) ctx.log('buff', `🪖 【侦察收益】有效侦察上传，出生点 +1！（当前 SP ${current}/${WT_SP_MAX}）`);
      return true;
    },
  },
  wt_bmpt_suppress: {
    name: 'BMPT死亡收割机', tag: SKILL_TAGS.PHYS, mult: 0.58, hits: 5, statusApplications: [{ identityId: 'WT_SUPPRESS' }], alwaysHit: true,
    text: '🚜 {USER} 召唤巨大 BMPT 终结者！双联装30毫米机炮狂啸！\n"哒哒哒哒哒！" 对 {TARGET} 倾泻 5 段火力（共 {VAL} 伤害）并形成绝对【火力压制】！',
    afterExecute: (ctx, actualDmg) => {
      const connected = actualDmg > 0 || ctx.primaryHitConnectedWithoutHpDamage;
      if (ctx.damageRedirectedByOriginiumCore || ctx.damageRedirectedByOwlEmperor || !isTopTierWt(ctx.user) || !connected || !isActiveCombatant(ctx.target)) return;
      if (actualDmg > 0) grantDamageSpawnPoint(ctx, actualDmg, ctx.target);
      if (ctx.suppressOnHitStatuses || ctx.targetDefeatedDuringAction) return;
      exposeModule(ctx, ctx.target, 'WT_TRACK_DAMAGED', 2, `🛞 【履带断裂】${ctx.user.name} 的机炮扫断 ${ctx.target.name} 的机动部件，闪避归零！`);
      if (Math.random() < 0.35) {
        exposeModule(ctx, ctx.target, 'WT_BREECH_DAMAGED', 2, `🔩 【炮闩受损】BMPT 火力压制打坏 ${ctx.target.name} 的输出节奏！`);
      }
    },
  },
  wt_t58_knockup: {
    name: 'T-58 碎甲轰击', tag: SKILL_TAGS.PHYS, mult: 4.35, ignoreDef: true, statusApplications: [{ identityId: 'AIRBORNE' }],
    text: '💥 {USER} 召唤 T-58 重型坦克！155毫米线膛炮锁定！\n"一发入魂！" 粗壮的钢针瞬间粉碎了 {TARGET} 的装甲，造成 {VAL} 真实伤害并将其当场【击飞】！',
    afterExecute: (ctx, actualDmg) => {
      if (ctx.damageRedirectedByOriginiumCore || ctx.damageRedirectedByOwlEmperor || !isTopTierWt(ctx.user)) return;
      const connected = actualDmg > 0 || ctx.primaryHitConnectedWithoutHpDamage;
      if (connected && isActiveCombatant(ctx.target)) {
        if (actualDmg > 0) grantDamageSpawnPoint(ctx, actualDmg, ctx.target);
        if (ctx.suppressOnHitStatuses || ctx.targetDefeatedDuringAction) return;
        exposeModule(ctx, ctx.target, 'WT_AMMO_EXPOSED', 3, `💥 【弹药架暴露】T-58 大口径碎甲让 ${ctx.target.name} 的内部弹药区完全暴露！`);
      }
      if (connected && ctx.target.currentHp > 0 && getSurtrTacticalHpPct(ctx.target) < (hasMechanic(ctx.target, 'WT_AMMO_EXPOSED') ? 0.34 : 0.26) && !ctx.target.transformed && Math.random() < 0.36) {
        const originium = isOriginiumEntity(ctx.target);
        tryExecuteDefeat(ctx, ctx.target, originium ? '源石核心崩解' : '弹药架殉爆', {
          message: originium
            ? `◆ 【源石核心崩解】T-58 的动能贯穿 ${ctx.target.name} 暴露的核心，源石晶格当场崩解！`
            : `☠️ 【弹药架殉爆】轰！！！T-58 的动能直接引爆了 ${ctx.target.name} 的弹药架！炮塔被炸飞了十几米高！完成极硬核斩杀！`,
          killer: ctx.user,
        });
      }
    },
  },
  wt_su30_cas: {
    name: '苏-30SM2 狂暴轰入', tag: SKILL_TAGS.PHYS, ignoreDef: true, herobrineCopyTargetCap: 3,
    spellBlockMode: 'perHit',
    condition: (u) => (u.wtSpawnPoints ?? 0) >= (hasMechanic(u, 'AIM') ? WT_PRECISE_CAS_COST : WT_CAS_COST),
    text: '✈️ 【CAS 请求确认】{USER} 呼叫空中支援！一架 苏-30SM2 呼啸而过...\n"全体目光向我看齐！狂暴轰入！！！"',
    onExecute: (ctx) => {
      const candidates = (ctx.currentTargets ?? []).filter((fighter) => isCasEligibleTarget(ctx, fighter));
      const hasLaserDesignation = hasMechanic(ctx.user, 'AIM');
      const cost = hasLaserDesignation ? WT_PRECISE_CAS_COST : WT_CAS_COST;
      if (!spendSpawnPoints(ctx.user, cost)) {
        ctx.log('info', `✈️ 【CAS请求失败】${ctx.user.name} 出生点不足，空军排队中！（需要 ${cost} SP，当前 ${ctx.user.wtSpawnPoints ?? 0}/${WT_SP_MAX}）`);
        return true;
      }
      const preferred = preferredTarget(ctx);
      const primary = isCasEligibleTarget(ctx, preferred) ? preferred : (isCasEligibleTarget(ctx, ctx.target) ? ctx.target : candidates[0]);
      if (!primary) return true;

      const splashTargets = candidates
        .filter((fighter) => fighter.id !== primary.id)
        .sort(() => 0.5 - Math.random())
        .slice(0, CAS_MAX_TARGETS - 1);
      const enemies = [primary, ...splashTargets];
      const effectiveAtk = ctx.getEffectiveStat(ctx.user, 'atk');
      const mainDmg = Math.floor(effectiveAtk * (hasLaserDesignation ? CAS_DESIGNATED_MAIN_DAMAGE_MULT : CAS_MAIN_DAMAGE_MULT));
      const splashDmg = Math.floor(effectiveAtk * (hasLaserDesignation ? CAS_DESIGNATED_SPLASH_DAMAGE_MULT : CAS_SPLASH_DAMAGE_MULT));
      let lethalOutcomeTriggered = false;

      ctx.setVisualTargets(enemies);
      ctx.log('skill', hasLaserDesignation
        ? `✈️ 【苏-30SM2 精确CAS】${ctx.user.name} 消耗 ${cost} SP 上传激光测距坐标，主目标 ${primary.name} 被战机锁定！`
        : `✈️ 【苏-30SM2 洗地】${ctx.user.name} 消耗 ${cost} SP 呼叫空中支援，航弹将重点轰炸 ${primary.name} 并压制周边目标！`);

      for (const [index, e] of enemies.entries()) {
        if (!isActiveCombatant(ctx.user)) break;
        if (!isCasEligibleTarget(ctx, e)) continue;
        const isPrimary = index === 0;
        const targetMetadata = {
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          targetIds: [e.id],
        };
        const invul = findDefenseStatus(e, 'INVUL');
        if (invul) {
          ctx.log('info', formatInvul(invul, e.name, `${ctx.user.name}的【苏-30SM2空袭】`), targetMetadata);
          continue;
        }

        const spellBlock = consumeSpellBlock(e);
        if (spellBlock) {
          const healing = resolveHealing(
            e,
            Math.floor(e.maxHp * 0.15),
            {},
            (type, text) => ctx.log(type, text, {
              actorId: e.id,
              actorName: e.name,
              targetIds: [e.id],
            }),
          );
          const healText = healing.actual > 0
            ? `，并恢复了 ${healing.actual} 点生命`
            : healing.outcome === 'blocked'
              ? '，但附带治疗被完全阻止'
              : '，但生命已满，治疗溢出';
          ctx.log(
            'info',
            formatSpellBlock(spellBlock, e.name, `${ctx.user.name}的【苏-30SM2空袭】`, healText),
            targetMetadata,
          );
          continue;
        }

        let plannedDmg = isPrimary ? mainDmg : splashDmg;
        if (!isPrimary && !isSurtrAfterglowActive(e) && plannedDmg >= e.currentHp) {
          plannedDmg = Math.max(0, e.currentHp - 1);
        }

        const damageOptions: DamageApplicationOptions = {
          actionName: '苏-30SM2 洗地',
          deferStatusAftermath: true,
        };
        const actualDmg = ctx.applyDamage(e, plannedDmg, 'skill', true, ctx.user, damageOptions);
        if (damageOptions.targetWithdrawnDuringDamage) {
          ctx.flushDeferredDamageEvents?.();
          continue;
        }
        if (isDamageRedirected(damageOptions)) continue;
        const connected = didDamageConnect(actualDmg, damageOptions);
        const airborneImmune = findDefenseStatus(e, 'BKB') || findDefenseStatus(e, 'INVUL');
        if (!connected) {
          ctx.log('info', `💥 轰炸冲击被化解！${e.name} 没有承受实际伤害，也没有被【击飞】！`);
        } else if (actualDmg <= 0 && airborneImmune) {
          ctx.log('crit', `💥 ${isPrimary ? '主目标精确命中' : '爆风余波波及'}！攻击命中 ${e.name}；【黄昏余命】令其不再损失生命，同时${formatControlBlocked(airborneImmune, e.name, isPrimary ? '击飞效果' : '火力压制效果').replace(/^🟡\s*/, '')}`);
        } else if (actualDmg <= 0) {
          ctx.log('crit', `💥 ${isPrimary ? '主目标精确命中' : '爆风余波波及'}！攻击命中 ${e.name}；【黄昏余命】期间未再损失生命。`);
        } else if (airborneImmune) {
          ctx.log('crit', `💥 ${isPrimary ? '主目标精确命中' : '爆风余波波及'}！${e.name} 承受了 ${actualDmg} 点真实伤害，但${formatControlBlocked(airborneImmune, e.name, isPrimary ? '击飞效果' : '火力压制效果').replace(/^🟡\s*/, '')}`);
        } else {
          ctx.log('crit', `💥 ${isPrimary ? '主目标精确命中' : '爆风余波波及'}！${e.name} 承受了 ${actualDmg} 点真实伤害！`);
        }

        ctx.flushDeferredDamageEvents?.();
        if (connected && !airborneImmune && e.currentHp > 0 && !e.isDead && !e.isDeadAnnounced) {
          ctx.applyStatus(e, {
            identityId: isPrimary ? 'AIRBORNE' : 'WT_SUPPRESS',
            remainingTurns: 1,
            attribution: { effectSourceId: isPrimary ? 'war_thunder_airborne' : undefined },
          });
        }

        const ammoRackPct = isPrimary
          ? (hasLaserDesignation ? CAS_DESIGNATED_MAIN_AMMO_RACK_PCT : CAS_MAIN_AMMO_RACK_PCT)
          : (hasLaserDesignation ? CAS_DESIGNATED_SPLASH_AMMO_RACK_PCT : CAS_SPLASH_AMMO_RACK_PCT);
        if (!lethalOutcomeTriggered && actualDmg > 0 && e.currentHp > 0 && getSurtrTacticalHpPct(e) < ammoRackPct) {
          const originium = isOriginiumEntity(e);
          lethalOutcomeTriggered = tryExecuteDefeat(ctx, e, originium ? '源石核心崩解' : '弹药架殉爆', {
            message: originium
              ? `◆ 【源石核心崩解】${e.name} 的源石核心被航弹冲击震碎，晶体当场崩解！`
              : `☠️ 【弹药架殉爆】${e.name} 在轰炸中不幸弹药库殉爆，瞬间气化！`,
            killer: ctx.user,
          }) || lethalOutcomeTriggered;
        }

        if (e.currentHp <= 0 && !e.isDeadAnnounced && !e.isDead) {
          lethalOutcomeTriggered = ctx.markDefeated(e, { message: `💀 【CAS击杀】${e.name} 被苏-30SM2的航弹炸回了机库！`, killer: ctx.user }) || lethalOutcomeTriggered;
        }
      }
      if (hasLaserDesignation) {
        consumeAim(ctx.user);
        ctx.log(
          'info',
          `🎯 ${ctx.user.name} 消耗了激光测距坐标，本次 CAS 的精确打击窗口关闭。`,
          {
            actorId: ctx.user.id,
            actorName: ctx.user.name,
            targetIds: [ctx.user.id],
          },
        );
      }
      ctx.user.wtMarkedTargetId = undefined;
      return true;
    },
  },
};
