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
import { PERMISSION_KEY, PUBLIC_KEY, type RequestWithCaller } from './permission.decorator.js';
import { SESSION_RESOLVER, type SessionResolver } from './session.js';

/**
 * Runs before every route (ADR 0036). Fails closed: a route that names neither `@Public()`
 * nor a permission is a coding mistake and answers 500, never "allowed".
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SESSION_RESOLVER) private readonly sessions: SessionResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_KEY, targets)) return true;
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_KEY,
      targets,
    );
    if (permission === undefined) {
      throw new Error(
        `Route ${context.getClass().name}.${context.getHandler().name} names no permission`,
      );
    }
    const request = context.switchToHttp().getRequest<RequestWithCaller>();
    const caller = await this.sessions.resolve(request);
    if (caller === null) throw new UnauthorizedException({ code: 'not_logged_in' });
    if (!caller.permissions.includes(permission)) {
      throw new ForbiddenException({ code: 'forbidden' });
    }
    request.caller = caller;
    return true;
  }
}
