// What the top bar, the lock screen and the idle timer do to the session (Module 00 #21, #29,
// #38). Each one updates the screen first, so a slow or broken connection never leaves the
// counter open.
import type { ActiveSession } from '@business-software/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { forgetSession, lockSession, logout, SESSION_KEY } from './session';

export function useSessionActions() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const setState = (state: ActiveSession['state']) => {
    queryClient.setQueryData<ActiveSession>(SESSION_KEY, (view) =>
      view === undefined ? view : { ...view, state },
    );
  };

  return {
    /** #38: covers the screen now; the server is told after. */
    lock: async () => {
      setState('locked');
      await lockSession().catch(() => undefined);
    },
    /** After the server accepted the password. */
    unlocked: () => {
      setState('active');
    },
    /** Logs out (or "Switch user"): even if the server can't be reached, this tab forgets. */
    logout: async () => {
      await logout().catch(() => undefined);
      forgetSession(queryClient);
      await navigate({ to: '/login' });
    },
  };
}
