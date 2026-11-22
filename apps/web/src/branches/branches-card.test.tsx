// Settings → Branches (P1.6 design §8, Module 00 #54–#60).
import type { SettingsView } from '@business-software/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { changeLanguage } from '../i18n';
import {
  branchRoutes,
  HEAD_OFFICE,
  MAIN,
  SECOND_BRANCH,
  STALL,
  TWO_BRANCHES,
} from '../test/fake-branches';
import { fakeApi, OWNER_SESSION, renderAt } from '../test/fake-api';
import { OWNER_PASSWORD } from '../test/fake-staff';

afterEach(() => {
  vi.unstubAllGlobals();
});

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
};

function openBranches(initial = TWO_BRANCHES, gstStatus: 'regular' | 'unregistered' = 'regular') {
  const branches = branchRoutes(initial);
  const api = fakeApi(OWNER_SESSION, {
    'GET /api/settings': { body: { ...SETTINGS, business: { ...SETTINGS.business, gstStatus } } },
    'GET /api/devices': { body: [] },
    ...branches.routes,
  });
  renderAt('/settings');
  return { api, ...branches };
}

const card = async () => within(await screen.findByRole('region', { name: 'Branches' }));
const ownerBox = () => within(screen.getByRole('dialog')).getByLabelText("Owner's password");

test('a business with one branch sees one "Add a branch" button and no list', async () => {
  openBranches([HEAD_OFFICE]);
  const branches = await card();
  expect(await branches.findByRole('button', { name: 'Add a branch' })).toBeInTheDocument();
  expect(branches.getByText(/has one shop/)).toBeInTheDocument();
  expect(branches.queryByRole('list')).toBeNull();
});

test('lists the branches with their code, head office, computers and staff', async () => {
  openBranches();
  const branches = await card();
  const main = (await branches.findByText(MAIN.name)).closest('li');
  expect(main).not.toBeNull();
  expect(within(main as HTMLElement).getByText('HO')).toBeInTheDocument();
  expect(within(main as HTMLElement).getByText('Head office')).toBeInTheDocument();
  expect(within(main as HTMLElement).getByText('Computers: 2 · Staff: 0')).toBeInTheDocument();
  // The head office can be edited but never archived.
  expect(branches.getByRole('button', { name: `Edit ${MAIN.name}` })).toBeInTheDocument();
  expect(branches.queryByRole('button', { name: `Archive ${MAIN.name}` })).toBeNull();
  expect(branches.getByRole('button', { name: `Archive ${STALL.name}` })).toBeInTheDocument();
});

test('adding a branch starts from the head office state and GSTIN, and sends the form', async () => {
  const { api } = openBranches([HEAD_OFFICE]);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Add a branch' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Add a branch' }));
  expect(dialog.getByLabelText('State')).toHaveValue('27');
  expect(dialog.getByLabelText('GSTIN')).toHaveValue('27ABCDE1234F1Z0');
  await user.type(dialog.getByLabelText('Branch name'), 'Thane shop');
  await user.type(dialog.getByLabelText('Short code'), 'thn');
  await user.click(dialog.getByRole('button', { name: 'Add branch' }));

  await waitFor(() => {
    expect(api.sent('POST', '/api/branches')).toHaveLength(1);
  });
  expect(api.sent('POST', '/api/branches')[0]?.body).toMatchObject({
    name: 'Thane shop',
    code: 'THN',
    stateCode: '27',
    gstin: '27ABCDE1234F1Z0',
    address: null,
  });
  expect(await (await card()).findByRole('status')).toHaveTextContent('Thane shop added.');
  // The second branch turns the one-button card into a list.
  expect(await screen.findByText('Thane shop')).toBeInTheDocument();
});

test('a code another branch already uses shows under the code box', async () => {
  openBranches([HEAD_OFFICE]);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Add a branch' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Add a branch' }));
  await user.type(dialog.getByLabelText('Branch name'), 'Thane shop');
  await user.type(dialog.getByLabelText('Short code'), 'HO');
  await user.click(dialog.getByRole('button', { name: 'Add branch' }));
  expect(await dialog.findByText('Another branch already uses this code')).toBeInTheDocument();
});

