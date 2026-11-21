import {
  calculateBill,
  cartToBillInput,
  formatPaise,
  type BillingContext,
  type CatalogueView,
} from '@business-software/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { CatalogueCopy } from '../../billing/catalogue-copy';
import { catalogueItem } from '../../test/catalogue';
import { fakeApi, OWNER_SESSION, renderAt } from '../../test/fake-api';

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

function counter() {
  const api = fakeApi(OWNER_SESSION, {
    'GET /api/billing/context': { body: CONTEXT },
    'GET /api/billing/catalogue': { body: CATALOGUE },
    'POST /api/billing/discard': (body) => ({
      body: { billKey: (body as { draft: { billKey: string } }).draft.billKey },
    }),
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
    expect(total()).toHaveTextContent(`₹${formatPaise(expected.grandTotalPaise)}`);
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
});
