import type { FieldErrors } from '@business-software/shared';

/**
 * An answer the API gave instead of success. `code` is the API's error code (`email_taken`,
 * `invalid_body`, `not_logged_in`), or `network` when the server couldn't be reached at all.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fields: FieldErrors = {},
    /** With `too_many_attempts`: when trying again is allowed (Module 00 #41). */
    readonly retryAt?: string,
    /** The rest of the answer, such as the item that already has a barcode. */
    readonly detail: Readonly<Record<string, unknown>> = {},
    /** With `busy` (a 503): the seconds the `Retry-After` header asks to wait (ADR 0041). */
    readonly retryAfterSeconds?: number,
  ) {
    super(`API answered ${String(status)} ${code}`);
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

// The session's CSRF token (ADR 0009), from `GET /api/session` or a login. Kept in memory only:
// a reload asks for it again.
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

// Told when an answer says the session is locked or gone, so the screen can follow (#21, #29).
const authListeners = new Set<(code: string) => void>();

export function onAuthError(listener: (code: string) => void): () => void {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

const AUTH_CODES = new Set(['locked', 'not_logged_in', 'session_ended']);

/** Sends JSON to the API and reads JSON back. Every failure becomes an `ApiError`. */
export async function apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken !== null) headers['x-csrf-token'] = csrfToken;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  // A 204 has no body: null.
  const answer = (await response.json().catch(() => null)) as {
    code?: unknown;
    fields?: FieldErrors;
    retryAt?: string;
  } | null;
  if (!response.ok) {
    const code = typeof answer?.code === 'string' ? answer.code : 'server';
    if (response.status === 401 && AUTH_CODES.has(code)) {
      for (const listener of authListeners) listener(code);
    }
    const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
    throw new ApiError(
      response.status,
      code,
      answer?.fields,
      answer?.retryAt,
      answer ?? {},
      Number.isSafeInteger(retryAfter) && retryAfter >= 0 ? retryAfter : undefined,
    );
  }
  return answer as T;
}
