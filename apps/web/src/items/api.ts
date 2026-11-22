import type {
  CategoryView,
  ItemsContext,
  ItemStockView,
  ItemView,
  MovementPage,
  UnitView,
} from '@business-software/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiRequest } from '../api/client';

export const itemKeys = {
  all: ['items'] as const,
  list: (filters: object) => ['items', 'list', filters] as const,
  one: (id: string) => ['items', 'one', id] as const,
  /** An item's stock and its history (P1.8): refreshed together after every change. */
  stock: (id: string) => ['items', 'stock', id] as const,
  movements: (id: string, branchId: string) =>
    ['items', 'stock', id, 'movements', branchId] as const,
  context: ['items', 'context'] as const,
  categories: ['categories'] as const,
  units: ['units'] as const,
};

// A 401 or a 500 won't fix itself in a second; the page shows Try again instead.
const once = { retry: false } as const;

export const useItemsContext = () =>
  useQuery({
    queryKey: itemKeys.context,
    queryFn: () => apiRequest<ItemsContext>('GET', '/api/items/context'),
    ...once,
  });

export const useCategories = () =>
  useQuery({
    queryKey: itemKeys.categories,
    queryFn: () => apiRequest<CategoryView[]>('GET', '/api/categories'),
    ...once,
  });

export const useUnits = () =>
  useQuery({
    queryKey: itemKeys.units,
    queryFn: () => apiRequest<UnitView[]>('GET', '/api/units'),
    ...once,
  });

export const useItem = (id: string) =>
  useQuery({
    queryKey: itemKeys.one(id),
    queryFn: () => apiRequest<ItemView>('GET', `/api/items/${encodeURIComponent(id)}`),
    ...once,
  });

/**
 * Stock at each branch; off when the caller may not see it. `branch` is the owner's picker
 * (one branch's id, or `all`); without it the API's own default applies.
 */
export const useItemStock = (id: string, enabled: boolean, branch?: string) =>
  useQuery({
    // Under the item's stock key, so a stock change refreshes every view of it.
    queryKey: [...itemKeys.stock(id), 'view', branch ?? 'default'],
    queryFn: () =>
      apiRequest<ItemStockView>(
        'GET',
        `/api/items/${encodeURIComponent(id)}/stock${
          branch === undefined ? '' : `?branch=${encodeURIComponent(branch)}`
        }`,
      ),
    enabled,
    ...once,
  });

/** The history at one branch, newest first, 50 at a time. */
export const useMovements = (id: string, branchId: string) =>
  useInfiniteQuery({
    queryKey: itemKeys.movements(id, branchId),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ branch: branchId });
      if (pageParam) params.set('after', pageParam);
      return apiRequest<MovementPage>(
        'GET',
        `/api/items/${encodeURIComponent(id)}/stock/movements?${params.toString()}`,
      );
    },
    initialPageParam: '',
    getNextPageParam: (page) => page.next ?? undefined,
    ...once,
  });
