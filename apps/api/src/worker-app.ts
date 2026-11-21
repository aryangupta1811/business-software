import 'reflect-metadata';
import {
  ConsoleLogger,
  Logger,
  Module,
  type DynamicModule,
  type INestApplicationContext,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Database } from '@business-software/db';
import type { PgBoss } from 'pg-boss';
import type { WorkerConfig } from './config.js';
import { DATABASE, DatabaseModule } from './database.module.js';
import { describeError } from './errors.js';
import { QueueModule, startQueue } from './queue.module.js';

@Module({})
class WorkerModule {
  static register(config: WorkerConfig, boss: PgBoss): DynamicModule {
    return {
      module: WorkerModule,
      imports: [DatabaseModule.register(config.databaseUrl), QueueModule.register(boss)],
    };
  }
}

export interface WorkerOptions {
  /** How many times to try the queue's database at startup (see `startQueue`). */
  queueStartAttempts?: number;
}

/**
 * Starts the worker's Nest context (no HTTP server): the business database pool as
 * app_runtime, and the job queue (pg-boss) as app_queue (ADR 0022). pg-boss keeps polling, so
 * the process stays alive until `close()` stops it cleanly.
 *
 * An unreachable business database is a warning, not a crash: a server may boot before its
 * database, and a crash would make Docker restart the worker in a loop. An unreachable queue
 * database is an error once the retries run out: without its queue the worker does nothing.
 */
export async function createWorker(
  config: WorkerConfig,
  options: WorkerOptions = {},
): Promise<INestApplicationContext> {
  const logger = new Logger('Worker');
  // Before the Nest context, so a queue that won't start leaves no database pool open.
  const boss = await startQueue(config.queueDatabaseUrl, options.queueStartAttempts ?? 6);
  let worker: INestApplicationContext;
  try {
    worker = await NestFactory.createApplicationContext(WorkerModule.register(config, boss), {
      logger: new ConsoleLogger({ json: config.jsonLogs }),
    });
  } catch (error) {
    await boss.stop({ graceful: false, timeout: 1_000 }).catch(() => undefined);
    throw error;
  }
  try {
    await worker.get<Database>(DATABASE).pool.query('select 1');
    logger.log('Worker started');
  } catch (error) {
    logger.warn(`Worker started, but the database is unreachable: ${describeError(error)}`);
  }
  return worker;
}
