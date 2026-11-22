import type { ActiveSession, StaffView } from '@business-software/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { changeLanguage } from '../../i18n';
import { fakeApi, OWNER_SESSION, renderAt, STAFF_SESSION } from '../../test/fake-api';
import {
  BRANCH_ID,
  CASHIER,
  FORMER,
  OWNER_PASSWORD,
  SECOND_BRANCH_ID,
  staffRoutes,
} from '../../test/fake-staff';

afterEach(() => {
  vi.unstubAllGlobals();
});

const nav = () => screen.getByRole('navigation', { name: 'Main' });
const ownerBox = () => screen.getByLabelText("Owner's password");
/** Waits for the error under a field: its description holds the words. */
const expectDescribed = (label: string, words: string | RegExp) =>
  waitFor(() => {
    const described = screen.getByLabelText(label);
    if (typeof words === 'string') {
      expect(described.getAttribute('aria-describedby')).not.toBeNull();
      expect(described).toHaveAccessibleDescription(expect.stringContaining(words));
    } else {
      expect(described).toHaveAccessibleDescription(words);
    }
  });

const dialog = (name: string | RegExp) => screen.findByRole('dialog', { name });

/** The session of a login that holds `permissions` beyond `session.own`. */
const staffWith = (...permissions: ActiveSession['permissions']): ActiveSession => ({
  ...STAFF_SESSION,
  permissions: ['session.own', ...permissions],
});

// --- Sidebar and routes by permission ---------------------------------------------------

test('a cashier sees Billing and Items but no Staff or Settings', async () => {
  fakeApi(STAFF_SESSION);
  renderAt('/');
  await screen.findByRole('heading', { level: 1, name: 'Home' });
  expect(within(nav()).getByRole('link', { name: /Billing/ })).toBeInTheDocument();
  expect(within(nav()).getByRole('link', { name: /Items/ })).toBeInTheDocument();
  expect(within(nav()).queryByRole('link', { name: 'Staff' })).toBeNull();
  expect(within(nav()).queryByRole('link', { name: 'Settings' })).toBeNull();
});

test.each(['/staff', '/staff/new', '/settings'])(
  'opening %s by address says "You can\'t open this page", with a way home',
  async (path) => {
    const api = fakeApi(STAFF_SESSION);
    const history = renderAt(path);
    expect(await screen.findByText("You can't open this page")).toBeInTheDocument();
    // The page itself never loaded, so it asked the server for nothing.
    const asked = api.fetchMock.mock.calls
      .map(([url]) => url)
      .filter((url) => !url.includes('/health'));
    expect(asked).toEqual(['/api/session']);
    await userEvent.click(screen.getByRole('link', { name: 'Go to home' }));
    expect(history.location.pathname).toBe('/');
  },
);

test('a login without items.view has no Items entry and cannot open /items', async () => {
  fakeApi(staffWith('billing.sell'));
  renderAt('/items');
  expect(await screen.findByText("You can't open this page")).toBeInTheDocument();
  expect(within(nav()).queryByRole('link', { name: /Items/ })).toBeNull();
  expect(within(nav()).getByRole('link', { name: /Billing/ })).toBeInTheDocument();
});

test('the owner sees Staff and Settings in the sidebar', async () => {
  fakeApi(OWNER_SESSION);
  renderAt('/');
  await screen.findByRole('heading', { level: 1, name: 'Home' });
  expect(within(nav()).getByRole('link', { name: 'Staff' })).toHaveAttribute('href', '/staff');
  expect(within(nav()).getByRole('link', { name: 'Settings' })).toBeInTheDocument();
});

// --- Refetch rules (design §5) -------------------------------------------------------------

