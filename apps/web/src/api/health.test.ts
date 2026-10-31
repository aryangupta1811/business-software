import { describe, expect, test, vi } from 'vitest';
import { fetchReadiness, READINESS_TIMEOUT_MS } from './health';

// packages/db/src/client.ts: the API waits up to this long for a database connection
// before answering 503.
const API_DATABASE_CONNECT_TIMEOUT_MS = 5000;

test('waits clearly longer than the API waits for its database', () => {
  // Otherwise "database down" (a 503 after ~5 s) races the browser's timeout and is
  // shown as "server down" (found in the P0.5 review: 2 of 5 page loads were wrong).
  expect(READINESS_TIMEOUT_MS).toBeGreaterThanOrEqual(API_DATABASE_CONNECT_TIMEOUT_MS * 2);
});

function respond(status: number, body: string) {
  return vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status }));
}

describe('fetchReadiness', () => {
  test('is connected when the API and its database answer', async () => {
    const fetchFn = respond(200, JSON.stringify({ status: 'ok', database: 'ok' }));
    expect(await fetchReadiness(fetchFn)).toBe('connected');
  });

  test('is database-down when the API answers 503 with database unreachable', async () => {
    const fetchFn = respond(503, JSON.stringify({ status: 'error', database: 'unreachable' }));
    expect(await fetchReadiness(fetchFn)).toBe('database-down');
  });

  test('is server-down when the proxy answers with an error page', async () => {
    expect(await fetchReadiness(respond(502, '<html>Bad Gateway</html>'))).toBe('server-down');
  });

  test('is server-down when a 200 answer is not the API (HTML)', async () => {
    expect(await fetchReadiness(respond(200, '<!doctype html><html></html>'))).toBe('server-down');
  });

  test('is server-down when the network request fails', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await fetchReadiness(fetchFn)).toBe('server-down');
  });

  test('is server-down when the request times out', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    expect(await fetchReadiness(fetchFn)).toBe('server-down');
  });

  test('asks /api/health/ready, uncached, with a timeout', async () => {
    const fetchFn = respond(200, JSON.stringify({ status: 'ok', database: 'ok' }));
    await fetchReadiness(fetchFn);
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/health/ready',
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) as unknown }),
    );
  });
});
