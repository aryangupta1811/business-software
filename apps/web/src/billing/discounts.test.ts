import type { BillingContext } from '@business-software/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { catalogueItem } from '../test/catalogue';
import { OWNER_SESSION, STAFF_SESSION } from '../test/fake-api';
import { CatalogueCopy } from './catalogue-copy';
import {
  approvalNeeded,
  discountLimit,
  discountText,
  loadApproval,
  parseDiscount,
  saveApproval,
  withBillDiscount,
  withLineDiscount,
  type Approval,
} from './discounts';
import { clearOpenBills, startBill } from './open-bill';

const CONTEXT: BillingContext = {
  scheme: 'regular',
  branchStateCode: '27',
  features: [],
  negativeStock: 'warn',
  overCreditLimit: 'warn',
  canViewStock: true,
  canManageItems: true,
  canViewCustomers: true,
  canManageCustomers: true,
  canDiscount: true,
  canGiveUdhaar: true,
};

const salt = catalogueItem({ sellingPrice: 10_000 });
const copy = new CatalogueCopy();
copy.apply({ items: [salt], stock: null, serverTime: '2026-11-21T10:00:00.000Z' }, true);

const NOW = Date.parse('2026-11-21T10:00:00.000Z');
const bill = {
  ...startBill('27'),
  lines: [
    { itemId: salt.id, packId: null, quantityThousandths: 1_000, shownUnitPricePaise: 10_000 },
  ],
};

afterEach(() => {
  sessionStorage.clear();
});

describe('discounts at the counter', () => {
  test("the limit: none for the owner, the staff login's own, 0 without billing.discount", () => {
    expect(discountLimit(OWNER_SESSION, CONTEXT)).toBeNull();
    const staff = { ...STAFF_SESSION, discountLimitBasisPoints: 500 };
    expect(discountLimit(staff, CONTEXT)).toBe(500);
    expect(discountLimit(staff, { ...CONTEXT, canDiscount: false })).toBe(0);
  });

  test('reads a percent or rupees; empty or zero is no discount', () => {
    expect(parseDiscount('percent', '12.5')).toEqual({ kind: 'percent', basisPoints: 1_250 });
    expect(parseDiscount('percent', '10%')).toEqual({ kind: 'percent', basisPoints: 1_000 });
    expect(parseDiscount('percent', '100')).toEqual({ kind: 'percent', basisPoints: 10_000 });
    expect(parseDiscount('percent', '100.01')).toBe('invalid');
    expect(parseDiscount('percent', 'ten')).toBe('invalid');
    expect(parseDiscount('percent', '0')).toBeNull();
    expect(parseDiscount('amount', '20')).toEqual({ kind: 'amount', paise: 2_000 });
    expect(parseDiscount('amount', '')).toBeNull();
    expect(discountText({ kind: 'percent', basisPoints: 1_250 })).toBe('12.5');
    expect(discountText({ kind: 'amount', paise: 2_000 })).toBe('20.00');
  });

  test('puts a discount on and takes it off', () => {
    const onLine = withLineDiscount(bill, 0, { kind: 'percent', basisPoints: 500 });
    expect(onLine.lines[0]?.discount).toEqual({ kind: 'percent', basisPoints: 500 });
    expect(withLineDiscount(onLine, 0, null).lines[0]).not.toHaveProperty('discount');
    const onBill = withBillDiscount(bill, { kind: 'amount', paise: 100 });
    expect(onBill.billDiscount).toEqual({ kind: 'amount', paise: 100 });
    expect(withBillDiscount(onBill, null)).not.toHaveProperty('billDiscount');
  });

  test('a discount within the limit, or any for the owner, needs no OK', () => {
    const fivePercent = withLineDiscount(bill, 0, { kind: 'percent', basisPoints: 500 });
    expect(approvalNeeded(fivePercent, CONTEXT, copy, 500, null, NOW)).toBeNull();
    expect(approvalNeeded(fivePercent, CONTEXT, copy, null, null, NOW)).toBeNull();
    expect(approvalNeeded(bill, CONTEXT, copy, 0, null, NOW)).toBeNull();
  });

  test('above the limit it asks for the shares shown, until a live OK for this bill covers them', () => {
    const tenPercent = withBillDiscount(bill, { kind: 'percent', basisPoints: 1_000 });
    expect(approvalNeeded(tenPercent, CONTEXT, copy, 500, null, NOW)).toEqual({
      lineBasisPoints: 0,
      billBasisPoints: 1_000,
    });
    const approval: Approval = {
      approvalId: '00000000-0000-4000-8000-0000000000c1',
      billKey: bill.billKey,
      expiresAt: '2026-11-21T10:30:00.000Z',
      lineBasisPoints: 0,
      billBasisPoints: 1_000,
    };
    expect(approvalNeeded(tenPercent, CONTEXT, copy, 500, approval, NOW)).toBeNull();
    // Raised past what was approved, expired, or another bill's: asks again.
    const more = withBillDiscount(bill, { kind: 'percent', basisPoints: 1_100 });
    expect(approvalNeeded(more, CONTEXT, copy, 500, approval, NOW)).not.toBeNull();
    expect(
      approvalNeeded(tenPercent, CONTEXT, copy, 500, approval, NOW + 31 * 60_000),
    ).not.toBeNull();
    const other = { ...approval, billKey: '00000000-0000-4000-8000-0000000000c2' };
    expect(approvalNeeded(tenPercent, CONTEXT, copy, 500, other, NOW)).not.toBeNull();
  });

  test("an owner's OK is kept for its bill across a reload, and goes at logout", () => {
    const approval: Approval = {
      approvalId: '00000000-0000-4000-8000-0000000000c1',
      billKey: bill.billKey,
      expiresAt: '2026-11-21T10:30:00.000Z',
      lineBasisPoints: 0,
      billBasisPoints: 1_000,
    };
    saveApproval(approval);
    expect(loadApproval(bill.billKey)).toEqual(approval);
    expect(loadApproval('00000000-0000-4000-8000-0000000000c2')).toBeNull();
    clearOpenBills();
    expect(loadApproval(bill.billKey)).toBeNull();
  });
});
