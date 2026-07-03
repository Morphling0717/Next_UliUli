import type { DamageApplicationOptions, Fighter, SkillContext, SkillDefinition } from '../types';
import { namerenaData as Data } from '../data';
import { healFighter, isActiveCombatant, setCurrentHp } from '../combatState';
import {
  consumeSpellBlock,
  findDefenseStatus,
  formatControlBlocked,
  formatInvul,
  formatSpellBlock,
  grantStatus,
} from '../defenseStatus';

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
  'STUN', 'FREEZE', 'CONFUSED', 'CHARMED', 'WT_SUPPRESS', 'WT_AIRBORNE', 'VALO_AIM_PUNCH', 'NEURAL_THEFT_DEBUFF', 'ZEROED',
]);

const WT_MODULE_STATUSES = new Set(['WT_BREECH_DAMAGED', 'WT_TRACK_DAMAGED', 'WT_AMMO_EXPOSED', 'WT_SCOUTED']);

function hasStatus(fighter: Fighter, type: string): boolean {
  return fighter.status.some((status) => status.type === type);
}

function refreshStatus(fighter: Fighter, type: string, duration: number, sourceId?: string): void {
  grantStatus(fighter, type, duration, sourceId);
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
  let score = fighter.atk + fighter.mag + fighter.spd * 0.55 + fighter.wis * 0.35;
  if (fighter.hpPct < 0.35) score += 260;
  if (hasStatus(fighter, 'WT_SCOUTED')) score += 260;
  if (hasStatus(fighter, 'WT_AMMO_EXPOSED')) score += 320;
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

function exposeModule(ctx: SkillContext, target: Fighter, type: string, duration: number, text: string): void {
  if (!isActiveCombatant(target) || hasStatus(target, 'BKB')) return;
  refreshStatus(target, type, duration);
  ctx.log('info', text);
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
  const exposed = hasStatus(target, 'WT_AMMO_EXPOSED') || hasStatus(target, 'WT_SCOUTED');
  const threshold = exposed ? 0.34 : 0.24;
  const chance = exposed ? 0.34 : 0.18;
  if (target.hpPct >= threshold || Math.random() >= chance) return false;
  setCurrentHp(target, 0);
  return ctx.markDefeated(target, {
    message: `☠️ 【弹药架殉爆】${actionName} 精准命中 ${target.name} 的弹药区，炮塔飞上天！`,
    killer: ctx.user,
    setHpZero: false,
  });
}

function consumeAim(user: Fighter): boolean {
  const hadAim = hasStatus(user, 'AIM');
  if (hadAim) user.status = user.status.filter((status) => status.type !== 'AIM');
  return hadAim;
}

function isCasEligibleTarget(ctx: SkillContext, fighter: SkillContext['target'] | undefined): boolean {
  return (
    !!fighter &&
    fighter.id !== ctx.user.id &&
    fighter.currentHp > 0 &&
    !fighter.isDead &&
    !fighter.isDeadAnnounced &&
    ctx.getTeamId(fighter) !== ctx.getTeamId(ctx.user) &&
    !fighter.status.some((status) => status.type === 'SYNERGY_SLACKING')
  );
}

export const warThunderSkills: Record<string, SkillDefinition> = {
  wt_attack_d_point: {
    name: '快捷语音', tag: SKILL_TAGS.BUFF,
    text: '📻 {USER} 疯狂按T-3-4发送无线电："【保卫D点！】【攻击D点！】"\n毫无意义的指令让 {USER} 自己陷入了深深的【混乱】，同时己方火力系统莫名振奋（攻击力上升）！',
    onExecute: (ctx) => {
      ctx.user.status.push({ type: 'CONFUSED', duration: 2 });
      const allies = (ctx.fighters ?? []).filter((f) => !f.isDead && ctx.getTeamId(f) === ctx.getTeamId(ctx.user));
      allies.forEach((a) => { a.atk = Math.floor(a.atk * 1.3); });
      ctx.log('buff', `📻 ${ctx.user.name} 疯狂按T-3-4发送无线电："【保卫D点！】【攻击D点！】"\n毫无意义的指令让 ${ctx.user.name} 自己陷入了深深的【混乱】，同时己方火力系统莫名振奋（攻击力上升）！`);
      return true;
    },
  },
  wt_repair: {
    name: '长按F修车', tag: SKILL_TAGS.HEAL, condition: (u) => u.hpPct < 0.6,
    text: '🔧 {USER} 载具受损！黑炮管了！"长按F进行战地抢修（50秒）"\n{USER} 原地瘫痪（眩晕），但装甲逐渐恢复，回复了海量生命值！',
    onExecute: (ctx) => {
      ctx.user.status.push({ type: 'STUN', duration: 2 });
      const healed = healFighter(ctx.user, Math.floor(ctx.user.maxHp * 0.4));
      const healText = healed > 0 ? `实际恢复 ${healed} 点生命` : '生命已满，治疗溢出';
      ctx.log('heal', `🔧 【战地抢修】履带接上了！炮闩修好了！${ctx.user.name} ${healText}！`);
      return true;
    },
  },
  wt_repair_premium: {
    name: '王牌乘员抢修', tag: SKILL_TAGS.HEAL,
    condition: (u) =>
      u.hpPct < 0.72 ||
      u.status.some((status) =>
        status.type === 'BURN' ||
        status.type === 'POISON' ||
        WT_CONTROL_CLEAN.has(status.type) ||
        WT_MODULE_STATUSES.has(status.type),
      ),
    text: '🔧 {USER} 载具受损！但【王牌乘员组】迅速介入！"履带断了？几秒钟的事！"\n{USER} 瞬间完成抢修，清除了所有负面状态，并恢复了巨量生命值！',
    onExecute: (ctx) => {
      const hadBurn = hasStatus(ctx.user, 'BURN');
      const hadPoison = hasStatus(ctx.user, 'POISON');
      const fpeUsed = hadBurn && (ctx.user.wtFpeCharges ?? 0) > 0;
      const nbcsUsed = hadPoison && (ctx.user.wtNbcsCharges ?? 0) > 0;
      const hadCrewControl = ctx.user.status.some((status) => WT_CONTROL_CLEAN.has(status.type));
      const hadModuleDamage = ctx.user.status.some((status) => WT_MODULE_STATUSES.has(status.type));
      const spentSp = (ctx.user.wtSpawnPoints ?? 0) >= 2 && (ctx.user.hpPct < 0.34 || (hadCrewControl && ctx.user.hpPct < 0.56) || (hadModuleDamage && ctx.user.hpPct < 0.56));

      if (fpeUsed) ctx.user.wtFpeCharges = Math.max(0, (ctx.user.wtFpeCharges ?? 0) - 1);
      if (nbcsUsed) ctx.user.wtNbcsCharges = Math.max(0, (ctx.user.wtNbcsCharges ?? 0) - 1);
      if (spentSp) spendSpawnPoints(ctx.user, 2);

      ctx.user.status = ctx.user.status.filter((s) => {
        if (s.type === 'BURN') return !fpeUsed;
        if (s.type === 'POISON') return !nbcsUsed;
        return !WT_CONTROL_CLEAN.has(s.type) && !WT_MODULE_STATUSES.has(s.type) && !['BLIND', 'SILENCE', 'WT_REPAIRING', 'NO_HEAL', 'WEAK'].includes(s.type);
      });

      const healPct = spentSp ? 0.46 : 0.26;
      const healed = healFighter(ctx.user, Math.floor(ctx.user.maxHp * healPct));
      const healText = healed > 0 ? `实际恢复 ${healed} 点生命` : '生命已满，治疗溢出';
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
      if (hadCrewControl || hadModuleDamage) {
        ctx.log('buff', `🔧 【王牌乘员】${ctx.user.name} 更换乘员、接上履带、修复炮闩，重新获得作战能力！`);
      }
      refreshStatus(ctx.user, 'SPELL_BLOCK', 1, 'war_thunder_repair');
      if (spentSp) refreshStatus(ctx.user, 'BKB', 1, 'war_thunder_repair');
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
        ctx.user.status.push({ type: 'RAGE', duration: 2 });
        return true;
      }
      return false;
    },
    afterExecute: (ctx, actualDmg) => {
      if (!isTopTierWt(ctx.user) || actualDmg <= 0 || !isActiveCombatant(ctx.target)) return;
      grantDamageSpawnPoint(ctx, actualDmg, ctx.target);
      const moduleRoll = Math.random();
      if (moduleRoll < 0.5) {
        exposeModule(ctx, ctx.target, 'WT_BREECH_DAMAGED', 3, `🔩 【模块破坏】${ctx.user.name} 的钢针击穿炮闩，${ctx.target.name} 主武器输出下降！`);
      } else {
        exposeModule(ctx, ctx.target, 'WT_AMMO_EXPOSED', 3, `💥 【模块破坏】${ctx.user.name} 的钢针擦过弹药区，${ctx.target.name} 弹药架暴露！`);
      }
      maybeAmmoRack(ctx, ctx.target, actualDmg, '脱壳穿甲弹');
    },
  },
  wt_magic_ricochet: {
    name: '魔法跳弹', tag: SKILL_TAGS.BUFF, status: 'INVUL', statusSource: 'war_thunder_ricochet',
    text: '🛡️ {USER} 摆出了刁钻的倾斜装甲角度，大喊："BVVD保佑！"\n触发战雷经典【魔法跳弹】，浑身散发斯大林合金的光辉，免疫接下来的所有伤害！',
    onExecute: (ctx) => {
      refreshStatus(ctx.user, 'INVUL', 1, 'war_thunder_ricochet');
      ctx.log('buff', `🛡️ ${ctx.user.name} 摆出了刁钻的倾斜装甲角度，大喊："BVVD保佑！" 触发战雷经典【魔法跳弹】，免疫接下来的所有伤害！`);
      return true;
    },
  },
  wt_magic_ricochet_premium: {
    name: '顶级魔法跳弹', tag: SKILL_TAGS.BUFF, status: 'INVUL', statusSource: 'war_thunder_top_ricochet', cleanStatus: true,
    text: '🛡️ {USER} 摆出了无懈可击的完美倾斜角度，复合装甲闪耀着魔法的光辉！\n大喊："BVVD保佑！" 触发【顶级魔法跳弹】，清除了自身负面状态，并绝对免疫接下来的所有伤害！',
    onExecute: (ctx) => {
      ctx.user.status = ctx.user.status.filter((status) =>
        !WT_CONTROL_CLEAN.has(status.type) &&
        !WT_MODULE_STATUSES.has(status.type) &&
        !['BLIND', 'SILENCE', 'VALO_FLASH', 'VALO_AIM_PUNCH', 'NEURAL_THEFT_DEBUFF', 'WEAK', 'ZEROED'].includes(status.type),
      );
      refreshStatus(ctx.user, 'INVUL', 1, 'war_thunder_top_ricochet');
      refreshStatus(ctx.user, 'SPELL_BLOCK', 1, 'war_thunder_top_ricochet');
      const before = ctx.user.wtSpawnPoints ?? 0;
      const current = Math.random() < 0.35 ? gainSpawnPoints(ctx.user, 1) : before;
      ctx.log('buff', `🛡️ ${ctx.user.name} 摆出完美倾斜角度，复合装甲与烟幕齐开！触发【顶级魔法跳弹】，清除控制/模块异常并进入跳弹保护窗口！`);
      if (current > before) ctx.log('buff', `🪖 【生存收益】跳弹骗炮成功，出生点 +1！（当前 SP ${current}/${WT_SP_MAX}）`);
      return true;
    },
  },
  wt_laser_rangefinder: {
    name: '激光测距仪', tag: SKILL_TAGS.BUFF, status: 'AIM',
    text: '🔭 {USER} 开启热成像与激光测距仪，锁定目标！\n下一次攻击必定暴击、无法闪避；若呼叫苏-30SM2，将获得精确CAS引导！',
    onExecute: (ctx) => {
      const target = preferredTarget(ctx);
      refreshStatus(ctx.user, 'AIM', 2);
      refreshStatus(target, 'WT_SCOUTED', 3);
      ctx.user.wtMarkedTargetId = target.id;
      const before = ctx.user.wtSpawnPoints ?? 0;
      const current = Math.random() < 0.45 ? gainSpawnPoints(ctx.user, 1) : before;
      ctx.log('buff', `🔭 【激光测距仪】${ctx.user.name} 开启热成像与激光测距仪，锁定 ${target.name}！下一轮火控/精确 CAS 会优先处理该目标。`);
      if (current > before) ctx.log('buff', `🪖 【侦察收益】有效侦察上传，出生点 +1！（当前 SP ${current}/${WT_SP_MAX}）`);
      return true;
    },
  },
  wt_bmpt_suppress: {
    name: 'BMPT死亡收割机', tag: SKILL_TAGS.PHYS, mult: 0.58, hits: 5, status: 'WT_SUPPRESS', alwaysHit: true,
    text: '🚜 {USER} 召唤巨大 BMPT 终结者！双联装30毫米机炮狂啸！\n"哒哒哒哒哒！" 对 {TARGET} 倾泻 5 段火力（共 {VAL} 伤害）并形成绝对【火力压制】！',
    afterExecute: (ctx, actualDmg) => {
      if (!isTopTierWt(ctx.user) || actualDmg <= 0 || !isActiveCombatant(ctx.target)) return;
      grantDamageSpawnPoint(ctx, actualDmg, ctx.target);
      exposeModule(ctx, ctx.target, 'WT_TRACK_DAMAGED', 2, `🛞 【履带断裂】${ctx.user.name} 的机炮扫断 ${ctx.target.name} 的机动部件，闪避归零！`);
      if (Math.random() < 0.35) {
        exposeModule(ctx, ctx.target, 'WT_BREECH_DAMAGED', 2, `🔩 【炮闩受损】BMPT 火力压制打坏 ${ctx.target.name} 的输出节奏！`);
      }
    },
  },
  wt_t58_knockup: {
    name: 'T-58 碎甲轰击', tag: SKILL_TAGS.PHYS, mult: 4.35, ignoreDef: true, status: 'WT_AIRBORNE',
    text: '💥 {USER} 召唤 T-58 重型坦克！155毫米线膛炮锁定！\n"一发入魂！" 粗壮的钢针瞬间粉碎了 {TARGET} 的装甲，造成 {VAL} 真实伤害并将其当场【击飞】！',
    afterExecute: (ctx, actualDmg) => {
      if (!isTopTierWt(ctx.user)) return;
      if (actualDmg > 0 && isActiveCombatant(ctx.target)) {
        grantDamageSpawnPoint(ctx, actualDmg, ctx.target);
        exposeModule(ctx, ctx.target, 'WT_AMMO_EXPOSED', 3, `💥 【弹药架暴露】T-58 大口径碎甲让 ${ctx.target.name} 的内部弹药区完全暴露！`);
      }
      if (ctx.target.currentHp > 0 && ctx.target.hpPct < (hasStatus(ctx.target, 'WT_AMMO_EXPOSED') ? 0.34 : 0.26) && !ctx.target.transformed && Math.random() < 0.36) {
        setCurrentHp(ctx.target, 0);
        ctx.markDefeated(ctx.target, { message: `☠️ 【弹药架殉爆】轰！！！T-58 的动能直接引爆了 ${ctx.target.name} 的弹药架！炮塔被炸飞了十几米高！完成极硬核斩杀！`, killer: ctx.user, setHpZero: false });
      }
    },
  },
  wt_su30_cas: {
    name: '苏-30SM2 狂暴轰入', tag: SKILL_TAGS.PHYS, ignoreDef: true,
    condition: (u) => (u.wtSpawnPoints ?? 0) >= (u.status.some((status) => status.type === 'AIM') ? WT_PRECISE_CAS_COST : WT_CAS_COST),
    text: '✈️ 【CAS 请求确认】{USER} 呼叫空中支援！一架 苏-30SM2 呼啸而过...\n"全体目光向我看齐！狂暴轰入！！！"',
    onExecute: (ctx) => {
      const candidates = (ctx.currentTargets ?? []).filter((fighter) => isCasEligibleTarget(ctx, fighter));
      const hasLaserDesignation = ctx.user.status.some((status) => status.type === 'AIM');
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
      const mainDmg = Math.floor(ctx.user.atk * (hasLaserDesignation ? CAS_DESIGNATED_MAIN_DAMAGE_MULT : CAS_MAIN_DAMAGE_MULT));
      const splashDmg = Math.floor(ctx.user.atk * (hasLaserDesignation ? CAS_DESIGNATED_SPLASH_DAMAGE_MULT : CAS_SPLASH_DAMAGE_MULT));
      let lethalOutcomeTriggered = false;

      ctx.log('skill', hasLaserDesignation
        ? `✈️ 【苏-30SM2 精确CAS】${ctx.user.name} 消耗 ${cost} SP 上传激光测距坐标，主目标 ${primary.name} 被战机锁定！`
        : `✈️ 【苏-30SM2 洗地】${ctx.user.name} 消耗 ${cost} SP 呼叫空中支援，航弹将重点轰炸 ${primary.name} 并压制周边目标！`);

      for (const [index, e] of enemies.entries()) {
        if (!isActiveCombatant(ctx.user)) break;
        if (e.currentHp <= 0 || e.isDead || e.isDeadAnnounced || e.status.some((status) => status.type === 'SYNERGY_SLACKING')) continue;
        const isPrimary = index === 0;
        const invul = findDefenseStatus(e, 'INVUL');
        if (invul) {
          ctx.log('info', formatInvul(invul, e.name, `${ctx.user.name}的【苏-30SM2空袭】`));
          continue;
        }

        const spellBlock = consumeSpellBlock(e);
        if (spellBlock) {
          const healed = healFighter(e, Math.floor(e.maxHp * 0.15));
          const healText = healed > 0 ? `，并恢复了 ${healed} 点生命` : '，但生命已满，治疗溢出';
          ctx.log('info', formatSpellBlock(spellBlock, e.name, `${ctx.user.name}的【苏-30SM2空袭】`, healText));
          continue;
        }

        let plannedDmg = isPrimary ? mainDmg : splashDmg;
        if (!isPrimary && plannedDmg >= e.currentHp) {
          plannedDmg = Math.max(0, e.currentHp - 1);
        }

        const damageOptions: DamageApplicationOptions = { actionName: '苏-30SM2 洗地' };
        const actualDmg = ctx.applyDamage(e, plannedDmg, 'skill', true, ctx.user, damageOptions);
        if (damageOptions.redirectedByJoker) continue;
        const airborneImmune = findDefenseStatus(e, 'BKB') || findDefenseStatus(e, 'INVUL');
        ctx.user.stats.dmgDealt += actualDmg;
        if (actualDmg <= 0) {
          ctx.log('info', `💥 轰炸冲击被化解！${e.name} 没有承受实际伤害，也没有被【击飞】！`);
        } else if (airborneImmune) {
          ctx.log('crit', `💥 ${isPrimary ? '主目标精确命中' : '爆风余波波及'}！${e.name} 承受了 ${actualDmg} 点真实伤害，但${formatControlBlocked(airborneImmune, e.name, isPrimary ? '击飞效果' : '火力压制效果').replace(/^🟡\s*/, '')}`);
        } else {
          const controlName = isPrimary ? '击飞' : '火力压制';
          ctx.log('crit', `💥 ${isPrimary ? '主目标精确命中' : '爆风余波波及'}！${e.name} 承受了 ${actualDmg} 点真实伤害并被【${controlName}】！`);
        }

        ctx.flushDeferredDamageEvents?.();
        if (actualDmg > 0 && !airborneImmune && e.currentHp > 0 && !e.isDead && !e.isDeadAnnounced) {
          e.status.push({ type: isPrimary ? 'WT_AIRBORNE' : 'WT_SUPPRESS', duration: isPrimary ? 2 : 1 });
        }

        const ammoRackPct = isPrimary
          ? (hasLaserDesignation ? CAS_DESIGNATED_MAIN_AMMO_RACK_PCT : CAS_MAIN_AMMO_RACK_PCT)
          : (hasLaserDesignation ? CAS_DESIGNATED_SPLASH_AMMO_RACK_PCT : CAS_SPLASH_AMMO_RACK_PCT);
        if (!lethalOutcomeTriggered && actualDmg > 0 && e.currentHp > 0 && e.hpPct < ammoRackPct) {
          setCurrentHp(e, 0);
          lethalOutcomeTriggered = ctx.markDefeated(e, { message: `☠️ 【弹药架殉爆】${e.name} 在轰炸中不幸弹药库殉爆，瞬间气化！`, killer: ctx.user, setHpZero: false }) || lethalOutcomeTriggered;
        }

        if (e.currentHp <= 0 && !e.isDeadAnnounced && !e.isDead) {
          lethalOutcomeTriggered = ctx.markDefeated(e, { message: `💀 【CAS击杀】${e.name} 被苏-30SM2的航弹炸回了机库！`, killer: ctx.user }) || lethalOutcomeTriggered;
        }
      }
      if (hasLaserDesignation) {
        consumeAim(ctx.user);
        ctx.log('info', `🎯 ${ctx.user.name} 消耗了激光测距坐标，本次 CAS 的精确打击窗口关闭。`);
      }
      ctx.user.wtMarkedTargetId = undefined;
      return true;
    },
  },
};
