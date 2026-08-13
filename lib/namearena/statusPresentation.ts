import { getDefenseStatusDisplayName } from './defenseStatus';
import {
  getBarrierIdentityDefinition,
  getStatusIdentityDefinition,
  getStatusMechanicDefinition,
  isDualValueStatus,
} from './statusRegistry';
import { formatStatusValue } from './statusSystem';
import type {
  BarrierEntry,
  Fighter,
  StatusDispelTier,
  StatusInstance,
  StatusPolarity,
  StatusTickMode,
} from './types';

export type StatusPresentationTone = StatusPolarity;

export type StatusPresentationGroupKind = 'single' | 'composite' | 'multi_source' | 'barrier';

export interface StatusPresentationFact {
  label: string;
  value: string;
}

export interface StatusPresentationEffect {
  key: string;
  name: string;
  description?: string;
  valueLabel?: string;
  facts: StatusPresentationFact[];
  isCurrentAttribution?: boolean;
}

export interface StatusPresentationDetail {
  groupKind: StatusPresentationGroupKind;
  summary: string;
  effects: StatusPresentationEffect[];
  sharedFacts: StatusPresentationFact[];
}

export interface StatusPresentationMember {
  key: string;
  name: string;
  icon: string;
  description: string;
  valueLabel?: string;
  remainingLabel?: string;
  mechanicName: string;
  mechanicDescription: string;
  clockLabel: string;
  sourceLabel: string;
  dispelLabel: string;
  polarity: StatusPolarity;
  mechanicalLines?: string[];
}

export interface StatusPresentationItem extends StatusPresentationMember {
  kind: 'status' | 'barrier';
  members: StatusPresentationMember[];
  detailModel: StatusPresentationDetail;
  detail: string;
  priority: number;
}

const POLARITY_LABELS: Record<StatusPolarity, string> = {
  positive: '正面状态',
  negative: '负面状态',
  neutral: '中性状态',
  independent: '独立机制',
};

const DISPEL_LABELS: Record<StatusDispelTier, string> = {
  normal: '可驱散',
  strong_only: '仅强驱散',
  none: '不可驱散',
};

const TICK_LABELS: Record<StatusTickMode, string> = {
  self_opportunity: '每次自身行动机会后',
  attack_action: '完成攻击行动后',
  global_action: '每次全局行动后',
  large_round: '每个大回合结束时',
  trigger: '满足触发条件时',
  permanent: '不会自然结束',
};

function clockLabel(mode: StatusTickMode): string {
  return TICK_LABELS[mode];
}

function statusSourceLabel(status: StatusInstance): string {
  const { effectSourceName, applierName } = status.attribution;
  if (effectSourceName && applierName && effectSourceName !== applierName) return `${effectSourceName} · ${applierName}`;
  return effectSourceName ?? applierName ?? getDefenseStatusDisplayName(status) ??
    getStatusIdentityDefinition(status.identityId).displayName;
}

function statusPriority(status: StatusInstance): number {
  if (status.identityId === 'SYNERGY_SLACKING') return 0;
  if (status.calculationStage === 'lifecycle' && status.polarity === 'negative') return 10;
  if (status.calculationStage === 'barrier') return 20;
  if (status.polarity === 'independent') return 30;
  if (status.polarity === 'negative') return 40;
  if (status.polarity === 'positive') return 50;
  return 60;
}

function componentLine(status: StatusInstance): string | undefined {
  const identity = getStatusIdentityDefinition(status.identityId);
  if (!identity.components?.length) return undefined;
  const component = identity.components.find((entry) => entry.mechanicId === status.mechanicId);
  if (!component) return undefined;
  return `${getStatusMechanicDefinition(status.mechanicId).displayName}：${component.description ?? `强度 ${status.potency ?? 0}`}`;
}

const STAT_NAMES: Record<string, string> = {
  DEF_RES: '防御与魔抗',
  ATK: '攻击',
  DEF: '防御',
  SPD: '速度',
  AGL: '敏捷',
  MAG: '魔力',
  RES: '魔抗',
  WIS: '智力',
};

