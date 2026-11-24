import { sampleBill } from '@business-software/print';
import { businessDate, type BillListItem, type BillListPage } from '@business-software/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { printBill } from '../../printing/print-bill';
import { fakeApi, OWNER_SESSION, renderAt, STAFF_SESSION } from '../../test/fake-api';

vi.mock('../../printing/print-bill', () => ({ printBill: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  vi.mocked(printBill).mockClear();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const today = businessDate(new Date());

// Made-up bills.
const first: BillListItem = {
  id: '00000000-0000-4000-8000-0000000000b2',
  number: 'ABC/26-27/42',
  document: 'tax_invoice',
  businessDate: today,
  createdAt: '2026-11-24T08:35:00.000Z',
  grandTotalPaise: 46_600,
  branchId: OWNER_SESSION.branch.id,
  branchCode: 'HO',
  customerName: 'Meena Devi',
  customerPhone: '9876543210',
  paymentModes: ['cash', 'upi'],
};
const second: BillListItem = {
  ...first,
  id: '00000000-0000-4000-8000-0000000000b1',
  number: 'ABC/26-27/41',
  document: 'bill',
  grandTotalPaise: 12_000,
  customerName: null,
  customerPhone: null,
  paymentModes: ['cash'],
};

const page = (bills: BillListItem[], next: string | null = null): { body: BillListPage } => ({
  body: { bills, next },
});

const urls = (api: ReturnType<typeof fakeApi>) =>
  api.fetchMock.mock.calls
    .map(([url]) => url)
    .filter((url) => url.startsWith('/api/bills?') || url === '/api/bills');

describe('the Bills page', () => {
  test("lists today's bills, newest first, with who bought and how they paid", async () => {
    const api = fakeApi(OWNER_SESSION, { 'GET /api/bills': page([first, second]) });
    renderAt('/bills');
    const rows = (await screen.findAllByRole('row')).slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('ABC/26-27/42');
    expect(rows[0]).toHaveTextContent('Tax invoice');
    expect(rows[0]).toHaveTextContent('Meena Devi');
    expect(rows[0]).toHaveTextContent('9876543210');
    expect(rows[0]).toHaveTextContent('Cash, UPI');
    expect(rows[0]).toHaveTextContent('₹466.00');
    expect(rows[1]).toHaveTextContent('Walk-in customer');
    expect(urls(api)[0]).toBe(`/api/bills?from=${today}&to=${today}`);
  });

  test('searches by number, name or phone, and by dates', async () => {
    const user = userEvent.setup();
    const api = fakeApi(OWNER_SESSION, { 'GET /api/bills': page([first]) });
    renderAt('/bills');
    await screen.findByText('ABC/26-27/42');
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'Meena');
    await waitFor(() => {
      expect(urls(api).at(-1)).toBe(`/api/bills?q=Meena&from=${today}&to=${today}`);
    });
    await user.click(screen.getByRole('button', { name: 'Show every date' }));
    await waitFor(() => {
      expect(urls(api).at(-1)).toBe('/api/bills?q=Meena');
    });
  });

  test('says so when nothing matches', async () => {
    fakeApi(OWNER_SESSION, { 'GET /api/bills': page([]) });
    renderAt('/bills');
    expect(
      await screen.findByText('No bills match. Change the search or the dates.'),
    ).toBeInTheDocument();
  });

  test('shows more with the cursor the server gave', async () => {
    const user = userEvent.setup();
    const api = fakeApi(OWNER_SESSION, {
      'GET /api/bills': (_body, url) =>
        url.includes('after=') ? page([second]) : page([first], first.id),
    });
    renderAt('/bills');
    await screen.findByText('ABC/26-27/42');
    await user.click(screen.getByRole('button', { name: 'Show more bills' }));
    expect(await screen.findByText('ABC/26-27/41')).toBeInTheDocument();
    expect(urls(api).at(-1)).toContain(`after=${first.id}`);
    expect(screen.queryByRole('button', { name: 'Show more bills' })).not.toBeInTheDocument();
  });

  test('Alt+P prints the first bill again, logged, with the Reprint date', async () => {
    const user = userEvent.setup();
    const reprintedAt = '2026-11-24T09:00:00.000Z';
    const api = fakeApi(OWNER_SESSION, {
      'GET /api/bills': page([first, second]),
      [`GET /api/bills/${first.id}`]: { body: { ...sampleBill(), id: first.id } },
      [`POST /api/bills/${first.id}/reprints`]: { status: 201, body: { reprintedAt } },
    });
    renderAt('/bills');
    await screen.findByText('ABC/26-27/42');
    await user.keyboard('{Alt>}p{/Alt}');
    await waitFor(() => {
      expect(printBill).toHaveBeenCalledWith(
        expect.objectContaining({ id: first.id }),
        '80',
        reprintedAt,
      );
    });
    expect(api.sent('POST', `/api/bills/${first.id}/reprints`)).toHaveLength(1);
  });

  test('prints the bill that was picked, on A4 with Alt+A', async () => {
    const user = userEvent.setup();
    fakeApi(OWNER_SESSION, {
      'GET /api/bills': page([first, second]),
      [`GET /api/bills/${second.id}`]: { body: { ...sampleBill(), id: second.id } },
      [`POST /api/bills/${second.id}/reprints`]: {
        status: 201,
        body: { reprintedAt: '2026-11-24T09:00:00.000Z' },
      },
    });
    renderAt('/bills');
    await user.click(await screen.findByRole('button', { name: 'ABC/26-27/41' }));
    expect(screen.getByRole('toolbar')).toHaveAccessibleName('Actions for bill ABC/26-27/41');
    await user.keyboard('{Alt>}a{/Alt}');
    await waitFor(() => {
      expect(printBill).toHaveBeenCalledWith(
        expect.objectContaining({ id: second.id }),
        'a4',
        '2026-11-24T09:00:00.000Z',
      );
    });
  });

  test('opens WhatsApp for the picked bill', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    fakeApi(OWNER_SESSION, {
      'GET /api/bills': page([first]),
      [`GET /api/bills/${first.id}`]: {
        body: { ...sampleBill(), id: first.id, customerPhone: '9876543210' },
      },
    });
    renderAt('/bills');
    await screen.findByText('ABC/26-27/42');
    await user.click(screen.getByRole('button', { name: /Send on WhatsApp/ }));
    await waitFor(() => {
      expect(open).toHaveBeenCalled();
    });
    expect(String(open.mock.calls[0]?.[0])).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
  });

  test('says when the print failed', async () => {
    const user = userEvent.setup();
    vi.mocked(printBill).mockRejectedValueOnce(new Error('no printer'));
    fakeApi(OWNER_SESSION, {
      'GET /api/bills': page([first]),
      [`GET /api/bills/${first.id}`]: { body: { ...sampleBill(), id: first.id } },
      [`POST /api/bills/${first.id}/reprints`]: {
        status: 201,
        body: { reprintedAt: '2026-11-24T09:00:00.000Z' },
      },
    });
    renderAt('/bills');
    await screen.findByText('ABC/26-27/42');
    await user.click(screen.getByRole('button', { name: /Print receipt/ }));
    expect(await within(screen.getByRole('toolbar')).findByRole('alert')).toHaveTextContent(
      "Couldn't print",
    );
  });

  test('is in the sidebar with its key, for anyone who may sell', async () => {
    const user = userEvent.setup();
    fakeApi(STAFF_SESSION, { 'GET /api/bills': page([first]) });
    const history = renderAt('/');
    const link = await screen.findByRole('link', { name: /Bills/ });
    expect(link).toHaveAttribute('aria-keyshortcuts', 'Alt+V');
    await user.keyboard('{Alt>}v{/Alt}');
    await waitFor(() => {
      expect(history.location.pathname).toBe('/bills');
    });
  });
});
