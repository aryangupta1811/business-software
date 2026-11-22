import {
  calculateBill,
  cartToBillInput,
  formatPaise,
  type ActiveSession,
  type BillingContext,
  type HeldBillView,
  type CatalogueView,
} from '@business-software/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { CatalogueCopy } from '../../billing/catalogue-copy';
import { catalogueItem } from '../../test/catalogue';
import {
  fakeApi,
  OWNER_SESSION,
  renderAt,
  STAFF_SESSION,
  type FakeAnswer,
} from '../../test/fake-api';

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const CONTEXT: BillingContext = {
  scheme: 'regular',
  branchStateCode: '27',
  features: ['wholesale_price'],
  negativeStock: 'warn',
  canViewStock: true,
  canManageItems: true,
  canViewCustomers: true,
  canManageCustomers: true,
  canDiscount: true,
};

// Made-up items and codes.
const salt = catalogueItem({ wholesalePrice: 2_500 });
const rice = catalogueItem({
  id: '00000000-0000-4000-8000-0000000000a3',
  name: 'Basmati rice',
  hindiName: null,
  code: 'RICE',
  stockUnit: 'kg',
  sellingPrice: 12_000,
  barcodes: [],
});
const soap = catalogueItem({
  id: '00000000-0000-4000-8000-0000000000a4',
  name: 'Neem soap',
  code: 'SOAP',
  gstRate: null,
  hsn: null,
  barcodes: [],
});

const CATALOGUE: CatalogueView = {
  items: [
    rice,
    salt,
    soap,
    {
      id: '00000000-0000-4000-8000-0000000000a5',
      archived: true,
      name: 'Old shampoo',
      barcodes: [{ code: '8900000000005', packId: null }],
    },
  ],
  stock: [{ itemId: salt.id, quantity: 3_000, lowStockLevel: null }],
  serverTime: '2026-11-21T10:00:00.000Z',
};

function counter(
  session: ActiveSession = OWNER_SESSION,
  routes: Parameters<typeof fakeApi>[1] = {},
) {
  const api = fakeApi(session, {
    'GET /api/billing/context': { body: CONTEXT },
    'GET /api/billing/catalogue': { body: CATALOGUE },
    'GET /api/held-bills': { body: [] },
    'POST /api/billing/discard': (body) => ({
      body: { billKey: (body as { draft: { billKey: string } }).draft.billKey },
    }),
    ...routes,
  });
  renderAt('/bill');
  return api;
}

const search = () => screen.findByRole('combobox', { name: 'Search or scan' });
const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const total = () => screen.getByRole('status', { name: 'Total' });

