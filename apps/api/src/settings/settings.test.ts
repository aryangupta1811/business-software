// Integration test on a throwaway PostgreSQL (ADR 0013), over real HTTP: the owner reads and
// saves the business's settings, each save logged with only what changed.
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { createDatabase, type Database } from '@business-software/db';
import { startTestDatabase, type TestDatabase } from '@business-software/db/testing';
import { PERMISSIONS } from '@business-software/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { Caller, SessionResolver } from '../http/session.js';

// Tests say who is calling in a header; P1.4's resolver reads a session cookie instead.
const headerSessions: SessionResolver = {
  resolve(request: IncomingMessage) {
    const header = request.headers['x-test-caller'];
    return Promise.resolve(typeof header === 'string' ? (JSON.parse(header) as Caller) : null);
  },
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

const business = {
  businessName: 'Sharma Kirana',
  businessType: 'kirana',
  phone: '9111111111',
  gstStatus: 'regular',
  pan: 'AAPFU0939F',
  ownerName: 'R. Sharma',
  branchName: 'Market Road',
  address: 'Shop 4\nMarket Road',
  pinCode: '411001',
  stateCode: '27',
  gstin: '27AAPFU0939F1ZV',
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
    return { businessId, userId: rows[0]?.id ?? '', permissions: PERMISSIONS };
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
      },
    });
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
        pan: 'AAPFU0939F',
        ownerName: 'R. Sharma',
        branchName: 'Market Road',
        address: 'Shop 4\nMarket Road',
        pinCode: '411001',
        gstin: '27AAPFU0939F1ZV',
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
    expect((response.body as { features: string[] }).features).toEqual(['mrp', 'batches']);
    expect((await updates(a.businessId)).at(-1)).toMatchObject({
      before: { features: ['loose_weight', 'expiry_dates', 'udhaar_prominent'] },
      after: { features: ['mrp', 'batches'] },
    });
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

  it('keeps businesses apart', async () => {
    const seen = (await call('GET', '/settings', b)).body as { business: { businessName: string } };
    expect(seen.business.businessName).toBe('Shop B');
    expect(await updates(b.businessId)).toEqual([]);
  });

  it.each([
    ['/settings/business', { ...business, stateCode: '29' }, { gstin: 'state_mismatch' }],
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
  });
});
