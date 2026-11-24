// The attendance register and a person's month (P2.3 design §6; Module 05 #5–#9, #25, #26, #32).
import type { ActiveSession } from '@business-software/shared';
import { screen, waitFor, within, type BoundFunctions, type queries } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { changeLanguage } from '../../i18n';
import {
  attendanceRoutes,
  daysAgo,
  MEENA,
  monthRoute,
  RAJU,
  TODAY,
  type FakePerson,
} from '../../test/fake-attendance';
import { fakeApi, OWNER_SESSION, renderAt, STAFF_SESSION } from '../../test/fake-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const nav = () => screen.getByRole('navigation', { name: 'Main' });
const staffWith = (...permissions: ActiveSession['permissions']): ActiveSession => ({
  ...STAFF_SESSION,
  permissions: ['session.own', ...permissions],
});

type Row = BoundFunctions<typeof queries>;

/** The register at the owner's branch, or a login's with the switches given. */
function openRegister(
  people: FakePerson[] = [MEENA, RAJU],
  session: ActiveSession = OWNER_SESSION,
  path = '/attendance',
) {
  const register = attendanceRoutes(people);
  const api = fakeApi(session, { ...register.routes });
  const history = renderAt(path);
  return { api, history, ...register };
}

const rowOf = async (name: string) => within(await screen.findByRole('listitem', { name }));
const chip = (row: Row, name: string) => row.getByRole('button', { name: new RegExp(`^${name}`) });

// --- The daily register -----------------------------------------------------------------------

test('lists everyone at the branch as present, with the day in the header', async () => {
  openRegister();
  expect(await screen.findByRole('heading', { level: 1, name: 'Attendance' })).toBeInTheDocument();
  const meena = await rowOf('Meena Devi');
  expect(chip(meena, 'Present')).toHaveAttribute('aria-pressed', 'true');
  expect(chip(meena, 'Absent')).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByText('Everyone is in')).toBeInTheDocument();
});

test('one tap marks today without asking a reason, and the count follows', async () => {
  const { api } = openRegister();
  const user = userEvent.setup();
  const meena = await rowOf('Meena Devi');
  await user.click(chip(meena, 'Absent'));
  await waitFor(() => {
    expect(chip(meena, 'Absent')).toHaveAttribute('aria-pressed', 'true');
  });
  expect(api.sent('PUT', `/api/attendance/${MEENA.id}/${TODAY}`)[0]?.body).toEqual({
    status: 'absent',
    late: false,
    overtimeMinutes: 0,
    version: null,
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByText('1 absent')).toBeInTheDocument();
});

test('the count reads like "2 absent, 1 on leave"', async () => {
  openRegister([MEENA, RAJU, { id: '00000000-0000-4000-8000-0000000000a5', name: 'Geeta Rani' }]);
  const user = userEvent.setup();
  await user.click(chip(await rowOf('Meena Devi'), 'Absent'));
  await user.click(chip(await rowOf('Raju Singh'), 'Absent'));
  await user.click(chip(await rowOf('Geeta Rani'), 'Paid leave'));
  expect(await screen.findByText('2 absent, 1 on leave')).toBeInTheDocument();
});

test('late and overtime belong to a present day only, and overtime to a person who has it on', async () => {
  const { api } = openRegister();
  const user = userEvent.setup();
  const meena = await rowOf('Meena Devi');
  const raju = await rowOf('Raju Singh');
  // Raju has overtime off: no box for it.
  expect(raju.queryByLabelText('Overtime: Raju Singh')).toBeNull();
  expect(raju.getByRole('checkbox', { name: 'Late: Raju Singh' })).toBeInTheDocument();

  await user.click(meena.getByRole('checkbox', { name: 'Late: Meena Devi' }));
  await waitFor(() => {
    expect(api.sent('PUT', `/api/attendance/${MEENA.id}/${TODAY}`)).toHaveLength(1);
  });
  await user.selectOptions(meena.getByLabelText('Overtime: Meena Devi'), '1.5 hours');
  await waitFor(() => {
    expect(api.sent('PUT', `/api/attendance/${MEENA.id}/${TODAY}`)).toHaveLength(2);
  });
  expect(api.sent('PUT', `/api/attendance/${MEENA.id}/${TODAY}`)[1]?.body).toEqual({
    status: 'present',
    late: true,
    overtimeMinutes: 90,
    version: 1,
  });

  // Away from present, both go: they are sent cleared, and the boxes disappear.
  await user.click(chip(meena, 'Half-day'));
  await waitFor(() => {
    expect(meena.queryByRole('checkbox', { name: 'Late: Meena Devi' })).toBeNull();
  });
  expect(api.sent('PUT', `/api/attendance/${MEENA.id}/${TODAY}`)[2]?.body).toEqual({
    status: 'half_day',
    late: false,
    overtimeMinutes: 0,
    version: 2,
  });
  expect(meena.queryByLabelText('Overtime: Meena Devi')).toBeNull();
});

test('the paid leaves used this month show for a person who has some', async () => {
  openRegister();
  expect(
    within(await screen.findByRole('listitem', { name: 'Meena Devi' })).getByText(
      '1 of 2 paid leaves used this month',
    ),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole('listitem', { name: 'Raju Singh' })).queryByText(/paid leaves used/),
  ).toBeNull();
});

