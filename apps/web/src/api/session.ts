// The logged-in session (Module 00 #21, #27–#29, #37–#40): read once per page load, then kept
// in TanStack Query. Every answer that carries the CSRF token hands it to the API client.
import type { ActiveSession, SessionView } from '@business-software/shared';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiRequest, onAuthError, setCsrfToken } from './client';

export const SESSION_KEY = ['session'];

function remember(view: SessionView): SessionView {
  setCsrfToken(view.state === 'none' ? null : view.csrfToken);
  return view;
}

export async function fetchSession(): Promise<SessionView> {
  return remember(await apiRequest<SessionView>('GET', '/api/session'));
}

/** Who is logged in here. Re-read whenever the API says the session is locked or gone. */
export function useSession() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      onAuthError(() => {
        void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      }),
    [queryClient],
  );
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: fetchSession,
    // The server applies the lock and idle rules; a stale view is re-read on any 401.
    staleTime: Infinity,
    retry: false,
  });
}

/** After a login answered with the new session. Nothing the last user loaded stays cached. */
export function setSession(queryClient: QueryClient, view: SessionView): void {
  queryClient.clear();
  queryClient.setQueryData(SESSION_KEY, remember(view));
}

/** After a logout: forget the token and everything loaded, then read the session again. */
export function forgetSession(queryClient: QueryClient): void {
  setCsrfToken(null);
  queryClient.clear();
}

export function loginOwner(email: string, password: string) {
  return apiRequest<ActiveSession>('POST', '/api/login', { email, password });
}

export function loginStaff(username: string, password: string) {
  return apiRequest<ActiveSession>('POST', '/api/login/staff', { username, password });
}

export function lockSession() {
  return apiRequest<null>('POST', '/api/session/lock');
}

export function unlockSession(password: string) {
  return apiRequest<null>('POST', '/api/session/unlock', { password });
}

export function logout() {
  return apiRequest<null>('POST', '/api/logout');
}

/** "Someone is still at the counter", so the server's idle clock follows the person. */
export function markActive() {
  return apiRequest<null>('POST', '/api/session/active');
}
