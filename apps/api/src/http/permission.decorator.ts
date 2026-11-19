// Every route says who may call it (ADR 0036): `@Public()` or `@Permission('…')`.
import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Permission as PermissionName } from '@business-software/shared';
import type { IncomingMessage } from 'node:http';
import type { Caller } from './session.js';

export const PUBLIC_KEY = 'route:public';
export const PERMISSION_KEY = 'route:permission';
export const ALLOW_LOCKED_KEY = 'route:allow-locked';

/** Anyone may call this route, logged in or not (signup, health). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Only a caller holding this permission may call the route; the owner holds them all. */
export const Permission = (permission: PermissionName) => SetMetadata(PERMISSION_KEY, permission);

/** Works on a locked owner session too (unlock, log out). Every other route answers 401 locked. */
export const AllowLocked = () => SetMetadata(ALLOW_LOCKED_KEY, true);

/** The request as the permission guard leaves it. */
export interface RequestWithCaller extends IncomingMessage {
  caller?: Caller;
}

/** The caller the permission guard checked; only on routes with `@Permission`. */
export const CurrentCaller = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const caller = context.switchToHttp().getRequest<RequestWithCaller>().caller;
  if (caller === undefined) throw new Error('@CurrentCaller() used on a route without @Permission');
  return caller;
});
