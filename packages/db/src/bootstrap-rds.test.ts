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
const backupRoleFile = fileURLToPath(
  new URL('../bootstrap/create-backup-role.sql', import.meta.url),
);

const passwords = {
  APP_OWNER_PASSWORD: 'owner-test',
  APP_RUNTIME_PASSWORD: 'runtime-test',
  APP_BACKUP_PASSWORD: 'backup-test',
};

describe('the bootstrap files run by a non-superuser admin, as on RDS', () => {
  let container: StartedPostgreSqlContainer;
  let superuser: Pool;
  let output: string;
  let exitCode: number;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(composePostgresImage())
      .withCopyFilesToContainer([
        { source: bootstrapFile, target: '/tmp/create-roles.sql' },
        { source: backupRoleFile, target: '/tmp/create-backup-role.sql' },
      ])
      .start();
    const admin = new URL(container.getConnectionUri());
    admin.pathname = '/postgres';
    superuser = new Pool({ connectionString: admin.toString() });
    await superuser.query('create role rds_admin login createrole createdb');
    await superuser.query('alter database postgres owner to rds_admin');

    // As bootstrap-db.sh runs them: the roles once, the backup role on every deploy (so twice
    // here). The local socket trusts every user, so psql needs no password here.
    output = '';
    exitCode = 0;
    for (const file of ['create-roles.sql', 'create-backup-role.sql', 'create-backup-role.sql']) {
      const result = await container.exec(
        ['psql', '-U', 'rds_admin', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1'].concat([
          '-f',
          `/tmp/${file}`,
        ]),
        { env: passwords },
      );
      output += result.output;
      exitCode = Math.max(exitCode, result.exitCode);
    }
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
      { who: 'app_backup', privileges: 'CONNECT' },
      { who: 'app_owner', privileges: 'CONNECT,CREATE,TEMPORARY' },
      { who: 'app_runtime', privileges: 'CONNECT' },
      // For the runbook's manual fixes and later backups.
      { who: 'rds_admin', privileges: 'CONNECT' },
    ]);
  });

  it('makes a backup role that can log in, reads only, and the admin cannot use', async () => {
    const { rows } = await superuser.query(
      `select r.rolcanlogin, r.rolbypassrls, r.rolsuper, r.rolcreaterole, r.rolcreatedb,
              r.rolconfig, m.admin_option, m.inherit_option, m.set_option
         from pg_roles r
         left join pg_auth_members m
           on m.roleid = r.oid and m.member = 'rds_admin'::regrole
        where r.rolname = 'app_backup'`,
    );
    expect(rows).toEqual([
      {
        rolcanlogin: true,
        rolbypassrls: false,
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolconfig: ['default_transaction_read_only=on'],
        // PostgreSQL 16+ makes the creator an ADMIN-only member: it can grant the role, not
        // use its rights.
        admin_option: true,
        inherit_option: false,
        set_option: false,
      },
    ]);
  });

  it("keeps the app roles out of the admin's database", async () => {
    const { rows } = await superuser.query(
      `select r.rolname, has_database_privilege(r.rolname, 'postgres', 'CONNECT') as can_connect
         from pg_roles r where r.rolname in ('app_backup', 'app_owner', 'app_runtime') order by 1`,
    );
    expect(rows).toEqual([
      { rolname: 'app_backup', can_connect: false },
      { rolname: 'app_owner', can_connect: false },
      { rolname: 'app_runtime', can_connect: false },
    ]);
  });

  it('lets app_owner run the migrations', async () => {
    const url = `postgresql://app_owner:owner-test@${container.getHost()}:${String(container.getPort())}/business_software`;
    await expect(runMigrations(url)).resolves.toBeUndefined();
  });

  // bootstrap-db.sh runs the file on every deploy, so a role left half made (a run that
  // stopped after CREATE ROLE) or a rotated password in SSM is put right at the next deploy
  // (PR #32 review).
  it('repairs the backup role and applies a new password on the next run', async () => {
    await superuser.query('alter role app_backup reset default_transaction_read_only');
    await superuser.query('alter role app_backup password null');
    await superuser.query('revoke connect on database business_software from app_backup');

    const rerun = await container.exec(
      ['psql', '-U', 'rds_admin', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1'].concat([
        '-f',
        '/tmp/create-backup-role.sql',
      ]),
      { env: { ...passwords, APP_BACKUP_PASSWORD: 'backup-rotated' } },
    );
    expect(rerun.exitCode, rerun.output).toBe(0);
    expect(rerun.output).not.toMatch(/WARNING/);

    const backup = new Pool({
      connectionString: `postgresql://app_backup:backup-rotated@${container.getHost()}:${String(container.getPort())}/business_software`,
    });
    try {
      const { rows } = await backup.query<{ read_only: string }>(
        'select current_setting($1) as read_only',
        ['default_transaction_read_only'],
      );
      expect(rows).toEqual([{ read_only: 'on' }]);
    } finally {
      await backup.end();
    }
  });
});
