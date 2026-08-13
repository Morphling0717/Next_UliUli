import type { BattleEngineData, BattleLogMetadata, BattleState, Fighter, GachaEntry, SkillDefinition } from './types';
import {
  grantGachaLuck,
  isLuckEmperor,
  resolveLuckEmperorSsrDraw,
} from './gachaMechanics';
import { getEffectiveCombatStat } from './statusMechanics';

export interface SkillResolutionRuntime {
  skills: Record<string, SkillDefinition>;
  data: BattleEngineData;
  fighters?: Fighter[];
  battleState?: BattleState;
  turnCount?: number;
  getTeamId?: (fighter: Fighter) => string;
  isActiveCombatant?: (fighter: Fighter) => boolean;
  log: (type: string, text: string, metadata?: BattleLogMetadata) => void;
}

export function resolveSkillDefinition(
  runtime: SkillResolutionRuntime,
  skillId: string | null,
  user: Fighter,
): SkillDefinition {
  let skill: SkillDefinition | null = skillId ? runtime.skills[skillId] : null;

  if (skillId === 'chimera_install' && skill?.pool) {
    const gachaPool = skill.pool as GachaEntry[];
    const availablePlugs = gachaPool.filter((plug) => !plug.newSkill || !user.jobData.skills.includes(plug.newSkill));
    if (availablePlugs.length > 0) {
      skill = { ...skill, pool: availablePlugs };
    } else {
      user.jobData.skills = user.jobData.skills.filter((id) => id !== 'chimera_install');
      skill = null;
    }
  }

  if (!skill) {
    skill = (
      getEffectiveCombatStat(user, 'mag') > getEffectiveCombatStat(user, 'atk') &&
      Math.random() < (0.5 + getEffectiveCombatStat(user, 'wis') * 0.002)
    )
      ? { name: '魔力攻击', tag: 'magical', mult: 1.0, text: '{USER} 凝聚魔力攻击 {TARGET}，造成 {VAL} 魔法伤害。' }
      : { name: '普通攻击', tag: 'physical', mult: 1.0, text: '{USER} 攻击了 {TARGET}，造成 {VAL} 伤害。' };
  }

  if (skill.isGacha && skill.pool) {
    const pool = skill.pool as GachaEntry[];
    const isSsrPool = pool === runtime.data.GACHA_SSR_POOL;
    if (isSsrPool && isLuckEmperor(user) && (user.gachaLuck ?? 0) >= 3) {
      skill = { ...skill, ...resolveLuckEmperorSsrDraw(runtime, user, pool) };
    } else if (isSsrPool && isLuckEmperor(user)) {
      skill = { ...skill, ...resolveLuckEmperorSsrDraw(runtime, user, pool) };
    } else {
      skill = { ...skill, ...pool[Math.floor(Math.random() * pool.length)] };
    }
    if (!isSsrPool) {
      grantGachaLuck(user, 1, runtime.log, '抽到低收益牌');
    }
  }

  return skill;
}

export function formatSkillText(skill: SkillDefinition, text: string): string {
  if (skill.name && skill.name !== '普通攻击' && skill.name !== '魔力攻击' && text && !text.includes('【')) {
    return text.replace('{USER}', `【${skill.name}】{USER}`);
  }
  return text;
}