function localizeMechanicDescription(description: string): string {
  return Object.entries(STAT_NAMES).reduce(
    (result, [key, label]) => result.replace(new RegExp(`\\b${key}\\b`, 'g'), label),
    description,
  ).replace(/([\u3400-\u9fff])\s+(提高|降低|增加|降为)/g, '$1$2');
}

function mechanicDescription(status: StatusInstance): string {
  const identity = getStatusIdentityDefinition(status.identityId);
  const component = identity.components?.find((entry) => entry.mechanicId === status.mechanicId);
  if (!component) return identity.description;
  const actualPotency = status.potency;
  const configuredPotency = component.potency;
  const description = actualPotency !== undefined && actualPotency !== configuredPotency
    ? component.description.replace(
        new RegExp(`(^|\\D)${configuredPotency}(?=%|点|层|个|\\D|$)`),
        `$1${actualPotency}`,
      )
    : component.description;
  return localizeMechanicDescription(description);
}

function statusRemainingLabel(status: StatusInstance): string | undefined {
  const pieces: string[] = [];
  if (status.remainingTurns !== undefined) {
    const unit = status.tickMode === 'global_action'
      ? '次全局行动'
      : status.tickMode === 'large_round'
        ? '个大回合'
        : '次自身行动机会';
    pieces.push(`${status.remainingTurns}${unit}`);
  }
  if (status.charges !== undefined) pieces.push(`${status.charges}次`);
  return pieces.join(' · ') || undefined;
}

export function buildStatusPresentationMember(status: StatusInstance): StatusPresentationMember {
  const identity = getStatusIdentityDefinition(status.identityId);
  const mechanic = getStatusMechanicDefinition(status.mechanicId);
  const defenseName = getDefenseStatusDisplayName(status);
  const value = formatStatusValue(status);
  const valueLabel = value || undefined;
  const mechanicalLine = componentLine(status);
  const originiumStacks = status.mechanicId === 'ORIGINIUM_DISEASE'
    ? Math.max(0, Math.min(80, status.potency ?? 0))
    : undefined;
  const witnessStacks = status.identityId === 'HEROBRINE_WITNESS'
    ? Math.max(0, Math.min(5, status.potency ?? 0))
    : undefined;
  const witnessEffects = witnessStacks === undefined
    ? undefined
    : [
        '更容易被 Herobrine 选为目标',
        witnessStacks >= 2 ? 'Herobrine 对其直接伤害提高 20%，并忽略 30% 额外闪避' : '',
        witnessStacks >= 3 ? '大回合末受到 1.5% 最大生命真实伤害，普通限时增益少 1 回合；同时获得【看破真相】：对 Herobrine 及其异常造物直接伤害 +20%、攻击 Herobrine 时命中率 +15 个百分点，并有更高概率识破分身' : '',
        witnessStacks >= 4 ? 'Herobrine 命中时有 35% 概率追加一次普通攻击' : '',
        witnessStacks >= 5 ? '成为【单人世界】首选目标；Herobrine 第一次命中可越过护盾' : '',
      ].filter(Boolean).join('；');
  const description = originiumStacks !== undefined
    ? `生命上限降低 ${Math.min(58, originiumStacks * 0.65).toFixed(2).replace(/\.00$/, '')}%，防御降低 ${Math.min(72, originiumStacks * 0.8).toFixed(1).replace(/\.0$/, '')}%；${originiumStacks < 60 ? `攻击与魔抗提高 ${originiumStacks}%` : '攻击与魔抗加成已清零'}，80 层时死亡`
    : witnessEffects ?? identity.description;
  return {
    key: status.instanceId,
    name: defenseName ?? identity.displayName,
    icon: identity.icon,
    description,
    valueLabel,
    remainingLabel: statusRemainingLabel(status),
    mechanicName: mechanic.displayName,
    mechanicDescription: mechanicDescription(status),
    clockLabel: clockLabel(status.tickMode),
    sourceLabel: statusSourceLabel(status),
    dispelLabel: DISPEL_LABELS[status.dispelTier],
    polarity: status.polarity,
    mechanicalLines: mechanicalLine ? [mechanicalLine] : undefined,
  };
}

