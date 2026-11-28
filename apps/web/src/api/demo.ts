// The public demo's two buttons (ADR 0016's 2026-11-24 note, decision D5).
import type { ActiveSession, DemoStatus } from '@business-software/shared';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './client';

/** Whether this server is the demo and has a demo shop; the login page shows the buttons if so. */
export function useDemoStatus() {
  return useQuery({
    queryKey: ['demo-status'],
    queryFn: () => apiRequest<DemoStatus>('GET', '/api/demo'),
    staleTime: 60_000,
    retry: false,
  });
}

/** "Try as the owner" or "Try as a cashier": a session in the newest demo shop, no password. */
export function loginDemo(as: 'owner' | 'cashier') {
  return apiRequest<ActiveSession>('POST', '/api/demo/login', { as });
}
