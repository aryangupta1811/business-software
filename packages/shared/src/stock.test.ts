import { describe, expect, it } from 'vitest';
import { fieldErrors } from './fields.js';
import {
  ADJUSTMENT_REASONS,
  adjustmentSchema,
  averageAfter,
  belowZeroOutcome,
  businessDate,
  isLow,
  movementValue,
  openingStockSchema,
  REASON_DIRECTIONS,
  stockQuantityProblem,
} from './stock.js';

const KEY = '0190f0f0-0000-7000-8000-000000000001';

describe('stockQuantityProblem (owner answer 6A)', () => {
  it.each(['piece', 'pair', 'dozen', 'box', 'pack', 'bag'] as const)(
    '%s counts whole units only',
    (unit) => {
      expect(stockQuantityProblem(unit, 3_000)).toBeNull();
      expect(stockQuantityProblem(unit, -2_000)).toBeNull();
      expect(stockQuantityProblem(unit, 1_500)).toBe('whole_units_only');
      expect(stockQuantityProblem(unit, -1)).toBe('whole_units_only');
    },
  );

  it.each(['kg', 'g', 'litre', 'ml', 'metre', 'foot'] as const)(
    '%s allows three decimals',
    (unit) => {
      expect(stockQuantityProblem(unit, 250)).toBeNull();
      expect(stockQuantityProblem(unit, -1)).toBeNull();
      expect(stockQuantityProblem(unit, 1_000)).toBeNull();
    },
  );

  it('refuses zero and anything that is not a safe whole number of thousandths', () => {
    expect(stockQuantityProblem('kg', 0)).toBe('invalid');
    expect(stockQuantityProblem('kg', 0.5)).toBe('invalid');
    expect(stockQuantityProblem('kg', Number.MAX_SAFE_INTEGER + 1)).toBe('invalid');
  });
});

describe('movementValue: quantity × unit cost, to the paisa', () => {
  it.each([
    // 5 kg at ₹45.00 a kg.
    [5_000, 4_500, 22_500],
    // 250 g of a kg item at ₹45.00 a kg is ₹11.25.
    [250, 4_500, 1_125],
    // 0.001 kg at ₹5.00: half a paisa rounds up.
    [1, 500, 1],
    // 0.001 kg at ₹4.99: 0.499 paise rounds down.
    [1, 499, 0],
    // Signed: a write-down is the same amount, negative (half away from zero).
    [-1, 500, -1],
    [-250, 4_500, -1_125],
    [3_000, 0, 0],
  ])('%i thousandths at %i paise → %i paise', (quantity, cost, value) => {
    expect(movementValue(quantity, cost)).toBe(value);
  });

  it('stays exact beyond 2^53 in the middle of the sum', () => {
    // 10 million units at ₹10 000.03: the product (1.0000003 × 10^16) passes 2^53.
    expect(movementValue(10_000_000_000, 1_000_003)).toBe(10_000_030_000_000);
  });
});

describe('averageAfter: weighted average cost per stock unit (Module 01 #4)', () => {
  it('weighs the old stock and the new by quantity', () => {
    // 10 kg at ₹40 plus 10 kg at ₹50 → ₹45.
    expect(averageAfter(10_000, 4_000, 10_000, 5_000)).toBe(4_500);
    // 1 piece at ₹10 plus 2 at ₹11 → ₹10.666…, half up to ₹10.67.
    expect(averageAfter(1_000, 1_000, 2_000, 1_100)).toBe(1_067);
  });

  it('rounds exactly half up', () => {
    // (1 × 100 + 1 × 101) / 2 = 100.5 → 101.
    expect(averageAfter(1_000, 100, 1_000, 101)).toBe(101);
  });

  it('takes the incoming cost when there was no stock, or less than none', () => {
    expect(averageAfter(0, 4_000, 5_000, 5_000)).toBe(5_000);
    expect(averageAfter(-2_000, 4_000, 5_000, 5_000)).toBe(5_000);
    expect(averageAfter(10_000, null, 5_000, 5_000)).toBe(5_000);
  });

  it('leaves the average alone on stock out, or stock in at an unknown cost', () => {
    expect(averageAfter(10_000, 4_000, -3_000, 4_000)).toBe(4_000);
    expect(averageAfter(10_000, 4_000, 3_000, null)).toBe(4_000);
    expect(averageAfter(0, null, -1_000, null)).toBeNull();
  });
});

