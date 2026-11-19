import type { ActiveSession } from '@business-software/shared';
import { LockKeyhole, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSessionActions } from '../api/session-actions';
import { keyLabels } from '../shortcuts/keys';
import { useShortcut } from '../shortcuts/use-shortcut';
import { Button } from './ui/button';
import { Kbd, KbdGroup } from './ui/kbd';

const LOCK_KEYS = 'Alt+L';
const ROW = 'justify-start gap-2.5 px-2 font-normal text-muted';

/** Who is at the counter, with "Lock now" (the owner's, #38) and "Log out". */
export function SessionPanel({ session }: { session: ActiveSession }) {
  const { t } = useTranslation();
  const isOwner = session.user.role === 'owner';
  return (
    <div className="flex flex-col gap-1 border-t border-border pt-3">
      <div className="mb-1 px-2">
        <p className="truncate font-semibold">{session.user.name}</p>
        <p className="truncate text-label text-muted">
          {t(`session.roles.${session.user.role}`)} · {session.branch.name}
        </p>
      </div>
      {isOwner && <LockButton />}
      <LogoutButton />
    </div>
  );
}

function LockButton() {
  const { t } = useTranslation();
  const actions = useSessionActions();
  const lock = () => void actions.lock();
  useShortcut({ keys: LOCK_KEYS, description: 'session.lockNow', group: 'general', action: lock });
  return (
    <Button variant="ghost" aria-keyshortcuts={LOCK_KEYS} onClick={lock} className={ROW}>
      <LockKeyhole aria-hidden="true" />
      <span className="flex-1 text-left">{t('session.lockNow')}</span>
      <KbdGroup aria-hidden="true">
        {keyLabels(LOCK_KEYS).map((label) => (
          <Kbd key={label}>{label}</Kbd>
        ))}
      </KbdGroup>
    </Button>
  );
}

function LogoutButton() {
  const { t } = useTranslation();
  const actions = useSessionActions();
  return (
    <Button
      variant="ghost"
      onClick={() => {
        void actions.logout();
      }}
      className={ROW}
    >
      <LogOut aria-hidden="true" />
      {t('session.logout')}
    </Button>
  );
}
