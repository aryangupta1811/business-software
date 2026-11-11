import { describe, expect, it } from 'vitest';
import { describeError } from './errors.js';

describe('describeError', () => {
  it('gives an error its message', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  // Drizzle wraps the real reason (say, a wrong password) in `cause`.
  it('follows the cause chain, one line', () => {
    const inner = new Error('password authentication failed for user "app_owner"');
    const outer = new Error('Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"', {
      cause: inner,
    });
    expect(describeError(outer)).toBe(
      'Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle" → password authentication failed for user "app_owner"',
    );
  });

  // Drizzle appends the query's values, which will be customers' phone numbers and tokens.
  it("drops a failed query's parameter values", () => {
    const error = new Error(
      'Failed query: select * from sessions where token = $1\nparams: fake-session-token',
    );
    const described = describeError(error);
    expect(described).toBe('Failed query: select * from sessions where token = $1');
    expect(described).not.toContain('fake-session-token');
  });

  // Error objects can carry more than a message: pg-pool attaches the client, whose
  // (hidden) password some serializers print.
  it('uses messages only, never other fields', () => {
    const error = Object.assign(new Error('connection lost'), {
      client: { password: 's3cretpw' },
    });
    expect(describeError(error)).toBe('connection lost');
  });

  // What Node throws when every address of a host refuses (`localhost` is ::1 and 127.0.0.1):
  // an AggregateError whose own message is empty.
  it('describes an error with no message by the errors inside it', () => {
    const error = new AggregateError(
      [
        new Error('connect ECONNREFUSED ::1:5432'),
        new Error('connect ECONNREFUSED 127.0.0.1:5432'),
      ],
      '',
    );
    expect(describeError(error)).toBe(
      'connect ECONNREFUSED ::1:5432; connect ECONNREFUSED 127.0.0.1:5432',
    );
  });

  it('falls back to the kind of error when there is no message anywhere', () => {
    expect(describeError(new RangeError(''))).toBe('RangeError');
    expect(describeError(new AggregateError([], ''))).toBe('AggregateError');
  });

  it('stops when the causes loop back', () => {
    const first = new Error('first');
    const second = new Error('second', { cause: first });
    first.cause = second;
    expect(describeError(first)).toBe('first → second');
  });

  it('treats a null cause as no cause', () => {
    expect(describeError(new Error('boom', { cause: null }))).toBe('boom');
  });

  it('describes a thrown string', () => {
    expect(describeError('plain text')).toBe('plain text');
  });

  it('names a thrown object without showing what it holds', () => {
    expect(describeError({ password: 's3cretpw' })).toBe('a thrown object (not an Error)');
  });
});
