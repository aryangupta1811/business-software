import type { ActiveSession } from '@business-software/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { fakeApi, OWNER_SESSION, renderAt, STAFF_SESSION } from '../test/fake-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const LOCKED = { ...OWNER_SESSION, state: 'locked' } as const;

test('sends a computer with no session to the login page', async () => {
  fakeApi({ state: 'none', device: null });
  const history = renderAt('/settings');
  expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  expect(history.location.pathname).toBe('/login');
});

test("shows who is logged in, with the owner's lock and logout buttons", async () => {
  fakeApi(OWNER_SESSION);
  renderAt('/');
  expect(await screen.findByText('Ravi Sharma')).toBeInTheDocument();
  expect(screen.getByText('Owner · Main shop')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Lock now/ })).toHaveAttribute(
    'aria-keyshortcuts',
    'Alt+L',
  );
  expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
});

test('covers a locked session and keeps the page underneath out of reach (#21)', async () => {
  fakeApi(LOCKED);
  renderAt('/');
  const dialog = await screen.findByRole('dialog', { name: 'Counter locked' });
  expect(dialog).toHaveTextContent('Logged in: Ravi Sharma, Sharma Medical');
  expect(screen.getByLabelText('Password')).toHaveFocus();
  // The page is still there (a half-made bill survives) but can't be used or tabbed into.
  expect(document.querySelector('[inert]')).toContainElement(
    screen.getByRole('heading', { name: 'Home', hidden: true }),
  );
});

test('refuses a wrong password, then unlocks to the same page', async () => {
  let attempts = 0;
  const api = fakeApi(LOCKED, {
    'POST /api/session/unlock': () => {
      attempts += 1;
      return attempts === 1 ? { status: 401, body: { code: 'wrong_password' } } : { status: 204 };
    },
  });
  const history = renderAt('/settings');
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Password'), 'wrong');
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('alert')).toHaveTextContent('Wrong password.');
  expect(screen.getByLabelText('Password')).toHaveValue('');

  await user.type(screen.getByLabelText('Password'), 'correct horse battery');
  await user.keyboard('{Enter}');
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  expect(document.querySelector('[inert]')).toBeNull();
  expect(history.location.pathname).toBe('/settings');
  // Every write carries the session's CSRF token (ADR 0009).
  expect(api.sent('POST', '/api/session/unlock').map(({ headers }) => headers)).toEqual([
    expect.objectContaining({ 'x-csrf-token': 'made-up-csrf-token' }),
    expect.objectContaining({ 'x-csrf-token': 'made-up-csrf-token' }),
  ]);
});

/** A session that `POST /api/logout` ends, leaving the computer remembered (#28). */
function endedByLogout(session: ActiveSession) {
  let ended = false;
  return fakeApi(session, {
    'GET /api/session': () => ({
      body: ended ? { state: 'none', device: { businessName: 'Sharma Medical' } } : session,
    }),
    'POST /api/logout': () => {
      ended = true;
      return { status: 204 };
    },
  });
}

test('"Switch user" logs out and opens the login page', async () => {
  const api = endedByLogout(LOCKED);
  const history = renderAt('/');
  await userEvent.click(await screen.findByRole('button', { name: 'Switch user' }));
  expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  expect(history.location.pathname).toBe('/login');
  expect(api.sent('POST', '/api/logout')).toHaveLength(1);
});

test('"Lock now" covers the screen at once and tells the server (#38)', async () => {
  const api = fakeApi(OWNER_SESSION, { 'POST /api/session/lock': { status: 204 } });
  renderAt('/');
  await userEvent.click(await screen.findByRole('button', { name: /Lock now/ }));
  expect(await screen.findByRole('dialog', { name: 'Counter locked' })).toBeInTheDocument();
  expect(api.sent('POST', '/api/session/lock').map(({ headers }) => headers)).toEqual([
    expect.objectContaining({ 'x-csrf-token': 'made-up-csrf-token' }),
  ]);
});

test('Alt+L locks, and no shortcut works while locked', async () => {
  const api = fakeApi(OWNER_SESSION, { 'POST /api/session/lock': { status: 204 } });
  const history = renderAt('/settings');
  await screen.findByText('Ravi Sharma');
  const user = userEvent.setup();
  await user.keyboard('{Alt>}l{/Alt}');
  expect(await screen.findByRole('dialog', { name: 'Counter locked' })).toBeInTheDocument();
  expect(api.sent('POST', '/api/session/lock')).toHaveLength(1);
  // Alt+H would go home; behind the lock it does nothing.
  await user.keyboard('{Alt>}h{/Alt}');
  expect(history.location.pathname).toBe('/settings');
});

test('the server saying "locked" covers the screen too', async () => {
  let locked = false;
  fakeApi(OWNER_SESSION, {
    'GET /api/session': () => ({ body: locked ? LOCKED : OWNER_SESSION }),
    'GET /api/settings': () => {
      locked = true;
      return { status: 401, body: { code: 'locked' } };
    },
  });
  renderAt('/settings');
  expect(await screen.findByRole('dialog', { name: 'Counter locked' })).toBeInTheDocument();
});

test('"Log out" ends the session and opens the login page', async () => {
  const api = endedByLogout(STAFF_SESSION);
  const history = renderAt('/');
  await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));
  expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  expect(history.location.pathname).toBe('/login');
  expect(api.sent('POST', '/api/logout')).toHaveLength(1);
  // Whatever the last user loaded is gone; the next one starts on the staff tab.
  expect(screen.queryByText('Meena')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Staff' })).toHaveAttribute('aria-pressed', 'true');
});
