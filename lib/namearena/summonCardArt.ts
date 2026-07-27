export type SummonCardTier = 'ordinary' | 'advanced' | 'divine' | 'component' | 'special';

export type SummonCardArtSlot = {
  key: string;
  name: string;
  tier: SummonCardTier;
  accent: string;
  sigil: string;
  expectedPath: string;
  imagePath?: string;
  cutinPath?: string;
  avatarPath?: string;
};

type SummonAssetOptions = {
  card?: boolean;
  cutin?: boolean;
  avatar?: boolean;
};

const PUBLIC_ASSET_VERSION = process.env.NEXT_PUBLIC_ASSET_VERSION?.trim() || 'dev';

function versionPublicAsset(path: string): string {
  return `${path}?v=${encodeURIComponent(PUBLIC_ASSET_VERSION)}`;
}

const slot = (
  key: string,
  name: string,
  tier: SummonCardTier,
  accent: string,
  sigil: string,
  folder: 'summons' | 'components' = 'summons',
  assets: SummonAssetOptions = {},
): SummonCardArtSlot => {
  const expectedPath = `/namearena/cards/${folder}/${key}.webp`;
  return {
    key,
    name,
    tier,
    accent,
    sigil,
    expectedPath,
    imagePath: assets.card ? versionPublicAsset(expectedPath) : undefined,
    cutinPath: assets.cutin ? versionPublicAsset(`/namearena/cards/monster_cutin/${key}.webp`) : undefined,
    avatarPath: assets.avatar ? versionPublicAsset(`/namearena/cards/avatar/${key}.webp`) : undefined,
  };
};

export const SUMMON_CARD_ART_SLOTS: readonly SummonCardArtSlot[] = [
  slot('guardian-kuriboh', '护主栗子球', 'ordinary', '#c79a5a', '栗', 'summons', { card: true, avatar: true }),
  slot('zhongli', '钟离', 'ordinary', '#d6a84e', '岩', 'summons', { card: true, avatar: true }),
  slot('saber', 'Saber', 'ordinary', '#6aa8ff', '剑', 'summons', { card: true, avatar: true }),
  slot('sam', '萨姆', 'ordinary', '#ff784f', '炎', 'summons', { card: true, avatar: true }),
  slot('bahamut', '巴哈姆特', 'ordinary', '#8d76ff', '龙', 'summons', { card: true, avatar: true }),
  slot('emrakul', '伊莫库', 'ordinary', '#c884ff', '界', 'summons', { card: true, avatar: true }),
  slot('surtr', '史尔特尔', 'advanced', '#ff5d4a', '火', 'summons', { card: true, cutin: true, avatar: true }),
  slot('svarog', '史瓦罗', 'ordinary', '#7e9bb8', '机', 'summons', { card: true, avatar: true }),
  slot('puppet-ting', '小汀(傀儡)', 'special', '#d34b5b', '怨'),
  slot('blue-eyes-white-dragon', '青眼白龙', 'advanced', '#75d8ff', '白', 'summons', { card: true, cutin: true, avatar: true }),
  slot('blue-eyes-ultimate-dragon', '青眼究极龙', 'advanced', '#b69cff', '究', 'summons', { card: true, cutin: true, avatar: true }),
  slot('winged-dragon-of-ra', '翼神龙', 'divine', '#ffd65a', '神', 'summons', { card: true, cutin: true, avatar: true }),
  slot('exodia-the-forbidden-one', '黑暗大法师', 'divine', '#e1aa50', '封', 'summons', { card: true, cutin: true, avatar: true }),
  slot('sealed-right-arm', '被封印者的右腕', 'component', '#bd75d8', '右腕', 'components', { card: true }),
  slot('sealed-left-arm', '被封印者的左腕', 'component', '#bd75d8', '左腕', 'components', { card: true }),
  slot('sealed-right-leg', '被封印者的右足', 'component', '#8e78d8', '右足', 'components', { card: true }),
  slot('sealed-left-leg', '被封印者的左足', 'component', '#8e78d8', '左足', 'components', { card: true }),
  slot('sealed-exodia', '被封印者本体', 'component', '#e1aa50', '本体', 'components', { card: true }),
] as const;

const CARD_ART_BY_NAME = new Map(SUMMON_CARD_ART_SLOTS.map((entry) => [entry.name, entry]));

const CARD_NAME_ALIASES: Record<string, string> = {
  拉的翼神龙: '翼神龙',
};

export const EXODIA_STAR_ORDER = [
  '被封印者本体',
  '被封印者的左腕',
  '被封印者的左足',
  '被封印者的右足',
  '被封印者的右腕',
] as const;

export function normalizeSummonCardName(name: string): string {
  const withoutCopySuffix = name.replace(/#\d+$/, '');
  return CARD_NAME_ALIASES[withoutCopySuffix] ?? withoutCopySuffix;
}

export function getSummonCardArt(name: string): SummonCardArtSlot {
  const normalized = normalizeSummonCardName(name);
  return CARD_ART_BY_NAME.get(normalized) ?? {
    key: 'unassigned-card',
    name: normalized,
    tier: 'ordinary',
    accent: '#96a6b2',
    sigil: normalized.slice(0, 1) || '?',
    expectedPath: '/namearena/cards/unassigned.webp',
  };
}

export function orderExodiaMaterials(materials: string[]): string[] {
  const materialByName = new Map(materials.map((name) => [normalizeSummonCardName(name), name]));
  return EXODIA_STAR_ORDER.map((name) => materialByName.get(name) ?? name);
}
