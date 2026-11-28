import type { BillingContext, CustomerView } from '@business-software/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { changeLanguage } from '../i18n';
import { createQueryClient } from '../query-client';
import { fakeApi, OWNER_SESSION, type FakeAnswer } from '../test/fake-api';
import { CustomerBox, CustomerSummary, type BillCustomer } from './customer-box';

afterEach(() => {
  vi.unstubAllGlobals();
});

const CONTEXT: BillingContext = {
  scheme: 'regular',
  branchStateCode: '27',
  features: [],
  negativeStock: 'warn',
  overCreditLimit: 'warn',
  canViewStock: true,
  canManageItems: true,
  canViewCustomers: true,
  canManageCustomers: true,
  canDiscount: true,
  canGiveUdhaar: true,
};

// Made-up customers, phones and GSTINs.
const MEENA: CustomerView = {
  id: '00000000-0000-4000-8000-0000000000c1',
  name: 'Meena Stores',
  phone: '9876500001',
  gstin: null,
  legalName: null,
  address: null,
  pinCode: null,
  stateCode: null,
  creditLimitPaise: null,
  dueDays: 30,
  version: 1,
};
const MEENA_BILL: BillCustomer = {
  id: MEENA.id,
  name: 'Meena Stores',
  phone: '9876500001',
  gstin: null,
  stateCode: null,
};
const SHARMA: CustomerView = {
  ...MEENA,
  id: '00000000-0000-4000-8000-0000000000c2',
  name: 'Sharma Traders',
  phone: '9876500002',
};
const SHARMA_BILL: BillCustomer = {
  id: SHARMA.id,
  name: 'Sharma Traders',
  phone: '9876500002',
  gstin: null,
  stateCode: null,
};
const SHARMAJI: CustomerView = {
  ...MEENA,
  id: '00000000-0000-4000-8000-0000000000c3',
  name: 'Sharmaji Kirana',
  phone: '9876500003',
};
// A Bengaluru business (state 29) and a Pune one (state 27, the shop's own).
const KARNATAKA: CustomerView = {
  ...MEENA,
  id: '00000000-0000-4000-8000-0000000000c4',
  name: 'Kaveri Agencies',
  phone: null,
  gstin: '29ABCDE1234F1ZW',
  legalName: 'Kaveri Agencies Pvt Ltd',
  address: '12 Brigade Road, Bengaluru',
  stateCode: '29',
};
const KARNATAKA_BILL: BillCustomer = {
  id: KARNATAKA.id,
  name: 'Kaveri Agencies',
  phone: null,
  gstin: '29ABCDE1234F1ZW',
  stateCode: '29',
};

function setup(
  props: {
    context?: Partial<BillingContext>;
    customer?: BillCustomer | null;
    placeOfSupplyStateCode?: string;
  } = {},
  routes: Record<string, FakeAnswer | ((body: unknown) => FakeAnswer)> = {},
) {
  // Every customer on a bill has an account to read: nothing owed, no limit, unless a test says.
  const nothingOwed = Object.fromEntries(
    [MEENA, SHARMAJI, KARNATAKA].map((who) => [
      `GET /api/udhaar/customers/${who.id}`,
      { body: { customerId: who.id, balancePaise: 0, creditLimitPaise: null, dueDays: 30 } },
    ]),
  );
  const api = fakeApi(OWNER_SESSION, { ...nothingOwed, ...routes });
  const onChange = vi.fn<(customer: BillCustomer | null, placeOfSupply: string) => void>();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <CustomerBox
        open
        context={{ ...CONTEXT, ...props.context }}
        customer={props.customer ?? null}
        placeOfSupplyStateCode={props.placeOfSupplyStateCode ?? '27'}
        onChange={onChange}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { api, onChange, onClose };
}

const LISTBOX = { name: 'Matching customers' };
// The results only: the state select has options too.
const results = () => within(screen.getByRole('listbox', LISTBOX)).getAllByRole('option');
const findResults = async () =>
  within(await screen.findByRole('listbox', LISTBOX)).findAllByRole('option');