function serializeDetail(
  icon: string,
  name: string,
  valueLabel: string | undefined,
  detail: StatusPresentationDetail,
): string {
  const lines = [
    `${icon} ${name}${valueLabel ? ` · ${valueLabel}` : ''}`,
    detail.summary,
  ];
  if (detail.effects.length > 0) {
    lines.push('', detail.groupKind === 'multi_source' ? '来源贡献' : '效果');
    detail.effects.forEach((effect) => {
      const current = effect.isCurrentAttribution ? '（当前结算归属）' : '';
      const value = effect.valueLabel ? ` · ${effect.valueLabel}` : '';
      const description = effect.description ? `：${effect.description}` : '';
      lines.push(`- ${effect.name}${value}${current}${description}`);
      effect.facts.forEach((fact) => lines.push(`  ${fact.label}：${fact.value}`));
    });
  }
  detail.sharedFacts.forEach((fact) => lines.push(`${fact.label}：${fact.value}`));
  return lines.join('\n');
}

function sharedDefenseThemeName(statuses: StatusInstance[]): string | undefined {
  if (statuses.length < 2) return undefined;
  const firstName = getDefenseStatusDisplayName(statuses[0]);
  const firstSource = statuses[0].attribution.effectSourceId;
  return firstName && statuses.every((status) =>
    status.attribution.effectSourceId === firstSource && getDefenseStatusDisplayName(status) === firstName,
  ) ? firstName : undefined;
}

function sharedEffectSourceThemeName(statuses: StatusInstance[]): string | undefined {
  if (statuses.length < 2) return undefined;
  const firstSourceId = statuses[0].attribution.effectSourceId;
  const firstSourceName = statuses[0].attribution.effectSourceName;
  return firstSourceName && statuses.every((status) =>
    status.attribution.effectSourceId === firstSourceId &&
    status.attribution.effectSourceName === firstSourceName,
  ) ? firstSourceName : undefined;
}

function aggregateStatus(statuses: StatusInstance[]): StatusInstance {
  const ordered = [...statuses].sort((a, b) => b.appliedSequence - a.appliedSequence);
  const latest = ordered[0];
  const sameMechanic = statuses.every((status) => status.mechanicId === latest.mechanicId);
  if (!sameMechanic) return latest;
  const definition = getStatusMechanicDefinition(latest.mechanicId);
  if (definition.dualValue) {
    return {
      ...latest,
      potency: Math.min(
        definition.potencyCap ?? Number.MAX_SAFE_INTEGER,
        statuses.reduce((sum, status) => sum + (status.potency ?? 0), 0),
      ),
      count: Math.min(
        definition.countCap ?? Number.MAX_SAFE_INTEGER,
        statuses.reduce((sum, status) => sum + (status.count ?? 0), 0),
      ),
    };
  }
  if (latest.mechanicId === 'POISON') {
    return {
      ...latest,
      potency: Math.min(3, statuses.reduce((sum, status) => sum + (status.potency ?? 0), 0)),
      remainingTurns: Math.max(...statuses.map((status) => status.remainingTurns ?? 0)),
    };
  }
  if (latest.mechanicId === 'ORIGINIUM_DISEASE') {
    return {
      ...latest,
      potency: Math.min(
        definition.potencyCap ?? Number.MAX_SAFE_INTEGER,
        statuses.reduce((sum, status) => sum + (status.potency ?? 0), 0),
      ),
    };
  }
  if (latest.mechanicId === 'HEROBRINE_WITNESS') {
    return {
      ...latest,
      potency: Math.min(5, statuses.reduce((sum, status) => sum + (status.potency ?? 0), 0)),
    };
  }
  return latest;
}

function commonValue(values: Array<string | undefined>): string | undefined {
  const first = values[0];
  return first && values.every((value) => value === first) ? first : undefined;
}

