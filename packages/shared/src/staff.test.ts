import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { PERMISSIONS, type Permission } from './business.js';
import { fieldErrors } from './fields.js';
import {
  basisPointsToPercent,
  differenceFromDefaults,
  effectiveDiscountLimit,
  effectivePermissions,
  newStaffSchema,
  staffAddLoginSchema,
  normalisePermissions,
  percentToBasisPoints,
  permissionsProblem,
  staffPasswordProblem,
  staffPasswordSchema,
  staffPermissionsSchema,
  staffUpdateSchema,
  STAFF_SWITCHES,
} from './staff.js';

const NONE = { added: [], removed: [] };
const DEFAULTS: Permission[] = [
  'session.own',
  'items.view',
  'stock.view',
  'billing.sell',
  'customers.view',
  'customers.manage',
];

describe('effectivePermissions', () => {
  it('gives a login with no changes the defaults, session.own first', () => {
    expect(effectivePermissions(NONE)).toEqual(DEFAULTS);
  });

  it('adds what the owner switched on', () => {
    expect(effectivePermissions({ added: ['stock.adjust'], removed: [] })).toContain(
      'stock.adjust',
    );
  });

  it('takes away what the owner switched off, and its children', () => {
    const permissions = effectivePermissions({ added: [], removed: ['customers.view'] });
    expect(permissions).not.toContain('customers.view');
    // customers.manage is on by default but needs customers.view.
    expect(permissions).not.toContain('customers.manage');
  });

  it('lets a removal win when a name is in both lists (the database refuses it too)', () => {
    const permissions = effectivePermissions({
      added: ['stock.adjust'],
      removed: ['stock.adjust'],
    });
    expect(permissions).not.toContain('stock.adjust');
  });

  it.each(['settings.view', 'settings.manage', 'staff.manage', 'session.own', 'made.up'])(
    'ignores %s stored by mistake',
    (name) => {
      const permissions = effectivePermissions({ added: [name], removed: [] });
      expect(permissions).toEqual(DEFAULTS);
    },
  );

  it('ignores a removal of a name it does not know', () => {
    expect(effectivePermissions({ added: [], removed: ['made.up', 'staff.manage'] })).toEqual(
      DEFAULTS,
    );
  });

  it('drops a switch whose parent is off', () => {
    const permissions = effectivePermissions({
      added: ['items.manage', 'items.view_cost', 'billing.discount', 'stock.adjust'],
      removed: ['items.view', 'billing.sell', 'stock.view'],
    });
    for (const name of ['items.manage', 'items.view_cost', 'billing.discount', 'stock.adjust']) {
      expect(permissions).not.toContain(name);
    }
  });

  // The future-module case (design section 3): a stored list can't miss a new default.
  it('turns on a default-on switch that was never mentioned in the stored lists', () => {
    expect(effectivePermissions({ added: ['items.manage'], removed: [] })).toContain(
      'customers.manage',
    );
  });

  it('returns only names that exist, in PERMISSIONS order', () => {
    const permissions = effectivePermissions({
      added: ['stock.adjust', 'items.manage', 'billing.discount'],
      removed: [],
    });
    const order = PERMISSIONS.filter((name) => permissions.includes(name));
    expect(permissions).toEqual(order);
  });
});

describe('the switch list', () => {
  it('names a permission once, and every parent comes before its children', () => {
    const names = STAFF_SWITCHES.map((entry) => entry.permission);
    expect(new Set(names).size).toBe(names.length);
    STAFF_SWITCHES.forEach((entry, index) => {
      if (entry.parent !== null) {
        expect(names.indexOf(entry.parent)).toBeLessThan(index);
      }
    });
  });

  it('has "Give udhaar" off by default, under "Bill customers" (`03` #10)', () => {
    expect(STAFF_SWITCHES.find((entry) => entry.permission === 'billing.udhaar')).toEqual({
      permission: 'billing.udhaar',
      group: 'billing',
      default: false,
      parent: 'billing.sell',
    });
    // An old login that never had a choice about it gets the default: off (ADR 0044).
    expect(effectivePermissions(NONE)).not.toContain('billing.udhaar');
    expect(effectivePermissions({ added: ['billing.udhaar'], removed: [] })).toContain(
      'billing.udhaar',
    );
    // ...and it goes with its parent.
    expect(
      effectivePermissions({ added: ['billing.udhaar'], removed: ['billing.sell'] }),
    ).not.toContain('billing.udhaar');
  });

  it('keeps the owner-only permissions off the list', () => {
    const names: string[] = STAFF_SWITCHES.map((entry) => entry.permission);
    for (const owner of ['session.own', 'settings.view', 'settings.manage', 'staff.manage']) {
      expect(names).not.toContain(owner);
    }
  });
});

