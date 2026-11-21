// Staff logins and their permissions (P1.5 design; Module 00 #15–#17, #33–#35, #44, #47–#53).
// A staff login stores only its changes from the defaults below, so a permission a later module
// adds takes its default for every login that never had a choice about it (ADR 0044).
// Error messages are codes the web app translates (ADR 0036).
import { z } from 'zod';
import { ownerPasswordSchema, newPassword, username } from './auth.js';
import { PERMISSIONS, type Permission } from './business.js';
import { normalizePhone, text, uuid } from './fields.js';

/** The groups on the switch screen, in the order shown. */
export const STAFF_SWITCH_GROUPS = ['billing', 'customers', 'items', 'stock'] as const;
export type StaffSwitchGroup = (typeof STAFF_SWITCH_GROUPS)[number];

export interface StaffSwitch {
  permission: Permission;
  group: StaffSwitchGroup;
  /** On for a new login (design section 4). */
  default: boolean;
  /** Needs this switch on too; every parent is listed before its children. */
  parent: Permission | null;
}

/**
 * The switches the owner can set per staff login. `session.own` (always on) and the owner-only
 * permissions (`settings.*`, `staff.manage`) are not here. A later module adds its permission to
 * `PERMISSIONS` and to this list in the same change.
 */
export const STAFF_SWITCHES: readonly StaffSwitch[] = [
  { permission: 'billing.sell', group: 'billing', default: true, parent: null },
  { permission: 'billing.discount', group: 'billing', default: false, parent: 'billing.sell' },
  { permission: 'customers.view', group: 'customers', default: true, parent: null },
  { permission: 'customers.manage', group: 'customers', default: true, parent: 'customers.view' },
  { permission: 'items.view', group: 'items', default: true, parent: null },
  { permission: 'items.manage', group: 'items', default: false, parent: 'items.view' },
  { permission: 'items.view_cost', group: 'items', default: false, parent: 'items.view' },
  { permission: 'stock.view', group: 'stock', default: true, parent: null },
  { permission: 'stock.adjust', group: 'stock', default: false, parent: 'stock.view' },
];

const SWITCH_BY_NAME = new Map<string, StaffSwitch>(
  STAFF_SWITCHES.map((entry) => [entry.permission, entry]),
);

/** What is stored for a login: its changes from the defaults. Names are not checked by the database. */
export interface PermissionDifference {
  added: readonly string[];
  removed: readonly string[];
}

/**
 * Everything a staff login may do:
 * `((defaults ∪ added) − removed) ∩ switches`, minus any switch whose parent is off, plus
 * `session.own`. A stored name that is unknown or owner-only is ignored, so bad data can never
 * grant anything. In `PERMISSIONS` order.
 */
export function effectivePermissions({ added, removed }: PermissionDifference): Permission[] {
  const on = new Set<string>(
    STAFF_SWITCHES.filter((entry) => entry.default).map((entry) => entry.permission),
  );
  for (const name of added) if (SWITCH_BY_NAME.has(name)) on.add(name);
  for (const name of removed) on.delete(name);
  // Parents come first in the list, so one pass drops a whole chain.
  for (const entry of STAFF_SWITCHES) {
    if (entry.parent !== null && !on.has(entry.parent)) on.delete(entry.permission);
  }
  return PERMISSIONS.filter((name) => name === 'session.own' || on.has(name));
}

/** The changes from the defaults that make `wanted` (the switches that are on) the effective set. */
export function differenceFromDefaults(wanted: readonly Permission[]): {
  added: Permission[];
  removed: Permission[];
} {
  const on = new Set<string>(wanted);
  return {
    added: STAFF_SWITCHES.filter((entry) => !entry.default && on.has(entry.permission)).map(
      (entry) => entry.permission,
    ),
    removed: STAFF_SWITCHES.filter((entry) => entry.default && !on.has(entry.permission)).map(
      (entry) => entry.permission,
    ),
  };
}

export interface PermissionsProblem {
  permission: string;
  problem: 'unknown' | 'not_switchable' | 'needs_parent';
}

/**
 * Why a set of switches can't be saved, or null. The server answers `422 invalid_permissions`;
 * the screen never sends such a set because `normalisePermissions` keeps it consistent.
 */
export function permissionsProblem(permissions: readonly string[]): PermissionsProblem | null {
  const on = new Set(permissions);
  for (const name of permissions) {
    const entry = SWITCH_BY_NAME.get(name);
    if (entry === undefined) {
      const exists = (PERMISSIONS as readonly string[]).includes(name);
      return { permission: name, problem: exists ? 'not_switchable' : 'unknown' };
    }
    if (entry.parent !== null && !on.has(entry.parent)) {
      return { permission: name, problem: 'needs_parent' };
    }
  }
  return null;
}

/**
 * The switch screen's rule: turning a child on turns its parent on, turning a parent off turns
 * its children off. Answers the switches that are on, in list order.
 */
