import type { AlertList, AlertView } from '@business-software/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { changeLanguage } from '../i18n';
import { fakeApi, OWNER_SESSION, renderAt } from '../test/fake-api';

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await changeLanguage('en');
});

const BRANCH = '00000000-0000-4000-8000-000000000003';
const ITEM = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;

function alert(n: number, type: AlertView['type'], extra: Partial<AlertView> = {}): AlertView {
  return {
    id: `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`,
    type,
    subjectType: 'item',
    subjectId: ITEM(n),
    itemName: `Item ${String(n)}`,
    itemHindiName: null,
    stockUnit: 'kg',
    branchId: BRANCH,
    branchName: 'Main shop',
    details: { quantity: type === 'out_of_stock' ? 0 : 2_500, level: 5_000 },
    raisedAt: '2026-11-22T05:00:00.000Z',
    ...extra,
  };
}

/** The bell's list as the server builds it: counts per type, then the rows. */
function listOf(rows: AlertView[]): AlertList {
  const counts: AlertList['counts'] = {};
  for (const row of rows) counts[row.type] = (counts[row.type] ?? 0) + 1;
  return { counts, total: rows.length, alerts: rows };
}

/** A fake server holding these alerts; a dismissal removes one, as the real one hides it. */
function stubBell(
  initial: AlertView[],
  session = OWNER_SESSION,
  more: Parameters<typeof fakeApi>[1] = {},
) {
  let rows = initial;
  const routes: Parameters<typeof fakeApi>[1] = {
    ...more,
    'GET /api/alerts': () => ({ body: listOf(rows) }),
  };
  for (const row of initial) {
    routes[`POST /api/alerts/${row.id}/dismiss`] = () => {
      rows = rows.filter((other) => other.id !== row.id);
      return { status: 204 };
    };
  }
  const api = fakeApi(session, routes);
  return {
    ...api,
    replace: (next: AlertView[]) => {
      rows = next;
    },
  };
}

const bell = () => screen.findByRole('button', { name: /^(Alerts|अलर्ट), / });

test('shows how many alerts the person has not dismissed, and opens nothing by itself', async () => {
  stubBell([alert(1, 'out_of_stock'), alert(2, 'low_stock'), alert(3, 'low_stock')]);
  renderAt('/');
  expect(await screen.findByRole('button', { name: 'Alerts, 3 to look at' })).toHaveTextContent(
    '3',
  );
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('shows no count when there is nothing to see', async () => {
  stubBell([]);
  renderAt('/');
  const button = await bell();
  expect(button).toHaveAccessibleName('Alerts, 0 to look at');
  expect(button).not.toHaveTextContent(/\d/);
});

test('is a plain count on the billing page: the panel stays shut until it is clicked', async () => {
  stubBell([alert(1, 'out_of_stock')], OWNER_SESSION, {
    'GET /api/billing/context': {
      body: {
        scheme: 'regular',
        branchStateCode: '27',
        features: [],
        negativeStock: 'warn',
        canViewStock: true,
        canManageItems: true,
        canViewCustomers: true,
        canManageCustomers: true,
        canDiscount: true,
      },
    },
    'GET /api/billing/catalogue': {
      body: { items: [], stock: [], serverTime: '2026-11-22T10:00:00.000Z' },
    },
  });
  renderAt('/bill');
  expect(await screen.findByRole('button', { name: 'Alerts, 1 to look at' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Alerts' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Alerts, 1 to look at' }));
  expect(await screen.findByRole('dialog', { name: 'Alerts' })).toBeInTheDocument();
});

test('groups alerts by type, worst first, with each item, stock and level', async () => {
  stubBell([alert(1, 'low_stock'), alert(2, 'out_of_stock'), alert(3, 'low_stock')]);
  renderAt('/');
  await userEvent.click(await bell());
  const panel = await screen.findByRole('dialog', { name: 'Alerts' });
  const headings = within(panel)
    .getAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent);
  expect(headings).toEqual(['Out of stock (1)', 'Low on stock (2)']);
  const low = within(within(panel).getByRole('region', { name: 'Low on stock (2)' }));
  expect(low.getByRole('link', { name: 'Item 1' })).toHaveAttribute('href', `/items/${ITEM(1)}`);
  expect(low.getAllByText('Stock 2.5 kg · level 5 kg')).toHaveLength(2);
  expect(
    within(within(panel).getByRole('region', { name: 'Out of stock (1)' })).getByText(
      'Stock 0 kg · level 5 kg',
    ),
  ).toBeInTheDocument();
});

test('says so when a level was never set', async () => {
  stubBell([alert(1, 'out_of_stock', { details: { quantity: 0, level: null } })]);
  renderAt('/');
  await userEvent.click(await bell());
  expect(await screen.findByText('Stock 0 kg · level none set')).toBeInTheDocument();
});

test('dismissing an alert sends it and lowers the count', async () => {
  const api = stubBell([alert(1, 'out_of_stock'), alert(2, 'low_stock')]);
  renderAt('/');
  await userEvent.click(await bell());
  const panel = await screen.findByRole('dialog', { name: 'Alerts' });
  await userEvent.click(
    within(panel).getByRole('button', { name: 'Dismiss the alert for Item 1' }),
  );
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Alerts, 1 to look at' })).toBeInTheDocument();
  });
  expect(api.sent('POST', `/api/alerts/${alert(1, 'out_of_stock').id}/dismiss`)).toHaveLength(1);
  expect(within(panel).queryByRole('link', { name: 'Item 1' })).toBeNull();
  expect(within(panel).getByRole('link', { name: 'Item 2' })).toBeInTheDocument();
  await userEvent.click(
    within(panel).getByRole('button', { name: 'Dismiss the alert for Item 2' }),
  );
  expect(await within(panel).findByText('Nothing needs your attention.')).toBeInTheDocument();
});

