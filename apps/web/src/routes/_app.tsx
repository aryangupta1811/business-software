import type { ActiveSession } from '@business-software/shared';
import { createFileRoute, Navigate, Outlet, useMatches } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ApiError } from '../api/client';
import { markActive, useSession } from '../api/session';
import { useSessionActions } from '../api/session-actions';
import { AppShell } from '../components/app-shell';
import { LockScreen } from '../components/lock-screen';
import { NotAllowed } from '../components/not-allowed';
import { Connecting, ServerUnreachable } from '../components/server-status';
import { useIdle } from '../lib/use-idle';

/** Pages for a logged-in business: the sidebar and the top bar around each one. */
export const Route = createFileRoute('/_app')({ component: AppLayout });

/**
 * Sends a computer with no session to the login page and covers a locked one. The server
 * enforces both; this only keeps the screen in step. While the session is being read the
 * screen says it is connecting; if the server doesn't answer, it says so with a Try again button.
 * Any other failure shows the page anyway: its own requests will say what's wrong.
 */
function AppLayout() {
  const session = useSession();
  if (session.isPending) return <Connecting />;
  if (session.isError && session.data === undefined && isUnreachable(session.error)) {
    return <ServerUnreachable onRetry={() => void session.refetch()} />;
  }
  if (session.data?.state === 'none') return <Navigate to="/login" replace />;
  const active =
    session.data?.state === 'active' || session.data?.state === 'locked' ? session.data : null;
  return active === null ? (
    <AppShell>
      <Outlet />
    </AppShell>
  ) : (
    <LoggedIn session={active} />
  );
}

/** The server didn't answer (no connection, a timeout) or broke (a 5xx). */
function isUnreachable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status >= 500);
}

/** The page, or "You can't open this page" if its route names a permission this login lacks. */
function PermissionGate({ session, children }: { session: ActiveSession; children: ReactNode }) {
  const needed = useMatches().flatMap((match) => match.staticData.permission ?? []);
  return needed.every((permission) => session.permissions.includes(permission)) ? (
    children
  ) : (
    <NotAllowed />
  );
}

function LoggedIn({ session }: { session: ActiveSession }) {
  const actions = useSessionActions();
  const locked = session.state === 'locked';
  useIdle({
    minutes: session.idleMinutes,
    enabled: !locked,
    // #21: the owner's screen locks; #29: a staff login ends.
    onIdle: () => void (session.user.role === 'owner' ? actions.lock() : actions.logout()),
    onActive: () => void markActive().catch(() => undefined),
  });
  return (
    <>
      <div inert={locked} className={locked ? 'blur-sm select-none' : undefined}>
        <AppShell session={session}>
          <PermissionGate session={session}>
            <Outlet />
          </PermissionGate>
        </AppShell>
      </div>
      {locked && <LockScreen session={session} />}
    </>
  );
}
