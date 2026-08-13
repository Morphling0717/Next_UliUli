import type { Fighter } from './types';

export type HerobrineArtSlotId =
  | 'herobrine'
  | 'white_eye_clone'
  | 'two_by_two_tunnel'
  | 'leafless_tree'
  | 'sand_pyramid';

export type HerobrineArtSlot = {
  id: HerobrineArtSlotId;
  label: string;
  imagePath?: string;
};

/**
 * Drop replacement art paths into this catalog when final assets arrive.
 * The stage renders a purpose-built CSS placeholder while imagePath is absent.
 */
export const HEROBRINE_ART_SLOTS: Readonly<Record<HerobrineArtSlotId, HerobrineArtSlot>> = {
  herobrine: { id: 'herobrine', label: 'Herobrine 白眼立绘' },
  white_eye_clone: { id: 'white_eye_clone', label: '白眼分身立绘' },
  two_by_two_tunnel: { id: 'two_by_two_tunnel', label: '二乘二隧道' },
  leafless_tree: { id: 'leafless_tree', label: '无叶之树' },
  sand_pyramid: { id: 'sand_pyramid', label: '沙土金字塔' },
};

export function getHerobrineArtSlot(fighter?: Fighter): HerobrineArtSlot | undefined {
  switch (fighter?.npcUnitState?.unitKind) {
    case 'herobrine':
      return HEROBRINE_ART_SLOTS.herobrine;
    case 'herobrine_clone':
      return fighter.npcUnitState?.revealed
        ? HEROBRINE_ART_SLOTS.white_eye_clone
        : HEROBRINE_ART_SLOTS.herobrine;
    case 'herobrine_tunnel':
      return HEROBRINE_ART_SLOTS.two_by_two_tunnel;
    case 'herobrine_leafless_tree':
      return HEROBRINE_ART_SLOTS.leafless_tree;
    case 'herobrine_sand_pyramid':
      return HEROBRINE_ART_SLOTS.sand_pyramid;
    default:
      return undefined;
  }
}

export function getHerobrineDisplayIcon(fighter?: Fighter): string | undefined {
  if (fighter?.npcUnitState?.unitKind !== 'herobrine_clone') return undefined;
  return fighter.npcUnitState.revealed ? '▫️' : '◻️';
}

export function getHerobrineDisplayJobName(fighter?: Fighter): string | undefined {
  if (fighter?.npcUnitState?.unitKind !== 'herobrine_clone') return undefined;
  return fighter.npcUnitState.revealed ? '错误的玩家' : '远处的白眼';
}

export function getHerobrineDisplayPhaseLabel(fighter?: Fighter): string | undefined {
  if (fighter?.npcUnitState?.unitKind !== 'herobrine_clone') return undefined;
  return fighter.npcUnitState.revealed ? 'EYE' : 'H1';
}
