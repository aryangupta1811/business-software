import 'reflect-metadata';
import { ConsoleLogger, Module, type DynamicModule, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ApiConfig } from './config.js';
import { DatabaseModule } from './database.module.js';
import { UnhandledErrorFilter } from './error-filter.js';
import { HealthController } from './health.controller.js';
import { HttpRulesModule } from './http/http-rules.module.js';
import { CatalogueService } from './items/catalogue.service.js';
import {
  CategoriesController,
  ItemsController,
  UnitsController,
} from './items/items.controller.js';
import { ItemsService } from './items/items.service.js';
import type { SessionResolver } from './http/session.js';
import { SettingsController } from './settings/settings.controller.js';
import { SettingsService } from './settings/settings.service.js';
import { SignupController } from './signup/signup.controller.js';
import { SignupService } from './signup/signup.service.js';

/** Every controller the API serves; the route census test reads this list. */
export const API_CONTROLLERS = [
  HealthController,
  SettingsController,
  SignupController,
  ItemsController,
  CategoriesController,
  UnitsController,
];

export interface AppOptions {
  /** Who is calling; tests pass a fake. Defaults to nobody until P1.4. */
  sessions?: SessionResolver;
}

@Module({})
class ApiModule {
  static register(config: ApiConfig, options: AppOptions): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        DatabaseModule.register(config.databaseUrl),
        HttpRulesModule.register(options.sessions),
      ],
      controllers: API_CONTROLLERS,
      providers: [SettingsService, SignupService, ItemsService, CatalogueService],
    };
  }
}

/** Builds the HTTP app without starting to listen, so tests can pick their own port. */
export async function createApp(
  config: ApiConfig,
  options: AppOptions = {},
): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(
    ApiModule.register(config, options),
    {
      logger: new ConsoleLogger({ json: config.jsonLogs }),
    },
  );
  // Express adds "X-Powered-By: Express" to every answer; it only helps attackers.
  app.disable('x-powered-by');
  // Caddy sends everything under /api to this service (ADR 0011).
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new UnhandledErrorFilter(app.getHttpAdapter()));
  return app;
}
