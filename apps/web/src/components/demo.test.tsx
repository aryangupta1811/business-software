// The public demo's face (ADR 0016's 2026-11-24 note, decision D5): two buttons on the login page,
// and a banner in the demo shop that says it is public and gives its password.
import { DEMO_PASSWORD } from '@business-software/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { fakeApi, OWNER_SESSION, renderAt, STAFF_SESSION } from '../test/fake-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const NO_SESSION = { state: 'none', device: null } as const;
const DEMO_OWNER = { ...OWNER_SESSION, demo: true } as const;

test('offers the two demo buttons only where the server is the demo', async () => {
  fakeApi(NO_SESSION, { 'GET /api/demo': { body: { enabled: false } } });
  renderAt('/login');
  expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Try as the owner' })).not.toBeInTheDocument();
});

test('"Try as the owner" logs in with one click and opens the app', async () => {
  const api = fakeApi(NO_SESSION, {
    'GET /api/demo': { body: { enabled: true } },
    'POST /api/demo/login': { body: DEMO_OWNER },
  });
  renderAt('/login');
  await userEvent.click(await screen.findByRole('button', { name: 'Try as the owner' }));
  expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
  expect(api.sent('POST', '/api/demo/login').map(({ body }) => body)).toEqual([{ as: 'owner' }]);
});

test('"Try as a cashier" asks for the cashier', async () => {
  const api = fakeApi(NO_SESSION, {
    'GET /api/demo': { body: { enabled: true } },
    'POST /api/demo/login': { body: { ...STAFF_SESSION, demo: true } },
  });
  renderAt('/login');
  await userEvent.click(await screen.findByRole('button', { name: 'Try as a cashier' }));
  expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
  expect(api.sent('POST', '/api/demo/login').map(({ body }) => body)).toEqual([{ as: 'cashier' }]);
});

test('says so when the demo is not available, and stays on the login page', async () => {
  fakeApi(NO_SESSION, {
    'GET /api/demo': { body: { enabled: true } },
    'POST /api/demo/login': { status: 404, body: { code: 'demo_unavailable' } },
  });
  renderAt('/login');
  await userEvent.click(await screen.findByRole('button', { name: 'Try as the owner' }));
  expect(await screen.findByRole('alert')).toHaveTextContent("The demo isn't available");
  expect(screen.getByRole('button', { name: 'Try as the owner' })).toBeEnabled();
});

test('the demo shop shows a banner: public, resets, no real data, and its password', async () => {
  fakeApi(DEMO_OWNER);
  renderAt('/');
  const banner = await screen.findByRole('region', { name: 'Public demo' });
  expect(banner).toHaveTextContent('Anyone can see what you type');
  expect(banner).toHaveTextContent("Don't enter real data");
  expect(banner).toHaveTextContent(DEMO_PASSWORD);
});

test('an ordinary business has no banner', async () => {
  fakeApi(OWNER_SESSION);
  renderAt('/');
  expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Public demo' })).not.toBeInTheDocument();
});

test('a refused action explains itself in the banner, whichever screen asked', async () => {
  fakeApi(DEMO_OWNER, {
    'POST /api/recovery-key': { status: 403, body: { code: 'demo_refused' } },
  });
  renderAt('/');
  await screen.findByRole('region', { name: 'Public demo' });
  const { apiRequest } = await import('../api/client');
  await expect(apiRequest('POST', '/api/recovery-key', {})).rejects.toMatchObject({
    code: 'demo_refused',
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('switched off in the public demo');
});
