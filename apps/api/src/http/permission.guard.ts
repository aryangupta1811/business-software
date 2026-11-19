import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@business-software/shared';
import { tokenMatches } from '../auth/tokens.js';
import {
  ALLOW_LOCKED_KEY,
  PASSIVE_KEY,
  PERMISSION_KEY,
  PUBLIC_KEY,
  type RequestWithCaller,
} from './permission.decorator.js';
import { SESSION_RESOLVER, type SessionResolver } from './session.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * A request another site's page made the browser send (CSRF). Chrome sends Sec-Fetch-Site on
 * every request; Origin is the fallback. A request with neither isn't from a browser page, so
 * it carries no victim's cookies. Dev's Vite proxy rewrites Host, which is why Sec-Fetch-Site
 * is read first.
 */
function isCrossSite(request: RequestWithCaller): boolean {
  const site = request.headers['sec-fetch-site'];
  if (typeof site === 'string') return site !== 'same-origin' && site !== 'none';
  const origin = request.headers.origin;
  if (typeof origin !== 'string') return false;
  return !URL.canParse(origin) || new URL(origin).host !== request.headers.host;
}

/**
 * Runs before every route (ADRs 0009, 0036). Fails closed: a route that names neither
 * `@Public()` nor a permission is a coding mistake and answers 500, never "allowed".
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SESSION_RESOLVER) private readonly sessions: SessionResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const flag = (key: string) =>
      this.reflector.getAllAndOverride<boolean | undefined>(key, targets) === true;
    const request = context.switchToHttp().getRequest<RequestWithCaller>();
    const unsafe = !SAFE_METHODS.has(request.method ?? 'GET');
    // Login CSRF and every other cross-site write, public routes included (P1.4 design, 8).
    if (unsafe && isCrossSite(request)) throw new ForbiddenException({ code: 'cross_site' });
    if (flag(PUBLIC_KEY)) return true;
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_KEY,
      targets,
    );
    if (permission === undefined) {
      throw new Error(
        `Route ${context.getClass().name}.${context.getHandler().name} names no permission`,
      );
    }
    const caller = await this.sessions.resolve(request, { passive: flag(PASSIVE_KEY) });
    if (caller === null) throw new UnauthorizedException({ code: 'not_logged_in' });
    if (caller.locked && !flag(ALLOW_LOCKED_KEY)) {
      throw new UnauthorizedException({ code: 'locked' });
    }
    if (unsafe) {
      const token = request.headers['x-csrf-token'];
      if (typeof token !== 'string' || !tokenMatches(token, caller.csrfHash)) {
        throw new ForbiddenException({ code: 'csrf' });
      }
    }
    if (!caller.permissions.includes(permission)) {
      throw new ForbiddenException({ code: 'forbidden' });
    }
    request.caller = caller;
    return true;
  }
}
