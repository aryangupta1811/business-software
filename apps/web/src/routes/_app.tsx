import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AppShell } from '../components/app-shell';

/** Pages for a logged-in business: the sidebar and the top bar around each one. */
export const Route = createFileRoute('/_app')({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
