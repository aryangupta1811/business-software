// The migrate process: a one-shot container that runs before api and worker start (ADR 0021).
// It logs in as the owner role, the only role allowed to change the schema.
import { ConsoleLogger } from '@nestjs/common';
import { runMigrations } from '@business-software/db';
import { readDatabaseUrl } from './config.js';
import { runProcess } from './run.js';

const logger = new ConsoleLogger('Migrate', { json: process.env.NODE_ENV === 'production' });
await runProcess(
  'Migrate',
  async () => {
    await runMigrations(readDatabaseUrl(process.env, 'MIGRATION_DATABASE_URL'));
    logger.log('Migrations applied');
  },
  logger,
);
