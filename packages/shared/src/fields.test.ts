import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  fieldErrors,
  isValidGstin,
  normalizePhone,
  optionalText,
  text,
  type FieldErrors,
} from './fields.js';

function errorsOf(schema: z.ZodType, value: unknown): FieldErrors {
  const result = schema.safeParse(value);
  return result.success ? {} : fieldErrors(result.error);
}

describe('text', () => {
  const name = z.object({ name: text(5) });

  it('trims and keeps a value within the limit', () => {
    expect(name.parse({ name: '  Ab  ' })).toEqual({ name: 'Ab' });
  });

  it.each([
    ['', 'required'],
    ['   ', 'required'],
    ['abcdef', 'too_long'],
    ['a\u0000b', 'control_character'],
    ['a\u0007b', 'control_character'],
    ['a\u0085b', 'control_character'],
    ['a\nb', 'control_character'],
    [42, 'required'],
  ])('refuses %j with %s', (value, code) => {
    expect(errorsOf(name, { name: value })).toEqual({ name: code });
  });

  it('counts Hindi letters, not bytes', () => {
    expect(name.parse({ name: 'दुकान' })).toEqual({ name: 'दुकान' });
  });

  it('allows new lines only when asked', () => {
    const address = z.object({ address: text(50, { multiline: true }) });
    expect(address.parse({ address: 'Shop 4\r\nMain road' })).toEqual({
      address: 'Shop 4\r\nMain road',
    });
    expect(errorsOf(address, { address: 'a\u0000b' })).toEqual({ address: 'control_character' });
  });
});

describe('optionalText', () => {
  const schema = z.object({ note: optionalText(5) });

  it.each([
    ['', null],
    ['   ', null],
    [null, null],
    [' ok ', 'ok'],
  ])('reads %j as %j', (value, expected) => {
    expect(schema.parse({ note: value })).toEqual({ note: expected });
  });

  it('still refuses a NUL and a long value', () => {
    expect(errorsOf(schema, { note: 'a\u0000' })).toEqual({ note: 'control_character' });
    expect(errorsOf(schema, { note: 'abcdef' })).toEqual({ note: 'too_long' });
  });
});

describe('normalizePhone', () => {
  it.each([
    ['9111111111', '9111111111'],
    ['+91 91111-11111', '9111111111'],
    ['+919111111111', '9111111111'],
    ['919111111111', '9111111111'],
    ['091111 11111', '9111111111'],
    ['(022) 2222 2222', '2222222222'],
    ['011-2222-2222', '1122222222'],
  ])('reads %j as %j', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['', '911111111', '91111111111', '0911111111', 'abcdefghij', '91111x1111', '0000000000'])(
    'refuses %j',
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});

describe('isValidGstin', () => {
  // Published examples from GST guides; their check digits are right.
  it.each(['27AAPFU0939F1ZV', '29AAGCB7383J1Z4'])('accepts %s', (gstin) => {
    expect(isValidGstin(gstin)).toBe(true);
  });

  it.each([
    ['27AAPFU0939F1ZW', 'wrong check digit'],
    ['27AAPFU0939F1Z', 'too short'],
    ['27aapfu0939f1zv', 'lower case'],
    ['2AAAPFU0939F1ZV', 'state code not digits'],
    ['27AAPFU0939F1YV', 'no Z in the 14th place'],
    ['27AAPFU0939F0ZV', 'entity number 0'],
  ])('refuses %s (%s)', (gstin) => {
    expect(isValidGstin(gstin)).toBe(false);
  });
});

describe('fieldErrors', () => {
  it('keeps the first code per field and names unknown fields', () => {
    const schema = z.strictObject({ a: text(2), b: text(2) });
    expect(errorsOf(schema, { a: 'abc', b: '', c: 1 })).toEqual({
      a: 'too_long',
      b: 'required',
      c: 'unknown_field',
    });
  });

  it('names a body that is not an object', () => {
    expect(errorsOf(z.strictObject({ a: text(2) }), 'hello')).toEqual({ _: 'invalid' });
  });
});
