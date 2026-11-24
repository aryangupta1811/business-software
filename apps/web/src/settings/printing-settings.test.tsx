// Settings, Printing (P1.15; `02` #17, #29, #30): the bill language and footer, the test print,
// and how this computer prints.
import type { DeviceView, SettingsView } from '@business-software/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { printBill } from '../printing/print-bill';
import { fakeApi, OWNER_SESSION, renderAt, type FakeAnswer } from '../test/fake-api';

vi.mock('../printing/print-bill', () => ({ printBill: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  vi.mocked(printBill).mockClear();
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
  printing: { billLanguage: 'en', footerNote: null },
  udhaar: { overCreditLimit: 'warn' },
  nextInvoice: { financialYear: '2026-27', sequence: 1 },
};

const HERE: DeviceView = {
  id: '00000000-0000-4000-8000-0000000000d1',
  name: null,
  branchId: OWNER_SESSION.branch.id,
  branchCode: 'HO',
  branchName: 'Main shop',
  createdAt: '2026-11-19T04:30:00.000Z',
  lastSeenAt: '2026-11-19T04:30:00.000Z',
  thisComputer: true,
  printing: { receiptSize: 80, autoPrint: true },
};

function openSettings(routes: Record<string, FakeAnswer | ((body: unknown) => FakeAnswer)> = {}) {
  return fakeApi(OWNER_SESSION, {
    'GET /api/settings': { body: SETTINGS },
    'GET /api/devices': { body: [HERE] },
    'GET /api/branches': { body: [] },
    ...routes,
  });
}

const printingCard = () => screen.findByRole('region', { name: 'Printing' });

test('saves the bill language and the footer note, a blank note as none', async () => {
  const user = userEvent.setup();
  const api = openSettings({
    'PUT /api/settings/printing': (body) => ({ body: { ...SETTINGS, printing: body } }),
  });
  renderAt('/settings');
  const card = within(await printingCard());
  await user.selectOptions(card.getByLabelText('Bill language'), 'hi');
  await user.type(card.getByLabelText('Note at the bottom of every bill'), 'Goods once sold');
  await user.click(card.getByRole('button', { name: 'Save' }));
  await waitFor(() => {
    expect(api.sent('PUT', '/api/settings/printing')).toHaveLength(1);
  });
  expect(api.sent('PUT', '/api/settings/printing')[0]?.body).toEqual({
    billLanguage: 'hi',
    footerNote: 'Goods once sold',
  });
  expect(await card.findByText('Saved')).toBeInTheDocument();
});

test('sends an emptied note as none', async () => {
  const user = userEvent.setup();
  const api = openSettings({
    'GET /api/settings': {
      body: { ...SETTINGS, printing: { billLanguage: 'hi-Latn', footerNote: 'Dhanyavaad' } },
    },
    'PUT /api/settings/printing': (body) => ({ body: { ...SETTINGS, printing: body } }),
  });
  renderAt('/settings');
  const card = within(await printingCard());
  await user.clear(card.getByLabelText('Note at the bottom of every bill'));
  await user.click(card.getByRole('button', { name: 'Save' }));
  await waitFor(() => {
    expect(api.sent('PUT', '/api/settings/printing')).toHaveLength(1);
  });
  expect(api.sent('PUT', '/api/settings/printing')[0]?.body).toEqual({
    billLanguage: 'hi-Latn',
    footerNote: null,
  });
});

test('refuses a note of more than 200 characters without asking the server', async () => {
  const user = userEvent.setup();
  const api = openSettings();
  renderAt('/settings');
  const card = within(await printingCard());
  await user.click(card.getByLabelText('Note at the bottom of every bill'));
  await user.paste('x'.repeat(201));
  await user.click(card.getByRole('button', { name: 'Save' }));
  expect(await card.findByText(/too long|at most|Too long/i)).toBeInTheDocument();
  expect(api.sent('PUT', '/api/settings/printing')).toHaveLength(0);
});

test('test-prints a made-up bill in the chosen language, at this computer’s paper and on A4', async () => {
  const user = userEvent.setup();
  openSettings();
  renderAt('/settings');
  const card = within(await printingCard());
  await user.selectOptions(card.getByLabelText('Bill language'), 'hi');
  await user.click(card.getByRole('button', { name: 'Test 80 mm receipt' }));
  await waitFor(() => {
    expect(printBill).toHaveBeenCalledTimes(1);
  });
  expect(printBill).toHaveBeenLastCalledWith(
    expect.objectContaining({ language: 'hi', document: 'tax_invoice', footerNote: null }),
    '80',
    null,
  );
  await user.click(card.getByRole('button', { name: 'Test A4 invoice' }));
  await waitFor(() => {
    expect(printBill).toHaveBeenLastCalledWith(expect.anything(), 'a4', null);
  });
});

test('says when the test print failed', async () => {
  const user = userEvent.setup();
  vi.mocked(printBill).mockRejectedValueOnce(new Error('no printer'));
  openSettings();
  renderAt('/settings');
  const card = within(await printingCard());
  await user.click(card.getByRole('button', { name: 'Test A4 invoice' }));
  expect(await card.findByRole('alert')).toHaveTextContent("Couldn't print the test");
});

test('explains the one-time kiosk-printing setup', async () => {
  openSettings();
  renderAt('/settings');
  const card = within(await printingCard());
  expect(card.getByText('Print with one key, no dialog')).toBeInTheDocument();
  expect(card.getByText(/--kiosk-printing at the end of Target/)).toBeInTheDocument();
});

test("sets this computer's receipt paper and auto-print, saved as soon as they change", async () => {
  const user = userEvent.setup();
  const api = openSettings({
    [`PUT /api/devices/${HERE.id}/printing`]: (body) => ({
      body: { ...HERE, printing: body },
    }),
  });
  renderAt('/settings');
  const computer = within(await screen.findByRole('group', { name: 'Printing on this computer' }));
  expect(computer.getByLabelText('Receipt paper')).toHaveValue('80');
  expect(
    computer.getByRole('checkbox', { name: /Print the receipt when a bill is saved/ }),
  ).toBeChecked();

  await user.selectOptions(computer.getByLabelText('Receipt paper'), '58');
  await waitFor(() => {
    expect(api.sent('PUT', `/api/devices/${HERE.id}/printing`)).toHaveLength(1);
  });
  expect(api.sent('PUT', `/api/devices/${HERE.id}/printing`)[0]?.body).toEqual({
    receiptSize: 58,
    autoPrint: true,
  });

  await user.click(
    computer.getByRole('checkbox', { name: /Print the receipt when a bill is saved/ }),
  );
  await waitFor(() => {
    expect(api.sent('PUT', `/api/devices/${HERE.id}/printing`)).toHaveLength(2);
  });
  expect(api.sent('PUT', `/api/devices/${HERE.id}/printing`)[1]?.body).toEqual({
    receiptSize: 58,
    autoPrint: false,
  });
  // The session is read again, so this counter's save uses the new settings.
  expect(api.sent('GET', '/api/session').length).toBeGreaterThan(1);
});
