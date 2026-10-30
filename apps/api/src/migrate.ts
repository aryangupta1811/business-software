// The migrate process: a one-shot container that runs before api and worker start (ADR 0021).
// It logs in as the owner role, the only role allowed to change the schema.
import { Logger } from '@nestjs/common';
import { runMigrations } from '@business-software/db';
import { readDatabaseUrl } from './config.js';

const logger = new Logger('Migrate');
try {
  await runMigrations(readDatabaseUrl(process.env, 'MIGRATION_DATABASE_URL'));
  logger.log('Migrations applied');
} catch (error) {
  // Only the message: pg's error objects carry the connection password.
  logger.error(`Migrations failed: ${(error as Error).message}`);
  process.exitCode = 1;
}
