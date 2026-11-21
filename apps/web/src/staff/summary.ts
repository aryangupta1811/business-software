import { STAFF_SWITCH_GROUPS, STAFF_SWITCHES, type Permission } from '@business-software/shared';
import type { TFunction } from 'i18next';

/** What a login can do, in short: the groups it holds a switch in ("Billing, Customers, Items"). */
export function accessSummary(t: TFunction, permissions: readonly Permission[]): string {
  const groups = STAFF_SWITCH_GROUPS.filter((group) =>
    STAFF_SWITCHES.some((entry) => entry.group === group && permissions.includes(entry.permission)),
  );
  return groups.length === 0
    ? t('staff.nothing')
    : groups.map((group) => t(`staff.groups.${group}`)).join(', ');
}
