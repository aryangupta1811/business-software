import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  ACTIVE_PING_MS,
  changePasswordSchema,
  confirmEmailSchema,
  deviceNameSchema,
  IDLE_GRACE_MS,
  ownerLoginSchema,
  passwordProblem,
  recoveryResetSchema,
  resetCompleteSchema,
  staffLoginSchema,
  unlockSchema,
} from './auth.js';
import { fieldErrors } from './fields.js';

describe('login schemas', () => {
  it('normalises the email but keeps the password exactly as typed', () => {
    expect(
      ownerLoginSchema.parse({ email: ' Owner@Example.COM ', password: ' pass word ' }),
    ).toEqual({ email: 'owner@example.com', password: ' pass word ' });
  });

  // #43: not case-sensitive.
  it('lower-cases a username', () => {
    expect(staffLoginSchema.parse({ username: ' Ramesh.K ', password: 'x' })).toEqual({
      username: 'ramesh.k',
      password: 'x',
    });
  });

  it.each([
    [staffLoginSchema, { username: 'ab', password: 'x' }],
    [staffLoginSchema, { username: 'has space', password: 'x' }],
    [staffLoginSchema, { username: 'ramesh', password: '' }],
    [ownerLoginSchema, { email: 'owner@example.com', password: 'x'.repeat(129) }],
    [ownerLoginSchema, { email: 'owner@example.com', password: 'x', extra: 1 }],
    [unlockSchema, {}],
  ])('refuses a bad body (%#)', (schema, body) => {
    expect(schema.safeParse(body).success).toBe(false);
  });
});

it('the server waits longer than the gap between two "still here" pings', () => {
  expect(IDLE_GRACE_MS).toBeGreaterThan(ACTIVE_PING_MS);
});

describe('account recovery and password schemas (#30, #31, #46)', () => {
  const businessId = '0190f0f0-0000-7000-8000-0000000000b1';
  const token = 'A'.repeat(43);

  it('takes a link token with its business', () => {
    expect(confirmEmailSchema.parse({ businessId, token })).toEqual({ businessId, token });
    expect(confirmEmailSchema.safeParse({ businessId, token: `${token}=` }).success).toBe(false);
    expect(confirmEmailSchema.safeParse({ businessId: 'nope', token }).success).toBe(false);
  });

  it('holds a new password to the signup rules, never trimmed', () => {
    const body = { businessId, token, newPassword: ' ten chars ' };
    expect(resetCompleteSchema.parse(body)).toEqual(body);
    expect(fieldCodes(resetCompleteSchema, { ...body, newPassword: 'short' })).toEqual({
      newPassword: 'too_short',
    });
  });

  it('takes a recovery key as typed, with the email and a new password', () => {
    const body = {
      email: ' Owner@Example.com ',
      recoveryKey: 'abcd efgh',
      newPassword: 'a long new password',
    };
    expect(recoveryResetSchema.parse(body)).toEqual({ ...body, email: 'owner@example.com' });
    expect(fieldCodes(recoveryResetSchema, { ...body, recoveryKey: '' })).toEqual({
      recoveryKey: 'required',
    });
  });

  it('needs the current password to change it', () => {
    expect(
      fieldCodes(changePasswordSchema, { currentPassword: '', newPassword: 'a long new one' }),
    ).toEqual({ currentPassword: 'required' });
  });

  it('names a computer in at most 40 characters', () => {
    expect(deviceNameSchema.parse({ name: ' Counter 1 ' })).toEqual({ name: 'Counter 1' });
    expect(fieldCodes(deviceNameSchema, { name: 'x'.repeat(41) })).toEqual({ name: 'too_long' });
  });

  it.each([
    ['owner@example.com', 'same_as_email'],
    [' OWNER@example.com ', 'same_as_email'],
    ['+91 91111 11111', 'same_as_phone'],
    ['a different password', null],
  ])('says whether %j copies the email or phone', (password, problem) => {
    expect(passwordProblem(password, { email: 'owner@example.com', phone: '9111111111' })).toBe(
      problem,
    );
  });
});

function fieldCodes(schema: z.ZodType, body: unknown) {
  const result = schema.safeParse(body);
  return result.success ? {} : fieldErrors(result.error);
}
