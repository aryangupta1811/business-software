// Who is calling (ADRs 0009, 0036). The real resolver reads the session cookie
// (auth/session.service.ts); tests may pass their own.
import type { Permission } from '@business-software/shared';
import type { IncomingMessage } from 'node:http';

/** The logged-in person a request acts for. */
export interface Caller {
  businessId: string;
  userId: string;
  sessionId: string;
  branchId: string;
  role: 'owner' | 'staff';
  /** Everything for the owner; the switched-on subset for staff (P1.5). */
  permissions: readonly Permission[];
  /** The owner's session after auto-lock (Module 00 #21): only unlock and logout work. */
  locked: boolean;
  /** SHA-256 of the session's CSRF token, checked on every unsafe request (ADR 0009). */
  csrfHash: string;
}

export interface ResolveOptions {
  /** A polling route: it must not count as activity (P1.4 design, section 5). */
  passive: boolean;
}

export interface SessionResolver {
  /**
   * The caller, or null when the request carries no live session. May throw an
   * HttpException, e.g. `401 session_ended` for a session that just ended for inactivity.
   */
  resolve(request: IncomingMessage, options: ResolveOptions): Promise<Caller | null>;
}

export const SESSION_RESOLVER = 'SESSION_RESOLVER';

/** No request has a session: every non-public route answers 401. For tests. */
export class NoSessionResolver implements SessionResolver {
  resolve(): Promise<Caller | null> {
    return Promise.resolve(null);
  }
}
