import { ConsoleLogger, type LoggerService } from '@nestjs/common';
import { describeError } from './errors.js';

/**
 * Runs an entry point (api, worker, migrate). A failure, even before the app's own logger
 * exists, becomes one log line built from messages only (never the error object), and the
 * process exits with code 1.
 *
 * The same goes for an error nothing caught while it runs (an 'error' event with no listener,
 * a promise nobody awaited). Node would crash on those anyway, but its own crash report prints
 * the whole error object: for a failed query, the query's values.
 */
export async function runProcess(
  name: string,
  main: () => Promise<void>,
  logger: LoggerService = new ConsoleLogger(name, {
    json: process.env.NODE_ENV === 'production',
  }),
): Promise<void> {
  const crash = (error: unknown) => {
    logger.error(`${name} crashed: ${describeError(error)}`);
    process.exit(1);
  };
  process.on('uncaughtException', crash);
  process.on('unhandledRejection', crash);
  try {
    await main();
  } catch (error) {
    logger.error(`${name} failed: ${describeError(error)}`);
    process.exitCode = 1;
  } finally {
    process.off('uncaughtException', crash);
    process.off('unhandledRejection', crash);
  }
}
