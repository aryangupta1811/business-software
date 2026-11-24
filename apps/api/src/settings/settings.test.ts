// Integration test on a throwaway PostgreSQL (ADR 0013), over real HTTP: the owner reads and
// saves the business's settings, each save logged with only what changed.
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { createDatabase, type Database } from '@business-software/db';
import { startTestDatabase, type TestDatabase } from '@business-software/db/testing';
import { businessDate, financialYear, PERMISSIONS } from '@business-software/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { hashToken } from '../auth/tokens.js';
import type { Caller, SessionResolver } from '../http/session.js';

// Tests say who is calling in a header, so these tests can use any caller; the real resolver
// reads the session cookie (auth/session.test.ts).
const CSRF = 'csrf-token-for-tests';
const headerSessions: SessionResolver = {
  resolve(request: IncomingMessage) {
    const header = request.headers['x-test-caller'];
    return Promise.resolve(typeof header === 'string' ? (JSON.parse(header) as Caller) : null);
  },
  recordActivity: () => Promise.resolve(),
};

const signupBody = (name: string, email: string) => ({
  businessName: name,
  businessType: 'kirana',
  phone: '9111111111',
  stateCode: '27',
  gstStatus: 'regular',
  email,
  password: 'correct horse battery',
});

const thisYear = () => financialYear(businessDate(new Date()));

const business = {
  businessName: 'Sharma Kirana',
  businessType: 'kirana',
  phone: '9111111111',
  gstStatus: 'regular',
  pan: 'ABCDE1234F',
  ownerName: 'R. Sharma',
  branchName: 'Market Road',
  address: 'Shop 4\nMarket Road',
  pinCode: '411001',
  stateCode: '27',
  gstin: '27ABCDE1234F1Z0',
  drugLicence: null,
  fssai: '12345678901234',
};