const findResult = async (options?: { name: RegExp }) =>
  within(await screen.findByRole('listbox', LISTBOX)).findByRole('option', options);
const entry = () => screen.getByRole('combobox', { name: 'Phone number or name' });

describe('finding a customer', () => {
  test('ten digits look the customer up by phone; Enter picks them and closes the box', async () => {
    const user = userEvent.setup();
    const { api, onChange, onClose } = setup(
      {},
      { 'GET /api/customers?phone=9876500001': { body: [MEENA] } },
    );
    expect(entry()).toHaveFocus();
    await user.type(entry(), '9876500001');
    const option = await findResult({ name: /Meena Stores/ });
    expect(option).toHaveTextContent('9876500001');
    expect(api.sent('GET', '/api/customers?phone=9876500001')).toHaveLength(1);
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledExactlyOnceWith(MEENA_BILL, '27');
    expect(onClose).toHaveBeenCalled();
  });

  test('a phone typed with a +91 and spaces is looked up as its 10 digits', async () => {
    const user = userEvent.setup();
    const { api } = setup({}, { 'GET /api/customers?phone=9876500001': { body: [MEENA] } });
    await user.type(entry(), '+91 98765 00001');
    await findResult({ name: /Meena Stores/ });
    expect(api.sent('GET', '/api/customers?phone=9876500001')).toHaveLength(1);
  });

  test('other text searches by name after a short pause; the arrows move, Enter picks', async () => {
    const user = userEvent.setup();
    const { api, onChange } = setup(
      {},
      { 'GET /api/customers?q=sharma': { body: [SHARMA, SHARMAJI] } },
    );
    await user.type(entry(), 'sharma');
    const options = await findResults();
    expect(options).toHaveLength(2);
    // Typed in one burst, so one search, not six.
    expect(api.sent('GET', '/api/customers?q=sharma')).toHaveLength(1);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}');
    expect(results()[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowUp}{Enter}');
    expect(onChange).toHaveBeenCalledWith(SHARMA_BILL, '27');
  });

  test('clicking a result picks it', async () => {
    const user = userEvent.setup();
    const { onChange } = setup({}, { 'GET /api/customers?q=sharma': { body: [SHARMA, SHARMAJI] } });
    await user.type(entry(), 'sharma');
    await user.click(await findResult({ name: /Sharmaji Kirana/ }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: SHARMAJI.id }), '27');
  });

  test('a business customer from another state is picked with IGST: their state is the place of supply', async () => {
    const user = userEvent.setup();
    const { onChange } = setup({}, { 'GET /api/customers?q=kaveri': { body: [KARNATAKA] } });
    await user.type(entry(), 'kaveri');
    await findResult({ name: /Kaveri Agencies/ });
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith(KARNATAKA_BILL, '29');
  });

  test('a business customer from the shop’s own state keeps CGST + SGST', async () => {
    const user = userEvent.setup();
    const pune = { ...KARNATAKA, gstin: '27ABCDE1234F1Z0', stateCode: '27' };
    const { onChange } = setup({}, { 'GET /api/customers?q=kaveri': { body: [pune] } });
    await user.type(entry(), 'kaveri');
    await findResult();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ stateCode: '27' }), '27');
  });

  test('without customers.view the box only says so: walk-in only', () => {
    const { api } = setup({ context: { canViewCustomers: false } });
    expect(screen.getByText(/You can’t look customers up/)).toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: 'Phone number or name' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add customer' })).not.toBeInTheDocument();
    expect(api.fetchMock).not.toHaveBeenCalled();
  });
});

