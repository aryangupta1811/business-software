// The owner's branch routes (P1.6 design §7, Module 00 #12–#14, #35, #54–#60).
import type {
  BranchInput,
  BranchRef,
  BranchView,
  DeviceView,
  StaffView,
} from '@business-software/shared';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './client';

export const BRANCHES_KEY = ['branches'] as const;

/** Every branch, archived ones too: the screens filter, so one read serves them all. */
export const useBranches = () =>
  useQuery({
    queryKey: [...BRANCHES_KEY, 'all'],
    queryFn: () => apiRequest<BranchView[]>('GET', '/api/branches?includeArchived=true'),
    // A 401 or a 403 won't fix itself in a second; the page shows Try again instead.
    retry: false,
  });

/** The live branches only, which is what a picker or a "home branch" box offers. */
export const liveBranches = (all: readonly BranchView[]): BranchView[] =>
  all.filter((branch) => !branch.archived);

export const createBranch = (input: BranchInput) =>
  apiRequest<BranchView>('POST', '/api/branches', input);

export const updateBranch = (id: string, input: BranchInput) =>
  apiRequest<BranchView>('PUT', `/api/branches/${id}`, input);

export const archiveBranch = (id: string, ownerPassword: string) =>
  apiRequest<BranchView>('POST', `/api/branches/${id}/archive`, { ownerPassword });

export const restoreBranch = (id: string) =>
  apiRequest<BranchView>('POST', `/api/branches/${id}/restore`);

/** The owner's picker: the active branches. */
export const usePickerBranches = (enabled: boolean) =>
  useQuery({
    queryKey: [...BRANCHES_KEY, 'picker'],
    queryFn: () => apiRequest<BranchRef[]>('GET', '/api/branches/picker'),
    enabled,
    retry: false,
  });

export const moveDevice = (id: string, branchId: string, ownerPassword: string) =>
  apiRequest<DeviceView>('PUT', `/api/devices/${id}/branch`, { branchId, ownerPassword });

export const setStaffBranches = (id: string, branchIds: string[], ownerPassword: string) =>
  apiRequest<StaffView>('PUT', `/api/staff/${id}/branches`, { branchIds, ownerPassword });
