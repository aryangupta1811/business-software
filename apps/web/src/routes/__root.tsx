import { createRootRoute, Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/app-shell';
import { ShortcutProvider } from '../shortcuts/shortcut-provider';

export const Route = createRootRoute({
  component: Root,
  notFoundComponent: NotFound,
});

function Root() {
  return (
    <ShortcutProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </ShortcutProvider>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <>
      <h1 className="text-title font-semibold">{t('notFound.title')}</h1>
      <Link to="/" className="mt-4 inline-block text-accent underline-offset-4 hover:underline">
        {t('notFound.home')}
      </Link>
    </>
  );
}
