import type { BranchView, SettingsView } from '@business-software/shared';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { App } from '../../app';
import { createQueryClient } from '../../query-client';
import { createAppRouter } from '../../router';
import { OWNER_SESSION } from '../../test/fake-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const VIEW: SettingsView = {
  business: {
    businessName: 'Sharma Medical',
    businessType: 'medical',
    phone: '9111111111',
    gstStatus: 'regular',
    pan: null,
    ownerName: 'Ravi Sharma',
    branchName: 'Sharma Medical',
    address: null,
    pinCode: null,
    stateCode: '07',
    gstin: null,
    drugLicence: null,
    fssai: null,
  },
  // A kirana preset on a medical store: the owner changed the type and kept the switches.
  features: ['loose_weight', 'expiry_dates', 'udhaar_prominent'],
  security: { ownerLockMinutes: 5, staffIdleMinutes: 30 },
  stock: { negativeStock: 'warn' },
  alerts: { types: ['low_stock', 'out_of_stock'] },
  invoices: { invoicePrefix: null },
  printing: { billLanguage: 'en', footerNote: null },
  udhaar: { overCreditLimit: 'warn' },
  nextInvoice: { financialYear: '2026-27', sequence: 7 },
};

const HEAD_OFFICE: BranchView = {
  id: OWNER_SESSION.branch.id,
  code: 'HO',
  name: 'Sharma Medical',
  address: null,
  pinCode: null,
  stateCode: '07',
  gstin: null,
  drugLicence: null,
  fssai: null,
  headOffice: true,
  archived: false,
  computers: 1,
  staff: 0,
};

/**
 * The owner is logged in; GET /api/settings answers `load`, every PUT the view it was sent
 * merged in.
 */
