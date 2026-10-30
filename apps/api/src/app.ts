import 'reflect-metadata';
import { ConsoleLogger, Module, type DynamicModule, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { ApiConfig } from './config.js';
import { DatabaseModule } from './database.module.js';
import { HealthController } from './health.controller.js';

@Module({})
class ApiModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: ApiModule,
      imports: [DatabaseModule.register(config.databaseUrl)],
      controllers: [HealthController],
    };
  }
}

/** Builds the HTTP app without starting to listen, so tests can pick their own port. */
export async function createApp(config: ApiConfig): Promise<INestApplication> {
  const app = await NestFactory.create(ApiModule.register(config), {
    logger: new ConsoleLogger({ json: config.jsonLogs }),
  });
  // Caddy sends everything under /api to this service (ADR 0011).
  app.setGlobalPrefix('api');
  // Closes the database pool when Docker stops the container (SIGTERM).
  app.enableShutdownHooks();
  return app;
}