function commonSourceLabel(statuses: StatusInstance[], members: StatusPresentationMember[], fallback: string): string | undefined {
  const firstSourceId = statuses[0].attribution.effectSourceId;
  if (!statuses.every((status) => status.attribution.effectSourceId === firstSourceId)) return undefined;
  return commonValue(members.map((member) => member.sourceLabel)) ?? fallback;
}

function classificationFacts(
  polarity: string | undefined,
  dispel: string | undefined,
): StatusPresentationFact[] {
  if (polarity && dispel) return [{ label: '分类', value: `${polarity} · ${dispel}` }];
  return [
    ...(polarity ? [{ label: '分类', value: polarity }] : []),
    ...(dispel ? [{ label: '驱散', value: dispel }] : []),
  ];
}

function memberSpecificFacts(
  member: StatusPresentationMember,
  shared: {
    remaining?: string;
    clock?: string;
    source?: string;
    polarity?: string;
    dispel?: string;
  },
): StatusPresentationFact[] {
  const polarity = POLARITY_LABELS[member.polarity];
  const facts: StatusPresentationFact[] = [];
  if (member.remainingLabel && member.remainingLabel !== shared.remaining) {
    facts.push({ label: '剩余', value: member.remainingLabel });
  }
  if (member.clockLabel !== shared.clock) facts.push({ label: '结算', value: member.clockLabel });
  if (!shared.source) facts.push({ label: '来源', value: member.sourceLabel });
  facts.push(...classificationFacts(
    polarity === shared.polarity ? undefined : polarity,
    member.dispelLabel === shared.dispel ? undefined : member.dispelLabel,
  ));
  return facts;
}

function sharedDetailFacts(shared: {
  clock?: string;
  source?: string;
  polarity?: string;
  dispel?: string;
}): StatusPresentationFact[] {
  return [
    ...(shared.source ? [{ label: '来源', value: shared.source }] : []),
    ...(shared.clock ? [{ label: '结算', value: shared.clock }] : []),
    ...classificationFacts(shared.polarity, shared.dispel),
  ];
}

function themeSummary(
  statuses: StatusInstance[],
  groupName: string,
): string {
  const sameIdentity = statuses.every((status) => status.identityId === statuses[0].identityId);
  if (sameIdentity) return getStatusIdentityDefinition(statuses[0].identityId).description;
  const namedIdentity = statuses.find((status) =>
    getStatusIdentityDefinition(status.identityId).displayName === groupName,
  );
  if (namedIdentity) return getStatusIdentityDefinition(namedIdentity.identityId).description;
  const slacking = statuses.find((status) => status.identityId === 'SYNERGY_SLACKING');
  if (slacking) return getStatusIdentityDefinition(slacking.identityId).description;
  return `${groupName}的各项效果同时生效。`;
}

function buildSingleDetail(member: StatusPresentationMember): StatusPresentationDetail {
  const effects = member.mechanicalLines?.length
    ? [{
        key: member.key,
        name: member.mechanicName,
        description: member.mechanicDescription,
        facts: [],
      }]
    : [];
  return {
    groupKind: 'single',
    summary: member.description,
    effects,
    sharedFacts: [
      { label: '结算', value: member.clockLabel },
      { label: '来源', value: member.sourceLabel },
      { label: '分类', value: `${POLARITY_LABELS[member.polarity]} · ${member.dispelLabel}` },
    ],
  };
}

function groupSourceStatuses(statuses: StatusInstance[]): StatusInstance[][] {
  const groups = new Map<string, StatusInstance[]>();
  statuses.forEach((status) => {
    const key = status.attribution.effectSourceId;
    const entries = groups.get(key) ?? [];
    entries.push(status);
    groups.set(key, entries);
  });
  return [...groups.values()].sort((a, b) =>
    Math.max(...b.map((status) => status.appliedSequence)) -
    Math.max(...a.map((status) => status.appliedSequence)),
  );
}