test('an unregistered business has no GSTIN box on the branch form', async () => {
  openBranches([HEAD_OFFICE], 'unregistered');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Add a branch' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Add a branch' }));
  expect(dialog.queryByLabelText('GSTIN')).toBeNull();
});

test('editing a branch saves the whole form', async () => {
  const { api } = openBranches();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: `Edit ${STALL.name}` }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Edit branch' }));
  await user.clear(dialog.getByLabelText('Branch name'));
  await user.type(dialog.getByLabelText('Branch name'), 'Market stall 2');
  await user.click(dialog.getByRole('button', { name: 'Save' }));
  await waitFor(() => {
    expect(api.sent('PUT', `/api/branches/${STALL.id}`)).toHaveLength(1);
  });
  expect(api.sent('PUT', `/api/branches/${STALL.id}`)[0]?.body).toMatchObject({
    name: 'Market stall 2',
    code: 'MKT',
  });
});

test("archiving asks for the owner's password, then moves the branch behind Show archived", async () => {
  const { api } = openBranches();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: `Archive ${STALL.name}` }));
  await screen.findByRole('dialog', { name: `Archive ${STALL.name}?` });
  await user.type(ownerBox(), `${OWNER_PASSWORD}{Enter}`);
  await waitFor(() => {
    expect(api.sent('POST', `/api/branches/${STALL.id}/archive`)).toHaveLength(1);
  });
  expect(api.sent('POST', `/api/branches/${STALL.id}/archive`)[0]?.body).toEqual({
    ownerPassword: OWNER_PASSWORD,
  });
  expect(await (await card()).findByRole('status')).toHaveTextContent('Market stall archived.');
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: `Archive ${STALL.name}` })).toBeNull();
  });
  // Archived, not deleted: it comes back under "Show archived", with a way to bring it back.
  await user.click(screen.getByRole('checkbox', { name: 'Show archived' }));
  await user.click(await screen.findByRole('button', { name: `Bring back ${STALL.name}` }));
  await waitFor(() => {
    expect(api.sent('POST', `/api/branches/${STALL.id}/restore`)).toHaveLength(1);
  });
  expect(await screen.findByRole('button', { name: `Archive ${STALL.name}` })).toBeInTheDocument();
});

test('a branch that staff still call home says so, in the dialog, and stays', async () => {
  const withStaff = [HEAD_OFFICE, { ...SECOND_BRANCH, staff: 2 }];
  openBranches(withStaff);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: `Archive ${STALL.name}` }));
  await screen.findByRole('dialog', { name: `Archive ${STALL.name}?` });
  await user.type(ownerBox(), `${OWNER_PASSWORD}{Enter}`);
  const dialog = within(screen.getByRole('dialog'));
  expect(await dialog.findByRole('alert')).toHaveTextContent(
    '2 staff logins have this as their home branch. Move them to another branch first.',
  );
  expect(screen.getByRole('dialog', { name: `Archive ${STALL.name}?` })).toBeInTheDocument();
});

test('a wrong owner password in the archive dialog archives nothing', async () => {
  openBranches();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: `Archive ${STALL.name}` }));
  await screen.findByRole('dialog', { name: `Archive ${STALL.name}?` });
  await user.type(ownerBox(), 'not the password{Enter}');
  expect(await screen.findByText("That isn't the owner's password")).toBeInTheDocument();
  expect((await card()).queryByRole('status')).toBeNull();
});

test('the branches card speaks Hindi and Hinglish', async () => {
  openBranches();
  await changeLanguage('hi');
  expect(await screen.findByRole('region', { name: 'ब्रांच' })).toBeInTheDocument();
  await changeLanguage('hi-Latn');
  expect(await screen.findByRole('region', { name: 'Branch' })).toBeInTheDocument();
});
