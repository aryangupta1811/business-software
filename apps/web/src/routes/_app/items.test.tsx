import type { ItemPage, ItemsContext, ItemView } from '@business-software/shared';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { App } from '../../app';
import { changeLanguage } from '../../i18n';
import { createQueryClient } from '../../query-client';
import { createAppRouter } from '../../router';

afterEach(() => {
  vi.unstubAllGlobals();
});

const BRANCH = '0b6f6f3e-3a3b-4c4d-8e8f-000000000001';
const ITEM = '0b6f6f3e-3a3b-4c4d-8e8f-000000000003';

const OWNER: ItemsContext = {
  canViewCost: true,
  canManage: true,
  needsGst: true,
  features: ['wholesale_price'],
  branches: [{ id: BRANCH, name: 'Main' }],
};

const ATTA: ItemView = {
  id: ITEM,
  kind: 'goods',
  name: 'Aashirvaad Atta',
  hindiName: 'आशीर्वाद आटा',
  code: 'ATTA',
  categoryId: null,
  brand: 'Aashirvaad',
  stockUnit: 'kg',
  sellingPrice: 5_200,
  wholesalePrice: null,
  purchasePrice: 4_500,
  mrp: 5_500,
  priceIncludesTax: true,
  gstRate: 500,
  hsn: '1101',
  archived: false,
  version: 3,
  packs: [],
  barcodes: [],
  levels: [{ branchId: BRANCH, lowStockLevel: 0 }],
};

const PAGE: ItemPage = {
  items: [
    {
      id: ITEM,
      kind: 'goods',
      name: 'Aashirvaad Atta',
      hindiName: 'आशीर्वाद आटा',
      code: 'ATTA',
      categoryId: null,
      brand: 'Aashirvaad',
      stockUnit: 'kg',
      sellingPrice: 5_200,
      purchasePrice: 4_500,
      mrp: 5_500,
      gstRate: 500,
      archived: false,
    },
  ],
  next: null,
};

type Answer = { status?: number; body: unknown };
type Route = (body: unknown) => Answer;

