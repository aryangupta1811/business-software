// Integration test on a throwaway PostgreSQL (ADR 0013), over real HTTP with a clock the test
// moves: logins, the session cookie, lock and idle rules, CSRF and rate limits (ADR 0009;
// Module 00 #21, #27–#29, #34, #37–#41).
import { promisify } from 'node:util';
import { argon2 } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { createDatabase, type Database } from '@business-software/db';
import { startTestDatabase, type TestDatabase } from '@business-software/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACTIVE_PING_MS, IDLE_GRACE_MS } from '@business-software/shared';
import { createApp } from '../app.js';
import { BusyError, HashGate } from './hash-gate.js';
import { hashPassword } from './password.js';

const PASSWORD = 'correct horse battery';
const MINUTE = 60_000;

class FakeClock {
  time = Date.parse('2026-11-19T10:00:00Z');
  now() {
    return new Date(this.time);
  }
  advance(ms: number) {
    this.time += ms;
  }
}

interface Answer {
  status: number;
  body: Record<string, unknown> | null;
  cookies: string[];
  headers: Headers;
}

/** One browser: keeps the cookies it is given and sends them back, like Chrome. */
class Browser {
  readonly jar = new Map<string, string>();
  csrf = '';

  constructor(
    private readonly base: string,
    /** The client's address as Caddy reports it (X-Forwarded-For). */
    readonly ip: string,
  ) {}

