import type { Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PermissionGuard } from './permission.guard.js';

/**
 * The permission guard on every route (ADRs 0009, 0036) and who the caller is: the one wiring
 * the API and the guard's own tests share. `resolver` provides `SESSION_RESOLVER`.
 */
export function httpRules(resolver: Provider): Provider[] {
  return [resolver, { provide: APP_GUARD, useClass: PermissionGuard }];
}