describe('differenceFromDefaults', () => {
  it('stores nothing for the defaults', () => {
    expect(differenceFromDefaults(DEFAULTS.filter((name) => name !== 'session.own'))).toEqual(NONE);
  });

  it('stores only what differs, and round-trips', () => {
    const wanted = ['billing.sell', 'billing.discount', 'items.view', 'items.view_cost'] as const;
    const difference = differenceFromDefaults(wanted);
    expect(difference.added).toEqual(['items.view_cost', 'billing.discount'].sort(byListOrder));
    expect(difference.removed).toEqual(
      ['stock.view', 'customers.view', 'customers.manage'].sort(byListOrder),
    );
    expect(effectivePermissions(difference).filter((name) => name !== 'session.own')).toEqual(
      PERMISSIONS.filter((name) => (wanted as readonly string[]).includes(name)),
    );
  });
});

function byListOrder(a: string, b: string) {
  const order: string[] = STAFF_SWITCHES.map((entry) => entry.permission);
  return order.indexOf(a) - order.indexOf(b);
}

describe('permissionsProblem', () => {
  it('accepts a consistent set', () => {
    expect(permissionsProblem(['items.view', 'items.manage', 'billing.sell'])).toBeNull();
    expect(permissionsProblem([])).toBeNull();
  });

  it('refuses a child without its parent', () => {
    expect(permissionsProblem(['items.manage'])).toEqual({
      permission: 'items.manage',
      problem: 'needs_parent',
    });
    expect(permissionsProblem(['billing.discount'])).toEqual({
      permission: 'billing.discount',
      problem: 'needs_parent',
    });
  });

  it.each(['settings.manage', 'staff.manage', 'session.own'])('refuses %s', (name) => {
    expect(permissionsProblem([name])).toEqual({ permission: name, problem: 'not_switchable' });
  });

  it('refuses a name that does not exist', () => {
    expect(permissionsProblem(['made.up'])).toEqual({ permission: 'made.up', problem: 'unknown' });
  });
});

describe('normalisePermissions (the switch screen)', () => {
  it('turns the parent on with its child', () => {
    expect(normalisePermissions([], 'items.manage', true)).toEqual(['items.view', 'items.manage']);
  });

  it('turns the children off with their parent', () => {
    expect(
      normalisePermissions(
        ['items.view', 'items.manage', 'items.view_cost', 'billing.sell'],
        'items.view',
        false,
      ),
    ).toEqual(['billing.sell']);
  });

  it('leaves unrelated switches alone and does not repeat a name', () => {
    expect(normalisePermissions(['items.view', 'stock.view'], 'items.view', true)).toEqual([
      'items.view',
      'stock.view',
    ]);
    expect(normalisePermissions(['stock.view'], 'items.manage', true)).toEqual([
      'items.view',
      'items.manage',
      'stock.view',
    ]);
  });
});

describe('percent and basis points', () => {
  it.each([
    ['7.5', 750],
    ['100', 10_000],
    ['0', 0],
    ['0.07', 7],
    ['5', 500],
    ['.5', 50],
    [' 12.34 ', 1234],
    ['0.01', 1],
  ])('reads %j as %j', (typed, basisPoints) => {
    expect(percentToBasisPoints(typed)).toBe(basisPoints);
  });

  it.each(['100.01', '-1', '1.234', '', ' ', 'abc', '1e2', '101', '1,5', '.'])(
    'refuses %j',
    (typed) => {
      expect(percentToBasisPoints(typed)).toBeNull();
    },
  );

  it.each([
    [750, '7.5'],
    [10_000, '100'],
    [0, '0'],
    [7, '0.07'],
    [500, '5'],
    [1234, '12.34'],
  ])('shows %j basis points as %j', (basisPoints, shown) => {
    expect(basisPointsToPercent(basisPoints)).toBe(shown);
  });
});