function compositeEffectPresentation(
  status: StatusInstance,
  member: StatusPresentationMember,
  statuses: StatusInstance[],
): Pick<StatusPresentationEffect, 'name' | 'description'> {
  if (statuses.some((entry) => entry.identityId === 'SYNERGY_SLACKING')) {
    if (status.identityId === 'SYNERGY_SLACKING') {
      return {
        name: member.mechanicName,
        description: '暂时远离战场，不能成为任何攻击或技能的目标',
      };
    }
    if (status.identityId === 'STUN') {
      return {
        name: member.mechanicName,
        description: '暂离期间无法行动',
      };
    }
  }
  return {
    name: member.mechanicName,
    description: member.mechanicDescription,
  };
}

function buildStatusItem(statuses: StatusInstance[]): StatusPresentationItem {
  const ordered = [...statuses].sort((a, b) => b.appliedSequence - a.appliedSequence);
  const latest = ordered[0];
  const aggregate = aggregateStatus(statuses);
  const first = buildStatusPresentationMember(aggregate);
  const members = ordered.map(buildStatusPresentationMember);
  const grouped = members.length > 1;
  const explicitGroup = !!latest.groupId;
  const sameMechanic = statuses.every((status) => status.mechanicId === latest.mechanicId);
  const multiSource = grouped && sameMechanic && !explicitGroup;
  const defenseThemeName = sharedDefenseThemeName(statuses);
  const effectSourceThemeName = sharedEffectSourceThemeName(statuses);
  const matchingSlacking = statuses.find((status) => status.identityId === 'SYNERGY_SLACKING');
  const themeStatus = matchingSlacking ?? latest;
  const identity = getStatusIdentityDefinition(themeStatus.identityId);
  const groupName = defenseThemeName ?? effectSourceThemeName ?? identity.displayName;
  const commonRemaining = grouped ? commonValue(members.map((member) => member.remainingLabel)) : undefined;
  const commonClock = grouped ? commonValue(members.map((member) => member.clockLabel)) : undefined;
  const commonPolarity = grouped
    ? commonValue(members.map((member) => POLARITY_LABELS[member.polarity]))
    : undefined;
  const commonDispel = grouped ? commonValue(members.map((member) => member.dispelLabel)) : undefined;
  const commonSource = grouped && !multiSource
    ? commonSourceLabel(statuses, members, groupName)
    : undefined;
  const shared = {
    remaining: commonRemaining,
    clock: commonClock,
    source: commonSource,
    polarity: commonPolarity,
    dispel: commonDispel,
  };
  const detailModel: StatusPresentationDetail = !grouped
    ? buildSingleDetail(first)
    : multiSource
      ? {
          groupKind: 'multi_source',
          summary: first.description,
          effects: groupSourceStatuses(statuses).map((sourceStatuses) => {
            const sourceStatus = aggregateStatus(sourceStatuses);
            const sourceMember = buildStatusPresentationMember(sourceStatus);
            return {
              key: `source:${sourceStatus.attribution.effectSourceId}`,
              name: sourceMember.sourceLabel,
              valueLabel: sourceMember.valueLabel,
              facts: [],
              isCurrentAttribution: sourceStatuses.some((status) => status.instanceId === latest.instanceId),
            };
          }),
          sharedFacts: sharedDetailFacts({
            clock: commonClock,
            polarity: commonPolarity,
            dispel: commonDispel,
          }),
        }
      : {
          groupKind: 'composite',
          summary: themeSummary(statuses, groupName),
          effects: ordered.map((status, index) => {
            const effect = compositeEffectPresentation(status, members[index], statuses);
            return {
              key: status.instanceId,
              ...effect,
              facts: memberSpecificFacts(members[index], shared),
            };
          }),
          sharedFacts: sharedDetailFacts(shared),
        };
  const valueLabel = grouped
    ? multiSource
      ? first.valueLabel
      : commonRemaining
    : first.valueLabel;
  const detail = serializeDetail(identity.icon, grouped ? groupName : first.name, valueLabel, detailModel);
  return {
    ...first,
    valueLabel,
    key: statusPresentationGroupKey(latest),
    name: grouped ? groupName : first.name,
    icon: identity.icon,
    description: grouped
      ? explicitGroup || defenseThemeName
        ? `组合状态：${[...new Set(members.map((member) => member.name))].join('、')}`
        : `${first.name}由 ${members.length} 个来源共同维持`
      : first.description,
    kind: 'status',
    members,
    detailModel,
    detail,
    priority: Math.min(...statuses.map(statusPriority)),
  };
}

