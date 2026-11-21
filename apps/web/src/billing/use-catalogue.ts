import type { BillingContext, CatalogueView } from '@business-software/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api/client';
import { CatalogueCopy, syncSince } from './catalogue-copy';

/** A sync for changes every minute; a whole new copy every 30 minutes heals anything missed. */
export const SYNC_EVERY_MS = 60_000;
export const FULL_EVERY_MS = 30 * 60_000;

export const billingKeys = { context: ['billing', 'context'] as const };

export const useBillingContext = () =>
  useQuery({
    queryKey: billingKeys.context,
    queryFn: () => apiRequest<BillingContext>('GET', '/api/billing/context'),
    retry: false,
  });

export interface CatalogueState {
  copy: CatalogueCopy;
  /** Goes up whenever the copy changed, so the screen draws again. */
  version: number;
  status: 'loading' | 'ready' | 'error';
  /** Loads it all again (Try again, and after the save says prices changed). */
  reload: () => Promise<void>;
}

/**
 * The counter's catalogue copy and its sync (design §4, ADR 0043): loaded when the page opens,
 * then changes every 60 s and when the tab comes back into view. One request at a time, so each
 * answer is newer than the one before. A failed sync keeps the copy; the save re-prices anyway.
 */
export function useCatalogue(): CatalogueState {
  const [copy] = useState(() => new CatalogueCopy());
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<CatalogueState['status']>('loading');
  const running = useRef<Promise<void> | null>(null);
  const lastFull = useRef(0);

  const load = useCallback(
    (wantFull: boolean): Promise<void> => {
      if (running.current !== null) return running.current;
      const full = wantFull || copy.serverTime === null;
      const query =
        copy.serverTime === null || full
          ? ''
          : `?since=${encodeURIComponent(syncSince(copy.serverTime))}`;
      running.current = apiRequest<CatalogueView>('GET', `/api/billing/catalogue${query}`)
        .then(
          (view) => {
            copy.apply(view, full);
            if (full) lastFull.current = Date.now();
            if (full || view.items.length > 0 || (view.stock?.length ?? 0) > 0) {
              setVersion((value) => value + 1);
            }
            setStatus('ready');
          },
          () => {
            if (copy.serverTime === null) setStatus('error');
          },
        )
        .finally(() => {
          running.current = null;
        });
      return running.current;
    },
    [copy],
  );

  useEffect(() => {
    void load(true);
    const timer = setInterval(() => {
      void load(Date.now() - lastFull.current >= FULL_EVERY_MS);
    }, SYNC_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const reload = useCallback(() => {
    setStatus((current) => (current === 'error' ? 'loading' : current));
    return load(true);
  }, [load]);

  return { copy, version, status, reload };
}
