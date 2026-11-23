// The owner's staff routes (P1.5 design §5, Module 00 #15–#17, #33–#35, #47–#53).
import type {
  SalaryRateInput,
  SalaryRateView,
  StaffAddLoginInput,
  StaffDeactivateInput,
  StaffPasswordInput,
  StaffPermissionsInput,
  StaffUpdateInput,
  StaffView,
  NewStaffInput,
} from '@business-software/shared';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './client';

export const STAFF_KEY = ['staff'] as const;

/** The staff list; `includeInactive` adds the logins that were deactivated. */
export const useStaffList = (includeInactive: boolean, enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...STAFF_KEY, { includeInactive }],
    queryFn: () =>
      apiRequest<StaffView[]>('GET', `/api/staff?includeInactive=${String(includeInactive)}`),
    // A 401 or a 403 won't fix itself in a second; the page shows Try again instead.
    retry: false,
  });

export const createStaff = (input: NewStaffInput) =>
  apiRequest<StaffView>('POST', '/api/staff', input);

export const updateStaff = (id: string, input: StaffUpdateInput) =>
  apiRequest<StaffView>('PUT', `/api/staff/${id}`, input);

export const setStaffPermissions = (id: string, input: StaffPermissionsInput) =>
  apiRequest<StaffView>('PUT', `/api/staff/${id}/permissions`, input);

export const resetStaffPassword = (id: string, input: StaffPasswordInput) =>
  apiRequest<null>('POST', `/api/staff/${id}/password`, input);

export const deactivateStaff = (id: string, input: StaffDeactivateInput) =>
  apiRequest<StaffView>('POST', `/api/staff/${id}/deactivate`, input);

export const reactivateStaff = (id: string, ownerPassword: string) =>
  apiRequest<StaffView>('POST', `/api/staff/${id}/reactivate`, { ownerPassword });

/** Gives a record without a login its username and password (`00` #19). */
export const addStaffLogin = (id: string, input: StaffAddLoginInput) =>
  apiRequest<StaffView>('POST', `/api/staff/${id}/login`, input);

/** A person's salary history, newest start first (`05` #3). */
export const useSalaryRates = (id: string) =>
  useQuery({
    queryKey: [...STAFF_KEY, id, 'salary-rates'],
    queryFn: () => apiRequest<SalaryRateView[]>('GET', `/api/staff/${id}/salary-rates`),
    retry: false,
  });

export const addSalaryRate = (id: string, input: SalaryRateInput) =>
  apiRequest<SalaryRateView>('POST', `/api/staff/${id}/salary-rates`, input);