describe('adding a customer', () => {
  test('no match offers the form with the typed phone filled in; saving picks the new customer', async () => {
    const user = userEvent.setup();
    const created: CustomerView = {
      ...MEENA,
      id: '00000000-0000-4000-8000-0000000000c5',
      name: 'Lata Gupta',
      phone: '9876500004',
    };
    const { api, onChange, onClose } = setup(
      {},
      {
        'GET /api/customers?phone=9876500004': { body: [] },
        'POST /api/customers': { status: 201, body: created },
      },
    );
    await user.type(entry(), '9876500004');
    expect(await screen.findByText('No customer found.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add customer' }));

    const form = screen.getByRole('group', { name: 'New customer' });
    expect(within(form).getByLabelText('Phone')).toHaveValue('9876500004');
    expect(within(form).getByLabelText('Name')).toHaveFocus();
    expect(within(form).queryByLabelText('GSTIN')).not.toBeInTheDocument();
    await user.type(within(form).getByLabelText('Name'), 'Lata Gupta');
    await user.click(screen.getByRole('button', { name: 'Save customer' }));

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    expect(api.sent('POST', '/api/customers')[0]?.body).toEqual({
      name: 'Lata Gupta',
      phone: '9876500004',
      gstin: null,
      legalName: null,
      address: null,
      pinCode: null,
      stateCode: null,
    });
    expect(onChange).toHaveBeenCalledWith(
      { id: created.id, name: 'Lata Gupta', phone: '9876500004', gstin: null, stateCode: null },
      '27',
    );
    expect(onClose).toHaveBeenCalled();
  });

  test('a business customer needs a GSTIN, legal name and address; the state comes from the GSTIN (IGST)', async () => {
    const user = userEvent.setup();
    const { api, onChange } = setup(
      {},
      {
        'GET /api/customers?q=kaveri': { body: [] },
        'POST /api/customers': { status: 201, body: KARNATAKA },
      },
    );
    await user.type(entry(), 'kaveri');
    await user.click(await screen.findByRole('button', { name: 'Add customer' }));
    // The typed text that isn't a phone becomes the name.
    expect(screen.getByLabelText('Name')).toHaveValue('kaveri');
    await user.click(screen.getByRole('checkbox', { name: 'Business customer' }));
    await user.click(screen.getByRole('button', { name: 'Save customer' }));
    expect(screen.getAllByText('Fill this in')).toHaveLength(3);
    expect(api.sent('POST', '/api/customers')).toHaveLength(0);

    await user.type(screen.getByLabelText('GSTIN'), '29abcde1234f1zw');
    await user.type(screen.getByLabelText('Legal name'), 'Kaveri Agencies Pvt Ltd');
    await user.type(screen.getByLabelText('Address'), '12 Brigade Road, Bengaluru');
    await user.click(screen.getByRole('button', { name: 'Save customer' }));

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    expect(api.sent('POST', '/api/customers')[0]?.body).toMatchObject({
      name: 'kaveri',
      gstin: '29ABCDE1234F1ZW',
      legalName: 'Kaveri Agencies Pvt Ltd',
      stateCode: '29',
    });
    expect(onChange).toHaveBeenCalledWith(KARNATAKA_BILL, '29');
  });

  test('a GSTIN that fails the check is refused on the spot, with nothing sent', async () => {
    const user = userEvent.setup();
    const { api, onChange } = setup({}, { 'GET /api/customers?q=kaveri': { body: [] } });
    await user.type(entry(), 'kaveri');
    await user.click(await screen.findByRole('button', { name: 'Add customer' }));
    await user.click(screen.getByRole('checkbox', { name: 'Business customer' }));
    // The right GSTIN ends in W; Z is the wrong check digit.
    await user.type(screen.getByLabelText('GSTIN'), '29ABCDE1234F1ZZ');
    await user.type(screen.getByLabelText('Legal name'), 'Kaveri Agencies Pvt Ltd');
    await user.type(screen.getByLabelText('Address'), '12 Brigade Road');
    await user.click(screen.getByRole('button', { name: 'Save customer' }));
    expect(screen.getByText(/Check the GSTIN/)).toBeInTheDocument();
    expect(screen.getByLabelText('GSTIN')).toHaveAttribute('aria-invalid', 'true');
    expect(api.sent('POST', '/api/customers')).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  test('phone_taken from the server shows under the phone field', async () => {
    const user = userEvent.setup();
    const { onChange } = setup(
      {},
      {
        'GET /api/customers?phone=9876500001': { body: [] },
        'POST /api/customers': { status: 409, body: { code: 'phone_taken' } },
      },
    );
    await user.type(entry(), '9876500001');
    await user.click(await screen.findByRole('button', { name: 'Add customer' }));
    await user.type(screen.getByLabelText('Name'), 'Meena');
    await user.click(screen.getByRole('button', { name: 'Save customer' }));
    expect(await screen.findByText(/phone number already exists/)).toBeInTheDocument();
    expect(screen.getByLabelText('Phone')).toHaveAttribute('aria-invalid', 'true');
    expect(onChange).not.toHaveBeenCalled();
  });

  test('gstin_taken and the API’s own field errors show under their fields', async () => {
    const user = userEvent.setup();
    let answer: FakeAnswer = { status: 409, body: { code: 'gstin_taken' } };
    setup(
      {},
      {
        'GET /api/customers?q=kaveri': { body: [] },
        'POST /api/customers': () => answer,
      },
    );
    await user.type(entry(), 'kaveri');
    await user.click(await screen.findByRole('button', { name: 'Add customer' }));
    await user.click(screen.getByRole('checkbox', { name: 'Business customer' }));
    await user.type(screen.getByLabelText('GSTIN'), '29ABCDE1234F1ZW');
    await user.type(screen.getByLabelText('Legal name'), 'Kaveri Agencies');
    await user.type(screen.getByLabelText('Address'), '12 Brigade Road');
    await user.click(screen.getByRole('button', { name: 'Save customer' }));
    expect(await screen.findByText(/customer with this GSTIN already exists/)).toBeInTheDocument();

    answer = { status: 400, body: { code: 'invalid_body', fields: { address: 'too_long' } } };
    await user.click(screen.getByRole('button', { name: 'Save customer' }));
    expect(await screen.findByText('This is too long')).toBeInTheDocument();
  });

  test('without customers.manage there is no way to add', async () => {
    const user = userEvent.setup();
    setup(
      { context: { canManageCustomers: false } },
      { 'GET /api/customers?q=kaveri': { body: [] } },
    );
    await user.type(entry(), 'kaveri');
    expect(await screen.findByText('No customer found.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add customer' })).not.toBeInTheDocument();
  });

  test('the words are in Hindi and Hinglish too', async () => {
    await changeLanguage('hi');
    const user = userEvent.setup();
    setup({}, { 'GET /api/customers?q=kaveri': { body: [] } });
    await user.type(screen.getByRole('combobox', { name: 'फ़ोन नंबर या नाम' }), 'kaveri');
    expect(await screen.findByText('कोई ग्राहक नहीं मिला।')).toBeInTheDocument();
  });
});

