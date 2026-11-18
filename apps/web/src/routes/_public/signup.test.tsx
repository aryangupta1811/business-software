import { createMemoryHistory } from '@tanstack/react-router';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { App } from '../../app';
import { changeLanguage } from '../../i18n';
import { createQueryClient } from '../../query-client';
import { createAppRouter } from '../../router';
import { forgetRecoveryKey } from '../../signup/pending-key';

// Not a real key: a made-up value in the recovery key's shape.
const MADE_UP_CODE = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789';

// The key lives in memory for the whole test file, as it does for one page load.
beforeEach(() => {
  forgetRecoveryKey();
});

function renderAt(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  render(<App router={createAppRouter(history)} queryClient={createQueryClient()} />);
  return history;
}

/** Answers /api/signup with `status` and `body`; the connection badge's health check too. */
function stubApi(status: number, body: unknown) {
  const fetchMock = vi.fn((url: string) =>
    Promise.resolve(
      url === '/api/signup'
        ? Response.json(body, { status })
        : Response.json({ status: 'ok', database: 'ok' }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function fillIn() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Business name'), 'Sharma Kirana');
  await user.click(screen.getByRole('radio', { name: /Kirana \/ grocery/ }));
  await user.type(screen.getByLabelText('Phone'), '+91 91111 11111');
  await user.selectOptions(screen.getByLabelText('State'), 'Maharashtra');
  await user.click(screen.getByRole('radio', { name: /Regular/ }));
  await user.type(screen.getByLabelText('Your email'), 'Owner@Example.com');
  await user.type(screen.getByLabelText('Password'), 'correct horse battery');
  return user;
}

test('is a page of its own, without the sidebar', async () => {
  stubApi(201, {});
  renderAt('/signup');
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Create your business account' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
});

test('says what is missing, next to each field', async () => {
  stubApi(201, {});
  renderAt('/signup');
  await userEvent.click(await screen.findByRole('button', { name: 'Create account' }));
  expect(await screen.findByLabelText('Business name')).toHaveAccessibleDescription('Fill this in');
  expect(screen.getByLabelText('Your email')).toHaveAccessibleDescription(
    "Fill this in You'll log in with this.",
  );
  expect(screen.getByRole('radiogroup', { name: 'Type of business' })).toHaveAccessibleDescription(
    'Choose one',
  );
  expect(screen.getByLabelText('State')).toHaveAccessibleDescription('Choose one');
});

test('offers only states a shop can stand in', async () => {
  stubApi(201, {});
  renderAt('/signup');
  const state = await screen.findByLabelText('State');
  expect(within(state).getByRole('option', { name: 'Maharashtra' })).toBeInTheDocument();
  expect(within(state).queryByRole('option', { name: 'Other Territory' })).toBeNull();
});

test('says it in Hindi too', async () => {
  stubApi(201, {});
  await changeLanguage('hi');
  renderAt('/signup');
  await userEvent.click(await screen.findByRole('button', { name: 'खाता बनाएँ' }));
  expect(await screen.findByLabelText('व्यापार का नाम')).toHaveAccessibleDescription('यह भरें');
});

test('explains a phone number and a short password in plain words', async () => {
  stubApi(201, {});
  renderAt('/signup');
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Phone'), '12345');
  await user.type(screen.getByLabelText('Password'), 'short');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByLabelText('Phone')).toHaveAccessibleDescription(
    'Enter a 10-digit phone number',
  );
  expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
    /^Use at least 10 characters/,
  );
});

test('shows and hides the password', async () => {
  stubApi(201, {});
  renderAt('/signup');
  const password = await screen.findByLabelText('Password');
  expect(password).toHaveAttribute('type', 'password');
  await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
  expect(password).toHaveAttribute('type', 'text');
  await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
  expect(password).toHaveAttribute('type', 'password');
});

test('sends the cleaned-up form and shows the recovery key, kept only in memory', async () => {
  const fetchMock = stubApi(201, { businessId: 'b-1', recoveryKey: MADE_UP_CODE });
  const history = renderAt('/signup');
  const user = await fillIn();
  await user.click(screen.getByRole('button', { name: 'Create account' }));

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Save your recovery key' }),
  ).toBeInTheDocument();
  const call = fetchMock.mock.calls.find(([url]) => url === '/api/signup') as unknown as [
    string,
    RequestInit,
  ];
  expect(call[1].method).toBe('POST');
  expect(JSON.parse(call[1].body as string)).toEqual({
    businessName: 'Sharma Kirana',
    businessType: 'kirana',
    phone: '9111111111',
    stateCode: '27',
    gstStatus: 'regular',
    email: 'owner@example.com',
    password: 'correct horse battery',
  });
  expect(screen.getByLabelText('Your recovery key')).toHaveTextContent(
    MADE_UP_CODE.replaceAll('-', ''),
  );
  expect(history.location.href).not.toContain('ABCD');
  expect(storedValues(localStorage)).not.toContain('ABCD');
  expect(storedValues(sessionStorage)).not.toContain('ABCD');
});

/** Every value in a Storage, joined: the recovery key must be in none of them. */
function storedValues(storage: Storage) {
  return Array.from({ length: storage.length }, (_, index) => {
    const key = storage.key(index);
    return key === null ? '' : `${key}=${storage.getItem(key) ?? ''}`;
  }).join(' ');
}

test('puts "already has an account" under the email', async () => {
  stubApi(409, { code: 'email_taken' });
  renderAt('/signup');
  const user = await fillIn();
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByLabelText('Your email')).toHaveAccessibleDescription(
    /^This email already has an account/,
  );
});

test('says when the account could not be created', async () => {
  stubApi(500, { statusCode: 500, message: 'Internal Server Error' });
  renderAt('/signup');
  const user = await fillIn();
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't create the account");
});

test('the key screen waits for "I have written it down" before going on', async () => {
  stubApi(201, { businessId: 'b-1', recoveryKey: MADE_UP_CODE });
  renderAt('/signup');
  const user = await fillIn();
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  const next = await screen.findByRole('button', { name: 'Continue' });
  expect(next).toBeDisabled();
  await user.click(
    screen.getByRole('checkbox', { name: 'I have written down or printed this key' }),
  );
  expect(next).toBeEnabled();
});

test('copies the key', async () => {
  stubApi(201, { businessId: 'b-1', recoveryKey: MADE_UP_CODE });
  renderAt('/signup');
  const user = await fillIn();
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  const copy = await screen.findByRole('button', { name: 'Copy' });
  const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await user.click(copy);
  expect(writeText).toHaveBeenCalledWith(MADE_UP_CODE);
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
});

// Browser Back to the form, then Forward: the shared counter's next person mustn't see it.
test('the key is gone once the form is back on screen', async () => {
  stubApi(201, { businessId: 'b-1', recoveryKey: MADE_UP_CODE });
  const history = renderAt('/signup');
  const user = await fillIn();
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByLabelText('Your recovery key');

  act(() => {
    history.back();
  });
  await screen.findByRole('heading', { level: 1, name: 'Create your business account' });
  act(() => {
    history.forward();
  });
  expect(
    await screen.findByRole('heading', { name: 'The key is shown only once' }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText('Your recovery key')).toBeNull();
});

test('a fresh visit to the key screen explains the key is gone', async () => {
  stubApi(201, {});
  renderAt('/signup/recovery-key');
  const card = await screen.findByRole('heading', { name: 'The key is shown only once' });
  expect(card).toBeInTheDocument();
  expect(within(document.body).queryByLabelText('Your recovery key')).toBeNull();
});
