import type { BranchInput, BranchView } from '@business-software/shared';
import type { FakeAnswer } from './fake-api';
import { branchView, OWNER_PASSWORD } from './fake-staff';

export const MAIN = { id: '00000000-0000-4000-8000-000000000003', name: 'Main shop' };
export const STALL = { id: '00000000-0000-4000-8000-000000000013', name: 'Market stall' };

export const HEAD_OFFICE = branchView(MAIN, 0, {
  gstin: '27ABCDE1234F1Z0',
  stateCode: '27',
  computers: 2,
});
export const SECOND_BRANCH = branchView(STALL, 1, { code: 'MKT' });

/** The head office and a second branch, as `GET /api/branches` lists them. */
export const TWO_BRANCHES: BranchView[] = [HEAD_OFFICE, SECOND_BRANCH];

const wrongPassword = (): FakeAnswer => ({ status: 401, body: { code: 'wrong_password' } });

/**
 * The branch routes of the API over a list the test can read: a right owner's password
 * (`OWNER_PASSWORD`) changes it as the real routes do, a wrong one answers 401.
 */
export function branchRoutes(initial: BranchView[] = TWO_BRANCHES) {
  const state = { branches: [...initial] };
  const owner = (body: unknown) => (body as { ownerPassword?: string }).ownerPassword;
  const change = (id: string, patch: Partial<BranchView>) => {
    const index = state.branches.findIndex((branch) => branch.id === id);
    const current = state.branches[index];
    if (current === undefined) return undefined;
    const next = { ...current, ...patch };
    state.branches[index] = next;
    return next;
  };

  const routes: Record<string, FakeAnswer | ((body: unknown, url: string) => FakeAnswer)> = {
    'GET /api/branches': (_body, url) => ({
      body: state.branches.filter(
        (branch) => !branch.archived || url.includes('includeArchived=true'),
      ),
    }),
    'POST /api/branches': (body) => {
      const input = body as BranchInput;
      if (state.branches.some((branch) => branch.code === input.code)) {
        return { status: 409, body: { code: 'code_taken' } };
      }
      const created = {
        ...branchView(
          {
            id: `00000000-0000-4000-8000-0000000000b${String(state.branches.length)}`,
            name: input.name,
          },
          state.branches.length,
        ),
        ...input,
        computers: 0,
      } as BranchView;
      state.branches.push(created);
      return { status: 201, body: created };
    },
  };
  for (const branch of initial) {
    const base = `/api/branches/${branch.id}`;
    routes[`PUT ${base}`] = (body) => ({ body: change(branch.id, body as Partial<BranchView>) });
    routes[`POST ${base}/archive`] = (body) => {
      if (owner(body) !== OWNER_PASSWORD) return wrongPassword();
      const current = state.branches.find((row) => row.id === branch.id);
      if (current !== undefined && current.staff > 0) {
        return { status: 409, body: { code: 'branch_in_use', staff: current.staff } };
      }
      return { body: change(branch.id, { archived: true }) };
    };
    routes[`POST ${base}/restore`] = () => ({ body: change(branch.id, { archived: false }) });
  }
  return { routes, state };
}