test('a past day asks for a reason once, and keeps it for the next taps on that day', async () => {
  const { api } = openRegister();
  const user = userEvent.setup();
  await rowOf('Meena Devi');
  await user.click(screen.getByRole('button', { name: 'Previous day' }));
  await waitFor(() => {
    expect(screen.getByLabelText('Date')).toHaveValue(daysAgo(1));
  });
  const meena = await rowOf('Meena Devi');
  await user.click(chip(meena, 'Absent'));

  // An empty reason is not accepted, and nothing is sent.
  const box = await screen.findByRole('dialog', { name: 'Why change a past day?' });
  await user.click(within(box).getByRole('button', { name: 'Save change' }));
  expect(await within(box).findByText('Fill this in')).toBeInTheDocument();
  expect(api.sent('PUT', `/api/attendance/${MEENA.id}/${daysAgo(1)}`)).toHaveLength(0);

  await user.type(within(box).getByLabelText('Reason'), 'Forgot to mark it{Enter}');
  await waitFor(() => {
    expect(chip(meena, 'Absent')).toHaveAttribute('aria-pressed', 'true');
  });
  expect(api.sent('PUT', `/api/attendance/${MEENA.id}/${daysAgo(1)}`)[0]?.body).toEqual({
    status: 'absent',
    late: false,
    overtimeMinutes: 0,
    version: null,
    reason: 'Forgot to mark it',
  });

  // The next tap on the same day does not ask again, and sends the same reason.
  const raju = await rowOf('Raju Singh');
  await user.click(chip(raju, 'Paid leave'));
  await waitFor(() => {
    expect(api.sent('PUT', `/api/attendance/${RAJU.id}/${daysAgo(1)}`)).toHaveLength(1);
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(api.sent('PUT', `/api/attendance/${RAJU.id}/${daysAgo(1)}`)[0]?.body).toMatchObject({
    reason: 'Forgot to mark it',
  });
  expect(screen.getByText('Reason for this day: Forgot to mark it')).toBeInTheDocument();

  // Another past day is another change: it asks again.
  await user.click(screen.getByRole('button', { name: 'Previous day' }));
  await waitFor(() => {
    expect(screen.getByLabelText('Date')).toHaveValue(daysAgo(2));
  });
  await user.click(chip(await rowOf('Meena Devi'), 'Absent'));
  expect(await screen.findByRole('dialog', { name: 'Why change a past day?' })).toBeVisible();
});

test('the register goes back day by day but never past today', async () => {
  openRegister();
  const date = await screen.findByLabelText('Date');
  expect(date).toHaveAttribute('max', TODAY);
  expect(date).toHaveValue(TODAY);
  expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Previous day' }));
  await waitFor(() => {
    expect(screen.getByLabelText('Date')).toHaveValue(daysAgo(1));
  });
  expect(screen.getByRole('button', { name: 'Next day' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Today' }));
  await waitFor(() => {
    expect(screen.getByLabelText('Date')).toHaveValue(TODAY);
  });
});

test('somebody else saved the day first: it shows what is there now and says so', async () => {
  const register = attendanceRoutes([MEENA, RAJU]);
  fakeApi(OWNER_SESSION, {
    ...register.routes,
    [`PUT /api/attendance/${MEENA.id}/${TODAY}`]: {
      status: 409,
      body: {
        code: 'changed',
        latest: {
          userId: MEENA.id,
          name: MEENA.name,
          status: 'paid_leave',
          late: false,
          overtimeMinutes: 0,
          marked: true,
          version: 4,
          overtimeAllowed: true,
          paidLeavesPerMonth: 2,
          paidLeavesUsed: 2,
        },
      },
    },
  });
  renderAt('/attendance');
  const user = userEvent.setup();
  const meena = await rowOf('Meena Devi');
  await user.click(chip(meena, 'Absent'));
  expect(
    await screen.findByText('Meena Devi was changed by someone else. Check it and tap again.'),
  ).toBeInTheDocument();
  expect(chip(meena, 'Paid leave')).toHaveAttribute('aria-pressed', 'true');
  expect(chip(meena, 'Absent')).toHaveAttribute('aria-pressed', 'false');
});

test('you cannot mark your own attendance: your row is read-only, with the reason', async () => {
  const self: FakePerson = { id: STAFF_SESSION.user.id, name: 'Meena' };
  openRegister([self, RAJU], staffWith('attendance.mark'));
  const row = await rowOf('Meena');
  expect(chip(row, 'Absent')).toBeDisabled();
  expect(row.getByText("You can't mark your own attendance")).toBeInTheDocument();
  expect(chip(await rowOf('Raju Singh'), 'Absent')).toBeEnabled();
});

test('chips are one stop on the Tab key: the arrows move between them and Enter picks', async () => {
  const { api } = openRegister();
  const user = userEvent.setup();
  const meena = await rowOf('Meena Devi');
  chip(meena, 'Present').focus();
  await user.keyboard('{ArrowRight}');
  expect(chip(meena, 'Half-day')).toHaveFocus();
  // Moving does not save anything.
  expect(api.sent('PUT', `/api/attendance/${MEENA.id}/${TODAY}`)).toHaveLength(0);
  await user.keyboard('{ArrowRight}{Enter}');
  await waitFor(() => {
    expect(chip(meena, 'Absent')).toHaveAttribute('aria-pressed', 'true');
  });
  // Only the picked chip is reachable with Tab.
  expect(chip(meena, 'Absent')).toHaveAttribute('tabindex', '0');
  expect(chip(meena, 'Present')).toHaveAttribute('tabindex', '-1');
});

test('an owner with two branches reads the register of the branch the picker shows', async () => {
  const two = { ...OWNER_SESSION, branchCount: 2 };
  const register = attendanceRoutes([MEENA]);
  const api = fakeApi(two, {
    ...register.routes,
    'GET /api/branches/picker': {
      body: [
        { id: OWNER_SESSION.branch.id, code: 'HO', name: 'Main shop' },
        { id: '00000000-0000-4000-8000-000000000013', code: 'MKT', name: 'Market stall' },
      ],
    },
  });
  renderAt('/attendance');
  await rowOf('Meena Devi');
  await userEvent.selectOptions(
    await screen.findByRole('combobox', { name: 'Branch shown' }),
    'Market stall',
  );
  await waitFor(() => {
    expect(
      api.fetchMock.mock.calls.some(([url]) =>
        url.includes('branch=00000000-0000-4000-8000-000000000013'),
      ),
    ).toBe(true);
  });
});

test('"All branches" has no register: it asks for one branch', async () => {
  const two = { ...OWNER_SESSION, branchCount: 2 };
  const register = attendanceRoutes([MEENA]);
  fakeApi(two, {
    ...register.routes,
    'GET /api/branches/picker': {
      body: [{ id: OWNER_SESSION.branch.id, code: 'HO', name: 'Main shop' }],
    },
  });
  renderAt('/attendance');
  await rowOf('Meena Devi');
  await userEvent.selectOptions(
    await screen.findByRole('combobox', { name: 'Branch shown' }),
    'all',
  );
  expect(await screen.findByText('Choose one branch to see its register.')).toBeInTheDocument();
  expect(screen.queryByRole('listitem', { name: 'Meena Devi' })).toBeNull();
});

// --- Who sees what ----------------------------------------------------------------------------

test('a login without "Mark attendance" has no register, only its own month', async () => {
  const api = fakeApi(STAFF_SESSION);
  renderAt('/attendance');
  expect(await screen.findByText("You can't open this page")).toBeInTheDocument();
  expect(api.sent('GET', '/api/attendance')).toHaveLength(0);
  expect(within(nav()).queryByRole('link', { name: /^Attendance/ })).toBeNull();
  expect(within(nav()).getByRole('link', { name: 'My attendance' })).toHaveAttribute(
    'href',
    '/attendance/month',
  );
});

test('a login with "Mark attendance" has the Attendance entry, and Alt+T opens it', async () => {
  fakeApi(staffWith('attendance.mark'), attendanceRoutes([RAJU]).routes);
  const history = renderAt('/');
  const link = await within(await screen.findByRole('navigation', { name: 'Main' })).findByRole(
    'link',
    { name: /^Attendance/ },
  );
  expect(link).toHaveAttribute('href', '/attendance');
  expect(link).toHaveAttribute('aria-keyshortcuts', 'Alt+T');
  await userEvent.keyboard('{Alt>}t{/Alt}');
  await waitFor(() => {
    expect(history.location.pathname).toBe('/attendance');
  });
});

test('the owner has the Attendance entry too, with the register and the month as tabs', async () => {
  openRegister();
  expect(await screen.findByRole('tab', { name: 'Daily register' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByRole('tab', { name: 'Month view' })).toHaveAttribute(
    'href',
    '/attendance/month',
  );
});

// --- A person's month -------------------------------------------------------------------------

function openMonth(session: ActiveSession, path: string, people: FakePerson[] = [MEENA, RAJU]) {
  const register = attendanceRoutes(people);
  const api = fakeApi(session, {
    ...register.routes,
    'GET /api/attendance/month': monthRoute(people),
    'GET /api/attendance/people': {
      body: people.map((p) => ({ id: p.id, name: p.name, homeBranchId: 'branch', active: true })),
    },
  });
  renderAt(path);
  return api;
}

const monthRequests = (api: ReturnType<typeof fakeApi>) =>
  api.fetchMock.mock.calls
    .map(([url]) => url)
    .filter((url) => url.startsWith('/api/attendance/month'));

test("the owner sees one person's month as a calendar with the month's counts", async () => {
  const api = openMonth(OWNER_SESSION, '/attendance/month?month=2026-10');
  expect(
    await screen.findByRole('heading', { level: 2, name: 'October 2026' }),
  ).toBeInTheDocument();
  // The fake marks the 3rd of the month absent; the 4th of October 2026 is a Sunday and late.
  const grid = within(await screen.findByRole('list', { name: 'Days of the month' }));
  expect(grid.getByRole('listitem', { name: /^3 Oct 2026, Absent/ })).toBeInTheDocument();
  expect(grid.getByRole('listitem', { name: /^4 Oct 2026, Weekly off, late/ })).toBeInTheDocument();
  const counts = within(screen.getByRole('region', { name: 'This month' }));
  expect(counts.getByText('Absent')).toBeInTheDocument();
  expect(counts.getByText('Holidays taken')).toBeInTheDocument();
  expect(monthRequests(api)[0]).toBe(`/api/attendance/month?userId=${MEENA.id}&month=2026-10`);
});

test('the owner picks another person, and goes back and forward by month', async () => {
  const api = openMonth(OWNER_SESSION, '/attendance/month?month=2026-10');
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText('Person'), 'Raju Singh');
  await waitFor(() => {
    expect(monthRequests(api)).toContain(`/api/attendance/month?userId=${RAJU.id}&month=2026-10`);
  });
  await user.click(screen.getByRole('button', { name: 'Previous month' }));
  await waitFor(() => {
    expect(monthRequests(api)).toContain(`/api/attendance/month?userId=${RAJU.id}&month=2026-09`);
  });
});

test('there is no month after this one', async () => {
  openMonth(OWNER_SESSION, '/attendance/month');
  const next = await screen.findByRole('button', { name: 'Next month' });
  expect(next).toBeDisabled();
});

test('staff without "See everyone\'s attendance" see only their own month, with no picker', async () => {
  const self: FakePerson = { id: STAFF_SESSION.user.id, name: 'Meena' };
  const api = openMonth(
    STAFF_SESSION,
    // Another person's id in the address changes nothing.
    `/attendance/month?month=2026-10&userId=${RAJU.id}`,
    [self, RAJU],
  );
  expect(await screen.findByText('Only your own days show here.')).toBeInTheDocument();
  await screen.findByRole('list', { name: 'Days of the month' });
  expect(screen.queryByLabelText('Person')).toBeNull();
  expect(monthRequests(api)).toEqual([`/api/attendance/month?userId=${self.id}&month=2026-10`]);
});

test('a login with only "See everyone\'s attendance" picks from the branch\'s people', async () => {
  const self: FakePerson = { id: STAFF_SESSION.user.id, name: 'Meena' };
  const api = openMonth(staffWith('attendance.view_all'), '/attendance/month', [RAJU, self]);
  const picker = await screen.findByLabelText('Person');
  expect(
    within(picker)
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual(['Raju Singh', 'Meena']);
  // Their own month first.
  expect(picker).toHaveValue(self.id);
  await screen.findByRole('list', { name: 'Days of the month' });
  expect(monthRequests(api)[0]).toContain(`userId=${self.id}`);
});

// --- Languages --------------------------------------------------------------------------------

test('the register speaks Hindi and Hinglish', async () => {
  openRegister();
  await changeLanguage('hi');
  expect(await screen.findByRole('heading', { level: 1, name: 'उपस्थिति' })).toBeInTheDocument();
  await changeLanguage('hi-Latn');
  expect(await screen.findByRole('heading', { level: 1, name: 'Hazri' })).toBeInTheDocument();
  await changeLanguage('en');
});
