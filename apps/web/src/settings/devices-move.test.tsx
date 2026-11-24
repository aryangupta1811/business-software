// Moving a remembered computer to another branch (P1.6 design §8, Module 00 #56).
import type { DeviceView, SettingsView } from '@business-software/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { branchRoutes, HEAD_OFFICE, MAIN, STALL } from '../test/fake-branches';
import { fakeApi, OWNER_SESSION, renderAt, type FakeAnswer } from '../test/fake-api';
import { OWNER_PASSWORD } from '../test/fake-staff';

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
    stateCode: '27',
    gstin: null,
    drugLicence: null,
    fssai: null,
  },
  features: ['expiry_dates'],
  security: { ownerLockMinutes: 5, staffIdleMinutes: 30 },
  stock: { negativeStock: 'warn' },
  alerts: { types: ['low_stock', 'out_of_stock'] },
  invoices: { invoicePrefix: null },
  udhaar: { overCreditLimit: 'warn' },
  nextInvoice: { financialYear: '2026-27', sequence: 1 },
};

const HERE: DeviceView = {
  id: '00000000-0000-4000-8000-0000000000d1',
  name: null,
  branchId: MAIN.id,
  branchCode: 'HO',
  branchName: MAIN.name,
  createdAt: '2026-11-19T04:30:00.000Z',
  lastSeenAt: '2026-11-19T04:30:00.000Z',
  thisComputer: true,
};
const BACK: DeviceView = {
  ...HERE,
  id: '00000000-0000-4000-8000-0000000000d2',
  name: 'Back counter',
  thisComputer: false,
};

function openSettings(routes: Record<string, FakeAnswer | ((body: unknown) => FakeAnswer)> = {}) {
  const branches = branchRoutes();
  const api = fakeApi(OWNER_SESSION, {
    'GET /api/settings': { body: SETTINGS },
    'GET /api/devices': { body: [HERE, BACK] },
    ...branches.routes,
    ...routes,
  });
  return { api, history: renderAt('/settings') };
}

// The page has an owner's-password box on the recovery key card too: this one is in the dialog.
const ownerBox = () => within(screen.getByRole('dialog')).getByLabelText("Owner's password");

test('moving a computer asks for the owner password and sends the branch', async () => {
  const { api } = openSettings({
    [`PUT /api/devices/${BACK.id}/branch`]: (body) => ({
      body: { ...BACK, branchId: (body as { branchId: string }).branchId, branchName: STALL.name },
    }),
  });
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Move Back counter to another branch' }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Move Back counter' });
  // Only the other branches are offered: it is already in the first.
  const choices = within(dialog).getByLabelText('Move to');
  expect(
    within(choices)
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual([STALL.name]);
  await user.type(ownerBox(), `${OWNER_PASSWORD}{Enter}`);
  await waitFor(() => {
    expect(api.sent('PUT', `/api/devices/${BACK.id}/branch`)).toHaveLength(1);
  });
  expect(api.sent('PUT', `/api/devices/${BACK.id}/branch`)[0]?.body).toEqual({
    branchId: STALL.id,
    ownerPassword: OWNER_PASSWORD,
  });
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(await screen.findByText(new RegExp(`${STALL.name} · last used`))).toBeInTheDocument();
});

test('a wrong owner password stays in the dialog and moves nothing', async () => {
  openSettings({
    [`PUT /api/devices/${BACK.id}/branch`]: { status: 401, body: { code: 'wrong_password' } },
  });
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Move Back counter to another branch' }),
  );
  await screen.findByRole('dialog', { name: 'Move Back counter' });
  await user.type(ownerBox(), 'not the password{Enter}');
  expect(await screen.findByText("That isn't the owner's password")).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Move Back counter' })).toBeInTheDocument();
});

test('moving this computer warns it logs you out, then goes to the login page', async () => {
  let moved = false;
  const { history } = openSettings({
    [`PUT /api/devices/${HERE.id}/branch`]: () => {
      moved = true;
      return { body: { ...HERE, branchId: STALL.id } };
    },
    // The server ended this computer's sessions, so the next read finds no one logged in.
    'GET /api/session': () => ({
      body: moved ? { state: 'none', device: null } : OWNER_SESSION,
    }),
  });
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Move Unnamed computer to another branch' }),
  );
  expect(await screen.findByText(/logs you out here too/)).toBeInTheDocument();
  await user.type(ownerBox(), `${OWNER_PASSWORD}{Enter}`);
  await waitFor(() => {
    expect(history.location.pathname).toBe('/login');
  });
});

test('with one branch there is nothing to move to, so no Move button', async () => {
  fakeApi(OWNER_SESSION, {
    'GET /api/settings': { body: SETTINGS },
    'GET /api/devices': { body: [HERE, BACK] },
    'GET /api/branches': { body: [HEAD_OFFICE] },
  });
  renderAt('/settings');
  await screen.findByText('Back counter');
  expect(screen.queryByRole('button', { name: /Move/ })).toBeNull();
});
