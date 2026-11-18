// Integration test on a throwaway PostgreSQL (ADR 0013), over real HTTP: signup creates the
// business, its first branch, the owner and a recovery key together, or nothing at all.
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { INestApplication, LoggerService } from '@nestjs/common';
import { createDatabase, type Database } from '@business-software/db';
import { startTestDatabase, type TestDatabase } from '@business-software/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { verifyPassword } from '../auth/password.js';
import { readRecoveryKey } from './recovery-key.js';

// Nothing listens on port 1, so connecting fails at once.
const UNREACHABLE_URL = 'postgresql://app_runtime:x@127.0.0.1:1/business_software';

const signup = {
  businessName: 'Sharma Kirana',
  businessType: 'kirana',
  phone: '+91 91111 11111',
  stateCode: '27',
  gstStatus: 'regular',
  email: 'Owner@Example.com',
  password: 'correct horse battery',
};

/** Keeps every log line, so a test can read what a failure wrote. */
class LogCapture implements LoggerService {
  readonly lines: string[] = [];
  log(message: unknown) {
    this.lines.push(String(message));
  }
  error(message: unknown) {
    this.lines.push(String(message));
  }
  warn(message: unknown) {
    this.lines.push(String(message));
  }
}

async function startApp(databaseUrl: string, logger: LoggerService | false = false) {
  const app = await createApp({ databaseUrl, host: '127.0.0.1', port: 0, jsonLogs: false });
  app.useLogger(logger);
  await app.listen(0, '127.0.0.1');
  const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${String(port)}/api/signup` };
}

async function post(url: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

describe('signup', () => {
  let server: TestDatabase;
  let admin: Database;
  let app: INestApplication;
  let url: string;

  // The container's superuser skips RLS, so it sees every business's rows.
  const count = async (table: string, where = 'true', values: unknown[] = []) => {
    const { rows } = await admin.pool.query<{ n: number }>(
      `select count(*)::int as n from ${table} where ${where}`,
      values,
    );
    return rows[0]?.n ?? -1;
  };

  beforeAll(async () => {
    server = await startTestDatabase();
    admin = createDatabase(server.adminUrl, () => undefined);
    ({ app, url } = await startApp(server.runtimeUrl));
  });

  afterAll(async () => {
    await app.close();
    await admin.close();
    await server.stop();
  });

  it('creates the business, branch, owner, key and log entry together', async () => {
    const response = await post(url, signup);
    expect(response.status).toBe(201);
    const { businessId, recoveryKey } = response.body as {
      businessId: string;
      recoveryKey: string;
    };
    expect(recoveryKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);

    const { rows: business } = await admin.pool.query(
      'select name, business_type, phone, gst_status, features from businesses where id = $1',
      [businessId],
    );
    expect(business).toEqual([
      {
        name: 'Sharma Kirana',
        business_type: 'kirana',
        phone: '9111111111',
        gst_status: 'regular',
        features: ['loose_weight', 'expiry_dates', 'udhaar_prominent'],
      },
    ]);
    const { rows: branch } = await admin.pool.query(
      'select name, state_code from branches where business_id = $1',
      [businessId],
    );
    expect(branch).toEqual([{ name: 'Sharma Kirana', state_code: '27' }]);

    const { rows: owner } = await admin.pool.query<{
      id: string;
      role: string;
      email: string;
      password_hash: string;
    }>('select id, role, email, password_hash from users where business_id = $1', [businessId]);
    expect(owner).toHaveLength(1);
    expect(owner[0]).toMatchObject({ role: 'owner', email: 'owner@example.com' });
    expect(await verifyPassword(signup.password, owner[0]?.password_hash ?? '')).toBe(true);

    const keyBytes = readRecoveryKey(recoveryKey) ?? Buffer.alloc(0);
    const { rows: keys } = await admin.pool.query(
      'select user_id, key_hash, used_at from recovery_keys where business_id = $1',
      [businessId],
    );
    expect(keys).toEqual([
      {
        user_id: owner[0]?.id,
        key_hash: createHash('sha256').update(keyBytes).digest('hex'),
        used_at: null,
      },
    ]);

    const { rows: log } = await admin.pool.query<{ after: Record<string, unknown> }>(
      'select action, actor_id, entity_type, entity_id, after from entry_log where business_id = $1',
      [businessId],
    );
    expect(log).toEqual([
      {
        action: 'business.created',
        actor_id: owner[0]?.id,
        entity_type: 'business',
        entity_id: businessId,
        after: expect.any(Object) as unknown,
      },
    ]);
    const logged = JSON.stringify(log[0]?.after);
    expect(logged).not.toContain(signup.password);
    expect(logged).not.toContain(recoveryKey);
  });

  it('answers 409 for an email that already has an account, and writes nothing', async () => {
    const businesses = await count('businesses');
    const response = await post(url, {
      ...signup,
      businessName: 'Copy Shop',
      email: '  OWNER@example.COM ',
    });
    expect(response).toEqual({ status: 409, body: { code: 'email_taken' } });
    expect(await count('businesses')).toBe(businesses);
    expect(await count('branches', 'name = $1', ['Copy Shop'])).toBe(0);
    expect(await count('entry_log', "action = 'business.created'")).toBe(businesses);
  });

  it('lets only one of two signups with the same email through', async () => {
    const body = { ...signup, email: 'race@example.com' };
    const results = await Promise.all([post(url, body), post(url, body)]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await count('users', 'email = $1', ['race@example.com'])).toBe(1);
  });

  it('answers 400 with codes before touching the database', async () => {
    const response = await post(url, { ...signup, password: 'short', phone: '123' });
    expect(response).toEqual({
      status: 400,
      body: { code: 'invalid_body', fields: { phone: 'invalid', password: 'too_short' } },
    });
  });

  // Scan item (d): one failure, one log line with the reason and none of the visitor's data.
  it('logs a lost database as one line without the visitor data', async () => {
    const logs = new LogCapture();
    const broken = await startApp(UNREACHABLE_URL, logs);
    try {
      const response = await post(broken.url, { ...signup, email: 'lost@example.com' });
      expect(response).toEqual({
        status: 500,
        body: { statusCode: 500, message: 'Internal Server Error' },
      });
      const failures = logs.lines.filter((line) => line.startsWith('Request failed'));
      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain('ECONNREFUSED');
      for (const secret of ['lost@example.com', '9111111111', signup.password]) {
        expect(logs.lines.join('\n')).not.toContain(secret);
      }
    } finally {
      await broken.app.close();
    }
  });
});