function barrierRemainingLabel(barrier: BarrierEntry): string | undefined {
  if (barrier.remainingTurns === undefined) return undefined;
  const unit = barrier.tickMode === 'global_action'
    ? '次全局行动'
    : barrier.tickMode === 'large_round'
      ? '个大回合'
      : '次自身行动机会';
  return `${barrier.remainingTurns}${unit}`;
}

export function buildBarrierPresentationItem(barrier: BarrierEntry): StatusPresentationItem {
  const identity = getBarrierIdentityDefinition(barrier.identityId);
  const remaining = barrierRemainingLabel(barrier);
  const member: StatusPresentationMember = {
    key: barrier.id,
    name: barrier.displayName,
    icon: barrier.icon ?? identity.icon,
    description: identity.description,
    valueLabel: `${Math.max(0, barrier.value)}/${Math.max(barrier.maxValue, barrier.value)}${remaining ? ` · ${remaining}` : ''}`,
    remainingLabel: remaining,
    mechanicName: identity.displayName,
    mechanicDescription: identity.description,
    clockLabel: clockLabel(barrier.tickMode),
    sourceLabel: barrier.attribution?.applierName ?? barrier.attribution?.effectSourceName ?? barrier.displayName,
    dispelLabel: DISPEL_LABELS[barrier.dispelTier],
    polarity: barrier.polarity,
  };
  const detailModel: StatusPresentationDetail = {
    groupKind: 'barrier',
    summary: member.description,
    effects: [],
    sharedFacts: [
      { label: '结算', value: member.clockLabel },
      { label: '来源', value: member.sourceLabel },
      { label: '分类', value: `${POLARITY_LABELS[member.polarity]} · ${member.dispelLabel}` },
    ],
  };
  return {
    ...member,
    key: `barrier:${barrier.id}`,
    kind: 'barrier',
    members: [member],
    detailModel,
    detail: serializeDetail(member.icon, member.name, member.valueLabel, detailModel),
    priority: 20,
  };
}

export function statusPresentationGroupKey(status: StatusInstance): string {
  if (status.groupId) return `group:${status.groupId}`;
  if (
    isDualValueStatus(status) ||
    status.mechanicId === 'POISON' ||
    status.mechanicId === 'ORIGINIUM_DISEASE' ||
    status.mechanicId === 'HEROBRINE_WITNESS'
  ) return `status:${status.mechanicId}`;
  const defenseName = getDefenseStatusDisplayName(status);
  if (defenseName) return `defense:${status.attribution.effectSourceId}:${defenseName}`;
  return `status:${status.identityId}:${status.attribution.effectSourceId}`;
}

export function buildFighterStatusPresentation(
  fighter: Pick<Fighter, 'statuses' | 'barriers'>,
): StatusPresentationItem[] {
  const grouped = new Map<string, StatusInstance[]>();
  fighter.statuses.forEach((status) => {
    const key = statusPresentationGroupKey(status);
    const entries = grouped.get(key) ?? [];
    entries.push(status);
    grouped.set(key, entries);
  });
  const items = [
    ...[...grouped.values()].map(buildStatusItem),
    ...(fighter.barriers ?? []).filter((barrier) => barrier.value > 0).map(buildBarrierPresentationItem),
  ];
  return items.sort((a, b) =>
    a.priority - b.priority || a.name.localeCompare(b.name, 'zh-Hans-CN') || a.key.localeCompare(b.key),
  );
}

export function formatStatusPresentationLabel(item: StatusPresentationItem, includeValue = true): string {
  return `${item.name}${includeValue && item.valueLabel ? ` ${item.valueLabel}` : ''}`;
}

export function isCoreDualValuePresentation(status: StatusInstance): boolean {
  return isDualValueStatus(status) &&
    ['BURN', 'BLEED', 'RUPTURE', 'TREMOR', 'SINKING', 'POISE'].includes(status.mechanicId);
}
