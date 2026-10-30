export type Readiness = 'connected' | 'database-down' | 'server-down';

const TIMEOUT_MS = 5000;

/**
 * Asks the API whether it can serve requests. Never rejects: every failure is a state the
 * badge shows. Anything that isn't the API's own JSON (a proxy error page, the web app's
 * index.html, a timeout) means the API itself can't be reached.
 */
export async function fetchReadiness(fetchFn: typeof fetch = fetch): Promise<Readiness> {
  try {
    const response = await fetchFn('/api/health/ready', {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await response.json()) as { database?: unknown };
    if (response.ok && body.database === 'ok') return 'connected';
    if (response.status === 503 && body.database === 'unreachable') return 'database-down';
    return 'server-down';
  } catch {
    return 'server-down';
  }
}
