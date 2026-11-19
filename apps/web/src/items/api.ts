import type { CategoryView, ItemsContext, ItemView, UnitView } from '@business-software/shared';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../api/client';

export const itemKeys = {
  all: ['items'] as const,
  list: (filters: object) => ['items', 'list', filters] as const,
  one: (id: string) => ['items', 'one', id] as const,
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
