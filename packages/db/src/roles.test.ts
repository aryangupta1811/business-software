// Integration test on a throwaway PostgreSQL (ADR 0013): the database itself must
// stop the app's role from deleting rows or changing the schema (ADRs 0006, 0007).
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate.js';
import { startTestDatabase, type TestDatabase } from './testing.js';

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

async function countAppliedMigrations(pool: Pool): Promise<number> {
  const result = await pool.query<{ n: number }>(
    'select count(*)::int as n from drizzle.__drizzle_migrations',
  );
  return result.rows[0]?.n ?? 0;
}

describe('app database roles', () => {
  let server: TestDatabase;
  let owner: Pool;
  let runtime: Pool;

  beforeAll(async () => {
    server = await startTestDatabase();
    owner = new Pool({ connectionString: server.ownerUrl });
    runtime = new Pool({ connectionString: server.runtimeUrl });

    // Created after the migrations on purpose: grants must cover tables that don't exist yet.
    await owner.query(
      'create table probe (id int generated always as identity primary key, note text)',
    );
  });

  afterAll(async () => {
    await owner.end();
    await runtime.end();
    await server.stop();
  });

  it('gives no app role superuser, BYPASSRLS, CREATEROLE or CREATEDB', async () => {
    const { rows } = await owner.query(
      `select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles
        where rolname in ('app_backup', 'app_owner', 'app_queue', 'app_runtime') order by rolname`,
    );
    expect(rows).toEqual([
      {
        rolname: 'app_backup',
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
      },
      {
        rolname: 'app_owner',
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
      },
      {
        rolname: 'app_queue',
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
      },
      {
        rolname: 'app_runtime',
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
      },
    ]);
  });

  // The bootstrap runs in the administrator's own database (`postgres` on RDS). The app roles
  // have no business there, so they can't even connect (42501, insufficient_privilege).
  it.each(['ownerUrl', 'runtimeUrl', 'queueUrl'] as const)(
    'keeps the %s role out of the administrator database',
    async (which) => {
      const url = new URL(server[which]);
      url.pathname = `/${server.adminDatabase}`;
      const pool = new Pool({ connectionString: url.toString() });
      try {
        await expect(pool.query('select 1')).rejects.toMatchObject({ code: '42501' });
      } finally {
        await pool.end();
      }
    },
  );

  // On RDS the administrator isn't a superuser, so it may create a database owned by
  // app_owner only if it can switch to that role (PostgreSQL 16+). It must not inherit
  // app_owner's rights, though: switching is a deliberate act.
  it('lets the administrator switch to app_owner without inheriting its rights', async () => {
    const admin = new Pool({ connectionString: server.adminUrl });
    try {
      const { rows } = await admin.query(
        `select m.inherit_option, m.set_option, m.admin_option
           from pg_auth_members m
          where m.roleid = 'app_owner'::regrole and m.member = current_user::regrole`,
      );
      expect(rows).toEqual([{ inherit_option: false, set_option: true, admin_option: false }]);
    } finally {
      await admin.end();
    }
  });

  it('lets the runtime role insert, read and update rows in new tables', async () => {
    await runtime.query("insert into probe (note) values ('a')");
    await runtime.query("update probe set note = 'b' where note = 'a'");
    const { rows } = await runtime.query('select note from probe');
    expect(rows).toEqual([{ note: 'b' }]);
  });

  // Pins the whole grant set: an extra privilege (DELETE, TRIGGER…) or a missing sequence
  // grant (which identity columns never check, but serial columns do) fails here.
  it('grants future tables and sequences exactly the planned privileges', async () => {
    const { rows } = await owner.query(
      `select defaclobjtype::text as kind,
              string_agg(acl.privilege_type, ',' order by acl.privilege_type) as privileges
         from pg_default_acl, aclexplode(defaclacl) as acl
        where acl.grantee = 'app_runtime'::regrole
        group by defaclobjtype
        order by defaclobjtype::text collate "C"`,
    );
    expect(rows).toEqual([
      { kind: 'S', privileges: 'SELECT,USAGE' },
      { kind: 'r', privileges: 'INSERT,SELECT,UPDATE' },
    ]);
  });

  // 42501 is insufficient_privilege. Checking the code, not the message, means an
  // unrelated error (say a misspelt table, 42P01) can't make these pass.
  it.each([
    ['delete rows', 'delete from probe'],
    ['truncate a table', 'truncate probe'],
    ['create a table', 'create table sneaky (n int)'],
    ['drop a table', 'drop table probe'],
    ['read migration history', 'select * from drizzle.__drizzle_migrations'],
  ])('refuses to let the runtime role %s', async (_, sql) => {
    await expect(runtime.query(sql)).rejects.toMatchObject({ code: '42501' });
  });

  it('does nothing when migrations run again', async () => {
    const files = readdirSync(migrationsFolder).filter((name) => name.endsWith('.sql'));
    await runMigrations(server.ownerUrl);
    expect(await countAppliedMigrations(owner)).toBe(files.length);
  });
});
