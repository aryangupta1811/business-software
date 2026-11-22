import type { BranchView, GstStatus } from '@business-software/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { archiveBranch, BRANCHES_KEY, restoreBranch, useBranches } from '../api/branches';
import { ApiError } from '../api/client';
import { SESSION_KEY } from '../api/session';
import { OwnerPasswordDialog } from '../components/owner-password-dialog';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { AccountCard } from '../settings/account-card';
import { BranchDialog } from './branch-dialog';

/**
 * Settings → Branches (P1.6 design §8, Module 00 #54–#60). A business with one branch sees a
 * lead and one "Add a branch" button; from the second branch on, the list with Edit and
 * Archive (never delete) and "Show archived".
 */
export function BranchesCard({ gstStatus }: { gstStatus: GstStatus }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const branches = useBranches();
  const [editing, setEditing] = useState<BranchView | 'new' | null>(null);
  const [archiving, setArchiving] = useState<BranchView | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [restoreFailed, setRestoreFailed] = useState(false);

  // The picker, the sidebar and the staff screens read branches too.
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: BRANCHES_KEY });
    void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
  };

  const all = branches.data ?? [];
  const list = all.filter((branch) => showArchived || !branch.archived);
  const hasArchived = all.some((branch) => branch.archived);

  const restore = async (branch: BranchView) => {
    setNotice(null);
    setRestoreFailed(false);
    try {
      await restoreBranch(branch.id);
      setNotice(t('branches.restored', { name: branch.name }));
      refresh();
    } catch {
      setRestoreFailed(true);
    }
  };

  return (
    <AccountCard title={t('branches.title')} lead={t('branches.lead')}>
      {branches.isPending ? (
        <p className="text-muted">{t('settings.loading')}</p>
      ) : branches.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p>{t('branches.loadFailed')}</p>
          <Button variant="secondary" onClick={() => void branches.refetch()}>
            {t('settings.retry')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {notice !== null && (
            <p role="status" className="rounded-lg bg-success-soft px-4 py-3 text-success">
              {notice}
            </p>
          )}
          {restoreFailed && (
            <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-danger">
              {t('account.failed')}
            </p>
          )}
          {all.length > 1 ? (
            <ul className="flex flex-col divide-y divide-border">
              {list.map((branch) => (
                <BranchRow
                  key={branch.id}
                  branch={branch}
                  onEdit={() => {
                    setNotice(null);
                    setEditing(branch);
                  }}
                  onArchive={() => {
                    setNotice(null);
                    setRefusal(null);
                    setArchiving(branch);
                  }}
                  onRestore={() => void restore(branch)}
                />
              ))}
            </ul>
          ) : (
            <p className="text-muted">{t('branches.single')}</p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
            <Button
              onClick={() => {
                setNotice(null);
                setEditing('new');
              }}
            >
              <Plus aria-hidden="true" />
              {t('branches.add')}
            </Button>
            {hasArchived && (
              <label className="flex items-center gap-2 text-muted">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(event) => {
                    setShowArchived(event.target.checked);
                  }}
                />
                {t('branches.showArchived')}
              </label>
            )}
          </div>
        </div>
      )}

      <BranchDialog
        open={editing !== null}
        branch={editing === 'new' ? null : editing}
        all={all}
        withGstin={gstStatus !== 'unregistered'}
        onSaved={(saved) => {
          setNotice(
            t(editing === 'new' ? 'branches.added' : 'branches.saved', { name: saved.name }),
          );
          setEditing(null);
          refresh();
        }}
        onClose={() => {
          setEditing(null);
        }}
      />

      <OwnerPasswordDialog
        open={archiving !== null}
        title={t('branches.archive.title', { name: archiving?.name ?? '' })}
        confirm={t('branches.archive.confirm')}
        onSubmit={async (ownerPassword) => {
          if (archiving === null) return;
          try {
            await archiveBranch(archiving.id, ownerPassword);
          } catch (error) {
            // The branch can't be closed yet: say why, and keep the dialog open.
            if (error instanceof ApiError && error.code === 'branch_in_use') {
              setRefusal(t('branches.archive.inUse', { count: Number(error.detail.staff ?? 0) }));
              return;
            }
            if (error instanceof ApiError && error.code === 'head_office') {
              setRefusal(t('branches.archive.headOffice'));
              return;
            }
            throw error;
          }
          setNotice(t('branches.archived', { name: archiving.name }));
          setArchiving(null);
          refresh();
        }}
        onClose={() => {
          setArchiving(null);
        }}
      >
        <p className="text-muted">{t('branches.archive.body')}</p>
        {refusal !== null && (
          <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-danger">
            {refusal}
          </p>
        )}
      </OwnerPasswordDialog>
    </AccountCard>
  );
}

function BranchRow({
  branch,
  onEdit,
  onArchive,
  onRestore,
}: {
  branch: BranchView;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const { t } = useTranslation();
  const place = [t(`states.${branch.stateCode}` as never), branch.gstin]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          <span className="truncate">{branch.name}</span>
          <Badge>{branch.code}</Badge>
          {branch.headOffice && <Badge tone="info">{t('branches.headOffice')}</Badge>}
          {branch.archived && <Badge tone="warning">{t('branches.archivedBadge')}</Badge>}
        </p>
        <p className="text-label text-muted">{place}</p>
        <p className="text-label text-muted">
          {t('branches.counts', { computers: branch.computers, staff: branch.staff })}
        </p>
      </div>
      <div className="flex gap-2">
        {branch.archived ? (
          <Button
            size="sm"
            variant="secondary"
            aria-label={t('branches.restoreNamed', { name: branch.name })}
            onClick={onRestore}
          >
            {t('branches.restore')}
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('branches.editNamed', { name: branch.name })}
              onClick={onEdit}
            >
              {t('branches.edit')}
            </Button>
            {!branch.headOffice && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('branches.archiveNamed', { name: branch.name })}
                onClick={onArchive}
              >
                {t('branches.archive.action')}
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  );
}
