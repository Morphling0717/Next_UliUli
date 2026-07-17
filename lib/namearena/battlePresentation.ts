import type {
  BattleFormIdentity,
  Fighter,
  SkillDefinition,
  SkillPresentation,
} from './types';

const CINEMATIC_ADVANCED_SUMMONS = new Set([
  '青眼白龙',
  '青眼究极龙',
  '翼神龙',
  '黑暗大法师',
]);

export function getBattlePhase(fighter: Fighter): number {
  if (fighter.isPuruisaishi) return Math.max(1, fighter.puruisaishiPhase ?? 1);
  if (fighter.isYuzu) return Math.max(1, fighter.yuzuPhase ?? 1);
  if (fighter.isOwl) return Math.max(1, fighter.owlState?.phase ?? 1);
  if (fighter.isMomo) return Math.max(1, fighter.momoState?.phase ?? 1);
  if (fighter.job === 'MIRACLE_MONSTER_BUJIN' || fighter.job === 'GOD_OF_TROLLS') return 3;
  return fighter.transformed ? 2 : 1;
}

export function readBattleFormIdentity(fighter: Fighter): BattleFormIdentity {
  return {
    jobKey: fighter.job,
    jobName: fighter.jobData?.name ?? '未知职业',
    icon: fighter.jobData?.icon ?? (fighter.name.slice(0, 1) || '名'),
    phase: getBattlePhase(fighter),
  };
}

export function battleFormChanged(before: BattleFormIdentity, after: BattleFormIdentity): boolean {
  return before.jobKey !== after.jobKey || before.phase !== after.phase;
}

export function isCinematicAdvancedSummon(fighter: Fighter): boolean {
  if (!fighter.isSummon || !fighter.isAdvancedSummon) return false;
  return CINEMATIC_ADVANCED_SUMMONS.has(fighter.summonBaseName ?? fighter.name.replace(/#\d+$/, ''));
}

export function resolveSkillPresentation(
  skillId: string | null,
  skill: SkillDefinition | undefined,
  actor: Fighter,
): SkillPresentation {
  if (skillId === null) return 'basic';
  const requested = skill?.presentation ?? 'skill';
  if (requested === 'finisher' && actor.isSummon && !isCinematicAdvancedSummon(actor)) return 'skill';
  return requested;
}
