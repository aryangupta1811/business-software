import type { SettingsView } from '@business-software/shared';
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
};

/**
 * The owner is logged in; GET /api/settings answers `load`, every PUT the view it was sent
 * merged in.
 */
function stubApi(load: { status: number; body: unknown }) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/session') return Promise.resolve(Response.json(OWNER_SESSION));
    if (url === '/api/settings') return Promise.resolve(Response.json(load.body, load));
    if (url === '/api/devices') return Promise.resolve(Response.json([]));
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
  expect(features.getByRole('checkbox', { name: 'Expiry dates' })).toBeChecked();
  expect(features.getByRole('checkbox', { name: 'Batch numbers' })).not.toBeChecked();
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

test("keeps the switches and offers the type's defaults", async () => {
  const fetchMock = stubApi({ status: 200, body: VIEW });
  renderSettings();
  const user = userEvent.setup();
  const features = within(await card('Features'));
  await user.click(features.getByRole('button', { name: 'Use the defaults for Medical' }));
  expect(features.getByRole('checkbox', { name: 'Batch numbers' })).toBeChecked();
  expect(features.getByRole('checkbox', { name: 'Sell loose items by weight' })).not.toBeChecked();
  expect(features.queryByRole('button', { name: /^Use the defaults/ })).toBeNull();
  await user.click(features.getByRole('button', { name: 'Save' }));
  expect(await features.findByRole('status')).toHaveTextContent('Saved');
  expect(putsTo(fetchMock, 'features')).toEqual([
    // In the list's own order, whatever order they were ticked in.
    { features: ['expiry_dates', 'batches', 'mrp', 'expiry_alerts'] },
  ]);
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