describe('settings', () => {
  let server: TestDatabase;
  let admin: Database;
  let app: INestApplication;
  let base: string;
  let a: Caller;
  let b: Caller;

  async function call(
    method: string,
    path: string,
    caller: Caller | null,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': CSRF,
        ...(caller && { 'x-test-caller': JSON.stringify(caller) }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }

  async function owner(name: string, email: string): Promise<Caller> {
    const created = await call('POST', '/signup', null, signupBody(name, email));
    const { businessId } = created.body as { businessId: string };
    const { rows } = await admin.pool.query<{ id: string }>(
      "select id from users where business_id = $1 and role = 'owner'",
      [businessId],
    );
    return {
      businessId,
      userId: rows[0]?.id ?? '',
      sessionId: '0190f0f0-0000-7000-8000-0000000000c1',
      branchId: '0190f0f0-0000-7000-8000-0000000000d1',
      role: 'owner',
      permissions: PERMISSIONS,
      locked: false,
      csrfHash: hashToken(CSRF),
    };
  }

  const updates = async (businessId: string) => {
    const { rows } = await admin.pool.query<{
      actor_id: string;
      before: unknown;
      after: unknown;
    }>(
      "select actor_id, before, after from entry_log where business_id = $1 and action = 'business.updated' order by id",
      [businessId],
    );
    return rows;
  };

  beforeAll(async () => {
    server = await startTestDatabase();
    admin = createDatabase(server.adminUrl, () => undefined);
    app = await createApp(
      { databaseUrl: server.runtimeUrl, host: '127.0.0.1', port: 0, jsonLogs: false },
      { sessions: headerSessions },
    );
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
    base = `http://127.0.0.1:${String(port)}/api`;
    a = await owner('Shop A', 'a@example.com');
    b = await owner('Shop B', 'b@example.com');
  });

  afterAll(async () => {
    await app.close();
    await admin.close();
    await server.stop();
  });

  it('shows the business as signup left it', async () => {
    expect(await call('GET', '/settings', a)).toEqual({
      status: 200,
      body: {
        business: {
          businessName: 'Shop A',
          businessType: 'kirana',
          phone: '9111111111',
          gstStatus: 'regular',
          pan: null,
          ownerName: null,
          branchName: 'Shop A',
          address: null,
          pinCode: null,
          stateCode: '27',
          gstin: null,
          drugLicence: null,
          fssai: null,
        },
        features: ['loose_weight', 'expiry_dates', 'udhaar_prominent'],
        security: { ownerLockMinutes: 5, staffIdleMinutes: 30 },
        stock: { negativeStock: 'warn' },
        alerts: { types: ['low_stock', 'out_of_stock'] },
        invoices: { invoicePrefix: null },
        printing: { billLanguage: 'en', footerNote: null },
        // No bill yet in this branch's counter: the first number is 1.
        nextInvoice: { financialYear: thisYear(), sequence: 1 },
      },
    });
  });

  it("shows the next invoice number from the caller's own branch counter", async () => {
    const { rows } = await admin.pool.query<{ id: string }>(
      'select id from branches where business_id = $1',
      [a.businessId],
    );
    const here = { ...a, branchId: rows[0]?.id ?? '' };
    await admin.pool.query(
      `insert into invoice_counters (business_id, branch_id, financial_year, last_number)
       values ($1, $2, $3, 41), ($1, $2, '2001-02', 900)`,
      [a.businessId, here.branchId, thisYear()],
    );
    const view = (await call('GET', '/settings', here)).body as { nextInvoice: unknown };
    // 41 bills so far this year; an old year's counter and the other business don't count.
    expect(view.nextInvoice).toEqual({ financialYear: thisYear(), sequence: 42 });
    const other = (await call('GET', '/settings', b)).body as { nextInvoice: unknown };
    expect(other.nextInvoice).toEqual({ financialYear: thisYear(), sequence: 1 });
    // A save answers with it too (this one changes nothing, so it writes no log entry).
    const saved = (await call('PUT', '/settings/stock', here, { negativeStock: 'warn' })).body;
    expect((saved as { nextInvoice: unknown }).nextInvoice).toEqual(view.nextInvoice);
  });

  it('saves the business details and logs only what changed', async () => {
    expect(await call('PUT', '/settings/business', a, business)).toEqual({
      status: 200,
      body: expect.objectContaining({ business }) as unknown,
    });
    const [entry] = await updates(a.businessId);
    expect(entry).toEqual({
      actor_id: a.userId,
      before: {
        businessName: 'Shop A',
        pan: null,
        ownerName: null,
        branchName: 'Shop A',
        address: null,
        pinCode: null,
        gstin: null,
        fssai: null,
      },
      after: {
        businessName: 'Sharma Kirana',
        pan: 'ABCDE1234F',
        ownerName: 'R. Sharma',
        branchName: 'Market Road',
        address: 'Shop 4\nMarket Road',
        pinCode: '411001',
        gstin: '27ABCDE1234F1Z0',
        fssai: '12345678901234',
      },
    });
  });

  it('writes nothing when nothing changed', async () => {
    const before = (await updates(a.businessId)).length;
    expect((await call('PUT', '/settings/business', a, business)).status).toBe(200);
    expect(await updates(a.businessId)).toHaveLength(before);
  });

  it('saves the feature switches', async () => {
    const response = await call('PUT', '/settings/features', a, { features: ['mrp', 'batches'] });
    expect(response.status).toBe(200);
    // Stored in the one fixed feature order, whatever order they came in.
    expect((response.body as { features: string[] }).features).toEqual(['batches', 'mrp']);
    expect((await updates(a.businessId)).at(-1)).toMatchObject({
      before: { features: ['loose_weight', 'expiry_dates', 'udhaar_prominent'] },
      after: { features: ['batches', 'mrp'] },
    });
  });

  it('writes nothing when only the order of the features changed', async () => {
    await call('PUT', '/settings/features', a, { features: ['batches', 'mrp'] });
    const before = (await updates(a.businessId)).length;
    const response = await call('PUT', '/settings/features', a, { features: ['mrp', 'batches'] });
    expect(response.status).toBe(200);
    expect(await updates(a.businessId)).toHaveLength(before);
  });

  it('saves the lock times (#21, #29)', async () => {
    const response = await call('PUT', '/settings/security', a, {
      ownerLockMinutes: 10,
      staffIdleMinutes: 120,
    });
    expect((response.body as { security: unknown }).security).toEqual({
      ownerLockMinutes: 10,
      staffIdleMinutes: 120,
    });
    expect((await updates(a.businessId)).at(-1)).toMatchObject({
      before: { ownerLockMinutes: 5, staffIdleMinutes: 30 },
      after: { ownerLockMinutes: 10, staffIdleMinutes: 120 },
    });
  });

  it('saves the bill language and footer note, and logs them as a printing change', async () => {
    const saved = await call('PUT', '/settings/printing', a, {
      billLanguage: 'hi',
      footerNote: '  Goods once sold will not be taken back.  ',
    });
    expect((saved.body as { printing: unknown }).printing).toEqual({
      billLanguage: 'hi',
      footerNote: 'Goods once sold will not be taken back.',
    });
    const { rows } = await admin.pool.query<{ before: unknown; after: unknown }>(
      "select before, after from entry_log where business_id = $1 and action = 'settings.printing_changed'",
      [a.businessId],
    );
    expect(rows).toEqual([
      {
        before: { billLanguage: 'en', footerNote: null },
        after: { billLanguage: 'hi', footerNote: 'Goods once sold will not be taken back.' },
      },
    ]);
  });

  it('writes nothing when the printing settings did not change, and clears the note when blank', async () => {
    const count = async () =>
      (
        await admin.pool.query<{ n: string }>(
          "select count(*) as n from entry_log where business_id = $1 and action = 'settings.printing_changed'",
          [a.businessId],
        )
      ).rows[0]?.n;
    const before = await count();
    await call('PUT', '/settings/printing', a, {
      billLanguage: 'hi',
      footerNote: 'Goods once sold will not be taken back.',
    });
    expect(await count()).toBe(before);
    const cleared = await call('PUT', '/settings/printing', a, {
      billLanguage: 'hi',
      footerNote: '   ',
    });
    expect((cleared.body as { printing: { footerNote: null } }).printing.footerNote).toBeNull();
  });

  it('refuses a bad language or a footer note over 200 characters', async () => {
    const language = await call('PUT', '/settings/printing', a, {
      billLanguage: 'fr',
      footerNote: null,
    });
    expect(language.status).toBe(400);
    const long = await call('PUT', '/settings/printing', a, {
      billLanguage: 'en',
      footerNote: 'x'.repeat(201),
    });
    expect(long.status).toBe(400);
    expect((await call('GET', '/settings', a)).body).toMatchObject({
      printing: { billLanguage: 'hi' },
    });
  });

  it("keeps one business's printing settings out of another's", async () => {
    expect((await call('GET', '/settings', b)).body).toMatchObject({
      printing: { billLanguage: 'en', footerNote: null },
    });
  });

  it('keeps businesses apart', async () => {
    const seen = (await call('GET', '/settings', b)).body as { business: { businessName: string } };
    expect(seen.business.businessName).toBe('Shop B');
    expect(await updates(b.businessId)).toEqual([]);
  });

  it.each([
    ['/settings/business', { ...business, stateCode: '29' }, { gstin: 'state_mismatch' }],
    // Module 00 #36 (G6).
    ['/settings/business', { ...business, gstStatus: 'unregistered' }, { gstin: 'not_registered' }],
    [
      '/settings/security',
      { ownerLockMinutes: 31, staffIdleMinutes: 30 },
      { ownerLockMinutes: 'too_big' },
    ],
    ['/settings/features', { features: ['teleport'] }, { 'features.0': 'invalid' }],
  ])('answers 400 on %s with a bad value', async (path, body, fields) => {
    expect(await call('PUT', path, a, body)).toEqual({
      status: 400,
      body: { code: 'invalid_body', fields },
    });
  });

  it.each([
    ['GET', '/settings', undefined],
    ['PUT', '/settings/business', business],
    ['PUT', '/settings/features', { features: [] }],
    ['PUT', '/settings/security', { ownerLockMinutes: 5, staffIdleMinutes: 30 }],
  ])('answers 401 to %s %s with no session', async (method, path, body) => {
    expect(await call(method, path, null, body)).toEqual({
      status: 401,
      body: { code: 'not_logged_in' },
    });
  });

  it('answers 403 to a caller who may only view', async () => {
    const viewer = { ...b, permissions: ['settings.view' as const] };
    expect((await call('GET', '/settings', viewer)).status).toBe(200);
    expect((await call('PUT', '/settings/features', viewer, { features: [] })).status).toBe(403);
    expect(
      (await call('PUT', '/settings/printing', viewer, { billLanguage: 'en', footerNote: null }))
        .status,
    ).toBe(403);
  });
});
