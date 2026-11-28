// Settings' own-login cards: password (#46), recovery key (#31) and computers (#44).
import type { DeviceView, SettingsView } from '@business-software/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { fakeApi, OWNER_SESSION, renderAt, type FakeAnswer } from '../test/fake-api';
import { HEAD_OFFICE } from '../test/fake-branches';
import { madeUpRecoveryKey } from '../test/made-up-recovery-key';

afterEach(() => {
  vi.unstubAllGlobals();
});

const SETTINGS: SettingsView = {
  business: {
    businessName: 'Sharma Medical',
    businessType: 'medical',
    phone: '9111111111',
    gstStatus: 'regular',
    pan: null,
    ownerName: 'Ravi Sharma',
    branchName: 'Main shop',
    address: null,
    pinCode: null,
    stateCode: '07',
    gstin: null,
    drugLicence: null,
    fssai: null,
  },
  features: ['expiry_dates'],
  security: { ownerLockMinutes: 5, staffIdleMinutes: 30 },
  stock: { negativeStock: 'warn' },
  alerts: { types: ['low_stock', 'out_of_stock'] },
  invoices: { invoicePrefix: null },
  printing: { billLanguage: 'en', footerNote: null },
  udhaar: { overCreditLimit: 'warn' },
  nextInvoice: { financialYear: '2026-27', sequence: 1 },
};

const HERE: DeviceView = {
  id: '00000000-0000-4000-8000-0000000000d1',
  name: null,
  branchId: '00000000-0000-4000-8000-000000000003',
  branchCode: 'HO',
  branchName: 'Main shop',
  createdAt: '2026-11-19T04:30:00.000Z',
  lastSeenAt: '2026-11-19T04:30:00.000Z',
  thisComputer: true,
  printing: { receiptSize: 80, autoPrint: true },
};
const BACK: DeviceView = {
  ...HERE,
  id: '00000000-0000-4000-8000-0000000000d2',
  name: 'Back counter',
  thisComputer: false,
};

function openSettings(routes: Record<string, FakeAnswer | ((body: unknown) => FakeAnswer)>) {
  const api = fakeApi(OWNER_SESSION, {
    'GET /api/settings': { body: SETTINGS },
    'GET /api/devices': { body: [HERE, BACK] },
    // One branch: no Move button.
    'GET /api/branches': { body: [HEAD_OFFICE] },
    ...routes,
  });
  const history = renderAt('/settings');
  return { api, history };
}

const card = async (name: string) => screen.findByRole('region', { name });

test('changes the password with the current one, and says a wrong one under its box', async () => {
  let answer: FakeAnswer = { status: 401, body: { code: 'wrong_password' } };
  const { api } = openSettings({ 'POST /api/password': () => answer });
  const password = within(await card('Password'));
  const user = userEvent.setup();
  await user.type(password.getByLabelText('Current password'), 'not my password');
  await user.type(password.getByLabelText('New password'), 'a much newer password');
  await user.click(password.getByRole('button', { name: 'Change password' }));
  expect(await password.findByText("That isn't your current password")).toBeVisible();

  answer = { status: 204 };
  await user.clear(password.getByLabelText('Current password'));
  await user.type(password.getByLabelText('Current password'), 'correct horse battery');
  await user.click(password.getByRole('button', { name: 'Change password' }));
  expect(await password.findByRole('status')).toHaveTextContent('Other computers are logged out.');
  expect(api.sent('POST', '/api/password').at(-1)?.body).toEqual({
    currentPassword: 'correct horse battery',
    newPassword: 'a much newer password',
  });
});

