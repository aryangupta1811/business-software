// The "Bill saved" panel's printing and sharing (P1.15; `02` #30, #31, #33, #27): what the
// counter asks for when a bill is saved. How a bill is drawn and printed has its own tests
// (packages/print and printing/).
import { sampleBill } from '@business-software/print';
import type { ActiveSession, BillingContext, CatalogueView } from '@business-software/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { printBill } from '../../printing/print-bill';
import { catalogueItem } from '../../test/catalogue';
import { fakeApi, OWNER_SESSION, renderAt } from '../../test/fake-api';

vi.mock('../../printing/print-bill', () => ({ printBill: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  vi.mocked(printBill).mockClear();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const CONTEXT: BillingContext = {
  scheme: 'regular',
  branchStateCode: '27',
  features: [],
  negativeStock: 'warn',
  canViewStock: true,
  canManageItems: true,
  canViewCustomers: true,
  canManageCustomers: true,
  canDiscount: true,
};

const CATALOGUE: CatalogueView = {
  items: [catalogueItem({})],
  stock: [],
  serverTime: '2026-11-21T10:00:00.000Z',
};

const ID = '00000000-0000-4000-8000-0000000000f1';
const SAVED = {
  id: ID,
  number: 'ABC/26-27/42',
  document: 'tax_invoice',
  businessDate: '2026-11-22',
  grandTotalPaise: 2_800,
  changePaise: 0,
  warnings: [],
};
const saved = { 'POST /api/bills': { status: 201, body: SAVED } };
const detail = (extra = {}) => ({
  [`GET /api/bills/${ID}`]: { body: { ...sampleBill(), id: ID, ...extra } },
});
const manual: ActiveSession = {
  ...OWNER_SESSION,
  printing: { receiptSize: 80, autoPrint: false },
};

/** A bill scanned, paid in cash and saved. */
async function savedBill(
  user: ReturnType<typeof userEvent.setup>,
  routes: Parameters<typeof fakeApi>[1],
  session: ActiveSession = OWNER_SESSION,
) {
  const api = fakeApi(session, {
    'GET /api/billing/context': { body: CONTEXT },
    'GET /api/billing/catalogue': { body: CATALOGUE },
    'GET /api/held-bills': { body: [] },
    ...routes,
  });
  renderAt('/bill');
  await user.type(
    await screen.findByRole('combobox', { name: 'Search or scan' }),
    '8901234567890{Enter}',
  );
  await user.keyboard('{F10}');
  await screen.findByRole('textbox', { name: 'Cash received' });
  await user.keyboard('{Enter}');
  await screen.findByText('Paid. Ready to save.');
  await user.keyboard('{Enter}');
  await screen.findByText('Bill saved, ABC/26-27/42');
  return api;
}

describe('printing the saved bill', () => {
  test('prints the receipt at once, as the first print, when auto-print is on (the default)', async () => {
    const user = userEvent.setup();
    const api = await savedBill(user, { ...saved, ...detail() });
    await waitFor(() => {
      expect(printBill).toHaveBeenCalledTimes(1);
    });
    expect(printBill).toHaveBeenCalledWith(expect.objectContaining({ id: ID }), '80', null);
    // A first print is not a reprint: nothing is logged.
    expect(api.sent('POST', `/api/bills/${ID}/reprints`)).toHaveLength(0);
  });

  test("prints a bill with the buyer's GSTIN on A4 by default (02 #31)", async () => {
    const user = userEvent.setup();
    await savedBill(user, { ...saved, ...detail(sampleBill({ interState: true })) });
    await waitFor(() => {
      expect(printBill).toHaveBeenCalledWith(expect.anything(), 'a4', null);
    });
  });

  test('prints a named buyer without a GSTIN on the receipt, on this counter paper', async () => {
    const user = userEvent.setup();
    const walkIn = sampleBill({ interState: true });
    const buyer = walkIn.buyer === null ? null : { ...walkIn.buyer, gstin: null };
    await savedBill(
      user,
      { ...saved, ...detail({ buyer }) },
      {
        ...OWNER_SESSION,
        printing: { receiptSize: 58, autoPrint: true },
      },
    );
    await waitFor(() => {
      expect(printBill).toHaveBeenCalledWith(expect.anything(), '58', null);
    });
  });

  test('prints nothing by itself when this computer has auto-print off', async () => {
    const user = userEvent.setup();
    const api = await savedBill(user, { ...saved, ...detail() }, manual);
    expect(printBill).not.toHaveBeenCalled();
    expect(api.sent('GET', `/api/bills/${ID}`)).toHaveLength(0);
  });

  test('Alt+P prints the receipt; the second print of the bill is a logged reprint with its date', async () => {
    const user = userEvent.setup();
    const reprintedAt = '2026-11-24T09:00:00.000Z';
    const api = await savedBill(
      user,
      {
        ...saved,
        ...detail(),
        [`POST /api/bills/${ID}/reprints`]: { status: 201, body: { reprintedAt } },
      },
      manual,
    );
    await user.keyboard('{Alt>}p{/Alt}');
    await waitFor(() => {
      expect(printBill).toHaveBeenCalledTimes(1);
    });
    expect(printBill).toHaveBeenLastCalledWith(expect.anything(), '80', null);
    expect(api.sent('POST', `/api/bills/${ID}/reprints`)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /Print receipt/ }));
    await waitFor(() => {
      expect(printBill).toHaveBeenCalledTimes(2);
    });
    expect(printBill).toHaveBeenLastCalledWith(expect.anything(), '80', reprintedAt);
    expect(api.sent('POST', `/api/bills/${ID}/reprints`)).toHaveLength(1);
  });

  test('Alt+A prints A4, and a 58 mm counter prints a 58 mm receipt', async () => {
    const user = userEvent.setup();
    await savedBill(
      user,
      {
        ...saved,
        ...detail(),
        [`POST /api/bills/${ID}/reprints`]: {
          status: 201,
          body: { reprintedAt: '2026-11-24T09:00:00.000Z' },
        },
      },
      {
        ...OWNER_SESSION,
        printing: { receiptSize: 58, autoPrint: false },
      },
    );
    await user.keyboard('{Alt>}a{/Alt}');
    await waitFor(() => {
      expect(printBill).toHaveBeenLastCalledWith(expect.anything(), 'a4', null);
    });
    await user.keyboard('{Alt>}p{/Alt}');
    await waitFor(() => {
      expect(printBill).toHaveBeenLastCalledWith(
        expect.anything(),
        '58',
        '2026-11-24T09:00:00.000Z',
      );
    });
  });

  test('Alt+A inside the payment panel still splits the payment and prints nothing', async () => {
    const user = userEvent.setup();
    fakeApi(manual, {
      'GET /api/billing/context': { body: CONTEXT },
      'GET /api/billing/catalogue': { body: CATALOGUE },
      'GET /api/held-bills': { body: [] },
    });
    renderAt('/bill');
    await user.type(
      await screen.findByRole('combobox', { name: 'Search or scan' }),
      '8901234567890{Enter}',
    );
    await user.keyboard('{F10}');
    await screen.findByRole('textbox', { name: 'Cash received' });
    await user.keyboard('{Alt>}a{/Alt}');
    expect(await screen.findAllByRole('textbox', { name: /Amount/ })).not.toHaveLength(0);
    expect(printBill).not.toHaveBeenCalled();
  });

  test('says when the printing failed, and lets the cashier try again', async () => {
    const user = userEvent.setup();
    vi.mocked(printBill).mockRejectedValueOnce(new Error('no printer'));
    await savedBill(user, { ...saved, ...detail() }, manual);
    await user.keyboard('{Alt>}p{/Alt}');
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't print");
    await user.keyboard('{Alt>}p{/Alt}');
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});

describe('sending the saved bill on WhatsApp', () => {
  test('Alt+W opens a chat with the customer, in the bill language, with only the number and the text', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await savedBill(
      user,
      { ...saved, ...detail({ customerPhone: '9876543210', language: 'hi' }) },
      manual,
    );
    await user.keyboard('{Alt>}w{/Alt}');
    await waitFor(() => {
      expect(open).toHaveBeenCalledTimes(1);
    });
    const [link] = open.mock.calls[0] ?? [];
    const url = new URL(String(link));
    expect(url.origin + url.pathname).toBe('https://wa.me/919876543210');
    expect([...url.searchParams.keys()]).toEqual(['text']);
    const text = url.searchParams.get('text') ?? '';
    expect(text).toContain('Sample Store');
    expect(text).toContain('ST/26-27/101');
    expect(text).toContain('आपका बिल');
  });

  test('Alt+W on a bill with no customer phone says so and opens nothing', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await savedBill(user, { ...saved, ...detail({ customerPhone: null }) }, manual);
    await user.keyboard('{Alt>}w{/Alt}');
    expect(await screen.findByRole('alert')).toHaveTextContent('no customer phone number');
    expect(open).not.toHaveBeenCalled();
  });
});