describe('effectiveDiscountLimit', () => {
  it('is null for the owner', () => {
    expect(effectiveDiscountLimit('owner', PERMISSIONS, 500)).toBeNull();
  });

  it('is 0 when the switch is off, whatever is stored', () => {
    expect(effectiveDiscountLimit('staff', ['session.own', 'billing.sell'], 750)).toBe(0);
  });

  it('is 0 when the switch is on and no limit was ever set', () => {
    expect(effectiveDiscountLimit('staff', ['billing.sell', 'billing.discount'], null)).toBe(0);
  });

  it('is the stored limit when the switch is on', () => {
    expect(effectiveDiscountLimit('staff', ['billing.sell', 'billing.discount'], 750)).toBe(750);
  });
});

describe('staff bodies', () => {
  const BRANCH = '0190f0f0-0000-7000-8000-0000000000b1';

  it('lower-cases the username and keeps the password as typed', () => {
    const parsed = newStaffSchema.parse({
      name: ' Ramesh ',
      username: ' Ramesh.K ',
      password: ' ten chars! ',
      homeBranchId: BRANCH,
      ownerPassword: ' owner pass ',
    });
    expect(parsed).toMatchObject({
      name: 'Ramesh',
      username: 'ramesh.k',
      password: ' ten chars! ',
      ownerPassword: ' owner pass ',
      homeBranchId: BRANCH,
    });
  });

  it('holds a new login to the password and limit rules', () => {
    const base = {
      name: 'Ramesh',
      username: 'ramesh',
      password: 'a long password',
      homeBranchId: BRANCH,
      ownerPassword: 'x',
    };
    expect(fieldCodes(newStaffSchema, { ...base, password: 'short' })).toEqual({
      password: 'too_short',
    });
    expect(fieldCodes(newStaffSchema, { ...base, homeBranchId: 'nope' })).toEqual({
      homeBranchId: 'invalid',
    });
    expect(fieldCodes(newStaffSchema, { ...base, discountLimitBasisPoints: 10_001 })).toEqual({
      discountLimitBasisPoints: 'too_big',
    });
    expect(fieldCodes(newStaffSchema, { ...base, ownerPassword: '' })).toEqual({
      ownerPassword: 'required',
    });
  });

  it('takes no owner password to edit the profile', () => {
    expect(
      staffUpdateSchema.parse({ name: 'Ramesh', username: 'Ramesh', homeBranchId: BRANCH }),
    ).toEqual({ name: 'Ramesh', username: 'ramesh', homeBranchId: BRANCH });
    expect(
      staffUpdateSchema.safeParse({
        name: 'R',
        username: 'ramesh',
        homeBranchId: BRANCH,
        ownerPassword: 'x',
      }).success,
    ).toBe(false);
  });

  it('takes the whole switch set with the limit and the owner password', () => {
    const body = {
      permissions: ['items.view'],
      discountLimitBasisPoints: null,
      ownerPassword: 'x',
    };
    expect(staffPermissionsSchema.parse(body)).toEqual(body);
    expect(fieldCodes(staffPermissionsSchema, { ...body, ownerPassword: undefined })).toEqual({
      ownerPassword: 'required',
    });
  });

  it('takes a staff password with the owner password', () => {
    expect(fieldCodes(staffPasswordSchema, { newPassword: 'short', ownerPassword: 'x' })).toEqual({
      newPassword: 'too_short',
    });
  });
});

