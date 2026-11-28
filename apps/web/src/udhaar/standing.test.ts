import { describe, expect, it } from 'vitest';
import {
  advanceOf,
  balanceKind,
  creditCheck,
  daysOverdue,
  ledgerParts,
  limitUsedPercent,
} from './standing';

describe('balance', () => {
  it('is owed above zero, an advance below it, and settled at zero', () => {
    expect(balanceKind(500)).toBe('owes');
    expect(balanceKind(-500)).toBe('advance');
    expect(balanceKind(0)).toBe('settled');
  });

  it('offers an advance only when there is one', () => {
    expect(advanceOf(-30_000)).toBe(30_000);
    expect(advanceOf(0)).toBe(0);
    expect(advanceOf(1_000)).toBe(0);
  });
});

describe('what a bill puts on the account', () => {
  it('adds up the udhaar rows and the advance rows apart from the money rows', () => {
    expect(
      ledgerParts([
        { mode: 'cash', amountPaise: 10_000 },
        { mode: 'udhaar', amountPaise: 4_000 },
        { mode: 'advance', amountPaise: 1_500 },
        { mode: 'udhaar', amountPaise: 500 },
      ]),
    ).toEqual({ udhaarPaise: 4_500, advancePaise: 1_500 });
  });
});

describe('creditCheck (03 #8-#10, #17, #18)', () => {
  const cash = [{ mode: 'cash' as const, amountPaise: 9_000 }];
  const udhaar = (paise: number) => [{ mode: 'udhaar' as const, amountPaise: paise }];
  const base = {
    standing: { balancePaise: 20_000, creditLimitPaise: 50_000 },
    who: 'owner' as const,
    setting: 'warn' as const,
  };

  it('has nothing to check without udhaar', () => {
    expect(creditCheck({ ...base, payments: cash })).toEqual({ kind: 'none' });
  });

  it('lets udhaar up to the limit through, and exactly to it', () => {
    expect(creditCheck({ ...base, payments: udhaar(30_000) })).toEqual({ kind: 'within' });
  });

  it('warns the owner past the limit in warn mode, and asks for their password in block mode', () => {
    expect(creditCheck({ ...base, payments: udhaar(30_001) })).toEqual({
      kind: 'warn',
      balanceAfterPaise: 50_001,
      limitPaise: 50_000,
    });
    expect(creditCheck({ ...base, setting: 'block', payments: udhaar(30_001) })).toMatchObject({
      kind: 'needs_approval',
    });
  });

  it('asks staff for the owner password past the limit in both modes', () => {
    for (const setting of ['warn', 'block'] as const) {
      expect(
        creditCheck({ ...base, who: 'staff', setting, payments: udhaar(30_001) }),
      ).toMatchObject({ kind: 'needs_approval' });
    }
    expect(creditCheck({ ...base, who: 'staff', payments: udhaar(30_000) })).toEqual({
      kind: 'within',
    });
  });

  it('lets the owner give any amount with no limit set, and stops staff', () => {
    const standing = { balancePaise: 0, creditLimitPaise: null };
    expect(creditCheck({ ...base, standing, payments: udhaar(900_000) })).toEqual({
      kind: 'within',
    });
    expect(creditCheck({ ...base, standing, who: 'staff', payments: udhaar(100) })).toEqual({
      kind: 'needs_approval',
      balanceAfterPaise: 100,
      limitPaise: null,
    });
  });

  it('counts the advance used first, so it makes room under the limit', () => {
    const standing = { balancePaise: -10_000, creditLimitPaise: 5_000 };
    // Owes 0 after the advance, then 5,000 of udhaar: exactly the limit.
    expect(
      creditCheck({
        ...base,
        standing,
        payments: [
          { mode: 'advance', amountPaise: 10_000 },
          { mode: 'udhaar', amountPaise: 5_000 },
        ],
      }),
    ).toEqual({ kind: 'within' });
    // Udhaar without using the advance: the advance still nets against it (-10,000 + 14,000).
    expect(creditCheck({ ...base, standing, payments: udhaar(14_000) })).toEqual({
      kind: 'within',
    });
  });
});

describe('limitUsedPercent', () => {
  it('is null without a limit, and capped at 100', () => {
    expect(limitUsedPercent(1_000, null)).toBeNull();
    expect(limitUsedPercent(25_000, 100_000)).toBe(25);
    expect(limitUsedPercent(150_000, 100_000)).toBe(100);
    expect(limitUsedPercent(-500, 100_000)).toBe(0);
    expect(limitUsedPercent(10, 0)).toBe(100);
    expect(limitUsedPercent(0, 0)).toBe(0);
  });
});

describe('daysOverdue', () => {
  it('counts calendar days past the due date, never below zero', () => {
    expect(daysOverdue('2026-11-20', '2026-11-28')).toBe(8);
    expect(daysOverdue('2026-11-28', '2026-11-28')).toBe(0);
    expect(daysOverdue('2026-12-05', '2026-11-28')).toBe(0);
    expect(daysOverdue('2026-02-27', '2026-03-02')).toBe(3);
  });
});
