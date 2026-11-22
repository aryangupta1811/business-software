// Integration test on a throwaway PostgreSQL (ADR 0013), over real HTTP: staff logins, their
// permissions read fresh on every request, and the owner's routes for them (P1.5 design,
// sections 3–5 and 7; Module 00 #15–#17, #33–#35, #44, #47–#53; ADR 0044).
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { createDatabase, type Database } from '@business-software/db';
import { startTestDatabase, type TestDatabase } from '@business-software/db/testing';
import {
  PERMISSIONS,
  STAFF_SWITCHES,
  type Permission,
  type StaffView,
} from '@business-software/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { Browser, FakeClock } from '../testing/browser.js';

const PASSWORD = 'correct horse battery';
const STAFF_PASSWORD = 'a cashier password';
const NEW_PASSWORD = 'a much newer password';
const DEFAULTS: Permission[] = [
  'session.own',
  'items.view',
  'stock.view',
  'billing.sell',
  'customers.view',
  'customers.manage',
];
const EVERY_SWITCH = STAFF_SWITCHES.map((entry) => entry.permission);
/** Permissions in the list's order, with `session.own` which every login holds. */
const inOrder = (names: readonly string[]) =>
  PERMISSIONS.filter((name) => name === 'session.own' || names.includes(name));
const STAFF_ROUTES = [
  ['GET', '/staff'],
  ['POST', '/staff'],
  ['PUT', '/staff/0190f0f0-0000-7000-8000-0000000000aa'],
  ['PUT', '/staff/0190f0f0-0000-7000-8000-0000000000aa/permissions'],
  ['POST', '/staff/0190f0f0-0000-7000-8000-0000000000aa/password'],
  ['POST', '/staff/0190f0f0-0000-7000-8000-0000000000aa/deactivate'],
  ['POST', '/staff/0190f0f0-0000-7000-8000-0000000000aa/reactivate'],
] as const;

