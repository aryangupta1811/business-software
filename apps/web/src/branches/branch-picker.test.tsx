// The owner's branch picker and the branch name in the sidebar (P1.6 design §8, ADR 0045).
import type { ActiveSession, ItemPage } from '@business-software/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { fakeApi, OWNER_SESSION, renderAt, STAFF_SESSION } from '../test/fake-api';
import { MAIN, STALL } from '../test/fake-branches';
import { itemsContext } from '../test/fake-staff';

afterEach(() => {
  vi.unstubAllGlobals();
});

const EMPTY: ItemPage = { items: [], next: null };

const withBranches = (session: ActiveSession, count: number): ActiveSession => ({
  ...session,
  branchCount: count,
});

/** The Items page, which reads branch data, with the picker's list answering as the API does. */
function openItems(session: ActiveSession) {
  const api = fakeApi(session, {
    'GET /api/items/context': { body: itemsContext() },
    'GET /api/categories': { body: [] },
    'GET /api/items': { body: EMPTY },
    'GET /api/branches/picker': {
      body: [
        { id: MAIN.id, code: 'HO', name: MAIN.name },
        { id: STALL.id, code: 'MKT', name: STALL.name },
      ],
    },
  });
  renderAt('/items');
  return api;
}

const picker = () => screen.findByRole('combobox', { name: 'Branch shown' });
const itemRequests = (api: ReturnType<typeof fakeApi>) =>
  api.fetchMock.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/api/items?'));

test('the picker is hidden while the business has one branch', async () => {
  openItems(withBranches(OWNER_SESSION, 1));
  await screen.findByRole('heading', { level: 1, name: 'Items' });
  expect(screen.queryByRole('combobox', { name: 'Branch shown' })).toBeNull();
  // And nothing in the sidebar about branches either.
  expect(screen.queryByText('Sharma Medical')).toBeNull();
});

test('staff never get the picker, whatever the branch count', async () => {
  openItems(withBranches(STAFF_SESSION, 2));
  await screen.findByRole('heading', { level: 1, name: 'Items' });
  expect(screen.queryByRole('combobox', { name: 'Branch shown' })).toBeNull();
});

test('with two branches the picker lists them, marks this counter, and adds All branches', async () => {
  openItems(withBranches(OWNER_SESSION, 2));
  const choices = await picker();
  expect(
    within(choices)
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual([`${MAIN.name} (this counter)`, STALL.name, 'All branches']);
  // It starts at this counter's branch.
  expect(choices).toHaveValue(OWNER_SESSION.branch.id);
});

test('choosing a branch changes what the Items page asks for, and is remembered', async () => {
  const api = openItems(withBranches(OWNER_SESSION, 2));
  const user = userEvent.setup();
  await user.selectOptions(await picker(), STALL.name);
  await waitFor(() => {
    expect(itemRequests(api)).toContain(`/api/items?branch=${STALL.id}`);
  });
  await user.selectOptions(await picker(), 'All branches');
  await waitFor(() => {
    expect(itemRequests(api)).toContain('/api/items?branch=all');
  });
  expect(sessionStorage.length).toBe(1);
});

test('a remembered choice that was archived since falls back to this counter', async () => {
  sessionStorage.setItem('business-software.branch-scope', '00000000-0000-4000-8000-0000000000ff');
  openItems(withBranches(OWNER_SESSION, 2));
  await waitFor(async () => {
    expect(await picker()).toHaveValue(OWNER_SESSION.branch.id);
  });
});

test('the picker only shows on pages that read branch data', async () => {
  fakeApi(withBranches(OWNER_SESSION, 2), {
    'GET /api/branches/picker': { body: [] },
  });
  renderAt('/account');
  await screen.findByRole('heading', { level: 1 });
  expect(screen.queryByRole('combobox', { name: 'Branch shown' })).toBeNull();
});

test('the sidebar names the branch beside the business once there are two', async () => {
  openItems(withBranches(OWNER_SESSION, 2));
  await screen.findByRole('heading', { level: 1, name: 'Items' });
  const aside = within(screen.getByRole('complementary'));
  expect(aside.getByText('Sharma Medical')).toBeInTheDocument();
  expect(aside.getAllByText(MAIN.name).length).toBeGreaterThan(0);
});
