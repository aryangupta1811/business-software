import type {
  ActiveSession,
  UdhaarCustomersView,
  UdhaarEntryView,
  UdhaarLedgerView,
} from '@business-software/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { changeLanguage } from '../../i18n';
import { fakeApi, OWNER_SESSION, renderAt, STAFF_SESSION } from '../../test/fake-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

// Made-up ids, names and numbers.
const SUNITA = '00000000-0000-4000-8000-0000000000c1';
const KAMAL = '00000000-0000-4000-8000-0000000000c2';
const PAYMENT = '00000000-0000-4000-8000-0000000000e3';

const LIST: UdhaarCustomersView = {
  customers: [
    {
      id: KAMAL,
      name: 'Kamal Singh',
      phone: '9876500002',
      balancePaise: -30_000,
      creditLimitPaise: null,
      oldestDueDate: null,
    },
    {
      id: SUNITA,
      name: 'Sunita Devi',
      phone: '9876500001',
      balancePaise: 124_000,
      creditLimitPaise: 500_000,
      oldestDueDate: '2020-01-31',
    },
  ],
  more: false,
};

const entry = (extra: Partial<UdhaarEntryView> & Pick<UdhaarEntryView, 'id' | 'kind'>) =>
  ({
    amountPaise: 0,
    balanceAfterPaise: 0,
    billId: null,
    billNumber: null,
    mode: null,
    reference: null,
    reversesEntryId: null,
    dueDate: null,
    businessDate: '2026-11-20',
    reason: null,
    createdBy: OWNER_SESSION.user.id,
    createdAt: '2026-11-20T10:00:00.000Z',
    ...extra,
  }) satisfies UdhaarEntryView;

const BILL = entry({
  id: '00000000-0000-4000-8000-0000000000e1',
  kind: 'bill',
  amountPaise: 124_000,
  balanceAfterPaise: 124_000,
  billNumber: 'ABC/26-27/7',
  billId: '00000000-0000-4000-8000-0000000000f1',
  dueDate: '2020-01-31',
});
const PAID = entry({
  id: PAYMENT,
  kind: 'payment',
  amountPaise: -24_000,
  balanceAfterPaise: 100_000,
  mode: 'upi',
  reference: 'UTR8841',
});

const customer = {
  id: SUNITA,
  name: 'Sunita Devi',
  phone: '9876500001',
  gstin: null,
  legalName: null,
  address: null,
  pinCode: null,
  stateCode: null,
  creditLimitPaise: 500_000 as number | null,
  dueDays: 30,
  version: 4,
};

const LEDGER: UdhaarLedgerView = {
  customerId: SUNITA,
  customer,
  balancePaise: 100_000,
  creditLimitPaise: 500_000,
  dueDays: 30,
  entries: [PAID, BILL],
  next: null,
  unpaid: [{ entry: BILL, unpaidPaise: 100_000 }],
};

const CASHIER: ActiveSession = {
  ...STAFF_SESSION,
  permissions: ['session.own', 'customers.view', 'billing.sell'],
};
const VIEWER: ActiveSession = {
  ...STAFF_SESSION,
  permissions: ['session.own', 'customers.view'],
};

const nav = () => screen.getByRole('navigation', { name: 'Main' });

