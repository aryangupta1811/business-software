// The switch screen's state and rules (P1.5 design §4 and §6), kept apart from the screen so the
// rules can be tested alone. The server checks all of it again; the screen only helps.
import {
  basisPointsToPercent,
  normalisePermissions,
  percentToBasisPoints,
  STAFF_SWITCHES,
  type Permission,
  type StaffView,
} from '@business-software/shared';

/** What the owner has set so far: the switches that are on, and the limit as typed. */
export interface Access {
  permissions: Permission[];
  /** The discount limit in percent, as typed (blank until the owner sets one). */
  limit: string;
}

/** The limit the screen offers when "Give discounts" is switched on (design §4). */
export const SUGGESTED_LIMIT = basisPointsToPercent(500);

const DISCOUNT: Permission = 'billing.discount';

/** A new login's switches: the defaults, and no discount limit. */
export function defaultAccess(): Access {
  return {
    permissions: STAFF_SWITCHES.filter((entry) => entry.default).map((entry) => entry.permission),
    limit: '',
  };
}

/** The screen's state for an existing login: its switches, and its stored limit. */
export function accessOf(person: StaffView): Access {
  return {
    permissions: STAFF_SWITCHES.map((entry) => entry.permission).filter((permission) =>
      person.permissions.includes(permission),
    ),
    limit:
      person.discountLimitBasisPoints === null
        ? ''
        : basisPointsToPercent(person.discountLimitBasisPoints),
  };
}

/** One switch turned on or off: dependents follow, and "Give discounts" brings its 5%. */
export function toggle(access: Access, permission: Permission, on: boolean): Access {
  const permissions = normalisePermissions(access.permissions, permission, on);
  const wantsLimit = permissions.includes(DISCOUNT) && access.limit.trim() === '';
  return { permissions, limit: wantsLimit ? SUGGESTED_LIMIT : access.limit };
}

/**
 * The limit in basis points: null while "Give discounts" is off (the server keeps what it had),
 * `'invalid'` if the box holds something that isn't 0 to 100 with at most two decimals.
 */
export function limitOf(access: Access): number | null | 'invalid' {
  if (!access.permissions.includes(DISCOUNT)) return null;
  return percentToBasisPoints(access.limit) ?? 'invalid';
}

/** Is this the same set of switches (and, while discounts are on, the same limit)? */
export function sameAccess(a: Access, b: Access): boolean {
  const left = new Set(a.permissions);
  const same =
    left.size === b.permissions.length && b.permissions.every((permission) => left.has(permission));
  return same && limitOf(a) === limitOf(b);
}