export function normalisePermissions(
  current: readonly Permission[],
  changed: Permission,
  on: boolean,
): Permission[] {
  const next = new Set<string>(current);
  if (on) {
    for (let name: Permission | null = changed; name !== null;) {
      next.add(name);
      name = SWITCH_BY_NAME.get(name)?.parent ?? null;
    }
  } else {
    next.delete(changed);
    // Parents come first, so one pass drops a whole chain.
    for (const entry of STAFF_SWITCHES) {
      if (entry.parent !== null && !next.has(entry.parent)) next.delete(entry.permission);
    }
  }
  return STAFF_SWITCHES.filter((entry) => next.has(entry.permission)).map(
    (entry) => entry.permission,
  );
}

const PERCENT = /^(\d*)(?:\.(\d{0,2}))?$/;

/** "7.5" → 750 basis points. Null for anything that isn't 0 to 100 with at most two decimals. */
export function percentToBasisPoints(input: string): number | null {
  const match = PERCENT.exec(input.trim());
  if (match === null) return null;
  const [, whole = '', fraction = ''] = match;
  if (whole === '' && fraction === '') return null;
  // Whole numbers only, so no floating-point error can creep in.
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return basisPoints <= 10_000 ? basisPoints : null;
}

/** 750 → "7.5", 10000 → "100". */
export function basisPointsToPercent(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100);
  const fraction = String(basisPoints % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return fraction === '' ? String(whole) : `${String(whole)}.${fraction}`;
}

/**
 * `02` #12: the most this person may discount without the owner's OK. Null for the owner; for
 * staff the stored limit while the discount switch is on, else 0. A switch that was never given
 * a limit counts as 0.
 */
export function effectiveDiscountLimit(
  role: 'owner' | 'staff',
  permissions: readonly Permission[],
  stored: number | null,
): number | null {
  if (role === 'owner') return null;
  return permissions.includes('billing.discount') ? (stored ?? 0) : 0;
}

/** Module 00 #7 for staff: a password can't be the login's username or the business's phone. */
export function staffPasswordProblem(
  password: string,
  account: { username: string | null; phone: string },
): 'same_as_username' | 'same_as_phone' | null {
  if (account.username !== null && password.trim().toLowerCase() === account.username) {
    return 'same_as_username';
  }
  return normalizePhone(password) === account.phone ? 'same_as_phone' : null;
}

const limit = () =>
  z.int({ error: 'invalid' }).min(0, { error: 'too_small' }).max(10_000, { error: 'too_big' });

/** `POST /api/staff`: a new login. Omitted switches take the defaults. */
export const newStaffSchema = ownerPasswordSchema.extend({
  name: text(100),
  username: username(),
  password: newPassword(),
  homeBranchId: uuid(),
  permissions: z.array(z.string().max(64), { error: 'invalid' }).max(64).optional(),
  discountLimitBasisPoints: limit().nullable().optional(),
});
export type NewStaffInput = z.infer<typeof newStaffSchema>;

/** `PUT /api/staff/:id`: the person's details; no permission change here. */
export const staffUpdateSchema = z.strictObject({
  name: text(100),
  username: username(),
  homeBranchId: uuid(),
});
export type StaffUpdateInput = z.infer<typeof staffUpdateSchema>;

/**
 * `PUT /api/staff/:id/permissions`: the whole switch set. The limit is stored while the discount
 * switch is on; while it is off the stored limit is left as it was.
 */
export const staffPermissionsSchema = ownerPasswordSchema.extend({
  permissions: z.array(z.string().max(64), { error: 'invalid' }).max(64),
  discountLimitBasisPoints: limit().nullable(),
});
export type StaffPermissionsInput = z.infer<typeof staffPermissionsSchema>;

/** `POST /api/staff/:id/password`: the owner sets a staff password (#33). */
export const staffPasswordSchema = ownerPasswordSchema.extend({ newPassword: newPassword() });
export type StaffPasswordInput = z.infer<typeof staffPasswordSchema>;

/** `POST /api/staff/:id/deactivate`. */
export const staffDeactivateSchema = z.strictObject({
  reason: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    text(200).optional(),
  ),
});
export type StaffDeactivateInput = z.infer<typeof staffDeactivateSchema>;

/** `GET /api/staff?includeInactive=true`. */
export const staffQuerySchema = z.strictObject({
  includeInactive: z
    .enum(['true', 'false'], { error: 'invalid' })
    .optional()
    .transform((value) => value === 'true'),
});
export type StaffQuery = z.infer<typeof staffQuerySchema>;

/** One staff login on the Staff page. */
export interface StaffView {
  id: string;
  name: string;
  username: string | null;
  homeBranchId: string;
  homeBranchName: string;
  /** The extra branches the owner allowed (P1.6); the home branch is always allowed and not in it. */
  extraBranchIds: string[];
  /** False after "Deactivate"; the history stays. */
  active: boolean;
  /** Everything the login may do, as the session view shows it. */
  permissions: Permission[];
  /** The stored limit, which the switch screen edits; null if never set. */
  discountLimitBasisPoints: number | null;
}
