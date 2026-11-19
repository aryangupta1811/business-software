// The ways back in (Module 00 #30-#32, #42): forgot password by email or recovery key, the
// reset page and the confirm-email page that emails link to.
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { fakeApi, renderAt } from '../../test/fake-api';
import { madeUpRecoveryKey } from '../../test/made-up-recovery-key';

afterEach(() => {
  vi.unstubAllGlobals();
});

const NO_SESSION = { state: 'none', device: null } as const;
// Made-up values in the shapes the API uses.
const BUSINESS = '00000000-0000-4000-8000-000000000002';
const TOKEN = 'A'.repeat(43);
const NEW_KEY = madeUpRecoveryKey();

async function fill(fields: Record<string, string>) {
  const user = userEvent.setup();
  for (const [label, value] of Object.entries(fields)) {
    await user.type(await screen.findByLabelText(label), value);
  }
  return user;
}

test('the login page links to "Forgot password?"', async () => {
  fakeApi(NO_SESSION);
  const history = renderAt('/login');
  await userEvent.click(await screen.findByRole('link', { name: 'Forgot password?' }));
  expect(await screen.findByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
  expect(history.location.pathname).toBe('/forgot-password');
});

test('asks for a reset link and says the same thing whether or not the email exists', async () => {
  const api = fakeApi(NO_SESSION, {
    'POST /api/password-reset/request': { status: 202, body: null },
  });
  renderAt('/forgot-password');
  const user = await fill({ Email: ' Owner@Example.com ' });
  await user.click(screen.getByRole('button', { name: 'Send link' }));

  expect(await screen.findByRole('status')).toHaveTextContent(
    'If owner@example.com has a confirmed account, a link is on its way.',
  );
  expect(api.sent('POST', '/api/password-reset/request').map(({ body }) => body)).toEqual([
    { email: 'owner@example.com' },
  ]);
});

test('resets with the recovery key and shows the next key once', async () => {
  const api = fakeApi(NO_SESSION, {
    'POST /api/recovery/reset': { body: { recoveryKey: NEW_KEY } },
  });
  const history = renderAt('/forgot-password');
  await userEvent.click(await screen.findByRole('button', { name: 'Recovery key' }));
  const user = await fill({
    Email: 'owner@example.com',
    'Recovery key': 'abcd efgh jkmn pqrs tvwx yz01 2345 6789',
    'New password': 'a much newer password',
  });
  await user.click(screen.getByRole('button', { name: 'Change password' }));

  expect(await screen.findByRole('group', { name: 'Your recovery key' })).toHaveTextContent(
    NEW_KEY,
  );
  expect(screen.getByRole('status')).toHaveTextContent('Your password is changed');
  expect(api.sent('POST', '/api/recovery/reset').map(({ body }) => body)).toEqual([
    {
      email: 'owner@example.com',
      recoveryKey: 'abcd efgh jkmn pqrs tvwx yz01 2345 6789',
      newPassword: 'a much newer password',
    },
  ]);

  // Moving on needs the box ticked, as after signup.
  const toLogin = screen.getByRole('button', { name: 'Go to login' });
  expect(toLogin).toBeDisabled();
  await user.click(screen.getByLabelText('I have written down or printed this key'));
  await user.click(toLogin);
  expect(history.location.pathname).toBe('/login');
});

test('says when the recovery key is wrong, and puts a weak password under its box', async () => {
  let answer: { status: number; body: unknown } = {
    status: 401,
    body: { code: 'wrong_recovery_key' },
  };
  fakeApi(NO_SESSION, { 'POST /api/recovery/reset': () => answer });
  renderAt('/forgot-password');
  await userEvent.click(await screen.findByRole('button', { name: 'Recovery key' }));
  const user = await fill({
    Email: 'owner@example.com',
    'Recovery key': NEW_KEY,
    'New password': 'owner@example.com',
  });
  await user.click(screen.getByRole('button', { name: 'Change password' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    "That email and recovery key don't match.",
  );

  answer = {
    status: 400,
    body: { code: 'invalid_body', fields: { newPassword: 'same_as_email' } },
  };
  await user.click(screen.getByRole('button', { name: 'Change password' }));
  expect(await screen.findByText("Don't use your email as the password")).toBeVisible();
});

test('the reset page sends the link and the new password, then sends you to log in', async () => {
  const api = fakeApi(NO_SESSION, {
    'POST /api/password-reset/complete': { status: 204 },
  });
  renderAt(`/reset/${BUSINESS}/${TOKEN}`);
  // Opening the page uses nothing (a mail scanner may open links).
  expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  expect(api.sent('POST', '/api/password-reset/complete')).toEqual([]);

  const user = await fill({ 'New password': 'a much newer password' });
  await user.click(screen.getByRole('button', { name: 'Save new password' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Your password is changed.');
  expect(screen.getByRole('link', { name: 'Log in' })).toBeVisible();
  expect(api.sent('POST', '/api/password-reset/complete').map(({ body }) => body)).toEqual([
    { businessId: BUSINESS, token: TOKEN, newPassword: 'a much newer password' },
  ]);
});

test('the reset page says when the link has expired or was used', async () => {
  fakeApi(NO_SESSION, {
    'POST /api/password-reset/complete': { status: 400, body: { code: 'invalid_link' } },
  });
  renderAt(`/reset/${BUSINESS}/${TOKEN}`);
  const user = await fill({ 'New password': 'a much newer password' });
  await user.click(screen.getByRole('button', { name: 'Save new password' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This link has expired');
  expect(screen.getByRole('link', { name: 'Ask for a new link' })).toBeVisible();
});

test('the confirm page confirms only when the button is pressed', async () => {
  const api = fakeApi(NO_SESSION, { 'POST /api/email/confirm': { status: 204 } });
  renderAt(`/confirm-email/${BUSINESS}/${TOKEN}`);
  const button = await screen.findByRole('button', { name: 'Confirm email' });
  expect(api.sent('POST', '/api/email/confirm')).toEqual([]);

  await userEvent.click(button);
  expect(await screen.findByRole('status')).toHaveTextContent('Your email is confirmed.');
  expect(api.sent('POST', '/api/email/confirm').map(({ body }) => body)).toEqual([
    { businessId: BUSINESS, token: TOKEN },
  ]);
});

test('the confirm page says when the link has expired or was used', async () => {
  fakeApi(NO_SESSION, {
    'POST /api/email/confirm': { status: 400, body: { code: 'invalid_link' } },
  });
  renderAt(`/confirm-email/${BUSINESS}/${TOKEN}`);
  await userEvent.click(await screen.findByRole('button', { name: 'Confirm email' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Send again');
});
