import type {
  BarrierEntry,
  DispelOptions,
  Fighter,
  StatusApplication,
  StatusAttribution,
  StatusDispelTier,
  StatusInstance,
  StatusRemovalReason,
  StatusTickMode,
} from './types';
import {
  getBarrierIdentityDefinition,
  getStatusIdentityDefinition,
  getStatusMechanicDefinition,
  isDualValueStatus,
  statusHasTag,
  type StatusTag,
} from './statusRegistry';

export interface StatusRemovalResult {
  removed: StatusInstance[];
  blocked: StatusInstance[];
}

export interface StatusApplicationResult {
  statuses: StatusInstance[];
  primary: StatusInstance;
  created: boolean;
  changed: boolean;
}

export interface BarrierConsumptionResult {
  absorbed: number;
  remaining: number;
  broken: BarrierEntry[];
  touched: BarrierEntry[];
  absorptions: Array<{ barrier: BarrierEntry; amount: number }>;
}

export interface BarrierDispelResult {
  removed: BarrierEntry[];
  blocked: BarrierEntry[];
}

export interface DispelEffectsResult {
  statuses: StatusRemovalResult;
  barriers: BarrierDispelResult;
}

export interface EffectAdvanceResult {
  expiredStatuses: StatusInstance[];
  expiredBarriers: BarrierEntry[];
}

export interface StatusValueQuery {
  mechanicId: string;
  potency: number;
  count: number;
  charges: number;
  entries: StatusInstance[];
}

export interface StatusSelector {
  instanceIds?: readonly string[];
  identityIds?: readonly string[];
  mechanicIds?: readonly string[];
  groupIds?: readonly string[];
  identityTags?: readonly StatusTag[];
  exclusiveGroupIds?: readonly string[];
  effectSourceIds?: readonly string[];
  applierIds?: readonly (string | undefined)[];
  creditActorIds?: readonly (string | undefined)[];
  creditOwnerIds?: readonly (string | undefined)[];
  polarities?: readonly StatusInstance['polarity'][];
  excludeIdentityIds?: readonly string[];
  excludeMechanicIds?: readonly string[];
}

export interface EffectRemovalSpec extends StatusSelector {
  reason?: StatusRemovalReason;
}

export interface EffectAdvanceSpec {
  tickMode: Exclude<StatusTickMode, 'trigger' | 'permanent'>;
  clock?: number;
  instanceIds?: readonly string[];
  barrierIds?: readonly string[];
  includeStatuses?: boolean;
  includeBarriers?: boolean;
}

export interface BarrierSelector {
  barrierIds?: readonly string[];
  identityIds?: readonly string[];
  sourceIds?: readonly string[];
  effectSourceIds?: readonly string[];
  applierIds?: readonly (string | undefined)[];
  polarities?: readonly BarrierEntry['polarity'][];
  excludeIdentityIds?: readonly string[];
  excludeSourceIds?: readonly string[];
}

export type StatusValueField = 'potency' | 'count' | 'remainingTurns' | 'charges';

function nextStatusSequence(fighter: Fighter): number {
  fighter.statusSequence = Math.max(0, fighter.statusSequence ?? 0) + 1;
  return fighter.statusSequence;
}

function nextStatusId(fighter: Fighter, sequence: number): string {
  return `${fighter.id}:status:${sequence}`;
}

function nextBarrierId(fighter: Fighter): string {
  fighter.barrierSequence = Math.max(0, fighter.barrierSequence ?? 0) + 1;
  return `${fighter.id}:barrier:${fighter.barrierSequence}`;
}

function cap(value: number, maximum?: number): number {
  const normalized = Math.max(0, Math.floor(value));
  return maximum === undefined ? normalized : Math.min(maximum, normalized);
}

function aggregateStatusValue(
  entries: readonly StatusInstance[],
  field: 'potency' | 'count' | 'charges',
): number {
  const additive = entries
    .filter((status) => status.stackMode !== 'highest')
    .reduce((sum, status) => sum + (status[field] ?? 0), 0);
  const highest = entries
    .filter((status) => status.stackMode === 'highest')
    .reduce((maximum, status) => Math.max(maximum, status[field] ?? 0), 0);
  return additive + highest;
}

function aggregateMechanicPotency(fighter: Fighter, mechanicId: string): number {
  const definition = getStatusMechanicDefinition(mechanicId);
  const entries = fighter.statuses.filter((status) => status.mechanicId === mechanicId);
  return cap(
    aggregateStatusValue(entries, 'potency'),
    definition.potencyCap,
  );
}

const PERSISTENT_SHAPE_KEYS = ['maxHp', 'atk', 'def', 'res'] as const;
const suspendedPersistentShapeFighters = new WeakSet<Fighter>();

