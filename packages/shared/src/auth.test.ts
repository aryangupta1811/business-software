import { describe, expect, it } from 'vitest';
import { ownerLoginSchema, staffLoginSchema, unlockSchema } from './auth.js';

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
