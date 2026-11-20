import type {
  BranchStockView,
  ItemsContext,
  ItemStockView,
  ItemView,
  MovementPage,
  MovementView,
} from '@business-software/shared';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { App } from '../app';
import { changeLanguage } from '../i18n';
import { createQueryClient } from '../query-client';
import { createAppRouter } from '../router';

afterEach(() => {
  vi.unstubAllGlobals();
});

// Made-up IDs and names.
const MAIN = '0b6f6f3e-3a3b-4c4d-8e8f-000000000001';
const GODOWN = '0b6f6f3e-3a3b-4c4d-8e8f-000000000002';
const ITEM = '0b6f6f3e-3a3b-4c4d-8e8f-000000000003';
const USER = '0b6f6f3e-3a3b-4c4d-8e8f-000000000004';
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const OWNER: ItemsContext = {
  canViewCost: true,
  canManage: true,
  canViewStock: true,
  canAdjustStock: true,
  branchId: MAIN,
  needsGst: true,
  features: [],
  branches: [
    { id: GODOWN, name: 'Godown' },
    { id: MAIN, name: 'Main' },
  ],
};

/** The item as someone who may not see costs gets it. */
const ATTA_NO_COST: ItemView = {
  id: ITEM,
  kind: 'goods',
  name: 'Aashirvaad Atta',
  hindiName: null,
  code: 'ATTA',
  categoryId: null,
  brand: null,
  stockUnit: 'kg',
  sellingPrice: 5_200,
  wholesalePrice: null,
  mrp: 5_500,
  priceIncludesTax: true,
  gstRate: 500,
  hsn: '1101',
  archived: false,
  version: 3,
  packs: [],
  barcodes: [],
  levels: [{ branchId: MAIN, lowStockLevel: 5_000 }],
};

const ATTA: ItemView = { ...ATTA_NO_COST, purchasePrice: 4_500 };

const AT_GODOWN: BranchStockView = {
  branchId: GODOWN,
  branchName: 'Godown',
  quantity: 0,
  lowStockLevel: null,
  low: false,
  canOpen: true,
  averageCost: null,
  value: null,
};

const AT_MAIN_NO_COST: BranchStockView = {
  branchId: MAIN,
  branchName: 'Main',
  quantity: 12_500,
  lowStockLevel: 5_000,
  low: false,
  canOpen: false,
};

const AT_MAIN: BranchStockView = { ...AT_MAIN_NO_COST, averageCost: 4_400, value: 55_000 };

const STOCK: ItemStockView = { itemId: ITEM, stockUnit: 'kg', branches: [AT_GODOWN, AT_MAIN] };

const movement = (overrides: Partial<MovementView>): MovementView => ({
  id: '0b6f6f3e-3a3b-4c4d-8e8f-0000000000a1',
  branchId: MAIN,
  kind: 'adjustment',
  quantity: -500,
  balanceAfter: 12_500,
  unitCost: 4_400,
  value: -2_200,
  reason: 'damaged',
  note: 'Torn bag',
  businessDate: '2026-11-20',
  actorId: USER,
  actorName: 'Ravi Sharma',
  createdAt: '2026-11-20T06:30:00.000Z',
  ...overrides,
});

const HISTORY: MovementPage = {
  movements: [
    movement({}),
    movement({
      id: '0b6f6f3e-3a3b-4c4d-8e8f-0000000000a0',
      kind: 'opening',
      quantity: 13_000,
      balanceAfter: 13_000,
      value: 57_200,
      reason: null,
      note: null,
      businessDate: '2026-11-19',
    }),
  ],
  next: null,
};

interface Answer {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}
type Route = (body: unknown, url: string) => Answer;