function transitionPersistentStatShape(
  fighter: Fighter,
  mechanicId: string,
  beforePotency: number,
  afterPotency: number,
): void {
  if (suspendedPersistentShapeFighters.has(fighter)) return;
  const shape = getStatusMechanicDefinition(mechanicId).persistentStatShape;
  if (!shape || beforePotency === afterPotency) return;
  const before = shape(beforePotency);
  const after = shape(afterPotency);
  for (const key of PERSISTENT_SHAPE_KEYS) {
    const from = before[key] ?? 1;
    const to = after[key] ?? 1;
    if (from === to) continue;
    if (key === 'maxHp') {
      const unshaped = Math.max(1, Math.round(fighter.maxHp / Math.max(0.0001, from)));
      fighter.maxHp = Math.max(1, Math.floor(unshaped * to));
      continue;
    }
    const flatMechanicId = `${key.toUpperCase()}_FLAT_UP`;
    const flat = aggregateMechanicPotency(fighter, flatMechanicId);
    const projected = fighter[key] + flat;
    const unshaped = Math.max(1, Math.round(projected / Math.max(0.0001, from)));
    fighter[key] = Math.max(1, Math.floor(unshaped * to) - flat);
  }
  if (fighter.currentHp > fighter.maxHp) fighter.currentHp = fighter.maxHp;
  fighter.hpPct = fighter.maxHp > 0 ? Math.max(0, fighter.currentHp) / fighter.maxHp : 0;
}

export function withPersistentStatusShapesSuspended<T>(fighter: Fighter, callback: () => T): T {
  if (suspendedPersistentShapeFighters.has(fighter)) return callback();
  const shapes = [...new Set(fighter.statuses
    .map((status) => status.mechanicId)
    .filter((mechanicId) => !!getStatusMechanicDefinition(mechanicId).persistentStatShape))]
    .map((mechanicId) => ({ mechanicId, potency: aggregateMechanicPotency(fighter, mechanicId) }));
  shapes.slice().reverse().forEach(({ mechanicId, potency }) => {
    transitionPersistentStatShape(fighter, mechanicId, potency, 0);
  });
  suspendedPersistentShapeFighters.add(fighter);
  try {
    return callback();
  } finally {
    suspendedPersistentShapeFighters.delete(fighter);
    shapes.forEach(({ mechanicId }) => {
      transitionPersistentStatShape(fighter, mechanicId, 0, aggregateMechanicPotency(fighter, mechanicId));
    });
  }
}

function buildAttribution(
  identityId: string,
  attribution?: Partial<StatusAttribution>,
  effectName?: string,
): StatusAttribution {
  return {
    effectSourceId: attribution?.effectSourceId ?? identityId,
    effectSourceName: attribution?.effectSourceName ?? effectName,
    applierId: attribution?.applierId,
    applierName: attribution?.applierName,
    creditActorId: attribution?.creditActorId ?? attribution?.applierId,
    creditOwnerId: attribution?.creditOwnerId,
  };
}

function sameAttribution(a: StatusAttribution, b: StatusAttribution): boolean {
  return a.effectSourceId === b.effectSourceId && a.applierId === b.applierId;
}

function matchesStatusSelector(status: StatusInstance, selector: StatusSelector): boolean {
  if (selector.instanceIds?.length && !selector.instanceIds.includes(status.instanceId)) return false;
  if (selector.identityIds?.length && !selector.identityIds.includes(status.identityId)) return false;
  if (selector.mechanicIds?.length && !selector.mechanicIds.includes(status.mechanicId)) return false;
  if (selector.groupIds?.length && (!status.groupId || !selector.groupIds.includes(status.groupId))) return false;
  if (selector.identityTags?.length && !selector.identityTags.some((tag) => statusHasTag(status, tag))) return false;
  if (selector.exclusiveGroupIds?.length) {
    const group = getStatusIdentityDefinition(status.identityId).exclusiveGroup;
    if (!group || !selector.exclusiveGroupIds.includes(group)) return false;
  }
  if (selector.effectSourceIds?.length && !selector.effectSourceIds.includes(status.attribution.effectSourceId)) return false;
  if (selector.applierIds?.length && !selector.applierIds.includes(status.attribution.applierId)) return false;
  if (selector.creditActorIds?.length && !selector.creditActorIds.includes(status.attribution.creditActorId)) return false;
  if (selector.creditOwnerIds?.length && !selector.creditOwnerIds.includes(status.attribution.creditOwnerId)) return false;
  if (selector.polarities?.length && !selector.polarities.includes(status.polarity)) return false;
  if (selector.excludeIdentityIds?.includes(status.identityId)) return false;
  if (selector.excludeMechanicIds?.includes(status.mechanicId)) return false;
  return true;
}

