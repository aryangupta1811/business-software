import {
  effectivePermissions,
  PERMISSIONS,
  type ActiveSession,
  type SessionView,
} from '@business-software/shared';
import { createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../app';
import { createQueryClient } from '../query-client';
import { createAppRouter } from '../router';

// Made-up IDs and names, never real ones.
export const OWNER_SESSION: ActiveSession = {
  state: 'active',
  user: { id: '00000000-0000-4000-8000-000000000001', role: 'owner', name: 'Ravi Sharma' },
  business: { id: '00000000-0000-4000-8000-000000000002', name: 'Sharma Medical' },
  branch: { id: '00000000-0000-4000-8000-000000000003', code: 'HO', name: 'Main shop' },
  csrfToken: 'made-up-csrf-token',
  idleMinutes: 5,
  emailConfirmed: true,
  emailLimited: false,
  discountLimitBasisPoints: null,
  permissions: [...PERMISSIONS],
};

export const STAFF_SESSION: ActiveSession = {
  ...OWNER_SESSION,
  user: { id: '00000000-0000-4000-8000-000000000004', role: 'staff', name: 'Meena' },
  idleMinutes: 30,
  discountLimitBasisPoints: 0,
  permissions: effectivePermissions({ added: [], removed: [] }),
};

export interface FakeAnswer {
  status?: number;
  body?: unknown;
  /** The connection drops: `fetch` rejects, as it does with no network. */
  fail?: boolean;
  /** The answer comes only after this promise settles (a request still on its way). */
  wait?: Promise<unknown>;
}

/**
 * Stands in for the API: `routes` maps "METHOD /path" to an answer (or a function making one).
 * `GET /api/session` answers `session`, an unlisted `GET /api/holidays` an empty calendar; anything else unlisted answers the health check. A
 * route function gets the request body and the URL.
 */
export function fakeApi(
  session: SessionView,
  routes: Record<string, FakeAnswer | ((body: unknown, url: string) => FakeAnswer)> = {},
) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    // A route listed without its query string answers every query (`GET /api/staff?...`).
    const route = routes[`${method} ${url}`] ?? routes[`${method} ${url.split('?')[0] ?? url}`];
    const answer =
      typeof route === 'function'
        ? route(body, url)
        : (route ??
          (url === '/api/session'
            ? { body: session }
            : // The Settings page lists the shop holidays; most tests have none.
              method === 'GET' && url.startsWith('/api/holidays')
              ? { body: [] }
              : { body: { status: 'ok', database: 'ok' } }));
    const status = answer.status ?? 200;
    if (answer.fail === true) return Promise.reject(new TypeError('fetch failed'));
    const response =
      status === 204 ? new Response(null, { status }) : Response.json(answer.body, { status });
    return answer.wait === undefined ? Promise.resolve(response) : answer.wait.then(() => response);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    /** The requests sent to `METHOD /path`, as [body, headers]. */
    sent(method: string, path: string) {
      return fetchMock.mock.calls
        .filter(([url, init]) => url === path && (init?.method ?? 'GET') === method)
        .map(([, init]) => ({
          body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
          headers: (init?.headers ?? {}) as Record<string, string>,
        }));
    },
  };
}

export function renderAt(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  render(<App router={createAppRouter(history)} queryClient={createQueryClient()} />);
  return history;
}