describe('staff records without a login (P2.3, 00 #19)', () => {
  const BRANCH = '0190f0f0-0000-7000-8000-0000000000b1';

  it('takes a name and a home branch alone', () => {
    expect(newStaffSchema.parse({ name: ' Geeta ', homeBranchId: BRANCH })).toEqual({
      name: 'Geeta',
      homeBranchId: BRANCH,
    });
  });

  it('reads the record fields, and a phone number the way customers do', () => {
    const parsed = newStaffSchema.parse({
      name: 'Geeta',
      homeBranchId: BRANCH,
      phone: '+91 98765-43210',
      joiningDate: '2026-11-01',
      weeklyOffDay: 0,
      paidLeavesPerMonth: 2,
      overtimeRatePaise: 15_000,
      salary: { kind: 'monthly', amountPaise: 1_200_000 },
    });
    expect(parsed).toMatchObject({
      phone: '9876543210',
      weeklyOffDay: 0,
      paidLeavesPerMonth: 2,
      overtimeRatePaise: 15_000,
      salary: { kind: 'monthly', amountPaise: 1_200_000 },
    });
    expect(fieldCodes(newStaffSchema, { name: 'G', homeBranchId: BRANCH, phone: '123' })).toEqual({
      phone: 'invalid',
    });
  });

  it.each([
    [{ weeklyOffDay: 7 }, { weeklyOffDay: 'invalid' }],
    [{ paidLeavesPerMonth: 32 }, { paidLeavesPerMonth: 'too_big' }],
    [{ paidLeavesPerMonth: -1 }, { paidLeavesPerMonth: 'too_small' }],
    [{ overtimeRatePaise: 0 }, { overtimeRatePaise: 'too_small' }],
    [{ joiningDate: '2026-02-30' }, { joiningDate: 'invalid' }],
  ])('refuses %j', (change, codes) => {
    expect(fieldCodes(newStaffSchema, { name: 'G', homeBranchId: BRANCH, ...change })).toEqual(
      codes,
    );
  });

  it('needs the whole login or none of it, and the owner password only for a login', () => {
    const base = { name: 'G', homeBranchId: BRANCH };
    expect(fieldCodes(newStaffSchema, { ...base, username: 'geeta' })).toEqual({
      password: 'required',
      ownerPassword: 'required',
    });
    expect(fieldCodes(newStaffSchema, { ...base, password: 'a long password' })).toEqual({
      username: 'required',
      ownerPassword: 'required',
    });
    // Switches and a discount limit mean nothing without a login.
    expect(fieldCodes(newStaffSchema, { ...base, permissions: [] })).toEqual({
      permissions: 'invalid',
    });
  });

  it('gives a record a login with a username, a password and the owner password', () => {
    const body = { username: 'Geeta', password: 'a long password', ownerPassword: 'x' };
    expect(staffAddLoginSchema.parse(body)).toEqual({ ...body, username: 'geeta' });
    expect(fieldCodes(staffAddLoginSchema, { ...body, ownerPassword: undefined })).toEqual({
      ownerPassword: 'required',
    });
  });

  it('leaves out of an edit what was not sent', () => {
    expect(staffUpdateSchema.parse({ name: 'G', homeBranchId: BRANCH, version: 2 })).toEqual({
      name: 'G',
      homeBranchId: BRANCH,
      version: 2,
    });
    expect(
      staffUpdateSchema.parse({ name: 'G', homeBranchId: BRANCH, phone: '', weeklyOffDay: null }),
    ).toEqual({ name: 'G', homeBranchId: BRANCH, phone: null, weeklyOffDay: null });
  });
});

describe('the attendance switches (05 #25, #26)', () => {
  it('start off, are not tied to another switch and form their own group', () => {
    const attendance = STAFF_SWITCHES.filter((entry) => entry.group === 'attendance');
    expect(attendance.map((entry) => entry.permission)).toEqual([
      'attendance.mark',
      'attendance.view_all',
    ]);
    for (const entry of attendance) {
      expect(entry.default).toBe(false);
      expect(entry.parent).toBeNull();
    }
    expect(effectivePermissions(NONE)).not.toContain('attendance.mark');
    expect(effectivePermissions({ added: ['attendance.mark'], removed: [] })).toContain(
      'attendance.mark',
    );
  });
});

describe('staffPasswordProblem', () => {
  const account = { username: 'ramesh', phone: '9111111111' };
  it.each([
    ['ramesh', 'same_as_username'],
    [' RAMESH ', 'same_as_username'],
    ['+91 91111 11111', 'same_as_phone'],
    ['a different password', null],
  ])('says whether %j copies the username or phone', (password, problem) => {
    expect(staffPasswordProblem(password, account)).toBe(problem);
  });
});

function fieldCodes(schema: z.ZodType, body: unknown) {
  const result = schema.safeParse(body);
  return result.success ? {} : fieldErrors(result.error);
}
