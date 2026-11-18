// Who is calling (ADR 0036). P1.4 provides the real resolver (a session cookie looked up in
// PostgreSQL, ADR 0009); until then nobody is logged in.
import type { Permission } from '@business-software/shared';
import type { IncomingMessage } from 'node:http';

/** The logged-in person a request acts for. */
export interface Caller {
  businessId: string;
  userId: string;
  /** Everything for the owner; the switched-on subset for staff (P1.5). */
  permissions: readonly Permission[];
}

export interface SessionResolver {
  /** The caller, or null when the request carries no live session. */
  resolve(request: IncomingMessage): Promise<Caller | null>;
}

export const SESSION_RESOLVER = 'SESSION_RESOLVER';

/** Until P1.4: no request has a session, so every non-public route answers 401. */
export class NoSessionResolver implements SessionResolver {
  resolve(): Promise<Caller | null> {
    return Promise.resolve(null);
  }
}
