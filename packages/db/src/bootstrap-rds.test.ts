// The roles script as RDS runs it (stage 5 part 3): RDS's master user is not a superuser, only
// LOGIN CREATEROLE CREATEDB and the owner of the `postgres` database. Every other test runs
// the script as a superuser, which can do anything, so it can't show a statement that RDS
// would skip with only a WARNING (found by the PR #26 review).
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate.js';
import { composePostgresImage } from './testing.js';

const bootstrapFile = fileURLToPath(new URL('../bootstrap/create-roles.sql', import.meta.url));

describe('create-roles.sql run by a non-superuser admin, as on RDS', () => {
  let container: StartedPostgreSqlContainer;
  let superuser: Pool;
  let output: string;
  let exitCode: number;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(composePostgresImage())
      .withCopyFilesToContainer([{ source: bootstrapFile, target: '/tmp/create-roles.sql' }])
      .start();
    const admin = new URL(container.getConnectionUri());
    admin.pathname = '/postgres';
    superuser = new Pool({ connectionString: admin.toString() });
    await superuser.query('create role rds_admin login createrole createdb');
    await superuser.query('alter database postgres owner to rds_admin');

    // The local socket trusts every user, so psql needs no password here.
    const result = await container.exec(
      ['psql', '-U', 'rds_admin', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1'].concat([
        '-f',
        '/tmp/create-roles.sql',
      ]),
      { env: { APP_OWNER_PASSWORD: 'owner-test', APP_RUNTIME_PASSWORD: 'runtime-test' } },
    );
    output = result.output;
    exitCode = result.exitCode;
  });

  afterAll(async () => {
    await superuser.end();
    await container.stop();
  });

  it('runs to the end with no warning (a skipped GRANT or REVOKE is only a warning)', () => {
    expect(exitCode).toBe(0);
    expect(output).not.toMatch(/WARNING/);
  });

  it('opens the app database only to the app roles and the admin', async () => {
    const { rows } = await superuser.query(
      `select coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') as who,
              string_agg(a.privilege_type, ',' order by a.privilege_type) as privileges
         from pg_database d, aclexplode(d.datacl) a
        where d.datname = 'business_software'
        group by 1 order by 1`,
    );
    expect(rows).toEqual([
      { who: 'app_owner', privileges: 'CONNECT,CREATE,TEMPORARY' },
      { who: 'app_runtime', privileges: 'CONNECT' },
      // For the runbook's manual fixes and later backups.
      { who: 'rds_admin', privileges: 'CONNECT' },
    ]);
  });

  it("keeps the app roles out of the admin's database", async () => {
    const { rows } = await superuser.query(
      `select r.rolname, has_database_privilege(r.rolname, 'postgres', 'CONNECT') as can_connect
         from pg_roles r where r.rolname in ('app_owner', 'app_runtime') order by 1`,
    );
    expect(rows).toEqual([
      { rolname: 'app_owner', can_connect: false },
      { rolname: 'app_runtime', can_connect: false },
    ]);
  });

  it('lets app_owner run the migrations', async () => {
    const url = `postgresql://app_owner:owner-test@${container.getHost()}:${String(container.getPort())}/business_software`;
    await expect(runMigrations(url)).resolves.toBeUndefined();
  });
});
