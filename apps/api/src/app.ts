import 'reflect-metadata';
import {
  ConsoleLogger,
  Logger,
  Module,
  type DynamicModule,
  type INestApplication,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Database } from '@business-software/db';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AlertsController } from './alerts/alerts.controller.js';
import { AlertsService } from './alerts/alerts.service.js';
import { AccountController } from './account/account.controller.js';
import { AccountService } from './account/account.service.js';
import { DevicesController } from './account/devices.controller.js';
import { DevicesService } from './account/devices.service.js';
import { EMAIL_LINKS, EmailLinks } from './account/email-links.js';
import { CLOCK, SYSTEM_CLOCK, type Clock } from './auth/clock.js';
import { BranchesController } from './branches/branches.controller.js';
import { BranchesService } from './branches/branches.service.js';
import { BillingController } from './billing/billing.controller.js';
import { BillsController } from './bills/bills.controller.js';
import { BillsService } from './bills/bills.service.js';
import { BillingService } from './billing/billing.service.js';
import { HeldBillsController } from './billing/held-bills.controller.js';
import { HeldBillsService } from './billing/held-bills.service.js';
import { HASH_GATE, HashGate } from './auth/hash-gate.js';
import { CookieSessionResolver, SessionController } from './auth/session.controller.js';
import { LoginLimits, SESSION_SERVICE, SessionService } from './auth/session.service.js';
import { DEFAULT_APP_URL, type ApiConfig } from './config.js';
import { CustomersController } from './customers/customers.controller.js';
import { CustomersService } from './customers/customers.service.js';
import { DATABASE, DatabaseModule } from './database.module.js';
import { DEMO_ENABLED, DemoController } from './demo/demo.controller.js';
import { UnhandledErrorFilter } from './error-filter.js';
import { HealthController } from './health.controller.js';
import { createMailer, MAILER, type Mailer } from './mail/mailer.js';
import { httpRules } from './http/http-rules.js';
import { SESSION_RESOLVER, type SessionResolver } from './http/session.js';
import { CatalogueService } from './items/catalogue.service.js';
import {
  CategoriesController,
  ItemsController,
  UnitsController,
} from './items/items.controller.js';
import { ItemsService } from './items/items.service.js';
import { AttendanceController } from './attendance/attendance.controller.js';
import { AttendanceService } from './attendance/attendance.service.js';
import { HolidaysController } from './attendance/holidays.controller.js';
import { HolidaysService } from './attendance/holidays.service.js';
import { SettingsController } from './settings/settings.controller.js';
import { SettingsService } from './settings/settings.service.js';
import { SignupController } from './signup/signup.controller.js';
import { SignupService } from './signup/signup.service.js';
import { StaffController } from './staff/staff.controller.js';
import { StaffService } from './staff/staff.service.js';
import { UdhaarController } from './udhaar/udhaar.controller.js';
import { UdhaarService } from './udhaar/udhaar.service.js';
import { StockController } from './stock/stock.controller.js';
import { StockService } from './stock/stock.service.js';

/** Every controller the API serves; the route census test reads this list. */
export const API_CONTROLLERS = [
  HealthController,
  SessionController,
  AccountController,
  DevicesController,
  SettingsController,
  SignupController,
  ItemsController,
  CategoriesController,
  UnitsController,
  StockController,
  BillingController,
  HeldBillsController,
  BillsController,
  CustomersController,
  StaffController,
  BranchesController,
  AlertsController,
  AttendanceController,
  HolidaysController,
  UdhaarController,
  DemoController,
];

export interface AppOptions {
  /** Who is calling; tests may pass a fake. Defaults to the session cookie (ADR 0009). */
  sessions?: SessionResolver;
  /** Tests move time to check the lock and idle rules. */
  clock?: Clock;
  /** Tests fill the Argon2 queue to check the busy answer. */
  hashGate?: HashGate;
  /** Tests read the emails instead of sending them (ADR 0040). */
  mailer?: Mailer;
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
        AccountService,
        DevicesService,
        { provide: CLOCK, useValue: options.clock ?? SYSTEM_CLOCK },
        { provide: DEMO_ENABLED, useValue: config.demoEnabled ?? false },
        {
          provide: MAILER,
          useFactory: () => options.mailer ?? createMailer(config.mail ?? { transport: 'none' }),
        },
        {
          provide: EMAIL_LINKS,
          inject: [MAILER, CLOCK],
          useFactory: (mailer: Mailer, clock: Clock) => {
            const logger = new Logger('Mail');
            const appUrl = config.appUrl ?? DEFAULT_APP_URL;
            return new EmailLinks(mailer, clock, appUrl, (line) => {
              logger.warn(line);
            });
          },
        },
        ItemsService,
        CatalogueService,
        StockService,
        BillingService,
        HeldBillsService,
        BillsService,
        CustomersService,
        StaffService,
        BranchesService,
        AlertsService,
        AttendanceService,
        HolidaysService,
        UdhaarService,
        // One Argon2 queue for signup and logins (ADR 0038).
        { provide: HASH_GATE, useValue: options.hashGate ?? new HashGate() },
        {
          provide: SESSION_SERVICE,
          inject: [DATABASE, HASH_GATE, CLOCK],
          useFactory: (database: Database, gate: HashGate, clock: Clock) => {
            const settings = {
              cookieSecure: config.cookieSecure ?? true,
              emailLimited: config.emailLimited ?? false,
            };
            return new SessionService(database, settings, clock, new LoginLimits(clock), gate);
          },
        },
        // Every route: public or a permission, CSRF, lock (ADRs 0009, 0036).
        ...httpRules(
          options.sessions === undefined
            ? {
                provide: SESSION_RESOLVER,
                inject: [SESSION_SERVICE],
                useFactory: (sessions: SessionService) => new CookieSessionResolver(sessions),
              }
            : { provide: SESSION_RESOLVER, useValue: options.sessions },
        ),
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
