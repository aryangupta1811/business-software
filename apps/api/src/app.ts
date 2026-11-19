import 'reflect-metadata';
import { ConsoleLogger, Module, type DynamicModule, type INestApplication } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Database } from '@business-software/db';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SYSTEM_CLOCK, type Clock } from './auth/clock.js';
import { CookieSessionResolver, SessionController } from './auth/session.controller.js';
import { LoginLimits, SESSION_SERVICE, SessionService } from './auth/session.service.js';
import type { ApiConfig } from './config.js';
import { DATABASE, DatabaseModule } from './database.module.js';
import { UnhandledErrorFilter } from './error-filter.js';
import { HealthController } from './health.controller.js';
import { PermissionGuard } from './http/permission.guard.js';
import { SESSION_RESOLVER, type SessionResolver } from './http/session.js';
import { SettingsController } from './settings/settings.controller.js';
import { SettingsService } from './settings/settings.service.js';
import { SignupController } from './signup/signup.controller.js';
import { SignupService } from './signup/signup.service.js';

/** Every controller the API serves; the route census test reads this list. */
export const API_CONTROLLERS = [
  HealthController,
  SessionController,
  SettingsController,
  SignupController,
];

export interface AppOptions {
  /** Who is calling; tests may pass a fake. Defaults to the session cookie (ADR 0009). */
  sessions?: SessionResolver;
  /** Tests move time to check the lock and idle rules. */
  clock?: Clock;
}

@Module({})
class ApiModule {
  static register(config: ApiConfig, options: AppOptions): DynamicModule {
    return {
      module: ApiModule,
      imports: [DatabaseModule.register(config.databaseUrl)],
      controllers: API_CONTROLLERS,
      providers: [
        SettingsService,
        SignupService,
        {
          provide: SESSION_SERVICE,
          inject: [DATABASE],
          useFactory: (database: Database) => {
            const clock = options.clock ?? SYSTEM_CLOCK;
            const settings = { cookieSecure: config.cookieSecure ?? true };
            return new SessionService(database, settings, clock, new LoginLimits(clock));
          },
        },
        options.sessions === undefined
          ? {
              provide: SESSION_RESOLVER,
              inject: [SESSION_SERVICE],
              useFactory: (sessions: SessionService) => new CookieSessionResolver(sessions),
            }
          : { provide: SESSION_RESOLVER, useValue: options.sessions },
        // Every route: public or a permission, CSRF, lock (ADRs 0009, 0036).
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
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
  // Exactly one proxy, Caddy, stands in front (ADR 0011), so the client's IP is the last entry
  // of X-Forwarded-For; anything a client writes before it is ignored (rate limits, scan c).
  app.set('trust proxy', 1);
  // A shared counter's browser must not keep owner-only answers (scan d).
  app.use((_request: IncomingMessage, response: ServerResponse, next: () => void) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  // Caddy sends everything under /api to this service (ADR 0011).
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new UnhandledErrorFilter(app.getHttpAdapter()));
  return app;
}
