// The nightly backup and the restore drill end to end (ADR 0037): deploy/demo/dump.sh runs as
// app_backup on a database holding two businesses, exactly as on the server (inside the
// postgres:18 image), and deploy/demo/restore-check.sh restores its output into an empty
// PostgreSQL. RLS is the trap here: a dump that can't see a table's rows still exits 0, with
// the table empty (ADR 0027), so every test counts rows.
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { withNewBusiness } from './tenancy.js';
import {
  composePostgresImage,
  insertTestBusiness,
  startTestDatabase,
  type TestDatabase,
} from './testing.js';

const deployFile = (name: string) =>
  fileURLToPath(new URL(`../../../deploy/demo/${name}`, import.meta.url));
const bootstrapFile = (name: string) =>
  fileURLToPath(new URL(`../bootstrap/${name}`, import.meta.url));

// libpq's variables, as backup.sh passes them on the server (there over TLS to RDS).
const asBackupRole = {
  PGHOST: '127.0.0.1',
  PGUSER: 'app_backup',
  PGPASSWORD: 'backup-test',
  PGDATABASE: 'business_software',
};

// What restore-drill.sh creates in its throwaway container: an administrator with only what
// RDS's master user has (not a superuser). A restore that only works for a superuser would
// fail on RDS (PR #32 review), so the drill and these tests restore as this role.
const rdsLikeAdmin = `create role rds_admin login createrole createdb;
  alter database postgres owner to rds_admin`;

/** An empty PostgreSQL holding restore-check.sh and the bootstrap files, like the drill's. */
async function startScratch(): Promise<StartedPostgreSqlContainer> {
  const scratch = await new PostgreSqlContainer(composePostgresImage())
    .withUsername('postgres')
    .withCopyFilesToContainer([
      { source: deployFile('restore-check.sh'), target: '/drill/restore-check.sh' },
      { source: bootstrapFile('create-roles.sql'), target: '/drill/create-roles.sql' },
      { source: bootstrapFile('create-backup-role.sql'), target: '/drill/create-backup-role.sql' },
    ])
    .start();
  const admin = await scratch.exec(
    ['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres', '-c', rdsLikeAdmin],
    { env: { PGUSER: 'postgres' } },
  );
  expect(admin.exitCode, admin.output).toBe(0);
  return scratch;
}

function restoreCheck(scratch: StartedPostgreSqlContainer, counts = '/out/nightly.counts.tsv') {
  return scratch.exec(['bash', '/drill/restore-check.sh', '/out/nightly.dump', counts, '/drill'], {
    env: { PGUSER: 'rds_admin' },
  });
}