describe('place of supply', () => {
  test('a business customer from another state: IGST, and “Delivered at the counter” switches it back', async () => {
    const user = userEvent.setup();
    const { onChange } = setup({ customer: KARNATAKA_BILL, placeOfSupplyStateCode: '29' });
    const counter = screen.getByRole('switch', { name: 'Delivered at the counter' });
    expect(counter).not.toBeChecked();
    expect(screen.getByText('IGST, supplied to Karnataka')).toBeInTheDocument();
    await user.click(counter);
    expect(onChange).toHaveBeenCalledWith(KARNATAKA_BILL, '27');
  });

  test('with the switch on (place of supply = the shop’s state), turning it off goes to their state', async () => {
    const user = userEvent.setup();
    const { onChange } = setup({ customer: KARNATAKA_BILL, placeOfSupplyStateCode: '27' });
    const counter = screen.getByRole('switch', { name: 'Delivered at the counter' });
    expect(counter).toBeChecked();
    expect(screen.getByText('CGST + SGST')).toBeInTheDocument();
    await user.click(counter);
    expect(onChange).toHaveBeenCalledWith(KARNATAKA_BILL, '29');
  });

  test('a bill without a business customer can be sent to another state', async () => {
    const user = userEvent.setup();
    const { onChange } = setup({ customer: MEENA_BILL });
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    const sentTo = screen.getByRole('combobox', { name: 'Sent to' });
    expect(sentTo).toHaveValue('27');
    await user.selectOptions(sentTo, 'Karnataka');
    expect(onChange).toHaveBeenCalledWith(MEENA_BILL, '29');
  });

  test('Walk-in clears the customer and puts the place of supply back to the shop’s state', async () => {
    const user = userEvent.setup();
    const { onChange, onClose } = setup({
      customer: KARNATAKA_BILL,
      placeOfSupplyStateCode: '29',
    });
    await user.click(screen.getByRole('button', { name: 'Walk-in' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null, '27');
    expect(onClose).toHaveBeenCalled();
  });

  test('Esc closes the box and changes nothing', async () => {
    const user = userEvent.setup();
    const { onChange, onClose } = setup(
      { customer: KARNATAKA_BILL, placeOfSupplyStateCode: '29' },
      { 'GET /api/customers?phone=9876500001': { body: [MEENA] } },
    );
    await user.type(entry(), '9876500001');
    await findResult();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('the footer summary', () => {
  test('walk-in at the shop’s state', () => {
    render(<CustomerSummary customer={null} placeOfSupplyStateCode="27" branchStateCode="27" />);
    expect(screen.getByText('Customer')).toBeInTheDocument();
    expect(screen.getByText('F3')).toBeInTheDocument();
    expect(screen.getByText('walk-in')).toBeInTheDocument();
    expect(screen.getByText('CGST + SGST')).toBeInTheDocument();
  });

  test('a customer’s name and phone, and IGST with the state when it is another state', () => {
    render(
      <CustomerSummary
        customer={{ ...KARNATAKA_BILL, phone: '9876500009' }}
        placeOfSupplyStateCode="29"
        branchStateCode="27"
      />,
    );
    expect(screen.getByText(/Kaveri Agencies/)).toBeInTheDocument();
    expect(screen.getByText(/9876500009/)).toBeInTheDocument();
    expect(screen.getByText('IGST, supplied to Karnataka')).toBeInTheDocument();
  });
});

describe('what the customer owes', () => {
  const standingRoute = (balancePaise: number, creditLimitPaise: number | null) => ({
    [`GET /api/udhaar/customers/${KARNATAKA.id}`]: {
      body: { customerId: KARNATAKA.id, balancePaise, creditLimitPaise, dueDays: 30 },
    },
  });

  test('shows the balance and the credit limit of the customer on the bill', async () => {
    setup({ customer: KARNATAKA_BILL }, standingRoute(124_000, 500_000));
    expect(await screen.findByText('Owes ₹1,240.00')).toBeInTheDocument();
    expect(screen.getByText('Credit limit ₹5,000.00')).toBeInTheDocument();
  });

  test('shows an advance, and "no credit limit set" when there is none', async () => {
    setup({ customer: KARNATAKA_BILL }, standingRoute(-30_000, null));
    expect(await screen.findByText('Advance ₹300.00')).toBeInTheDocument();
    expect(screen.getByText('No credit limit set')).toBeInTheDocument();
  });

  test('asks nothing when this login cannot see customers', async () => {
    const { api } = setup(
      { customer: KARNATAKA_BILL, context: { canViewCustomers: false } },
      standingRoute(124_000, null),
    );
    await screen.findByText('On this bill');
    expect(api.sent('GET', `/api/udhaar/customers/${KARNATAKA.id}`)).toHaveLength(0);
  });
});
