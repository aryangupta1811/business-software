import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { FEATURE_PRESETS, FEATURES } from './business.js';
import { fieldErrors, type FieldErrors } from './fields.js';
import {
  settingsBusinessSchema,
  settingsFeaturesSchema,
  settingsSecuritySchema,
  settingsStockSchema,
  signupSchema,
} from './schemas.js';

function errorsOf(schema: z.ZodType, value: unknown): FieldErrors {
  const result = schema.safeParse(value);
  return result.success ? {} : fieldErrors(result.error);
}

const signup = {
  businessName: '  Sharma Kirana ',
  businessType: 'kirana',
  phone: '+91 91111 11111',
  stateCode: '27',
  gstStatus: 'regular',
  email: ' Owner@Example.COM ',
  password: 'correct horse',
};

describe('signupSchema', () => {
  it('normalises a good signup', () => {
    expect(signupSchema.parse(signup)).toEqual({
      businessName: 'Sharma Kirana',
      businessType: 'kirana',
      phone: '9111111111',
      stateCode: '27',
      gstStatus: 'regular',
      email: 'owner@example.com',
      password: 'correct horse',
    });
  });

  it('never trims the password', () => {
    expect(signupSchema.parse({ ...signup, password: ' spaces in it ' }).password).toBe(
      ' spaces in it ',
    );
  });

  it.each([
    [{ businessName: '' }, { businessName: 'required' }],
    [{ businessName: 'x'.repeat(101) }, { businessName: 'too_long' }],
    [{ businessName: 'Shop\u0000' }, { businessName: 'control_character' }],
    [{ businessType: 'bakery' }, { businessType: 'invalid' }],
    // An empty radio group (null) or select ('') asks to choose one.
    [{ businessType: null }, { businessType: 'choose' }],
    [{ stateCode: '' }, { stateCode: 'choose' }],
    [{ phone: '12345' }, { phone: 'invalid' }],
    [{ phone: '' }, { phone: 'required' }],
    [{ stateCode: '28' }, { stateCode: 'invalid' }],
    [{ stateCode: '99' }, { stateCode: 'invalid' }],
    // 97 is "Other Territory": a supply outside India, never where a shop stands.
    [{ stateCode: '97' }, { stateCode: 'invalid' }],
    [{ gstStatus: 'exempt' }, { gstStatus: 'invalid' }],
    [{ email: 'owner' }, { email: 'invalid' }],
    [{ email: `${'a'.repeat(250)}@b.in` }, { email: 'too_long' }],
    // Look-alikes that would give one real address a second owner account (Module 00 #27):
    // zero-width space, soft hyphen, fullwidth o, Cyrillic o.
    [{ email: '\u200Bowner@example.com' }, { email: 'invalid' }],
    [{ email: 'owner\u00AD@example.com' }, { email: 'invalid' }],
    [{ email: '\uFF4Fwner@example.com' }, { email: 'invalid' }],
    [{ email: '\u043Ewner@example.com' }, { email: 'invalid' }],
    [{ password: 'short pass'.slice(0, 9) }, { password: 'too_short' }],
    // Characters, not UTF-16 units: five emoji are 10 units but 5 characters.
    [{ password: '\u{1F600}'.repeat(5) }, { password: 'too_short' }],
    [{ password: 'x'.repeat(129) }, { password: 'too_long' }],
    [{ password: 'Owner@Example.com' }, { password: 'same_as_email' }],
    [{ password: '+91-9111111111' }, { password: 'same_as_phone' }],
    [{ extra: true }, { extra: 'unknown_field' }],
  ])('refuses %j', (change, expected) => {
    expect(errorsOf(signupSchema, { ...signup, ...change })).toEqual(expected);
  });

  it('says which fields are missing', () => {
    expect(errorsOf(signupSchema, {})).toEqual({
      businessName: 'required',
      businessType: 'choose',
      phone: 'required',
      stateCode: 'choose',
      gstStatus: 'choose',
      email: 'required',
      password: 'required',
    });
  });
});

const business = {
  businessName: 'Sharma Kirana',
  businessType: 'kirana',
  phone: '9111111111',
  gstStatus: 'regular',
  pan: 'abcde1234f',
  ownerName: '',
  branchName: 'Sharma Kirana',
  address: 'Shop 4\nMain road',
  pinCode: '411001',
  stateCode: '27',
  gstin: '27abcde1234f1z0',
  drugLicence: null,
  fssai: '',
};

