// Unit tests for P1.4's small pieces: tokens, cookies, rate limits and the hashing gate.
import { describe, expect, it } from 'vitest';
import { cookieNames, parseCookies, serializeCookie } from './cookies.js';
import { BusyError, HashGate } from './hash-gate.js';
import { RateLimiter } from './rate-limit.js';
import {
  csrfTokenFor,
  formatCookieToken,
  hashToken,
  newToken,
  readCookieToken,
  tokenMatches,
} from './tokens.js';

const BUSINESS = '0190f0f0-0000-7000-8000-0000000000b1';

class FakeClock {
  time = Date.parse('2026-11-19T10:00:00Z');
  now() {
    return new Date(this.time);
  }
}

describe('tokens', () => {
  it('makes 43-character tokens, never the same twice, stored as 64-hex hashes', () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenMatches(token, hashToken(token))).toBe(true);
    expect(tokenMatches(newToken(), hashToken(token))).toBe(false);
    expect(tokenMatches(token, 'not hex')).toBe(false);
  });

  it('derives a CSRF token that differs from the session token', () => {
    const token = newToken();
    expect(csrfTokenFor(token)).toBe(csrfTokenFor(token));
    expect(csrfTokenFor(token)).not.toBe(token);
  });

  it('reads back a cookie value and refuses anything malformed', () => {
    const token = newToken();
    const value = formatCookieToken({ businessId: BUSINESS, token });
    expect(readCookieToken(value)).toEqual({ businessId: BUSINESS, token });
    for (const bad of [undefined, '', token, `${BUSINESS}.`, `.${token}`, `not-a-uuid.${token}`]) {
      expect(readCookieToken(bad)).toBeNull();
    }
    expect(readCookieToken(`${BUSINESS}.${token}x`)).toBeNull();
  });
});

describe('cookies', () => {
  it('uses __Host- names only with Secure', () => {
    expect(cookieNames(true)).toEqual({ session: '__Host-session', device: '__Host-device' });
    expect(cookieNames(false)).toEqual({ session: 'session', device: 'device' });
  });

  it('parses a Cookie header, first value winning, bad escapes skipped', () => {
    const cookies = parseCookies('a=1; b=two%20words; a=3; c=%E0%A4; =x; d');
    expect([...cookies]).toEqual([
      ['a', '1'],
      ['b', 'two words'],
    ]);
    expect(parseCookies(undefined).size).toBe(0);
  });

  it('writes HttpOnly, SameSite=Lax cookies for the whole site', () => {
    expect(serializeCookie('__Host-session', 'v', { secure: true })).toBe(
      '__Host-session=v; Path=/; HttpOnly; SameSite=Lax; Secure',
    );
    expect(serializeCookie('device', 'v', { secure: false, maxAge: 0 })).toBe(
      'device=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    );
  });
});

describe('rate limiter', () => {
  it('allows up to the limit in a window, then refuses until it ends', () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(2, 60_000, clock);
    expect(limiter.hit('k').allowed).toBe(true);
    expect(limiter.check('k').allowed).toBe(true);
    expect(limiter.hit('k').allowed).toBe(true);
    const refused = limiter.hit('k');
    expect(refused).toEqual({ allowed: false, retryAt: new Date(clock.time + 60_000) });
    expect(limiter.check('k').allowed).toBe(false);
    expect(limiter.hit('other').allowed).toBe(true);
    clock.time += 60_000;
    expect(limiter.hit('k').allowed).toBe(true);
  });

  it('starts again after a reset', () => {
    const limiter = new RateLimiter(1, 60_000, new FakeClock());
    limiter.hit('k');
    expect(limiter.check('k').allowed).toBe(false);
    limiter.reset('k');
    expect(limiter.check('k').allowed).toBe(true);
  });
});

describe('hash gate', () => {
  it('runs at most two at once, queues the rest, and refuses past the queue', async () => {
    const gate = new HashGate(2, 1);
    let running = 0;
    let most = 0;
    const releases: (() => void)[] = [];
    const work = () =>
      new Promise<void>((resolve) => {
        running += 1;
        most = Math.max(most, running);
        releases.push(() => {
          running -= 1;
          resolve();
        });
      });
    const runs = [gate.run(work), gate.run(work), gate.run(work)];
    await expect(gate.run(work)).rejects.toBeInstanceOf(BusyError);
    await Promise.resolve();
    expect(running).toBe(2);
    while (releases.length > 0 || running > 0) {
      releases.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all(runs);
    expect(most).toBe(2);
    // The slots were all given back.
    await gate.run(() => Promise.resolve());
  });
});
