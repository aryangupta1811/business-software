import type { ItemPage, ItemRow, ItemsContext, ItemView } from '@business-software/shared';
import { createMemoryHistory } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  canViewStock: true,
  canAdjustStock: true,
  branchId: BRANCH,
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

/** The row as someone without `stock.view` gets it (and as a service always is). */
const BARE_ROW: ItemRow = {
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
};

const PAGE: ItemPage = { items: [{ ...BARE_ROW, stock: 12_500, low: false }], next: null };

/** More goods rows and a service, for the stock column's badges. */
const STOCK_PAGE: ItemPage = {
  items: [
    { ...BARE_ROW, stock: 4_000, low: true },
    { ...BARE_ROW, id: `${ITEM.slice(0, -1)}4`, name: 'Tata Salt', stock: 0, low: false },
    { ...BARE_ROW, id: `${ITEM.slice(0, -1)}5`, name: 'Maggi', stock: -2_000, low: false },
    { ...BARE_ROW, id: `${ITEM.slice(0, -1)}6`, name: 'Home delivery', kind: 'service' },
  ],
  next: null,
};

interface Answer {
  status?: number;
  body: unknown;
}
type Route = (body: unknown) => Answer;

/** Answers `METHOD /path` (query strings ignored) from `routes`; anything else is healthy. */
function stubApi(routes: Record<string, Route>) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url.split('?')[0] ?? url}`;
    const route = routes[key];
    if (route === undefined)
      return Promise.resolve(Response.json({ status: 'ok', database: 'ok' }));
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
  [`GET /api/items/${ITEM}/stock`]: () => ({
    body: {
      itemId: ITEM,
      stockUnit: 'kg',
      branches: [
        {
          branchId: BRANCH,
          branchName: 'Main',
          quantity: 0,
          lowStockLevel: null,
          low: false,
          canOpen: true,
        },
      ],
    },
  }),
  [`GET /api/items/${ITEM}/stock/movements`]: () => ({ body: { movements: [], next: null } }),
});

function renderAt(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  render(<App router={createAppRouter(history)} queryClient={createQueryClient()} />);
  return history;
}

/** The physical key a US keyboard (and so a scanner) uses for a character. */
const codeOf = (key: string) =>
  /^\d$/.test(key)
    ? `Digit${key}`
    : /^[a-z]$/i.test(key)
      ? `Key${key.toUpperCase()}`
      : ({ '/': 'Slash', '-': 'Minus', Enter: 'Enter' }[key] ?? key);

/** A scanner's burst: every key at once, then Enter, each to whatever has focus (as a keyboard). */
function scan(code: string) {
  for (const key of [...Array.from(code), 'Enter']) {
    fireEvent.keyDown(document.activeElement ?? document.body, { key, code: codeOf(key) });
  }
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

test('shows stock at your branch with a badge when it is low, out or below zero', async () => {
  stubApi({ ...base(), 'GET /api/items': () => ({ body: STOCK_PAGE }) });
  renderAt('/items');
  const table = await screen.findByRole('table', { name: 'Items' });
  expect(within(table).getByRole('columnheader', { name: 'Stock' })).toBeInTheDocument();
  const atta = await within(table).findByRole('row', { name: /Aashirvaad Atta/ });
  expect(within(atta).getByText('4 kg')).toBeInTheDocument();
  expect(within(atta).getByText('Low')).toBeInTheDocument();
  const salt = within(table).getByRole('row', { name: /Tata Salt/ });
  expect(within(salt).getByText('Out of stock')).toBeInTheDocument();
  const maggi = within(table).getByRole('row', { name: /Maggi/ });
  expect(within(maggi).getByText('-2 kg')).toBeInTheDocument();
  expect(within(maggi).getByText('Below zero')).toBeInTheDocument();
  const service = within(table).getByRole('row', { name: /Home delivery/ });
  expect(within(service).queryByText(/Low|Out of stock|Below zero/)).toBeNull();
});

test('filters to low stock', async () => {
  const fetchMock = stubApi(base());
  renderAt('/items');
  await screen.findByRole('row', { name: /Aashirvaad Atta/ });
  await userEvent.click(screen.getByRole('checkbox', { name: 'Low stock only' }));
  await waitFor(() => {
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain('/api/items?low=true');
  });
});

test('no stock column or filter without stock.view', async () => {
  stubApi({
    ...base({ ...OWNER, canViewStock: false }),
    'GET /api/items': () => ({ body: { items: [BARE_ROW], next: null } }),
  });
  renderAt('/items');
  const table = await screen.findByRole('table', { name: 'Items' });
  await within(table).findByRole('row', { name: /Aashirvaad Atta/ });
  expect(within(table).queryByRole('columnheader', { name: 'Stock' })).toBeNull();
  expect(screen.queryByRole('checkbox', { name: 'Low stock only' })).toBeNull();
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
  scan('8901234567890');
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
  scan('8901234567890');
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
  expect(price.getByText('Margin').nextSibling).toHaveTextContent('₹10.00 (10%)');
  await userEvent.type(price.getByLabelText('MRP (₹)'), '100');
  expect(price.getByRole('status')).toHaveTextContent('above the MRP');
});

test('without the packs feature, the last card is only about barcodes and low stock', async () => {
  stubApi(base());
  renderAt('/items/new');
  const card = await screen.findByRole('region', { name: 'Barcodes and low stock' });
  expect(within(card).queryByRole('button', { name: /pack/i })).toBeNull();
  expect(within(card).getByLabelText('Branch: Main')).toBeInTheDocument();
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
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive' }),
  );
  expect(await screen.findByText(/This item is archived/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
});

test('asks to log in when the API says no one is', async () => {
  stubApi({ 'GET /api/items/context': () => ({ status: 401, body: { code: 'not_logged_in' } }) });
  renderAt('/items');
  expect(await screen.findByRole('heading', { name: 'Log in to see items' })).toBeInTheDocument();
});

test('a scan whose code holds / is still one scan, not the search shortcut', async () => {
  stubApi({
    ...base(),
    'GET /api/items/barcode/AB%2F12345': () => ({ status: 404, body: { code: 'unknown_barcode' } }),
  });
  renderAt('/items');
  await screen.findByRole('table', { name: 'Items' });
  scan('AB/12345');
  expect(await screen.findByLabelText('Barcode 1')).toHaveValue('AB/12345');
});

test('a scan after ticking a filter still counts', async () => {
  stubApi({
    ...base(),
    'GET /api/items/barcode/8901234567890': () => ({ body: { item: ATTA, packId: null } }),
  });
  const history = renderAt('/items');
  const archived = await screen.findByRole('checkbox', { name: 'Archived only' });
  await userEvent.click(archived);
  expect(archived).toHaveFocus();
  scan('8901234567890');
  await waitFor(() => {
    expect(history.location.pathname).toBe(`/items/${ITEM}`);
  });
});

test('says a lookup failed, not that the code is unknown, when the server errs', async () => {
  stubApi({
    ...base(),
    'GET /api/items/barcode/8901234567890': () => ({ status: 500, body: { code: 'server' } }),
  });
  renderAt('/items');
  await screen.findByRole('table', { name: 'Items' });
  scan('8901234567890');
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent("Couldn't look up the barcode 8901234567890");
  expect(alert).not.toHaveTextContent('No item has');
});

test('saves with the version the form was loaded at, even after a newer copy arrives', async () => {
  const fetchMock = stubApi({
    ...base(),
    // Someone else saved meanwhile: the answer to adding a code carries their version.
    [`POST /api/items/${ITEM}/barcodes`]: () => ({
      status: 201,
      body: {
        ...ATTA,
        version: 9,
        barcodes: [{ id: BRANCH, code: 'NEW-0001', packId: null, inStore: false }],
      },
    }),
    [`PUT /api/items/${ITEM}`]: () => ({ status: 409, body: { code: 'stale' } }),
  });
  renderAt(`/items/${ITEM}`);
  await userEvent.type(await screen.findByLabelText('New barcode'), 'NEW-0001');
  await userEvent.click(screen.getByRole('button', { name: 'Add barcode' }));
  await screen.findByText('NEW-0001');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => {
    expect(sentTo(fetchMock, 'PUT', `/api/items/${ITEM}`)).toHaveLength(1);
  });
  expect(sentTo(fetchMock, 'PUT', `/api/items/${ITEM}`)[0]).toMatchObject({ version: 3 });
});

test('won’t archive over unsaved changes', async () => {
  const fetchMock = stubApi(base());
  renderAt(`/items/${ITEM}`);
  await userEvent.type(await screen.findByLabelText('Brand'), ' Gold');
  await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Save or undo your changes first');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/archive'))).toBe(false);
  expect(screen.getByLabelText('Brand')).toHaveValue('Aashirvaad Gold');
});

test('says a barcode is taken even when the answer doesn’t name the other item', async () => {
  stubApi({
    ...base(),
    'POST /api/items': () => ({ status: 409, body: { code: 'barcode_taken' } }),
  });
  renderAt('/items/new?barcode=8901234567890');
  await userEvent.type(await screen.findByLabelText('Name'), 'Pen');
  const price = within(screen.getByRole('region', { name: 'Price and tax' }));
  await userEvent.type(price.getByLabelText('Selling price (₹)'), '10');
  await userEvent.selectOptions(price.getByLabelText('GST rate'), '18%');
  await userEvent.type(price.getByLabelText('HSN code'), '9608');
  await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Another item already has this barcode',
  );
});

test('shows a catalogue error under the field or row it is about', async () => {
  stubApi({
    ...base(),
    'GET /api/categories': () => ({
      body: [{ id: BRANCH, name: 'Atta', archived: true }],
    }),
    [`POST /api/categories/${BRANCH}/restore`]: () => ({
      status: 409,
      body: { code: 'name_taken' },
    }),
    'POST /api/units': () => ({
      status: 400,
      body: { code: 'invalid_body', fields: { defaultSize: 'too_big' } },
    }),
  });
  renderAt('/items?tab=catalogue');
  const categories = within(await screen.findByRole('region', { name: 'Categories' }));
  await userEvent.click(categories.getByRole('button', { name: 'Restore Atta' }));
  const row = categories.getByText('Atta').closest('li');
  expect(
    await within(row as HTMLElement).findByText('This name is already used'),
  ).toBeInTheDocument();
  expect(categories.getByLabelText('New category')).not.toHaveAccessibleDescription();

  const units = within(screen.getByRole('region', { name: 'Your own units' }));
  await userEvent.type(units.getByLabelText('Unit name'), 'Crate');
  await userEvent.type(units.getByLabelText('How many in one'), '24');
  await userEvent.click(units.getByRole('button', { name: 'Add unit' }));
  await waitFor(() => {
    expect(units.getByLabelText('How many in one')).toHaveAccessibleDescription(
      expect.stringContaining('This is too big') as string,
    );
  });
  expect(units.getByLabelText('Unit name')).not.toHaveAccessibleDescription();
});
