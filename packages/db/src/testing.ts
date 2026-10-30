// Test-only helper (exported for tests through the `source` condition, never built):
// a throwaway PostgreSQL with the app roles and migrations, like a fresh production server.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from './migrate.js';

const bootstrapFile = fileURLToPath(new URL('../bootstrap/create-roles.sql', import.meta.url));

export interface TestDatabase {
  /** The container's superuser, for things the app roles may not do. */
  adminUrl: string;
  ownerUrl: string;
  runtimeUrl: string;
  stop(): Promise<void>;
}

// The same image as local development: compose.yaml is the one place the version is written.
function composePostgresImage(): string {
  const compose = readFileSync(new URL('../../../compose.yaml', import.meta.url), 'utf8');
  const image = /^\s*image:\s*(postgres:\S+)\s*$/m.exec(compose)?.[1];
  if (image === undefined) throw new Error('No postgres image found in compose.yaml');
  return image;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(composePostgresImage())
    .withEnvironment({ APP_OWNER_PASSWORD: 'owner-test', APP_RUNTIME_PASSWORD: 'runtime-test' })
    .withCopyFilesToContainer([
      { source: bootstrapFile, target: '/docker-entrypoint-initdb.d/10-create-roles.sql' },
    ])
    .start();
  const server = `${container.getHost()}:${String(container.getPort())}/business_software`;
  const ownerUrl = `postgresql://app_owner:owner-test@${server}`;
  await runMigrations(ownerUrl);
  return {
    adminUrl: container.getConnectionUri(),
    ownerUrl,
    runtimeUrl: `postgresql://app_runtime:runtime-test@${server}`,
    stop: async () => {
      await container.stop();
    },
  };
}