function matchesBarrierSelector(barrier: BarrierEntry, selector: BarrierSelector): boolean {
  if (selector.barrierIds?.length && !selector.barrierIds.includes(barrier.id)) return false;
  if (selector.identityIds?.length && !selector.identityIds.includes(barrier.identityId)) return false;
  if (selector.sourceIds?.length && !selector.sourceIds.includes(barrier.sourceId)) return false;
  if (selector.effectSourceIds?.length && !selector.effectSourceIds.includes(barrier.attribution.effectSourceId)) return false;
  if (selector.applierIds?.length && !selector.applierIds.includes(barrier.attribution.applierId)) return false;
  if (selector.polarities?.length && !selector.polarities.includes(barrier.polarity)) return false;
  if (selector.excludeIdentityIds?.includes(barrier.identityId)) return false;
  if (selector.excludeSourceIds?.includes(barrier.sourceId)) return false;
  return true;
}

function statusComponents(application: StatusApplication): Array<{
  mechanicId: string;
  potency?: number;
  stackMode?: StatusInstance['stackMode'];
  calculationStage?: StatusInstance['calculationStage'];
  damageSourceMask?: StatusInstance['damageSourceMask'];
  statScope?: StatusInstance['statScope'];
}> {
  const identity = getStatusIdentityDefinition(application.identityId);
  if (identity.components?.length) {
    return identity.components.map((component) => ({
      mechanicId: component.mechanicId,
      potency: application.componentPotencies?.[component.mechanicId] ?? application.potency ?? component.potency,
      stackMode: component.stackMode,
      calculationStage: component.calculationStage,
      damageSourceMask: component.damageSourceMask,
      statScope: component.statScope,
    }));
  }
  return [{
    mechanicId: identity.mechanicId,
    potency: application.potency ?? identity.defaultPotency,
    stackMode: identity.stackMode,
    calculationStage: identity.calculationStage,
    damageSourceMask: identity.damageSourceMask,
    statScope: identity.statScope,
  }];
}

function makeStatusInstance(
  fighter: Fighter,
  application: StatusApplication,
  component: ReturnType<typeof statusComponents>[number],
  attribution: StatusAttribution,
  groupId: string | undefined,
): StatusInstance {
  const identity = getStatusIdentityDefinition(application.identityId);
  const mechanic = getStatusMechanicDefinition(component.mechanicId);
  const tickMode = fighter.isNpc && fighter.cannotAct && identity.tickMode === 'self_opportunity'
    ? 'global_action'
    : identity.tickMode;
  const expiresOn = tickMode === 'global_action' && identity.expiresOn === 'self_opportunity_end'
    ? 'global_action_end'
    : identity.expiresOn;
  const sequence = nextStatusSequence(fighter);
  const dualValue = mechanic.dualValue === true;
  const status: StatusInstance = {
    instanceId: nextStatusId(fighter, sequence),
    identityId: application.identityId,
    mechanicId: component.mechanicId,
    tickMode,
    expiresOn,
    polarity: identity.polarity,
    dispelTier: identity.dispelTier,
    stackMode: component.stackMode ?? identity.stackMode,
    calculationStage: component.calculationStage ?? mechanic.calculationStage,
    attribution,
    appliedSequence: sequence,
    groupId,
    damageSourceMask: component.damageSourceMask ?? mechanic.damageSourceMask,
    statScope: component.statScope ?? mechanic.statScope,
    barrierInteraction: identity.barrierInteraction ?? mechanic.barrierInteraction,
  };

  const potency = component.potency ?? identity.defaultPotency ?? mechanic.defaultPotency;
  if (potency !== undefined) status.potency = cap(potency, mechanic.potencyCap);
  if (dualValue) {
    status.count = cap(application.count ?? identity.defaultCount ?? mechanic.defaultCount ?? 1, mechanic.countCap);
  }
  const charges = application.charges ?? identity.defaultCharges ?? mechanic.defaultCharges;
  if (!dualValue && (charges !== undefined || expiresOn === 'trigger')) {
    status.charges = cap(charges ?? 1, mechanic.chargeCap);
  }
  if (!dualValue && expiresOn !== 'never' && expiresOn !== 'trigger') {
    status.remainingTurns = cap(application.remainingTurns ?? 1, identity.remainingTurnCap);
  }
  if (tickMode === 'global_action' && application.observedAt?.globalAction !== undefined) {
    status.lastAdvancedAt = application.observedAt.globalAction;
  } else if (tickMode === 'large_round' && application.observedAt?.largeRound !== undefined) {
    status.lastAdvancedAt = application.observedAt.largeRound;
  }
  return status;
}

function mergeValue(current: number, incoming: number, mode: StatusInstance['stackMode'], capValue?: number): number {
  const next = mode === 'add'
    ? current + incoming
    : mode === 'overwrite' || mode === 'replace' || mode === 'exclusive'
      ? incoming
      : Math.max(current, incoming);
  return cap(next, capValue);
}

