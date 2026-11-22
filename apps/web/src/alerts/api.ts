import type { AlertList } from '@business-software/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/client';

export const ALERTS_KEY = ['alerts'] as const;

/** The bell's count refreshes every minute and when the window gets focus (design §7). */
export const ALERTS_EVERY_MS = 60_000;

/**
 * What this person hasn't dismissed. Quiet on failure: a bell that can't be read shows nothing,
 * never an error over the work (the connection badge already says the server is down).
 */
export function useAlerts() {
  return useQuery({
    queryKey: ALERTS_KEY,
    queryFn: () => apiRequest<AlertList>('GET', '/api/alerts'),
    refetchInterval: ALERTS_EVERY_MS,
    refetchOnWindowFocus: 'always',
    retry: false,
  });
}

/** Hides one alert for this person; the list is read again so the count drops at once. */
export function useDismissAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<undefined>('POST', `/api/alerts/${id}/dismiss`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ALERTS_KEY }),
  });
}
