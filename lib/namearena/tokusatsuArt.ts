import type { BattleFormIdentity, Fighter } from './types';

const PUBLIC_ASSET_VERSION = process.env.NEXT_PUBLIC_ASSET_VERSION?.trim() || 'dev';

function asset(fileName: string): string {
  return `/namearena/TOKUSATSU/${fileName}?v=${encodeURIComponent(PUBLIC_ASSET_VERSION)}`;
}

export const TOKUSATSU_ART = Object.freeze({
  phase1Avatar: asset('phase-1-avatar.webp'),
  phase2Avatar: asset('phase-2-avatar.webp'),
  phase3Avatar: asset('phase-3-avatar.webp'),
  miracleBujin: asset('miracle-bujin.webp'),
  miracleMonsterBujin: asset('miracle-monster-bujin.webp'),
  bujinSword: asset('bujin-sword.webp'),
  monsterGlove: asset('monster-glove.webp'),
  bujinChair: asset('bujin-chair.webp'),
  bujinBelt: asset('bujin-belt.webp'),
  rainbowBelt: asset('rainbow-belt.webp'),
  steamLiner: asset('steam-liner.webp'),
});

export const TOKUSATSU_ASSET_PATHS = Object.freeze(Object.values(TOKUSATSU_ART));

function getPhaseFromJob(jobKey?: string): 1 | 2 | 3 {
  if (jobKey === 'MIRACLE_MONSTER_BUJIN') return 3;
  if (jobKey === 'MIRACLE_BUJIN') return 2;
  return 1;
}

export function getTokusatsuAvatarForJob(jobKey?: string): string {
  const phase = getPhaseFromJob(jobKey);
  if (phase === 3) return TOKUSATSU_ART.phase3Avatar;
  if (phase === 2) return TOKUSATSU_ART.phase2Avatar;
  return TOKUSATSU_ART.phase1Avatar;
}

export function getTokusatsuStageAvatar(fighter?: Fighter): string | undefined {
  if (!fighter?.isTokusatsu) return undefined;
  return getTokusatsuAvatarForJob(fighter.job);
}

export function getTokusatsuFormAvatar(form: BattleFormIdentity): string | undefined {
  if (!['TOKU_FAN', 'MIRACLE_BUJIN', 'MIRACLE_MONSTER_BUJIN'].includes(form.jobKey)) return undefined;
  return getTokusatsuAvatarForJob(form.jobKey);
}

export function getTokusatsuFullBodyForJob(jobKey?: string): string | undefined {
  if (jobKey === 'MIRACLE_MONSTER_BUJIN') return TOKUSATSU_ART.miracleMonsterBujin;
  if (jobKey === 'MIRACLE_BUJIN') return TOKUSATSU_ART.miracleBujin;
  return undefined;
}
