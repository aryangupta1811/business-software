// `pnpm seed:demo [--force] [--days N]`: builds the demo shop if there is none under a week old
// (ADR 0016). The same command runs on the demo server (docs/devops/demo-data.md).
import { ConsoleLogger } from '@nestjs/common';
import { readDatabaseUrl } from '../config.js';
import { runProcess } from '../run.js';
import { assertSeedAllowed, ensureDemoShop } from './reset.js';

const logger = new ConsoleLogger('SeedDemo', { json: process.env.NODE_ENV === 'production' });

function daysFrom(args: string[]): number | undefined {
  const at = args.indexOf('--days');
  if (at === -1) return undefined;
  const days = Number(args[at + 1]);
  if (!Number.isInteger(days) || days < 1 || days > 400) {
    throw new Error('--days must be a whole number from 1 to 400');
  }
  return days;
}

await runProcess(
  'SeedDemo',
  async () => {
    const args = process.argv.slice(2);
    assertSeedAllowed(process.env);
    const days = daysFrom(args);
    const outcome = await ensureDemoShop({
      databaseUrl: readDatabaseUrl(process.env, 'DATABASE_URL'),
      force: args.includes('--force'),
      ...(days !== undefined && { days }),
      log: (line) => {
        logger.log(line);
      },
    });
    if (outcome.action === 'created') {
      const { result } = outcome;
      logger.log(
        `Built ${String(result.bills)} bills over ${String(result.days)} days in ${String(result.seconds)} s ` +
          `(${result.firstDay} to ${result.lastDay}); log in at the demo buttons or as ${result.ownerEmail}`,
      );
    }
  },
  logger,
);
