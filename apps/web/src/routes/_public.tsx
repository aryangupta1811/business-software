import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../components/language-switcher';
import { ThemeToggle } from '../components/theme-toggle';

/** Pages before login (signup, the recovery key): a slim top bar, no sidebar. */
export const Route = createFileRoute('/_public')({ component: PublicLayout });

function PublicLayout() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex min-h-14 items-center justify-between gap-6 border-b border-border px-8 py-2 print:hidden">
        <span className="flex items-center gap-2.5 font-semibold">
          <img src="/favicon.svg" alt="" className="size-6" />
          {t('app.name')}
        </span>
        <div className="flex items-center gap-4">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-1 justify-center px-8 py-10 print:p-0">
        <Outlet />
      </main>
    </div>
  );
}