test('a 403 forbidden re-reads the session and hides what the owner took away', async () => {
  let session: ActiveSession = STAFF_SESSION;
  const api = fakeApi(STAFF_SESSION, {
    'GET /api/session': () => ({ body: session }),
    // The owner took items.view away after the page was drawn.
    'GET /api/items/context': () => {
      session = staffWith('billing.sell');
      return { status: 403, body: { code: 'forbidden' } };
    },
  });
  renderAt('/items');
  expect(await screen.findByText("You can't open this page")).toBeInTheDocument();
  expect(within(nav()).queryByRole('link', { name: /Items/ })).toBeNull();
  expect(api.sent('GET', '/api/session').length).toBeGreaterThanOrEqual(2);
});

test('the session is re-read when the window gets focus', async () => {
  let session: ActiveSession = STAFF_SESSION;
  const api = fakeApi(STAFF_SESSION, { 'GET /api/session': () => ({ body: session }) });
  renderAt('/');
  expect(
    await within(await screen.findByRole('navigation', { name: 'Main' })).findByRole('link', {
      name: /Items/,
    }),
  ).toBeInTheDocument();
  const reads = api.sent('GET', '/api/session').length;

  session = staffWith('billing.sell');
  act(() => {
    window.dispatchEvent(new Event('visibilitychange'));
  });
  await waitFor(() => {
    expect(within(nav()).queryByRole('link', { name: /Items/ })).toBeNull();
  });
  expect(api.sent('GET', '/api/session').length).toBeGreaterThan(reads);
});

// --- My password -------------------------------------------------------------------------------

test('a cashier opens My password from the name in the sidebar and changes it', async () => {
  const api = fakeApi(STAFF_SESSION, { 'POST /api/password': { status: 204 } });
  renderAt('/');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('link', { name: /Meena/ }));
  expect(await screen.findByRole('heading', { level: 1, name: 'My password' })).toBeInTheDocument();
  const who = within(screen.getByRole('region', { name: 'Your login' }));
  expect(who.getByText('Meena')).toBeInTheDocument();
  expect(who.getByText('Staff')).toBeInTheDocument();
  await user.type(screen.getByLabelText('Current password'), 'the old password');
  await user.type(screen.getByLabelText('New password'), 'a brand new password');
  await user.click(screen.getByRole('button', { name: 'Change password' }));
  expect(await screen.findByText(/Password changed/)).toBeInTheDocument();
  expect(api.sent('POST', '/api/password')[0]?.body).toEqual({
    currentPassword: 'the old password',
    newPassword: 'a brand new password',
  });
});

test('a wrong current password shows an error on My password', async () => {
  fakeApi(STAFF_SESSION, {
    'POST /api/password': { status: 401, body: { code: 'wrong_password' } },
  });
  renderAt('/account');
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Current password'), 'not it at all');
  await user.type(screen.getByLabelText('New password'), 'a brand new password');
  await user.click(screen.getByRole('button', { name: 'Change password' }));
  expect(await screen.findByText("That isn't your current password")).toBeInTheDocument();
});

// --- The staff list -----------------------------------------------------------------------

function ownerWithStaff(
  people: StaffView[] = [CASHIER, FORMER],
  branches?: { id: string; name: string }[],
) {
  const staff = staffRoutes(people, branches);
  return { ...fakeApi(OWNER_SESSION, staff.routes), ...staff };
}

test('lists the staff with what each can do, and hides the branch for a one-branch business', async () => {
  ownerWithStaff();
  renderAt('/staff');
  const row = await screen.findByRole('row', { name: /Meena Devi/ });
  expect(within(row).getByText('meena')).toBeInTheDocument();
  expect(within(row).getByText('Billing, Customers, Items, Stock')).toBeInTheDocument();
  expect(within(row).getByText('Active')).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Home branch' })).toBeNull();
  // Former staff stay out of the list until asked for.
  expect(screen.queryByText('Suresh Kumar')).toBeNull();
});

test('shows the branch column when the business has more than one branch', async () => {
  ownerWithStaff(
    [CASHIER],
    [
      { id: BRANCH_ID, name: 'Main shop' },
      { id: SECOND_BRANCH_ID, name: 'Market stall' },
    ],
  );
  renderAt('/staff');
  expect(await screen.findByRole('columnheader', { name: 'Home branch' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'Main shop' })).toBeInTheDocument();
});

