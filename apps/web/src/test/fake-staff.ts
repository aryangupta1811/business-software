import {
  effectivePermissions,
  type ItemsContext,
  type Permission,
  type StaffView,
} from '@business-software/shared';
import type { FakeAnswer } from './fake-api';

// Made-up IDs and names, never real ones.
export const BRANCH_ID = '00000000-0000-4000-8000-000000000003';
export const SECOND_BRANCH_ID = '00000000-0000-4000-8000-000000000013';
export const OWNER_PASSWORD = 'made-up-owner-password';

export const CASHIER: StaffView = {
  id: '00000000-0000-4000-8000-0000000000a1',
  name: 'Meena Devi',
  username: 'meena',
  homeBranchId: BRANCH_ID,
  homeBranchName: 'Main shop',
  active: true,
  permissions: effectivePermissions({ added: [], removed: [] }),
  discountLimitBasisPoints: null,
  extraBranchIds: [],
};

export const FORMER: StaffView = {
  ...CASHIER,
  id: '00000000-0000-4000-8000-0000000000a2',
  name: 'Suresh Kumar',
  username: 'suresh',
  active: false,
};

/** What `GET /api/items/context` answers the owner: the screens read the branch list from it. */
export function itemsContext(branches = [{ id: BRANCH_ID, name: 'Main shop' }]): ItemsContext {
  return {
    canViewCost: true,
    canManage: true,
    canViewStock: true,
    canAdjustStock: true,
    branchId: BRANCH_ID,
    needsGst: false,
    features: [],
    branches,
  };
}

const wrongPassword = (): FakeAnswer => ({ status: 401, body: { code: 'wrong_password' } });

/**
 * The staff routes of the API, over a list the test can read: a right owner's password
 * (`OWNER_PASSWORD`) changes the list as the real routes would, a wrong one answers 401.
 */
export function staffRoutes(
  initial: StaffView[],
  branches = [{ id: BRANCH_ID, name: 'Main shop' }],
) {
  const state = { staff: [...initial] };
  const change = (id: string, patch: Partial<StaffView>): StaffView | undefined => {
    const index = state.staff.findIndex((person) => person.id === id);
    const current = state.staff[index];
    if (current === undefined) return undefined;
    const next = { ...current, ...patch };
    state.staff[index] = next;
    return next;
  };
  const owner = (body: unknown) => (body as { ownerPassword?: string }).ownerPassword;

  const routes: Record<string, FakeAnswer | ((body: unknown, url: string) => FakeAnswer)> = {
    'GET /api/items/context': { body: itemsContext(branches) },
    'GET /api/staff': (_body, url) => ({
      body: state.staff.filter((person) => person.active || url.includes('includeInactive=true')),
    }),
    'POST /api/staff': (body) => {
      if (owner(body) !== OWNER_PASSWORD) return wrongPassword();
      const input = body as {
        name: string;
        username: string;
        homeBranchId: string;
        permissions?: Permission[];
        discountLimitBasisPoints?: number | null;
      };
      const person: StaffView = {
        id: '00000000-0000-4000-8000-0000000000a9',
        name: input.name,
        username: input.username,
        homeBranchId: input.homeBranchId,
        homeBranchName: 'Main shop',
        active: true,
        permissions: input.permissions ?? CASHIER.permissions,
        discountLimitBasisPoints: input.discountLimitBasisPoints ?? null,
        extraBranchIds: [],
      };
      state.staff.push(person);
      return { status: 201, body: person };
    },
  };
  for (const person of initial) {
    const base = `/api/staff/${person.id}`;
    routes[`PUT ${base}`] = (body) => ({ body: change(person.id, body as Partial<StaffView>) });
    routes[`PUT ${base}/permissions`] = (body) => {
      if (owner(body) !== OWNER_PASSWORD) return wrongPassword();
      const input = body as { permissions: Permission[]; discountLimitBasisPoints: number | null };
      return {
        body: change(person.id, {
          permissions: ['session.own', ...input.permissions] as Permission[],
          ...(input.discountLimitBasisPoints !== null && {
            discountLimitBasisPoints: input.discountLimitBasisPoints,
          }),
        }),
      };
    };
    routes[`POST ${base}/password`] = (body) =>
      owner(body) === OWNER_PASSWORD ? { status: 204 } : wrongPassword();
    routes[`POST ${base}/deactivate`] = () => ({ body: change(person.id, { active: false }) });
    routes[`POST ${base}/reactivate`] = (body) =>
      owner(body) === OWNER_PASSWORD
        ? { body: change(person.id, { active: true }) }
        : wrongPassword();
  }
  return { routes, state };
}
