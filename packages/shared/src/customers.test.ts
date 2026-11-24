import { describe, expect, it } from 'vitest';
import { customerQuerySchema, customerSchema, customerUpdateSchema } from './customers.js';
import { fieldErrors } from './fields.js';

// A made-up GSTIN from Maharashtra (27) with a valid check digit.
const GSTIN = '27ABCDE1234F1Z0';

const walkIn = {
  name: 'Sunita',
  phone: null,
  gstin: null,
  legalName: null,
  address: null,
  pinCode: null,
  stateCode: null,
};
const business = {
  name: 'Ravi',
  phone: '98200 12345',
  gstin: GSTIN.toLowerCase(),
  legalName: 'Ravi Traders',
  address: '12 MG Road, Pune',
  pinCode: '411001',
  stateCode: null,
};

function errorsOf(schema: typeof customerSchema | typeof customerUpdateSchema, body: unknown) {
  const result = schema.safeParse(body);
  return result.success ? {} : fieldErrors(result.error);
}

describe('customerSchema (02 #2, #7; design §7)', () => {
  it('takes a name alone', () => {
    expect(customerSchema.parse({ ...walkIn, name: '  Sunita ' })).toEqual(walkIn);
  });

  it('normalises the phone and GSTIN, and takes the state from the GSTIN', () => {
    expect(customerSchema.parse(business)).toEqual({
      ...business,
      phone: '9820012345',
      gstin: GSTIN,
      stateCode: '27',
    });
  });

  it('keeps a state picked for a customer without a GSTIN', () => {
    expect(customerSchema.parse({ ...walkIn, stateCode: '09' })).toMatchObject({ stateCode: '09' });
  });

  it.each([
    ['no name', { ...walkIn, name: ' ' }, { name: 'required' }],
    ['a bad phone', { ...walkIn, phone: '12345' }, { phone: 'invalid' }],
    [
      'a GSTIN with a wrong check digit',
      { ...business, gstin: '27ABCDE1234F1ZA' },
      { gstin: 'invalid' },
    ],
    ['a GSTIN with no legal name', { ...business, legalName: null }, { legalName: 'required' }],
    ['a GSTIN with no address', { ...business, address: '' }, { address: 'required' }],
    [
      'a state that differs from the GSTIN',
      { ...business, stateCode: '09' },
      { stateCode: 'gstin_state' },
    ],
    ['an unknown state', { ...walkIn, stateCode: '00' }, { stateCode: 'invalid' }],
    ['a 5-digit PIN code', { ...walkIn, pinCode: '41100' }, { pinCode: 'invalid' }],
    ['an unknown field', { ...walkIn, creditLimit: 1 }, { creditLimit: 'unknown_field' }],
  ])('refuses %s', (_, body, errors) => {
    expect(errorsOf(customerSchema, body)).toEqual(errors);
  });
});

describe('credit limit and due days (P1.18 design §3; `03` #5, #8, #17)', () => {
  it('leaves them out unless they are sent, and takes null for "no limit set"', () => {
    expect(customerSchema.parse(walkIn)).not.toHaveProperty('creditLimitPaise');
    expect(customerSchema.parse({ ...walkIn, creditLimitPaise: null }).creditLimitPaise).toBeNull();
    const set = customerSchema.parse({ ...walkIn, creditLimitPaise: 500_000, dueDays: 15 });
    expect(set).toMatchObject({ creditLimitPaise: 500_000, dueDays: 15 });
    expect(customerSchema.parse({ ...walkIn, creditLimitPaise: 0, dueDays: 0 })).toMatchObject({
      creditLimitPaise: 0,
      dueDays: 0,
    });
  });

  it.each([
    ['a negative limit', { creditLimitPaise: -1 }, { creditLimitPaise: 'too_small' }],
    ['half a paisa', { creditLimitPaise: 1.5 }, { creditLimitPaise: 'invalid' }],
    [
      'a limit too big to hold',
      { creditLimitPaise: 10_000_000_000_001 },
      { creditLimitPaise: 'too_big' },
    ],
    ['negative due days', { dueDays: -1 }, { dueDays: 'too_small' }],
    ['more than a year of due days', { dueDays: 366 }, { dueDays: 'too_big' }],
    ['null due days', { dueDays: null }, { dueDays: 'invalid' }],
  ])('refuses %s', (_, change, errors) => {
    expect(errorsOf(customerUpdateSchema, { ...walkIn, version: 1, ...change })).toEqual(errors);
  });

  it('takes them on a saved customer too', () => {
    expect(
      customerUpdateSchema.parse({ ...walkIn, version: 2, creditLimitPaise: 1_000, dueDays: 7 }),
    ).toMatchObject({ creditLimitPaise: 1_000, dueDays: 7 });
  });
});

describe('customerUpdateSchema', () => {
  it('needs the version the customer was read at', () => {
    expect(errorsOf(customerUpdateSchema, { ...walkIn, version: 1 })).toEqual({});
    expect(errorsOf(customerUpdateSchema, walkIn)).toEqual({ version: 'invalid' });
  });
});

describe('customerQuerySchema', () => {
  it('finds by phone (normalised) or by text', () => {
    expect(customerQuerySchema.parse({ phone: '+91 98200 12345' })).toEqual({
      phone: '9820012345',
    });
    expect(customerQuerySchema.parse({ q: ' ravi ' })).toEqual({ q: 'ravi' });
  });

  it('needs one of them, and a phone that is one', () => {
    expect(customerQuerySchema.safeParse({}).success).toBe(false);
    expect(customerQuerySchema.safeParse({ phone: '123' }).success).toBe(false);
  });
});
