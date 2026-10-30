import { createRootRoute, Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ConnectionBadge } from '../components/connection-badge';
import { LanguageSwitcher } from '../components/language-switcher';

export const Route = createRootRoute({
  component: AppShell,
  notFoundComponent: NotFound,
});

function AppShell() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="flex items-center justify-between gap-6 border-b border-stone-200 bg-white px-6 py-3">
        <Link to="/" className="text-lg font-semibold">
          {t('app.name')}
        </Link>
        <div className="flex items-center gap-6">
          <ConnectionBadge />
          <LanguageSwitcher />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <>
      <h1 className="text-2xl font-semibold">{t('notFound.title')}</h1>
      <Link to="/" className="mt-4 inline-block underline">
        {t('notFound.home')}
      </Link>
    </>
  );
}
