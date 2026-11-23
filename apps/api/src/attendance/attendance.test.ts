// Integration test on a throwaway PostgreSQL (ADR 0013), over real HTTP: staff records without a
// login, salary rates, the attendance register, a person's month and the shop holidays (P2.3
// design sections 3–5 and 7; Module 05 #1, #3, #5–#9, #25–#33; ADR 0048).
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { createDatabase, type Database } from '@business-software/db';
import { startTestDatabase, type TestDatabase } from '@business-software/db/testing';
import type {
  HolidayView,
  MonthView,
  RegisterView,
  SalaryRateView,
  StaffView,
} from '@business-software/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { Browser, FakeClock, type Answer } from '../testing/browser.js';

const PASSWORD = 'correct horse battery';
const STAFF_PASSWORD = 'a counter password';
/** The fake clock's day in India: a Thursday. */
const TODAY = '2026-11-19';
const YESTERDAY = '2026-11-18';
const TOMORROW = '2026-11-20';
const BASE_SWITCHES = [
  'billing.sell',
  'customers.view',
  'customers.manage',
  'items.view',
  'stock.view',
];

describe('staff records, attendance and holidays', () => {
  let server: TestDatabase;
  let admin: Database;
  let app: INestApplication;
  let base: string;
  const clock = new FakeClock();
  let ipCount = 0;
  let emailCount = 0;

  const query = async <T>(text: string, values: unknown[] = []) =>
    (await admin.pool.query<T & Record<string, unknown>>(text, values)).rows;

  /** A new business: its owner's browser, logged in by signup, and its head office. */
  async function signUp() {
    emailCount += 1;
    ipCount += 1;
    const owner = new Browser(base, `192.0.2.${String(ipCount)}`);
    const response = await owner.call('POST', '/signup', {
      businessName: `Shop ${String(emailCount)}`,
      businessType: 'kirana',
      phone: '9111111111',
      stateCode: '27',
      gstStatus: 'regular',
      email: `attendance${String(emailCount)}@example.com`,
      password: PASSWORD,
    });
    expect(response.status).toBe(201);
    const businessId = (response.body as { businessId: string }).businessId;
    const session = await owner.session();
    const branchId = (session.body as { branch: { id: string } }).branch.id;
    return { owner, businessId, branchId };
  }
  type Shop = Awaited<ReturnType<typeof signUp>>;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- a typed body helper
  const as = <T>(answer: Answer) => answer.body as unknown as T;

  /** A person with no login: a record only. */
  async function person(shop: Shop, name: string, extra: Record<string, unknown> = {}) {
    const answer = await shop.owner.call('POST', '/staff', {
      name,
      homeBranchId: shop.branchId,
      joiningDate: '2026-11-01',
      ...extra,
    });
    expect(answer.status, JSON.stringify(answer.body)).toBe(201);
    return as<StaffView>(answer);
  }

  /** A person with a login holding `extra` switches on top of the defaults. */
  async function login(shop: Shop, username: string, extra: string[] = [], body = {}) {
    const answer = await shop.owner.call('POST', '/staff', {
      name: username.toUpperCase(),
      homeBranchId: shop.branchId,
      joiningDate: '2026-11-01',
      username,
      password: STAFF_PASSWORD,
      ownerPassword: PASSWORD,
      permissions: [...BASE_SWITCHES, ...extra],
      ...body,
    });
    expect(answer.status, JSON.stringify(answer.body)).toBe(201);
    return as<StaffView>(answer);
  }

  /** A logged-in staff member at the owner's counter computer. */
  async function counter(shop: Shop, username: string) {
    const staff = new Browser(base, shop.owner.ip);
    staff.jar.set('__Host-device', shop.owner.jar.get('__Host-device') ?? '');
    const answer = await staff.call('POST', '/login/staff', {
      username,
      password: STAFF_PASSWORD,
    });
    expect(answer.status).toBe(200);
    await staff.session();
    return staff;
  }

  const register = (browser: Browser, date = TODAY, extra = '') =>
    browser.call('GET', `/attendance?date=${date}${extra}`);
  const rows = async (browser: Browser, date = TODAY, extra = '') => {
    const answer = await register(browser, date, extra);
    expect(answer.status).toBe(200);
    return as<RegisterView>(answer).rows;
  };
  const rowOf = async (browser: Browser, userId: string, date = TODAY) =>
    (await rows(browser, date)).find((row) => row.userId === userId);

  const put = (browser: Browser, userId: string, date: string, body: Record<string, unknown>) =>
    browser.call('PUT', `/attendance/${userId}/${date}`, {
      status: 'present',
      version: null,
      ...body,
    });

  const entries = (businessId: string, action: string) =>
    query<{
      actor_id: string;
      entity_id: string;
      branch_id: string | null;
      reason: string | null;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    }>(
      `select actor_id, entity_id, branch_id, reason, before, after
         from entry_log where business_id = $1 and action = $2 order by id`,
      [businessId, action],
    );

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

  describe('staff records', () => {
    it('adds a person with no login: name, home branch and joining date are enough', async () => {
      const shop = await signUp();
      const geeta = await shop.owner.call('POST', '/staff', {
        name: 'Geeta',
        homeBranchId: shop.branchId,
      });
      expect(geeta.status).toBe(201);
      const view = as<StaffView>(geeta);
      expect(view).toMatchObject({
        name: 'Geeta',
        username: null,
        phone: null,
        // The joining date takes today's, in India (05 #33).
        joiningDate: TODAY,
        weeklyOffDay: null,
        paidLeavesPerMonth: 0,
        overtimeRatePaise: null,
        salary: null,
        version: 1,
        active: true,
      });
      const [row] = await query<{ username: string | null; password_hash: string | null }>(
        'select username, password_hash from users where id = $1',
        [view.id],
      );
      expect(row).toEqual({ username: null, password_hash: null });
      expect(as<StaffView[]>(await shop.owner.call('GET', '/staff'))).toEqual([view]);
      const created = await entries(shop.businessId, 'staff.created');
      expect(created[0]?.after).toMatchObject({
        name: 'Geeta',
        username: null,
        joiningDate: TODAY,
      });
    });

    it('keeps the record fields, a normalised phone and a first salary', async () => {
      const shop = await signUp();
      const view = await person(shop, 'Raju', {
        phone: '+91 98765-43210',
        weeklyOffDay: 0,
        paidLeavesPerMonth: 2,
        overtimeRatePaise: 15_000,
        salary: { kind: 'monthly', amountPaise: 1_200_050 },
      });
      expect(view).toMatchObject({
        phone: '9876543210',
        weeklyOffDay: 0,
        paidLeavesPerMonth: 2,
        overtimeRatePaise: 15_000,
        salary: { fromMonth: '2026-11-01', kind: 'monthly', amountPaise: 1_200_050 },
      });
      expect((await entries(shop.businessId, 'staff.salary_set'))[0]).toMatchObject({
        entity_id: view.id,
        before: null,
        after: { fromMonth: '2026-11-01', kind: 'monthly', amountPaise: 1_200_050 },
      });
    });

    it('refuses a bad phone, a half login and a missing owner password', async () => {
      const shop = await signUp();
      const post = (body: Record<string, unknown>) =>
        shop.owner.call('POST', '/staff', { name: 'X', homeBranchId: shop.branchId, ...body });
      expect(await post({ phone: '123' })).toMatchObject({
        status: 400,
        body: { fields: { phone: 'invalid' } },
      });
      expect(await post({ username: 'xavier' })).toMatchObject({
        status: 400,
        body: { fields: { password: 'required', ownerPassword: 'required' } },
      });
      expect(await post({ username: 'xavier', password: STAFF_PASSWORD })).toMatchObject({
        status: 400,
        body: { fields: { ownerPassword: 'required' } },
      });
      expect(
        await post({ username: 'xavier', password: STAFF_PASSWORD, ownerPassword: 'wrong one' }),
      ).toMatchObject({ status: 401 });
      expect(as<StaffView[]>(await shop.owner.call('GET', '/staff'))).toEqual([]);
    });

    it('gives a record a login later: one person, not two', async () => {
      const shop = await signUp();
      const geeta = await person(shop, 'Geeta');
      const body = { username: 'Geeta.K', password: STAFF_PASSWORD, ownerPassword: PASSWORD };
      const path = `/staff/${geeta.id}/login`;

      expect(
        await shop.owner.call('POST', path, { ...body, ownerPassword: 'not the password' }),
      ).toMatchObject({ status: 401 });
      expect(await shop.owner.call('POST', path, { ...body, password: 'short' })).toMatchObject({
        status: 400,
        body: { fields: { password: 'too_short' } },
      });
      const given = await shop.owner.call('POST', path, body);
      expect(given.status).toBe(200);
      expect(as<StaffView>(given)).toMatchObject({
        id: geeta.id,
        username: 'geeta.k',
        version: 2,
      });
      // The new login works, with the defaults.
      const staff = new Browser(base, shop.owner.ip);
      staff.jar.set('__Host-device', shop.owner.jar.get('__Host-device') ?? '');
      expect(
        (
          await staff.call('POST', '/login/staff', {
            username: 'geeta.k',
            password: STAFF_PASSWORD,
          })
        ).status,
      ).toBe(200);
      const people = await query<{ n: number }>(
        `select count(*)::int as n from users where business_id = $1 and role = 'staff'`,
        [shop.businessId],
      );
      expect(people[0]?.n).toBe(1);
      expect(await shop.owner.call('POST', path, body)).toMatchObject({
        status: 409,
        body: { code: 'has_login' },
      });
      const log = await entries(shop.businessId, 'staff.login_added');
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ entity_id: geeta.id, after: { username: 'geeta.k' } });
      expect(JSON.stringify(log)).not.toContain(STAFF_PASSWORD);
    });

    it('refuses a taken username when giving a login, and an unknown person', async () => {
      const shop = await signUp();
      await login(shop, 'taken');
      const geeta = await person(shop, 'Geeta');
      expect(
        await shop.owner.call('POST', `/staff/${geeta.id}/login`, {
          username: 'taken',
          password: STAFF_PASSWORD,
          ownerPassword: PASSWORD,
        }),
      ).toMatchObject({ status: 409, body: { code: 'username_taken' } });
      expect(
        await shop.owner.call('POST', '/staff/0190f0f0-0000-7000-8000-0000000000aa/login', {
          username: 'nobody1',
          password: STAFF_PASSWORD,
          ownerPassword: PASSWORD,
        }),
      ).toMatchObject({ status: 404 });
    });

    it('edits the record fields from the version read, logs what changed, and refuses a stale copy', async () => {
      const shop = await signUp();
      const geeta = await person(shop, 'Geeta', { weeklyOffDay: 0 });
      const edit = (body: Record<string, unknown>) =>
        shop.owner.call('PUT', `/staff/${geeta.id}`, {
          name: 'Geeta',
          homeBranchId: shop.branchId,
          ...body,
        });
      const saved = await edit({ paidLeavesPerMonth: 3, phone: '9876543210', version: 1 });
      expect(saved.status).toBe(200);
      // A field that wasn't sent stays as it was.
      expect(as<StaffView>(saved)).toMatchObject({
        paidLeavesPerMonth: 3,
        phone: '9876543210',
        weeklyOffDay: 0,
        version: 2,
      });
      expect(await edit({ paidLeavesPerMonth: 4, version: 1 })).toMatchObject({
        status: 409,
        body: { code: 'stale' },
      });
      // Sent as null, a field is cleared.
      expect(as<StaffView>(await edit({ weeklyOffDay: null, phone: null }))).toMatchObject({
        weeklyOffDay: null,
        phone: null,
        version: 3,
      });
      const log = await entries(shop.businessId, 'staff.updated');
      expect(log.map((row) => [row.before, row.after])).toEqual([
        [
          { paidLeavesPerMonth: 0, phone: null },
          { paidLeavesPerMonth: 3, phone: '9876543210' },
        ],
        [
          { weeklyOffDay: 0, phone: '9876543210' },
          { weeklyOffDay: null, phone: null },
        ],
      ]);
      // Nothing changed: no new version, no entry.
      expect(as<StaffView>(await edit({})).version).toBe(3);
      expect(await entries(shop.businessId, 'staff.updated')).toHaveLength(2);
    });

    it('has no username to change on a record without a login', async () => {
      const shop = await signUp();
      const geeta = await person(shop, 'Geeta');
      expect(
        await shop.owner.call('PUT', `/staff/${geeta.id}`, {
          name: 'Geeta',
          homeBranchId: shop.branchId,
          username: 'geeta',
        }),
      ).toMatchObject({ status: 409, body: { code: 'no_login' } });
    });

    it('keeps the joining date no later than the first marked day', async () => {
      const shop = await signUp();
      const geeta = await person(shop, 'Geeta');
      expect((await put(shop.owner, geeta.id, YESTERDAY, { reason: 'wrong' })).status).toBe(200);
      const move = (joiningDate: string) =>
        shop.owner.call('PUT', `/staff/${geeta.id}`, {
          name: 'Geeta',
          homeBranchId: shop.branchId,
          joiningDate,
        });
      expect(await move('2026-11-19')).toMatchObject({
        status: 409,
        body: { code: 'marks_before_joining' },
      });
      expect((await move('2026-11-10')).status).toBe(200);
    });
  });

  describe('salary rates (05 #3, #30)', () => {
    it('keeps every rate, newest start first, and shows the one in force this month', async () => {
      const shop = await signUp();
      const geeta = await person(shop, 'Geeta');
      const post = (body: Record<string, unknown>) =>
        shop.owner.call('POST', `/staff/${geeta.id}/salary-rates`, body);
      expect(
        await post({ fromMonth: '2026-11', kind: 'monthly', amountPaise: 1_200_000 }),
      ).toMatchObject({
        status: 201,
        body: { fromMonth: '2026-11-01', kind: 'monthly', amountPaise: 1_200_000 },
      });
      // A raise from December leaves November as it was.
      await post({ fromMonth: '2026-12', kind: 'monthly', amountPaise: 1_300_000 });
      await post({ fromMonth: '2027-01', kind: 'daily', amountPaise: 45_000 });
      // The same month changed again: the later one wins.
      await post({ fromMonth: '2026-11', kind: 'daily', amountPaise: 50_000 });

      const history = as<SalaryRateView[]>(
        await shop.owner.call('GET', `/staff/${geeta.id}/salary-rates`),
      );
      expect(history.map((rate) => [rate.fromMonth, rate.kind, rate.amountPaise])).toEqual([
        ['2027-01-01', 'daily', 45_000],
        ['2026-12-01', 'monthly', 1_300_000],
        ['2026-11-01', 'daily', 50_000],
        ['2026-11-01', 'monthly', 1_200_000],
      ]);
      const listed = as<StaffView[]>(await shop.owner.call('GET', '/staff'))[0];
      expect(listed?.salary).toEqual({
        fromMonth: '2026-11-01',
        kind: 'daily',
        amountPaise: 50_000,
      });

      const log = await entries(shop.businessId, 'staff.salary_set');
      expect(log).toHaveLength(4);
      expect(log[3]).toMatchObject({
        entity_id: geeta.id,
        before: { fromMonth: '2026-11-01', kind: 'monthly', amountPaise: 1_200_000 },
        after: { fromMonth: '2026-11-01', kind: 'daily', amountPaise: 50_000 },
      });
      const rows = await query<{ n: number }>(
        'select count(*)::int as n from salary_rates where user_id = $1',
        [geeta.id],
      );
      expect(rows[0]?.n).toBe(4);
    });

    it('refuses a month before this one, a day, and a bad amount', async () => {
      const shop = await signUp();
      const geeta = await person(shop, 'Geeta');
      const post = (body: Record<string, unknown>) =>
        shop.owner.call('POST', `/staff/${geeta.id}/salary-rates`, {
          fromMonth: '2026-11',
          kind: 'monthly',
          amountPaise: 1_000,
          ...body,
        });
      expect(await post({ fromMonth: '2026-10' })).toMatchObject({
        status: 400,
        body: { fields: { fromMonth: 'past_month' } },
      });
      expect(await post({ fromMonth: '2026-11-01' })).toMatchObject({
        status: 400,
        body: { fields: { fromMonth: 'invalid' } },
      });
      expect(await post({ amountPaise: 0 })).toMatchObject({
        status: 400,
        body: { fields: { amountPaise: 'too_small' } },
      });
      expect(await post({ amountPaise: 10.5 })).toMatchObject({
        status: 400,
        body: { fields: { amountPaise: 'invalid' } },
      });
      expect(
        as<SalaryRateView[]>(await shop.owner.call('GET', `/staff/${geeta.id}/salary-rates`)),
      ).toEqual([]);
    });
  });

  describe('who may use the attendance routes (05 #25, #26)', () => {
    it('starts the two attendance switches off for a new login', async () => {
      const shop = await signUp();
      const plain = await login(shop, 'plain');
      expect(plain.permissions).not.toContain('attendance.mark');
      expect(plain.permissions).not.toContain('attendance.view_all');
      const marker = await login(shop, 'marker', ['attendance.mark', 'attendance.view_all']);
      expect(marker.permissions).toEqual(
        expect.arrayContaining(['attendance.mark', 'attendance.view_all']),
      );
      const staff = await counter(shop, 'marker');
      expect(((await staff.session()).body as { permissions: string[] }).permissions).toEqual(
        expect.arrayContaining(['attendance.mark', 'attendance.view_all']),
      );
    });

    it('refuses staff without the switch, and a stranger', async () => {
      const shop = await signUp();
      const geeta = await login(shop, 'geeta');
      const staff = await counter(shop, 'geeta');
      const stranger = new Browser(base, `198.51.100.${String(++ipCount)}`);
      const routes = [
        ['GET', `/attendance?date=${TODAY}`],
        ['PUT', `/attendance/${geeta.id}/${TODAY}`],
      ] as const;
      for (const [method, path] of routes) {
        const body = method === 'GET' ? undefined : { status: 'present', version: null };
        expect(await staff.call(method, path, body), `${method} ${path}`).toMatchObject({
          status: 403,
          body: { code: 'forbidden' },
        });
        expect((await stranger.call(method, path, body)).status).toBe(401);
      }
      // The holiday calendar and the rates are the owner's.
      for (const [method, path] of [
        ['GET', '/holidays'],
        ['POST', '/holidays'],
        ['GET', `/staff/${geeta.id}/salary-rates`],
        ['POST', `/staff/${geeta.id}/salary-rates`],
        ['POST', `/staff/${geeta.id}/login`],
      ] as const) {
        const body = method === 'GET' ? undefined : {};
        expect((await staff.call(method, path, body)).status, `${method} ${path}`).toBe(403);
      }
    });
  });

  describe('the register (05 #5, #6, #29)', () => {
    it('lists the branch’s people, each showing their default', async () => {
      const shop = await signUp();
      const raju = await person(shop, 'Raju', { weeklyOffDay: 4 });
      const meena = await person(shop, 'Meena', { weeklyOffDay: 0, paidLeavesPerMonth: 2 });
      const later = await person(shop, 'Later', { joiningDate: '2026-11-19' });
      const gone = await person(shop, 'Gone');
      await shop.owner.call('POST', `/staff/${gone.id}/deactivate`, {});

      const today = as<RegisterView>(await register(shop.owner));
      // Thursday: Raju's weekly off; Meena is in; Later joins today; Gone left today.
      expect(today.rows.map((row) => [row.name, row.status, row.marked, row.version])).toEqual([
        ['Gone', 'present', false, null],
        ['Later', 'present', false, null],
        ['Meena', 'present', false, null],
        ['Raju', 'weekly_off', false, null],
      ]);
      expect(today.rows[2]).toMatchObject({
        userId: meena.id,
        paidLeavesPerMonth: 2,
        paidLeavesUsed: 0,
        overtimeAllowed: false,
      });
      expect(today.summary).toBe('Everyone is in');

      // The 15th was a Sunday and before Later joined; Gone's deactivation is today's.
      const sunday = await rows(shop.owner, '2026-11-15');
      expect(sunday.map((row) => [row.userId, row.status])).toEqual([
        [gone.id, 'present'],
        [meena.id, 'weekly_off'],
        [raju.id, 'present'],
      ]);
      expect(later.joiningDate).toBe(TODAY);
    });

    it('shows a shop holiday as the default, for every branch or the person’s own', async () => {
      const shop = await signUp();
      const second = as<{ id: string }>(
        await shop.owner.call('POST', '/branches', {
          name: 'Andheri',
          code: 'AND',
          address: null,
          pinCode: null,
          stateCode: '27',
          gstin: null,
          drugLicence: null,
          fssai: null,
        }),
      );
      const raju = await person(shop, 'Raju');
      const asha = await person(shop, 'Asha', { homeBranchId: second.id });
      await shop.owner.call('POST', '/holidays', {
        date: YESTERDAY,
        name: 'Everywhere',
        branchId: null,
      });
      await shop.owner.call('POST', '/holidays', {
        date: TODAY,
        name: 'Head office only',
        branchId: shop.branchId,
      });
      expect((await rowOf(shop.owner, raju.id, YESTERDAY))?.status).toBe('holiday');
      expect((await rowOf(shop.owner, raju.id))?.status).toBe('holiday');
      const andheri = await rows(shop.owner, TODAY, `&branch=${second.id}`);
      expect(andheri.map((row) => [row.userId, row.status])).toEqual([[asha.id, 'present']]);
      const closed = await rows(shop.owner, YESTERDAY, `&branch=${second.id}`);
      expect(closed[0]?.status).toBe('holiday');
    });

    it('marks today without a reason and logs it as marked, with before and after', async () => {
      const shop = await signUp();
      const raju = await person(shop, 'Raju');
      const answer = await put(shop.owner, raju.id, TODAY, { status: 'absent' });
      expect(answer).toMatchObject({
        status: 200,
        body: { userId: raju.id, status: 'absent', marked: true, version: 1 },
      });
      expect(await rowOf(shop.owner, raju.id)).toMatchObject({ status: 'absent', version: 1 });
      const [entry] = await entries(shop.businessId, 'attendance.marked');
      expect(entry).toMatchObject({
        reason: null,
        branch_id: shop.branchId,
        before: {
          userId: raju.id,
          date: TODAY,
          status: 'present',
          late: false,
          overtimeMinutes: 0,
        },
        after: { userId: raju.id, date: TODAY, status: 'absent', late: false, overtimeMinutes: 0 },
      });
      expect(await entries(shop.businessId, 'attendance.changed')).toEqual([]);
    });

    it('needs a reason for a day before today, and logs it as changed with the reason', async () => {
      const shop = await signUp();
      const raju = await person(shop, 'Raju');
      expect(await put(shop.owner, raju.id, YESTERDAY, { status: 'absent' })).toMatchObject({
        status: 400,
        body: { code: 'invalid_body', fields: { reason: 'required' } },
      });
      expect(
        await put(shop.owner, raju.id, YESTERDAY, { status: 'absent', reason: '   ' }),
      ).toMatchObject({ status: 400, body: { fields: { reason: 'required' } } });
      expect(await rowOf(shop.owner, raju.id, YESTERDAY)).toMatchObject({ marked: false });

      const saved = await put(shop.owner, raju.id, YESTERDAY, {
        status: 'half_day',
        reason: 'Left at noon',
      });
      expect(saved).toMatchObject({ status: 200, body: { status: 'half_day', version: 1 } });
      const [entry] = await entries(shop.businessId, 'attendance.changed');
      expect(entry).toMatchObject({
        reason: 'Left at noon',
        before: { status: 'present' },
        after: { status: 'half_day', date: YESTERDAY },
      });
      expect(await entries(shop.businessId, 'attendance.marked')).toEqual([]);
    });

    it('refuses a day ahead (05 #32)', async () => {
      const shop = await signUp();
      const raju = await person(shop, 'Raju');
      expect(await put(shop.owner, raju.id, TOMORROW, { status: 'absent' })).toMatchObject({
        status: 422,
        body: { code: 'future_date' },
      });
      expect(await register(shop.owner, TOMORROW)).toMatchObject({
        status: 422,
        body: { code: 'future_date' },
      });
      expect(await put(shop.owner, raju.id, '2026-02-30', {})).toMatchObject({
        status: 400,
        body: { fields: { date: 'invalid' } },
      });
    });

    it('takes version null for a default day, and refuses a stale version with the latest', async () => {
      const shop = await signUp();
      const raju = await person(shop, 'Raju');
      const first = await put(shop.owner, raju.id, TODAY, { status: 'absent' });
      expect(first.body).toMatchObject({ version: 1 });
      // Another counter still thinks the day is a default.
      const stale = await put(shop.owner, raju.id, TODAY, { status: 'paid_leave' });
      expect(stale).toMatchObject({
        status: 409,
        body: { code: 'changed', latest: { status: 'absent', version: 1 } },
      });
      const second = await put(shop.owner, raju.id, TODAY, {
        status: 'paid_leave',
        version: 1,
      });
      expect(second.body).toMatchObject({ status: 'paid_leave', version: 2 });
      expect(
        await put(shop.owner, raju.id, TODAY, { status: 'present', version: 1 }),
      ).toMatchObject({ status: 409, body: { latest: { status: 'paid_leave', version: 2 } } });
      // A version for a day nobody marked isn't one either.
      const other = await person(shop, 'Other');
      expect(await put(shop.owner, other.id, TODAY, { version: 3 })).toMatchObject({
        status: 409,
        body: { code: 'changed', latest: { status: 'present', version: null } },
      });
      // The log keeps both saves.
      const log = await entries(shop.businessId, 'attendance.marked');
      expect(log.map((row) => [row.before?.status, row.after?.status])).toEqual([
        ['present', 'absent'],
        ['absent', 'paid_leave'],
      ]);
      expect(log[1]?.entity_id).toBe(log[0]?.entity_id);
    });

    it('lets only one of two counters save the same default day', async () => {
      const shop = await signUp();
      const raju = await person(shop, 'Raju');
      const answers = await Promise.all([
        put(shop.owner, raju.id, TODAY, { status: 'absent' }),
        put(shop.owner, raju.id, TODAY, { status: 'half_day' }),
      ]);
      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
      const losing = answers.find((answer) => answer.status === 409);
      expect(losing?.body).toMatchObject({ code: 'changed', latest: { version: 1 } });
      const count = await query<{ n: number }>(
        'select count(*)::int as n from attendance_marks where user_id = $1',
        [raju.id],
      );
      expect(count[0]?.n).toBe(1);
      expect(await entries(shop.businessId, 'attendance.marked')).toHaveLength(1);
    });

    it('writes nothing when a save changes nothing', async () => {
      const shop = await signUp();
      const raju = await person(shop, 'Raju', { overtimeRatePaise: 10_000 });
      await put(shop.owner, raju.id, TODAY, { status: 'present', late: true, overtimeMinutes: 60 });
      const same = await put(shop.owner, raju.id, TODAY, {
        status: 'present',
        late: true,
        overtimeMinutes: 60,
        version: 1,
      });
      expect(same).toMatchObject({ status: 200, body: { version: 1 } });
      expect(await entries(shop.businessId, 'attendance.marked')).toHaveLength(1);
    });

    it('allows late and overtime only on a present day, and overtime only for someone who has it', async () => {
      const shop = await signUp();
      const raju = await person(shop, 'Raju', { overtimeRatePaise: 10_000 });
      const nobody = await person(shop, 'Nobody');
      expect(await put(shop.owner, raju.id, TODAY, { status: 'absent', late: true })).toMatchObject(
        {
          status: 400,
          body: { fields: { late: 'only_when_present' } },
        },
      );
      expect(
        await put(shop.owner, raju.id, TODAY, { status: 'half_day', overtimeMinutes: 30 }),
      ).toMatchObject({ status: 400, body: { fields: { overtimeMinutes: 'only_when_present' } } });
      expect(await put(shop.owner, raju.id, TODAY, { overtimeMinutes: 45 })).toMatchObject({
        status: 400,
        body: { fields: { overtimeMinutes: 'invalid' } },
      });
      expect(await put(shop.owner, raju.id, TODAY, { overtimeMinutes: 750 })).toMatchObject({
        status: 400,
        body: { fields: { overtimeMinutes: 'too_big' } },
      });
      expect(await put(shop.owner, nobody.id, TODAY, { overtimeMinutes: 30 })).toMatchObject({
        status: 400,
        body: { fields: { overtimeMinutes: 'overtime_off' } },
      });
      // Late needs no rate.
      expect((await put(shop.owner, nobody.id, TODAY, { late: true })).status).toBe(200);
      const ok = await put(shop.owner, raju.id, TODAY, { late: true, overtimeMinutes: 90 });
      expect(ok).toMatchObject({
        status: 200,
        body: { status: 'present', late: true, overtimeMinutes: 90, overtimeAllowed: true },
      });
      expect(await entries(shop.businessId, 'attendance.marked')).toHaveLength(2);
    });

    it('keeps a person off the register before joining and after leaving', async () => {
      const shop = await signUp();
      const raju = await person(shop, 'Raju', { joiningDate: '2026-11-10' });
      expect(await put(shop.owner, raju.id, '2026-11-09', { reason: 'x' })).toMatchObject({
        status: 422,
        body: { code: 'not_on_register' },
      });
      expect((await put(shop.owner, raju.id, '2026-11-10', { reason: 'first day' })).status).toBe(
        200,
      );
      // Deactivated today: today still counts.
      await shop.owner.call('POST', `/staff/${raju.id}/deactivate`, {});
      expect((await put(shop.owner, raju.id, TODAY, { status: 'absent' })).status).toBe(200);
      // Deactivated on the 12th (India): the 12th counts, the 13th doesn't.
      await query('update users set deactivated_at = $2 where id = $1', [
        raju.id,
        '2026-11-12T06:00:00Z',
      ]);
      expect((await rowOf(shop.owner, raju.id, '2026-11-12'))?.status).toBe('present');
      expect(await rowOf(shop.owner, raju.id, '2026-11-13')).toBeUndefined();
      expect(await put(shop.owner, raju.id, '2026-11-13', { reason: 'late entry' })).toMatchObject({
        status: 422,
        body: { code: 'not_on_register' },
      });
    });

    it('counts the day’s absences for the header, and the month’s paid leaves used', async () => {
      const shop = await signUp();
      const [a, b, c, d] = [
        await person(shop, 'A', { paidLeavesPerMonth: 2 }),
        await person(shop, 'B'),
        await person(shop, 'C'),
        await person(shop, 'D'),
      ];
      await put(shop.owner, a.id, TODAY, { status: 'absent' });
      await put(shop.owner, b.id, TODAY, { status: 'absent' });
      await put(shop.owner, c.id, TODAY, { status: 'paid_leave' });
      await put(shop.owner, d.id, TODAY, { status: 'half_day' });
      await put(shop.owner, a.id, YESTERDAY, { status: 'paid_leave', reason: 'fever' });
      const view = as<RegisterView>(await register(shop.owner));
      expect(view.counts).toEqual({ absent: 2, halfDay: 1, paidLeave: 1 });
      expect(view.summary).toBe('2 absent, 1 half-day, 1 on leave');
      expect(view.rows.find((row) => row.userId === a.id)).toMatchObject({
        paidLeavesPerMonth: 2,
        paidLeavesUsed: 1,
      });
    });

    it('lets staff with the switch mark their own branch, and never themselves or another branch', async () => {
      const shop = await signUp();
      const clerk = await login(shop, 'clerk', ['attendance.mark']);
      const raju = await person(shop, 'Raju');
      const second = as<{ id: string }>(
        await shop.owner.call('POST', '/branches', {
          name: 'Andheri',
          code: 'AND',
          address: null,
          pinCode: null,
          stateCode: '27',
          gstin: null,
          drugLicence: null,
          fssai: null,
        }),
      );
      const asha = await person(shop, 'Asha', { homeBranchId: second.id });
      const staff = await counter(shop, 'clerk');

      expect((await rows(staff)).map((row) => row.name)).toEqual(['CLERK', 'Raju']);
      expect((await put(staff, raju.id, TODAY, { status: 'absent' })).status).toBe(200);
      expect(await put(staff, clerk.id, TODAY, { status: 'absent' })).toMatchObject({
        status: 403,
        body: { code: 'own_attendance' },
      });
      expect(await put(staff, asha.id, TODAY, { status: 'absent' })).toMatchObject({
        status: 403,
        body: { code: 'other_branch' },
      });
      // Staff always get their own branch, whatever they ask for.
      expect((await rows(staff, TODAY, `&branch=${second.id}`)).map((row) => row.name)).toEqual([
        'CLERK',
        'Raju',
      ]);
      // The owner, above the branches, may mark any of them.
      expect((await put(shop.owner, asha.id, TODAY, { status: 'absent' })).status).toBe(200);
      const log = await entries(shop.businessId, 'attendance.marked');
      // The first was the clerk's own save at the counter; the log names who made it.
      expect(log[0]?.actor_id).toBe(clerk.id);
      // An unknown person is a 404.
      expect(
        (await put(shop.owner, '0190f0f0-0000-7000-8000-0000000000aa', TODAY, {})).status,
      ).toBe(404);
    });
  });

  describe('a person’s month (05 #25, #28)', () => {
    it('counts the month from the marks and the defaults, only up to today', async () => {
      const shop = await signUp();
      const raju = await person(shop, 'Raju', { weeklyOffDay: 0, overtimeRatePaise: 10_000 });
      await put(shop.owner, raju.id, YESTERDAY, { status: 'absent', reason: 'ill' });
      await put(shop.owner, raju.id, '2026-11-17', { status: 'paid_leave', reason: 'wedding' });
      await put(shop.owner, raju.id, '2026-11-16', { status: 'half_day', reason: 'doctor' });
      await put(shop.owner, raju.id, TODAY, { late: true, overtimeMinutes: 90 });
      await shop.owner.call('POST', '/holidays', {
        date: '2026-11-05',
        name: 'Fair',
        branchId: null,
      });

      const answer = await shop.owner.call(
        'GET',
        `/attendance/month?userId=${raju.id}&month=2026-11`,
      );
      expect(answer.status).toBe(200);
      const month = as<MonthView>(answer);
      expect(month.days).toHaveLength(30);
      expect(month.days.find((day) => day.date === '2026-11-05')?.state?.status).toBe('holiday');
      expect(month.days.find((day) => day.date === '2026-11-08')?.state?.status).toBe('weekly_off');
      // Days after today aren't on the register yet.
      expect(month.days.filter((day) => day.state === null).map((day) => day.date)).toEqual(
        Array.from({ length: 11 }, (_, index) => `2026-11-${String(index + 20)}`),
      );
      expect(month.counts).toEqual({
        // 1 to 19 November, joined on the 1st: 19 days; Sundays are the 1st, 8th and 15th.
        present: 12,
        halfDay: 1,
        absent: 1,
        paidLeave: 1,
        weeklyOff: 3,
        holiday: 1,
        late: 1,
        overtimeMinutes: 90,
        holidaysTaken: 2.5,
      });
      // Before joining nobody is on the register: October is empty.
      const october = as<MonthView>(
        await shop.owner.call('GET', `/attendance/month?userId=${raju.id}&month=2026-10`),
      );
      expect(october.counts.present).toBe(0);
      expect(october.days.every((day) => day.state === null)).toBe(true);
    });

    it('shows staff their own month always, and others only with the switch and in their branch', async () => {
      const shop = await signUp();
      const plain = await login(shop, 'plain');
      const viewer = await login(shop, 'viewer', ['attendance.view_all']);
      const raju = await person(shop, 'Raju');
      const second = as<{ id: string }>(
        await shop.owner.call('POST', '/branches', {
          name: 'Andheri',
          code: 'AND',
          address: null,
          pinCode: null,
          stateCode: '27',
          gstin: null,
          drugLicence: null,
          fssai: null,
        }),
      );
      const asha = await person(shop, 'Asha', { homeBranchId: second.id });
      const month = (browser: Browser, userId: string) =>
        browser.call('GET', `/attendance/month?userId=${userId}&month=2026-11`);

      const own = await counter(shop, 'plain');
      expect((await month(own, plain.id)).status).toBe(200);
      expect(await month(own, raju.id)).toMatchObject({ status: 403, body: { code: 'forbidden' } });

      const all = await counter(shop, 'viewer');
      expect((await month(all, viewer.id)).status).toBe(200);
      expect((await month(all, raju.id)).status).toBe(200);
      expect(await month(all, asha.id)).toMatchObject({
        status: 403,
        body: { code: 'other_branch' },
      });
      // The owner sees everyone; the owner has no month of their own.
      expect((await month(shop.owner, asha.id)).status).toBe(200);
      const [owner] = await query<{ id: string }>(
        `select id from users where business_id = $1 and role = 'owner'`,
        [shop.businessId],
      );
      expect((await month(shop.owner, owner?.id ?? '')).status).toBe(404);
      // Whose months can be opened: the switch's own branch, or every branch for the owner.
      const people = (browser: Browser) => browser.call('GET', '/attendance/people');
      expect(await people(own)).toMatchObject({ status: 403, body: { code: 'forbidden' } });
      const names = async (browser: Browser) =>
        as<{ id: string; name: string }[]>(await people(browser)).map((entry) => entry.name);
      expect(await names(all)).toEqual(['PLAIN', 'Raju', 'VIEWER']);
      expect(await names(shop.owner)).toEqual(['Asha', 'PLAIN', 'Raju', 'VIEWER']);
      // A month can't be asked for as a day.
      expect(
        (await shop.owner.call('GET', `/attendance/month?userId=${raju.id}&month=2026-11-01`))
          .status,
      ).toBe(400);
    });
  });

  describe('shop holidays (05 #7, #31)', () => {
    it('lists a year’s holidays, one per scope per date, and archives a removed one', async () => {
      const shop = await signUp();
      const second = as<{ id: string }>(
        await shop.owner.call('POST', '/branches', {
          name: 'Andheri',
          code: 'AND',
          address: null,
          pinCode: null,
          stateCode: '27',
          gstin: null,
          drugLicence: null,
          fssai: null,
        }),
      );
      const add = (body: Record<string, unknown>) =>
        shop.owner.call('POST', '/holidays', {
          date: '2026-11-09',
          name: 'Diwali',
          branchId: null,
          ...body,
        });
      const diwali = await add({});
      expect(diwali).toMatchObject({
        status: 201,
        body: { date: '2026-11-09', name: 'Diwali', branchId: null },
      });
      expect(await add({ name: 'Again' })).toMatchObject({
        status: 409,
        body: { code: 'holiday_exists' },
      });
      // One branch's holiday on the same day is its own.
      const local = await add({ name: 'Local fair', branchId: second.id });
      expect(local.status).toBe(201);
      expect(await add({ name: 'Again', branchId: second.id })).toMatchObject({ status: 409 });
      await add({ date: '2027-01-26', name: 'Republic Day' });

      const list = (path = '/holidays') => shop.owner.call('GET', path);
      expect(as<HolidayView[]>(await list()).map((row) => row.name)).toEqual([
        'Diwali',
        'Local fair',
      ]);
      expect(as<HolidayView[]>(await list('/holidays?year=2027')).map((row) => row.name)).toEqual([
        'Republic Day',
      ]);

      const id = (diwali.body as unknown as HolidayView).id;
      expect(
        await shop.owner.call('POST', `/holidays/${id}/remove`, { reason: 'Shop stays open' }),
      ).toMatchObject({
        status: 200,
        body: { id, name: 'Diwali' },
      });
      // Archived, not deleted.
      const [row] = await query<{ archived_at: Date | null }>(
        'select archived_at from shop_holidays where id = $1',
        [id],
      );
      expect(row?.archived_at).not.toBeNull();
      expect(as<HolidayView[]>(await list()).map((entry) => entry.name)).toEqual(['Local fair']);
      // Removing it again is harmless, and the date is free again.
      expect((await shop.owner.call('POST', `/holidays/${id}/remove`, {})).status).toBe(200);
      expect((await add({ name: 'Diwali again' })).status).toBe(201);

      const added = await entries(shop.businessId, 'holiday.added');
      expect(added).toHaveLength(4);
      expect(added[0]).toMatchObject({
        after: { date: '2026-11-09', name: 'Diwali', branchId: null },
      });
      const removed = await entries(shop.businessId, 'holiday.removed');
      expect(removed).toHaveLength(1);
      expect(removed[0]).toMatchObject({
        entity_id: id,
        reason: 'Shop stays open',
        before: { date: '2026-11-09', name: 'Diwali' },
      });
    });

    it('takes a removed holiday off the register, and refuses a branch that is not live', async () => {
      const shop = await signUp();
      const raju = await person(shop, 'Raju');
      const holiday = as<HolidayView>(
        await shop.owner.call('POST', '/holidays', { date: TODAY, name: 'Strike', branchId: null }),
      );
      expect((await rowOf(shop.owner, raju.id))?.status).toBe('holiday');
      await shop.owner.call('POST', `/holidays/${holiday.id}/remove`, {});
      expect((await rowOf(shop.owner, raju.id))?.status).toBe('present');
      expect(
        await shop.owner.call('POST', '/holidays', {
          date: TODAY,
          name: 'Nowhere',
          branchId: '0190f0f0-0000-7000-8000-0000000000bb',
        }),
      ).toMatchObject({ status: 400, body: { fields: { branchId: 'invalid' } } });
      expect(
        await shop.owner.call('POST', '/holidays/0190f0f0-0000-7000-8000-0000000000bb/remove', {}),
      ).toMatchObject({ status: 404 });
    });
  });

  describe('two businesses', () => {
    it('never see each other’s people, rates, marks or holidays', async () => {
      const mine = await signUp();
      const theirs = await signUp();
      const raju = await person(mine, 'Raju', {
        overtimeRatePaise: 10_000,
        salary: { kind: 'monthly', amountPaise: 1_000_000 },
      });
      await put(mine.owner, raju.id, TODAY, { status: 'absent' });
      const holiday = as<HolidayView>(
        await mine.owner.call('POST', '/holidays', { date: TODAY, name: 'Mine', branchId: null }),
      );
      // The same day for them: nobody, nothing.
      expect(as<StaffView[]>(await theirs.owner.call('GET', '/staff'))).toEqual([]);
      expect(await rows(theirs.owner)).toEqual([]);
      expect(await rows(theirs.owner, TODAY, `&branch=${mine.branchId}`)).toEqual([]);
      expect(as<HolidayView[]>(await theirs.owner.call('GET', '/holidays'))).toEqual([]);
      // Their owner can't reach into mine by id.
      const reach: [string, string, Record<string, unknown>?][] = [
        ['GET', `/staff/${raju.id}/salary-rates`],
        [
          'POST',
          `/staff/${raju.id}/salary-rates`,
          { fromMonth: '2026-11', kind: 'monthly', amountPaise: 1 },
        ],
        ['PUT', `/staff/${raju.id}`, { name: 'Raju', homeBranchId: theirs.branchId }],
        ['PUT', `/attendance/${raju.id}/${TODAY}`, { status: 'absent', version: null }],
        ['GET', `/attendance/month?userId=${raju.id}&month=2026-11`],
        ['POST', `/holidays/${holiday.id}/remove`, {}],
      ];
      for (const [method, path, body] of reach) {
        expect((await theirs.owner.call(method, path, body)).status, `${method} ${path}`).toBe(404);
      }
      // Nothing of mine changed.
      expect((await rowOf(mine.owner, raju.id))?.status).toBe('absent');
      expect(as<HolidayView[]>(await mine.owner.call('GET', '/holidays'))).toHaveLength(1);
      expect(await entries(theirs.businessId, 'attendance.marked')).toEqual([]);
    });
  });

  it('keeps the register, the month and the rates in step for a person who joins mid-month', async () => {
    const shop = await signUp();
    const raju = await person(shop, 'Raju', {
      joiningDate: '2026-11-12',
      salary: { kind: 'daily', amountPaise: 60_000 },
    });
    const month = as<MonthView>(
      await shop.owner.call('GET', `/attendance/month?userId=${raju.id}&month=2026-11`),
    );
    expect(month.counts.present).toBe(8);
    expect(month.days.filter((day) => day.state !== null)).toHaveLength(8);
    expect(raju.salary).toEqual({ fromMonth: '2026-11-01', kind: 'daily', amountPaise: 60_000 });
  });
});