describe('settingsBusinessSchema', () => {
  it('upper-cases PAN and GSTIN and turns blanks into null', () => {
    expect(settingsBusinessSchema.parse(business)).toEqual({
      ...business,
      pan: 'ABCDE1234F',
      gstin: '27ABCDE1234F1Z0',
      ownerName: null,
      fssai: null,
    });
  });

  it.each([
    [{ gstin: '27ABCDE1234F1ZW' }, { gstin: 'invalid' }],
    // The GSTIN starts with the branch's state code (Module 00 #14).
    [{ stateCode: '29' }, { gstin: 'state_mismatch' }],
    // A state a branch can't have is the only problem reported, not a GSTIN mismatch too.
    [{ stateCode: '97' }, { stateCode: 'invalid' }],
    // Sent, but not as text: invalid, not "choose one".
    [{ stateCode: 27 }, { stateCode: 'invalid' }],
    // Characters 3–12 of a GSTIN are the business's PAN.
    [{ pan: 'ABCDE1234G' }, { gstin: 'pan_mismatch' }],
    [{ pan: 'AAPF0939F' }, { pan: 'invalid' }],
    [{ pinCode: '011001' }, { pinCode: 'invalid' }],
    [{ fssai: '1234567890123' }, { fssai: 'invalid' }],
    [{ address: 'x'.repeat(301) }, { address: 'too_long' }],
    [{ branchName: '' }, { branchName: 'required' }],
    // Module 00 #36 (G6): a business that isn't registered has no GSTIN.
    [{ gstStatus: 'unregistered' }, { gstin: 'not_registered' }],
  ])('refuses %j', (change, expected) => {
    expect(errorsOf(settingsBusinessSchema, { ...business, ...change })).toEqual(expected);
  });

  // #36: registered without a GSTIN is allowed here; the first tax invoice checks it (P1.14).
  it.each(['unregistered', 'regular', 'composition'])(
    'accepts a %s business with no GSTIN',
    (gstStatus) => {
      expect(errorsOf(settingsBusinessSchema, { ...business, gstStatus, gstin: '' })).toEqual({});
    },
  );

  it('accepts a business with no GSTIN or PAN', () => {
    expect(() =>
      settingsBusinessSchema.parse({ ...business, gstin: '', pan: null, stateCode: '29' }),
    ).not.toThrow();
  });
});

describe('settingsFeaturesSchema', () => {
  it('accepts every preset and an empty list', () => {
    for (const features of Object.values(FEATURE_PRESETS)) {
      expect(settingsFeaturesSchema.parse({ features: [...features] })).toEqual({
        features: [...features],
      });
    }
    expect(settingsFeaturesSchema.parse({ features: [] })).toEqual({ features: [] });
  });

  it('refuses unknown and repeated features', () => {
    expect(errorsOf(settingsFeaturesSchema, { features: ['teleport'] })).toEqual({
      'features.0': 'invalid',
    });
    expect(errorsOf(settingsFeaturesSchema, { features: ['mrp', 'mrp'] })).toEqual({
      features: 'duplicate',
    });
  });

  // Order carries no meaning, so a reordered list must not count as a change in the entry log.
  it('puts features in one fixed order', () => {
    const reversed = [...FEATURE_PRESETS.kirana].reverse();
    expect(settingsFeaturesSchema.parse({ features: reversed })).toEqual({
      features: FEATURES.filter((feature) => reversed.includes(feature)),
    });
  });

  it('knows every preset feature', () => {
    for (const features of Object.values(FEATURE_PRESETS)) {
      for (const feature of features) expect(FEATURES).toContain(feature);
    }
  });
});

describe('settingsSecuritySchema', () => {
  it.each([
    [1, 5],
    [30, 120],
    [5, 30],
  ])('accepts lock %i and idle %i minutes', (ownerLockMinutes, staffIdleMinutes) => {
    expect(settingsSecuritySchema.parse({ ownerLockMinutes, staffIdleMinutes })).toEqual({
      ownerLockMinutes,
      staffIdleMinutes,
    });
  });

  it.each([
    [{ ownerLockMinutes: 0 }, { ownerLockMinutes: 'too_small' }],
    [{ ownerLockMinutes: 31 }, { ownerLockMinutes: 'too_big' }],
    [{ ownerLockMinutes: 2.5 }, { ownerLockMinutes: 'invalid' }],
    [{ staffIdleMinutes: 4 }, { staffIdleMinutes: 'too_small' }],
    [{ staffIdleMinutes: 121 }, { staffIdleMinutes: 'too_big' }],
    [{ staffIdleMinutes: '30' }, { staffIdleMinutes: 'invalid' }],
  ])('refuses %j', (change, expected) => {
    expect(
      errorsOf(settingsSecuritySchema, { ownerLockMinutes: 5, staffIdleMinutes: 30, ...change }),
    ).toEqual(expected);
  });
});

describe('settingsStockSchema (Module 01 #12, owner answer 1A)', () => {
  it('takes warn or block, nothing else', () => {
    expect(settingsStockSchema.parse({ negativeStock: 'warn' })).toEqual({ negativeStock: 'warn' });
    expect(settingsStockSchema.parse({ negativeStock: 'block' })).toEqual({
      negativeStock: 'block',
    });
    expect(errorsOf(settingsStockSchema, { negativeStock: 'allow' })).toEqual({
      negativeStock: 'invalid',
    });
    expect(errorsOf(settingsStockSchema, {})).toEqual({ negativeStock: 'invalid' });
  });
});
