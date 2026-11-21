import { describe, expect, it } from 'vitest';
import { customerQuerySchema, customerSchema, customerUpdateSchema } from './customers.js';
import { fieldErrors } from './fields.js';

// A valid GSTIN from Maharashtra (27), check digit included.
const GSTIN = '27AAPFU0939F1ZV';

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
      { ...business, gstin: '27AAPFU0939F1ZA' },
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
