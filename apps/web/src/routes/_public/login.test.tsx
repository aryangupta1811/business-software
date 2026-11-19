import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { fakeApi, OWNER_SESSION, renderAt, STAFF_SESSION } from '../../test/fake-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const NO_SESSION = { state: 'none', device: null } as const;
const KNOWN_COUNTER = { state: 'none', device: { businessName: 'Sharma Medical' } } as const;

async function logIn(fields: Record<string, string>) {
  const user = userEvent.setup();
  for (const [label, value] of Object.entries(fields)) {
    await user.type(await screen.findByLabelText(label), value);
  }
  await user.click(screen.getByRole('button', { name: 'Log in' }));
}

test('logs the owner in by email and opens the app (#27)', async () => {
  const api = fakeApi(NO_SESSION, { 'POST /api/login': { body: OWNER_SESSION } });
  const history = renderAt('/login');
  // A new computer has no staff tab: only the owner can log in here (#28).
  expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Staff' })).not.toBeInTheDocument();

  await logIn({ Email: 'Owner@Example.com', Password: 'correct horse battery' });

  expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
  expect(history.location.pathname).toBe('/');
  expect(api.sent('POST', '/api/login').map(({ body }) => body)).toEqual([
    { email: 'owner@example.com', password: 'correct horse battery' },
  ]);
  expect(screen.getByText('Ravi Sharma')).toBeInTheDocument();
});

test('says the details are wrong without saying which one', async () => {
  fakeApi(NO_SESSION, { 'POST /api/login': { status: 401, body: { code: 'wrong_login' } } });
  renderAt('/login');
  await logIn({ Email: 'owner@example.com', Password: 'wrong password' });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    "That email and password don't match.",
  );
});

test('says when to try again after too many tries (#41)', async () => {
  const retryAt = new Date(2026, 10, 19, 14, 35).toISOString();
  fakeApi(NO_SESSION, {
    'POST /api/login': { status: 429, body: { code: 'too_many_attempts', retryAt } },
  });
  renderAt('/login');
  await logIn({ Email: 'owner@example.com', Password: 'wrong password' });
  expect(await screen.findByRole('alert')).toHaveTextContent(/Try again at 0?2:35 PM/);
});

test('says when the server cannot be reached', async () => {
  fakeApi(NO_SESSION);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url === '/api/session'
        ? Promise.resolve(Response.json(NO_SESSION))
        : Promise.reject(new TypeError('Failed to fetch')),
    ),
  );
  renderAt('/login');
  await logIn({ Email: 'owner@example.com', Password: 'correct horse battery' });
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't log in.");
});

test('opens on the staff tab on a counter the owner has used (#28)', async () => {
  const api = fakeApi(KNOWN_COUNTER, { 'POST /api/login/staff': { body: STAFF_SESSION } });
  renderAt('/login');
  expect(await screen.findByText('This counter belongs to Sharma Medical.')).toBeInTheDocument();
  const tabs = screen.getByRole('group', { name: 'Who is logging in' });
  expect(within(tabs).getByRole('button', { name: 'Staff' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await logIn({ Username: ' Meena ', Password: 'correct horse battery' });

  expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
  expect(api.sent('POST', '/api/login/staff').map(({ body }) => body)).toEqual([
    { username: 'meena', password: 'correct horse battery' },
  ]);
  // Staff don't lock the counter (#29): only the owner gets "Lock now".
  expect(screen.queryByRole('button', { name: /Lock now/ })).not.toBeInTheDocument();
});

test('lets the owner log in on a counter that opens on the staff tab', async () => {
  fakeApi(KNOWN_COUNTER);
  renderAt('/login');
  await userEvent.click(await screen.findByRole('button', { name: 'Owner' }));
  expect(screen.getByLabelText('Email')).toBeInTheDocument();
  expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
});

test('explains a staff login on a counter the server no longer knows', async () => {
  fakeApi(KNOWN_COUNTER, { 'POST /api/login/staff': { status: 401, body: { code: 'no_device' } } });
  renderAt('/login');
  await logIn({ Username: 'meena', Password: 'correct horse battery' });
  expect(await screen.findByRole('alert')).toHaveTextContent('Ask the owner to log in here once.');
});

test('sends someone already logged in to the app', async () => {
  fakeApi(OWNER_SESSION);
  const history = renderAt('/login');
  expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
  expect(history.location.pathname).toBe('/');
});