describe('the Customers page', () => {
  test('lists customers with their balance, limit and oldest due date, and a way in to each', async () => {
    fakeApi(OWNER_SESSION, { 'GET /api/udhaar/customers': { body: LIST } });
    renderAt('/customers');
    expect(await screen.findByRole('heading', { level: 1, name: 'Customers' })).toBeInTheDocument();
    const rows = within(await screen.findByRole('table'))
      .getAllByRole('row')
      .slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Kamal Singh');
    expect(rows[0]).toHaveTextContent('Advance ₹300.00');
    expect(rows[0]).toHaveTextContent('No limit set');
    expect(rows[1]).toHaveTextContent('Sunita Devi');
    expect(rows[1]).toHaveTextContent('Owes ₹1,240.00');
    expect(rows[1]).toHaveTextContent('₹5,000.00');
    // Long overdue: the date and how late it is, in words.
    expect(rows[1]).toHaveTextContent('31 Jan 2020');
    const [kamalRow, sunitaRow] = rows as [HTMLElement, HTMLElement];
    expect(within(sunitaRow).getByText(/days late/)).toBeInTheDocument();
    expect(within(kamalRow).queryByText(/late/)).not.toBeInTheDocument();
    expect(within(sunitaRow).getByRole('link', { name: 'Sunita Devi' })).toHaveAttribute(
      'href',
      `/customers/${SUNITA}`,
    );
  });

  test('"Owes money" and the search box ask the server', async () => {
    const user = userEvent.setup();
    const api = fakeApi(OWNER_SESSION, { 'GET /api/udhaar/customers': { body: LIST } });
    renderAt('/customers');
    await screen.findByRole('table');
    await user.click(screen.getByRole('checkbox', { name: 'Owes money' }));
    await waitFor(() => {
      expect(api.fetchMock).toHaveBeenCalledWith(
        '/api/udhaar/customers?owing=true',
        expect.anything(),
      );
    });
    await user.type(screen.getByRole('searchbox'), 'sun');
    await waitFor(() => {
      expect(api.fetchMock).toHaveBeenCalledWith(
        '/api/udhaar/customers?q=sun&owing=true',
        expect.anything(),
      );
    });
  });

  test('says so when nobody matches, and when there are no customers at all', async () => {
    fakeApi(OWNER_SESSION, {
      'GET /api/udhaar/customers': { body: { customers: [], more: false } },
    });
    renderAt('/customers');
    expect(await screen.findByText(/No customers yet/)).toBeInTheDocument();
  });

  test('is in the sidebar for anyone who may see customers, and not for anyone else', async () => {
    fakeApi(CASHIER, { 'GET /api/udhaar/customers': { body: LIST } });
    renderAt('/customers');
    await screen.findByRole('table');
    expect(within(nav()).getByRole('link', { name: /Customers/ })).toHaveAttribute(
      'href',
      '/customers',
    );
  });

  test('a login without customers.view cannot open it', async () => {
    fakeApi({ ...STAFF_SESSION, permissions: ['session.own', 'billing.sell'] });
    renderAt('/customers');
    expect(await screen.findByText("You can't open this page")).toBeInTheDocument();
    expect(within(nav()).queryByRole('link', { name: /Customers/ })).toBeNull();
  });

  test('Alt+C goes to the page', async () => {
    const user = userEvent.setup();
    fakeApi(OWNER_SESSION, { 'GET /api/udhaar/customers': { body: LIST } });
    const history = renderAt('/');
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    await user.keyboard('{Alt>}c{/Alt}');
    await waitFor(() => {
      expect(history.location.pathname).toBe('/customers');
    });
  });

  test('speaks Hindi', async () => {
    await changeLanguage('hi');
    fakeApi(OWNER_SESSION, { 'GET /api/udhaar/customers': { body: LIST } });
    renderAt('/customers');
    expect(await screen.findByRole('heading', { level: 1, name: 'ग्राहक' })).toBeInTheDocument();
    expect(await screen.findByText('₹1,240.00 बकाया')).toBeInTheDocument();
  });
});

