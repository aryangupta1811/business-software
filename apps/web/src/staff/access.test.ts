import { effectivePermissions } from '@business-software/shared';
import { describe, expect, test } from 'vitest';
import { CASHIER } from '../test/fake-staff';
import { accessOf, defaultAccess, limitOf, sameAccess, toggle } from './access';

describe('the switch screen rules', () => {
  test('a new login starts from the defaults, with no limit', () => {
    expect(defaultAccess()).toEqual({
      permissions: [
        'billing.sell',
        'customers.view',
        'customers.manage',
        'items.view',
        'stock.view',
      ],
      limit: '',
    });
  });

  test('turning a child on turns its parent on; turning a parent off turns its children off', () => {
    const none = { permissions: [], limit: '' } as const;
    expect(toggle({ ...none, permissions: [] }, 'items.manage', true).permissions).toEqual([
      'items.view',
      'items.manage',
    ]);
    const all = toggle(toggle(defaultAccess(), 'items.manage', true), 'items.view_cost', true);
    expect(all.permissions).toContain('items.view_cost');
    expect(toggle(all, 'items.view', false).permissions).toEqual([
      'billing.sell',
      'customers.view',
      'customers.manage',
      'stock.view',
    ]);
  });

  test('switching discounts on offers 5%, and keeps a limit that was typed', () => {
    expect(toggle(defaultAccess(), 'billing.discount', true).limit).toBe('5');
    const typed = { ...toggle(defaultAccess(), 'billing.discount', true), limit: '7.5' };
    const off = toggle(typed, 'billing.discount', false);
    expect(off.limit).toBe('7.5');
    expect(toggle(off, 'billing.discount', true).limit).toBe('7.5');
  });

  test('the limit is sent in basis points, only while discounts are on', () => {
    const on = { ...toggle(defaultAccess(), 'billing.discount', true), limit: '7.5' };
    expect(limitOf(on)).toBe(750);
    expect(limitOf({ ...on, limit: '100' })).toBe(10_000);
    expect(limitOf({ ...on, limit: '0.07' })).toBe(7);
    for (const bad of ['', 'abc', '100.01', '-1', '1.234']) {
      expect(limitOf({ ...on, limit: bad })).toBe('invalid');
    }
    expect(limitOf({ ...defaultAccess(), limit: 'abc' })).toBeNull();
  });

  test("an existing login's screen state: its switches and its stored limit", () => {
    const person = {
      ...CASHIER,
      permissions: effectivePermissions({ added: ['billing.discount'], removed: [] }),
      discountLimitBasisPoints: 750,
    };
    const access = accessOf(person);
    expect(access.permissions).toContain('billing.discount');
    expect(access.permissions).not.toContain('session.own');
    expect(access.limit).toBe('7.5');
  });

  test('"changed" ignores the order, and the limit while discounts are off', () => {
    const base = defaultAccess();
    expect(sameAccess(base, { ...base, permissions: [...base.permissions].reverse() })).toBe(true);
    expect(sameAccess(base, { ...base, limit: '9' })).toBe(true);
    expect(sameAccess(base, toggle(base, 'stock.adjust', true))).toBe(false);
    const on = toggle(base, 'billing.discount', true);
    expect(sameAccess(on, { ...on, limit: '6' })).toBe(false);
  });
});
