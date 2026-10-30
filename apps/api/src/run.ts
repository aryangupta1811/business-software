import { ConsoleLogger, type LoggerService } from '@nestjs/common';
import { describeError } from './errors.js';

/**
 * Runs an entry point (api, worker, migrate). A failure, even before the app's own logger
 * exists, becomes one log line built from messages only (never the error object), and the
 * process exits with code 1.
 */
export async function runProcess(
  name: string,
  main: () => Promise<void>,
  logger: LoggerService = new ConsoleLogger(name, {
    json: process.env.NODE_ENV === 'production',
  }),
): Promise<void> {
  try {
    await main();
  } catch (error) {
    logger.error(`${name} failed: ${describeError(error)}`);
    process.exitCode = 1;
  }
}
