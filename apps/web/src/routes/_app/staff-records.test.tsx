// Staff records on the Staff pages (P2.3 design §6; Module 05 #1, #3, #30, #33; Module 00 #19):
// a person with or without a login, their pay and leave, and their salary history.
import { businessDate, type StaffView } from '@business-software/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { changeLanguage } from '../../i18n';
import { fakeApi, OWNER_SESSION, renderAt } from '../../test/fake-api';
import { BRANCH_ID, CASHIER, HELPER, OWNER_PASSWORD, staffRoutes } from '../../test/fake-staff';

afterEach(() => {
  vi.unstubAllGlobals();
});

const TODAY = businessDate(new Date());
const THIS_MONTH = TODAY.slice(0, 7);
const dialog = (name: string | RegExp) => screen.findByRole('dialog', { name });
const ownerBox = () => screen.getByLabelText("Owner's password");

function ownerWithStaff(people: StaffView[] = [CASHIER, HELPER]) {
  const staff = staffRoutes(people);
  return { ...fakeApi(OWNER_SESSION, staff.routes), ...staff };
}

/** The month as the salary dialog writes it: "November 2026" is "Nov 2026". */
const monthWords = (month: string) =>
  new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00Z`),
  );

// --- The list -----------------------------------------------------------------------------

test('a person without a login shows "No login", their salary, and no password reset', async () => {
  ownerWithStaff();
  renderAt('/staff');
  const helper = await screen.findByRole('row', { name: /Raju Singh/ });
  expect(within(helper).getByText('No login')).toBeInTheDocument();
  expect(within(helper).getByText('₹12,000 a month')).toBeInTheDocument();
  expect(within(helper).queryByRole('button', { name: /^Reset password/ })).toBeNull();
  // Their action row still has Edit and Deactivate.
  expect(within(helper).getByRole('button', { name: 'Deactivate Raju Singh' })).toBeInTheDocument();
  const cashier = screen.getByRole('row', { name: /Meena Devi/ });
  expect(within(cashier).getByText('meena')).toBeInTheDocument();
  expect(within(cashier).getByText('Salary not set')).toBeInTheDocument();
  expect(
    within(cashier).getByRole('button', { name: 'Reset password for Meena Devi' }),
  ).toBeInTheDocument();
});

// --- Adding -------------------------------------------------------------------------------

test('"Can log in" is on by default; switching it off hides the login fields and the access card', async () => {
  ownerWithStaff([]);
  renderAt('/staff/new');
  const user = userEvent.setup();
  const canLogin = await screen.findByRole('checkbox', { name: 'Can log in' });
  expect(canLogin).toBeChecked();
  expect(screen.getByLabelText('Username')).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Access' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add staff login' })).toBeInTheDocument();

  await user.click(canLogin);
  expect(screen.queryByLabelText('Username')).toBeNull();
  expect(screen.queryByLabelText('Password')).toBeNull();
  expect(screen.queryByRole('region', { name: 'Access' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Add staff member' })).toBeInTheDocument();
});

test('a person without a login is added with no password asked, and their record and salary are sent', async () => {
  const api = ownerWithStaff([]);
  const history = renderAt('/staff/new');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('checkbox', { name: 'Can log in' }));
  await user.type(screen.getByLabelText('Name'), 'Geeta Rani');
  await user.type(screen.getByLabelText('Phone'), '98765 43210');
  expect(screen.getByLabelText('Joining date')).toHaveValue(TODAY);
  await user.selectOptions(screen.getByLabelText('Weekly off'), 'Sunday');
  await user.clear(screen.getByLabelText('Paid leaves a month'));
  await user.type(screen.getByLabelText('Paid leaves a month'), '2');
  await user.type(screen.getByLabelText('Overtime pay per hour (₹)'), '80');
  await user.selectOptions(screen.getByLabelText('Salary type'), 'Daily wage');
  await user.type(screen.getByLabelText('Salary (₹)'), '500');
  await user.click(screen.getByRole('button', { name: 'Add staff member' }));

  // No owner's password: nothing here gives anyone access.
  await waitFor(() => {
    expect(history.location.pathname).toBe('/staff');
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(api.sent('POST', '/api/staff')[0]?.body).toEqual({
    name: 'Geeta Rani',
    homeBranchId: BRANCH_ID,
    phone: '9876543210',
    joiningDate: TODAY,
    weeklyOffDay: 0,
    paidLeavesPerMonth: 2,
    overtimeRatePaise: 8000,
    salary: { kind: 'daily', amountPaise: 50_000 },
  });
  const added = await screen.findByRole('row', { name: /Geeta Rani/ });
  expect(within(added).getByText('No login')).toBeInTheDocument();
});

test('only a name, a branch and a joining date are needed (#33): no salary, no phone', async () => {
  const api = ownerWithStaff([]);
  renderAt('/staff/new');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('checkbox', { name: 'Can log in' }));
  await user.type(screen.getByLabelText('Name'), 'Geeta Rani');
  await user.click(screen.getByRole('button', { name: 'Add staff member' }));
  await waitFor(() => {
    expect(api.sent('POST', '/api/staff')).toHaveLength(1);
  });
  const body = api.sent('POST', '/api/staff')[0]?.body as Record<string, unknown>;
  expect(body).toMatchObject({ phone: null, weeklyOffDay: null, overtimeRatePaise: null });
  expect(body).not.toHaveProperty('salary');
});

test.each([
  ['Phone', '98765', 'Enter a 10-digit phone number'],
  ['Paid leaves a month', '40', 'Enter 0 to 31'],
  ['Overtime pay per hour (₹)', 'lots', 'Enter an amount like 80'],
  ['Salary (₹)', '0', 'Enter more than ₹0'],
])('a bad %s shows under its box and nothing is sent', async (label, typed, words) => {
  const api = ownerWithStaff([]);
  renderAt('/staff/new');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('checkbox', { name: 'Can log in' }));
  await user.type(screen.getByLabelText('Name'), 'Geeta Rani');
  await user.clear(screen.getByLabelText(label));
  await user.type(screen.getByLabelText(label), typed);
  await user.click(screen.getByRole('button', { name: 'Add staff member' }));
  await waitFor(() => {
    expect(screen.getByLabelText(label)).toHaveAccessibleDescription(
      expect.stringContaining(words),
    );
  });
  expect(api.sent('POST', '/api/staff')).toHaveLength(0);
});

test('a login still needs its owner password, and the record fields go with it', async () => {
  const api = ownerWithStaff([]);
  renderAt('/staff/new');
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Name'), 'Ravi Kumar');
  await user.type(screen.getByLabelText('Username'), 'ravi.k');
  await user.type(screen.getByLabelText('Password'), 'a brand new password');
  await user.type(screen.getByLabelText('Salary (₹)'), '15000');
  await user.click(screen.getByRole('button', { name: 'Add staff login' }));
  await dialog('Add this login');
  await user.type(ownerBox(), `${OWNER_PASSWORD}{Enter}`);
  await waitFor(() => {
    expect(api.sent('POST', '/api/staff')).toHaveLength(1);
  });
  expect(api.sent('POST', '/api/staff')[0]?.body).toMatchObject({
    username: 'ravi.k',
    ownerPassword: OWNER_PASSWORD,
    joiningDate: TODAY,
    salary: { kind: 'monthly', amountPaise: 1_500_000 },
  });
});

// --- Editing a record ---------------------------------------------------------------------

test('a person without a login has no username, access or password reset on their page', async () => {
  ownerWithStaff();
  renderAt(`/staff/${HELPER.id}`);
  const person = within(await screen.findByRole('region', { name: 'Person' }));
  expect(person.getByLabelText('Name')).toHaveValue('Raju Singh');
  expect(person.getByLabelText('Phone')).toHaveValue('9876543210');
  expect(person.getByLabelText('Joining date')).toHaveValue('2026-03-01');
  expect(person.getByLabelText('Weekly off')).toHaveDisplayValue('Sunday');
  expect(person.getByLabelText('Paid leaves a month')).toHaveValue('2');
  expect(person.getByLabelText('Overtime pay per hour (₹)')).toHaveValue('80');
  expect(person.queryByLabelText('Username')).toBeNull();
  expect(screen.queryByRole('region', { name: 'Access' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Reset password' })).toBeNull();
  expect(screen.getAllByText('No login').length).toBeGreaterThan(0);
});

test("saving a record sends its fields with the person's version, and no username without a login", async () => {
  const api = ownerWithStaff();
  renderAt(`/staff/${HELPER.id}`);
  const user = userEvent.setup();
  const person = within(await screen.findByRole('region', { name: 'Person' }));
  await user.selectOptions(person.getByLabelText('Weekly off'), 'None');
  await user.clear(person.getByLabelText('Overtime pay per hour (₹)'));
  await user.click(person.getByRole('button', { name: 'Save' }));
  expect(await person.findByRole('status')).toHaveTextContent('Saved');
  expect(api.sent('PUT', `/api/staff/${HELPER.id}`)[0]?.body).toEqual({
    name: 'Raju Singh',
    homeBranchId: BRANCH_ID,
    phone: '9876543210',
    joiningDate: '2026-03-01',
    weeklyOffDay: null,
    paidLeavesPerMonth: 2,
    overtimeRatePaise: null,
    version: 1,
  });
});

test('a joining date after marked attendance says so, under the date', async () => {
  const staff = staffRoutes([HELPER]);
  fakeApi(OWNER_SESSION, {
    ...staff.routes,
    [`PUT /api/staff/${HELPER.id}`]: { status: 409, body: { code: 'marks_before_joining' } },
  });
  renderAt(`/staff/${HELPER.id}`);
  const person = within(await screen.findByRole('region', { name: 'Person' }));
  await userEvent.click(person.getByRole('button', { name: 'Save' }));
  expect(
    await screen.findByText(
      'Attendance is already marked before this joining date. Choose an earlier date.',
    ),
  ).toBeInTheDocument();
});

test('a change made by somebody else asks to reload', async () => {
  const staff = staffRoutes([HELPER]);
  fakeApi(OWNER_SESSION, {
    ...staff.routes,
    [`PUT /api/staff/${HELPER.id}`]: { status: 409, body: { code: 'stale' } },
  });
  renderAt(`/staff/${HELPER.id}`);
  await userEvent.click(
    within(await screen.findByRole('region', { name: 'Person' })).getByRole('button', {
      name: 'Save',
    }),
  );
  expect(
    await screen.findByText('Someone else changed this person. Reload the page and try again.'),
  ).toBeInTheDocument();
});

// --- Giving a login -----------------------------------------------------------------------

test('a person without a login can be given one: one record, with the owner password', async () => {
  const api = ownerWithStaff();
  renderAt(`/staff/${HELPER.id}`);
  const user = userEvent.setup();
  const card = within(await screen.findByRole('region', { name: 'Login' }));
  await user.click(card.getByRole('button', { name: 'Give a login' }));
  const box = await dialog('Give Raju Singh a login');
  await user.type(within(box).getByLabelText('Username'), 'Raju.S');
  await user.type(within(box).getByLabelText('Password'), 'a brand new password');
  await user.type(ownerBox(), `${OWNER_PASSWORD}{Enter}`);
  expect(
    await screen.findByText('Raju Singh can now log in as raju.s. Choose what they can do below.'),
  ).toBeInTheDocument();
  expect(api.sent('POST', `/api/staff/${HELPER.id}/login`)[0]?.body).toEqual({
    username: 'Raju.S',
    password: 'a brand new password',
    ownerPassword: OWNER_PASSWORD,
  });
  // The page now has what a login has: the access switches, and no "Give a login".
  expect(await screen.findByRole('region', { name: 'Access' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Give a login' })).toBeNull();
});

test('a taken username shows under the username in the dialog', async () => {
  ownerWithStaff();
  renderAt(`/staff/${HELPER.id}`);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Give a login' }));
  const box = await dialog('Give Raju Singh a login');
  await user.type(within(box).getByLabelText('Username'), 'taken');
  await user.type(within(box).getByLabelText('Password'), 'a brand new password');
  await user.type(ownerBox(), `${OWNER_PASSWORD}{Enter}`);
  expect(
    await within(box).findByText('This username is taken. Choose another'),
  ).toBeInTheDocument();
});

test('a person who already has a login is not offered one', async () => {
  ownerWithStaff();
  renderAt(`/staff/${CASHIER.id}`);
  await screen.findByRole('region', { name: 'Person' });
  expect(screen.queryByRole('region', { name: 'Login' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Give a login' })).toBeNull();
});

// --- Salary -------------------------------------------------------------------------------

test('the salary card shows the history with the rate in force marked, and "Salary not set" before any', async () => {
  const staff = staffRoutes([CASHIER, HELPER]);
  staff.state.rates[HELPER.id] = [
    {
      id: '00000000-0000-4000-8000-0000000000d9',
      fromMonth: `${THIS_MONTH}-01`,
      kind: 'monthly',
      amountPaise: 1_400_000,
      createdAt: '2026-11-19T10:00:00.000Z',
    },
    {
      id: '00000000-0000-4000-8000-0000000000d8',
      fromMonth: '2026-04-01',
      kind: 'monthly',
      amountPaise: 1_200_000,
      createdAt: '2026-04-01T10:00:00.000Z',
    },
  ];
  fakeApi(OWNER_SESSION, staff.routes);
  renderAt(`/staff/${HELPER.id}`);
  const card = within(await screen.findByRole('region', { name: 'Salary' }));
  const [current, earlier] = (await card.findAllByRole('listitem')) as [HTMLElement, HTMLElement];
  expect(current).toHaveTextContent(`₹14,000 a month from ${monthWords(THIS_MONTH)}`);
  expect(within(current).getByText('Now')).toBeInTheDocument();
  expect(earlier).toHaveTextContent('₹12,000 a month from Apr 2026');
  expect(within(earlier).queryByText('Now')).toBeNull();
  expect(card.getByRole('button', { name: 'Change salary' })).toBeInTheDocument();
});

test('with no salary yet the card says so and offers "Set salary"', async () => {
  ownerWithStaff();
  renderAt(`/staff/${CASHIER.id}`);
  const card = within(await screen.findByRole('region', { name: 'Salary' }));
  expect(await card.findByText('No salary set yet.')).toBeInTheDocument();
  expect(card.getByRole('button', { name: 'Set salary' })).toBeInTheDocument();
});

test('a salary can start this month or a later one, never an earlier one (#30)', async () => {
  ownerWithStaff();
  renderAt(`/staff/${HELPER.id}`);
  await userEvent.click(await screen.findByRole('button', { name: 'Change salary' }));
  const box = await dialog('Salary for Raju Singh');
  const options = within(within(box).getByLabelText('Starts from the 1st of')).getAllByRole(
    'option',
  );
  expect(options[0]).toHaveTextContent(`${monthWords(THIS_MONTH)} (this month)`);
  expect(options[0]).toHaveValue(THIS_MONTH);
  expect(options.length).toBe(12);
  expect(options.map((option) => (option as HTMLOptionElement).value)).toEqual(
    [...options.map((option) => (option as HTMLOptionElement).value)].sort(),
  );
});

test('a new salary is saved from the 1st of the chosen month and joins the history', async () => {
  const api = ownerWithStaff();
  renderAt(`/staff/${HELPER.id}`);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Change salary' }));
  const box = await dialog('Salary for Raju Singh');
  const month = within(box).getByLabelText<HTMLSelectElement>('Starts from the 1st of');
  const later = month.options.item(1)?.value ?? '';
  await user.selectOptions(month, later);
  await user.selectOptions(within(box).getByLabelText('Salary type'), 'Daily wage');
  await user.type(within(box).getByLabelText('Amount (₹)'), '550.50');
  await user.click(within(box).getByRole('button', { name: 'Save salary' }));
  expect(await screen.findByText(`Salary from ${monthWords(later)} saved.`)).toBeInTheDocument();
  expect(api.sent('POST', `/api/staff/${HELPER.id}/salary-rates`)[0]?.body).toEqual({
    fromMonth: later,
    kind: 'daily',
    amountPaise: 55_050,
  });
  const card = within(screen.getByRole('region', { name: 'Salary' }));
  expect(await card.findByText(`₹550.50 a day from ${monthWords(later)}`)).toBeInTheDocument();
});

test('a salary amount that is not above zero is refused before anything is sent', async () => {
  const api = ownerWithStaff();
  renderAt(`/staff/${HELPER.id}`);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Change salary' }));
  const box = await dialog('Salary for Raju Singh');
  await user.type(within(box).getByLabelText('Amount (₹)'), '0');
  await user.click(within(box).getByRole('button', { name: 'Save salary' }));
  expect(await within(box).findByText('Enter more than ₹0')).toBeInTheDocument();
  expect(api.sent('POST', `/api/staff/${HELPER.id}/salary-rates`)).toHaveLength(0);
});

// --- Languages ----------------------------------------------------------------------------

test('the staff form speaks Hindi and Hinglish', async () => {
  ownerWithStaff([]);
  await changeLanguage('hi');
  renderAt('/staff/new');
  expect(await screen.findByRole('checkbox', { name: 'लॉग इन कर सकते हैं' })).toBeInTheDocument();
  await changeLanguage('hi-Latn');
  expect(await screen.findByRole('checkbox', { name: 'Login kar sakte hain' })).toBeInTheDocument();
  await changeLanguage('en');
});
