export type Readiness = 'connected' | 'database-down' | 'server-down';

// Longer than the API's own 5 s wait for a database connection, so "database down" (503)
// arrives before the browser gives up (packages/db/src/client.ts).
export const READINESS_TIMEOUT_MS = 10_000;

/**
 * Asks the API whether it can serve requests. Never rejects: every failure is a state the
 * badge shows. Anything that isn't the API's own JSON (a proxy error page, the web app's
 * index.html, a timeout) means the API itself can't be reached.
 */
export async function fetchReadiness(fetchFn: typeof fetch = fetch): Promise<Readiness> {
  try {
    const response = await fetchFn('/api/health/ready', {
      cache: 'no-store',
      signal: AbortSignal.timeout(READINESS_TIMEOUT_MS),
    });
    const body = (await response.json()) as { database?: unknown };
    if (response.ok && body.database === 'ok') return 'connected';
    if (response.status === 503 && body.database === 'unreachable') return 'database-down';
    return 'server-down';
  } catch {
    return 'server-down';
  }
}
