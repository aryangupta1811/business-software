// The attendance routes (P2.3 design §5; Module 05 #5–#9, #31): the register, a person's month
// and the shop holidays.
import type {
  AttendanceMarkInput,
  HolidayInput,
  HolidayView,
  MonthView,
  RegisterRow,
  RegisterView,
  RemoveHolidayInput,
} from '@business-software/shared';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './client';

export const ATTENDANCE_KEY = ['attendance'] as const;
export const HOLIDAYS_KEY = ['holidays'] as const;

export const registerKey = (date: string, branch: string | undefined) =>
  [...ATTENDANCE_KEY, 'register', date, branch ?? null] as const;

/** The register for a day at a branch (the owner's picker chooses it; others get their own). */
export const useRegister = (date: string, branch: string | undefined, enabled = true) =>
  useQuery({
    queryKey: registerKey(date, branch),
    queryFn: () => {
      const params = new URLSearchParams({ date });
      if (branch !== undefined) params.set('branch', branch);
      return apiRequest<RegisterView>('GET', `/api/attendance?${params.toString()}`);
    },
    enabled,
    // A 403 won't fix itself in a second; the page shows Try again instead.
    retry: false,
  });

export const markAttendance = (userId: string, date: string, input: AttendanceMarkInput) =>
  apiRequest<RegisterRow>('PUT', `/api/attendance/${userId}/${date}`, input);

/** One person's month; `userId` null waits until it is known. */
export const useMonth = (userId: string | null, month: string) =>
  useQuery({
    queryKey: [...ATTENDANCE_KEY, 'month', userId, month],
    queryFn: () =>
      apiRequest<MonthView>('GET', `/api/attendance/month?userId=${userId ?? ''}&month=${month}`),
    enabled: userId !== null,
    retry: false,
  });

export const useHolidays = (year: string) =>
  useQuery({
    queryKey: [...HOLIDAYS_KEY, year],
    queryFn: () => apiRequest<HolidayView[]>('GET', `/api/holidays?year=${year}`),
    retry: false,
  });

export const addHoliday = (input: HolidayInput) =>
  apiRequest<HolidayView>('POST', '/api/holidays', input);

export const removeHoliday = (id: string, input: RemoveHolidayInput) =>
  apiRequest<HolidayView>('POST', `/api/holidays/${id}/remove`, input);
