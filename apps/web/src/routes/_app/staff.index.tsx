import type { StaffView } from '@business-software/shared';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { liveBranches, useBranches } from '../../api/branches';
import { useStaffList } from '../../api/staff';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Card } from '../../components/ui/card';
import { StaffDialogs } from '../../staff/dialogs';
import { useStaffDialogs, type StaffDialogsHost } from '../../staff/use-staff-dialogs';
import { LoadGate } from '../../staff/load-gate';
import { accessSummary } from '../../staff/summary';

/**
 * The owner's staff list (P1.5 design §6, Module 00 #15, #34): who has a login, what each may
 * do in short, and the actions on each. Deactivated logins show under "Show former staff".
 */
export const Route = createFileRoute('/_app/staff/')({
  component: StaffList,
  staticData: { titleKey: 'nav.staff', permission: 'staff.manage' },
});

function StaffList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [former, setFormer] = useState(false);
  const list = useStaffList(former);
  const branches = useBranches();
  const dialogs = useStaffDialogs();
  const { ask, notice } = dialogs;
  // One branch needs no branch column: there is nothing to tell apart (design §6).
  const showBranch = liveBranches(branches.data ?? []).length > 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-muted">{t('staff.lead')}</p>
        <div className="flex items-center gap-5">
          <label className="flex h-10 items-center gap-2 text-muted">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={former}
              onChange={(event) => {
                setFormer(event.target.checked);
              }}
            />
            {t('staff.showFormer')}
          </label>
          <Button onClick={() => void navigate({ to: '/staff/new' })}>
            <Plus aria-hidden="true" />
            {t('staff.add')}
          </Button>
        </div>
      </div>

      {notice !== null && (
        <p role="status" className="rounded-lg bg-success-soft px-4 py-3 text-success">
          {notice}
        </p>
      )}

      <LoadGate queries={[list]}>
        {() => (
          <Card className="overflow-hidden">
            <table className="w-full text-left">
              <caption className="sr-only">{t('nav.staff')}</caption>
              <thead className="border-b border-border text-label text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t('staff.columns.name')}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t('staff.columns.username')}
                  </th>
                  {showBranch && (
                    <th scope="col" className="px-4 py-3 font-medium">
                      {t('staff.columns.branch')}
                    </th>
                  )}
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t('staff.columns.access')}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t('staff.columns.status')}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    {t('staff.columns.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(list.data ?? []).map((person) => (
                  <StaffRow key={person.id} person={person} showBranch={showBranch} ask={ask} />
                ))}
              </tbody>
            </table>
            {list.data?.length === 0 && (
              <p className="px-4 py-10 text-center text-muted">{t('staff.empty')}</p>
            )}
          </Card>
        )}
      </LoadGate>
      <StaffDialogs host={dialogs} />
    </div>
  );
}

function StaffRow({
  person,
  showBranch,
  ask,
}: {
  person: StaffView;
  showBranch: boolean;
  ask: StaffDialogsHost['ask'];
}) {
  const { t } = useTranslation();
  return (
    <tr className={person.active ? 'hover:bg-surface-muted' : 'text-muted hover:bg-surface-muted'}>
      <td className="px-4 py-2.5">
        <Link
          to="/staff/$id"
          params={{ id: person.id }}
          className="font-medium text-foreground hover:underline"
        >
          {person.name}
        </Link>
      </td>
      <td className="px-4 py-2.5 font-mono text-label">{person.username}</td>
      {showBranch && <td className="px-4 py-2.5 text-muted">{person.homeBranchName}</td>}
      <td className="px-4 py-2.5 text-muted">{accessSummary(t, person.permissions)}</td>
      <td className="px-4 py-2.5">
        <Badge tone={person.active ? 'success' : 'warning'}>
          {t(person.active ? 'staff.status.active' : 'staff.status.inactive')}
        </Badge>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex justify-end gap-1">
          <Link
            to="/staff/$id"
            params={{ id: person.id }}
            aria-label={t('staff.actions.editNamed', { name: person.name })}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            {t('staff.actions.edit')}
          </Link>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('staff.actions.resetNamed', { name: person.name })}
            onClick={() => {
              ask('reset', person);
            }}
          >
            {t('staff.actions.reset')}
          </Button>
          {person.active ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('staff.actions.deactivateNamed', { name: person.name })}
              onClick={() => {
                ask('deactivate', person);
              }}
            >
              {t('staff.actions.deactivate')}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('staff.actions.reactivateNamed', { name: person.name })}
              onClick={() => {
                ask('reactivate', person);
              }}
            >
              {t('staff.actions.reactivate')}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