function mergeStatus(existing: StatusInstance, incoming: StatusInstance): boolean {
  const previous = JSON.stringify(existing);
  const definition = getStatusMechanicDefinition(existing.mechanicId);
  if (incoming.potency !== undefined) {
    existing.potency = mergeValue(existing.potency ?? 0, incoming.potency, existing.stackMode, definition.potencyCap);
  }
  if (incoming.count !== undefined) {
    existing.count = mergeValue(existing.count ?? 0, incoming.count, existing.stackMode, definition.countCap);
  }
  if (incoming.charges !== undefined) {
    existing.charges = mergeValue(existing.charges ?? 0, incoming.charges, existing.stackMode, definition.chargeCap);
  }
  if (incoming.remainingTurns !== undefined) {
    // Duration refresh is independent from value stacking. Reapplying poison,
    // for example, adds potency but refreshes rather than doubles its clock.
    existing.remainingTurns = existing.stackMode === 'overwrite' ||
      existing.stackMode === 'replace' || existing.stackMode === 'exclusive'
      ? cap(incoming.remainingTurns)
      : Math.max(existing.remainingTurns ?? 0, incoming.remainingTurns);
  }
  existing.attribution = incoming.attribution;
  existing.appliedSequence = incoming.appliedSequence;
  existing.groupId = incoming.groupId ?? existing.groupId;
  if (incoming.lastAdvancedAt === undefined) delete existing.lastAdvancedAt;
  else existing.lastAdvancedAt = incoming.lastAdvancedAt;
  return previous !== JSON.stringify(existing);
}

function trimMechanicPotency(fighter: Fighter, mechanicId: string, maximum: number): void {
  const entries = fighter.statuses
    .filter((status) => status.mechanicId === mechanicId && (status.potency ?? 0) > 0)
    .sort((a, b) => a.appliedSequence - b.appliedSequence);
  let overflow = entries.reduce((sum, status) => sum + (status.potency ?? 0), 0) - maximum;
  for (const status of entries) {
    if (overflow <= 0) break;
    const removed = Math.min(status.potency ?? 0, overflow);
    status.potency = Math.max(0, (status.potency ?? 0) - removed);
    overflow -= removed;
    if ((status.potency ?? 0) <= 0) removeEffects(fighter, { instanceIds: [status.instanceId], reason: 'replaced' });
  }
}

export function initializeEffectState(fighter: Fighter): void {
  fighter.statuses = fighter.statuses ?? [];
  fighter.barriers = fighter.barriers ?? [];
  fighter.statusSequence = Math.max(
    fighter.statusSequence ?? 0,
    ...fighter.statuses.map((status) => status.appliedSequence),
  );
  fighter.barrierSequence = Math.max(
    fighter.barrierSequence ?? 0,
    ...fighter.barriers.map((barrier) => barrier.appliedSequence),
  );
  if (!fighter.isNpc) {
    fighter.maxMorale = Math.max(1, fighter.maxMorale ?? 100);
    fighter.morale = Math.max(0, Math.min(fighter.maxMorale, fighter.morale ?? fighter.maxMorale));
    fighter.staggerThreshold = Math.max(1, fighter.staggerThreshold ?? 40);
    fighter.stagger = Math.max(0, fighter.stagger ?? 0);
  } else {
    delete fighter.maxMorale;
    delete fighter.morale;
    delete fighter.moraleLostSinceOpportunity;
  }
}

export function applyStatus(fighter: Fighter, application: StatusApplication): StatusApplicationResult {
  initializeEffectState(fighter);
  const attribution = buildAttribution(application.identityId, application.attribution, application.effectName);
  const identityDefinition = getStatusIdentityDefinition(application.identityId);
  const exclusiveGroup = identityDefinition.exclusiveGroup;
  if (exclusiveGroup) {
    removeEffects(fighter, {
      exclusiveGroupIds: [exclusiveGroup],
      applierIds: [attribution.applierId],
      excludeIdentityIds: [application.identityId],
      reason: 'replaced',
    });
  }
  if (identityDefinition.stackMode === 'replace' || identityDefinition.stackMode === 'exclusive') {
    removeEffects(fighter, {
      identityIds: [application.identityId],
      reason: 'replaced',
    });
  }
  const components = statusComponents(application);
  const groupId = application.groupId ?? (components.length > 1
    ? `${fighter.id}:status-group:${Math.max(0, fighter.statusSequence ?? 0) + 1}`
    : undefined);
  const statuses: StatusInstance[] = [];
  let created = false;
  let changed = false;

  for (const component of components) {
    const beforePotency = aggregateMechanicPotency(fighter, component.mechanicId);
    const incoming = makeStatusInstance(fighter, application, component, attribution, groupId);
    const existing = fighter.statuses.find((status) =>
      status.identityId === incoming.identityId &&
      status.mechanicId === incoming.mechanicId &&
      sameAttribution(status.attribution, incoming.attribution),
    );
    if (existing) {
      changed = mergeStatus(existing, incoming) || changed;
      statuses.push(existing);
    } else {
      fighter.statuses.push(incoming);
      statuses.push(incoming);
      created = true;
      changed = true;
    }
    transitionPersistentStatShape(
      fighter,
      component.mechanicId,
      beforePotency,
      aggregateMechanicPotency(fighter, component.mechanicId),
    );
  }

  if (statuses.some((status) => status.mechanicId === 'POISON')) trimMechanicPotency(fighter, 'POISON', 3);
  const primary = statuses.find((status) => fighter.statuses.includes(status)) ?? statuses[statuses.length - 1];
  if (!primary) throw new Error(`Status application produced no instances: ${application.identityId}`);
  return { statuses: statuses.filter((status) => fighter.statuses.includes(status)), primary, created, changed };
}