  async call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': this.ip,
        'sec-fetch-site': 'same-origin',
        cookie: [...this.jar].map(([name, value]) => `${name}=${value}`).join('; '),
        ...(this.csrf !== '' && { 'x-csrf-token': this.csrf }),
        ...extra,
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const cookies = response.headers.getSetCookie();
    for (const cookie of cookies) {
      const [pair = ''] = cookie.split(';');
      const [name = '', value = ''] = pair.split('=');
      if (/Max-Age=0(;|$)/.test(cookie)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await response.text();
    const answer: Answer = {
      status: response.status,
      body: text === '' ? null : (JSON.parse(text) as Record<string, unknown>),
      cookies,
      headers: response.headers,
    };
    if (typeof answer.body?.csrfToken === 'string') this.csrf = answer.body.csrfToken;
    return answer;
  }

  /** Reads the session the way the web app does on load, picking up the CSRF token. */
  session() {
    return this.call('GET', '/session');
  }
}

describe('logins and sessions', () => {
  let server: TestDatabase;
  let admin: Database;
  let app: INestApplication;
  let base: string;
  const clock = new FakeClock();
  let ipCount = 0;

  const browser = () => {
    ipCount += 1;
    return new Browser(base, `198.51.100.${String(ipCount)}`);
  };

  const query = async <T>(text: string, values: unknown[] = []) =>
    (await admin.pool.query<T & Record<string, unknown>>(text, values)).rows;

  /** A new business: its owner's browser, logged in by signup (#37). */
  async function signUp(email: string) {
    const owner = browser();
    const response = await owner.call('POST', '/signup', {
      businessName: `Shop ${email}`,
      businessType: 'kirana',
      phone: '9111111111',
      stateCode: '27',
      gstStatus: 'regular',
      email,
      password: PASSWORD,
    });
    expect(response.status).toBe(201);
    const businessId = (response.body as { businessId: string }).businessId;
    await owner.session();
    return { owner, businessId };
  }

  /** A staff login made directly in the database (P1.5 builds the screen). */
  async function addStaff(businessId: string, username: string) {
    const hash = await hashPassword(PASSWORD);
    await query(
      `insert into users (business_id, role, name, username, password_hash)
       values ($1, 'staff', $2, $2, $3)`,
      [businessId, username, hash],
    );
  }

  const sessionsOf = (businessId: string) =>
    query<{ end_reason: string | null; locked_at: Date | null }>(
      'select end_reason, locked_at from sessions where business_id = $1 order by id',
      [businessId],
    );

  const actions = async (businessId: string) =>
    (
      await query<{ action: string; after: unknown }>(
        'select action, after from entry_log where business_id = $1 order by id',
        [businessId],
      )
    ).map((row) => row.action);

  beforeAll(async () => {
    server = await startTestDatabase();
    admin = createDatabase(server.adminUrl, () => undefined);
    app = await createApp(
      { databaseUrl: server.runtimeUrl, host: '127.0.0.1', port: 0, jsonLogs: false },
      { clock },
    );
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
    base = `http://127.0.0.1:${String(port)}/api`;
  });

  afterAll(async () => {
    await app.close();
    await admin.close();
    await server.stop();
  });

  describe('owner login (#27)', () => {
    it('logs in with email and password, and the session works', async () => {
      const { businessId } = await signUp('login@example.com');
      const counter = browser();
      const response = await counter.call('POST', '/login', {
        email: ' Login@Example.com ',
        password: PASSWORD,
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        state: 'active',
        user: { role: 'owner', name: 'login@example.com' },
        business: { id: businessId, name: 'Shop login@example.com' },
        csrfToken: expect.any(String) as unknown,
        idleMinutes: 5,
      });
      expect([...counter.jar.keys()]).toEqual(['__Host-session', '__Host-device']);
      expect((await counter.call('GET', '/settings')).status).toBe(200);
      expect(await actions(businessId)).toEqual([
        'business.created',
        'device.registered',
        'user.logged_in',
        'device.registered',
        'user.logged_in',
      ]);
    });

    // Same code, and both run a full Argon2id check (P1.4 design, section 5).
    it('gives one answer for a wrong password and an unknown email', async () => {
      await signUp('wrong@example.com');
      for (const body of [
        { email: 'wrong@example.com', password: 'not the password' },
        { email: 'nobody@example.com', password: PASSWORD },
      ]) {
        const started = performance.now();
        const response = await browser().call('POST', '/login', body);
        expect(response).toMatchObject({ status: 401, body: { code: 'wrong_login' } });
        expect(performance.now() - started).toBeGreaterThan(10);
      }
    });

    it('refuses a deactivated owner the same way (#34)', async () => {
      const { businessId } = await signUp('gone@example.com');
      await query('update users set deactivated_at = now() where business_id = $1', [businessId]);
      const response = await browser().call('POST', '/login', {
        email: 'gone@example.com',
        password: PASSWORD,
      });
      expect(response).toMatchObject({ status: 401, body: { code: 'wrong_login' } });
    });

    // ADR 0035: older parameters are replaced at the next login.
    it('rehashes a password stored with older parameters', async () => {
      const { businessId } = await signUp('rehash@example.com');
      const salt = Buffer.alloc(16, 3);
      const tag = await promisify(argon2)('argon2id', {
        message: Buffer.from(PASSWORD),
        nonce: salt,
        memory: 8192,
        passes: 3,
        parallelism: 1,
        tagLength: 32,
      });
      const b64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');
      await query('update users set password_hash = $2 where business_id = $1', [
        businessId,
        `$argon2id$v=19$m=8192,t=3,p=1$${b64(salt)}$${b64(tag)}`,
      ]);
      const response = await browser().call('POST', '/login', {
        email: 'rehash@example.com',
        password: PASSWORD,
      });
      expect(response.status).toBe(200);
      const [user] = await query<{ password_hash: string }>(
        "select password_hash from users where business_id = $1 and role = 'owner'",
        [businessId],
      );
      expect(user?.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    });
  });

  describe('GET /session', () => {
    it('says nobody is logged in on a new computer', async () => {
      expect((await browser().session()).body).toEqual({ state: 'none', device: null });
    });

    // #40: closing Chrome drops the session cookie; the device cookie stays.
    it('names the business a computer remembers once its session is gone', async () => {
      const { owner } = await signUp('remember@example.com');
      owner.jar.delete('__Host-session');
      expect((await owner.session()).body).toEqual({
        state: 'none',
        device: { businessName: 'Shop remember@example.com' },
      });
    });

    it('ignores a malformed or forged cookie', async () => {
      const { owner, businessId } = await signUp('forged@example.com');
      const stranger = browser();
      stranger.jar.set('__Host-session', 'garbage');
      expect((await stranger.session()).body).toEqual({ state: 'none', device: null });
      // Another business's ID in front of a real token finds nothing under RLS.
      const { businessId: other } = await signUp('forged-other@example.com');
      const token = (owner.jar.get('__Host-session') ?? '').replace(businessId, other);
      stranger.jar.set('__Host-session', token);
      expect((await stranger.session()).body).toEqual({ state: 'none', device: null });
    });
  });

  describe('lock (#21, #38)', () => {
    it('locks on "Lock now", refuses a wrong password, and unlocks', async () => {
      const { owner, businessId } = await signUp('lock@example.com');
      expect((await owner.call('POST', '/session/lock')).status).toBe(204);
      expect(await owner.call('GET', '/settings')).toMatchObject({
        status: 401,
        body: { code: 'locked' },
      });
      expect((await owner.session()).body).toMatchObject({ state: 'locked' });
      expect(await owner.call('POST', '/session/unlock', { password: 'wrong' })).toMatchObject({
        status: 401,
        body: { code: 'wrong_password' },
      });
      expect((await owner.call('POST', '/session/unlock', { password: PASSWORD })).status).toBe(
        204,
      );
      expect((await owner.call('GET', '/settings')).status).toBe(200);
      expect((await actions(businessId)).slice(-2)).toEqual(['session.locked', 'session.unlocked']);
    });

    it('locks after the owner lock time and the grace, counting from the last activity', async () => {
      const { owner, businessId } = await signUp('idle-owner@example.com');
      // Signup was the last activity. The lock time plus the grace is still allowed.
      clock.advance(5 * MINUTE + IDLE_GRACE_MS);
      expect((await owner.call('GET', '/settings')).status).toBe(200);
      clock.advance(1);
      expect(await owner.call('GET', '/settings')).toMatchObject({
        status: 401,
        body: { code: 'locked' },
      });
      expect((await sessionsOf(businessId)).at(-1)?.locked_at).not.toBeNull();
      expect(await actions(businessId)).toContain('session.locked');
    });

    // A tab that refetches on focus mustn't keep the owner's screen open (#21).
    it("doesn't count reads, or a write refused for its CSRF token, as activity", async () => {
      const { owner } = await signUp('reads@example.com');
      clock.advance(3 * MINUTE);
      await owner.session();
      expect((await owner.call('GET', '/settings')).status).toBe(200);
      const forged = await owner.call('POST', '/session/active', undefined, {
        'x-csrf-token': 'not-the-token',
      });
      expect(forged).toMatchObject({ status: 403, body: { code: 'csrf' } });
      clock.advance(2 * MINUTE + IDLE_GRACE_MS + 1);
      expect(await owner.call('GET', '/settings')).toMatchObject({ body: { code: 'locked' } });
    });

    // The browser pings on the first key press, then at most every ACTIVE_PING_MS, and covers
    // the screen after the idle time without one. The server must not act before it does.
    it('never locks before the browser would', async () => {
      const { owner } = await signUp('in-step@example.com');
      clock.advance(MINUTE);
      expect((await owner.call('POST', '/session/active')).status).toBe(204);
      // Keys pressed until just before the next ping was due, then nothing for 5 minutes.
      clock.advance(ACTIVE_PING_MS - 1 + 5 * MINUTE);
      expect((await owner.call('GET', '/settings')).status).toBe(200);
    });

    // Typing a long bill sends no requests: the web app tells the server someone is there.
    it('counts "still here" as activity, and refuses it on a locked session', async () => {
      const { owner } = await signUp('still-here@example.com');
      clock.advance(4 * MINUTE);
      expect((await owner.call('POST', '/session/active')).status).toBe(204);
      clock.advance(4 * MINUTE);
      expect((await owner.call('GET', '/settings')).status).toBe(200);
      clock.advance(6 * MINUTE);
      expect(await owner.call('POST', '/session/active')).toMatchObject({
        status: 401,
        body: { code: 'locked' },
      });
    });

    it('refuses to lock a staff session', async () => {
      const { owner, businessId } = await signUp('staff-lock@example.com');
      await addStaff(businessId, 'meena');
      const staff = new Browser(base, owner.ip);
      staff.jar.set('__Host-device', owner.jar.get('__Host-device') ?? '');
      await staff.call('POST', '/login/staff', { username: 'meena', password: PASSWORD });
      expect(await staff.call('POST', '/session/lock')).toMatchObject({
        status: 403,
        body: { code: 'forbidden' },
      });
    });
  });

  describe('staff login (#28, #29, #34)', () => {
    it('needs a computer that knows its business', async () => {
      expect(
        await browser().call('POST', '/login/staff', { username: 'ramesh', password: PASSWORD }),
      ).toMatchObject({ status: 401, body: { code: 'no_device' } });
    });

    it("logs in on the owner's computer, with staff permissions only", async () => {
      const { owner, businessId } = await signUp('staff@example.com');
      await addStaff(businessId, 'ramesh');
      await owner.call('POST', '/logout');
      const response = await owner.call('POST', '/login/staff', {
        username: ' Ramesh ',
        password: PASSWORD,
      });
      expect(response.body).toMatchObject({
        state: 'active',
        user: { role: 'staff', name: 'ramesh' },
        idleMinutes: 30,
      });
      expect(await owner.call('GET', '/settings')).toMatchObject({
        status: 403,
        body: { code: 'forbidden' },
      });
    });

    it('ends a staff session after the idle time', async () => {
      const { owner, businessId } = await signUp('staff-idle@example.com');
      await addStaff(businessId, 'suresh');
      await owner.call('POST', '/login/staff', { username: 'suresh', password: PASSWORD });
      clock.advance(30 * MINUTE + IDLE_GRACE_MS + 1);
      expect(await owner.call('POST', '/session/lock')).toMatchObject({
        status: 401,
        body: { code: 'session_ended' },
      });
      expect((await sessionsOf(businessId)).at(-1)?.end_reason).toBe('idle');
      const [log] = await query<{ after: unknown }>(
        "select after from entry_log where business_id = $1 and action = 'user.logged_out' order by id desc limit 1",
        [businessId],
      );
      expect(log?.after).toEqual({ cause: 'idle' });
    });

    it('ends a deactivated login on its next request', async () => {
      const { owner, businessId } = await signUp('staff-gone@example.com');
      await addStaff(businessId, 'gita');
      await owner.call('POST', '/login/staff', { username: 'gita', password: PASSWORD });
      await query("update users set deactivated_at = now() where username = 'gita'");
      expect(await owner.session()).toMatchObject({ body: { state: 'none' } });
      expect((await sessionsOf(businessId)).at(-1)?.end_reason).toBe('deactivated');
    });

    // #18: one session per browser; the next login replaces it.
    it("ends the owner's session when staff log in on the same browser", async () => {
      const { owner, businessId } = await signUp('replace@example.com');
      await addStaff(businessId, 'anil');
      await owner.call('POST', '/login/staff', { username: 'anil', password: PASSWORD });
      expect((await sessionsOf(businessId)).map((row) => row.end_reason)).toEqual([
        'replaced',
        null,
      ]);
    });
  });

  describe('one session per browser (#18)', () => {
    it("ends another business's session when its browser logs in as an owner", async () => {
      const { owner, businessId } = await signUp('shop-a@example.com');
      const { businessId: other } = await signUp('shop-b@example.com');
      const login = await owner.call('POST', '/login', {
        email: 'shop-b@example.com',
        password: PASSWORD,
      });
      expect(login).toMatchObject({ status: 200, body: { business: { id: other } } });
      expect((await sessionsOf(businessId)).map((row) => row.end_reason)).toEqual(['replaced']);
      expect((await actions(businessId)).at(-1)).toBe('user.logged_out');
    });

    it('ends the session a signup replaces (#37)', async () => {
      const { owner, businessId } = await signUp('first-shop@example.com');
      const second = await owner.call('POST', '/signup', {
        businessName: 'Second shop',
        businessType: 'kirana',
        phone: '9111111111',
        stateCode: '27',
        gstStatus: 'regular',
        email: 'second-shop@example.com',
        password: PASSWORD,
      });
      expect(second.status).toBe(201);
      expect((await sessionsOf(businessId)).map((row) => row.end_reason)).toEqual(['replaced']);
      expect((await actions(businessId)).at(-1)).toBe('user.logged_out');
    });
  });

  describe('logout', () => {
    it('ends the session and drops its cookie, keeping the device', async () => {
      const { owner, businessId } = await signUp('logout@example.com');
      const response = await owner.call('POST', '/logout');
      expect(response.status).toBe(204);
      expect([...owner.jar.keys()]).toEqual(['__Host-device']);
      expect((await sessionsOf(businessId)).at(-1)?.end_reason).toBe('logout');
      expect(await owner.call('GET', '/settings')).toMatchObject({
        status: 401,
        body: { code: 'not_logged_in' },
      });
    });

    it('works on a locked session', async () => {
      const { owner } = await signUp('logout-locked@example.com');
      await owner.call('POST', '/session/lock');
      expect((await owner.call('POST', '/logout')).status).toBe(204);
    });
  });

  describe('CSRF (ADR 0009)', () => {
    it('refuses a write from a session without its token', async () => {
      const { owner } = await signUp('csrf@example.com');
      owner.csrf = '';
      expect(await owner.call('POST', '/session/lock')).toMatchObject({
        status: 403,
        body: { code: 'csrf' },
      });
    });

    it('refuses a login posted from another site', async () => {
      await signUp('cross@example.com');
      const response = await browser().call(
        'POST',
        '/login',
        { email: 'cross@example.com', password: PASSWORD },
        { 'sec-fetch-site': 'cross-site' },
      );
      expect(response).toMatchObject({ status: 403, body: { code: 'cross_site' } });
    });
  });

  describe('rate limits (#41)', () => {
    it('makes one login wait after 10 wrong passwords, even with the right one', async () => {
      await signUp('limited@example.com');
      for (let i = 0; i < 10; i += 1) {
        const wrong = await browser().call('POST', '/login', {
          email: 'limited@example.com',
          password: `wrong ${String(i)}`,
        });
        expect(wrong.status).toBe(401);
      }
      const refused = await browser().call('POST', '/login', {
        email: 'limited@example.com',
        password: PASSWORD,
      });
      expect(refused).toMatchObject({
        status: 429,
        body: { code: 'too_many_attempts', retryAt: expect.any(String) as unknown },
      });
      clock.advance(15 * MINUTE);
      const later = await browser().call('POST', '/login', {
        email: 'limited@example.com',
        password: PASSWORD,
      });
      expect(later.status).toBe(200);
    });

    // Scan c: with one trusted proxy, a client can't pick its own address.
    it('counts 30 attempts per computer, whatever X-Forwarded-For a client forges', async () => {
      const real = '192.0.2.77';
      for (let i = 0; i < 30; i += 1) {
        const response = await new Browser(base, `10.0.0.${String(i)}, ${real}`).call(
          'POST',
          '/login',
          { email: `nobody${String(i)}@example.com`, password: PASSWORD },
        );
        expect(response.status).toBe(401);
      }
      const refused = await new Browser(base, `10.9.9.9, ${real}`).call('POST', '/login', {
        email: 'nobody@example.com',
        password: PASSWORD,
      });
      expect(refused.status).toBe(429);
    });

    // Each try is counted before its password is checked, so a burst can't slip past (#41).
    it('lets 10 of 22 simultaneous guesses at one login be checked', async () => {
      await signUp('burst@example.com');
      const answers = await Promise.all(
        Array.from({ length: 22 }, (_, i) =>
          browser().call('POST', '/login', {
            email: 'burst@example.com',
            password: `wrong ${String(i)}`,
          }),
        ),
      );
      const statuses = answers.map((answer) => answer.status);
      expect(statuses.filter((status) => status === 401)).toHaveLength(10);
      expect(statuses.filter((status) => status === 429)).toHaveLength(12);
    });

    it('lets 10 of 12 simultaneous unlock guesses be checked', async () => {
      const { owner } = await signUp('unlock-burst@example.com');
      await owner.call('POST', '/session/lock');
      const answers = await Promise.all(
        Array.from({ length: 12 }, () =>
          owner.call('POST', '/session/unlock', { password: 'wrong' }),
        ),
      );
      const statuses = answers.map((answer) => answer.status);
      expect(statuses.filter((status) => status === 401)).toHaveLength(10);
      expect(statuses.filter((status) => status === 429)).toHaveLength(2);
    });

    it('limits wrong unlock passwords per session', async () => {
      const { owner } = await signUp('unlock-limit@example.com');
      await owner.call('POST', '/session/lock');
      for (let i = 0; i < 10; i += 1) {
        await owner.call('POST', '/session/unlock', { password: 'wrong' });
      }
      expect(await owner.call('POST', '/session/unlock', { password: PASSWORD })).toMatchObject({
        status: 429,
      });
    });
  });

  // The password queue is full once, then frees up: the next logins must work (ADR 0038).
  it('answers busy when the password queue is full, and recovers', async () => {
    const { businessId } = await signUp('queue@example.com');
    class FullOnce extends HashGate {
      full = true;
      override run<T>(work: () => Promise<T>): Promise<T> {
        if (!this.full) return super.run(work);
        this.full = false;
        return Promise.reject(new BusyError());
      }
    }
    const busyApp = await createApp(
      { databaseUrl: server.runtimeUrl, host: '127.0.0.1', port: 0, jsonLogs: false },
      { clock, hashGate: new FullOnce() },
    );
    busyApp.useLogger(false);
    await busyApp.listen(0, '127.0.0.1');
    try {
      const { port } = (busyApp.getHttpServer() as Server).address() as AddressInfo;
      const counter = new Browser(`http://127.0.0.1:${String(port)}/api`, '198.51.100.250');
      const login = (email: string) =>
        counter.call('POST', '/login', { email, password: PASSWORD });
      expect(await login('queue@example.com')).toMatchObject({
        status: 503,
        body: { code: 'busy' },
      });
      // An unknown email is checked against a stand-in hash; a busy moment mustn't break it.
      expect(await login('nobody-here@example.com')).toMatchObject({
        status: 401,
        body: { code: 'wrong_login' },
      });
      expect(await login('queue@example.com')).toMatchObject({
        status: 200,
        body: { business: { id: businessId } },
      });
    } finally {
      await busyApp.close();
    }
  });

  // Scan d: a shared counter's browser keeps no API answer.
  it.each([
    ['GET', '/session'],
    ['GET', '/health'],
    ['POST', '/login'],
    ['GET', '/no-such-route'],
  ])('answers %s %s with Cache-Control: no-store', async (method, path) => {
    const response = await browser().call(method, path, method === 'POST' ? {} : undefined);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
