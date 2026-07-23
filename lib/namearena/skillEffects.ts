import type { GachaEntry, SkillDefinition, SkillStatusApplication } from './types';

type StatusApplicationCarrier = Pick<SkillDefinition, 'statusApplications'> | Pick<GachaEntry, 'statusApplications'>;

export function statusApplicationsOf(carrier: StatusApplicationCarrier): readonly SkillStatusApplication[] {
  return carrier.statusApplications ?? [];
}

export function primaryStatusApplication(carrier: StatusApplicationCarrier): SkillStatusApplication | undefined {
  return statusApplicationsOf(carrier)[0];
}

export function primaryStatusIdentity(carrier: StatusApplicationCarrier): string | undefined {
  return primaryStatusApplication(carrier)?.identityId;
}

export function hasStatusApplication(carrier: StatusApplicationCarrier, identityId: string): boolean {
  return statusApplicationsOf(carrier).some((application) => application.identityId === identityId);
}
