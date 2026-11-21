import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { fieldErrors, type FieldErrors } from './fields.js';
import {
  ALERT_FAMILIES,
  ALERT_PERMISSIONS,
  ALERT_PRESETS,
  ALERT_TYPES,
  raiseOrClear,
  settingsAlertsSchema,
  stockAlert,
} from './alerts.js';
import { BUSINESS_TYPES, PERMISSIONS } from './business.js';

function errorsOf(schema: z.ZodType, value: unknown): FieldErrors {
  const result = schema.safeParse(value);
  return result.success ? {} : fieldErrors(result.error);
}

describe('stockAlert (Module 07 #4, #17)', () => {
  it('has no alert while stock is above the level, or an item has no level and stock is left', () => {
    expect(stockAlert(5_001, 5_000)).toBeNull();
    expect(stockAlert(1_000, null)).toBeNull();
    expect(stockAlert(1_000, 0)).toBeNull();
  });

  it('is low at the level and under it', () => {
    expect(stockAlert(5_000, 5_000)).toBe('low_stock');
    expect(stockAlert(1, 5_000)).toBe('low_stock');
  });

  it('is out of stock at 0 and below, with a level, level 0 or none (#17)', () => {
    expect(stockAlert(0, 5_000)).toBe('out_of_stock');
    expect(stockAlert(-1_000, 5_000)).toBe('out_of_stock');
    expect(stockAlert(0, 0)).toBe('out_of_stock');
    expect(stockAlert(0, null)).toBe('out_of_stock');
    expect(stockAlert(-1, null)).toBe('out_of_stock');
  });
});

describe('raiseOrClear', () => {
  const low = (quantity: number) => ({
    type: 'low_stock' as const,
    details: { quantity, level: 5 },
  });
  const out = (quantity: number) => ({
    type: 'out_of_stock' as const,
    details: { quantity, level: 5 },
  });

  it('raises when nothing is open and something is wanted', () => {
    expect(raiseOrClear(low(4), null)).toEqual({ do: 'raise', ...low(4) });
    expect(raiseOrClear(out(0), null)).toEqual({ do: 'raise', ...out(0) });
  });

  it('does nothing when nothing is wanted and nothing is open, or both agree', () => {
    expect(raiseOrClear(null, null)).toEqual({ do: 'none' });
    expect(raiseOrClear(low(4), low(4))).toEqual({ do: 'none' });
    expect(raiseOrClear(out(0), out(0))).toEqual({ do: 'none' });
  });

  it('updates the details when the same type has new numbers (raised once, not again)', () => {
    expect(raiseOrClear(low(3), low(4))).toEqual({ do: 'update', ...low(3) });
    expect(raiseOrClear(out(-2), out(0))).toEqual({ do: 'update', ...out(-2) });
  });

  it('changes the type: low to out and back (question 3A)', () => {
    expect(raiseOrClear(out(0), low(1))).toEqual({ do: 'retype', ...out(0) });
    expect(raiseOrClear(low(2), out(0))).toEqual({ do: 'retype', ...low(2) });
  });

  it('clears when nothing is wanted any more', () => {
    expect(raiseOrClear(null, low(4))).toEqual({ do: 'clear' });
    expect(raiseOrClear(null, out(0))).toEqual({ do: 'clear' });
  });
});

describe('the alert lists', () => {
  it('gives every type a family and a permission, and every business type a preset', () => {
    for (const type of ALERT_TYPES) {
      expect(ALERT_FAMILIES[type]).toBeTruthy();
      expect(PERMISSIONS).toContain(ALERT_PERMISSIONS[type]);
    }
    expect(Object.keys(ALERT_PRESETS).sort()).toEqual([...BUSINESS_TYPES].sort());
  });

  it('puts low and out of stock in one family, so one open alert holds for both (3A)', () => {
    expect(ALERT_FAMILIES.low_stock).toBe(ALERT_FAMILIES.out_of_stock);
  });

  it('keeps each preset in ALERT_TYPES order, the order settings saves in', () => {
    for (const types of Object.values(ALERT_PRESETS)) {
      expect(types).toEqual(ALERT_TYPES.filter((type) => types.includes(type)));
    }
  });
});

describe('settingsAlertsSchema', () => {
  it('sorts the types into one fixed order, so a reordered list is no change', () => {
    expect(settingsAlertsSchema.parse({ types: ['out_of_stock', 'low_stock'] })).toEqual({
      types: ['low_stock', 'out_of_stock'],
    });
    expect(settingsAlertsSchema.parse({ types: [] })).toEqual({ types: [] });
  });

  it('refuses unknown names, duplicates and extra keys', () => {
    expect(errorsOf(settingsAlertsSchema, { types: ['nope'] })).toEqual({ 'types.0': 'invalid' });
    expect(errorsOf(settingsAlertsSchema, { types: ['low_stock', 'low_stock'] })).toEqual({
      types: 'duplicate',
    });
    expect(errorsOf(settingsAlertsSchema, { types: [], extra: 1 })).toEqual({
      extra: 'unknown_field',
    });
  });
});
