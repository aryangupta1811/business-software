// The worker's part of the demo reset (ADR 0016's 2026-11-24 note): when it starts, on a server
// that is the demo, it makes a new demo shop if the newest is older than a week. The server is
// often switched off (ADR 0032), so there is no nightly job: "when the worker starts" is the
// schedule.
import { Logger } from '@nestjs/common';
import type { WorkerConfig } from '../config.js';
import { describeError } from '../errors.js';
import { ensureDemoShop, type EnsureOptions, type EnsureResult } from './reset.js';

/**
 * Does nothing unless this server is the demo (`DEMO_ENABLED=true`). Never throws: a failed reset
 * leaves the old demo shop in place, and the worker has other work to do.
 */
export async function resetDemoOnStart(
  config: Pick<WorkerConfig, 'databaseUrl' | 'demoEnabled'>,
  run: (options: EnsureOptions) => Promise<EnsureResult> = ensureDemoShop,
): Promise<void> {
  if (config.demoEnabled !== true) return;
  const logger = new Logger('DemoReset');
  try {
    await run({
      databaseUrl: config.databaseUrl,
      log: (line) => {
        logger.log(line);
      },
    });
  } catch (error) {
    logger.error(`Demo reset failed: ${describeError(error)}`);
  }
}