describe("a customer's page", () => {
  const route = `GET /api/udhaar/customers/${SUNITA}`;

  test('shows the balance in large type, the unpaid bills with due dates, and the ledger with the balance after each line', async () => {
    fakeApi(OWNER_SESSION, { [route]: { body: LEDGER } });
    renderAt(`/customers/${SUNITA}`);
    expect(await screen.findByRole('heading', { name: 'Sunita Devi' })).toBeInTheDocument();
    expect(screen.getByText('9876500001')).toBeInTheDocument();
    expect(screen.getByTestId('balance')).toHaveTextContent('₹1,000.00');
    expect(screen.getByTestId('balance')).toHaveClass('text-display');
    expect(screen.getByText('Owes you')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Credit limit used' })).toHaveAttribute(
      'aria-valuenow',
      '20',
    );

    const card = screen
      .getByRole('heading', { name: 'Unpaid bills' })
      .closest('div')?.parentElement;
    if (card == null) throw new Error('The unpaid card is missing');
    const unpaid = card;
    expect(within(unpaid).getByText('Bill ABC/26-27/7')).toBeInTheDocument();
    expect(within(unpaid).getByText('Due 31 Jan 2020')).toBeInTheDocument();
    expect(within(unpaid).getByText(/days late/)).toBeInTheDocument();
    expect(within(unpaid).getByText('₹1,000.00')).toBeInTheDocument();
    expect(within(unpaid).getByText('of ₹1,240.00')).toBeInTheDocument();

    const ledger = within(screen.getByRole('table', { name: 'Ledger' }));
    const lines = ledger.getAllByRole('row').slice(1);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveTextContent('Payment, UPI');
    expect(lines[0]).toHaveTextContent('Reference UTR8841');
    expect(lines[0]).toHaveTextContent('₹240.00');
    expect(lines[0]).toHaveTextContent('₹1,000.00 owed');
    expect(lines[1]).toHaveTextContent('Bill ABC/26-27/7');
    expect(lines[1]).toHaveTextContent('₹1,240.00 owed');
  });

  test('Record payment (Alt+P): amount, mode, Enter saves, then says the new balance', async () => {
    const user = userEvent.setup();
    let saved = false;
    const api = fakeApi(OWNER_SESSION, {
      [route]: () => ({
        body: saved
          ? { ...LEDGER, balancePaise: 90_000, unpaid: [{ entry: BILL, unpaidPaise: 90_000 }] }
          : LEDGER,
      }),
      'POST /api/udhaar/payments': () => {
        saved = true;
        return {
          status: 201,
          body: {
            entry: entry({ id: 'new', kind: 'payment', amountPaise: -10_000 }),
            customerId: SUNITA,
            balancePaise: 90_000,
          },
        };
      },
    });
    renderAt(`/customers/${SUNITA}`);
    await screen.findByRole('heading', { name: 'Sunita Devi' });
    await user.keyboard('{Alt>}p{/Alt}');
    const dialog = await screen.findByRole('dialog', { name: 'Payment from Sunita Devi' });
    const amount = within(dialog).getByRole('textbox', { name: /Amount received/ });
    expect(within(dialog).getByText('Owes ₹1,000.00.')).toBeInTheDocument();
    await user.type(amount, '100{Enter}');
    const sent = api.sent('POST', '/api/udhaar/payments');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toEqual({
      requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      customerId: SUNITA,
      amountPaise: 10_000,
      mode: 'cash',
    });
    expect(await screen.findByText('Payment saved, balance now ₹900.00 owed')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('balance')).toHaveTextContent('₹900.00');
    });
  });

  test('a retry after a lost answer sends the same key; a changed amount a new one', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const api = fakeApi(OWNER_SESSION, {
      [route]: { body: LEDGER },
      'POST /api/udhaar/payments': () => {
        calls += 1;
        return calls === 1
          ? { fail: true }
          : {
              status: 201,
              body: {
                entry: entry({ id: 'new', kind: 'payment', amountPaise: -10_000 }),
                customerId: SUNITA,
                balancePaise: 90_000,
              },
            };
      },
    });
    renderAt(`/customers/${SUNITA}`);
    await user.click(await screen.findByRole('button', { name: /Record payment/ }));
    await user.type(await screen.findByRole('textbox', { name: /Amount received/ }), '100{Enter}');
    expect(await screen.findByText(/The payment may already be saved/)).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await screen.findByText(/Payment saved/);
    const keys = api
      .sent('POST', '/api/udhaar/payments')
      .map((request) => (request.body as { requestKey: string }).requestKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  test('a cheque needs its number, and more than is owed is allowed (it becomes an advance)', async () => {
    const user = userEvent.setup();
    const api = fakeApi(OWNER_SESSION, {
      [route]: { body: LEDGER },
      'POST /api/udhaar/payments': {
        status: 201,
        body: {
          entry: entry({ id: 'new', kind: 'payment', amountPaise: -150_000 }),
          customerId: SUNITA,
          balancePaise: -50_000,
        },
      },
    });
    renderAt(`/customers/${SUNITA}`);
    await user.click(await screen.findByRole('button', { name: /Record payment/ }));
    await user.type(await screen.findByRole('textbox', { name: /Amount received/ }), '1500');
    await user.click(screen.getByRole('button', { name: 'Cheque' }));
    await user.click(screen.getByRole('button', { name: 'Save payment' }));
    expect(screen.getByText('Enter the cheque number')).toBeInTheDocument();
    expect(api.sent('POST', '/api/udhaar/payments')).toHaveLength(0);
    await user.type(screen.getByRole('textbox', { name: 'Cheque number' }), '000123{Enter}');
    expect(
      await screen.findByText('Payment saved, balance now ₹500.00 advance'),
    ).toBeInTheDocument();
    expect(api.sent('POST', '/api/udhaar/payments')[0]?.body).toMatchObject({
      amountPaise: 150_000,
      mode: 'cheque',
      reference: '000123',
    });
  });

  test('"Full balance" fills the amount owed', async () => {
    const user = userEvent.setup();
    fakeApi(OWNER_SESSION, { [route]: { body: LEDGER } });
    renderAt(`/customers/${SUNITA}`);
    await user.click(await screen.findByRole('button', { name: /Record payment/ }));
    await user.click(await screen.findByRole('button', { name: 'Full balance' }));
    expect(screen.getByRole('textbox', { name: /Amount received/ })).toHaveValue('1000');
  });

  test('someone who may only look sees no way to record, reverse or change anything', async () => {
    fakeApi(VIEWER, { [route]: { body: LEDGER } });
    renderAt(`/customers/${SUNITA}`);
    await screen.findByRole('heading', { name: 'Sunita Devi' });
    expect(screen.queryByRole('button', { name: /Record payment/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Opening balance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
    // The terms are still there to read.
    expect(screen.getByText('₹5,000.00')).toBeInTheDocument();
    expect(screen.getByText('30 days')).toBeInTheDocument();
  });

  test('a cashier records payments but cannot reverse one, enter an opening balance or set terms', async () => {
    fakeApi(CASHIER, { [route]: { body: LEDGER } });
    renderAt(`/customers/${SUNITA}`);
    await screen.findByRole('heading', { name: 'Sunita Devi' });
    expect(screen.getByRole('button', { name: /Record payment/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Opening balance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
  });

  test('the owner reverses a payment with a reason and their password', async () => {
    const user = userEvent.setup();
    const api = fakeApi(OWNER_SESSION, {
      [route]: { body: LEDGER },
      [`POST /api/udhaar/payments/${PAYMENT}/reverse`]: {
        status: 201,
        body: {
          entry: entry({ id: 'rev', kind: 'payment_reversal', amountPaise: 24_000 }),
          customerId: SUNITA,
          balancePaise: 124_000,
        },
      },
    });
    renderAt(`/customers/${SUNITA}`);
    // Only the payment has a Reverse button.
    await user.click(await screen.findByRole('button', { name: 'Reverse' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reverse this payment' });
    await user.type(within(dialog).getByRole('textbox', { name: /Why/ }), 'Wrong customer');
    await user.type(within(dialog).getByLabelText("Owner's password"), 'made-up-password');
    await user.click(within(dialog).getByRole('button', { name: 'Reverse payment' }));
    expect(
      await screen.findByText('Payment reversed, balance now ₹1,240.00 owed'),
    ).toBeInTheDocument();
    expect(api.sent('POST', `/api/udhaar/payments/${PAYMENT}/reverse`)[0]?.body).toEqual({
      reason: 'Wrong customer',
      ownerPassword: 'made-up-password',
    });
  });

  test('a reversal needs a reason before the password is even sent', async () => {
    const user = userEvent.setup();
    const api = fakeApi(OWNER_SESSION, { [route]: { body: LEDGER } });
    renderAt(`/customers/${SUNITA}`);
    await user.click(await screen.findByRole('button', { name: 'Reverse' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reverse this payment' });
    await user.type(within(dialog).getByLabelText("Owner's password"), 'made-up-password');
    await user.click(within(dialog).getByRole('button', { name: 'Reverse payment' }));
    expect(await within(dialog).findByText('Fill this in')).toBeInTheDocument();
    expect(api.sent('POST', `/api/udhaar/payments/${PAYMENT}/reverse`)).toHaveLength(0);
  });

  test('a reversed payment is marked, struck through, and has no second Reverse button', async () => {
    fakeApi(OWNER_SESSION, {
      [route]: {
        body: {
          ...LEDGER,
          balancePaise: 124_000,
          entries: [
            entry({
              id: 'rev',
              kind: 'payment_reversal',
              amountPaise: 24_000,
              balanceAfterPaise: 124_000,
              reversesEntryId: PAYMENT,
              reason: 'Wrong customer',
            }),
            PAID,
            BILL,
          ],
        },
      },
    });
    renderAt(`/customers/${SUNITA}`);
    await screen.findByRole('heading', { name: 'Sunita Devi' });
    expect(screen.getByText('Reversed')).toBeInTheDocument();
    expect(screen.getByText('Payment taken back')).toBeInTheDocument();
    expect(screen.getByText('Wrong customer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse' })).not.toBeInTheDocument();
  });

  test('the owner enters the old notebook once; the button goes once there is one', async () => {
    const user = userEvent.setup();
    const api = fakeApi(OWNER_SESSION, {
      [route]: { body: LEDGER },
      'POST /api/udhaar/opening': {
        status: 201,
        body: {
          entry: entry({ id: 'open', kind: 'opening', amountPaise: 250_000, reason: 'Notebook' }),
          customerId: SUNITA,
          balancePaise: 350_000,
        },
      },
    });
    renderAt(`/customers/${SUNITA}`);
    await user.click(await screen.findByRole('button', { name: 'Opening balance' }));
    const dialog = await screen.findByRole('dialog', { name: 'Opening balance' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Amount' }), '2500');
    await user.type(within(dialog).getByRole('textbox', { name: 'Note' }), 'Notebook');
    await user.click(within(dialog).getByRole('button', { name: 'Save opening balance' }));
    expect(
      await screen.findByText('Opening balance saved, balance now ₹3,500.00 owed'),
    ).toBeInTheDocument();
    expect(api.sent('POST', '/api/udhaar/opening')[0]?.body).toMatchObject({
      customerId: SUNITA,
      amountPaise: 250_000,
      reason: 'Notebook',
      asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown,
    });
  });

  test('an opening balance that is an advance goes in as a negative amount, and the form checks its fields', async () => {
    const user = userEvent.setup();
    const api = fakeApi(OWNER_SESSION, {
      [route]: { body: LEDGER },
      'POST /api/udhaar/opening': {
        status: 201,
        body: {
          entry: entry({ id: 'open', kind: 'opening', amountPaise: -50_000, reason: 'Notebook' }),
          customerId: SUNITA,
          balancePaise: 50_000,
        },
      },
    });
    renderAt(`/customers/${SUNITA}`);
    await user.click(await screen.findByRole('button', { name: 'Opening balance' }));
    const dialog = await screen.findByRole('dialog', { name: 'Opening balance' });
    await user.click(within(dialog).getByRole('button', { name: 'Save opening balance' }));
    expect(await within(dialog).findByText(/Enter an amount above zero/)).toBeInTheDocument();
    expect(api.sent('POST', '/api/udhaar/opening')).toHaveLength(0);
    await user.selectOptions(within(dialog).getByRole('combobox'), 'advance');
    await user.type(within(dialog).getByRole('textbox', { name: 'Amount' }), '500');
    await user.type(within(dialog).getByRole('textbox', { name: 'Note' }), 'Notebook');
    await user.click(within(dialog).getByRole('button', { name: 'Save opening balance' }));
    await screen.findByText(/Opening balance saved/);
    expect(api.sent('POST', '/api/udhaar/opening')[0]?.body).toMatchObject({
      amountPaise: -50_000,
    });
  });

  test('there is no Opening balance button when the ledger already has one', async () => {
    fakeApi(OWNER_SESSION, {
      [route]: {
        body: {
          ...LEDGER,
          entries: [
            ...LEDGER.entries,
            entry({
              id: 'open',
              kind: 'opening',
              amountPaise: 250_000,
              reason: 'Notebook',
              dueDate: '2020-01-01',
            }),
          ],
        },
      },
    });
    renderAt(`/customers/${SUNITA}`);
    await screen.findByRole('heading', { name: 'Sunita Devi' });
    expect(screen.queryByRole('button', { name: 'Opening balance' })).not.toBeInTheDocument();
    expect(screen.getByText('Opening balance (old notebook)')).toBeInTheDocument();
  });

  test('the owner changes the credit limit and due days through the customer record', async () => {
    const user = userEvent.setup();
    const api = fakeApi(OWNER_SESSION, {
      [route]: { body: LEDGER },
      [`PUT /api/customers/${SUNITA}`]: { body: { ...customer, version: 5 } },
    });
    renderAt(`/customers/${SUNITA}`);
    await user.click(await screen.findByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog', { name: 'Credit limit and due days' });
    const limit = within(dialog).getByRole('textbox', { name: /Credit limit/ });
    expect(limit).toHaveValue('5000');
    await user.clear(limit);
    await user.type(limit, '7500.50');
    const days = within(dialog).getByRole('textbox', { name: /Due days/ });
    await user.clear(days);
    await user.type(days, '15');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Credit limit and due days saved')).toBeInTheDocument();
    expect(api.sent('PUT', `/api/customers/${SUNITA}`)[0]?.body).toEqual({
      name: 'Sunita Devi',
      phone: '9876500001',
      gstin: null,
      legalName: null,
      address: null,
      pinCode: null,
      stateCode: null,
      creditLimitPaise: 750_050,
      dueDays: 15,
      version: 4,
    });
  });

  test('an empty credit limit means none set, and a bad number is refused before sending', async () => {
    const user = userEvent.setup();
    const api = fakeApi(OWNER_SESSION, {
      [route]: { body: LEDGER },
      [`PUT /api/customers/${SUNITA}`]: { body: customer },
    });
    renderAt(`/customers/${SUNITA}`);
    await user.click(await screen.findByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog', { name: 'Credit limit and due days' });
    const days = within(dialog).getByRole('textbox', { name: /Due days/ });
    await user.clear(days);
    await user.type(days, '400');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Enter 0 to 365 days.')).toBeInTheDocument();
    expect(api.sent('PUT', `/api/customers/${SUNITA}`)).toHaveLength(0);
    await user.clear(days);
    await user.type(days, '30');
    await user.clear(within(dialog).getByRole('textbox', { name: /Credit limit/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByText('Credit limit and due days saved');
    expect(api.sent('PUT', `/api/customers/${SUNITA}`)[0]?.body).toMatchObject({
      creditLimitPaise: null,
      dueDays: 30,
    });
  });

  test('shows an advance as an advance, and says nothing is unpaid', async () => {
    fakeApi(OWNER_SESSION, {
      [route]: {
        body: {
          ...LEDGER,
          balancePaise: -30_000,
          creditLimitPaise: null,
          customer: { ...customer, creditLimitPaise: null },
          unpaid: [],
        },
      },
    });
    renderAt(`/customers/${SUNITA}`);
    await screen.findByRole('heading', { name: 'Sunita Devi' });
    expect(screen.getByText('Paid in advance')).toBeInTheDocument();
    expect(screen.getByTestId('balance')).toHaveTextContent('₹300.00');
    expect(screen.getByText('Nothing is unpaid. This customer has paid in advance.')).toBeVisible();
    expect(screen.getByText('No limit set')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  test('pages the ledger: "Show older entries" asks for the page before the last entry', async () => {
    const user = userEvent.setup();
    const api = fakeApi(OWNER_SESSION, {
      [route]: (_body, url) =>
        url.includes('before=')
          ? {
              body: {
                ...LEDGER,
                entries: [
                  entry({ id: 'old', kind: 'bill', amountPaise: 500, billNumber: 'OLD/1' }),
                ],
                next: null,
              },
            }
          : { body: { ...LEDGER, next: BILL.id } },
    });
    renderAt(`/customers/${SUNITA}`);
    await user.click(await screen.findByRole('button', { name: 'Show older entries' }));
    expect(await screen.findByText('Bill OLD/1')).toBeInTheDocument();
    expect(api.fetchMock).toHaveBeenCalledWith(
      `/api/udhaar/customers/${SUNITA}?before=${BILL.id}`,
      expect.anything(),
    );
    expect(screen.queryByRole('button', { name: 'Show older entries' })).not.toBeInTheDocument();
  });

  test('an unknown customer says it cannot be found', async () => {
    fakeApi(OWNER_SESSION, { [route]: { status: 404, body: { code: 'customer_not_found' } } });
    renderAt(`/customers/${SUNITA}`);
    expect(await screen.findByText('No such customer')).toBeInTheDocument();
  });

  test('speaks Hinglish', async () => {
    await changeLanguage('hi-Latn');
    fakeApi(OWNER_SESSION, { [route]: { body: LEDGER } });
    renderAt(`/customers/${SUNITA}`);
    expect(await screen.findByRole('heading', { name: 'Sunita Devi' })).toBeInTheDocument();
    expect(screen.getByText('Aapka baaki')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bhugtaan darj karein/ })).toBeInTheDocument();
  });
});