export function applyStatusBundle(
  fighter: Fighter,
  applications: readonly StatusApplication[],
): StatusApplicationResult[] {
  const groupId = applications.find((application) => application.groupId)?.groupId ??
    (applications.length > 1 ? `${fighter.id}:status-group:${Math.max(0, fighter.statusSequence ?? 0) + 1}` : undefined);
  return applications.map((application) => applyStatus(fighter, {
    ...application,
    groupId: application.groupId ?? groupId,
  }));
}

export function queryMechanic(fighter: Fighter, mechanicId: string, selector: StatusSelector = {}): StatusValueQuery {
  const definition = getStatusMechanicDefinition(mechanicId);
  const entries = fighter.statuses.filter((status) =>
    status.mechanicId === mechanicId && matchesStatusSelector(status, selector),
  );
  return {
    mechanicId,
    potency: cap(aggregateStatusValue(entries, 'potency'), definition.potencyCap),
    count: cap(aggregateStatusValue(entries, 'count'), definition.countCap),
    charges: cap(aggregateStatusValue(entries, 'charges'), definition.chargeCap),
    entries,
  };
}

export function hasMechanic(fighter: Fighter, mechanicId: string, selector: StatusSelector = {}): boolean {
  return queryMechanic(fighter, mechanicId, selector).entries.length > 0;
}

export function findIdentity(fighter: Fighter, identityId: string, selector: StatusSelector = {}): StatusInstance | undefined {
  return fighter.statuses
    .filter((status) => status.identityId === identityId && matchesStatusSelector(status, selector))
    .sort((a, b) => b.appliedSequence - a.appliedSequence)[0];
}

export function hasIdentity(fighter: Fighter, identityId: string, selector: StatusSelector = {}): boolean {
  return fighter.statuses.some((status) =>
    status.identityId === identityId && matchesStatusSelector(status, selector),
  );
}

export function findMechanic(fighter: Fighter, mechanicId: string, selector: StatusSelector = {}): StatusInstance | undefined {
  return queryMechanic(fighter, mechanicId, selector).entries
    .filter((status) => (status.count ?? status.charges ?? status.remainingTurns ?? status.potency ?? 1) > 0)
    .sort((a, b) => b.appliedSequence - a.appliedSequence)[0];
}

export function consumeStatusValue(
  fighter: Fighter,
  status: StatusInstance,
  field: StatusValueField,
  amount = 1,
  reason: StatusRemovalReason = 'consumed',
): boolean {
  if (!fighter.statuses.includes(status)) return false;
  const current = status[field];
  if (current === undefined) return false;
  const beforePotency = field === 'potency'
    ? aggregateMechanicPotency(fighter, status.mechanicId)
    : undefined;
  status[field] = Math.max(0, current - Math.max(1, Math.floor(amount)));
  const exhausted = (status[field] ?? 0) <= 0;
  if (exhausted) removeEffects(fighter, { instanceIds: [status.instanceId], reason });
  if (beforePotency !== undefined) {
    transitionPersistentStatShape(
      fighter,
      status.mechanicId,
      beforePotency,
      aggregateMechanicPotency(fighter, status.mechanicId),
    );
  }
  return exhausted;
}

export function consumeMechanicValue(
  fighter: Fighter,
  mechanicId: string,
  field: StatusValueField,
  amount = 1,
): StatusInstance | undefined {
  const status = findMechanic(fighter, mechanicId);
  if (!status) return undefined;
  consumeStatusValue(fighter, status, field, amount);
  return status;
}

