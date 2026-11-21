import type { ActiveSession } from '@business-software/shared';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../api/session';
import { PasswordCard } from '../../settings/password-card';
import { AccountCard } from '../../settings/account-card';

/**
 * "My password" (Module 00 #46, P1.5 #50): every login can open it from its name in the sidebar,
 * staff included, who can't open Settings. It is the same password card the owner has in
 * Settings.
 */
export const Route = createFileRoute('/_app/account')({
  component: Account,
  staticData: { titleKey: 'me.title', permission: 'session.own' },
});

function Account() {
  const session = useSession().data;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {session !== undefined && session.state !== 'none' && <WhoCard session={session} />}
      <PasswordCard />
    </div>
  );
}

function WhoCard({ session }: { session: ActiveSession }) {
  const { t } = useTranslation();
  const rows = [
    ['me.name', session.user.name],
    ['me.role', t(`session.roles.${session.user.role}`)],
    ['me.branch', session.branch.name],
  ] as const;
  return (
    <AccountCard title={t('me.who')} lead={t('me.lead')}>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-8 gap-y-2">
        {rows.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-muted">{t(key)}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </AccountCard>
  );
}
