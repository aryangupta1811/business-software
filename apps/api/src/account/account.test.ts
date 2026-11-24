// Integration test on a throwaway PostgreSQL (ADR 0013), over real HTTP with a clock the test
// moves and a fake mailer: email confirmation, reset by email and by recovery key, changing
// your own password and remembered computers (Module 00 #30-#32, #42, #44-#46; P1.4 design,
// sections 6, 7, 9, 10).
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { createDatabase, type Database } from '@business-software/db';
import { startTestDatabase, type TestDatabase } from '@business-software/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { FakeMailer } from '../mail/mailer.js';
import { Browser, FakeClock } from '../testing/browser.js';
import { madeUpRecoveryKey } from '../testing/made-up-recovery-key.js';

const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'a much newer password';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const APP_URL = 'http://app.test';

describe('account recovery and remembered computers', () => {
  let server: TestDatabase;
  let admin: Database;
  let app: INestApplication;
  let base: string;
  const clock = new FakeClock();
  const mailer = new FakeMailer();
  let ipCount = 0;

  const browser = () => {
    ipCount += 1;
    return new Browser(base, `203.0.113.${String(ipCount)}`);
  };

  const query = async <T>(text: string, values: unknown[] = []) =>
    (await admin.pool.query<T & Record<string, unknown>>(text, values)).rows;

  /** A new business: its owner's browser, logged in by signup, and the recovery key. */
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
    const { businessId, recoveryKey } = response.body as {
      businessId: string;
      recoveryKey: string;
    };
    await owner.session();
    return { owner, businessId, recoveryKey };
  }

  /** The newest email to `to`, and the business ID and token in its link. */
  function lastLink(to: string, path: 'confirm-email' | 'reset') {
    const mail = mailer.sent.findLast((sent) => sent.to === to);
    const match = new RegExp(`${APP_URL}/${path}/([0-9a-f-]{36})/([A-Za-z0-9_-]{43})`).exec(
      mail?.text ?? '',
    );
    if (match === null) throw new Error(`No ${path} link sent to ${to}`);
    return { businessId: match[1] ?? '', token: match[2] ?? '' };
  }

  const sentTo = (to: string) => mailer.sent.filter((sent) => sent.to === to).length;

  async function confirmEmail(email: string) {
    const answer = await browser().call('POST', '/email/confirm', lastLink(email, 'confirm-email'));
    expect(answer.status).toBe(204);
  }

  async function addStaff(businessId: string, owner: Browser, username: string) {
    const hash = await hashPassword(PASSWORD);
    await query(
      `insert into users (business_id, role, name, username, password_hash, home_branch_id, joining_date)
       values ($1, 'staff', $2, $2, $3,
               (select id from branches where business_id = $1 order by created_at, id limit 1),
               '2026-01-01')`,
      [businessId, username, hash],
    );
    const staff = new Browser(base, owner.ip);
    staff.jar.set('__Host-device', owner.jar.get('__Host-device') ?? '');
    expect(
      (await staff.call('POST', '/login/staff', { username, password: PASSWORD })).status,
    ).toBe(200);
    return staff;
  }

  const actions = async (businessId: string) =>
    query<{ action: string; after: unknown }>(
      'select action, after from entry_log where business_id = $1 order by id',
      [businessId],
    );

  const login = (email: string, password: string) =>
    browser().call('POST', '/login', { email, password });

  beforeAll(async () => {
    server = await startTestDatabase();
    admin = createDatabase(server.adminUrl, () => undefined);
    app = await createApp(
      {
        databaseUrl: server.runtimeUrl,
        host: '127.0.0.1',
        port: 0,
        jsonLogs: false,
        appUrl: APP_URL,
      },
      { clock, mailer },
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

  describe('email confirmation (#32, #42)', () => {
    it('emails a link at signup; the link confirms the email once', async () => {
      const email = 'confirm@example.com';
      const { owner, businessId } = await signUp(email);
      expect(sentTo(email)).toBe(1);
      expect((await owner.session()).body).toMatchObject({
        emailConfirmed: false,
        emailLimited: false,
        // `02` #12: the owner has no discount limit.
        discountLimitBasisPoints: null,
      });

      const link = lastLink(email, 'confirm-email');
      expect(link.businessId).toBe(businessId);
      // From any browser, logged in or not: the email may be opened on a phone.
      expect((await browser().call('POST', '/email/confirm', link)).status).toBe(204);
      expect((await owner.session()).body).toMatchObject({ emailConfirmed: true });
      expect(await browser().call('POST', '/email/confirm', link)).toMatchObject({
        status: 400,
        body: { code: 'invalid_link' },
      });
      expect((await actions(businessId)).map((row) => row.action)).toContain(
        'user.email_confirmed',
      );
    });

    it('stops working after 7 days', async () => {
      const email = 'confirm-late@example.com';
      await signUp(email);
      const link = lastLink(email, 'confirm-email');
      clock.advance(7 * DAY + MINUTE);
      expect(await browser().call('POST', '/email/confirm', link)).toMatchObject({
        status: 400,
        body: { code: 'invalid_link' },
      });
    });

    it('"Send again" makes a new link and the old one stops working', async () => {
      const email = 'confirm-again@example.com';
      const { owner } = await signUp(email);
      const first = lastLink(email, 'confirm-email');
      expect((await owner.call('POST', '/email/confirm/send')).status).toBe(204);
      const second = lastLink(email, 'confirm-email');
      expect(second.token).not.toBe(first.token);
      expect((await browser().call('POST', '/email/confirm', first)).status).toBe(400);
      expect((await browser().call('POST', '/email/confirm', second)).status).toBe(204);
      expect(await owner.call('POST', '/email/confirm/send')).toMatchObject({
        status: 409,
        body: { code: 'already_confirmed' },
      });
    });

    it('is for the owner only', async () => {
      const { owner, businessId } = await signUp('confirm-staff@example.com');
      const staff = await addStaff(businessId, owner, 'kiran');
      expect(await staff.call('POST', '/email/confirm/send')).toMatchObject({
        status: 403,
        body: { code: 'forbidden' },
      });
    });

    it('a failed send does not fail signup (best effort after commit)', async () => {
      mailer.failWith(new Error('SMTP refused'));
      try {
        await signUp('confirm-fails@example.com');
      } finally {
        mailer.failWith(undefined);
      }
      expect(sentTo('confirm-fails@example.com')).toBe(0);
    });

    it('refuses a token that is not a token, and a business that is not an ID', async () => {
      expect(
        await browser().call('POST', '/email/confirm', { businessId: 'x', token: 'y' }),
      ).toMatchObject({
        status: 400,
        body: { code: 'invalid_body', fields: { businessId: 'invalid', token: 'invalid' } },
      });
    });
  });

  describe('reset by email (#30, #42)', () => {
    it('sends nothing to an unconfirmed or unknown email, with the same answer', async () => {
      const email = 'reset-unconfirmed@example.com';
      await signUp(email);
      const before = mailer.sent.length;
      for (const address of [email, 'nobody@example.com']) {
        expect(
          await browser().call('POST', '/password-reset/request', { email: address }),
        ).toMatchObject({ status: 202, body: null });
      }
      expect(mailer.sent.length).toBe(before);
    });

    it('resets the password from the link once, and ends every session of the owner', async () => {
      const email = 'reset@example.com';
      const { owner, businessId } = await signUp(email);
      await confirmEmail(email);
      const other = browser();
      expect((await other.call('POST', '/login', { email, password: PASSWORD })).status).toBe(200);

      expect(
        (await browser().call('POST', '/password-reset/request', { email: ' Reset@Example.com ' }))
          .status,
      ).toBe(202);
      const link = lastLink(email, 'reset');
      expect(link.businessId).toBe(businessId);
      expect(
        (
          await browser().call('POST', '/password-reset/complete', {
            ...link,
            newPassword: NEW_PASSWORD,
          })
        ).status,
      ).toBe(204);

      for (const ended of [owner, other]) {
        expect((await ended.call('GET', '/settings')).status).toBe(401);
      }
      expect((await login(email, PASSWORD)).status).toBe(401);
      expect((await login(email, NEW_PASSWORD)).status).toBe(200);
      expect(
        await browser().call('POST', '/password-reset/complete', {
          ...link,
          newPassword: 'yet another password',
        }),
      ).toMatchObject({ status: 400, body: { code: 'invalid_link' } });

      const reasons = await query<{ end_reason: string | null }>(
        'select end_reason from sessions where business_id = $1 order by id',
        [businessId],
      );
      expect(reasons.map((row) => row.end_reason).slice(0, 2)).toEqual(['reset', 'reset']);
      expect(await actions(businessId)).toContainEqual({
        action: 'user.password_reset',
        after: { via: 'email' },
      });
    });

    it('stops working after 30 minutes, and a newer link replaces an older one', async () => {
      const email = 'reset-late@example.com';
      await signUp(email);
      await confirmEmail(email);
      const request = () => browser().call('POST', '/password-reset/request', { email });
      const complete = (link: { businessId: string; token: string }) =>
        browser().call('POST', '/password-reset/complete', { ...link, newPassword: NEW_PASSWORD });

      await request();
      const first = lastLink(email, 'reset');
      await request();
      expect((await complete(first)).status).toBe(400);

      const second = lastLink(email, 'reset');
      clock.advance(30 * MINUTE + 1000);
      expect(await complete(second)).toMatchObject({ status: 400, body: { code: 'invalid_link' } });
    });

    it('refuses a new password that is the email, and keeps the link for another try', async () => {
      const email = 'reset-weak@example.com';
      await signUp(email);
      await confirmEmail(email);
      await browser().call('POST', '/password-reset/request', { email });
      const link = lastLink(email, 'reset');
      expect(
        await browser().call('POST', '/password-reset/complete', { ...link, newPassword: email }),
      ).toMatchObject({
        status: 400,
        body: { code: 'invalid_body', fields: { newPassword: 'same_as_email' } },
      });
      expect(
        (
          await browser().call('POST', '/password-reset/complete', {
            ...link,
            newPassword: NEW_PASSWORD,
          })
        ).status,
      ).toBe(204);
    });

    it('answers 202 to requests that arrive together, and keeps one open link', async () => {
      const email = 'reset-together@example.com';
      const { businessId } = await signUp(email);
      await confirmEmail(email);
      const answers = await Promise.all(
        [1, 2, 3, 4].map(() => browser().call('POST', '/password-reset/request', { email })),
      );
      expect(answers.map((answer) => answer.status)).toEqual([202, 202, 202, 202]);
      const open = await query<{ count: string }>(
        `select count(*) from auth_tokens
         where business_id = $1 and kind = 'reset_password' and used_at is null`,
        [businessId],
      );
      expect(open[0]?.count).toBe('1');
    });

    it('a new password, by recovery key or in Settings, stops an open reset link', async () => {
      const email = 'reset-stale@example.com';
      const { recoveryKey } = await signUp(email);
      await confirmEmail(email);
      const complete = (link: { businessId: string; token: string }) =>
        browser().call('POST', '/password-reset/complete', { ...link, newPassword: NEW_PASSWORD });

      await browser().call('POST', '/password-reset/request', { email });
      const beforeRecovery = lastLink(email, 'reset');
      const recovered = await browser().call('POST', '/recovery/reset', {
        email,
        recoveryKey,
        newPassword: 'the recovered password',
      });
      expect(recovered.status).toBe(200);
      expect(await complete(beforeRecovery)).toMatchObject({
        status: 400,
        body: { code: 'invalid_link' },
      });

      const again = browser();
      await again.call('POST', '/login', { email, password: 'the recovered password' });
      await again.session();
      await browser().call('POST', '/password-reset/request', { email });
      const beforeChange = lastLink(email, 'reset');
      expect(
        (
          await again.call('POST', '/password', {
            currentPassword: 'the recovered password',
            newPassword: 'the changed password',
          })
        ).status,
      ).toBe(204);
      expect(await complete(beforeChange)).toMatchObject({
        status: 400,
        body: { code: 'invalid_link' },
      });
    });

    it('takes 5 requests per email per hour (section 7)', async () => {
      const email = 'reset-limit@example.com';
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await browser().call('POST', '/password-reset/request', { email })).status).toBe(
          202,
        );
      }
      const refused = await browser().call('POST', '/password-reset/request', { email });
      expect(refused).toMatchObject({ status: 429, body: { code: 'too_many_attempts' } });
    });
  });

  describe('recovery key (#31)', () => {
    it('resets the password once, and answers a new key that works next time', async () => {
      const email = 'recover@example.com';
      const { owner, businessId, recoveryKey } = await signUp(email);
      const reset = (key: string, newPassword: string) =>
        browser().call('POST', '/recovery/reset', { email, recoveryKey: key, newPassword });

      // Typed in lower case with spaces, as someone copies it from paper.
      const typed = recoveryKey.toLowerCase().replaceAll('-', ' ');
      const first = await reset(typed, NEW_PASSWORD);
      expect(first.status).toBe(200);
      const next = (first.body as { recoveryKey: string }).recoveryKey;
      expect(next).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
      expect(next).not.toBe(recoveryKey);

      expect((await owner.call('GET', '/settings')).status).toBe(401);
      expect((await login(email, NEW_PASSWORD)).status).toBe(200);
      expect(await reset(recoveryKey, 'another new password')).toMatchObject({
        status: 401,
        body: { code: 'wrong_recovery_key' },
      });
      expect((await reset(next, 'another new password')).status).toBe(200);
      expect(await actions(businessId)).toContainEqual({
        action: 'user.password_reset',
        after: { via: 'recovery_key' },
      });
    });

    it('gives one answer for a wrong key and an unknown email, 5 tries per IP an hour', async () => {
      const email = 'recover-limit@example.com';
      await signUp(email);
      const wrongKey = madeUpRecoveryKey();
      const guesser = browser();
      const guess = (address: string, key: string) =>
        guesser.call('POST', '/recovery/reset', {
          email: address,
          recoveryKey: key,
          newPassword: NEW_PASSWORD,
        });
      const wrong = { status: 401, body: { code: 'wrong_recovery_key' } };
      expect(await guess('nobody@example.com', wrongKey)).toMatchObject(wrong);
      expect(await guess(email, 'not a key')).toMatchObject(wrong);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect(await guess(email, wrongKey)).toMatchObject(wrong);
      }
      expect(await guess(email, wrongKey)).toMatchObject({
        status: 429,
        body: { code: 'too_many_attempts' },
      });
    });

    it('a right key works from an IP that used up its tries, and clears them (shared IPs)', async () => {
      const email = 'recover-shared-ip@example.com';
      const { recoveryKey } = await signUp(email);
      const shared = browser();
      const reset = (key: string, newPassword: string) =>
        shared.call('POST', '/recovery/reset', { email, recoveryKey: key, newPassword });
      const wrongKey = madeUpRecoveryKey();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await reset(wrongKey, NEW_PASSWORD)).status).toBe(401);
      }
      expect((await reset(wrongKey, NEW_PASSWORD)).status).toBe(429);

      const right = await reset(recoveryKey, NEW_PASSWORD);
      expect(right.status).toBe(200);
      expect((await reset(wrongKey, 'another new password')).status).toBe(401);
    });

    it("reset-link requests don't use up the recovery key's tries from the same IP", async () => {
      const email = 'recover-after-links@example.com';
      const { recoveryKey } = await signUp(email);
      await confirmEmail(email);
      const shop = browser();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await shop.call('POST', '/password-reset/request', { email })).status).toBe(202);
      }
      const answer = await shop.call('POST', '/recovery/reset', {
        email,
        recoveryKey,
        newPassword: NEW_PASSWORD,
      });
      expect(answer.status).toBe(200);
    });

    it("someone who knows the email can't lock the owner out of recovery (#41)", async () => {
      // Owner, 2026-11-20: no limit per email on recovery-key tries, only per IP. The key has
      // 160 random bits, so guessing it is hopeless; a per-email limit would only let anyone who
      // knows the email block the owner's way back in for an hour.
      const email = 'recover-lockout@example.com';
      const { recoveryKey } = await signUp(email);
      const wrongKey = madeUpRecoveryKey();
      for (let attempt = 0; attempt < 12; attempt += 1) {
        expect(
          await browser().call('POST', '/recovery/reset', {
            email,
            recoveryKey: wrongKey,
            newPassword: NEW_PASSWORD,
          }),
        ).toMatchObject({ status: 401, body: { code: 'wrong_recovery_key' } });
      }
      const owner = await browser().call('POST', '/recovery/reset', {
        email,
        recoveryKey,
        newPassword: NEW_PASSWORD,
      });
      expect(owner.status).toBe(200);
      expect((await login(email, NEW_PASSWORD)).status).toBe(200);
    });

    it('the owner makes a new key with their password; the old key stops working', async () => {
      const email = 'new-key@example.com';
      const { owner, businessId, recoveryKey } = await signUp(email);
      expect(
        await owner.call('POST', '/recovery-key', { ownerPassword: 'wrong password' }),
      ).toMatchObject({ status: 401, body: { code: 'wrong_password' } });
      const made = await owner.call('POST', '/recovery-key', { ownerPassword: PASSWORD });
      expect(made.status).toBe(200);
      const newKey = (made.body as { recoveryKey: string }).recoveryKey;
      expect(
        await browser().call('POST', '/recovery/reset', {
          email,
          recoveryKey,
          newPassword: NEW_PASSWORD,
        }),
      ).toMatchObject({ status: 401 });
      expect(
        (
          await browser().call('POST', '/recovery/reset', {
            email,
            recoveryKey: newKey,
            newPassword: NEW_PASSWORD,
          })
        ).status,
      ).toBe(200);
      expect((await actions(businessId)).map((row) => row.action)).toContain(
        'recovery_key.replaced',
      );
    });

    it('two new keys made at once both answer, and only one key works', async () => {
      const email = 'new-key-together@example.com';
      const { owner, businessId } = await signUp(email);
      const other = browser();
      await other.call('POST', '/login', { email, password: PASSWORD });
      await other.session();
      const made = await Promise.all(
        [owner, other, owner, other].map((who) =>
          who.call('POST', '/recovery-key', { ownerPassword: PASSWORD }),
        ),
      );
      expect(made.map((answer) => answer.status)).toEqual([200, 200, 200, 200]);
      const unused = await query<{ count: string }>(
        'select count(*) from recovery_keys where business_id = $1 and used_at is null',
        [businessId],
      );
      expect(unused[0]?.count).toBe('1');
    });

    it('checks the owner password at most 10 times per session in 15 minutes', async () => {
      const { owner } = await signUp('new-key-limit@example.com');
      for (let attempt = 0; attempt < 10; attempt += 1) {
        expect(
          (await owner.call('POST', '/recovery-key', { ownerPassword: 'wrong password' })).status,
        ).toBe(401);
      }
      expect(await owner.call('POST', '/recovery-key', { ownerPassword: PASSWORD })).toMatchObject({
        status: 429,
        body: { code: 'too_many_attempts' },
      });
    });
  });

  describe('changing your own password (#46)', () => {
    it('needs the current password and logs you out on every other computer', async () => {
      const email = 'change@example.com';
      const { owner, businessId } = await signUp(email);
      const other = browser();
      await other.call('POST', '/login', { email, password: PASSWORD });

      expect(
        await owner.call('POST', '/password', {
          currentPassword: 'wrong password',
          newPassword: NEW_PASSWORD,
        }),
      ).toMatchObject({ status: 401, body: { code: 'wrong_password' } });
      expect(
        await owner.call('POST', '/password', {
          currentPassword: PASSWORD,
          newPassword: '9111111111',
        }),
      ).toMatchObject({ status: 400, body: { fields: { newPassword: 'same_as_phone' } } });
      expect(
        (
          await owner.call('POST', '/password', {
            currentPassword: PASSWORD,
            newPassword: NEW_PASSWORD,
          })
        ).status,
      ).toBe(204);

      expect((await owner.call('GET', '/settings')).status).toBe(200);
      expect((await other.call('GET', '/settings')).status).toBe(401);
      expect((await login(email, NEW_PASSWORD)).status).toBe(200);
      const reasons = await query<{ end_reason: string | null }>(
        "select end_reason from sessions where business_id = $1 and end_reason = 'password_changed'",
        [businessId],
      );
      expect(reasons).toHaveLength(1);
      expect((await actions(businessId)).map((row) => row.action)).toContain(
        'user.password_changed',
      );
    });

    it('works for staff too', async () => {
      const { owner, businessId } = await signUp('change-staff@example.com');
      const staff = await addStaff(businessId, owner, 'rekha');
      expect(
        (
          await staff.call('POST', '/password', {
            currentPassword: PASSWORD,
            newPassword: NEW_PASSWORD,
          })
        ).status,
      ).toBe(204);
      const again = new Browser(base, owner.ip);
      again.jar.set('__Host-device', owner.jar.get('__Host-device') ?? '');
      expect(
        (await again.call('POST', '/login/staff', { username: 'rekha', password: NEW_PASSWORD }))
          .status,
      ).toBe(200);
    });
  });

  describe('remembered computers (#44)', () => {
    it('lists, renames and forgets a computer; staff can no longer log in on it', async () => {
      const email = 'devices@example.com';
      const { owner, businessId } = await signUp(email);
      const counter2 = browser();
      await counter2.call('POST', '/login', { email, password: PASSWORD });
      const staff = await addStaff(businessId, counter2, 'vijay');

      const listed = await owner.call('GET', '/devices');
      expect(listed.status).toBe(200);
      const devices = listed.body as unknown as { id: string; thisComputer: boolean }[];
      expect(devices).toHaveLength(2);
      expect(devices.filter((device) => device.thisComputer)).toHaveLength(1);
      const target = devices.find((device) => !device.thisComputer);
      if (target === undefined) throw new Error('no second computer');

      expect(
        await owner.call('PUT', `/devices/${target.id}/name`, { name: '  Counter 2 ' }),
      ).toMatchObject({ status: 200, body: { id: target.id, name: 'Counter 2' } });

      expect(
        await owner.call('POST', `/devices/${target.id}/forget`, { ownerPassword: 'wrong one' }),
      ).toMatchObject({ status: 401, body: { code: 'wrong_password' } });
      expect(
        (await owner.call('POST', `/devices/${target.id}/forget`, { ownerPassword: PASSWORD }))
          .status,
      ).toBe(204);

      expect((await owner.call('GET', '/devices')).body).toHaveLength(1);
      // Its open sessions end, and staff can't log in there until the owner logs in again.
      expect((await staff.call('GET', '/session')).body).toMatchObject({ state: 'none' });
      expect((await counter2.call('GET', '/settings')).status).toBe(401);
      expect(
        await staff.call('POST', '/login/staff', { username: 'vijay', password: PASSWORD }),
      ).toMatchObject({ status: 401, body: { code: 'no_device' } });
      expect((await actions(businessId)).map((row) => row.action)).toEqual(
        expect.arrayContaining(['device.renamed', 'device.revoked']),
      );
    });

    it('prints at 80 mm with auto-print until the owner says otherwise, and the session shows it', async () => {
      const { owner } = await signUp('printing-default@example.com');
      const [self] = (await owner.call('GET', '/devices')).body as unknown as {
        id: string;
        printing: unknown;
      }[];
      expect(self?.printing).toEqual({ receiptSize: 80, autoPrint: true });
      expect((await owner.session()).body).toMatchObject({
        printing: { receiptSize: 80, autoPrint: true },
      });
    });

    it("sets one computer's receipt paper and auto-print, and the staff on it get them", async () => {
      const { owner, businessId } = await signUp('printing-set@example.com');
      const [self] = (await owner.call('GET', '/devices')).body as unknown as { id: string }[];
      const id = self?.id ?? '';
      const saved = await owner.call('PUT', `/devices/${id}/printing`, {
        receiptSize: 58,
        autoPrint: false,
      });
      expect(saved).toMatchObject({
        status: 200,
        body: { id, printing: { receiptSize: 58, autoPrint: false } },
      });
      expect((await owner.session()).body).toMatchObject({
        printing: { receiptSize: 58, autoPrint: false },
      });
      const staff = await addStaff(businessId, owner, 'counter-staff');
      expect((await staff.session()).body).toMatchObject({
        printing: { receiptSize: 58, autoPrint: false },
      });
      expect(
        (await actions(businessId)).filter((entry) => entry.action === 'device.printing_changed'),
      ).toEqual([
        { action: 'device.printing_changed', after: { receiptSize: 58, autoPrint: false } },
      ]);
      // The same again writes no second log entry.
      await owner.call('PUT', `/devices/${id}/printing`, { receiptSize: 58, autoPrint: false });
      expect(
        (await actions(businessId)).filter((entry) => entry.action === 'device.printing_changed'),
      ).toHaveLength(1);
    });

    it('lets only the owner change it, and refuses a paper size that is not 80 or 58', async () => {
      const { owner, businessId } = await signUp('printing-who@example.com');
      const [self] = (await owner.call('GET', '/devices')).body as unknown as { id: string }[];
      const id = self?.id ?? '';
      const staff = await addStaff(businessId, owner, 'cashier-staff');
      expect(
        (await staff.call('PUT', `/devices/${id}/printing`, { receiptSize: 58, autoPrint: true }))
          .status,
      ).toBe(403);
      expect(
        (await owner.call('PUT', `/devices/${id}/printing`, { receiptSize: 70, autoPrint: true }))
          .status,
      ).toBe(400);
    });

    it("can't change another business's computer's printing", async () => {
      const { owner } = await signUp('printing-a@example.com');
      const { owner: other } = await signUp('printing-b@example.com');
      const [theirs] = (await other.call('GET', '/devices')).body as unknown as { id: string }[];
      expect(
        await owner.call('PUT', `/devices/${theirs?.id ?? ''}/printing`, {
          receiptSize: 58,
          autoPrint: false,
        }),
      ).toMatchObject({ status: 404 });
      expect((await other.call('GET', '/devices')).body).toMatchObject([
        { printing: { receiptSize: 80, autoPrint: true } },
      ]);
    });

    it("can't see or touch another business's computer", async () => {
      const { owner } = await signUp('devices-a@example.com');
      const { owner: otherOwner } = await signUp('devices-b@example.com');
      const theirs = (await otherOwner.call('GET', '/devices')).body as unknown as {
        id: string;
      }[];
      const id = theirs[0]?.id ?? '';
      expect(await owner.call('PUT', `/devices/${id}/name`, { name: 'Mine' })).toMatchObject({
        status: 404,
        body: { code: 'not_found' },
      });
      expect(
        await owner.call('POST', `/devices/${id}/forget`, { ownerPassword: PASSWORD }),
      ).toMatchObject({ status: 404 });
    });

    it('forgetting this computer logs you out here', async () => {
      const { owner } = await signUp('devices-self@example.com');
      const [self] = (await owner.call('GET', '/devices')).body as unknown as { id: string }[];
      const answer = await owner.call('POST', `/devices/${self?.id ?? ''}/forget`, {
        ownerPassword: PASSWORD,
      });
      expect(answer.status).toBe(204);
      expect([...owner.jar.keys()]).toEqual([]);
    });
  });
});