export function removeEffects(fighter: Fighter, spec: EffectRemovalSpec): StatusInstance[] {
  const removed = fighter.statuses.filter((status) => matchesStatusSelector(status, spec));
  if (removed.length > 0) {
    const shapedMechanics = [...new Set(removed
      .map((status) => status.mechanicId)
      .filter((mechanicId) => !!getStatusMechanicDefinition(mechanicId).persistentStatShape))];
    const beforePotencies = new Map(shapedMechanics.map((mechanicId) => [
      mechanicId,
      aggregateMechanicPotency(fighter, mechanicId),
    ]));
    const removedIds = new Set(removed.map((status) => status.instanceId));
    fighter.statuses = fighter.statuses.filter((status) => !removedIds.has(status.instanceId));
    shapedMechanics.forEach((mechanicId) => {
      transitionPersistentStatShape(
        fighter,
        mechanicId,
        beforePotencies.get(mechanicId) ?? 0,
        aggregateMechanicPotency(fighter, mechanicId),
      );
    });
  }
  return removed;
}

function canDispelStatus(status: StatusInstance, options: DispelOptions): boolean {
  if (options.instanceIds && !options.instanceIds.includes(status.instanceId)) return false;
  if (status.polarity === 'neutral' && !options.includeNeutral) return false;
  if (status.polarity === 'independent' && !options.includeIndependent) return false;
  if (options.direction !== 'all' && status.polarity !== options.direction) return false;
  if (options.strength === 'absolute') return true;
  if (status.dispelTier === 'none') return false;
  if (status.dispelTier === 'strong_only') return options.strength === 'strong';
  return true;
}

function isStatusSelectedForDispel(status: StatusInstance, options: DispelOptions): boolean {
  const hasInstanceSelector = !!options.instanceIds?.length;
  const hasCatalogSelector = !!(options.identityIds?.length || options.mechanicIds?.length);
  const hasStatusSelector = hasInstanceSelector || hasCatalogSelector;
  const hasBarrierSelector = !!options.barrierSourceIds?.length;
  const directionMatches = options.direction === 'all' || status.polarity === options.direction;
  const selectorMatches = hasStatusSelector
    ? (!hasInstanceSelector || !!options.instanceIds?.includes(status.instanceId)) &&
      (!hasCatalogSelector ||
        !!options.identityIds?.includes(status.identityId) ||
        !!options.mechanicIds?.includes(status.mechanicId))
    : !hasBarrierSelector;
  return directionMatches &&
    selectorMatches &&
    !options.excludeIdentityIds?.includes(status.identityId) &&
    !options.excludeMechanicIds?.includes(status.mechanicId);
}

/** Returns the active status instances that the exact dispel specification can remove. */
export function queryDispellableStatuses(fighter: Fighter, options: DispelOptions): StatusInstance[] {
  return fighter.statuses.filter((status) =>
    isStatusSelectedForDispel(status, options) && canDispelStatus(status, options),
  );
}

export function dispelStatusEffects(fighter: Fighter, options: DispelOptions): StatusRemovalResult {
  const removed: StatusInstance[] = [];
  const blocked: StatusInstance[] = [];
  for (const status of [...fighter.statuses]) {
    if (!isStatusSelectedForDispel(status, options)) continue;
    if (canDispelStatus(status, options)) removed.push(status);
    else blocked.push(status);
  }
  if (removed.length > 0) removeEffects(fighter, { instanceIds: removed.map((status) => status.instanceId), reason: options.reason });
  return { removed, blocked };
}

function canDispelBarrier(barrier: BarrierEntry, options: DispelOptions): boolean {
  if (options.direction !== 'all' && options.direction !== barrier.polarity) return false;
  if (options.excludeBarrierSourceIds?.includes(barrier.sourceId)) return false;
  if (options.strength === 'absolute') return true;
  if (barrier.dispelTier === 'none') return false;
  if (barrier.dispelTier === 'strong_only') return options.strength === 'strong';
  return true;
}

export function dispelBarrierEffects(fighter: Fighter, options: DispelOptions): BarrierDispelResult {
  if (options.direction === 'negative' || options.includeBarriers === false) return { removed: [], blocked: [] };
  const removed: BarrierEntry[] = [];
  const blocked: BarrierEntry[] = [];
  for (const barrier of [...(fighter.barriers ?? [])]) {
    const hasStatusSelector = !!(options.instanceIds?.length || options.identityIds?.length || options.mechanicIds?.length);
    const selected = options.barrierSourceIds?.length
      ? options.barrierSourceIds.includes(barrier.sourceId)
      : !hasStatusSelector;
    if (!selected) continue;
    if (options.excludeBarrierSourceIds?.includes(barrier.sourceId)) continue;
    if (canDispelBarrier(barrier, options)) removed.push(barrier);
    else blocked.push(barrier);
  }
  if (removed.length > 0) {
    const ids = new Set(removed.map((barrier) => barrier.id));
    fighter.barriers = (fighter.barriers ?? []).filter((barrier) => !ids.has(barrier.id));
  }
  return { removed, blocked };
}

