// Integration test on a throwaway PostgreSQL (ADR 0013): the job queue's role (ADR 0022) owns
// schema `pgboss` and nothing else, and the app's runtime role can't touch that schema.
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from './testing.js';

describe('the job queue role', () => {
  let server: TestDatabase;
  let owner: Pool;
  let runtime: Pool;
  let queue: Pool;

  beforeAll(async () => {
    server = await startTestDatabase();
    owner = new Pool({ connectionString: server.ownerUrl });
    runtime = new Pool({ connectionString: server.runtimeUrl });
    queue = new Pool({ connectionString: server.queueUrl });
  });

  afterAll(async () => {
    await owner.end();
    await runtime.end();
    await queue.end();
    await server.stop();
  });

  it('is a plain login role that owns schema pgboss', async () => {
    const { rows } = await owner.query(
      `select r.rolcanlogin, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
              (select nspowner::regrole::text from pg_namespace where nspname = 'pgboss') as owns
         from pg_roles r where r.rolname = 'app_queue'`,
    );
    expect(rows).toEqual([
      {
        rolcanlogin: true,
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        owns: 'app_queue',
      },
    ]);
  });

  // The bootstrap lends app_queue to app_owner to create the schema, then takes it back: the
  // migration role must not be able to act as the queue.
  it('is not left lent to any other role', async () => {
    const { rows } = await owner.query(
      "select count(*)::int as n from pg_auth_members where roleid = 'app_queue'::regrole",
    );
    expect(rows).toEqual([{ n: 0 }]);
  });

  // What pg-boss does: creates tables while running, writes, deletes finished jobs.
  it('creates, writes, deletes and drops inside its own schema', async () => {
    await queue.query('create table pgboss.probe (id int primary key, note text)');
    await queue.query("insert into pgboss.probe values (1, 'a')");
    await queue.query("update pgboss.probe set note = 'b'");
    const { rows } = await queue.query('select note from pgboss.probe');
    expect(rows).toEqual([{ note: 'b' }]);
    await queue.query('delete from pgboss.probe');
    await queue.query('drop table pgboss.probe');
  });

  // 42501 is insufficient_privilege. Checking the code means a misspelt table (42P01) can't
  // make these pass.
  it.each([
    ['read a business table', 'select * from businesses'],
    ['read the login map', 'select * from auth.owner_logins'],
    ['read migration history', 'select * from drizzle.__drizzle_migrations'],
    ['create a table in public', 'create table public.sneaky (n int)'],
    ['create a schema', 'create schema sneaky'],
  ])('refuses to let the queue role %s', async (_, sql) => {
    await expect(queue.query(sql)).rejects.toMatchObject({ code: '42501' });
  });

  describe('and the runtime role', () => {
    beforeAll(async () => {
      await queue.query('create table pgboss.job_probe (id int primary key)');
      await queue.query('insert into pgboss.job_probe values (1)');
    });

    it.each([
      ['read a queue table', 'select * from pgboss.job_probe'],
      ['write a queue table', 'insert into pgboss.job_probe values (2)'],
      ['create a table in pgboss', 'create table pgboss.sneaky (n int)'],
    ])('refuses to let the runtime role %s', async (_, sql) => {
      await expect(runtime.query(sql)).rejects.toMatchObject({ code: '42501' });
    });

    it('cannot even see inside the schema', async () => {
      const { rows } = await runtime.query(
        "select has_schema_privilege('app_runtime', 'pgboss', 'USAGE') as usage",
      );
      expect(rows).toEqual([{ usage: false }]);
    });
  });
});
