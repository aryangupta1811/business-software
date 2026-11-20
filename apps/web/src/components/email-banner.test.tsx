// Module 00 #32, #45: the banner that asks the owner to confirm their email.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { fakeApi, OWNER_SESSION, renderAt, STAFF_SESSION } from '../test/fake-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const UNCONFIRMED = { ...OWNER_SESSION, emailConfirmed: false };

test('asks an unconfirmed owner to confirm, and sends the link again', async () => {
  const api = fakeApi(UNCONFIRMED, { 'POST /api/email/confirm/send': { status: 204 } });
  renderAt('/');
  const banner = await screen.findByRole('region', { name: 'Email confirmation' });
  expect(banner).toHaveTextContent('Confirm your email');
  // Not in the demo: no word about verified addresses.
  expect(banner).not.toHaveTextContent('In this demo');

  await userEvent.click(screen.getByRole('button', { name: 'Send again' }));
  // The connection badge is a status too: look inside the banner.
  expect(await within(banner).findByRole('status')).toHaveTextContent('Sent.');
  expect(api.sent('POST', '/api/email/confirm/send')).toHaveLength(1);
});

test('in the demo, points to the recovery key (#45)', async () => {
  fakeApi({ ...UNCONFIRMED, emailLimited: true });
  renderAt('/');
  expect(await screen.findByRole('region', { name: 'Email confirmation' })).toHaveTextContent(
    'In this demo, email reaches only addresses we have verified.',
  );
});

test('says when to try again after too many sends', async () => {
  const retryAt = new Date(2026, 10, 19, 14, 35).toISOString();
  fakeApi(UNCONFIRMED, {
    'POST /api/email/confirm/send': { status: 429, body: { code: 'too_many_attempts', retryAt } },
  });
  renderAt('/');
  await userEvent.click(await screen.findByRole('button', { name: 'Send again' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Try again at 0?2:35 PM/);
});

test.each([
  ['a confirmed owner', OWNER_SESSION],
  ['staff, who have no email', { ...STAFF_SESSION, emailConfirmed: false }],
])('shows nothing to %s', async (_who, session) => {
  fakeApi(session);
  renderAt('/');
  expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Email confirmation' })).not.toBeInTheDocument();
});