describe('the billing counter', () => {
  test('a scan, a 3* scan and F4 build the bill; the total is the GST engine’s', async () => {
    const user = userEvent.setup();
    counter();
    await user.type(await search(), '8901234567890{Enter}');
    await user.type(await search(), '3*8901234567890{Enter}');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('4 piece');
    expect(rows()[0]).toHaveTextContent('Only 3 piece in stock');

    // A loose item asks for its weight at once; Enter goes back to the search box.
    await user.type(await search(), 'rice{Enter}');
    const weight = screen.getByRole('textbox', { name: 'Quantity of Basmati rice' });
    expect(weight).toHaveFocus();
    await user.clear(weight);
    await user.type(weight, '0.75{Enter}');
    expect(await search()).toHaveFocus();
    expect(rows()[1]).toHaveTextContent('0.75 kg');

    // F4 changes the selected line (the rice) again.
    await user.keyboard('{F4}');
    const again = screen.getByRole('textbox', { name: 'Quantity of Basmati rice' });
    await user.clear(again);
    await user.type(again, '1.5{Enter}');
    expect(rows()[1]).toHaveTextContent('1.5 kg');

    const copy = new CatalogueCopy();
    copy.apply(CATALOGUE, true);
    const expected = calculateBill(
      cartToBillInput(
        {
          priceList: 'retail',
          placeOfSupplyStateCode: '27',
          lines: [
            {
              itemId: salt.id,
              packId: null,
              quantityThousandths: 4_000,
              shownUnitPricePaise: 2_800,
            },
            {
              itemId: rice.id,
              packId: null,
              quantityThousandths: 1_500,
              shownUnitPricePaise: 12_000,
            },
          ],
        },
        { scheme: 'regular', supplierStateCode: '27', catalogue: copy.entries },
      ),
    );
    expect(total()).toHaveTextContent(formatPaise(expected.grandTotalPaise));
  });

  test('says why a code adds nothing', async () => {
    const user = userEvent.setup();
    counter();
    await user.type(await search(), '8909999999999{Enter}');
    expect(screen.getByText('No item with code 8909999999999')).toBeInTheDocument();
    await user.type(await search(), '8900000000005{Enter}');
    expect(screen.getByText(/Old shampoo is archived/)).toBeInTheDocument();
    await user.type(await search(), 'SOAP{Enter}');
    expect(screen.getByText('Set the GST rate and HSN for Neem soap first.')).toBeInTheDocument();
    await user.type(await search(), '1.5*8901234567890{Enter}');
    expect(screen.getByText('Tata Salt 1 kg is sold in whole units only.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  test('F8 switches to wholesale prices and Ctrl+Delete removes the selected line', async () => {
    const user = userEvent.setup();
    counter();
    await user.type(await search(), '8901234567890{Enter}');
    await user.keyboard('{F8}');
    expect(screen.getByRole('button', { name: /Wholesale/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(rows()[0]).toHaveTextContent('25.00');
    await user.keyboard('{Control>}{Delete}{/Control}');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  test('Alt+N on a full bill asks, logs what was thrown away, and starts afresh', async () => {
    const user = userEvent.setup();
    const api = counter();
    await user.type(await search(), '8901234567890{Enter}');
    await user.keyboard('{Alt>}n{/Alt}');
    await user.click(await screen.findByRole('button', { name: 'Clear the bill' }));
    await waitFor(() => {
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
    const [sent] = api.sent('POST', '/api/billing/discard');
    expect(sent?.body).toMatchObject({
      draft: { lines: [{ itemId: salt.id, quantityThousandths: 1_000 }] },
      shownTotalPaise: 2_800,
    });
  });

  test('the open bill survives a reload', async () => {
    const user = userEvent.setup();
    counter();
    await user.type(await search(), '2*8901234567890{Enter}');
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    counter();
    await screen.findByRole('table');
    expect(rows()[0]).toHaveTextContent('2 piece');
  });

  test("a cashier's discount above the limit asks the owner, and the OK clears it", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const api = counter(
      { ...STAFF_SESSION, discountLimitBasisPoints: 500 },
      {
        'POST /api/billing/approvals': () => {
          attempts += 1;
          return attempts === 1
            ? { status: 401, body: { code: 'wrong_password' } }
            : {
                status: 201,
                body: {
                  approvalId: '00000000-0000-4000-8000-0000000000c1',
                  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
                },
              };
        },
      },
    );
    await user.type(await search(), '8901234567890{Enter}');
    await user.keyboard('{F6}');
    await user.type(await screen.findByRole('textbox', { name: 'Percent off' }), '10{Enter}');
    const password = await screen.findByLabelText("Owner's password");
    expect(screen.getByText(/up to 10% off a line and 10% off the whole bill/)).toBeInTheDocument();
    await user.type(password, 'not it{Enter}');
    expect(await screen.findByText("That isn't the owner's password")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Owner's password"), 'correct horse battery{Enter}');
    await waitFor(() => {
      expect(screen.queryByText("Needs the owner's OK")).not.toBeInTheDocument();
    });
    expect(api.sent('POST', '/api/billing/approvals')[1]?.body).toMatchObject({
      kind: 'discount',
      lineBasisPoints: 1_000,
      billBasisPoints: 1_000,
      ownerPassword: 'correct horse battery',
    });
    expect(rows()[0]).toHaveTextContent('−₹2.80');
  });

  test("the owner's own discount on the bill asks nobody", async () => {
    const user = userEvent.setup();
    counter();
    await user.type(await search(), '8901234567890{Enter}');
    await user.keyboard('{F7}');
    await user.click(await screen.findByRole('radio', { name: 'Rupees (₹)' }));
    await user.type(screen.getByRole('textbox', { name: 'Rupees off' }), '3{Enter}');
    await waitFor(() => {
      expect(total()).toHaveTextContent('₹25.00');
    });
    expect(screen.queryByText("Needs the owner's OK")).not.toBeInTheDocument();
  });

  test('F9 holds the bill; on an empty bill it lists the held ones and resumes one', async () => {
    const user = userEvent.setup();
    const heldLines = [
      { itemId: salt.id, packId: null, quantityThousandths: 2_000, shownUnitPricePaise: 2_600 },
    ];
    const heldBill: HeldBillView = {
      id: '00000000-0000-4000-8000-0000000000d1',
      label: 'blue shirt',
      lineCount: 1,
      totalPaise: 5_200,
      heldBy: { id: OWNER_SESSION.user.id, name: 'Ravi Sharma' },
      heldAt: '2026-11-21T09:00:00.000Z',
    };
    const api = counter(OWNER_SESSION, {
      'POST /api/held-bills': { status: 201, body: heldBill },
      'GET /api/held-bills': { body: [heldBill] },
      [`POST /api/held-bills/${heldBill.id}/resume`]: {
        body: {
          draft: {
            billKey: '00000000-0000-4000-8000-0000000000e1',
            priceList: 'retail',
            customerId: null,
            placeOfSupplyStateCode: '27',
            lines: heldLines,
          },
        },
      },
    });
    await user.type(await search(), '8901234567890{Enter}');
    await user.keyboard('{F9}');
    await user.type(
      await screen.findByRole('textbox', { name: /A note to find it by/ }),
      'gate{Enter}',
    );
    await waitFor(() => {
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
    expect(api.sent('POST', '/api/held-bills')[0]?.body).toMatchObject({
      label: 'gate',
      draft: { lines: [{ itemId: salt.id }] },
      shownTotalPaise: 2_800,
    });

    await user.keyboard('{F9}');
    const list = await screen.findByRole('listbox', { name: 'Held bills' });
    expect(within(list).getByText('blue shirt')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await screen.findByRole('table');
    // It was held at ₹26.00; the copy now says ₹28.00, so the line says so.
    expect(rows()[0]).toHaveTextContent('2 piece');
    expect(rows()[0]).toHaveTextContent('Price changed');
    expect(rows()[0]).toHaveTextContent('28.00');
  });

  test('the whole bill by keyboard: scan, F3 customer, F10 payment, ready to save', async () => {
    const user = userEvent.setup();
    const api = counter(OWNER_SESSION, {
      'GET /api/customers?phone=9876500001': {
        body: [
          {
            id: '00000000-0000-4000-8000-0000000000c1',
            name: 'Meena Stores',
            phone: '9876500001',
            gstin: null,
            legalName: null,
            address: null,
            pinCode: null,
            stateCode: null,
            version: 1,
          },
        ],
      },
    });
    await user.type(await search(), '8901234567890{Enter}');
    await user.keyboard('{F3}');
    await user.type(
      await screen.findByRole('combobox', { name: 'Phone number or name' }),
      '9876500001',
    );
    await screen.findByRole('option', { name: /Meena Stores/ });
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.getByText('Meena Stores')).toBeInTheDocument();
    });

    await user.keyboard('{F10}');
    await screen.findByRole('textbox', { name: 'Cash received' });
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Paid. Ready to save.')).toBeInTheDocument();
    expect(api.sent('GET', '/api/customers?phone=9876500001')).toHaveLength(1);
    // The customer is on the bill the save (P1.14) will send.
    const stored = JSON.parse(sessionStorage.getItem(`bill:${OWNER_SESSION.user.id}`) ?? '{}') as {
      customerId?: string;
    };
    expect(stored.customerId).toBe('00000000-0000-4000-8000-0000000000c1');
  });

  test('F10 asks the owner first when a discount is above the limit', async () => {
    const user = userEvent.setup();
    counter({ ...STAFF_SESSION, discountLimitBasisPoints: 0 });
    await user.type(await search(), '8901234567890{Enter}');
    await user.keyboard('{F6}');
    await user.type(await screen.findByRole('textbox', { name: 'Percent off' }), '5{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await user.keyboard('{F10}');
    expect(await screen.findByLabelText("Owner's password")).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Cash received' })).not.toBeInTheDocument();
  });
});

describe('saving the bill at the counter', () => {
  const SAVED = {
    id: '00000000-0000-4000-8000-0000000000f1',
    number: 'ABC/26-27/42',
    document: 'tax_invoice',
    businessDate: '2026-11-22',
    grandTotalPaise: 2_800,
    changePaise: 0,
    warnings: [],
  };
  const storedKey = () =>
    (
      JSON.parse(sessionStorage.getItem(`bill:${OWNER_SESSION.user.id}`) ?? '{}') as {
        billKey: string;
      }
    ).billKey;
  const keysSent = (api: ReturnType<typeof counter>) =>
    api.sent('POST', '/api/bills').map((request) => (request.body as { billKey: string }).billKey);

  /** Scans a salt and pays it in cash (`handed` rupees when more than the bill), up to "ready to save". */
  async function paidBill(
    user: ReturnType<typeof userEvent.setup>,
    routes: Parameters<typeof fakeApi>[1] = {},
    handed?: string,
  ) {
    const api = counter(OWNER_SESSION, routes);
    await user.type(await search(), '8901234567890{Enter}');
    await user.keyboard('{F10}');
    const cash = await screen.findByRole('textbox', { name: 'Cash received' });
    if (handed !== undefined) {
      await user.clear(cash);
      await user.type(cash, handed);
    }
    await user.keyboard('{Enter}');
    await screen.findByText('Paid. Ready to save.');
    return api;
  }

  /** A save answer that is lost on the wire `times` times, then comes through. */
  const lostThenSaved = (times: number) => {
    let left = times;
    return (): FakeAnswer => (left-- > 0 ? { fail: true } : { status: 201, body: SAVED });
  };

  test('Enter saves the paid bill with its key, payments and total, then shows its number and the change', async () => {
    const user = userEvent.setup();
    const api = await paidBill(
      user,
      { 'POST /api/bills': { status: 201, body: { ...SAVED, changePaise: 2_200 } } },
      '50',
    );
    const key = storedKey();
    await user.keyboard('{Enter}');

    expect(await screen.findByText('Bill saved, ABC/26-27/42')).toBeInTheDocument();
    expect(screen.getByText('Change to give ₹22.00')).toBeInTheDocument();
    const [sent] = api.sent('POST', '/api/bills');
    expect(sent?.body).toEqual({
      billKey: key,
      priceList: 'retail',
      customerId: null,
      placeOfSupplyStateCode: '27',
      lines: [
        { itemId: salt.id, packId: null, quantityThousandths: 1_000, shownUnitPricePaise: 2_800 },
      ],
      payments: [{ mode: 'cash', amountPaise: 2_800, tenderedPaise: 5_000 }],
      shownGrandTotalPaise: 2_800,
    });
    // The bill is done: nothing of it stays in this tab.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(sessionStorage.getItem(`bill:${OWNER_SESSION.user.id}`)).toBeNull();

    // Enter in the empty search box goes on to the next bill.
    await user.keyboard('{Enter}');
    expect(screen.queryByText('Bill saved, ABC/26-27/42')).not.toBeInTheDocument();
    await user.type(await search(), '8901234567890{Enter}');
    expect(rows()).toHaveLength(1);
    expect(storedKey()).not.toBe(key);
  });

  test('Alt+N after a save starts the next bill', async () => {
    const user = userEvent.setup();
    await paidBill(user, { 'POST /api/bills': { status: 201, body: SAVED } });
    await user.click(screen.getByRole('button', { name: /Save bill/ }));
    await screen.findByText('Bill saved, ABC/26-27/42');
    await user.keyboard('{Alt>}n{/Alt}');
    expect(screen.queryByText('Bill saved, ABC/26-27/42')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pay/ })).toBeDisabled();
  });

  test("the owner's OK for the bill goes with it and is forgotten after the save", async () => {
    const user = userEvent.setup();
    const approvalId = '00000000-0000-4000-8000-0000000000c9';
    const key = '00000000-0000-4000-8000-0000000000e2';
    // A bill left open in this tab, with the owner's OK stored beside it.
    sessionStorage.setItem(
      `bill:${OWNER_SESSION.user.id}`,
      JSON.stringify({
        billKey: key,
        priceList: 'retail',
        customerId: null,
        placeOfSupplyStateCode: '27',
        lines: [
          { itemId: salt.id, packId: null, quantityThousandths: 1_000, shownUnitPricePaise: 2_800 },
        ],
      }),
    );
    sessionStorage.setItem(
      `bill-approval:${key}`,
      JSON.stringify({
        approvalId,
        billKey: key,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        lineBasisPoints: 500,
        billBasisPoints: 0,
      }),
    );
    const api = counter(OWNER_SESSION, { 'POST /api/bills': { status: 201, body: SAVED } });
    await screen.findByRole('table');
    await user.keyboard('{F10}');
    await screen.findByRole('textbox', { name: 'Cash received' });
    await user.keyboard('{Enter}');
    await screen.findByText('Paid. Ready to save.');
    await user.keyboard('{Enter}');
    await screen.findByText('Bill saved, ABC/26-27/42');
    expect(api.sent('POST', '/api/bills')[0]?.body).toMatchObject({ billKey: key, approvalId });
    expect(sessionStorage.getItem(`bill-approval:${key}`)).toBeNull();
  });

  test('a second Enter while the first is still sending does not send the bill twice', async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = await paidBill(user, { 'POST /api/bills': { status: 201, body: SAVED, wait } });
    await user.keyboard('{Enter}{Enter}');
    expect(await screen.findByRole('button', { name: /Saving/ })).toBeDisabled();
    // The bill can't change while it is on its way.
    await user.type(await search(), '8901234567890{Enter}');
    expect(rows()[0]).toHaveTextContent('1 piece');
    release();
    await screen.findByText('Bill saved, ABC/26-27/42');
    expect(api.sent('POST', '/api/bills')).toHaveLength(1);
  });

  test('a lost answer is sent again with the same bill key, and one bill is saved', async () => {
    const user = userEvent.setup();
    const api = await paidBill(user, { 'POST /api/bills': lostThenSaved(1) });
    await user.keyboard('{Enter}');
    expect(
      await screen.findByText('Bill saved, ABC/26-27/42', undefined, { timeout: 4_000 }),
    ).toBeInTheDocument();
    const keys = keysSent(api);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  test('when nothing gets through it says so, and Enter tries again with the same key', async () => {
    const user = userEvent.setup();
    const api = await paidBill(user, { 'POST /api/bills': lostThenSaved(3) });
    await user.keyboard('{Enter}');
    expect(
      await screen.findByText(/No connection\. The bill is not saved yet/, undefined, {
        timeout: 6_000,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save bill/ })).toBeEnabled();
    await user.keyboard('{Enter}');
    await screen.findByText('Bill saved, ABC/26-27/42');
    expect(keysSent(api)).toHaveLength(4);
    expect(new Set(keysSent(api)).size).toBe(1);
  }, 15_000);

  test('stock the bill cannot take says which item, and the bill stays', async () => {
    const user = userEvent.setup();
    await paidBill(user, {
      'POST /api/bills': { status: 409, body: { code: 'stock_short', itemId: salt.id } },
    });
    await user.keyboard('{Enter}');
    expect(
      await screen.findByText(/Tata Salt 1 kg: not enough in stock to sell this quantity/),
    ).toBeInTheDocument();
    expect(rows()).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Save bill/ })).toBeEnabled();
  });

  test('stock that went below zero is told after the save', async () => {
    const user = userEvent.setup();
    await paidBill(user, {
      'POST /api/bills': {
        status: 201,
        body: { ...SAVED, warnings: [{ itemId: salt.id, balanceAfter: -2_000 }] },
      },
    });
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Bill saved, ABC/26-27/42')).toBeInTheDocument();
    expect(
      screen.getByText('Tata Salt 1 kg is now below zero: -2 piece in stock.'),
    ).toBeInTheDocument();
  });

  test('new prices from the server are marked, the copy is reloaded, and payment is asked again', async () => {
    const user = userEvent.setup();
    let price = 2_800;
    const api = await paidBill(user, {
      'GET /api/billing/catalogue': () => ({
        body: {
          ...CATALOGUE,
          items: [
            { ...salt, sellingPrice: price },
            ...CATALOGUE.items.filter((item) => item.id !== salt.id),
          ],
        },
      }),
      'POST /api/bills': () => {
        price = 3_000;
        return {
          status: 409,
          body: {
            code: 'prices_changed',
            lines: [{ line: 1, unitPricePaise: 3_000 }],
            grandTotalPaise: 3_000,
          },
        };
      },
    });
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/Prices changed while you were billing/)).toBeInTheDocument();
    await waitFor(() => {
      expect(total()).toHaveTextContent('₹30.00');
    });
    expect(rows()[0]).toHaveTextContent('30.00');
    expect(rows()[0]).toHaveTextContent('Price changed');
    // The payment was for ₹28: the cashier pays the new total.
    expect(screen.queryByText('Paid. Ready to save.')).not.toBeInTheDocument();
    expect(api.sent('GET', '/api/billing/catalogue').length).toBeGreaterThan(1);
    await user.keyboard('{F10}');
    await screen.findByRole('textbox', { name: 'Cash received' });
    await user.keyboard('{Enter}');
    await screen.findByText('Paid. Ready to save.');
  });

  test.each([
    ['approval_required', 403, {}, /above what this login may give/],
    ['approval_invalid', 409, {}, /The owner's OK has run out or was already used/],
    ['gstin_required', 409, {}, /This branch has no GSTIN yet/],
    ['buyer_details_required', 422, {}, /needs the buyer's name, address and state/],
    ['items_unavailable', 409, { lines: [1] }, /Line 1 can't be sold any more/],
    ['customer_unavailable', 409, {}, /This customer was archived/],
    ['wholesale_off', 422, {}, /Wholesale prices are switched off/],
    ['payments_mismatch', 422, {}, /The payments don't match the total/],
  ])('says in words what %s means', async (code, status, detail, message) => {
    const user = userEvent.setup();
    await paidBill(user, { 'POST /api/bills': { status, body: { code, ...detail } } });
    await user.keyboard('{Enter}');
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText(/Bill saved/)).not.toBeInTheDocument();
  });
});
