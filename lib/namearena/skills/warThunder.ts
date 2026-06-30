import type { DamageApplicationOptions, SkillContext, SkillDefinition } from '../types';
import { namerenaData as Data } from '../data';
import { healFighter, isActiveCombatant, setCurrentHp } from '../combatState';

const { SKILL_TAGS } = Data;

const CAS_MAX_TARGETS = 4;
const CAS_MAIN_DAMAGE_MULT = 2.8;
const CAS_DESIGNATED_MAIN_DAMAGE_MULT = 3.2;
const CAS_SPLASH_DAMAGE_MULT = 1.25;
const CAS_DESIGNATED_SPLASH_DAMAGE_MULT = 1.55;
const CAS_MAIN_AMMO_RACK_PCT = 0.22;
const CAS_DESIGNATED_MAIN_AMMO_RACK_PCT = 0.30;
const CAS_SPLASH_AMMO_RACK_PCT = 0.10;
const CAS_DESIGNATED_SPLASH_AMMO_RACK_PCT = 0.15;

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
    name: '王牌乘员抢修', tag: SKILL_TAGS.HEAL, condition: (u) => u.hpPct < 0.6,
    text: '🔧 {USER} 载具受损！但【王牌乘员组】迅速介入！"履带断了？几秒钟的事！"\n{USER} 瞬间完成抢修，清除了所有负面状态，并恢复了巨量生命值！',
    onExecute: (ctx) => {
      const healed = healFighter(ctx.user, Math.floor(ctx.user.maxHp * 0.6));
      ctx.user.status = ctx.user.status.filter(
        (s) => !['STUN', 'FREEZE', 'BURN', 'POISON', 'BLIND', 'SILENCE', 'CONFUSED', 'CHARMED', 'WT_SUPPRESS', 'WT_AIRBORNE', 'WT_REPAIRING'].includes(s.type),
      );
      const healText = healed > 0 ? `实际恢复 ${healed} 点生命` : '生命已满，治疗溢出';
      ctx.log('heal', `🔧 【王牌乘员】顶级金币车待遇！炮闩履带瞬间复原！${ctx.user.name} ${healText}并解除了异常状态！`);
      return true;
    },
  },
  wt_apfsds: {
    name: '脱壳穿甲弹', tag: SKILL_TAGS.PHYS, mult: 1.5, ignoreDef: true,
    text: '🎯 {USER} 测距完毕，装填钢针(APFSDS)！\n"出膛！" 一发尾翼稳定脱壳穿甲弹贯穿了 {TARGET}，造成 {VAL} 真实伤害！',
    onExecute: (ctx) => {
      if (Math.random() < 0.05) {
        ctx.log('info', `👻 【安东星魔法】服务器丢包了！${ctx.user.name} 的钢针变成了【幽灵炮弹】，直接穿模透过了 ${ctx.target.name} 的身体！伤害为 0！(血压飙升)`);
        ctx.user.status.push({ type: 'RAGE', duration: 2 });
        return true;
      }
      return false;
    },
  },
  wt_magic_ricochet: {
    name: '魔法跳弹', tag: SKILL_TAGS.BUFF, status: 'INVUL',
    text: '🛡️ {USER} 摆出了刁钻的倾斜装甲角度，大喊："BVVD保佑！"\n触发战雷经典【魔法跳弹】，浑身散发斯大林合金的光辉，免疫接下来的所有伤害！',
  },
  wt_magic_ricochet_premium: {
    name: '顶级魔法跳弹', tag: SKILL_TAGS.BUFF, status: 'INVUL', cleanStatus: true,
    text: '🛡️ {USER} 摆出了无懈可击的完美倾斜角度，复合装甲闪耀着魔法的光辉！\n大喊："BVVD保佑！" 触发【顶级魔法跳弹】，清除了自身负面状态，并绝对免疫接下来的所有伤害！',
  },
  wt_laser_rangefinder: {
    name: '激光测距仪', tag: SKILL_TAGS.BUFF, status: 'AIM',
    text: '🔭 {USER} 开启热成像与激光测距仪，锁定目标！\n下一次攻击必定暴击、无法闪避；若呼叫苏-30SM2，将获得精确CAS引导！',
  },
  wt_bmpt_suppress: {
    name: 'BMPT死亡收割机', tag: SKILL_TAGS.PHYS, mult: 0.6, hits: 5, status: 'WT_SUPPRESS', alwaysHit: true,
    text: '🚜 {USER} 召唤巨大 BMPT 终结者！双联装30毫米机炮狂啸！\n"哒哒哒哒哒！" 对 {TARGET} 倾泻 5 段火力（共 {VAL} 伤害）并形成绝对【火力压制】！',
  },
  wt_t58_knockup: {
    name: 'T-58 碎甲轰击', tag: SKILL_TAGS.PHYS, mult: 4.5, ignoreDef: true, status: 'WT_AIRBORNE',
    text: '💥 {USER} 召唤 T-58 重型坦克！155毫米线膛炮锁定！\n"一发入魂！" 粗壮的钢针瞬间粉碎了 {TARGET} 的装甲，造成 {VAL} 真实伤害并将其当场【击飞】！',
    afterExecute: (ctx) => {
      if (ctx.target.currentHp > 0 && ctx.target.hpPct < 0.35 && !ctx.target.transformed) {
        setCurrentHp(ctx.target, 0);
        ctx.markDefeated(ctx.target, { message: `☠️ 【弹药架殉爆】轰！！！T-58 的动能直接引爆了 ${ctx.target.name} 的弹药架！炮塔被炸飞了十几米高！完成极硬核斩杀！`, killer: ctx.user, setHpZero: false });
      }
    },
  },
  wt_su30_cas: {
    name: '苏-30SM2 狂暴轰入', tag: SKILL_TAGS.PHYS, ignoreDef: true,
    text: '✈️ 【CAS 请求确认】{USER} 呼叫空中支援！一架 苏-30SM2 呼啸而过...\n"全体目光向我看齐！狂暴轰入！！！"',
    onExecute: (ctx) => {
      const candidates = (ctx.currentTargets ?? []).filter((fighter) => isCasEligibleTarget(ctx, fighter));
      const primary = isCasEligibleTarget(ctx, ctx.target) ? ctx.target : candidates[0];
      if (!primary) return true;

      const splashTargets = candidates
        .filter((fighter) => fighter.id !== primary.id)
        .sort(() => 0.5 - Math.random())
        .slice(0, CAS_MAX_TARGETS - 1);
      const enemies = [primary, ...splashTargets];
      const hasLaserDesignation = ctx.user.status.some((status) => status.type === 'AIM');
      const mainDmg = Math.floor(ctx.user.atk * (hasLaserDesignation ? CAS_DESIGNATED_MAIN_DAMAGE_MULT : CAS_MAIN_DAMAGE_MULT));
      const splashDmg = Math.floor(ctx.user.atk * (hasLaserDesignation ? CAS_DESIGNATED_SPLASH_DAMAGE_MULT : CAS_SPLASH_DAMAGE_MULT));
      let lethalOutcomeTriggered = false;

      ctx.log('skill', hasLaserDesignation
        ? `✈️ 【苏-30SM2 精确CAS】${ctx.user.name} 上传激光测距坐标，主目标 ${primary.name} 被战机锁定！`
        : `✈️ 【苏-30SM2 洗地】${ctx.user.name} 呼叫空中支援，航弹将重点轰炸 ${primary.name} 并压制周边目标！`);

      for (const [index, e] of enemies.entries()) {
        if (!isActiveCombatant(ctx.user)) break;
        if (e.currentHp <= 0 || e.isDead || e.isDeadAnnounced || e.status.some((status) => status.type === 'SYNERGY_SLACKING')) continue;
        const isPrimary = index === 0;
        if (e.status.some((s) => s.type === 'INVUL')) {
          ctx.log('info', `🛡️ ${e.name} 免疫了 ${ctx.user.name} 的空袭伤害！`);
          continue;
        }

        if (e.status.some((s) => s.type === 'SPELL_BLOCK')) {
          e.status = e.status.filter((s) => s.type !== 'SPELL_BLOCK');
          const healed = healFighter(e, Math.floor(e.maxHp * 0.15));
          const healText = healed > 0 ? `，并恢复了 ${healed} 点生命` : '，但生命已满，治疗溢出';
          ctx.log('info', `🔵 庇护之音！林肯法球(或特种装甲)的光幕为 ${e.name} 挡下了 ${ctx.user.name} 的空袭${healText}！`);
          continue;
        }

        let plannedDmg = isPrimary ? mainDmg : splashDmg;
        if (!isPrimary && plannedDmg >= e.currentHp) {
          plannedDmg = Math.max(0, e.currentHp - 1);
        }

        const damageOptions: DamageApplicationOptions = { actionName: '苏-30SM2 洗地' };
        const actualDmg = ctx.applyDamage(e, plannedDmg, 'skill', true, ctx.user, damageOptions);
        if (damageOptions.redirectedByJoker) continue;
        const airborneImmune = e.status.some((s) => s.type === 'BKB' || s.type === 'INVUL');
        ctx.user.stats.dmgDealt += actualDmg;
        if (actualDmg <= 0) {
          ctx.log('info', `💥 轰炸冲击被化解！${e.name} 没有承受实际伤害，也没有被【击飞】！`);
        } else if (airborneImmune) {
          ctx.log('crit', `💥 ${isPrimary ? '主目标精确命中' : '爆风余波波及'}！${e.name} 承受了 ${actualDmg} 点真实伤害，但免疫了控制效果！`);
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
        ctx.user.status = ctx.user.status.filter((status) => status.type !== 'AIM');
        ctx.log('info', `🎯 ${ctx.user.name} 消耗了激光测距坐标，本次 CAS 的精确打击窗口关闭。`);
      }
      return true;
    },
  },
};
