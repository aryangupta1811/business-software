// Test-only helper (exported for tests through the `source` condition, never built):
// a throwaway PostgreSQL with the app roles and migrations, like a fresh production server.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from './migrate.js';
import { branches, businesses, users } from './schema.js';
import type { Transaction } from './tenancy.js';

const bootstrapFile = fileURLToPath(new URL('../bootstrap/create-roles.sql', import.meta.url));
const backupRoleFile = fileURLToPath(
  new URL('../bootstrap/create-backup-role.sql', import.meta.url),
);

export interface TestDatabase {
  /** The container's superuser on the app's database, for things the app roles may not do. */
  adminUrl: string;
  /** The database the bootstrap script ran in (the administrator's own, like `postgres` on RDS). */
  adminDatabase: string;
  ownerUrl: string;
  runtimeUrl: string;
  /** The backup role (ADR 0037): reads every row, writes nothing. */
  backupUrl: string;
  /** For running tools inside it (psql, pg_dump), as the backup test does. */
  container: StartedPostgreSqlContainer;
  stop(): Promise<void>;
}

// The same image as local development: compose.yaml is the one place the version is written.
export function composePostgresImage(): string {
  const compose = readFileSync(new URL('../../../compose.yaml', import.meta.url), 'utf8');
  const image = /^\s*image:\s*(postgres:\S+)\s*$/m.exec(compose)?.[1];
  if (image === undefined) throw new Error('No postgres image found in compose.yaml');
  return image;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(composePostgresImage())
    .withEnvironment({
      APP_OWNER_PASSWORD: 'owner-test',
      APP_RUNTIME_PASSWORD: 'runtime-test',
      APP_BACKUP_PASSWORD: 'backup-test',
    })
    .withCopyFilesToContainer([
      { source: bootstrapFile, target: '/docker-entrypoint-initdb.d/10-create-roles.sql' },
      { source: backupRoleFile, target: '/docker-entrypoint-initdb.d/20-create-backup-role.sql' },
    ])
    .start();
  const server = `${container.getHost()}:${String(container.getPort())}/business_software`;
  const ownerUrl = `postgresql://app_owner:owner-test@${server}`;
  await runMigrations(ownerUrl);
  // getConnectionUri() names the container's default database, not the app's.
  const adminUrl = new URL(container.getConnectionUri());
  adminUrl.pathname = '/business_software';
  return {
    adminUrl: adminUrl.toString(),
    adminDatabase: container.getDatabase(),
    ownerUrl,
    runtimeUrl: `postgresql://app_runtime:runtime-test@${server}`,
    backupUrl: `postgresql://app_backup:backup-test@${server}`,
    container,
    stop: async () => {
      await container.stop();
    },
  };
}

/** A valid `businesses` row with the fields signup always fills; no `id` means the default. */
export function testBusiness(name: string, id?: string) {
  return {
    ...(id !== undefined && { id }),
    name,
    businessType: 'kirana',
    phone: '9111111111',
    gstStatus: 'unregistered',
    features: [] as string[],
  };
}

/** A valid `branches` row. */
export function testBranch(businessId: string, name: string) {
  return { businessId, name, stateCode: '27' };
}

/** Inside `withNewBusiness`: the business, its first branch and its owner, as signup makes them. */
export async function insertTestBusiness(
  tx: Transaction,
  businessId: string,
  name: string,
): Promise<{ businessId: string; branchId: string; ownerId: string }> {
  await tx.insert(businesses).values(testBusiness(name, businessId));
  const [branch] = await tx
    .insert(branches)
    .values(testBranch(businessId, `${name} main`))
    .returning({ id: branches.id });
  const [owner] = await tx
    .insert(users)
    .values({ businessId, role: 'owner', email: `owner-${businessId}@example.test` })
    .returning({ id: users.id });
  if (branch === undefined || owner === undefined) throw new Error('no row returned');
  return { businessId, branchId: branch.id, ownerId: owner.id };
}
