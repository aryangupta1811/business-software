import type { ActiveSession, Permission } from '@business-software/shared';
import { Link, useMatches, useNavigate } from '@tanstack/react-router';
import { House, IndianRupee, Keyboard, Package, Settings, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertsBell } from '../alerts/alerts-bell';
import { keyLabels } from '../shortcuts/keys';
import { useOpenShortcutHelp, useShortcut } from '../shortcuts/use-shortcut';
import { ConnectionBadge } from './connection-badge';
import { EmailBanner } from './email-banner';
import { LanguageSwitcher } from './language-switcher';
import { SessionPanel } from './session-panel';
import { ThemeToggle } from './theme-toggle';
import { Button } from './ui/button';
import { Kbd, KbdGroup } from './ui/kbd';

const HOME_KEYS = 'Alt+H';
const BILLING_KEYS = 'Alt+B';
const ITEMS_KEYS = 'Alt+I';
const NAV_LINK =
  'flex min-h-10 items-center gap-2.5 rounded-lg px-2 text-muted hover:bg-surface-muted data-[status=active]:bg-surface-muted data-[status=active]:font-semibold data-[status=active]:text-foreground';

/**
 * Sidebar on the left, top bar with the page title and settings, then the page. With a
 * session, the sidebar ends with who is logged in and the lock and logout buttons.
 */
export function AppShell({
  session = null,
  children,
}: {
  session?: ActiveSession | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const titleKey = useMatches().at(-1)?.staticData.titleKey;
  const openShortcutHelp = useOpenShortcutHelp();
  // Each entry shows only if this login holds its permission. With no session read (the server
  // is down) nothing is known, so every entry shows and the server decides on each request.
  // Hiding is only help for the person; the server is the lock.
  const may = (permission: Permission) =>
    session === null || session.permissions.includes(permission);

  useShortcut({
    keys: HOME_KEYS,
    description: 'shortcuts.goHome',
    group: 'navigation',
    action: () => {
      void navigate({ to: '/' });
    },
  });

  useShortcut({
    keys: BILLING_KEYS,
    description: 'shortcuts.goBilling',
    group: 'navigation',
    action: () => {
      if (may('billing.sell')) void navigate({ to: '/bill' });
    },
  });

  useShortcut({
    keys: ITEMS_KEYS,
    description: 'shortcuts.goItems',
    group: 'navigation',
    action: () => {
      if (may('items.view')) void navigate({ to: '/items' });
    },
  });

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen print:hidden w-56 shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar px-3 py-4">
        <Link to="/" className="mb-6 flex items-center gap-2.5 px-2 font-semibold">
          <img src="/favicon.svg" alt="" className="size-6" />
          {t('app.name')}
        </Link>
        <nav aria-label={t('nav.label')}>
          <Link
            to="/"
            activeOptions={{ exact: true }}
            aria-keyshortcuts={HOME_KEYS}
            className={NAV_LINK}
          >
            <House aria-hidden="true" className="size-4" />
            <span className="flex-1">{t('nav.home')}</span>
            <KbdGroup aria-hidden="true">
              {keyLabels(HOME_KEYS).map((label) => (
                <Kbd key={label}>{label}</Kbd>
              ))}
            </KbdGroup>
          </Link>
          {may('billing.sell') && (
            <Link to="/bill" aria-keyshortcuts={BILLING_KEYS} className={NAV_LINK}>
              <IndianRupee aria-hidden="true" className="size-4" />
              <span className="flex-1">{t('nav.billing')}</span>
              <KbdGroup aria-hidden="true">
                {keyLabels(BILLING_KEYS).map((label) => (
                  <Kbd key={label}>{label}</Kbd>
                ))}
              </KbdGroup>
            </Link>
          )}
          {may('items.view') && (
            <Link to="/items" aria-keyshortcuts={ITEMS_KEYS} className={NAV_LINK}>
              <Package aria-hidden="true" className="size-4" />
              <span className="flex-1">{t('nav.items')}</span>
              <KbdGroup aria-hidden="true">
                {keyLabels(ITEMS_KEYS).map((label) => (
                  <Kbd key={label}>{label}</Kbd>
                ))}
              </KbdGroup>
            </Link>
          )}
          {may('staff.manage') && (
            <Link to="/staff" className={NAV_LINK}>
              <Users aria-hidden="true" className="size-4" />
              {t('nav.staff')}
            </Link>
          )}
          {may('settings.view') && (
            <Link to="/settings" className={NAV_LINK}>
              <Settings aria-hidden="true" className="size-4" />
              {t('nav.settings')}
            </Link>
          )}
        </nav>
        <div className="mt-auto flex flex-col gap-3">
          {/* The ? key alone is invisible to mouse users, so the list has a button too. */}
          <Button
            variant="ghost"
            aria-keyshortcuts="?"
            onClick={openShortcutHelp}
            className="justify-start gap-2.5 px-2 font-normal text-muted"
          >
            <Keyboard aria-hidden="true" />
            <span className="flex-1 text-left">{t('shortcuts.title')}</span>
            <Kbd aria-hidden="true">?</Kbd>
          </Button>
          {session !== null && <SessionPanel session={session} />}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex min-h-14 print:hidden items-center justify-between gap-6 border-b border-border bg-background px-8 py-2">
          {titleKey ? <h1 className="text-title font-semibold">{t(titleKey)}</h1> : <span />}
          <div className="flex items-center gap-4">
            <ConnectionBadge />
            {session !== null && <AlertsBell session={session} />}
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </header>
        {session !== null && <EmailBanner session={session} />}
        <main className="flex-1 px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
