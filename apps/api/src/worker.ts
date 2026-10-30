// The worker process: same image as the api, runs background jobs (ADRs 0004, 0010).
// Jobs arrive in P2.7; for now it proves the entry point, the database and a clean shutdown.
import 'reflect-metadata';
import { once } from 'node:events';
import { ConsoleLogger, Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Database } from '@business-software/db';
import { loadConfig } from './config.js';
import { DATABASE, DatabaseModule } from './database.module.js';

const config = loadConfig(process.env);

@Module({ imports: [DatabaseModule.register(config.databaseUrl)] })
class WorkerModule {}

const app = await NestFactory.createApplicationContext(WorkerModule, {
  logger: new ConsoleLogger({ json: config.jsonLogs }),
});
await app.get<Database>(DATABASE).pool.query('select 1');
const logger = new Logger('Worker');
logger.log('Worker started (no jobs until P2.7)');

// An application context holds no server, so Node would exit at once without this wait.
const signal = await Promise.race([once(process, 'SIGTERM'), once(process, 'SIGINT')]);
logger.log(`Received ${String(signal[0] ?? 'signal')}, shutting down`);
await app.close();