describe('nightly backup and restore drill', () => {
  let server: TestDatabase;
  let runtime: Database;
  let backup: Pool;
  let owner: Pool;
  let dump: { exitCode: number; output: string };

  // The drill's download, here a copy of /out from one container to the other. Docker's tar
  // stream is a Node Readable at runtime; testcontainers types it as the older interface.
  async function copyBackup(scratch: StartedPostgreSqlContainer): Promise<void> {
    const archive = await server.container.copyArchiveFromContainer('/out');
    await scratch.copyArchiveToContainer(archive as Readable, '/');
  }

  beforeAll(async () => {
    server = await startTestDatabase();
    runtime = createDatabase(server.runtimeUrl, vi.fn());
    backup = new Pool({ connectionString: server.backupUrl });
    owner = new Pool({ connectionString: server.ownerUrl });
    for (const name of ['Sharma Kirana', 'Gupta Medical']) {
      await withNewBusiness(runtime.db, (tx, businessId) =>
        insertTestBusiness(tx, businessId, name),
      );
    }
    await server.container.copyFilesToContainer([
      { source: deployFile('dump.sh'), target: '/backup/dump.sh' },
    ]);
    await server.container.exec(['mkdir', '/out']);
    dump = await server.container.exec(['bash', '/backup/dump.sh', '/out', 'nightly'], {
      env: asBackupRole,
    });
  });

  afterAll(async () => {
    await backup.end();
    await owner.end();
    await runtime.close();
    await server.stop();
  });

  it('lets the backup role read every business and change nothing', async () => {
    const { rows } = await backup.query<{ n: number }>('select count(*)::int as n from businesses');
    expect(rows).toEqual([{ n: 2 }]);
    // Read-only twice over: no INSERT grant, and every transaction starts READ ONLY.
    await expect(
      backup.query(
        "insert into branches (business_id, name, state_code) values (uuidv7(), 'x', '27')",
      ),
    ).rejects.toMatchObject({ code: '25006' });
    const client = await backup.connect();
    try {
      await client.query('begin read write');
      await expect(client.query("update branches set name = 'x'")).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it("dumps every business's rows, counted from the dump's own snapshot", async () => {
    expect(dump.exitCode, dump.output).toBe(0);
    const counts = await server.container.exec(['cat', '/out/nightly.counts.tsv']);
    expect(counts.output).toContain('businesses\t2\n');
    expect(counts.output).toContain('branches\t2\n');
    expect(counts.output).toContain('users\t2\n');
    expect(counts.output).toMatch(/^drizzle\.__drizzle_migrations\t[1-9]\d*$/m);
    expect(dump.output).toMatch(/^dump: \d+ tables, \d+ rows, \d+ bytes$/m);
  });

  it('restores the dump into an empty server with every count matching', async () => {
    const scratch = await startScratch();
    try {
      await copyBackup(scratch);
      const check = await restoreCheck(scratch);
      expect(check.exitCode, check.output).toBe(0);
      expect(check.output).toMatch(/restore check: OK, \d+ tables, \d+ rows, every count matches/);
      // The restored copy holds both businesses.
      const restored = await scratch.exec(
        ['psql', '-At', '-d', 'business_software', '-c', 'select name from businesses order by 1'],
        { env: { PGUSER: 'postgres' } },
      );
      expect(restored.output).toBe('Gupta Medical\nSharma Kirana\n');
      // Owned as on the live server, so the app's grants and RLS work on the copy.
      const owners = await scratch.exec(
        [
          'psql',
          '-At',
          '-d',
          'business_software',
          '-c',
          "select distinct tableowner from pg_tables where schemaname in ('public', 'drizzle')",
        ],
        { env: { PGUSER: 'postgres' } },
      );
      expect(owners.output).toBe('app_owner\n');
    } finally {
      await scratch.stop();
    }
  });

  it('fails the drill when a restored count differs from the backup', async () => {
    const scratch = await startScratch();
    try {
      await copyBackup(scratch);
      await scratch.exec([
        'sh',
        '-c',
        "sed 's/^businesses\\t2$/businesses\\t3/' /out/nightly.counts.tsv > /out/wrong.tsv",
      ]);
      const check = await restoreCheck(scratch, '/out/wrong.tsv');
      expect(check.exitCode).toBe(1);
      expect(check.output).toContain('restore check: FAILED');
      expect(check.output).toContain('businesses\t3\t2');
    } finally {
      await scratch.stop();
    }
  });

  // Like pgboss will be (P2.7) until it's granted or excluded on purpose: pg_dump can't read
  // the schema. The whole backup fails, and no partial dump is left to upload.
  it('fails with no file left when pg_dump fails', async () => {
    const admin = new Pool({ connectionString: server.adminUrl });
    try {
      await admin.query('create schema probe_private; create table probe_private.t (id int)');
      const result = await server.container.exec(['bash', '/backup/dump.sh', '/out', 'failed'], {
        env: asBackupRole,
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain('permission denied for schema probe_private');
      expect(result.output).toContain('pg_dump failed');
      const files = await server.container.exec(['ls', '/out']);
      expect(files.output).not.toContain('failed');
    } finally {
      await admin.query('drop schema if exists probe_private cascade');
      await admin.end();
    }
  });

  // Without its backup_read policy, pg_dump with RLS on would save the table with no rows and
  // still exit 0. The tenancy guard stops such a migration; this is the check on the live
  // server, in case one ever gets there.
  it('refuses to dump when a table under RLS has no backup_read policy', async () => {
    try {
      await owner.query(`
        create table probe_unreadable (id uuid primary key);
        alter table probe_unreadable enable row level security;
        alter table probe_unreadable force row level security`);
      const result = await server.container.exec(['bash', '/backup/dump.sh', '/out', 'probe'], {
        env: asBackupRole,
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain(
        'no backup_read policy for app_backup on: probe_unreadable (the dump would save them empty)',
      );
      const files = await server.container.exec(['ls', '/out']);
      expect(files.output).not.toContain('probe');
    } finally {
      await owner.query('drop table if exists probe_unreadable');
    }
  });
});
