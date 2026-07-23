import type { StatusInstance } from './types';
import { buildStatusPresentationMember } from './statusPresentation';
import { statusHasTag } from './statusRegistry';

function shouldReportRemovedStatus(status: StatusInstance): boolean {
  return statusHasTag(status, 'important_removal');
}

export function filterImportantRemovedStatuses(statuses: readonly StatusInstance[]): StatusInstance[] {
  return statuses.filter(shouldReportRemovedStatus);
}

function statusDisplayName(status: StatusInstance): string {
  return buildStatusPresentationMember(status).name;
}

export function formatRemovedStatusList(statuses: StatusInstance[]): string {
  const names = [...new Set(statuses.map(statusDisplayName))];
  return names.map((name) => `【${name}】`).join('、');
}
