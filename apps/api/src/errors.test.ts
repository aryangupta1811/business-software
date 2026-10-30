import { describe, expect, it } from 'vitest';
import { describeError } from './errors.js';

describe('describeError', () => {
  it('gives an error its message', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  // Drizzle wraps the real reason (say, a wrong password) in `cause`.
  it('follows the cause chain, one line', () => {
    const inner = new Error('password authentication failed for user "app_owner"');
    const outer = new Error('Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"\nparams: ', {
      cause: inner,
    });
    expect(describeError(outer)).toBe(
      'Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle" params: → password authentication failed for user "app_owner"',
    );
  });

  // pg puts the whole client, password included, on its error objects.
  it('uses messages only, never other fields', () => {
    const error = Object.assign(new Error('connection lost'), {
      client: { password: 's3cretpw' },
    });
    expect(describeError(error)).toBe('connection lost');
  });

  it('describes a thrown string', () => {
    expect(describeError('plain text')).toBe('plain text');
  });

  it('names a thrown object without showing what it holds', () => {
    expect(describeError({ password: 's3cretpw' })).toBe('a thrown object (not an Error)');
  });
});