export function dispelEffects(fighter: Fighter, options: DispelOptions): DispelEffectsResult {
  return {
    statuses: dispelStatusEffects(fighter, options),
    barriers: dispelBarrierEffects(fighter, options),
  };
}

export function advanceEffects(fighter: Fighter, spec: EffectAdvanceSpec): EffectAdvanceResult {
  const eligibleIds = spec.instanceIds ? new Set(spec.instanceIds) : undefined;
  const expiredStatuses: StatusInstance[] = [];
  for (const status of spec.includeStatuses === false ? [] : [...fighter.statuses]) {
    if (status.tickMode !== spec.tickMode) continue;
    if (eligibleIds && !eligibleIds.has(status.instanceId)) continue;
    const advanceField = getStatusMechanicDefinition(status.mechanicId).advanceField ?? 'remainingTurns';
    const currentValue = status[advanceField];
    if (currentValue === undefined) continue;
    if (spec.clock !== undefined && (spec.tickMode === 'global_action' || spec.tickMode === 'large_round')) {
      if (status.lastAdvancedAt === undefined) {
        status.lastAdvancedAt = spec.clock;
        continue;
      }
      if (status.lastAdvancedAt >= spec.clock) continue;
      status.lastAdvancedAt = spec.clock;
    }
    status[advanceField] = Math.max(0, currentValue - 1);
    if ((status[advanceField] ?? 0) <= 0) expiredStatuses.push(status);
  }
  if (expiredStatuses.length > 0) {
    removeEffects(fighter, { instanceIds: expiredStatuses.map((status) => status.instanceId), reason: 'expired' });
  }

  const expiredBarriers = spec.includeBarriers === false || spec.barrierIds?.length === 0
    ? []
    : advanceBarriers(fighter, spec.tickMode, spec.clock, { barrierIds: spec.barrierIds });
  return { expiredStatuses, expiredBarriers };
}

export function grantBarrier(
  fighter: Fighter,
  value: number,
  options: {
    identityId?: string;
    sourceId: string;
    displayName: string;
    icon?: string;
    remainingTurns?: number;
    tickMode?: StatusTickMode;
    priority?: number;
    polarity?: BarrierEntry['polarity'];
    dispelTier?: StatusDispelTier;
    attribution?: Partial<StatusAttribution>;
    stackMode?: 'add' | 'refresh' | 'overwrite';
  },
): BarrierEntry {
  fighter.barriers = fighter.barriers ?? [];
  const incoming = Math.max(0, Math.floor(value));
  const identityId = options.identityId ?? 'BARRIER';
  const definition = getBarrierIdentityDefinition(identityId);
  if (!options.sourceId.trim()) throw new Error('Barrier sourceId must not be empty');
  const attribution = buildAttribution(identityId, options.attribution, options.displayName);
  const existing = fighter.barriers.find((barrier) =>
    barrier.identityId === identityId &&
    barrier.sourceId === options.sourceId &&
    sameAttribution(barrier.attribution, attribution),
  );
  if (existing) {
    fighter.barrierSequence = Math.max(0, fighter.barrierSequence ?? 0) + 1;
    existing.appliedSequence = fighter.barrierSequence;
    if (options.stackMode === 'overwrite') existing.value = incoming;
    else existing.value += incoming;
    existing.maxValue = Math.max(existing.maxValue, existing.value);
    if (options.remainingTurns !== undefined) {
      existing.remainingTurns = options.stackMode === 'refresh'
        ? Math.max(existing.remainingTurns ?? 0, options.remainingTurns)
        : options.remainingTurns;
    }
    existing.attribution = attribution;
    delete existing.lastAdvancedAt;
    return existing;
  }
  const tickMode = options.tickMode ?? definition.tickMode;
  const barrier: BarrierEntry = {
    id: nextBarrierId(fighter),
    identityId,
    sourceId: options.sourceId,
    displayName: options.displayName,
    icon: options.icon ?? definition.icon,
    value: incoming,
    maxValue: incoming,
    remainingTurns: options.remainingTurns,
    tickMode,
    priority: options.priority ?? 100,
    appliedSequence: fighter.barrierSequence ?? 0,
    polarity: options.polarity ?? definition.polarity,
    dispelTier: options.dispelTier ?? definition.dispelTier,
    attribution,
  };
  fighter.barriers.push(barrier);
  return barrier;
}

export function getBarrierTotal(fighter: Fighter, selector: BarrierSelector = {}): number {
  return (fighter.barriers ?? [])
    .filter((barrier) => matchesBarrierSelector(barrier, selector))
    .reduce((sum, barrier) => sum + Math.max(0, barrier.value), 0);
}

