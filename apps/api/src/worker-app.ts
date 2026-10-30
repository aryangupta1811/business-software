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
import type { ApiConfig } from './config.js';
import { DATABASE, DatabaseModule } from './database.module.js';
import { describeError } from './errors.js';

@Module({})
class WorkerModule {
  static register(config: ApiConfig): DynamicModule {
    return { module: WorkerModule, imports: [DatabaseModule.register(config.databaseUrl)] };
  }
}

/**
 * Starts the worker's Nest context (no HTTP server). Jobs arrive in P2.7.
 * An unreachable database is a warning, not a crash: a server may boot before its database,
 * and a crash would make Docker restart the worker in a loop.
 */
export async function createWorker(config: ApiConfig): Promise<INestApplicationContext> {
  const worker = await NestFactory.createApplicationContext(WorkerModule.register(config), {
    logger: new ConsoleLogger({ json: config.jsonLogs }),
  });
  const logger = new Logger('Worker');
  try {
    await worker.get<Database>(DATABASE).pool.query('select 1');
    logger.log('Worker started (no jobs until P2.7)');
  } catch (error) {
    logger.warn(`Worker started, but the database is unreachable: ${describeError(error)}`);
  }
  return worker;
}
