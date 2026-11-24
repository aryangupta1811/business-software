// Settings → Shop holidays (P2.3 design §6; Module 05 #7, #31).
import type { HolidayView, SettingsView } from '@business-software/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { changeLanguage } from '../i18n';
import { holidayRoutes, TODAY } from '../test/fake-attendance';
import { fakeApi, OWNER_SESSION, renderAt } from '../test/fake-api';
import { branchRoutes, HEAD_OFFICE, MAIN, STALL, TWO_BRANCHES } from '../test/fake-branches';

afterEach(() => {
  vi.unstubAllGlobals();
});

const YEAR = TODAY.slice(0, 4);
const SETTINGS: SettingsView = {
  business: {
    businessName: 'Sharma Medical',
    businessType: 'medical',
    phone: '9111111111',
    gstStatus: 'regular',
    pan: null,
    ownerName: 'Ravi Sharma',
    branchName: MAIN.name,
    address: null,
    pinCode: null,
    stateCode: '27',
    gstin: null,
    drugLicence: null,
    fssai: null,
  },
  features: ['expiry_dates'],
  security: { ownerLockMinutes: 5, staffIdleMinutes: 30 },
  stock: { negativeStock: 'warn' },
  alerts: { types: ['low_stock', 'out_of_stock'] },
  invoices: { invoicePrefix: null },
  printing: { billLanguage: 'en', footerNote: null },
  nextInvoice: { financialYear: '2026-27', sequence: 1 },
};

const DIWALI: HolidayView = {
  id: '00000000-0000-4000-8000-0000000000c0',
  date: `${YEAR}-11-08`,
  name: 'Diwali',
  branchId: null,
};
const LOCAL_FAIR: HolidayView = {
  id: '00000000-0000-4000-8000-0000000000c1',
  date: `${YEAR}-12-02`,
  name: 'Local fair',
  branchId: STALL.id,
};

function openHolidays(initial: HolidayView[] = [DIWALI, LOCAL_FAIR], branches = TWO_BRANCHES) {
  const holidays = holidayRoutes(initial);
  const api = fakeApi(OWNER_SESSION, {
    'GET /api/settings': { body: SETTINGS },
    'GET /api/devices': { body: [] },
    ...branchRoutes(branches).routes,
    ...holidays.routes,
  });
  renderAt('/settings');
  return { api, ...holidays };
}

const card = async () => within(await screen.findByRole('region', { name: 'Shop holidays' }));

test("lists the year's holidays with the branch each one is for", async () => {
  openHolidays();
  const holidays = await card();
  const diwali = (await holidays.findByText('Diwali')).closest('li');
  expect(within(diwali as HTMLElement).getByText('Every branch')).toBeInTheDocument();
  const fair = holidays.getByText('Local fair').closest('li');
  expect(within(fair as HTMLElement).getByText(STALL.name)).toBeInTheDocument();
});

test('adds a holiday for every branch by default', async () => {
  const { api } = openHolidays([]);
  const holidays = await card();
  const user = userEvent.setup();
  await user.type(await holidays.findByLabelText('Date'), `${YEAR}-03-14`);
  await user.type(holidays.getByLabelText('Name'), 'Holi');
  expect(holidays.getByLabelText('Applies to')).toHaveValue('');
  await user.click(holidays.getByRole('button', { name: 'Add holiday' }));
  expect(await holidays.findByText('Holi added.')).toBeInTheDocument();
  expect(api.sent('POST', '/api/holidays')[0]?.body).toEqual({
    date: `${YEAR}-03-14`,
    name: 'Holi',
    branchId: null,
  });
  expect(await holidays.findByText('Holi')).toBeInTheDocument();
});

test('a holiday can be for one branch only (#31)', async () => {
  const { api } = openHolidays([]);
  const holidays = await card();
  const user = userEvent.setup();
  await user.type(await holidays.findByLabelText('Date'), `${YEAR}-06-01`);
  await user.type(holidays.getByLabelText('Name'), 'Stall anniversary');
  await user.selectOptions(holidays.getByLabelText('Applies to'), STALL.name);
  await user.click(holidays.getByRole('button', { name: 'Add holiday' }));
  await waitFor(() => {
    expect(api.sent('POST', '/api/holidays')).toHaveLength(1);
  });
  expect(api.sent('POST', '/api/holidays')[0]?.body).toMatchObject({ branchId: STALL.id });
});

test('with one branch there is no branch box', async () => {
  openHolidays([], [HEAD_OFFICE]);
  const holidays = await card();
  await holidays.findByLabelText('Date');
  expect(holidays.queryByLabelText('Applies to')).toBeNull();
});

test('a second holiday on the same day shows under the date', async () => {
  openHolidays();
  const holidays = await card();
  const user = userEvent.setup();
  await user.type(await holidays.findByLabelText('Date'), DIWALI.date);
  await user.type(holidays.getByLabelText('Name'), 'Diwali again');
  await user.click(holidays.getByRole('button', { name: 'Add holiday' }));
  expect(await holidays.findByText('There is a holiday on this day already')).toBeInTheDocument();
});

test('a missing date or name is asked for before anything is sent', async () => {
  const { api } = openHolidays([]);
  const holidays = await card();
  await userEvent.click(await holidays.findByRole('button', { name: 'Add holiday' }));
  expect(await holidays.findAllByText('Fill this in')).not.toHaveLength(0);
  expect(api.sent('POST', '/api/holidays')).toHaveLength(0);
});

test('Remove asks for an optional reason, says it stays on record, and takes it off the list', async () => {
  const { api } = openHolidays();
  const holidays = await card();
  const user = userEvent.setup();
  await user.click(await holidays.findByRole('button', { name: 'Remove Diwali' }));
  const box = await screen.findByRole('dialog', { name: 'Remove Diwali?' });
  expect(box).toHaveTextContent('It stays on record');
  await user.type(within(box).getByLabelText('Reason (optional)'), 'Wrong date{Enter}');
  expect(await holidays.findByText('Diwali removed.')).toBeInTheDocument();
  expect(api.sent('POST', `/api/holidays/${DIWALI.id}/remove`)[0]?.body).toEqual({
    reason: 'Wrong date',
  });
  await waitFor(() => {
    expect(holidays.queryByRole('button', { name: 'Remove Diwali' })).toBeNull();
  });
});

test('Remove works without a reason', async () => {
  const { api } = openHolidays();
  const holidays = await card();
  await userEvent.click(await holidays.findByRole('button', { name: 'Remove Diwali' }));
  await userEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove holiday' }),
  );
  await waitFor(() => {
    expect(api.sent('POST', `/api/holidays/${DIWALI.id}/remove`)).toHaveLength(1);
  });
  expect(api.sent('POST', `/api/holidays/${DIWALI.id}/remove`)[0]?.body).toEqual({});
});

test('the arrows read another year', async () => {
  const { api } = openHolidays();
  const holidays = await card();
  await holidays.findByText('Diwali');
  await userEvent.click(holidays.getByRole('button', { name: 'Next year' }));
  expect(
    await holidays.findByText(`No holidays in ${String(Number(YEAR) + 1)} yet.`),
  ).toBeInTheDocument();
  expect(api.sent('GET', `/api/holidays?year=${String(Number(YEAR) + 1)}`)).toHaveLength(1);
});

test('the holidays speak Hindi', async () => {
  openHolidays();
  await changeLanguage('hi');
  expect(await screen.findByRole('region', { name: 'दुकान की छुट्टियाँ' })).toBeInTheDocument();
  await changeLanguage('en');
});
