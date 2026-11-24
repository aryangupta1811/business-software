import type { BillListPage } from '@business-software/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiRequest } from '../api/client';

export interface BillFilters {
  q: string;
  from: string;
  to: string;
  /** The owner's branch picker: one branch's id or `all`; undefined without a choice. */
  branch: string | undefined;
}

/** The Bills page's list, a page at a time (`GET /api/bills?after=` is the cursor). */
export function useBills(filters: BillFilters) {
  return useInfiniteQuery({
    queryKey: ['bills', filters],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (filters.q.trim() !== '') params.set('q', filters.q.trim());
      if (filters.from !== '') params.set('from', filters.from);
      if (filters.to !== '') params.set('to', filters.to);
      if (filters.branch !== undefined) params.set('branch', filters.branch);
      if (pageParam !== '') params.set('after', pageParam);
      const query = params.toString();
      return apiRequest<BillListPage>('GET', `/api/bills${query === '' ? '' : `?${query}`}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.next ?? undefined,
    // A 401 or a 500 won't fix itself in a second; the page shows Try again instead.
    retry: false,
  });
}
