import { Link, useMatches, useNavigate } from '@tanstack/react-router';
import { House, Keyboard } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { keyLabels } from '../shortcuts/keys';
import { useOpenShortcutHelp, useShortcut } from '../shortcuts/use-shortcut';
import { ConnectionBadge } from './connection-badge';
import { LanguageSwitcher } from './language-switcher';
import { ThemeToggle } from './theme-toggle';
import { Button } from './ui/button';
import { Kbd, KbdGroup } from './ui/kbd';

const HOME_KEYS = 'Alt+H';

/** Sidebar on the left, top bar with the page title and settings, then the page. */
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const titleKey = useMatches().at(-1)?.staticData.titleKey;
  const openShortcutHelp = useOpenShortcutHelp();

  useShortcut({
    keys: HOME_KEYS,
    description: 'shortcuts.goHome',
    group: 'navigation',
    action: () => {
      void navigate({ to: '/' });
    },
  });

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-sidebar px-3 py-4">
        <Link to="/" className="mb-6 flex items-center gap-2.5 px-2 font-semibold">
          <img src="/favicon.svg" alt="" className="size-6" />
          {t('app.name')}
        </Link>
        <nav aria-label={t('nav.label')}>
          <Link
            to="/"
            className="flex h-10 items-center gap-2.5 rounded-lg px-2 text-muted hover:bg-surface-muted data-[status=active]:bg-surface-muted data-[status=active]:font-semibold data-[status=active]:text-foreground"
          >
            <House aria-hidden="true" className="size-4" />
            <span className="flex-1">{t('nav.home')}</span>
            <KbdGroup aria-hidden="true">
              {keyLabels(HOME_KEYS).map((label) => (
                <Kbd key={label}>{label}</Kbd>
              ))}
            </KbdGroup>
          </Link>
        </nav>
        {/* The ? key alone is invisible to mouse users, so the list has a button too. */}
        <Button
          variant="ghost"
          aria-keyshortcuts="?"
          onClick={openShortcutHelp}
          className="mt-auto justify-start gap-2.5 px-2 font-normal text-muted"
        >
          <Keyboard aria-hidden="true" />
          <span className="flex-1 text-left">{t('shortcuts.title')}</span>
          <Kbd aria-hidden="true">?</Kbd>
        </Button>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-6 border-b border-border px-8">
          {titleKey ? <h1 className="text-title font-semibold">{t(titleKey)}</h1> : <span />}
          <div className="flex items-center gap-4">
            <ConnectionBadge />
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
