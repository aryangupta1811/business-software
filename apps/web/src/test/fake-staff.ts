import {
  effectivePermissions,
  type BranchView,
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
  phone: null,
  joiningDate: '2026-01-01',
  weeklyOffDay: null,
  paidLeavesPerMonth: 0,
  overtimeRatePaise: null,
  salary: null,
  version: 1,
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

/** What `GET /api/items/context` answers the owner. */
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

/** A branch as `GET /api/branches` answers it; the first one is the head office. */
export function branchView(
  branch: { id: string; name: string },
  index = 0,
  patch: Partial<BranchView> = {},
): BranchView {
  return {
    id: branch.id,
    code: index === 0 ? 'HO' : `B${String(index)}`,
    name: branch.name,
    address: null,
    pinCode: null,
    stateCode: '27',
    gstin: null,
    drugLicence: null,
    fssai: null,
    headOffice: index === 0,
    archived: false,
    computers: 1,
    staff: 0,
    ...patch,
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
    'GET /api/branches': { body: branches.map((branch, index) => branchView(branch, index)) },
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
        phone: null,
        joiningDate: '2026-11-19',
        weeklyOffDay: null,
        paidLeavesPerMonth: 0,
        overtimeRatePaise: null,
        salary: null,
        version: 1,
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
    routes[`PUT ${base}/branches`] = (body) => {
      if (owner(body) !== OWNER_PASSWORD) return wrongPassword();
      return {
        body: change(person.id, { extraBranchIds: (body as { branchIds: string[] }).branchIds }),
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