describe('belowZeroOutcome: what happens when stock would go below zero', () => {
  it('lets anything through that ends at zero or above, or adds stock', () => {
    for (const policy of ['refuse', 'warn', 'block'] as const) {
      expect(belowZeroOutcome(policy, -5_000, 0)).toBe('ok');
      // Already negative, a count correction upward is still below zero: allowed.
      expect(belowZeroOutcome(policy, 2_000, -3_000)).toBe('ok');
    }
  });

  it('warns or refuses a reduction that ends below zero (Module 01 #12, answer 2A)', () => {
    expect(belowZeroOutcome('warn', -1_000, -1_000)).toBe('warn');
    expect(belowZeroOutcome('block', -1_000, -1_000)).toBe('refuse');
    expect(belowZeroOutcome('refuse', -1_000, -1_000)).toBe('refuse');
  });
});

describe('isLow (Module 07 #4)', () => {
  it('is at or below a level above zero; a level of 0 or none never is', () => {
    expect(isLow(5_000, 5_000)).toBe(true);
    expect(isLow(4_999, 5_000)).toBe(true);
    expect(isLow(5_001, 5_000)).toBe(false);
    expect(isLow(-1_000, 0)).toBe(false);
    expect(isLow(0, null)).toBe(false);
  });
});

describe('businessDate: the day in India an action belongs to', () => {
  it('is the IST date, which runs 5½ hours ahead of UTC', () => {
    expect(businessDate(new Date('2026-11-20T18:29:59.999Z'))).toBe('2026-11-20');
    expect(businessDate(new Date('2026-11-20T18:30:00.000Z'))).toBe('2026-11-21');
    expect(businessDate(new Date('2026-12-31T20:00:00.000Z'))).toBe('2027-01-01');
  });
});

describe('the opening stock body', () => {
  it('takes a positive quantity, an optional cost and a request key', () => {
    expect(openingStockSchema.parse({ quantity: 5_000, unitCost: 4_500, requestKey: KEY })).toEqual(
      { quantity: 5_000, unitCost: 4_500, requestKey: KEY },
    );
    expect(openingStockSchema.parse({ quantity: 5_000, requestKey: KEY })).toEqual({
      quantity: 5_000,
      requestKey: KEY,
    });
  });

  it('answers field codes', () => {
    const result = openingStockSchema.safeParse({ quantity: 0, unitCost: -1, extra: 1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result.error)).toMatchObject({
        quantity: 'too_small',
        unitCost: 'too_small',
        requestKey: 'invalid',
      });
    }
  });
});

describe('the adjustment body (Module 01 #11, owner answer 3B)', () => {
  const body = (overrides: Record<string, unknown>) => ({
    quantity: -1_000,
    reason: 'damaged',
    note: null,
    requestKey: KEY,
    ...overrides,
  });
  const errors = (overrides: Record<string, unknown>) => {
    const result = adjustmentSchema.safeParse(body(overrides));
    return result.success ? {} : fieldErrors(result.error);
  };

  it('has the six reasons; only a count mismatch can add stock', () => {
    expect(ADJUSTMENT_REASONS).toEqual([
      'damaged',
      'expired',
      'theft',
      'own_use',
      'count_mismatch',
      'other',
    ]);
    expect(REASON_DIRECTIONS).toEqual({
      damaged: 'down',
      expired: 'down',
      theft: 'down',
      own_use: 'down',
      count_mismatch: 'both',
      other: 'down',
    });
  });

  it('refuses stock going up for every reason but a count mismatch', () => {
    for (const reason of ['damaged', 'expired', 'theft', 'own_use'] as const) {
      expect(errors({ reason, quantity: 1_000 })).toEqual({ quantity: 'wrong_direction' });
      expect(errors({ reason, quantity: -1_000 })).toEqual({});
    }
    expect(errors({ reason: 'other', quantity: 1_000, note: 'found' })).toEqual({
      quantity: 'wrong_direction',
    });
    expect(errors({ reason: 'count_mismatch', quantity: 1_000 })).toEqual({});
    expect(errors({ reason: 'count_mismatch', quantity: -1_000 })).toEqual({});
  });

  it('needs a note for "Other", and keeps an optional note otherwise', () => {
    expect(errors({ reason: 'other' })).toEqual({ note: 'required' });
    expect(errors({ reason: 'other', note: '   ' })).toEqual({ note: 'required' });
    expect(adjustmentSchema.parse(body({ note: '  two packets torn ' }))).toMatchObject({
      note: 'two packets torn',
    });
  });

  it('refuses zero, an unknown reason, a missing key and unknown fields', () => {
    expect(errors({ quantity: 0 })).toEqual({ quantity: 'invalid' });
    expect(errors({ reason: 'gift' })).toEqual({ reason: 'invalid' });
    expect(errors({ reason: undefined })).toEqual({ reason: 'choose' });
    expect(errors({ requestKey: 'nope' })).toEqual({ requestKey: 'invalid' });
    expect(errors({ unitCost: 100 })).toHaveProperty('unitCost');
    expect(errors({ note: 'x'.repeat(201) })).toEqual({ note: 'too_long' });
  });
});