test('"Show former staff" adds the deactivated logins, with Reactivate', async () => {
  ownerWithStaff();
  renderAt('/staff');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('checkbox', { name: 'Show former staff' }));
  const row = await screen.findByRole('row', { name: /Suresh Kumar/ });
  expect(within(row).getByText('Deactivated')).toBeInTheDocument();
  expect(within(row).getByRole('button', { name: 'Reactivate Suresh Kumar' })).toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: /^Deactivate / })).toBeNull();
});

// --- Reset password, deactivate, reactivate ------------------------------------------------

test("Reset password sets the new password with the owner's password and says they are logged out", async () => {
  const api = ownerWithStaff();
  renderAt('/staff');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Reset password for Meena Devi' }));
  const box = await dialog('Reset password for Meena Devi');
  expect(box).toHaveTextContent('logged out on every computer at once');
  await user.type(within(box).getByLabelText('New password'), 'a brand new password');
  await user.type(ownerBox(), `${OWNER_PASSWORD}{Enter}`);
  expect(
    await screen.findByText('New password set for Meena Devi. They are logged out everywhere.'),
  ).toBeInTheDocument();
  expect(api.sent('POST', `/api/staff/${CASHIER.id}/password`)[0]?.body).toEqual({
    newPassword: 'a brand new password',
    ownerPassword: OWNER_PASSWORD,
  });
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

test("a wrong owner's password keeps the dialog open and is not remembered", async () => {
  const api = ownerWithStaff();
  renderAt('/staff');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Reset password for Meena Devi' }));
  const box = await dialog('Reset password for Meena Devi');
  await user.type(within(box).getByLabelText('New password'), 'a brand new password');
  await user.type(ownerBox(), 'not the password{Enter}');
  expect(await within(box).findByText("That isn't the owner's password")).toBeInTheDocument();
  expect(box).toBeVisible();
  expect(ownerBox()).toHaveValue('');
  // The new password the owner typed is still there to send again.
  expect(within(box).getByLabelText('New password')).toHaveValue('a brand new password');
  expect(api.sent('POST', `/api/staff/${CASHIER.id}/password`)).toHaveLength(1);
});

test('too many wrong tries say when to try again', async () => {
  const staff = staffRoutes([CASHIER]);
  fakeApi(OWNER_SESSION, {
    ...staff.routes,
    [`POST /api/staff/${CASHIER.id}/password`]: {
      status: 429,
      body: { code: 'too_many_attempts', retryAt: '2026-11-22T10:15:00.000Z' },
    },
  });
  renderAt('/staff');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Reset password for Meena Devi' }));
  const box = await dialog('Reset password for Meena Devi');
  await user.type(within(box).getByLabelText('New password'), 'a brand new password');
  await user.type(ownerBox(), 'whatever{Enter}');
  expect(await within(box).findByText(/Too many tries\. Try again at/)).toBeInTheDocument();
});

test("a too short new password shows under the new password's box", async () => {
  const staff = staffRoutes([CASHIER]);
  fakeApi(OWNER_SESSION, {
    ...staff.routes,
    [`POST /api/staff/${CASHIER.id}/password`]: {
      status: 400,
      body: { code: 'invalid_body', fields: { newPassword: 'too_short' } },
    },
  });
  renderAt('/staff');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Reset password for Meena Devi' }));
  const box = await dialog('Reset password for Meena Devi');
  await user.type(within(box).getByLabelText('New password'), 'short');
  await user.type(ownerBox(), `${OWNER_PASSWORD}{Enter}`);
  expect(await within(box).findByText('Use at least 10 characters')).toBeInTheDocument();
  expect(box).toBeVisible();
});

test('Deactivate says what happens, needs no password, and takes the person off the list', async () => {
  const api = ownerWithStaff();
  renderAt('/staff');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Deactivate Meena Devi' }));
  const box = await dialog('Deactivate Meena Devi?');
  for (const line of [
    'They are logged out at once.',
    "They can't log in.",
    'Their history stays.',
    'You can switch the login back on any time.',
  ]) {
    expect(within(box).getByText(line)).toBeInTheDocument();
  }
  expect(within(box).queryByLabelText("Owner's password")).toBeNull();
  await user.type(within(box).getByLabelText('Reason (optional)'), 'left the shop');
  await user.click(within(box).getByRole('button', { name: 'Deactivate' }));
  expect(await screen.findByText('Meena Devi is deactivated.')).toBeInTheDocument();
  expect(api.sent('POST', `/api/staff/${CASHIER.id}/deactivate`)[0]?.body).toEqual({
    reason: 'left the shop',
  });
  await waitFor(() => {
    expect(screen.queryByRole('row', { name: /Meena Devi/ })).toBeNull();
  });
});

test("Reactivate asks for the owner's password", async () => {
  const api = ownerWithStaff();
  renderAt('/staff');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('checkbox', { name: 'Show former staff' }));
  await user.click(await screen.findByRole('button', { name: 'Reactivate Suresh Kumar' }));
  await dialog('Reactivate Suresh Kumar?');
  await user.type(ownerBox(), `${OWNER_PASSWORD}{Enter}`);
  expect(await screen.findByText('Suresh Kumar can log in again.')).toBeInTheDocument();
  expect(api.sent('POST', `/api/staff/${FORMER.id}/reactivate`)[0]?.body).toEqual({
    ownerPassword: OWNER_PASSWORD,
  });
});

// --- The switch screen --------------------------------------------------------------------------

const switchBox = (name: string) => screen.findByRole('checkbox', { name });

test('the switches: a child turns its parent on, and a parent off turns its children off', async () => {
  ownerWithStaff();
  renderAt(`/staff/${CASHIER.id}`);
  const user = userEvent.setup();
  expect(await switchBox('See items')).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Add and edit items' })).not.toBeChecked();
  await user.click(screen.getByRole('checkbox', { name: 'Add and edit items' }));
  await user.click(screen.getByRole('checkbox', { name: 'See purchase prices' }));
  expect(screen.getByRole('checkbox', { name: 'See purchase prices' })).toBeChecked();

  await user.click(screen.getByRole('checkbox', { name: 'See items' }));
  for (const name of ['See items', 'Add and edit items', 'See purchase prices']) {
    expect(screen.getByRole('checkbox', { name })).not.toBeChecked();
  }
  // Billing is untouched.
  expect(screen.getByRole('checkbox', { name: 'Bill customers' })).toBeChecked();

  await user.click(screen.getByRole('checkbox', { name: 'Add and edit items' }));
  expect(screen.getByRole('checkbox', { name: 'See items' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Add and edit items' })).toBeChecked();
});

test('the switches are in groups, with the dependent ones indented', async () => {
  ownerWithStaff();
  renderAt(`/staff/${CASHIER.id}`);
  const access = within(await screen.findByRole('region', { name: 'Access' }));
  for (const group of ['Billing', 'Customers', 'Items', 'Stock']) {
    expect(access.getByRole('group', { name: group })).toBeInTheDocument();
  }
  const row = (name: string) =>
    access.getByRole('checkbox', { name }).closest('div')?.parentElement;
  expect(row('Add and edit items')).toHaveClass('ml-7');
  expect(row('See items')).not.toHaveClass('ml-7');
  expect(
    access.getByText(/Staff never see salaries or profit unless you switch it on/),
  ).toBeInTheDocument();
});

test("the discount box appears with its switch, offers 5%, and the whole set is saved with the owner's password", async () => {
  const api = ownerWithStaff();
  renderAt(`/staff/${CASHIER.id}`);
  const user = userEvent.setup();
  expect(screen.queryByLabelText('Most they can discount alone')).toBeNull();
  await user.click(await switchBox('Give discounts'));
  const limit = screen.getByLabelText('Most they can discount alone');
  expect(limit).toHaveValue('5');
  await user.clear(limit);
  await user.type(limit, '7.5');
  await user.click(screen.getByRole('button', { name: 'Save access' }));
  await dialog('Save access for Meena Devi');
  await user.type(ownerBox(), `${OWNER_PASSWORD}{Enter}`);
  expect(await screen.findByText('Access saved')).toBeInTheDocument();
  expect(api.sent('PUT', `/api/staff/${CASHIER.id}/permissions`)[0]?.body).toEqual({
    permissions: [
      'billing.sell',
      'billing.discount',
      'customers.view',
      'customers.manage',
      'items.view',
      'stock.view',
    ],
    discountLimitBasisPoints: 750,
    ownerPassword: OWNER_PASSWORD,
  });
  // Nothing left to save until something changes again.
  expect(screen.getByRole('button', { name: 'Save access' })).toBeDisabled();
});

test('a limit that is not 0 to 100 is refused before the owner is asked', async () => {
  const api = ownerWithStaff();
  renderAt(`/staff/${CASHIER.id}`);
  const user = userEvent.setup();
  await user.click(await switchBox('Give discounts'));
  const limit = screen.getByLabelText('Most they can discount alone');
  await user.clear(limit);
  await user.type(limit, '100.5');
  await user.click(screen.getByRole('button', { name: 'Save access' }));
  expect(await screen.findByText('Enter 0 to 100, up to two decimals')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(api.sent('PUT', `/api/staff/${CASHIER.id}/permissions`)).toHaveLength(0);
});

test('Reset to defaults puts every switch back, and Save is off until something changes', async () => {
  ownerWithStaff();
  renderAt(`/staff/${CASHIER.id}`);
  const user = userEvent.setup();
  expect(await screen.findByRole('button', { name: 'Save access' })).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: 'Change stock' }));
  await user.click(screen.getByRole('checkbox', { name: 'See purchase prices' }));
  expect(screen.getByRole('button', { name: 'Save access' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Reset to defaults' }));
  expect(screen.getByRole('checkbox', { name: 'Change stock' })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'See purchase prices' })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Bill customers' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Save access' })).toBeDisabled();
});

test("the owner's password is not in the box, or anywhere on the page, once it is sent", async () => {
  const staff = staffRoutes([CASHIER]);
  const api = fakeApi(OWNER_SESSION, staff.routes);
  // Hold the answer, so the check happens while the request is in flight.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = api.fetchMock.getMockImplementation();
  if (original === undefined) throw new Error('fakeApi has no fetch');
  api.fetchMock.mockImplementation((url: string, init?: RequestInit) =>
    init?.method === 'PUT' && url.endsWith('/permissions')
      ? held.then(() => original(url, init))
      : original(url, init),
  );
  renderAt(`/staff/${CASHIER.id}`);
  const user = userEvent.setup();
  await user.click(await switchBox('Change stock'));
  await user.click(screen.getByRole('button', { name: 'Save access' }));
  await dialog('Save access for Meena Devi');
  await user.type(ownerBox(), `${OWNER_PASSWORD}{Enter}`);
  await waitFor(() => {
    expect(api.sent('PUT', `/api/staff/${CASHIER.id}/permissions`)).toHaveLength(1);
  });
  expect(ownerBox()).toHaveValue('');
  expect(document.body.innerHTML).not.toContain(OWNER_PASSWORD);
  release();
  expect(await screen.findByText('Access saved')).toBeInTheDocument();
  expect(document.body.innerHTML).not.toContain(OWNER_PASSWORD);
});

test("a wrong owner's password on the switch screen changes nothing and keeps the dialog open", async () => {
  ownerWithStaff();
  renderAt(`/staff/${CASHIER.id}`);
  const user = userEvent.setup();
  await user.click(await switchBox('Change stock'));
  await user.click(screen.getByRole('button', { name: 'Save access' }));
  const box = await dialog('Save access for Meena Devi');
  await user.type(ownerBox(), 'wrong one{Enter}');
  expect(await within(box).findByText("That isn't the owner's password")).toBeInTheDocument();
  expect(box).toBeVisible();
  expect(screen.queryByText('Access saved')).toBeNull();
});

test('invalid_permissions from the server shows plain words', async () => {
  const staff = staffRoutes([CASHIER]);
  fakeApi(OWNER_SESSION, {
    ...staff.routes,
    [`PUT /api/staff/${CASHIER.id}/permissions`]: {
      status: 422,
      body: { code: 'invalid_permissions', permission: 'items.manage', problem: 'needs_parent' },
    },
  });
  renderAt(`/staff/${CASHIER.id}`);
  const user = userEvent.setup();
  await user.click(await switchBox('Change stock'));
  await user.click(screen.getByRole('button', { name: 'Save access' }));
  await dialog('Save access for Meena Devi');
  await user.type(ownerBox(), `${OWNER_PASSWORD}{Enter}`);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    "Those switches don't fit together. Reload the page and try again.",
  );
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

test("editing the person saves the name, username and branch without the owner's password", async () => {
  const api = ownerWithStaff();
  renderAt(`/staff/${CASHIER.id}`);
  const user = userEvent.setup();
  const person = within(await screen.findByRole('region', { name: 'Person' }));
  await user.clear(person.getByLabelText('Name'));
  await user.type(person.getByLabelText('Name'), 'Meena Sharma');
  await user.click(person.getByRole('button', { name: 'Save' }));
  expect(await person.findByRole('status')).toHaveTextContent('Saved');
  expect(api.sent('PUT', `/api/staff/${CASHIER.id}`)[0]?.body).toEqual({
    name: 'Meena Sharma',
    username: 'meena',
    homeBranchId: BRANCH_ID,
  });
  expect(person.queryByLabelText('Home branch')).toBeNull();
});

test('a username that is taken shows under the username on the edit page', async () => {
  const staff = staffRoutes([CASHIER]);
  fakeApi(OWNER_SESSION, {
    ...staff.routes,
    [`PUT /api/staff/${CASHIER.id}`]: { status: 409, body: { code: 'username_taken' } },
  });
  renderAt(`/staff/${CASHIER.id}`);
  const user = userEvent.setup();
  const person = within(await screen.findByRole('region', { name: 'Person' }));
  await user.click(person.getByRole('button', { name: 'Save' }));
  await expectDescribed('Username', /This username is taken/);
});

test('a login that does not exist says so', async () => {
  ownerWithStaff();
  renderAt('/staff/00000000-0000-4000-8000-0000000000ff');
  expect(await screen.findByText('No such staff login')).toBeInTheDocument();
});

// --- Adding a login ---------------------------------------------------------------------------------

async function fillNewLogin(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Name'), 'Ravi Kumar');
  await user.type(screen.getByLabelText('Username'), 'Ravi.K');
  await user.type(screen.getByLabelText('Password'), 'a brand new password');
}

test("adds a login: the person, the defaults, and the owner's password", async () => {
  const api = ownerWithStaff([]);
  const history = renderAt('/staff/new');
  const user = userEvent.setup();
  await fillNewLogin(user);
  // One branch: no branch box, the only branch is used.
  expect(screen.queryByLabelText('Home branch')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Add staff login' }));
  await dialog('Add this login');
  await user.type(ownerBox(), `${OWNER_PASSWORD}{Enter}`);
  await waitFor(() => {
    expect(history.location.pathname).toBe('/staff');
  });
  expect(api.sent('POST', '/api/staff')[0]?.body).toEqual({
    name: 'Ravi Kumar',
    username: 'Ravi.K',
    password: 'a brand new password',
    homeBranchId: BRANCH_ID,
    permissions: ['billing.sell', 'customers.view', 'customers.manage', 'items.view', 'stock.view'],
    discountLimitBasisPoints: null,
    ownerPassword: OWNER_PASSWORD,
  });
  expect(await screen.findByRole('row', { name: /Ravi Kumar/ })).toBeInTheDocument();
});

test('adding picks the home branch when the business has more than one', async () => {
  const api = ownerWithStaff(
    [],
    [
      { id: BRANCH_ID, name: 'Main shop' },
      { id: SECOND_BRANCH_ID, name: 'Market stall' },
    ],
  );
  renderAt('/staff/new');
  const user = userEvent.setup();
  await fillNewLogin(user);
  await user.selectOptions(screen.getByLabelText('Home branch'), 'Market stall');
  await user.click(screen.getByRole('button', { name: 'Add staff login' }));
  await dialog('Add this login');
  await user.type(ownerBox(), `${OWNER_PASSWORD}{Enter}`);
  await waitFor(() => {
    expect(api.sent('POST', '/api/staff')).toHaveLength(1);
  });
  expect(api.sent('POST', '/api/staff')[0]?.body).toMatchObject({ homeBranchId: SECOND_BRANCH_ID });
});

test('an empty form shows what to fill in and asks for no password', async () => {
  const api = ownerWithStaff([]);
  renderAt('/staff/new');
  await userEvent.click(await screen.findByRole('button', { name: 'Add staff login' }));
  await expectDescribed('Name', 'Fill this in');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(api.sent('POST', '/api/staff')).toHaveLength(0);
});

test('a switched-on discount is sent with its limit when adding', async () => {
  const api = ownerWithStaff([]);
  renderAt('/staff/new');
  const user = userEvent.setup();
  await fillNewLogin(user);
  await user.click(screen.getByRole('checkbox', { name: 'Give discounts' }));
  await user.click(screen.getByRole('button', { name: 'Add staff login' }));
  await dialog('Add this login');
  await user.type(ownerBox(), `${OWNER_PASSWORD}{Enter}`);
  await waitFor(() => {
    expect(api.sent('POST', '/api/staff')).toHaveLength(1);
  });
  expect(api.sent('POST', '/api/staff')[0]?.body).toMatchObject({
    discountLimitBasisPoints: 500,
    permissions: expect.arrayContaining(['billing.discount']) as unknown,
  });
});

test('a username that is taken closes the dialog and shows under the username', async () => {
  const staff = staffRoutes([]);
  fakeApi(OWNER_SESSION, {
    ...staff.routes,
    'POST /api/staff': { status: 409, body: { code: 'username_taken' } },
  });
  renderAt('/staff/new');
  const user = userEvent.setup();
  await fillNewLogin(user);
  await user.click(screen.getByRole('button', { name: 'Add staff login' }));
  await dialog('Add this login');
  await user.type(ownerBox(), `${OWNER_PASSWORD}{Enter}`);
  await expectDescribed('Username', 'This username is taken. Choose another');
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

test.each([
  ['same_as_username', "Don't use the username as the password"],
  ['same_as_phone', "Don't use your phone number as the password"],
  ['too_short', 'Use at least 10 characters'],
])('a refused password (%s) shows under the password box', async (code, words) => {
  const staff = staffRoutes([]);
  fakeApi(OWNER_SESSION, {
    ...staff.routes,
    'POST /api/staff': { status: 400, body: { code: 'invalid_body', fields: { password: code } } },
  });
  renderAt('/staff/new');
  const user = userEvent.setup();
  await fillNewLogin(user);
  await user.click(screen.getByRole('button', { name: 'Add staff login' }));
  await dialog('Add this login');
  await user.type(ownerBox(), `${OWNER_PASSWORD}{Enter}`);
  await expectDescribed('Password', words);
});

test("adding with a wrong owner's password keeps the dialog open", async () => {
  const api = ownerWithStaff([]);
  renderAt('/staff/new');
  const user = userEvent.setup();
  await fillNewLogin(user);
  await user.click(screen.getByRole('button', { name: 'Add staff login' }));
  const box = await dialog('Add this login');
  await user.type(ownerBox(), 'nope nope{Enter}');
  expect(await within(box).findByText("That isn't the owner's password")).toBeInTheDocument();
  expect(box).toBeVisible();
  expect(api.sent('POST', '/api/staff')).toHaveLength(1);
});

// --- Languages ----------------------------------------------------------------------------------

test('the Staff page speaks Hindi and Hinglish', async () => {
  ownerWithStaff();
  await changeLanguage('hi');
  renderAt('/staff');
  expect(await screen.findByRole('heading', { level: 1, name: 'स्टाफ़' })).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: /स्टाफ़ जोड़ें/ })).toBeInTheDocument();
});

test('the Staff page speaks Hinglish', async () => {
  ownerWithStaff();
  await changeLanguage('hi-Latn');
  renderAt('/staff');
  expect(await screen.findByRole('button', { name: 'Staff jodein' })).toBeInTheDocument();
});

test('a former login is still reachable and shows as deactivated on its page', async () => {
  ownerWithStaff();
  renderAt(`/staff/${FORMER.id}`);
  expect(
    await screen.findByRole('heading', { level: 2, name: 'Suresh Kumar' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Deactivated')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
});

// --- "Can also work at" (P1.6, Module 00 #57) --------------------------------------------------

const TWO = [
  { id: BRANCH_ID, name: 'Main shop' },
  { id: SECOND_BRANCH_ID, name: 'Market stall' },
];

test('the edit page offers extra branches only when the business has more than one', async () => {
  ownerWithStaff();
  renderAt(`/staff/${CASHIER.id}`);
  await screen.findByRole('region', { name: 'Person' });
  expect(screen.queryByRole('region', { name: 'Can also work at' })).toBeNull();
});

test("ticking another branch asks for the owner's password, then sends the branches", async () => {
  const api = ownerWithStaff([CASHIER], TWO);
  renderAt(`/staff/${CASHIER.id}`);
  const user = userEvent.setup();
  const card = within(await screen.findByRole('region', { name: 'Can also work at' }));
  // The home branch is always allowed, so only the others are offered.
  expect(card.queryByRole('checkbox', { name: 'Main shop' })).toBeNull();
  const save = card.getByRole('button', { name: 'Save branches' });
  expect(save).toBeDisabled();
  await user.click(card.getByRole('checkbox', { name: 'Market stall' }));
  await user.click(save);
  await dialog('Change where Meena Devi can work');
  await user.type(ownerBox(), `${OWNER_PASSWORD}{Enter}`);
  expect(await card.findByRole('status')).toHaveTextContent('Saved');
  expect(api.sent('PUT', `/api/staff/${CASHIER.id}/branches`)[0]?.body).toEqual({
    branchIds: [SECOND_BRANCH_ID],
    ownerPassword: OWNER_PASSWORD,
  });
  expect(card.getByRole('checkbox', { name: 'Market stall' })).toBeChecked();
  expect(card.getByRole('button', { name: 'Save branches' })).toBeDisabled();
});

test('a wrong owner password changes no branches', async () => {
  const api = ownerWithStaff([CASHIER], TWO);
  renderAt(`/staff/${CASHIER.id}`);
  const user = userEvent.setup();
  const card = within(await screen.findByRole('region', { name: 'Can also work at' }));
  await user.click(card.getByRole('checkbox', { name: 'Market stall' }));
  await user.click(card.getByRole('button', { name: 'Save branches' }));
  await dialog('Change where Meena Devi can work');
  await user.type(ownerBox(), 'not the password{Enter}');
  expect(await screen.findByText("That isn't the owner's password")).toBeInTheDocument();
  expect(card.queryByRole('status')).toBeNull();
  expect(api.sent('PUT', `/api/staff/${CASHIER.id}/branches`)).toHaveLength(1);
});

test('the staff screens read branches from the branches route, not the items context', async () => {
  const api = ownerWithStaff([CASHIER], TWO);
  renderAt('/staff');
  await screen.findByRole('columnheader', { name: 'Home branch' });
  expect(api.sent('GET', '/api/items/context')).toHaveLength(0);
  expect(api.fetchMock.mock.calls.map(([url]) => url)).toContain(
    '/api/branches?includeArchived=true',
  );
});