test('leaves the branch out with one branch', async () => {
  stubBell([alert(1, 'low_stock', { branchName: 'Station Road' })], {
    ...OWNER_SESSION,
    branchCount: 1,
  });
  renderAt('/');
  await userEvent.click(await bell());
  expect(await screen.findByText('Stock 2.5 kg · level 5 kg')).toBeInTheDocument();
  expect(screen.queryByText(/Station Road/)).toBeNull();
});

test('names the branch of each alert with two or more branches', async () => {
  stubBell([alert(1, 'low_stock', { branchName: 'Station Road' })], {
    ...OWNER_SESSION,
    branchCount: 2,
  });
  renderAt('/');
  await userEvent.click(await bell());
  expect(await screen.findByText('Stock 2.5 kg · level 5 kg · Station Road')).toBeInTheDocument();
});

test('reads the alerts again every 60 seconds and when the window gets focus', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const api = stubBell([alert(1, 'low_stock')]);
  renderAt('/');
  await screen.findByRole('button', { name: 'Alerts, 1 to look at' });
  const reads = () => api.sent('GET', '/api/alerts').length;
  const before = reads();

  api.replace([alert(1, 'low_stock'), alert(2, 'out_of_stock')]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(await screen.findByRole('button', { name: 'Alerts, 2 to look at' })).toBeInTheDocument();
  expect(reads()).toBeGreaterThan(before);

  const afterTimer = reads();
  api.replace([alert(1, 'low_stock'), alert(2, 'out_of_stock'), alert(3, 'low_stock')]);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10);
  });
  await waitFor(() => {
    expect(reads()).toBeGreaterThan(afterTimer);
  });
});

test('the keyboard shortcut opens the panel', async () => {
  stubBell([alert(1, 'low_stock')]);
  renderAt('/');
  await bell();
  await userEvent.keyboard('{Alt>}k{/Alt}');
  expect(await screen.findByRole('dialog', { name: 'Alerts' })).toBeInTheDocument();
});

test('is in Hindi and in Hinglish', async () => {
  stubBell([alert(1, 'out_of_stock'), alert(2, 'low_stock', { itemHindiName: 'चीनी' })]);
  renderAt('/');
  await bell();
  await act(() => changeLanguage('hi'));
  await userEvent.click(await screen.findByRole('button', { name: 'अलर्ट, देखने के लिए 2' }));
  const panel = await screen.findByRole('dialog', { name: 'अलर्ट' });
  expect(within(panel).getByRole('region', { name: 'स्टॉक ख़त्म (1)' })).toBeInTheDocument();
  expect(within(panel).getByRole('link', { name: 'चीनी' })).toBeInTheDocument();
  await userEvent.click(within(panel).getByRole('button', { name: 'बंद करें' }));

  await act(() => changeLanguage('hi-Latn'));
  await userEvent.click(await screen.findByRole('button', { name: 'Alerts, dekhne ke liye 2' }));
  expect(
    within(await screen.findByRole('dialog', { name: 'Alerts' })).getByRole('region', {
      name: 'Stock khatam (1)',
    }),
  ).toBeInTheDocument();
});

test('a failed read shows no count and says so in the panel', async () => {
  fakeApi(OWNER_SESSION, { 'GET /api/alerts': { status: 500, body: { code: 'server' } } });
  renderAt('/');
  await userEvent.click(await bell());
  expect(await screen.findByText(/Couldn't load the alerts/)).toBeInTheDocument();
});
