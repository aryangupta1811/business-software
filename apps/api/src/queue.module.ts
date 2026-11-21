import {
  Inject,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PgBoss, type Job } from 'pg-boss';
import { describeError } from './errors.js';

/** Injection token for the worker's started pg-boss (the job queue), connected as app_queue. */
export const QUEUE = 'QUEUE';

/** The one queue so far: proves the plumbing end to end. Business queues arrive with P2.7 part 2. */
export const PING_QUEUE = 'system.ping';

/** How long a stop waits for jobs that are running before it gives up on them. */
const STOP_TIMEOUT_MS = 10_000;

/**
 * Starts pg-boss as app_queue (ADR 0022) and registers the worker's queues.
 *
 * `createSchema: false` is the important option: by default pg-boss runs `CREATE SCHEMA IF NOT
 * EXISTS pgboss`, and PostgreSQL checks the right to create schemas before it checks that the
 * schema exists, so it would fail with "permission denied for database". The bootstrap
 * (packages/db/bootstrap/create-queue-role.sql) already made the schema, owned by app_queue.
 *
 * `attempts` is how many times to try before giving up, waiting 1 s after the first failure and
 * doubling up to 30 s: a server may boot before its database.
 */
export async function startQueue(queueDatabaseUrl: string, attempts: number): Promise<PgBoss> {
  const logger = new Logger('Queue');
  const boss = new PgBoss({ connectionString: queueDatabaseUrl, createSchema: false });
  // pg-boss reports a lost connection as 'error'; with no listener Node would crash the process.
  boss.on('error', (error) => {
    logger.error(`Queue error: ${describeError(error)}`);
  });
  try {
    await boss.start({ attempts });
    await boss.createQueue(PING_QUEUE);
    await boss.work(PING_QUEUE, (jobs: Job[]) => {
      const [job] = jobs;
      logger.log(`Ping job ${job?.id ?? ''} handled`);
      return Promise.resolve({ pong: job?.data ?? null });
    });
  } catch (error) {
    // Close what start() opened (its pool), or the process would hang on it.
    await boss.stop({ graceful: false, timeout: 1_000 }).catch(() => undefined);
    throw error;
  }
  return boss;
}

@Module({})
export class QueueModule implements OnApplicationShutdown {
  static register(boss: PgBoss): DynamicModule {
    return {
      module: QueueModule,
      providers: [{ provide: QUEUE, useValue: boss }],
      exports: [QUEUE],
    };
  }

  constructor(@Inject(QUEUE) private readonly boss: PgBoss) {}

  /** Lets a running job finish (up to the timeout), then closes pg-boss's connections. */
  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: STOP_TIMEOUT_MS });
  }
}
