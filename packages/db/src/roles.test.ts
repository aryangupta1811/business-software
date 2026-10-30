// Integration test on a throwaway PostgreSQL (ADR 0013): the database itself must
// stop the app's role from deleting rows or changing the schema (ADRs 0006, 0007).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));
const bootstrapFile = fileURLToPath(new URL('../bootstrap/create-roles.sql', import.meta.url));

// The same image as local development: compose.yaml is the one place the version is written.
function composePostgresImage(): string {
  const compose = readFileSync(new URL('../../../compose.yaml', import.meta.url), 'utf8');
  const image = /^\s*image:\s*(postgres:\S+)\s*$/m.exec(compose)?.[1];
  if (image === undefined) throw new Error('No postgres image found in compose.yaml');
  return image;
}

async function countAppliedMigrations(pool: Pool): Promise<number> {
  const result = await pool.query<{ n: number }>(
    'select count(*)::int as n from drizzle.__drizzle_migrations',
  );
  return result.rows[0]?.n ?? 0;
}

describe('app database roles', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Pool;
  let runtime: Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(composePostgresImage())
      .withEnvironment({ APP_OWNER_PASSWORD: 'owner-test', APP_RUNTIME_PASSWORD: 'runtime-test' })
      .withCopyFilesToContainer([
        { source: bootstrapFile, target: '/docker-entrypoint-initdb.d/10-create-roles.sql' },
      ])
      .start();
    const server = {
      host: container.getHost(),
      port: container.getPort(),
      database: 'business_software',
    };
    owner = new Pool({ ...server, user: 'app_owner', password: 'owner-test' });
    runtime = new Pool({ ...server, user: 'app_runtime', password: 'runtime-test' });

    await migrate(drizzle(owner), { migrationsFolder });
    // Created after the migrations on purpose: grants must cover tables that don't exist yet.
    await owner.query(
      'create table probe (id int generated always as identity primary key, note text)',
    );
  });

  afterAll(async () => {
    await owner.end();
    await runtime.end();
    await container.stop();
  });

  it('gives neither app role superuser, BYPASSRLS, CREATEROLE or CREATEDB', async () => {
    const { rows } = await owner.query(
      `select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
         from pg_roles where rolname in ('app_owner', 'app_runtime') order by rolname`,
    );
    expect(rows).toEqual([
      {
        rolname: 'app_owner',
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

  it('lets the runtime role insert, read and update rows in new tables', async () => {
    await runtime.query("insert into probe (note) values ('a')");
    await runtime.query("update probe set note = 'b' where note = 'a'");
    const { rows } = await runtime.query('select note from probe');
    expect(rows).toEqual([{ note: 'b' }]);
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
    await migrate(drizzle(owner), { migrationsFolder });
    expect(await countAppliedMigrations(owner)).toBe(files.length);
  });
});