function stubApi(load: { status: number; body: unknown }, branches: BranchView[] = [HEAD_OFFICE]) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/session') return Promise.resolve(Response.json(OWNER_SESSION));
    if (url === '/api/settings') return Promise.resolve(Response.json(load.body, load));
    if (url === '/api/devices') return Promise.resolve(Response.json([]));
    if (url.startsWith('/api/holidays')) return Promise.resolve(Response.json([]));
    if (url.startsWith('/api/branches')) return Promise.resolve(Response.json(branches));
    if (url.startsWith('/api/settings/')) {
      const card = url.slice('/api/settings/'.length);
      const sent = JSON.parse(init?.body as string) as Record<string, unknown>;
      const saved = { ...VIEW, [card]: card === 'features' ? sent.features : sent };
      return Promise.resolve(Response.json(saved));
    }
    return Promise.resolve(Response.json({ status: 'ok', database: 'ok' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function putsTo(fetchMock: ReturnType<typeof stubApi>, card: string) {
  return fetchMock.mock.calls
    .filter(([url, init]) => url === `/api/settings/${card}` && init?.method === 'PUT')
    .map(([, init]) => JSON.parse(init?.body as string) as unknown);
}

function renderSettings() {
  const history = createMemoryHistory({ initialEntries: ['/settings'] });
  render(<App router={createAppRouter(history)} queryClient={createQueryClient()} />);
}

const card = (name: string) => screen.findByRole('region', { name });

test('asks to log in when the API says no one is', async () => {
  stubApi({ status: 401, body: { code: 'not_logged_in' } });
  renderSettings();
  expect(
    await screen.findByRole('heading', { name: 'Log in to see settings' }),
  ).toBeInTheDocument();
  const nav = screen.getByRole('navigation', { name: 'Main' });
  // Only the page you're on is marked: Home isn't "active" just because every path starts with /.
  expect(within(nav).getByRole('link', { name: /^Home/ })).not.toHaveAttribute('aria-current');
  expect(within(nav).getByRole('link', { name: 'Settings' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(within(nav).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
});

test("fills each card with the business's settings", async () => {
  stubApi({ status: 200, body: VIEW });
  renderSettings();
  const business = within(await card('Business details'));
  expect(business.getByLabelText('Business name')).toHaveValue('Sharma Medical');
  expect(business.getByLabelText('State')).toHaveValue('07');
  expect(business.getByLabelText('PAN')).toHaveValue('');
  const features = within(await card('Features'));
  expect(features.getByRole('checkbox', { name: /^Expiry dates/ })).toBeChecked();
  expect(features.getByRole('checkbox', { name: /^Batch numbers/ })).not.toBeChecked();
  const security = within(await card('Security'));
  expect(security.getByLabelText('Staff logout after')).toHaveValue(30);
});

test('saves the business card whole, blanks as null', async () => {
  const fetchMock = stubApi({ status: 200, body: VIEW });
  renderSettings();
  const user = userEvent.setup();
  const business = within(await card('Business details'));
  await user.clear(business.getByLabelText('Business name'));
  await user.type(business.getByLabelText('Business name'), 'Sharma Medicos');
  await user.type(business.getByLabelText('PIN code'), '110001');
  await user.click(business.getByRole('button', { name: 'Save' }));
  expect(await business.findByRole('status')).toHaveTextContent('Saved');
  expect(putsTo(fetchMock, 'business')).toEqual([
    { ...VIEW.business, businessName: 'Sharma Medicos', pinCode: '110001' },
  ]);
});

test("refuses a GSTIN from another state, in the GSTIN field's own words", async () => {
  const fetchMock = stubApi({ status: 200, body: VIEW });
  renderSettings();
  const user = userEvent.setup();
  const business = within(await card('Business details'));
  await user.type(business.getByLabelText('GSTIN'), '27abcde1234f1z0');
  await user.click(business.getByRole('button', { name: 'Save' }));
  expect(await business.findByLabelText('GSTIN')).toHaveAccessibleDescription(
    "The GSTIN's first two digits must match the state",
  );
  expect(putsTo(fetchMock, 'business')).toEqual([]);
});

test('marks the switches built later as "Coming later" and keeps their stored choices (00 #62)', async () => {
  const fetchMock = stubApi({ status: 200, body: VIEW });
  renderSettings();
  const user = userEvent.setup();
  const features = within(await card('Features'));
  for (const name of [
    /^Batch numbers/,
    /^Expiry dates/,
    /^Expiry alerts/,
    /^Sizes and colours/,
    /^Serial numbers/,
    /^Warranty/,
  ]) {
    const box = features.getByRole('checkbox', { name });
    expect(box).toBeDisabled();
    expect(box).toHaveAccessibleDescription('Coming later');
  }
  // The stored choice still shows, so nobody thinks it was lost.
  expect(features.getByRole('checkbox', { name: /^Expiry dates/ })).toBeChecked();
  expect(features.getByRole('checkbox', { name: /^Batch numbers/ })).not.toBeChecked();
  expect(features.getByRole('checkbox', { name: 'MRP on items' })).toBeEnabled();
  expect(features.getAllByText('Coming later')).toHaveLength(6);

  await user.click(features.getByRole('checkbox', { name: 'MRP on items' }));
  await user.click(features.getByRole('button', { name: 'Save' }));
  expect(await features.findByRole('status')).toHaveTextContent('Saved');
  // The stored "Expiry dates" goes back with the save, so it isn't dropped.
  expect(putsTo(fetchMock, 'features')).toEqual([
    { features: ['loose_weight', 'expiry_dates', 'udhaar_prominent', 'mrp'] },
  ]);
});

test("keeps the switches and offers the type's defaults, leaving the later ones alone", async () => {
  const fetchMock = stubApi({ status: 200, body: VIEW });
  renderSettings();
  const user = userEvent.setup();
  const features = within(await card('Features'));
  await user.click(features.getByRole('button', { name: 'Use the defaults for Medical' }));
  expect(features.getByRole('checkbox', { name: 'MRP on items' })).toBeChecked();
  expect(features.getByRole('checkbox', { name: 'Sell loose items by weight' })).not.toBeChecked();
  expect(features.queryByRole('button', { name: /^Use the defaults/ })).toBeNull();
  await user.click(features.getByRole('button', { name: 'Save' }));
  expect(await features.findByRole('status')).toHaveTextContent('Saved');
  expect(putsTo(fetchMock, 'features')).toEqual([
    // In the list's own order. Stored "Expiry dates" stays; Medical's batches and expiry alerts
    // are not switched on behind the owner's back.
    { features: ['expiry_dates', 'mrp'] },
  ]);
});

test('switches negative stock at billing from warn to block', async () => {
  const fetchMock = stubApi({ status: 200, body: VIEW });
  renderSettings();
  const user = userEvent.setup();
  const stock = within(await card('Stock'));
  expect(stock.getByRole('radio', { name: /^Warn/ })).toBeChecked();
  await user.click(stock.getByRole('radio', { name: /^Block/ }));
  await user.click(stock.getByRole('button', { name: 'Save' }));
  expect(await stock.findByRole('status')).toHaveTextContent('Saved');
  expect(putsTo(fetchMock, 'stock')).toEqual([{ negativeStock: 'block' }]);
  expect(stock.getByRole('radio', { name: /^Block/ })).toBeChecked();
});

test('switches an alert type off for the app and saves the list that is left', async () => {
  const fetchMock = stubApi({ status: 200, body: VIEW });
  renderSettings();
  const user = userEvent.setup();
  const alerts = within(await card('Alerts'));
  expect(alerts.getByRole('checkbox', { name: /^Out of stock/ })).toBeChecked();
  expect(alerts.getByRole('checkbox', { name: /^Low on stock/ })).toBeChecked();
  expect(alerts.getByText(/WhatsApp comes with the daily summary/)).toBeInTheDocument();
  await user.click(alerts.getByRole('checkbox', { name: /^Low on stock/ }));
  await user.click(alerts.getByRole('button', { name: 'Save' }));
  expect(await alerts.findByRole('status')).toHaveTextContent('Saved');
  expect(putsTo(fetchMock, 'alerts')).toEqual([{ types: ['out_of_stock'] }]);
  expect(alerts.getByRole('checkbox', { name: /^Low on stock/ })).not.toBeChecked();
});

test('keeps lock times in their range', async () => {
  const fetchMock = stubApi({ status: 200, body: VIEW });
  renderSettings();
  const user = userEvent.setup();
  const security = within(await card('Security'));
  await user.clear(security.getByLabelText('Staff logout after'));
  await user.type(security.getByLabelText('Staff logout after'), '200');
  await user.click(security.getByRole('button', { name: 'Save' }));
  expect(await security.findByLabelText('Staff logout after')).toHaveAccessibleDescription(
    'Enter 5 to 120 minutes Minutes without use before a staff login is logged out.',
  );
  expect(putsTo(fetchMock, 'security')).toEqual([]);
});

test('sets the invoice prefix, with an example of the next bill number', async () => {
  const fetchMock = stubApi({ status: 200, body: VIEW });
  renderSettings();
  const user = userEvent.setup();
  const invoices = within(await card('Invoice numbers'));
  expect(invoices.getByLabelText('Prefix (optional)')).toHaveValue('');
  expect(invoices.getByText('Your next bill: 26-27/7')).toBeInTheDocument();
  await user.type(invoices.getByLabelText('Prefix (optional)'), 'abc');
  expect(invoices.getByText('Your next bill: ABC/26-27/7')).toBeInTheDocument();
  await user.click(invoices.getByRole('button', { name: 'Save' }));
  expect(await invoices.findByRole('status')).toHaveTextContent('Saved');
  expect(putsTo(fetchMock, 'invoices')).toEqual([{ invoicePrefix: 'ABC' }]);
  expect(invoices.getByLabelText('Prefix (optional)')).toHaveValue('ABC');
});

test("with several branches the next bill starts with this computer's branch code", async () => {
  stubApi({ status: 200, body: VIEW }, [
    HEAD_OFFICE,
    { ...HEAD_OFFICE, id: 'made-up-second-branch', code: 'AND', headOffice: false },
  ]);
  renderSettings();
  const invoices = within(await card('Invoice numbers'));
  // This computer's branch (HO) counts, not the typed prefix, which isn't used any more.
  expect(await invoices.findByText('Your next bill: HO/26-27/7')).toBeInTheDocument();
  await userEvent.type(invoices.getByLabelText('Prefix (optional)'), 'abc');
  expect(invoices.getByText('Your next bill: HO/26-27/7')).toBeInTheDocument();
});

test('sends an emptied prefix as none', async () => {
  const fetchMock = stubApi({
    status: 200,
    body: { ...VIEW, invoices: { invoicePrefix: 'ABC' } },
  });
  renderSettings();
  const user = userEvent.setup();
  const invoices = within(await card('Invoice numbers'));
  await user.clear(invoices.getByLabelText('Prefix (optional)'));
  await user.click(invoices.getByRole('button', { name: 'Save' }));
  expect(await invoices.findByRole('status')).toHaveTextContent('Saved');
  expect(putsTo(fetchMock, 'invoices')).toEqual([{ invoicePrefix: null }]);
});

test("refuses a prefix that is a branch's code, on the screen, without asking the server", async () => {
  const fetchMock = stubApi({ status: 200, body: VIEW });
  renderSettings();
  const user = userEvent.setup();
  const invoices = within(await card('Invoice numbers'));
  await user.type(invoices.getByLabelText('Prefix (optional)'), 'ho');
  await user.click(invoices.getByRole('button', { name: 'Save' }));
  expect(await invoices.findByLabelText('Prefix (optional)')).toHaveAccessibleDescription(
    /A branch already uses this as its code/,
  );
  expect(putsTo(fetchMock, 'invoices')).toEqual([]);
});

test('shows the words for a prefix the server refuses as a branch code', async () => {
  const fetchMock = stubApi({ status: 200, body: VIEW });
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
    url === '/api/settings/invoices'
      ? Promise.resolve(Response.json({ code: 'prefix_is_branch_code' }, { status: 409 }))
      : fetchMock(url, init),
  );
  renderSettings();
  const user = userEvent.setup();
  const invoices = within(await card('Invoice numbers'));
  await user.type(invoices.getByLabelText('Prefix (optional)'), 'NEW');
  await user.click(invoices.getByRole('button', { name: 'Save' }));
  expect(await invoices.findByLabelText('Prefix (optional)')).toHaveAccessibleDescription(
    /A branch already uses this as its code/,
  );
  expect(invoices.queryByText(/Couldn't save/)).not.toBeInTheDocument();
});

test('refuses a prefix of five letters', async () => {
  const fetchMock = stubApi({ status: 200, body: VIEW });
  renderSettings();
  const user = userEvent.setup();
  const invoices = within(await card('Invoice numbers'));
  await user.type(invoices.getByLabelText('Prefix (optional)'), 'ABCDE');
  await user.click(invoices.getByRole('button', { name: 'Save' }));
  expect(await invoices.findByLabelText('Prefix (optional)')).toHaveAccessibleDescription(
    /Use 1 to 4 capital letters or digits|This is too long/,
  );
  expect(putsTo(fetchMock, 'invoices')).toEqual([]);
});
