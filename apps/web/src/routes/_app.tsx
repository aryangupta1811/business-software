import type { ActiveSession } from '@business-software/shared';
import { createFileRoute, Navigate, Outlet } from '@tanstack/react-router';
import { markActive, useSession } from '../api/session';
import { useSessionActions } from '../api/session-actions';
import { AppShell } from '../components/app-shell';
import { LockScreen } from '../components/lock-screen';
import { useIdle } from '../lib/use-idle';

/** Pages for a logged-in business: the sidebar and the top bar around each one. */
export const Route = createFileRoute('/_app')({ component: AppLayout });

/**
 * Sends a computer with no session to the login page and covers a locked one. The server
 * enforces both; this only keeps the screen in step. If the session can't be read (the server
 * is down), the page shows anyway: its own requests will say what's wrong.
 */
function AppLayout() {
  const session = useSession();
  if (session.isPending) return null;
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
          <Outlet />
        </AppShell>
      </div>
      {locked && <LockScreen session={session} />}
    </>
  );
}
