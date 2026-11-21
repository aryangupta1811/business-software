// Integration test on a throwaway PostgreSQL (ADR 0013), over real HTTP: branches, which branch
// a computer is in, a staff login's extra branches, and `?branch=` on the stock reads (P1.6
// design, sections 4–7 and 10; Module 00 #12–#14, #35, #54–#60; ADR 0045).
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { createDatabase, type Database } from '@business-software/db';
import { startTestDatabase, type TestDatabase } from '@business-software/db/testing';
import type {
  BranchRef,
  BranchView,
  DeviceView,
  ItemPage,
  ItemStockView,
  ItemView,
  MovementPage,
  StaffView,
} from '@business-software/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { Browser, FakeClock, type Answer } from '../testing/browser.js';

const PASSWORD = 'correct horse battery';
const STAFF_PASSWORD = 'a cashier password';

const branchBody = (code: string, overrides: Record<string, unknown> = {}) => ({
  name: `Shop ${code}`,
  code,
  address: null,
  pinCode: null,
  stateCode: '27',
  gstin: null,
  drugLicence: null,
  fssai: null,
  ...overrides,
});

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- a typed body helper
const as = <T>(answer: Answer) => answer.body as unknown as T;

describe('branches', () => {
  let server: TestDatabase;
  let admin: Database;
  let app: INestApplication;
  let base: string;
  const clock = new FakeClock();
  let ipCount = 0;
  let emailCount = 0;

  const browser = () => {
    ipCount += 1;
    return new Browser(base, `198.51.100.${String(ipCount)}`);
  };

  const query = async <T>(text: string, values: unknown[] = []) =>
    (await admin.pool.query<T & Record<string, unknown>>(text, values)).rows;

  /** A new business: its owner's browser (logged in by signup) and its head office. */
  async function signUp(gstStatus = 'unregistered') {
    emailCount += 1;
    const email = `owner${String(emailCount)}@example.com`;
    const owner = browser();
    const response = await owner.call('POST', '/signup', {
      businessName: `Shop ${String(emailCount)}`,
      businessType: 'kirana',
      phone: '9111111111',
      stateCode: '27',
      gstStatus,
      email,
      password: PASSWORD,
    });
    expect(response.status).toBe(201);
    const businessId = as<{ businessId: string }>(response).businessId;
    const session = as<{ branch: { id: string } }>(await owner.session());
    return { owner, email, businessId, headOfficeId: session.branch.id };
  }
  type Shop = Awaited<ReturnType<typeof signUp>>;

  async function addBranch(shop: Shop, code: string, overrides: Record<string, unknown> = {}) {
    const answer = await shop.owner.call('POST', '/branches', branchBody(code, overrides));
    expect(answer.status, JSON.stringify(answer.body)).toBe(201);
    return as<BranchView>(answer);
  }

  /** The owner logs in on another computer: it asks which branch, then is registered there. */
  async function computerAt(shop: Shop, branchId: string) {
    const computer = browser();
    const asked = await computer.call('POST', '/login', { email: shop.email, password: PASSWORD });
    expect(asked.status).toBe(409);
    const login = await computer.call('POST', '/login', {
      email: shop.email,
      password: PASSWORD,
      branchId,
    });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    return computer;
  }

  async function addStaff(shop: Shop, username: string, homeBranchId = shop.headOfficeId) {
    const answer = await shop.owner.call('POST', '/staff', {
      name: username.toUpperCase(),
      username,
      password: STAFF_PASSWORD,
      homeBranchId,
      ownerPassword: PASSWORD,
    });
    expect(answer.status, JSON.stringify(answer.body)).toBe(201);
    return as<StaffView>(answer);
  }

  /** A staff member at the given computer (their browser has its device cookie and address). */
  function atComputer(computer: Browser) {
    const staff = new Browser(base, computer.ip);
    staff.jar.set('__Host-device', computer.jar.get('__Host-device') ?? '');
    return staff;
  }

  const loginStaff = (computer: Browser, username: string) =>
    atComputer(computer).call('POST', '/login/staff', { username, password: STAFF_PASSWORD });

  const setExtraBranches = (
    shop: Shop,
    staffId: string,
    branchIds: string[],
    ownerPassword = PASSWORD,
  ) => shop.owner.call('PUT', `/staff/${staffId}/branches`, { branchIds, ownerPassword });

  const entries = (businessId: string, action: string) =>
    query<{
      actor_id: string;
      entity_id: string;
      branch_id: string | null;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    }>(
      `select actor_id, entity_id, branch_id, before, after from entry_log
        where business_id = $1 and action = $2 order by id`,
      [businessId, action],
    );

  const deviceOf = async (computer: Browser) =>
    as<DeviceView[]>(await computer.call('GET', '/devices')).find((device) => device.thisComputer);

  async function goodsItem(shop: Shop, overrides: Record<string, unknown> = {}) {
    const answer = await shop.owner.call('POST', '/items', {
      kind: 'goods',
      name: `Atta ${crypto.randomUUID().slice(0, 8)}`,
      hindiName: null,
      code: null,
      categoryId: null,
      brand: null,
      stockUnit: 'kg',
      sellingPrice: 5_200,
      wholesalePrice: null,
      purchasePrice: 4_000,
      mrp: null,
      priceIncludesTax: true,
      gstRate: null,
      hsn: null,
      packs: [],
      levels: [],
      barcodes: [],
      ...overrides,
    });
    expect(answer.status, JSON.stringify(answer.body)).toBe(201);
    return as<ItemView>(answer);
  }

  const openStock = (who: Browser, itemId: string, quantity: number) =>
    who.call('POST', `/items/${itemId}/stock/opening`, {
      quantity,
      requestKey: crypto.randomUUID(),
    });

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

  describe('who may use the branch routes', () => {
    it('refuses staff, a locked owner and a stranger', async () => {
      const shop = await signUp();
      const other = await addBranch(shop, 'AND');
      const staffLogin = await addStaff(shop, 'cashier1');
      const id = other.id;
      const routes = [
        ['GET', '/branches'],
        ['POST', '/branches'],
        ['PUT', `/branches/${id}`],
        ['POST', `/branches/${id}/archive`],
        ['POST', `/branches/${id}/restore`],
        ['PUT', `/devices/${id}/branch`],
        ['PUT', `/staff/${staffLogin.id}/branches`],
      ] as const;
      const staff = atComputer(shop.owner);
      expect(
        (
          await staff.call('POST', '/login/staff', {
            username: 'cashier1',
            password: STAFF_PASSWORD,
          })
        ).status,
      ).toBe(200);
      const stranger = browser();
      for (const [method, path] of routes) {
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
      for (const [method, path] of routes) {
        const body = method === 'GET' ? undefined : {};
        expect(await shop.owner.call(method, path, body), `${method} ${path} locked`).toMatchObject(
          { status: 401, body: { code: 'locked' } },
        );
      }
    });

    it('gives staff only their own branch in the picker', async () => {
      const shop = await signUp();
      await addBranch(shop, 'AND');
      await addStaff(shop, 'cashier2');
      const staff = atComputer(shop.owner);
      await staff.call('POST', '/login/staff', { username: 'cashier2', password: STAFF_PASSWORD });
      const picker = as<BranchRef[]>(await staff.call('GET', '/branches/picker'));
      expect(picker).toEqual([
        { id: shop.headOfficeId, code: 'HO', name: expect.any(String) as unknown },
      ]);
      const owner = (await shop.owner.call('GET', '/branches/picker'))
        .body as unknown as BranchRef[];
      expect(owner.map((branch) => branch.code)).toEqual(['HO', 'AND']);
    });
  });

  describe('adding and editing a branch', () => {
    it('adds a branch, logs it once and lists it with its counts', async () => {
      const shop = await signUp();
      const added = await addBranch(shop, 'and', {
        name: 'Andheri',
        address: 'Shop 2\nLink Road',
        pinCode: '400053',
      });
      expect(added).toMatchObject({
        code: 'AND',
        name: 'Andheri',
        address: 'Shop 2\nLink Road',
        pinCode: '400053',
        stateCode: '27',
        headOffice: false,
        archived: false,
        computers: 0,
        staff: 0,
      });
      const listed = as<BranchView[]>(await shop.owner.call('GET', '/branches'));
      expect(listed.map((branch) => [branch.code, branch.headOffice, branch.computers])).toEqual([
        ['HO', true, 1],
        ['AND', false, 0],
      ]);
      expect(await entries(shop.businessId, 'branch.created')).toEqual([
        expect.objectContaining({
          entity_id: added.id,
          branch_id: added.id,
          after: expect.objectContaining({ code: 'AND', name: 'Andheri' }) as unknown,
        }),
      ]);
    });

    it('refuses a code already in use (409) and codes that are not 1 to 6 capitals or digits', async () => {
      const shop = await signUp();
      await addBranch(shop, 'AND');
      expect(await shop.owner.call('POST', '/branches', branchBody('AND'))).toMatchObject({
        status: 409,
        body: { code: 'code_taken' },
      });
      // HO is the head office's code: taken too, whatever the case typed.
      expect(await shop.owner.call('POST', '/branches', branchBody('ho'))).toMatchObject({
        status: 409,
        body: { code: 'code_taken' },
      });
      for (const code of ['', 'TOOLONG', 'A-B', 'A B']) {
        expect(await shop.owner.call('POST', '/branches', branchBody(code))).toMatchObject({
          status: 400,
          body: { code: 'invalid_body' },
        });
      }
    });

    it('keeps the GSTIN rules: its own state, the business PAN, and none while unregistered', async () => {
      const unregistered = await signUp();
      expect(
        await unregistered.owner.call(
          'POST',
          '/branches',
          branchBody('AND', { gstin: '27ABCDE1234F1Z0' }),
        ),
      ).toMatchObject({ status: 400, body: { fields: { gstin: 'not_registered' } } });
      const registered = await signUp('regular');
      expect(
        await registered.owner.call(
          'POST',
          '/branches',
          branchBody('AND', { gstin: '29ABCDE1234F1ZW', stateCode: '27' }),
        ),
      ).toMatchObject({ status: 400, body: { fields: { gstin: 'state_mismatch' } } });
      // Another state needs its own GSTIN (#14): a valid one is kept.
      const delhi = await addBranch(registered, 'DEL', {
        stateCode: '07',
        gstin: '07ABCDE1234F1Z2',
      });
      expect(delhi).toMatchObject({ stateCode: '07', gstin: '07ABCDE1234F1Z2' });
      // With the business PAN on file, the GSTIN must carry it.
      const details = as<{ business: Record<string, unknown> }>(
        await registered.owner.call('GET', '/settings'),
      );
      expect(
        (
          await registered.owner.call('PUT', '/settings/business', {
            ...details.business,
            pan: 'ZZZZZ9999Z',
          })
        ).status,
      ).toBe(200);
      expect(
        await registered.owner.call(
          'POST',
          '/branches',
          branchBody('GOA', { stateCode: '07', gstin: '07ABCDE1234F1Z2' }),
        ),
      ).toMatchObject({ status: 400, body: { fields: { gstin: 'pan_mismatch' } } });
    });

    it('edits only the changed fields, and logs nothing when nothing changed', async () => {
      const shop = await signUp();
      const added = await addBranch(shop, 'AND', { name: 'Andheri' });
      const same = await shop.owner.call(
        'PUT',
        `/branches/${added.id}`,
        branchBody('AND', { name: 'Andheri' }),
      );
      expect(same.status).toBe(200);
      expect(await entries(shop.businessId, 'branch.updated')).toEqual([]);
      const edit = await shop.owner.call(
        'PUT',
        `/branches/${added.id}`,
        branchBody('ANH', { name: 'Andheri', pinCode: '400053' }),
      );
      expect(edit).toMatchObject({ status: 200, body: { code: 'ANH', pinCode: '400053' } });
      expect(await entries(shop.businessId, 'branch.updated')).toEqual([
        expect.objectContaining({
          entity_id: added.id,
          before: { code: 'AND', pinCode: null },
          after: { code: 'ANH', pinCode: '400053' },
        }),
      ]);
      // Another branch's code can't be taken by an edit.
      expect(
        await shop.owner.call(
          'PUT',
          `/branches/${added.id}`,
          branchBody('HO', { name: 'Andheri' }),
        ),
      ).toMatchObject({ status: 409, body: { code: 'code_taken' } });
    });

    it('keeps the business details card on the head office', async () => {
      const shop = await signUp();
      const other = await addBranch(shop, 'AND', { name: 'Andheri' });
      const before = as<{ business: Record<string, unknown> }>(
        await shop.owner.call('GET', '/settings'),
      );
      const saved = await shop.owner.call('PUT', '/settings/business', {
        ...before.business,
        branchName: 'Head shop',
        address: 'Main Road',
      });
      expect(saved.status).toBe(200);
      const listed = as<BranchView[]>(await shop.owner.call('GET', '/branches'));
      expect(listed.map((branch) => [branch.code, branch.name])).toEqual([
        ['HO', 'Head shop'],
        ['AND', other.name],
      ]);
    });
  });

  describe('two businesses', () => {
    it('never see or touch each other’s branches', async () => {
      const a = await signUp();
      const b = await signUp();
      const inA = await addBranch(a, 'AND');
      await addBranch(b, 'BND');
      const bList = as<BranchView[]>(await b.owner.call('GET', '/branches'));
      expect(bList.map((branch) => branch.code)).toEqual(['HO', 'BND']);
      expect((await b.owner.call('GET', '/branches/picker')).body).toHaveLength(2);
      expect(
        await b.owner.call('PUT', `/branches/${inA.id}`, branchBody('AND', { name: 'Mine now' })),
      ).toMatchObject({ status: 404, body: { code: 'not_found' } });
      expect(
        await b.owner.call('POST', `/branches/${inA.id}/archive`, { ownerPassword: PASSWORD }),
      ).toMatchObject({ status: 404 });
      expect(await b.owner.call('POST', `/branches/${inA.id}/restore`)).toMatchObject({
        status: 404,
      });
      // The same code in two businesses is fine.
      expect((await b.owner.call('POST', '/branches', branchBody('AND'))).status).toBe(201);
    });
  });

  describe('which branch a new computer is in (POST /login)', () => {
    it('does nothing new while the business has one branch', async () => {
      const shop = await signUp();
      const computer = browser();
      const login = await computer.call('POST', '/login', {
        email: shop.email,
        password: PASSWORD,
      });
      expect(login).toMatchObject({
        status: 200,
        body: { branch: { id: shop.headOfficeId, code: 'HO' }, branchCount: 1 },
      });
      expect((await deviceOf(computer))?.branchId).toBe(shop.headOfficeId);
    });

    it('asks the owner with 2 or more branches, then registers the computer there', async () => {
      const shop = await signUp();
      const andheri = await addBranch(shop, 'AND', { name: 'Andheri' });
      const computer = browser();
      const asked = await computer.call('POST', '/login', {
        email: shop.email,
        password: PASSWORD,
      });
      expect(asked).toMatchObject({
        status: 409,
        body: {
          code: 'choose_branch',
          branches: [
            { id: shop.headOfficeId, code: 'HO', name: expect.any(String) as unknown },
            { id: andheri.id, code: 'AND', name: 'Andheri' },
          ],
        },
      });
      // Nothing was started: no cookie, no computer.
      expect(asked.cookies).toEqual([]);
      const login = await computer.call('POST', '/login', {
        email: shop.email,
        password: PASSWORD,
        branchId: andheri.id,
      });
      expect(login).toMatchObject({
        status: 200,
        body: { branch: { id: andheri.id, code: 'AND', name: 'Andheri' }, branchCount: 2 },
      });
      expect((await deviceOf(computer))?.branchId).toBe(andheri.id);
      // The computer now knows its branch: the next login isn't asked.
      expect((await computer.call('POST', '/logout')).status).toBe(204);
      const again = await computer.call('POST', '/login', {
        email: shop.email,
        password: PASSWORD,
      });
      expect(again).toMatchObject({ status: 200, body: { branch: { code: 'AND' } } });
    });

    it('refuses a branch that is archived or isn’t the business’s', async () => {
      const shop = await signUp();
      const other = await signUp();
      const andheri = await addBranch(shop, 'AND');
      const thane = await addBranch(shop, 'THN');
      expect(
        (
          await shop.owner.call('POST', `/branches/${thane.id}/archive`, {
            ownerPassword: PASSWORD,
          })
        ).status,
      ).toBe(200);
      for (const branchId of [thane.id, other.headOfficeId]) {
        expect(
          await browser().call('POST', '/login', {
            email: shop.email,
            password: PASSWORD,
            branchId,
          }),
        ).toMatchObject({ status: 400, body: { fields: { branchId: 'invalid' } } });
      }
      // With one active branch left, a new computer needs no choice.
      expect(
        (
          await shop.owner.call('POST', `/branches/${andheri.id}/archive`, {
            ownerPassword: PASSWORD,
          })
        ).status,
      ).toBe(200);
      expect(
        await browser().call('POST', '/login', { email: shop.email, password: PASSWORD }),
      ).toMatchObject({ status: 200, body: { branch: { id: shop.headOfficeId } } });
    });

    it('shows the owner the branch count and staff no count', async () => {
      const shop = await signUp();
      const andheri = await addBranch(shop, 'AND');
      expect(await shop.owner.session()).toMatchObject({
        body: { branch: { code: 'HO' }, branchCount: 2 },
      });
      await addStaff(shop, 'cashier3');
      const staff = atComputer(shop.owner);
      await staff.call('POST', '/login/staff', { username: 'cashier3', password: STAFF_PASSWORD });
      const view = (await staff.session()).body;
      expect(view).toMatchObject({ branch: { id: shop.headOfficeId, code: 'HO' } });
      expect(view).not.toHaveProperty('branchCount');
      // An archived branch isn't counted.
      await shop.owner.call('POST', `/branches/${andheri.id}/archive`, { ownerPassword: PASSWORD });
      expect(await shop.owner.session()).toMatchObject({ body: { branchCount: 1 } });
    });
  });

  describe('archiving a branch', () => {
    it('never archives the head office', async () => {
      const shop = await signUp();
      await addBranch(shop, 'AND');
      expect(
        await shop.owner.call('POST', `/branches/${shop.headOfficeId}/archive`, {
          ownerPassword: PASSWORD,
        }),
      ).toMatchObject({ status: 409, body: { code: 'head_office' } });
      expect(await entries(shop.businessId, 'branch.archived')).toEqual([]);
    });

    it('needs the owner’s password', async () => {
      const shop = await signUp();
      const andheri = await addBranch(shop, 'AND');
      expect(
        await shop.owner.call('POST', `/branches/${andheri.id}/archive`, {
          ownerPassword: 'wrong wrong wrong',
        }),
      ).toMatchObject({ status: 401, body: { code: 'wrong_password' } });
    });

    it('is refused while active staff call the branch home, with their count', async () => {
      const shop = await signUp();
      const andheri = await addBranch(shop, 'AND');
      const ramesh = await addStaff(shop, 'ramesh', andheri.id);
      await addStaff(shop, 'suresh', andheri.id);
      const archive = () =>
        shop.owner.call('POST', `/branches/${andheri.id}/archive`, { ownerPassword: PASSWORD });
      expect(await archive()).toMatchObject({
        status: 409,
        body: { code: 'branch_in_use', staff: 2 },
      });
      // A deactivated login no longer counts, and a moved one doesn't either.
      expect((await shop.owner.call('POST', `/staff/${ramesh.id}/deactivate`, {})).status).toBe(
        200,
      );
      expect(await archive()).toMatchObject({ status: 409, body: { staff: 1 } });
      const suresh = as<StaffView[]>(await shop.owner.call('GET', '/staff')).find(
        (staff) => staff.username === 'suresh',
      );
      expect(
        (
          await shop.owner.call('PUT', `/staff/${suresh?.id ?? ''}`, {
            name: 'SURESH',
            username: 'suresh',
            homeBranchId: shop.headOfficeId,
          })
        ).status,
      ).toBe(200);
      expect(await archive()).toMatchObject({ status: 200, body: { archived: true } });
    });

    it('forgets its computers, ends the sessions on them and keeps its stock and history', async () => {
      const shop = await signUp();
      const andheri = await addBranch(shop, 'AND');
      const computer = await computerAt(shop, andheri.id);
      const item = await goodsItem(shop);
      expect((await openStock(computer, item.id, 5_000)).status).toBe(201);
      const archived = await shop.owner.call('POST', `/branches/${andheri.id}/archive`, {
        ownerPassword: PASSWORD,
      });
      expect(archived).toMatchObject({
        status: 200,
        body: { archived: true, computers: 0 },
      });
      // The computer was logged out and forgotten.
      expect((await computer.call('GET', `/items/${item.id}`)).status).toBe(401);
      expect(
        (
          await atComputer(computer).call('POST', '/login/staff', {
            username: 'nobody',
            password: 'nothing',
          })
        ).status,
      ).toBe(401);
      const rows = await query<{ revoked_at: Date | null; end_reasons: string[] }>(
        `select d.revoked_at,
                coalesce(array_agg(s.end_reason) filter (where s.id is not null), '{}') as end_reasons
           from devices d left join sessions s on s.device_id = d.id
          where d.business_id = $1 and d.branch_id = $2 group by d.id`,
        [shop.businessId, andheri.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.revoked_at).toBeInstanceOf(Date);
      expect(rows[0]?.end_reasons).toEqual(['device_forgotten']);
      expect(await entries(shop.businessId, 'branch.archived')).toHaveLength(1);
      expect(await entries(shop.businessId, 'device.revoked')).toHaveLength(1);
      // Stock and history stay readable.
      const stock = as<ItemStockView>(
        await shop.owner.call('GET', `/items/${item.id}/stock?branch=${andheri.id}`),
      );
      expect(stock.branches.map((row) => [row.branchId, row.quantity])).toEqual([
        [andheri.id, 5_000],
      ]);
      const history = as<MovementPage>(
        await shop.owner.call('GET', `/items/${item.id}/stock/movements?branch=${andheri.id}`),
      );
      expect(history.movements).toHaveLength(1);
      // Archiving again changes and logs nothing.
      expect(
        (
          await shop.owner.call('POST', `/branches/${andheri.id}/archive`, {
            ownerPassword: PASSWORD,
          })
        ).status,
      ).toBe(200);
      expect(await entries(shop.businessId, 'branch.archived')).toHaveLength(1);
      // The list hides it unless asked, then shows it archived.
      const visible = as<BranchView[]>(await shop.owner.call('GET', '/branches'));
      expect(visible.map((branch) => branch.code)).toEqual(['HO']);
      const all = as<BranchView[]>(await shop.owner.call('GET', '/branches?includeArchived=true'));
      expect(all.map((branch) => [branch.code, branch.archived])).toEqual([
        ['HO', false],
        ['AND', true],
      ]);
    });

    it('can be undone, and a staff login can no longer be given an archived home', async () => {
      const shop = await signUp();
      const andheri = await addBranch(shop, 'AND');
      await shop.owner.call('POST', `/branches/${andheri.id}/archive`, { ownerPassword: PASSWORD });
      const login = await shop.owner.call('POST', '/staff', {
        name: 'RAMESH',
        username: 'ramesh',
        password: STAFF_PASSWORD,
        homeBranchId: andheri.id,
        ownerPassword: PASSWORD,
      });
      expect(login).toMatchObject({ status: 400, body: { fields: { homeBranchId: 'invalid' } } });
      const restored = await shop.owner.call('POST', `/branches/${andheri.id}/restore`);
      expect(restored).toMatchObject({ status: 200, body: { archived: false, code: 'AND' } });
      expect(await entries(shop.businessId, 'branch.restored')).toHaveLength(1);
      // Restoring a live branch again changes and logs nothing.
      await shop.owner.call('POST', `/branches/${andheri.id}/restore`);
      expect(await entries(shop.businessId, 'branch.restored')).toHaveLength(1);
      // Its forgotten computers stay forgotten: the owner logs in there again.
      expect(await addStaff(shop, 'ramesh', andheri.id)).toMatchObject({
        homeBranchId: andheri.id,
      });
    });

    it('won’t reactivate a login whose home branch is archived', async () => {
      const shop = await signUp();
      const andheri = await addBranch(shop, 'AND');
      const ramesh = await addStaff(shop, 'ramesh', andheri.id);
      await shop.owner.call('POST', `/staff/${ramesh.id}/deactivate`, {});
      await shop.owner.call('POST', `/branches/${andheri.id}/archive`, { ownerPassword: PASSWORD });
      expect(
        await shop.owner.call('POST', `/staff/${ramesh.id}/reactivate`, {
          ownerPassword: PASSWORD,
        }),
      ).toMatchObject({ status: 409, body: { code: 'home_branch_archived' } });
    });
  });

  describe('moving a computer (PUT /devices/:id/branch)', () => {
    it('changes its branch, ends the sessions on it and logs device.moved', async () => {
      const shop = await signUp();
      const andheri = await addBranch(shop, 'AND');
      const computer = await computerAt(shop, andheri.id);
      const device = await deviceOf(computer);
      await addStaff(shop, 'cashier4', andheri.id);
      const cashier = atComputer(computer);
      expect(
        (
          await cashier.call('POST', '/login/staff', {
            username: 'cashier4',
            password: STAFF_PASSWORD,
          })
        ).status,
      ).toBe(200);
      const moved = await shop.owner.call('PUT', `/devices/${device?.id ?? ''}/branch`, {
        branchId: shop.headOfficeId,
        ownerPassword: PASSWORD,
      });
      expect(moved).toMatchObject({
        status: 200,
        body: { branchId: shop.headOfficeId, branchCode: 'HO' },
      });
      // Both sessions on that computer ended.
      expect((await computer.call('GET', '/items')).status).toBe(401);
      expect((await cashier.call('GET', '/items')).status).toBe(401);
      const ended = await query<{ end_reason: string }>(
        `select end_reason from sessions where business_id = $1 and device_id = $2 order by id`,
        [shop.businessId, device?.id],
      );
      expect(ended.map((row) => row.end_reason)).toEqual(['device_moved', 'device_moved']);
      expect(await entries(shop.businessId, 'device.moved')).toEqual([
        expect.objectContaining({
          entity_id: device?.id,
          before: { branchId: andheri.id },
          after: { branchId: shop.headOfficeId },
        }),
      ]);
      // The login starts again at the computer's new branch, and staff of Andheri alone are refused.
      expect(
        await computer.call('POST', '/login', { email: shop.email, password: PASSWORD }),
      ).toMatchObject({ status: 200, body: { branch: { code: 'HO' } } });
      expect(await loginStaff(computer, 'cashier4')).toMatchObject({
        status: 403,
        body: { code: 'wrong_branch' },
      });
    });

    it('moving to the branch it is in changes and ends nothing', async () => {
      const shop = await signUp();
      const device = await deviceOf(shop.owner);
      const same = await shop.owner.call('PUT', `/devices/${device?.id ?? ''}/branch`, {
        branchId: shop.headOfficeId,
        ownerPassword: PASSWORD,
      });
      expect(same.status).toBe(200);
      expect((await shop.owner.call('GET', '/items')).status).toBe(200);
      expect(await entries(shop.businessId, 'device.moved')).toEqual([]);
    });

    it('needs the owner’s password, a live branch of this business and a remembered computer', async () => {
      const shop = await signUp();
      const other = await signUp();
      const andheri = await addBranch(shop, 'AND');
      const archived = await addBranch(shop, 'OLD');
      await shop.owner.call('POST', `/branches/${archived.id}/archive`, {
        ownerPassword: PASSWORD,
      });
      const device = await deviceOf(shop.owner);
      const path = `/devices/${device?.id ?? ''}/branch`;
      expect(
        await shop.owner.call('PUT', path, {
          branchId: andheri.id,
          ownerPassword: 'wrong wrong wrong',
        }),
      ).toMatchObject({ status: 401, body: { code: 'wrong_password' } });
      for (const branchId of [archived.id, other.headOfficeId]) {
        expect(
          await shop.owner.call('PUT', path, { branchId, ownerPassword: PASSWORD }),
        ).toMatchObject({ status: 400, body: { fields: { branchId: 'invalid' } } });
      }
      const foreignDevice = await deviceOf(other.owner);
      expect(
        await shop.owner.call('PUT', `/devices/${foreignDevice?.id ?? ''}/branch`, {
          branchId: andheri.id,
          ownerPassword: PASSWORD,
        }),
      ).toMatchObject({ status: 404 });
      expect(await entries(shop.businessId, 'device.moved')).toEqual([]);
    });

    it('logs the owner out of the computer they moved, so the next request starts again', async () => {
      const shop = await signUp();
      const andheri = await addBranch(shop, 'AND');
      const device = await deviceOf(shop.owner);
      const moved = await shop.owner.call('PUT', `/devices/${device?.id ?? ''}/branch`, {
        branchId: andheri.id,
        ownerPassword: PASSWORD,
      });
      expect(moved.status).toBe(200);
      expect((await shop.owner.session()).body).toMatchObject({ state: 'none' });
    });
  });

  describe('staff and other branches (PUT /staff/:id/branches)', () => {
    it('refuses a login on a computer at a branch it may not work at, until the owner ticks it', async () => {
      const shop = await signUp();
      const andheri = await addBranch(shop, 'AND', { name: 'Andheri' });
      const staff = await addStaff(shop, 'ramesh');
      const computer = await computerAt(shop, andheri.id);
      expect(await loginStaff(computer, 'ramesh')).toMatchObject({
        status: 403,
        body: { code: 'wrong_branch', branchName: 'Andheri' },
      });
      const ticked = await setExtraBranches(shop, staff.id, [andheri.id]);
      expect(ticked).toMatchObject({
        status: 200,
        body: { homeBranchId: shop.headOfficeId, extraBranchIds: [andheri.id] },
      });
      const login = await loginStaff(computer, 'ramesh');
      expect(login).toMatchObject({
        status: 200,
        body: { branch: { id: andheri.id, code: 'AND' } },
      });
      expect(login.body).not.toHaveProperty('branchCount');
    });

    it('reaches a logged-in cashier on the next request after unticking (same cookie)', async () => {
      const shop = await signUp();
      const andheri = await addBranch(shop, 'AND');
      const staff = await addStaff(shop, 'ramesh');
      const computer = await computerAt(shop, andheri.id);
      await setExtraBranches(shop, staff.id, [andheri.id]);
      const cashier = atComputer(computer);
      expect(
        (
          await cashier.call('POST', '/login/staff', {
            username: 'ramesh',
            password: STAFF_PASSWORD,
          })
        ).status,
      ).toBe(200);
      expect((await cashier.call('GET', '/items')).status).toBe(200);
      expect((await setExtraBranches(shop, staff.id, [])).status).toBe(200);
      expect(await cashier.call('GET', '/items')).toMatchObject({
        status: 401,
        body: { code: 'session_ended' },
      });
      const [session] = await query<{ end_reason: string }>(
        `select end_reason from sessions where business_id = $1 and user_id = $2`,
        [shop.businessId, staff.id],
      );
      expect(session?.end_reason).toBe('branch_removed');
      expect(await loginStaff(computer, 'ramesh')).toMatchObject({
        status: 403,
        body: { code: 'wrong_branch' },
      });
    });

    it('also ends a session when the owner moves the login’s home branch away', async () => {
      const shop = await signUp();
      const andheri = await addBranch(shop, 'AND');
      const staff = await addStaff(shop, 'ramesh', andheri.id);
      const computer = await computerAt(shop, andheri.id);
      const cashier = atComputer(computer);
      await cashier.call('POST', '/login/staff', { username: 'ramesh', password: STAFF_PASSWORD });
      expect((await cashier.call('GET', '/items')).status).toBe(200);
      await shop.owner.call('PUT', `/staff/${staff.id}`, {
        name: 'RAMESH',
        username: 'ramesh',
        homeBranchId: shop.headOfficeId,
      });
      expect((await cashier.call('GET', '/items')).status).toBe(401);
    });

    it('logs one entry per change, and none when the list is the same', async () => {
      const shop = await signUp();
      const andheri = await addBranch(shop, 'AND');
      const thane = await addBranch(shop, 'THN');
      const staff = await addStaff(shop, 'ramesh');
      await setExtraBranches(shop, staff.id, [andheri.id, thane.id]);
      await setExtraBranches(shop, staff.id, [thane.id, andheri.id]);
      await setExtraBranches(shop, staff.id, [thane.id]);
      const log = await entries(shop.businessId, 'staff.branches_changed');
      expect(log.map((row) => [row.before, row.after])).toEqual([
        [{ extraBranchIds: [] }, { extraBranchIds: [andheri.id, thane.id].sort() }],
        [{ extraBranchIds: [andheri.id, thane.id].sort() }, { extraBranchIds: [thane.id] }],
      ]);
      expect(log[0]).toMatchObject({ entity_id: staff.id, branch_id: shop.headOfficeId });
      const listed = as<StaffView[]>(await shop.owner.call('GET', '/staff'));
      expect(listed[0]?.extraBranchIds).toEqual([thane.id]);
      // Rows are removed when unticked: the only delete there is.
      const rows = await query<{ n: number }>(
        'select count(*)::int as n from staff_branches where user_id = $1',
        [staff.id],
      );
      expect(rows[0]?.n).toBe(1);
    });

    it('needs the owner’s password, and refuses the home branch, archived and foreign branches', async () => {
      const shop = await signUp();
      const other = await signUp();
      const andheri = await addBranch(shop, 'AND');
      const archived = await addBranch(shop, 'OLD');
      await shop.owner.call('POST', `/branches/${archived.id}/archive`, {
        ownerPassword: PASSWORD,
      });
      const staff = await addStaff(shop, 'ramesh');
      expect(
        await setExtraBranches(shop, staff.id, [andheri.id], 'wrong wrong wrong'),
      ).toMatchObject({
        status: 401,
        body: { code: 'wrong_password' },
      });
      for (const ids of [
        [shop.headOfficeId],
        [archived.id],
        [other.headOfficeId],
        [andheri.id, andheri.id],
      ]) {
        expect(await setExtraBranches(shop, staff.id, ids), JSON.stringify(ids)).toMatchObject({
          status: 400,
          body: { code: 'invalid_body', fields: { branchIds: expect.any(String) as unknown } },
        });
      }
      expect(
        await setExtraBranches(shop, '0190f0f0-0000-7000-8000-0000000000aa', []),
      ).toMatchObject({
        status: 404,
      });
      expect(await entries(shop.businessId, 'staff.branches_changed')).toEqual([]);
    });
  });

  describe('?branch= on the stock reads', () => {
    async function twoBranchShop() {
      const shop = await signUp();
      const andheri = await addBranch(shop, 'AND', { name: 'Andheri' });
      const counter = await computerAt(shop, andheri.id);
      const item = await goodsItem(shop);
      // 2 kg at the head office (the owner's first computer), 5 kg at Andheri.
      expect((await openStock(shop.owner, item.id, 2_000)).status).toBe(201);
      expect((await openStock(counter, item.id, 5_000)).status).toBe(201);
      return { shop, andheri, counter, item };
    }

    it('lets the owner choose one branch or add them all up on the items list', async () => {
      const { shop, andheri, item } = await twoBranchShop();
      const stockOf = async (suffix: string) =>
        as<ItemPage>(await shop.owner.call('GET', `/items${suffix}`)).items.find(
          (row) => row.id === item.id,
        )?.stock;
      // Without it: the computer's own branch.
      expect(await stockOf('')).toBe(2_000);
      expect(await stockOf(`?branch=${andheri.id}`)).toBe(5_000);
      expect(await stockOf(`?branch=${shop.headOfficeId}`)).toBe(2_000);
      expect(await stockOf('?branch=all')).toBe(7_000);
    });

    it('marks an item low over all branches when any branch is at its level', async () => {
      const { shop, andheri } = await twoBranchShop();
      const item = await goodsItem(shop, {
        levels: [{ branchId: andheri.id, lowStockLevel: 1_000 }],
      });
      expect((await openStock(shop.owner, item.id, 9_000)).status).toBe(201);
      const lowAt = async (suffix: string) =>
        as<ItemPage>(await shop.owner.call('GET', `/items?low=true${suffix}`)).items.map(
          (row) => row.id,
        );
      // Andheri holds none of this item and its level is 1: low there, and so over all branches.
      expect(await lowAt(`&branch=${andheri.id}`)).toEqual([item.id]);
      expect(await lowAt('&branch=all')).toEqual([item.id]);
      expect(await lowAt('')).toEqual([]);
    });

    it('ignores ?branch= for staff: they always get the branch they are logged in at', async () => {
      const { shop, andheri, item } = await twoBranchShop();
      await addStaff(shop, 'ramesh');
      const cashier = atComputer(shop.owner);
      await cashier.call('POST', '/login/staff', { username: 'ramesh', password: STAFF_PASSWORD });
      const stockOf = async (suffix: string) =>
        as<ItemPage>(await cashier.call('GET', `/items${suffix}`)).items.find(
          (row) => row.id === item.id,
        )?.stock;
      expect(await stockOf('')).toBe(2_000);
      expect(await stockOf(`?branch=${andheri.id}`)).toBe(2_000);
      expect(await stockOf('?branch=all')).toBe(2_000);
      const movements = async (suffix: string) =>
        as<MovementPage>(await cashier.call('GET', `/items/${item.id}/stock/movements${suffix}`))
          .movements;
      expect((await movements(`?branch=${andheri.id}`)).map((row) => row.branchId)).toEqual([
        shop.headOfficeId,
      ]);
      expect(await movements('?branch=all')).toHaveLength(1);
      const view = as<ItemStockView>(
        await cashier.call('GET', `/items/${item.id}/stock?branch=${andheri.id}`),
      );
      expect(view.branches.map((row) => row.branchId)).toEqual([shop.headOfficeId]);
    });

    it('shows the owner every branch on the item’s stock, or just the one asked for', async () => {
      const { shop, andheri, item } = await twoBranchShop();
      const rows = async (suffix: string) =>
        as<ItemStockView>(await shop.owner.call('GET', `/items/${item.id}/stock${suffix}`))
          .branches;
      expect((await rows('')).map((row) => [row.branchId, row.quantity]).sort()).toEqual(
        [
          [shop.headOfficeId, 2_000],
          [andheri.id, 5_000],
        ].sort(),
      );
      expect((await rows('?branch=all')).map((row) => row.quantity).sort()).toEqual([2_000, 5_000]);
      expect(
        (await rows(`?branch=${andheri.id}`)).map((row) => [row.branchId, row.quantity]),
      ).toEqual([[andheri.id, 5_000]]);
    });

    it('reads the history of one branch or of all', async () => {
      const { shop, andheri, item } = await twoBranchShop();
      const branches = async (suffix: string) =>
        as<MovementPage>(
          await shop.owner.call('GET', `/items/${item.id}/stock/movements${suffix}`),
        ).movements.map((row) => row.branchId);
      expect(await branches('')).toEqual([shop.headOfficeId]);
      expect(await branches(`?branch=${andheri.id}`)).toEqual([andheri.id]);
      expect((await branches('?branch=all')).sort()).toEqual(
        [andheri.id, shop.headOfficeId].sort(),
      );
    });

    it('refuses a branch that is neither an id nor all', async () => {
      const shop = await signUp();
      expect(await shop.owner.call('GET', '/items?branch=nope')).toMatchObject({
        status: 400,
        body: { fields: { branch: 'invalid' } },
      });
    });

    it('shows another business’s branch id as nothing, never its stock', async () => {
      const a = await signUp();
      const b = await signUp();
      const item = await goodsItem(a);
      await openStock(a.owner, item.id, 3_000);
      const rows = as<ItemPage>(await a.owner.call('GET', `/items?branch=${b.headOfficeId}`)).items;
      expect(rows.find((row) => row.id === item.id)?.stock).toBe(0);
    });
  });
});
