import { describe, expect, it } from 'vitest';
import { fieldErrors } from './fields.js';
import {
  billListQuerySchema,
  devicePrintingSchema,
  FOOTER_NOTE_MAX_LENGTH,
  settingsPrintingSchema,
} from './printing.js';

describe('settingsPrintingSchema', () => {
  it('takes a language and a footer note', () => {
    expect(
      settingsPrintingSchema.parse({ billLanguage: 'hi', footerNote: ' Goods once sold ' }),
    ).toEqual({ billLanguage: 'hi', footerNote: 'Goods once sold' });
  });

  it('reads a blank footer note as none', () => {
    expect(settingsPrintingSchema.parse({ billLanguage: 'en', footerNote: '  ' })).toEqual({
      billLanguage: 'en',
      footerNote: null,
    });
  });

  it('keeps the footer note to 200 characters, counting Hindi letters', () => {
    expect(
      settingsPrintingSchema.safeParse({
        billLanguage: 'en',
        footerNote: 'क'.repeat(FOOTER_NOTE_MAX_LENGTH),
      }).success,
    ).toBe(true);
    const long = settingsPrintingSchema.safeParse({
      billLanguage: 'en',
      footerNote: 'a'.repeat(FOOTER_NOTE_MAX_LENGTH + 1),
    });
    expect(long.success ? null : fieldErrors(long.error)).toEqual({ footerNote: 'too_long' });
  });

  it('refuses a language the app does not have', () => {
    const result = settingsPrintingSchema.safeParse({ billLanguage: 'fr', footerNote: null });
    expect(result.success ? null : fieldErrors(result.error)).toEqual({ billLanguage: 'invalid' });
  });
});

describe('devicePrintingSchema', () => {
  it.each([80, 58])('takes a %i mm receipt', (receiptSize) => {
    expect(devicePrintingSchema.parse({ receiptSize, autoPrint: false })).toEqual({
      receiptSize,
      autoPrint: false,
    });
  });

  it.each([[70], ['80'], [0], [null]])('refuses a receipt size of %j', (receiptSize) => {
    expect(devicePrintingSchema.safeParse({ receiptSize, autoPrint: true }).success).toBe(false);
  });

  it('needs auto-print as true or false', () => {
    expect(devicePrintingSchema.safeParse({ receiptSize: 80, autoPrint: 'yes' }).success).toBe(
      false,
    );
  });
});

describe('billListQuerySchema', () => {
  it('takes nothing at all', () => {
    expect(billListQuerySchema.parse({})).toEqual({});
  });

  it('takes a search, a date range, a branch and a cursor', () => {
    const after = '0190f0f0-0000-7000-8000-0000000000c1';
    expect(
      billListQuerySchema.parse({
        q: ' rice ',
        from: '2026-11-01',
        to: '2026-11-23',
        branch: 'all',
        after,
      }),
    ).toEqual({ q: 'rice', from: '2026-11-01', to: '2026-11-23', branch: 'all', after });
  });

  it('reads a blank search as none', () => {
    expect(billListQuerySchema.parse({ q: '' })).toEqual({});
  });

  it.each(['2026-02-30', '23/11/2026', ''])('refuses the date %j', (from) => {
    const result = billListQuerySchema.safeParse({ from });
    expect(result.success ? null : fieldErrors(result.error)).toEqual({ from: 'invalid' });
  });

  it('refuses a range that ends before it starts', () => {
    const result = billListQuerySchema.safeParse({ from: '2026-11-23', to: '2026-11-01' });
    expect(result.success ? null : fieldErrors(result.error)).toEqual({ to: 'before_from' });
  });
});