/** Answers `METHOD /path` (query strings ignored) from `routes`; anything else is healthy. */
function stubApi(routes: Record<string, Route>) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url.split('?')[0] ?? url}`;
    const route = routes[key];
    if (route === undefined)
      return Promise.resolve(Response.json({ status: 'ok', database: 'ok' }));
    const answer = route(
      init?.body === undefined ? undefined : JSON.parse(init.body as string),
      url,
    );
    return Promise.resolve(
      Response.json(answer.body, { status: answer.status ?? 200, headers: answer.headers ?? {} }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const base = (
  context: ItemsContext = OWNER,
  stock: ItemStockView = STOCK,
  item: ItemView = ATTA,
): Record<string, Route> => ({
  'GET /api/items/context': () => ({ body: context }),
  'GET /api/categories': () => ({ body: [] }),
  'GET /api/units': () => ({ body: [] }),
  [`GET /api/items/${ITEM}`]: () => ({ body: item }),
  [`GET /api/items/${ITEM}/stock`]: () => ({ body: stock }),
  [`GET /api/items/${ITEM}/stock/movements`]: () => ({ body: HISTORY }),
});

function renderItem() {
  const history = createMemoryHistory({ initialEntries: [`/items/${ITEM}`] });
  render(<App router={createAppRouter(history)} queryClient={createQueryClient()} />);
}

const sentTo = (fetchMock: ReturnType<typeof stubApi>, method: string, path: string) =>
  fetchMock.mock.calls
    .filter(([url, init]) => url === path && init?.method === method)
    .map(([, init]) => JSON.parse(init?.body as string) as Record<string, unknown>);

const urlsOf = (fetchMock: ReturnType<typeof stubApi>, prefix: string) =>
  fetchMock.mock.calls.map(([url]) => url).filter((url) => url.startsWith(prefix));

const stockCard = async () => within(await screen.findByRole('region', { name: 'Stock' }));

test('shows stock at each branch, with cost and value for someone allowed to see costs', async () => {
  stubApi(base());
  renderItem();
  const card = await stockCard();
  const main = await card.findByRole('row', { name: /^Main/ });
  expect(within(main).getByText('12.5 kg')).toBeInTheDocument();
  expect(within(main).getByText('5 kg')).toBeInTheDocument();
  expect(within(main).getByText('₹44.00')).toBeInTheDocument();
  expect(within(main).getByText('₹550.00')).toBeInTheDocument();
  expect(within(main).getByText('Your branch')).toBeInTheDocument();
  const godown = card.getByRole('row', { name: /^Godown/ });
  expect(within(godown).getByText('Out of stock')).toBeInTheDocument();
  expect(within(godown).getByText('Not set')).toBeInTheDocument();
});

test('leaves out cost and value for someone who may not see costs', async () => {
  stubApi(base({ ...OWNER, canViewCost: false }, { ...STOCK, branches: [AT_MAIN_NO_COST] }));
  renderItem();
  const card = await stockCard();
  await card.findByRole('row', { name: /^Main/ });
  expect(card.queryByRole('columnheader', { name: 'Average cost' })).toBeNull();
  expect(card.queryByText('₹44.00')).toBeNull();
});

test('marks low stock and stock below zero', async () => {
  stubApi(
    base(OWNER, {
      ...STOCK,
      branches: [
        { ...AT_GODOWN, quantity: -2_000, canOpen: false },
        { ...AT_MAIN, quantity: 4_000, low: true },
      ],
    }),
  );
  renderItem();
  const card = await stockCard();
  expect(within(await card.findByRole('row', { name: /^Main/ })).getByText('Low')).toBeVisible();
  expect(within(card.getByRole('row', { name: /^Godown/ })).getByText('Below zero')).toBeVisible();
  expect(within(card.getByRole('row', { name: /^Godown/ })).getByText('-2 kg')).toBeVisible();
});

test('no stock card without stock.view, and no changes without stock.adjust', async () => {
  stubApi(base({ ...OWNER, canViewStock: false }));
  renderItem();
  await screen.findByRole('region', { name: 'Basics' });
  expect(screen.queryByRole('region', { name: 'Stock' })).toBeNull();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';

  stubApi(base({ ...OWNER, canAdjustStock: false }));
  renderItem();
  const card = await stockCard();
  await card.findByRole('row', { name: /^Main/ });
  expect(card.queryByRole('button', { name: 'Adjust stock' })).toBeNull();
  expect(card.queryByRole('button', { name: 'Set opening stock' })).toBeNull();
});

test('no changes on an archived item', async () => {
  stubApi(base(OWNER, STOCK, { ...ATTA, archived: true }));
  renderItem();
  const card = await stockCard();
  await card.findByRole('row', { name: /^Main/ });
  expect(card.queryByRole('button', { name: 'Adjust stock' })).toBeNull();
});

test('offers opening stock only at your branch while nothing has moved there', async () => {
  stubApi(base());
  renderItem();
  const card = await stockCard();
  await card.findByRole('row', { name: /^Main/ });
  // Main has moved; the Godown hasn't, but it isn't the caller's branch.
  expect(card.queryByRole('button', { name: 'Set opening stock' })).toBeNull();
  expect(card.getByRole('button', { name: 'Adjust stock' })).toBeInTheDocument();
});

test('sets opening stock with the cost filled in and one request key', async () => {
  const fresh: ItemStockView = {
    ...STOCK,
    branches: [{ ...AT_MAIN, quantity: 0, canOpen: true, averageCost: null, value: null }],
  };
  let stock = fresh;
  const fetchMock = stubApi({
    ...base(),
    [`GET /api/items/${ITEM}/stock`]: () => ({ body: stock }),
    [`POST /api/items/${ITEM}/stock/opening`]: () => {
      stock = STOCK;
      return { status: 201, body: HISTORY.movements[1] };
    },
  });
  renderItem();
  const card = await stockCard();
  await userEvent.click(await card.findByRole('button', { name: 'Set opening stock' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Opening stock: Aashirvaad Atta' }));
  expect(dialog.getByLabelText('Cost per kg (₹)')).toHaveValue('45.00');
  await userEvent.type(dialog.getByLabelText('Quantity (kg)'), '12.5');
  await userEvent.click(dialog.getByRole('button', { name: 'Save opening stock' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  const [sent] = sentTo(fetchMock, 'POST', `/api/items/${ITEM}/stock/opening`);
  expect(sent).toEqual({
    quantity: 12_500,
    unitCost: 4_500,
    requestKey: expect.stringMatching(KEY) as unknown,
  });
  const main = card.getByRole('row', { name: /^Main/ });
  expect(await within(main).findByText('12.5 kg')).toBeInTheDocument();
});

test('sends no cost for opening stock without the cost permission', async () => {
  const fresh: ItemStockView = {
    ...STOCK,
    branches: [
      {
        branchId: MAIN,
        branchName: 'Main',
        quantity: 0,
        lowStockLevel: null,
        low: false,
        canOpen: true,
      },
    ],
  };
  const fetchMock = stubApi({
    ...base({ ...OWNER, canViewCost: false }, fresh, ATTA_NO_COST),
    [`POST /api/items/${ITEM}/stock/opening`]: () => ({
      status: 409,
      body: { code: 'cost_required' },
    }),
  });
  renderItem();
  await userEvent.click(
    await (await stockCard()).findByRole('button', { name: 'Set opening stock' }),
  );
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.queryByLabelText(/Cost per/)).toBeNull();
  await userEvent.type(dialog.getByLabelText('Quantity (kg)'), '3');
  await userEvent.click(dialog.getByRole('button', { name: 'Save opening stock' }));
  expect(await dialog.findByRole('alert')).toHaveTextContent('has no purchase price');
  expect(sentTo(fetchMock, 'POST', `/api/items/${ITEM}/stock/opening`)[0]).toEqual({
    quantity: 3_000,
    requestKey: expect.stringMatching(KEY) as unknown,
  });
});

test('adding stock offers only a count mismatch', async () => {
  stubApi(base());
  renderItem();
  await userEvent.click(await (await stockCard()).findByRole('button', { name: 'Adjust stock' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Adjust stock: Aashirvaad Atta' }));
  expect(dialog.getByText(/In stock now: 12.5 kg/)).toBeInTheDocument();
  const reasons = () =>
    within(dialog.getByLabelText('Reason'))
      .getAllByRole('option')
      .map((option) => option.textContent);
  expect(reasons()).toEqual([
    'Choose…',
    'Damaged',
    'Expired',
    'Theft or lost',
    'Own use',
    'Count mismatch',
    'Other',
  ]);
  await userEvent.click(dialog.getByRole('radio', { name: /Add stock/ }));
  expect(reasons()).toEqual(['Count mismatch']);
  expect(dialog.getByLabelText('Reason')).toHaveValue('count_mismatch');
});

test('checks the adjustment in the browser: whole units, and a note for Other', async () => {
  const fetchMock = stubApi(
    base(OWNER, { ...STOCK, stockUnit: 'piece' }, { ...ATTA, stockUnit: 'piece' }),
  );
  renderItem();
  await userEvent.click(await (await stockCard()).findByRole('button', { name: 'Adjust stock' }));
  const dialog = within(screen.getByRole('dialog'));
  await userEvent.selectOptions(dialog.getByLabelText('Reason'), 'Other');
  await userEvent.type(dialog.getByLabelText('Quantity (piece)'), '1.5');
  await userEvent.click(dialog.getByRole('button', { name: 'Save adjustment' }));
  expect(await dialog.findByLabelText('Quantity (piece)')).toHaveAccessibleDescription(
    'This unit is counted in whole numbers',
  );
  expect(dialog.getByLabelText('Note')).toHaveAccessibleDescription(
    expect.stringContaining('Fill this in') as string,
  );
  expect(sentTo(fetchMock, 'POST', `/api/items/${ITEM}/stock/adjustments`)).toEqual([]);
});

test('sends a write-off as a negative change, then shows the new history', async () => {
  let history = { ...HISTORY, movements: HISTORY.movements.slice(1) };
  const fetchMock = stubApi({
    ...base(),
    [`GET /api/items/${ITEM}/stock/movements`]: () => ({ body: history }),
    [`POST /api/items/${ITEM}/stock/adjustments`]: () => {
      history = HISTORY;
      return { status: 201, body: HISTORY.movements[0] };
    },
  });
  renderItem();
  const card = await stockCard();
  await userEvent.click(await card.findByRole('button', { name: 'Adjust stock' }));
  const dialog = within(screen.getByRole('dialog'));
  await userEvent.selectOptions(dialog.getByLabelText('Reason'), 'Damaged');
  await userEvent.type(dialog.getByLabelText('Quantity (kg)'), '0.5');
  await userEvent.type(dialog.getByLabelText('Note'), 'Torn bag');
  await userEvent.click(dialog.getByRole('button', { name: 'Save adjustment' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(sentTo(fetchMock, 'POST', `/api/items/${ITEM}/stock/adjustments`)).toEqual([
    {
      quantity: -500,
      reason: 'damaged',
      note: 'Torn bag',
      requestKey: expect.stringMatching(KEY) as unknown,
    },
  ]);
  const table = within(card.getByRole('table', { name: 'History' }));
  const row = await table.findByRole('row', { name: /Damaged/ });
  expect(within(row).getByText('-0.5 kg')).toBeInTheDocument();
  expect(within(row).getByText('Torn bag')).toBeInTheDocument();
  expect(within(row).getByText('Ravi Sharma')).toBeInTheDocument();
  expect(within(row).getByText('-₹22.00')).toBeInTheDocument();
});

test('says in words why a write-off was refused', async () => {
  stubApi({
    ...base(),
    [`POST /api/items/${ITEM}/stock/adjustments`]: () => ({
      status: 409,
      body: { code: 'below_zero' },
    }),
  });
  renderItem();
  await userEvent.click(await (await stockCard()).findByRole('button', { name: 'Adjust stock' }));
  const dialog = within(screen.getByRole('dialog'));
  await userEvent.selectOptions(dialog.getByLabelText('Reason'), 'Expired');
  await userEvent.type(dialog.getByLabelText('Quantity (kg)'), '20');
  await userEvent.click(dialog.getByRole('button', { name: 'Save adjustment' }));
  expect(await dialog.findByRole('alert')).toHaveTextContent(
    "You can't remove more than the stock at this branch.",
  );
});

test('tries once more with the same key when another counter holds the item', async () => {
  let busy = 3;
  const fetchMock = stubApi({
    ...base(),
    [`POST /api/items/${ITEM}/stock/adjustments`]: () => {
      busy -= 1;
      return busy >= 1
        ? { status: 503, body: { code: 'busy' }, headers: { 'retry-after': '0' } }
        : { status: 201, body: HISTORY.movements[0] };
    },
  });
  renderItem();
  await userEvent.click(await (await stockCard()).findByRole('button', { name: 'Adjust stock' }));
  const dialog = within(screen.getByRole('dialog'));
  await userEvent.selectOptions(dialog.getByLabelText('Reason'), 'Own use');
  await userEvent.type(dialog.getByLabelText('Quantity (kg)'), '1');
  await userEvent.click(dialog.getByRole('button', { name: 'Save adjustment' }));
  // Busy twice: the one automatic retry also waited, so the counter is told to try again.
  expect(await dialog.findByRole('alert')).toHaveTextContent('Another counter is changing');
  expect(sentTo(fetchMock, 'POST', `/api/items/${ITEM}/stock/adjustments`)).toHaveLength(2);
  await userEvent.click(dialog.getByRole('button', { name: 'Save adjustment' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  const keys = sentTo(fetchMock, 'POST', `/api/items/${ITEM}/stock/adjustments`).map(
    (body) => body.requestKey,
  );
  expect(keys).toHaveLength(3);
  expect(new Set(keys).size).toBe(1);
});

test('a new dialog makes a new request key', async () => {
  const fetchMock = stubApi({
    ...base(),
    [`POST /api/items/${ITEM}/stock/adjustments`]: () => ({
      status: 201,
      body: HISTORY.movements[0],
    }),
  });
  renderItem();
  const card = await stockCard();
  for (let round = 0; round < 2; round += 1) {
    await userEvent.click(await card.findByRole('button', { name: 'Adjust stock' }));
    const dialog = within(screen.getByRole('dialog'));
    await userEvent.selectOptions(dialog.getByLabelText('Reason'), 'Damaged');
    await userEvent.type(dialog.getByLabelText('Quantity (kg)'), '1');
    await userEvent.click(dialog.getByRole('button', { name: 'Save adjustment' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  }
  const keys = sentTo(fetchMock, 'POST', `/api/items/${ITEM}/stock/adjustments`).map(
    (body) => body.requestKey,
  );
  expect(new Set(keys).size).toBe(2);
});

test('pages through the history and switches branch', async () => {
  const first: MovementPage = { movements: [movement({})], next: 'cursor-1' };
  const fetchMock = stubApi({
    ...base(),
    [`GET /api/items/${ITEM}/stock/movements`]: (_body, url) => ({
      body: url.includes('after=cursor-1')
        ? { ...HISTORY, movements: HISTORY.movements.slice(1) }
        : first,
    }),
  });
  renderItem();
  const card = await stockCard();
  const table = within(await card.findByRole('table', { name: 'History' }));
  await table.findByRole('row', { name: /Damaged/ });
  expect(table.queryByRole('row', { name: /Opening stock/ })).toBeNull();
  await userEvent.click(card.getByRole('button', { name: 'Show more' }));
  expect(await table.findByRole('row', { name: /Opening stock/ })).toBeInTheDocument();
  expect(urlsOf(fetchMock, `/api/items/${ITEM}/stock/movements`)).toContain(
    `/api/items/${ITEM}/stock/movements?branch=${MAIN}&after=cursor-1`,
  );
  await userEvent.selectOptions(card.getByLabelText('Branch'), 'Godown');
  await waitFor(() => {
    expect(urlsOf(fetchMock, `/api/items/${ITEM}/stock/movements`)).toContain(
      `/api/items/${ITEM}/stock/movements?branch=${GODOWN}`,
    );
  });
});

test('speaks Hindi', async () => {
  stubApi(base());
  renderItem();
  await changeLanguage('hi');
  const card = within(await screen.findByRole('region', { name: 'स्टॉक' }));
  await userEvent.click(await card.findByRole('button', { name: 'स्टॉक ठीक करें' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(
    within(dialog.getByLabelText('कारण')).getByRole('option', { name: 'ख़राब' }),
  ).toBeInTheDocument();
});

test('the archive confirm says how much stock is left', async () => {
  stubApi(base());
  renderItem();
  await (await stockCard()).findByRole('row', { name: /^Main/ });
  await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
  expect(screen.getByRole('dialog', { name: /Archive/ })).toHaveTextContent(
    'Stock left: Main 12.5 kg. The stock and its history stay with the item.',
  );
});

test('saving a stock change never submits the item form around it', async () => {
  const fetchMock = stubApi({
    ...base(),
    [`PUT /api/items/${ITEM}`]: () => ({ body: ATTA }),
    [`POST /api/items/${ITEM}/stock/adjustments`]: () => ({
      status: 201,
      body: HISTORY.movements[0],
    }),
  });
  renderItem();
  await userEvent.click(await (await stockCard()).findByRole('button', { name: 'Adjust stock' }));
  const dialog = within(screen.getByRole('dialog'));
  await userEvent.selectOptions(dialog.getByLabelText('Reason'), 'Damaged');
  // Enter in the field, as a person (or a scanner) would.
  await userEvent.type(dialog.getByLabelText('Quantity (kg)'), '1{Enter}');
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(sentTo(fetchMock, 'POST', `/api/items/${ITEM}/stock/adjustments`)).toHaveLength(1);
  expect(sentTo(fetchMock, 'PUT', `/api/items/${ITEM}`)).toEqual([]);
});

test('an item archived meanwhile shows as archived after the refusal', async () => {
  let item = ATTA;
  stubApi({
    ...base(),
    [`GET /api/items/${ITEM}`]: () => ({ body: item }),
    [`POST /api/items/${ITEM}/stock/adjustments`]: () => {
      item = { ...ATTA, archived: true, version: 4 };
      return { status: 409, body: { code: 'archived' } };
    },
  });
  renderItem();
  const card = await stockCard();
  await userEvent.click(await card.findByRole('button', { name: 'Adjust stock' }));
  const dialog = within(screen.getByRole('dialog'));
  await userEvent.selectOptions(dialog.getByLabelText('Reason'), 'Damaged');
  await userEvent.type(dialog.getByLabelText('Quantity (kg)'), '1');
  await userEvent.click(dialog.getByRole('button', { name: 'Save adjustment' }));
  expect(await dialog.findByRole('alert')).toHaveTextContent('This item is archived');
  await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
  expect(await screen.findByRole('button', { name: 'Restore' })).toBeInTheDocument();
  expect(card.queryByRole('button', { name: 'Adjust stock' })).toBeNull();
});

test('says saving failed when the API refuses a field the dialog does not show', async () => {
  stubApi({
    ...base(),
    [`POST /api/items/${ITEM}/stock/adjustments`]: () => ({
      status: 400,
      body: { code: 'invalid_body', fields: { requestKey: 'invalid' } },
    }),
  });
  renderItem();
  await userEvent.click(await (await stockCard()).findByRole('button', { name: 'Adjust stock' }));
  const dialog = within(screen.getByRole('dialog'));
  await userEvent.selectOptions(dialog.getByLabelText('Reason'), 'Damaged');
  await userEvent.type(dialog.getByLabelText('Quantity (kg)'), '1');
  await userEvent.click(dialog.getByRole('button', { name: 'Save adjustment' }));
  expect(await dialog.findByRole('alert')).toHaveTextContent("Couldn't save.");
});

test('the archive confirm says when the stock left could not be checked', async () => {
  stubApi({
    ...base(),
    [`GET /api/items/${ITEM}/stock`]: () => ({ status: 500, body: { code: 'server' } }),
  });
  renderItem();
  await (await stockCard()).findByText("Couldn't load the stock.");
  await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
  expect(screen.getByRole('dialog', { name: /Archive/ })).toHaveTextContent(
    "The stock left couldn't be checked. Whatever there is stays with the item.",
  );
});
