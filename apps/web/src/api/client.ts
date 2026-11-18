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
  ) {
    super(`API answered ${String(status)} ${code}`);
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

/** Sends JSON to the API and reads JSON back. Every failure becomes an `ApiError`. */
export async function apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  const answer = (await response.json().catch(() => null)) as {
    code?: unknown;
    fields?: FieldErrors;
  } | null;
  if (!response.ok) {
    const code = typeof answer?.code === 'string' ? answer.code : 'server';
    throw new ApiError(response.status, code, answer?.fields);
  }
  return answer as T;
}