/** Answers `METHOD /path` (query strings ignored) from `routes`; anything else is healthy. */
function stubApi(routes: Record<string, Route>) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url.split('?')[0] ?? url}`;
    const route = routes[key];
    if (route === undefined) return Promise.resolve(Response.json({ status: 'ok', database: 'ok' }));
    const answer = route(init?.body === undefined ? undefined : JSON.parse(init.body as string));
    return Promise.resolve(Response.json(answer.body, { status: answer.status ?? 200 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const base = (context: ItemsContext = OWNER): Record<string, Route> => ({
  'GET /api/items/context': () => ({ body: context }),
  'GET /api/categories': () => ({ body: [] }),
  'GET /api/units': () => ({ body: [] }),
  'GET /api/items': () => ({ body: PAGE }),
  [`GET /api/items/${ITEM}`]: () => ({ body: ATTA }),
});

function renderAt(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  render(<App router={createAppRouter(history)} queryClient={createQueryClient()} />);
  return history;
}

const sentTo = (fetchMock: ReturnType<typeof stubApi>, method: string, path: string) =>
  fetchMock.mock.calls
    .filter(([url, init]) => url === path && init?.method === method)
    .map(([, init]) => JSON.parse(init?.body as string) as Record<string, unknown>);

test('lists items with prices, and the cost column only for someone allowed to see it', async () => {
  stubApi(base());
  renderAt('/items');
  const table = await screen.findByRole('table', { name: 'Items' });
  const row = await within(table).findByRole('row', { name: /Aashirvaad Atta/ });
  expect(within(row).getByText('₹52.00')).toBeInTheDocument();
  expect(within(row).getByText('5%')).toBeInTheDocument();
  expect(within(table).getByRole('columnheader', { name: 'Cost' })).toBeInTheDocument();
  expect(within(row).getByText('₹45.00')).toBeInTheDocument();
  expect(
    within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: /^Items/ }),
  ).toHaveAttribute('aria-current', 'page');
});

test('hides the cost column, and the add button, from someone who may only look', async () => {
  stubApi(base({ ...OWNER, canViewCost: false, canManage: false }));
  renderAt('/items');
  const table = await screen.findByRole('table', { name: 'Items' });
  expect(within(table).queryByRole('columnheader', { name: 'Cost' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Add item/ })).not.toBeInTheDocument();
});

test('a scan of an unknown code opens a new item with the code filled in', async () => {
  stubApi({
    ...base(),
    'GET /api/items/barcode/8901234567890': () => ({
      status: 404,
      body: { code: 'unknown_barcode' },
    }),
  });
  const history = renderAt('/items');
  await screen.findByRole('table', { name: 'Items' });
  await userEvent.keyboard('8901234567890{Enter}');
  expect(await screen.findByLabelText('Barcode 1')).toHaveValue('8901234567890');
  expect(history.location.pathname).toBe('/items/new');
});

test('a scan of a known code opens its item', async () => {
  stubApi({
    ...base(),
    'GET /api/items/barcode/8901234567890': () => ({ body: { item: ATTA, packId: null } }),
  });
  const history = renderAt('/items');
  await screen.findByRole('table', { name: 'Items' });
  await userEvent.keyboard('8901234567890{Enter}');
  expect(await screen.findByLabelText('Name')).toHaveValue('Aashirvaad Atta');
  expect(history.location.pathname).toBe(`/items/${ITEM}`);
});

test('shows the price with GST and the margin as you type, and warns above the MRP', async () => {
  stubApi(base());
  renderAt('/items/new');
  const price = within(await screen.findByRole('region', { name: 'Price and tax' }));
  await userEvent.type(price.getByLabelText('Selling price (₹)'), '118');
  await userEvent.selectOptions(price.getByLabelText('GST rate'), '18%');
  await userEvent.type(price.getByLabelText('Purchase price (₹)'), '90');
  expect(price.getByText('Before GST').nextSibling).toHaveTextContent('₹100.00');
  expect(price.getByText('Customer pays').nextSibling).toHaveTextContent('₹118.00');
  expect(price.getByText('Margin').nextSibling).toHaveTextContent('₹28.00 (23.73%)');
  await userEvent.type(price.getByLabelText('MRP (₹)'), '100');
  expect(price.getByRole('status')).toHaveTextContent('above the MRP');
});

test('hides the purchase price field without the permission, and never sends it', async () => {
  const fetchMock = stubApi({
    ...base({ ...OWNER, canViewCost: false }),
    'POST /api/items': () => ({ status: 201, body: ATTA }),
  });
  renderAt('/items/new');
  const price = within(await screen.findByRole('region', { name: 'Price and tax' }));
  expect(price.queryByLabelText('Purchase price (₹)')).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Name'), 'Pen');
  await userEvent.type(price.getByLabelText('Selling price (₹)'), '10');
  await userEvent.selectOptions(price.getByLabelText('GST rate'), '18%');
  await userEvent.type(price.getByLabelText('HSN code'), '9608');
  await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
  await waitFor(() => {
    expect(sentTo(fetchMock, 'POST', '/api/items')).toHaveLength(1);
  });
  expect(sentTo(fetchMock, 'POST', '/api/items')[0]).not.toHaveProperty('purchasePrice');
});

test('shows error codes in the chosen language under their fields', async () => {
  stubApi(base());
  renderAt('/items/new');
  await changeLanguage('hi');
  const basics = within(await screen.findByRole('region', { name: 'मूल जानकारी' }));
  await userEvent.click(screen.getByRole('button', { name: 'सामान जोड़ें' }));
  expect(basics.getByLabelText('नाम')).toHaveAccessibleDescription('यह भरें');
  const price = within(screen.getByRole('region', { name: 'दाम और टैक्स' }));
  expect(price.getByLabelText('जीएसटी दर')).toHaveAccessibleDescription(
    'जीएसटी में रजिस्टर्ड दुकान के लिए ज़रूरी',
  );
});

test('puts a 409 under its field, and says when someone else saved first', async () => {
  let answer: Answer = { status: 409, body: { code: 'name_taken' } };
  stubApi({ ...base(), [`PUT /api/items/${ITEM}`]: () => answer });
  renderAt(`/items/${ITEM}`);
  const name = await screen.findByLabelText('Name');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => {
    expect(name).toHaveAccessibleDescription('This name is already used');
  });
  answer = { status: 409, body: { code: 'stale' } };
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Someone else saved this item');
});

test('archives only after the dialog is confirmed', async () => {
  const fetchMock = stubApi({
    ...base(),
    [`POST /api/items/${ITEM}/archive`]: () => ({ body: { ...ATTA, archived: true, version: 4 } }),
  });
  renderAt(`/items/${ITEM}`);
  await userEvent.click(await screen.findByRole('button', { name: 'Archive' }));
  const dialog = screen.getByRole('dialog', { name: 'Archive “Aashirvaad Atta”?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/archive'))).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive' }));
  expect(await screen.findByText(/This item is archived/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
});

test('asks to log in when the API says no one is', async () => {
  stubApi({ 'GET /api/items/context': () => ({ status: 401, body: { code: 'not_logged_in' } }) });
  renderAt('/items');
  expect(await screen.findByRole('heading', { name: 'Log in to see items' })).toBeInTheDocument();
});
