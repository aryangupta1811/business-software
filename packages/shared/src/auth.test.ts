import { describe, expect, it } from 'vitest';
import {
  ACTIVE_PING_MS,
  IDLE_GRACE_MS,
  ownerLoginSchema,
  staffLoginSchema,
  unlockSchema,
} from './auth.js';

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