export function removeBarriers(fighter: Fighter, selector: BarrierSelector = {}): BarrierEntry[] {
  const removed = (fighter.barriers ?? []).filter((barrier) => matchesBarrierSelector(barrier, selector));
  if (removed.length === 0) return [];
  const ids = new Set(removed.map((barrier) => barrier.id));
  fighter.barriers = (fighter.barriers ?? []).filter((barrier) => !ids.has(barrier.id));
  return removed;
}

export function consumeBarriers(
  fighter: Fighter,
  amount: number,
  selector: BarrierSelector = {},
): BarrierConsumptionResult {
  const barriers = [...(fighter.barriers ?? [])]
    .filter((barrier) => barrier.value > 0 && matchesBarrierSelector(barrier, selector))
    .sort((a, b) => {
      const aExpiry = a.remainingTurns ?? Number.MAX_SAFE_INTEGER;
      const bExpiry = b.remainingTurns ?? Number.MAX_SAFE_INTEGER;
      return aExpiry - bExpiry || (a.priority ?? 100) - (b.priority ?? 100) || a.appliedSequence - b.appliedSequence;
    });
  let remaining = Math.max(0, Math.floor(amount));
  let absorbed = 0;
  const broken: BarrierEntry[] = [];
  const touched: BarrierEntry[] = [];
  const absorptions: Array<{ barrier: BarrierEntry; amount: number }> = [];
  for (const barrier of barriers) {
    if (remaining <= 0) break;
    const taken = Math.min(remaining, barrier.value);
    if (taken <= 0) continue;
    touched.push(barrier);
    absorptions.push({ barrier, amount: taken });
    barrier.value -= taken;
    remaining -= taken;
    absorbed += taken;
    if (barrier.value <= 0) broken.push(barrier);
  }
  if (broken.length > 0) {
    const ids = new Set(broken.map((barrier) => barrier.id));
    fighter.barriers = (fighter.barriers ?? []).filter((barrier) => !ids.has(barrier.id));
  }
  return { absorbed, remaining, broken, touched, absorptions };
}

function advanceBarriers(
  fighter: Fighter,
  tickMode: Exclude<StatusTickMode, 'trigger' | 'permanent'>,
  clock?: number,
  selector: BarrierSelector = {},
): BarrierEntry[] {
  const expired: BarrierEntry[] = [];
  for (const barrier of fighter.barriers ?? []) {
    if (!matchesBarrierSelector(barrier, selector) || barrier.tickMode !== tickMode || barrier.remainingTurns === undefined) continue;
    if (clock !== undefined && (tickMode === 'global_action' || tickMode === 'large_round')) {
      if (barrier.lastAdvancedAt === undefined) {
        barrier.lastAdvancedAt = clock;
        continue;
      }
      if (barrier.lastAdvancedAt >= clock) continue;
      barrier.lastAdvancedAt = clock;
    }
    barrier.remainingTurns = Math.max(0, barrier.remainingTurns - 1);
    if (barrier.remainingTurns <= 0) expired.push(barrier);
  }
  if (expired.length > 0) {
    const ids = new Set(expired.map((barrier) => barrier.id));
    fighter.barriers = (fighter.barriers ?? []).filter((barrier) => !ids.has(barrier.id));
  }
  return expired;
}

export function formatStatusValue(status: StatusInstance): string {
  if (isDualValueStatus(status)) return `${status.potency ?? 0}×${status.count ?? 0}`;
  if (status.mechanicId === 'CHARGE') return `${status.potency ?? 0}/20`;
  if (status.mechanicId === 'ORIGINIUM_DISEASE') return `${status.potency ?? 0}/80层`;
  if (status.mechanicId === 'MOMO_CROWD_JOY') return `${status.potency ?? 0}/138层`;
  if (status.mechanicId === 'OWL_WILD') return `${status.potency ?? 0}/5层`;
  const pieces: string[] = [];
  if (status.potency !== undefined && status.potency !== 0) {
    pieces.push(
      status.mechanicId === 'POISON'
        ? `${status.potency}层`
        : status.mechanicId.endsWith('_FLAT_UP')
          ? `${status.potency}点`
          : `${status.potency}%`,
    );
  }
  if (status.remainingTurns !== undefined) {
    const clock = status.tickMode === 'global_action'
      ? '次全局行动'
      : status.tickMode === 'large_round'
        ? '个大回合'
        : '次自身行动机会';
    pieces.push(`${status.remainingTurns}${clock}`);
  }
  if (status.charges !== undefined) pieces.push(`${status.charges}次`);
  return pieces.join(' · ');
}

export function statusSourceName(status: StatusInstance): string {
  return status.attribution.applierName ?? status.attribution.effectSourceName ?? getStatusIdentityDefinition(status.identityId).displayName;
}