describe('staff logins and permissions', () => {
  let server: TestDatabase;
  let admin: Database;
  let app: INestApplication;
  let base: string;
  const clock = new FakeClock();
  let ipCount = 0;
  let emailCount = 0;

  const browser = () => {
    ipCount += 1;
    return new Browser(base, `192.0.2.${String(ipCount)}`);
  };

  const query = async <T>(text: string, values: unknown[] = []) =>
    (await admin.pool.query<T & Record<string, unknown>>(text, values)).rows;

  /** A new business: its owner's browser, logged in by signup, and its first branch. */
  async function signUp() {
    emailCount += 1;
    const owner = browser();
    const response = await owner.call('POST', '/signup', {
      businessName: `Shop ${String(emailCount)}`,
      businessType: 'kirana',
      phone: '9111111111',
      stateCode: '27',
      gstStatus: 'regular',
      email: `owner${String(emailCount)}@example.com`,
      password: PASSWORD,
    });
    expect(response.status).toBe(201);
    const businessId = (response.body as { businessId: string }).businessId;
    const session = await owner.session();
    const branchId = (session.body as { branch: { id: string } }).branch.id;
    return { owner, businessId, branchId };
  }

  type Shop = Awaited<ReturnType<typeof signUp>>;

  const newLogin = (shop: Shop, username: string, extra: Record<string, unknown> = {}) => ({
    name: username.toUpperCase(),
    username,
    password: STAFF_PASSWORD,
    homeBranchId: shop.branchId,
    ownerPassword: PASSWORD,
    ...extra,
  });

  async function addStaff(shop: Shop, username: string, extra: Record<string, unknown> = {}) {
    const answer = await shop.owner.call('POST', '/staff', newLogin(shop, username, extra));
    expect(answer.status).toBe(201);
    return answer.body as unknown as StaffView;
  }

  /** A staff member at the owner's counter computer, logged in. */
  async function counter(shop: Shop, username: string, password = STAFF_PASSWORD) {
    const staff = new Browser(base, shop.owner.ip);
    staff.jar.set('__Host-device', shop.owner.jar.get('__Host-device') ?? '');
    const login = await staff.call('POST', '/login/staff', { username, password });
    expect(login.status).toBe(200);
    return staff;
  }

  const setPermissions = (
    shop: Shop,
    id: string,
    permissions: readonly string[],
    discountLimitBasisPoints: number | null = null,
    ownerPassword = PASSWORD,
  ) =>
    shop.owner.call('PUT', `/staff/${id}/permissions`, {
      permissions,
      discountLimitBasisPoints,
      ownerPassword,
    });

  const staffList = async (shop: Shop, includeInactive = false) =>
    (await shop.owner.call('GET', `/staff${includeInactive ? '?includeInactive=true' : ''}`))
      .body as unknown as StaffView[];

  const sessionPermissions = async (browserOf: Browser) =>
    ((await browserOf.session()).body as { permissions: Permission[] }).permissions;

  const entries = (businessId: string, action?: string) =>
    query<{
      action: string;
      actor_id: string;
      entity_id: string;
      branch_id: string | null;
      reason: string | null;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    }>(
      `select action, actor_id, entity_id, branch_id, reason, before, after
         from entry_log where business_id = $1 and ($2::text is null or action = $2) order by id`,
      [businessId, action ?? null],
    );

  const rowOf = async (id: string) =>
    (
      await query<{
        permissions_added: string[];
        permissions_removed: string[];
        discount_limit_basis_points: number | null;
        deactivated_at: Date | null;
        home_branch_id: string;
        username: string;
        name: string;
      }>(
        `select permissions_added, permissions_removed, discount_limit_basis_points,
                deactivated_at, home_branch_id, username, name from users where id = $1`,
        [id],
      )
    )[0];

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

  describe('who may use the staff routes', () => {
    it('refuses a staff login holding every switch, a locked owner and a stranger', async () => {
      const shop = await signUp();
      const cashier = await addStaff(shop, 'allswitches');
      expect((await setPermissions(shop, cashier.id, EVERY_SWITCH)).status).toBe(200);
      const staff = await counter(shop, 'allswitches');
      await staff.session();
      expect(await sessionPermissions(staff)).toEqual(inOrder(EVERY_SWITCH));
      const stranger = browser();
      for (const [method, path] of STAFF_ROUTES) {
        const body = method === 'GET' ? undefined : {};
        expect(await staff.call(method, path, body), `${method} ${path} as staff`).toMatchObject({
          status: 403,
          body: { code: 'forbidden' },
        });
        expect((await stranger.call(method, path, body)).status, `${method} ${path} anon`).toBe(
          401,
        );
      }
      expect((await shop.owner.call('POST', '/session/lock')).status).toBe(204);
      for (const [method, path] of STAFF_ROUTES) {
        const body = method === 'GET' ? undefined : {};
        expect(await shop.owner.call(method, path, body), `${method} ${path} locked`).toMatchObject(
          {
            status: 401,
            body: { code: 'locked' },
          },
        );
      }
    });
  });

  describe('adding a login (POST /staff)', () => {
    it('makes a login that works on the counter with the defaults', async () => {
      const shop = await signUp();
      const view = await addStaff(shop, 'ramesh');
      expect(view).toMatchObject({
        name: 'RAMESH',
        username: 'ramesh',
        homeBranchId: shop.branchId,
        active: true,
        permissions: DEFAULTS,
        discountLimitBasisPoints: null,
      });
      // Nothing stored beyond the defaults.
      expect(await rowOf(view.id)).toMatchObject({
        permissions_added: [],
        permissions_removed: [],
        discount_limit_basis_points: null,
        home_branch_id: shop.branchId,
      });
      const staff = await counter(shop, 'ramesh');
      expect((await staff.session()).body).toMatchObject({
        state: 'active',
        user: { role: 'staff', name: 'RAMESH' },
        permissions: DEFAULTS,
        discountLimitBasisPoints: 0,
      });
      expect((await staff.call('GET', '/items/context')).status).toBe(200);
      expect((await staff.call('GET', '/settings')).status).toBe(403);
    });

    it('stores a custom set as the difference from the defaults, in the list', async () => {
      const shop = await signUp();
      const view = await addStaff(shop, 'custom', {
        permissions: ['items.view', 'items.view_cost', 'billing.sell', 'billing.discount'],
        discountLimitBasisPoints: 750,
      });
      expect(view.permissions).toEqual(
        inOrder(['items.view', 'items.view_cost', 'billing.sell', 'billing.discount']),
      );
      expect(await rowOf(view.id)).toMatchObject({
        permissions_added: ['billing.discount', 'items.view_cost'],
        permissions_removed: ['customers.view', 'customers.manage', 'stock.view'],
        discount_limit_basis_points: 750,
      });
      expect(view.discountLimitBasisPoints).toBe(750);
      expect(await staffList(shop)).toEqual([view]);
    });

    it('refuses a taken username in any case, even a deactivated login, but not in another business', async () => {
      const shop = await signUp();
      const other = await signUp();
      const first = await addStaff(shop, 'ramesh');
      expect(
        await shop.owner.call('POST', '/staff', newLogin(shop, 'Ramesh', { name: 'Again' })),
      ).toMatchObject({ status: 409, body: { code: 'username_taken' } });
      expect((await shop.owner.call('POST', `/staff/${first.id}/deactivate`, {})).status).toBe(200);
      expect(await shop.owner.call('POST', '/staff', newLogin(shop, 'ramesh'))).toMatchObject({
        status: 409,
        body: { code: 'username_taken' },
      });
      await addStaff(other, 'ramesh');
      // The refusals added nothing.
      expect((await staffList(shop, true)).map((row) => row.username)).toEqual(['ramesh']);
    });

    it('refuses a short password, the username and the business phone as the password', async () => {
      const shop = await signUp();
      const refused = async (password: string) =>
        shop.owner.call('POST', '/staff', newLogin(shop, 'weakling', { password }));
      expect(await refused('short')).toMatchObject({
        status: 400,
        body: { code: 'invalid_body', fields: { password: 'too_short' } },
      });
      expect(await refused('9111111111')).toMatchObject({
        status: 400,
        body: { code: 'invalid_body', fields: { password: 'same_as_phone' } },
      });
      // The password is judged against the username however it is typed.
      const answer = await shop.owner.call(
        'POST',
        '/staff',
        newLogin(shop, 'longusername1', { password: ' LongUsername1 ' }),
      );
      expect(answer).toMatchObject({
        status: 400,
        body: { fields: { password: 'same_as_username' } },
      });
      expect(await staffList(shop)).toEqual([]);
    });

    it("refuses another business's branch and a branch that doesn't exist", async () => {
      const shop = await signUp();
      const other = await signUp();
      for (const homeBranchId of [other.branchId, '0190f0f0-0000-7000-8000-0000000000bb']) {
        expect(
          await shop.owner.call('POST', '/staff', newLogin(shop, 'nobranch', { homeBranchId })),
        ).toMatchObject({ status: 400, body: { fields: { homeBranchId: 'invalid' } } });
      }
      expect(await staffList(shop)).toEqual([]);
    });
  });

  describe("the owner's password (#17, #44; question 3A)", () => {
    it('is needed to create, change switches, reset a password and reactivate; not to edit or deactivate', async () => {
      const shop = await signUp();
      const person = await addStaff(shop, 'gated');
      const wrong = 'not the owner password';
      const calls: [string, string, Record<string, unknown>][] = [
        ['POST', '/staff', newLogin(shop, 'second')],
        [
          'PUT',
          `/staff/${person.id}/permissions`,
          { permissions: ['items.view'], discountLimitBasisPoints: null },
        ],
        ['POST', `/staff/${person.id}/password`, { newPassword: NEW_PASSWORD }],
      ];
      expect((await shop.owner.call('POST', `/staff/${person.id}/deactivate`, {})).status).toBe(
        200,
      );
      calls.push(['POST', `/staff/${person.id}/reactivate`, {}]);
      const before = (await entries(shop.businessId)).length;
      for (const [method, path, body] of calls) {
        const withoutPassword = Object.fromEntries(
          Object.entries(body).filter(([key]) => key !== 'ownerPassword'),
        );
        expect(
          await shop.owner.call(method, path, withoutPassword),
          `${path} missing`,
        ).toMatchObject({
          status: 400,
          body: { fields: { ownerPassword: 'required' } },
        });
        expect(
          await shop.owner.call(method, path, { ...withoutPassword, ownerPassword: wrong }),
          `${path} wrong`,
        ).toMatchObject({ status: 401, body: { code: 'wrong_password' } });
      }
      // Nothing changed and nothing was logged, except the deactivation made just above.
      expect((await entries(shop.businessId)).length).toBe(before);
      expect(await staffList(shop)).toEqual([]);
      expect((await staffList(shop, true)).map((row) => row.active)).toEqual([false]);

      // Reactivate with the right password, then the two ungated routes work without it.
      expect(
        (
          await shop.owner.call('POST', `/staff/${person.id}/reactivate`, {
            ownerPassword: PASSWORD,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await shop.owner.call('PUT', `/staff/${person.id}`, {
            name: 'Gated Two',
            username: 'gated',
            homeBranchId: shop.branchId,
          })
        ).status,
      ).toBe(200);
      expect((await shop.owner.call('POST', `/staff/${person.id}/deactivate`, {})).status).toBe(
        200,
      );
    });

    it('counts wrong passwords against the owner-password limit, and locks the check after ten', async () => {
      const shop = await signUp();
      const person = await addStaff(shop, 'limited');
      for (let attempt = 0; attempt < 10; attempt += 1) {
        expect(
          (await setPermissions(shop, person.id, ['items.view'], null, `wrong ${String(attempt)}`))
            .status,
        ).toBe(401);
      }
      expect(await setPermissions(shop, person.id, ['items.view'])).toMatchObject({
        status: 429,
        body: { code: 'too_many_attempts' },
      });
      expect((await rowOf(person.id))?.permissions_removed).toEqual([]);
    });
  });

  describe('permissions are read on every request', () => {
    it('takes a switch away from a login that is already open, with the same cookie', async () => {
      const shop = await signUp();
      const person = await addStaff(shop, 'live', { permissions: ['items.view', 'stock.view'] });
      const staff = await counter(shop, 'live');
      const second = await counter(shop, 'live');
      expect((await staff.call('GET', '/items/context')).status).toBe(200);
      expect((await second.call('GET', '/items/context')).status).toBe(200);
      const changed = await setPermissions(shop, person.id, ['stock.view']);
      expect(changed.status).toBe(200);
      for (const open of [staff, second]) {
        expect(await open.call('GET', '/items/context')).toMatchObject({
          status: 403,
          body: { code: 'forbidden' },
        });
        expect(await sessionPermissions(open)).toEqual(['session.own', 'stock.view']);
      }
    });

    it('gives a switch to a login that is already open', async () => {
      const shop = await signUp();
      const person = await addStaff(shop, 'granted');
      const staff = await counter(shop, 'granted');
      const adjust = () =>
        staff.call('POST', '/items/0190f0f0-0000-7000-8000-0000000000cc/stock/opening', {});
      expect((await adjust()).status).toBe(403);
      expect(
        (await setPermissions(shop, person.id, [...DEFAULTS.slice(1), 'stock.adjust'])).status,
      ).toBe(200);
      // Past the permission guard: the body or the item is what's wrong now.
      expect((await adjust()).status).not.toBe(403);
      expect(await sessionPermissions(staff)).toContain('stock.adjust');
    });

    it('ignores stored names it does not know or that are owner-only', async () => {
      const shop = await signUp();
      const person = await addStaff(shop, 'sneaky');
      await query(
        `update users set permissions_added = array['staff.manage', 'settings.manage', 'made.up']
          where id = $1`,
        [person.id],
      );
      const staff = await counter(shop, 'sneaky');
      expect(await sessionPermissions(staff)).toEqual(DEFAULTS);
      expect((await staff.call('GET', '/staff')).status).toBe(403);
      expect((await staff.call('GET', '/settings')).status).toBe(403);
    });

    it('picks up a switch whose default is on but was never stored (a later module)', async () => {
      const shop = await signUp();
      const person = await addStaff(shop, 'newer');
      // As if the login were made before `customers.manage` existed.
      await query(`update users set permissions_removed = '{}' where id = $1`, [person.id]);
      expect(await sessionPermissions(await counter(shop, 'newer'))).toContain('customers.manage');
    });
  });

  describe('the discount limit', () => {
    it('shows the limit while the switch is on, 0 while it is off, and keeps the stored limit', async () => {
      const shop = await signUp();
      const person = await addStaff(shop, 'discounter');
      const staff = await counter(shop, 'discounter');
      const limit = async () =>
        ((await staff.session()).body as { discountLimitBasisPoints: number })
          .discountLimitBasisPoints;
      expect(await limit()).toBe(0);

      const on = [...DEFAULTS.slice(1), 'billing.discount'];
      expect((await setPermissions(shop, person.id, on, 750)).status).toBe(200);
      expect(await limit()).toBe(750);

      // Switch off: the limit is 0 for the staff, and a limit sent with it is not stored.
      expect((await setPermissions(shop, person.id, DEFAULTS.slice(1), 900)).status).toBe(200);
      expect(await limit()).toBe(0);
      expect((await rowOf(person.id))?.discount_limit_basis_points).toBe(750);
      expect((await staffList(shop))[0]?.discountLimitBasisPoints).toBe(750);

      // On again: the stored limit is back.
      expect((await setPermissions(shop, person.id, on, 750)).status).toBe(200);
      expect(await limit()).toBe(750);
    });

    it('counts a switch with no limit as 0, and refuses a limit above 100%', async () => {
      const shop = await signUp();
      const person = await addStaff(shop, 'nolimit');
      const on = [...DEFAULTS.slice(1), 'billing.discount'];
      expect((await setPermissions(shop, person.id, on, null)).status).toBe(200);
      const staff = await counter(shop, 'nolimit');
      expect((await staff.session()).body).toMatchObject({ discountLimitBasisPoints: 0 });
      expect(await setPermissions(shop, person.id, on, 10_001)).toMatchObject({
        status: 400,
        body: { fields: { discountLimitBasisPoints: 'too_big' } },
      });
    });
  });

  describe('refused switch sets (422)', () => {
    it.each([
      [['items.manage'], 'needs_parent'],
      [['billing.discount'], 'needs_parent'],
      [['items.view', 'stock.adjust'], 'needs_parent'],
      [['settings.manage'], 'not_switchable'],
      [['staff.manage'], 'not_switchable'],
      [['session.own'], 'not_switchable'],
      [['made.up'], 'unknown'],
    ])('refuses %j', async (permissions, problem) => {
      const shop = await signUp();
      const person = await addStaff(shop, 'strict');
      expect(await setPermissions(shop, person.id, permissions)).toMatchObject({
        status: 422,
        body: { code: 'invalid_permissions', problem },
      });
      expect(
        await shop.owner.call('POST', '/staff', newLogin(shop, 'strict2', { permissions })),
      ).toMatchObject({
        status: 422,
        body: { code: 'invalid_permissions', problem },
      });
      expect((await rowOf(person.id))?.permissions_added).toEqual([]);
      expect(await staffList(shop)).toHaveLength(1);
    });
  });

  describe('editing a login (PUT /staff/:id)', () => {
    it('changes the name, username and home branch, and the new username logs in', async () => {
      const shop = await signUp();
      const person = await addStaff(shop, 'before');
      const answer = await shop.owner.call('PUT', `/staff/${person.id}`, {
        name: 'After Name',
        username: 'After',
        homeBranchId: shop.branchId,
      });
      expect(answer).toMatchObject({
        status: 200,
        body: { name: 'After Name', username: 'after' },
      });
      await counter(shop, 'after');
      const old = new Browser(base, shop.owner.ip);
      old.jar.set('__Host-device', shop.owner.jar.get('__Host-device') ?? '');
      expect(
        await old.call('POST', '/login/staff', { username: 'before', password: STAFF_PASSWORD }),
      ).toMatchObject({ status: 401, body: { code: 'wrong_login' } });
    });

    it('refuses a username another login has', async () => {
      const shop = await signUp();
      await addStaff(shop, 'taken');
      const person = await addStaff(shop, 'wanting');
      expect(
        await shop.owner.call('PUT', `/staff/${person.id}`, {
          name: 'W',
          username: 'taken',
          homeBranchId: shop.branchId,
        }),
      ).toMatchObject({ status: 409, body: { code: 'username_taken' } });
    });
  });

  describe('deactivating and reactivating (#34)', () => {
    it('ends open sessions at once, keeps the history, and brings the login back on reactivate', async () => {
      const shop = await signUp();
      const person = await addStaff(shop, 'leaver', {
        permissions: ['items.view', 'stock.view', 'stock.adjust'],
      });
      const staff = await counter(shop, 'leaver');
      const second = await counter(shop, 'leaver');
      const gone = await shop.owner.call('POST', `/staff/${person.id}/deactivate`, {
        reason: ' moved to another city ',
      });
      expect(gone).toMatchObject({ status: 200, body: { active: false } });
      // Same transaction: the sessions ended already, before either browser calls again.
      expect(
        (
          await query<{ end_reason: string }>(
            'select end_reason from sessions where user_id = $1 order by id',
            [person.id],
          )
        ).map((row) => row.end_reason),
      ).toEqual(['deactivated', 'deactivated']);
      for (const open of [staff, second]) {
        expect((await open.call('GET', '/items/context')).status).toBe(401);
      }
      const retry = new Browser(base, shop.owner.ip);
      retry.jar.set('__Host-device', shop.owner.jar.get('__Host-device') ?? '');
      expect(
        await retry.call('POST', '/login/staff', { username: 'leaver', password: STAFF_PASSWORD }),
      ).toMatchObject({ status: 401, body: { code: 'wrong_login' } });

      expect(await staffList(shop)).toEqual([]);
      expect((await staffList(shop, true)).map((row) => row.id)).toEqual([person.id]);
      expect((await rowOf(person.id))?.deactivated_at).not.toBeNull();

      const back = await shop.owner.call('POST', `/staff/${person.id}/reactivate`, {
        ownerPassword: PASSWORD,
      });
      expect(back).toMatchObject({ status: 200, body: { active: true } });
      // The old sessions stay ended; a new login works, with the permissions as they were.
      expect((await staff.call('GET', '/items/context')).status).toBe(401);
      const again = await counter(shop, 'leaver');
      expect(await sessionPermissions(again)).toEqual(
        inOrder(['items.view', 'stock.view', 'stock.adjust']),
      );
      expect(await staffList(shop)).toHaveLength(1);
    });

    it('does nothing, and logs nothing, when the login is already in that state', async () => {
      const shop = await signUp();
      const person = await addStaff(shop, 'twice');
      expect(
        (
          await shop.owner.call('POST', `/staff/${person.id}/reactivate`, {
            ownerPassword: PASSWORD,
          })
        ).status,
      ).toBe(200);
      await shop.owner.call('POST', `/staff/${person.id}/deactivate`, {});
      await shop.owner.call('POST', `/staff/${person.id}/deactivate`, {});
      expect(await entries(shop.businessId, 'staff.deactivated')).toHaveLength(1);
      expect(await entries(shop.businessId, 'staff.reactivated')).toHaveLength(0);
    });
  });

  describe('the owner sets a staff password (#33)', () => {
    it('replaces the password, ends that login everywhere and leaves the owner alone', async () => {
      const shop = await signUp();
      const person = await addStaff(shop, 'forgetful');
      const staff = await counter(shop, 'forgetful');
      const done = await shop.owner.call('POST', `/staff/${person.id}/password`, {
        newPassword: NEW_PASSWORD,
        ownerPassword: PASSWORD,
      });
      expect(done.status).toBe(204);
      expect((await staff.call('GET', '/items/context')).status).toBe(401);
      const device = shop.owner.jar.get('__Host-device') ?? '';
      const retry = (password: string) => {
        const next = new Browser(base, shop.owner.ip);
        next.jar.set('__Host-device', device);
        return next.call('POST', '/login/staff', { username: 'forgetful', password });
      };
      expect(await retry(STAFF_PASSWORD)).toMatchObject({
        status: 401,
        body: { code: 'wrong_login' },
      });
      expect((await retry(NEW_PASSWORD)).status).toBe(200);
      expect((await shop.owner.call('GET', '/settings')).status).toBe(200);
      expect(
        (await entries(shop.businessId, 'user.password_reset')).map((row) => row.after),
      ).toEqual([{ via: 'owner' }]);
    });

    it('holds the new password to the rules', async () => {
      const shop = await signUp();
      const person = await addStaff(shop, 'rules');
      const reset = (newPassword: string) =>
        shop.owner.call('POST', `/staff/${person.id}/password`, {
          newPassword,
          ownerPassword: PASSWORD,
        });
      expect(await reset('short')).toMatchObject({
        status: 400,
        body: { fields: { newPassword: 'too_short' } },
      });
      expect(await reset('9111111111')).toMatchObject({
        status: 400,
        body: { fields: { newPassword: 'same_as_phone' } },
      });
    });
  });

  describe('which rows the routes can reach', () => {
    it("answers 404 for the owner's own row and for another business's staff", async () => {
      const shop = await signUp();
      const other = await signUp();
      const ownerId = ((await shop.owner.session()).body as { user: { id: string } }).user.id;
      const theirs = await addStaff(other, 'theirs');
      const sent = {
        update: { name: 'X', username: 'xxx', homeBranchId: shop.branchId },
        permissions: { permissions: [], discountLimitBasisPoints: null, ownerPassword: PASSWORD },
        password: { newPassword: NEW_PASSWORD, ownerPassword: PASSWORD },
      };
      for (const id of [ownerId, theirs.id, '0190f0f0-0000-7000-8000-0000000000aa', 'nope']) {
        for (const [method, path, payload] of [
          ['PUT', `/staff/${id}`, sent.update],
          ['PUT', `/staff/${id}/permissions`, sent.permissions],
          ['POST', `/staff/${id}/password`, sent.password],
          ['POST', `/staff/${id}/deactivate`, {}],
          ['POST', `/staff/${id}/reactivate`, { ownerPassword: PASSWORD }],
        ] as const) {
          expect(await shop.owner.call(method, path, payload), `${method} ${path}`).toMatchObject({
            status: 404,
            body: { code: 'not_found' },
          });
        }
      }
      // The other business's login is untouched, and its owner still sees only their own.
      expect(await staffList(other)).toEqual([theirs]);
      expect(await staffList(shop)).toEqual([]);
    });
  });

  describe('the entry log (#20, `06` #3)', () => {
    it('writes one row per action with the owner as actor, and never a password', async () => {
      const shop = await signUp();
      const ownerId = ((await shop.owner.session()).body as { user: { id: string } }).user.id;
      const person = await addStaff(shop, 'logged', {
        permissions: ['items.view', 'billing.sell'],
      });
      const staff = await counter(shop, 'logged');
      await shop.owner.call('PUT', `/staff/${person.id}`, {
        name: 'LOGGED',
        username: 'logged.two',
        homeBranchId: shop.branchId,
      });
      const on = [...DEFAULTS.slice(1), 'billing.discount'];
      await setPermissions(shop, person.id, on, 500);
      await shop.owner.call('POST', `/staff/${person.id}/password`, {
        newPassword: NEW_PASSWORD,
        ownerPassword: PASSWORD,
      });
      // A new login after the reset, so the deactivation has a session to end.
      await counter(shop, 'logged.two', NEW_PASSWORD);
      await shop.owner.call('POST', `/staff/${person.id}/deactivate`, { reason: 'left' });
      await shop.owner.call('POST', `/staff/${person.id}/reactivate`, { ownerPassword: PASSWORD });
      expect((await staff.call('GET', '/items/context')).status).toBe(401);

      const log = (await entries(shop.businessId)).filter((row) => row.entity_id === person.id);
      expect(log.map((row) => row.action)).toEqual([
        'staff.created',
        'staff.updated',
        'staff.permissions_changed',
        'user.password_reset',
        'staff.deactivated',
        'staff.reactivated',
      ]);
      for (const row of log) {
        expect(row.actor_id).toBe(ownerId);
        expect(row.branch_id).toBe(shop.branchId);
      }
      const [created, updated, changed, reset, deactivated, reactivated] = log;
      expect(created?.before).toBeNull();
      expect(created?.after).toEqual({
        name: 'LOGGED',
        username: 'logged',
        homeBranchId: shop.branchId,
        phone: null,
        joiningDate: '2026-11-19',
        weeklyOffDay: null,
        paidLeavesPerMonth: 0,
        overtimeRatePaise: null,
        permissions: ['session.own', 'items.view', 'billing.sell'],
        discountLimitBasisPoints: 0,
      });
      expect(updated).toMatchObject({
        before: { username: 'logged' },
        after: { username: 'logged.two' },
      });
      expect(changed?.before).toEqual({
        permissions: ['session.own', 'items.view', 'billing.sell'],
        discountLimitBasisPoints: 0,
      });
      expect(changed?.after).toEqual({
        permissions: inOrder(on),
        discountLimitBasisPoints: 500,
      });
      expect(reset?.after).toEqual({ via: 'owner' });
      expect(deactivated).toMatchObject({ reason: 'left', before: null, after: null });
      expect(reactivated).toMatchObject({ reason: null });
      // The sessions the deactivation ended are in the log too.
      const ended = await entries(shop.businessId, 'user.logged_out');
      expect(ended.map((row) => row.after)).toContainEqual({ cause: 'deactivated' });

      const everything = JSON.stringify(await entries(shop.businessId));
      for (const secret of [PASSWORD, STAFF_PASSWORD, NEW_PASSWORD, 'argon2']) {
        expect(everything).not.toContain(secret);
      }
    });

    it('writes nothing for a save that changes nothing or fails', async () => {
      const shop = await signUp();
      const person = await addStaff(shop, 'quiet');
      const count = async () => (await entries(shop.businessId)).length;
      const before = await count();
      // Same profile, same switches.
      await shop.owner.call('PUT', `/staff/${person.id}`, {
        name: 'QUIET',
        username: 'quiet',
        homeBranchId: shop.branchId,
      });
      await setPermissions(shop, person.id, DEFAULTS.slice(1));
      expect(await count()).toBe(before);
      // A taken username rolls back with the action.
      await addStaff(shop, 'other');
      const afterOther = await count();
      await shop.owner.call('PUT', `/staff/${person.id}`, {
        name: 'QUIET',
        username: 'other',
        homeBranchId: shop.branchId,
      });
      await shop.owner.call('POST', '/staff', newLogin(shop, 'OTHER'));
      expect(await count()).toBe(afterOther);
    });
  });
});
