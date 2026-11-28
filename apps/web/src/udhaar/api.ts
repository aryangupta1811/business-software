// The udhaar routes (P1.18 design §6), as queries and the three owner-or-counter writes.
import type {
  CustomerView,
  UdhaarCustomersView,
  UdhaarLedgerView,
  UdhaarMoveView,
} from '@business-software/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiRequest } from '../api/client';
import type { Standing } from './standing';

/** Everything udhaar caches lives under this key, so one call refreshes it all after a change. */
export const UDHAAR_KEY = ['udhaar'] as const;

export const udhaarKeys = {
  customers: (filters: object) => [...UDHAAR_KEY, 'customers', filters] as const,
  ledger: (id: string) => [...UDHAAR_KEY, 'ledger', id] as const,
  standing: (id: string) => [...UDHAAR_KEY, 'standing', id] as const,
};

// A 401 or a 403 won't fix itself in a second; the page shows Try again instead.
const once = { retry: false } as const;

/** The customer list, a page at a time: `offset` is how many rows came before. */
export const useUdhaarCustomers = (filters: { q: string; owing: boolean }) =>
  useInfiniteQuery({
    queryKey: udhaarKeys.customers(filters),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (filters.q) params.set('q', filters.q);
      if (filters.owing) params.set('owing', 'true');
      if (pageParam > 0) params.set('offset', String(pageParam));
      const query = params.toString();
      return apiRequest<UdhaarCustomersView>(
        'GET',
        `/api/udhaar/customers${query ? `?${query}` : ''}`,
      );
    },
    initialPageParam: 0,
    getNextPageParam: (page, pages) =>
      page.more ? pages.reduce((count, one) => count + one.customers.length, 0) : undefined,
    ...once,
  });

/** One customer's ledger, newest first, a page at a time. The first page carries the rest. */
export const useLedger = (id: string) =>
  useInfiniteQuery({
    queryKey: udhaarKeys.ledger(id),
    queryFn: ({ pageParam }) =>
      apiRequest<UdhaarLedgerView>(
        'GET',
        `/api/udhaar/customers/${encodeURIComponent(id)}${
          pageParam ? `?before=${encodeURIComponent(pageParam)}` : ''
        }`,
      ),
    initialPageParam: '',
    getNextPageParam: (page) => page.next ?? undefined,
    ...once,
  });

/**
 * The balance and limit of the customer on the bill, for the counter. Off without a customer
 * or without `customers.view` (the answer would be a 403).
 */
export const useStanding = (customerId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: udhaarKeys.standing(customerId ?? ''),
    queryFn: async (): Promise<Standing> => {
      const view = await apiRequest<UdhaarLedgerView>(
        'GET',
        `/api/udhaar/customers/${encodeURIComponent(customerId ?? '')}`,
      );
      return { balancePaise: view.balancePaise, creditLimitPaise: view.creditLimitPaise };
    },
    enabled: enabled && customerId !== null,
    // The balance changes at the other counter too: read it fresh each time a bill needs it.
    staleTime: 0,
    ...once,
  });

export const recordPayment = (body: {
  requestKey: string;
  customerId: string;
  amountPaise: number;
  mode: 'cash' | 'upi' | 'card' | 'cheque';
  reference?: string;
}) => apiRequest<UdhaarMoveView>('POST', '/api/udhaar/payments', body);

export const reversePayment = (id: string, body: { reason: string; ownerPassword: string }) =>
  apiRequest<UdhaarMoveView>(
    'POST',
    `/api/udhaar/payments/${encodeURIComponent(id)}/reverse`,
    body,
  );

export const setOpeningBalance = (body: {
  requestKey: string;
  customerId: string;
  amountPaise: number;
  asOf: string;
  reason: string;
}) => apiRequest<UdhaarMoveView>('POST', '/api/udhaar/opening', body);

export const updateCustomer = (id: string, body: Omit<CustomerView, 'id'>) =>
  apiRequest<CustomerView>('PUT', `/api/customers/${encodeURIComponent(id)}`, body);