test('makes a new recovery key with the owner password and shows it once', async () => {
  const recoveryKey = madeUpRecoveryKey();
  const { api } = openSettings({ 'POST /api/recovery-key': { body: { recoveryKey } } });
  const region = within(await card('Recovery key'));
  const user = userEvent.setup();
  await user.type(region.getByLabelText("Owner's password"), 'correct horse battery');
  await user.click(region.getByRole('button', { name: 'Make a new key' }));

  expect(await region.findByRole('group', { name: 'Your recovery key' })).toHaveTextContent(
    recoveryKey,
  );
  expect(api.sent('POST', '/api/recovery-key').map(({ body }) => body)).toEqual([
    { ownerPassword: 'correct horse battery' },
  ]);
  await user.click(region.getByLabelText('I have written down or printed this key'));
  await user.click(region.getByRole('button', { name: 'Done' }));
  expect(region.queryByRole('group', { name: 'Your recovery key' })).not.toBeInTheDocument();
});

test('lists the computers, renames one and forgets another with the owner password', async () => {
  const { api } = openSettings({
    'PUT /api/devices/00000000-0000-4000-8000-0000000000d1/name': (body) => ({
      body: { ...HERE, name: (body as { name: string }).name },
    }),
    'POST /api/devices/00000000-0000-4000-8000-0000000000d2/forget': { status: 204 },
  });
  const region = within(await card('Computers'));
  expect(await region.findByText('Unnamed computer')).toBeVisible();
  expect(region.getByText('This computer')).toBeVisible();
  const user = userEvent.setup();

  await user.click(region.getByRole('button', { name: 'Rename Unnamed computer' }));
  await user.type(region.getByLabelText('Name'), 'Front counter');
  await user.click(region.getByRole('button', { name: 'Save' }));
  expect(await region.findByText('Front counter')).toBeVisible();

  await user.click(region.getByRole('button', { name: 'Forget Back counter' }));
  await user.type(region.getByLabelText("Owner's password"), 'correct horse battery');
  await user.click(region.getByRole('button', { name: 'Forget computer' }));
  await vi.waitFor(() => {
    expect(region.queryByText('Back counter')).not.toBeInTheDocument();
  });
  expect(
    api.sent('POST', '/api/devices/00000000-0000-4000-8000-0000000000d2/forget')[0]?.body,
  ).toEqual({ ownerPassword: 'correct horse battery' });
});

test('Rename and Forget put the cursor in their box, and Cancel puts it back on the button', async () => {
  openSettings({});
  const region = within(await card('Computers'));
  const user = userEvent.setup();

  await user.click(await region.findByRole('button', { name: 'Rename Back counter' }));
  expect(region.getByLabelText('Name')).toHaveFocus();
  await user.click(region.getByRole('button', { name: 'Cancel' }));
  expect(region.getByRole('button', { name: 'Rename Back counter' })).toHaveFocus();

  await user.click(region.getByRole('button', { name: 'Forget Back counter' }));
  expect(region.getByLabelText("Owner's password")).toHaveFocus();
  await user.click(region.getByRole('button', { name: 'Cancel' }));
  expect(region.getByRole('button', { name: 'Forget Back counter' })).toHaveFocus();
});

test('forgetting this computer goes to the login page', async () => {
  // Like the real server: once this computer is forgotten, its session and memory are gone.
  let forgotten = false;
  const { history } = openSettings({
    'POST /api/devices/00000000-0000-4000-8000-0000000000d1/forget': () => {
      forgotten = true;
      return { status: 204 };
    },
    'GET /api/session': () => ({
      body: forgotten ? { state: 'none', device: null } : OWNER_SESSION,
    }),
    'GET /api/settings': () =>
      forgotten ? { status: 401, body: { code: 'not_logged_in' } } : { body: SETTINGS },
  });
  const region = within(await card('Computers'));
  const user = userEvent.setup();
  await user.click(await region.findByRole('button', { name: 'Forget Unnamed computer' }));
  expect(region.getByText(/This logs you out here/)).toBeVisible();
  await user.type(region.getByLabelText("Owner's password"), 'correct horse battery');
  await user.click(region.getByRole('button', { name: 'Forget computer' }));
  expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  expect(history.location.pathname).toBe('/login');
});
