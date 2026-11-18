import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PermissionGuard } from './permission.guard.js';
import { NoSessionResolver, SESSION_RESOLVER, type SessionResolver } from './session.js';

/** The permission guard on every route, and who the caller is. Tests pass their own resolver. */
@Module({})
export class HttpRulesModule {
  static register(sessions: SessionResolver = new NoSessionResolver()): DynamicModule {
    return {
      module: HttpRulesModule,
      providers: [
        { provide: SESSION_RESOLVER, useValue: sessions },
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
    };
  }
}
