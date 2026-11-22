import type { StaffView } from '@business-software/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setStaffBranches } from '../api/branches';
import { STAFF_KEY } from '../api/staff';
import { OwnerPasswordDialog } from '../components/owner-password-dialog';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';

/** The same set of ids, whatever the order they were ticked in. */
const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * "Can also work at" (Module 00 #57, P1.6 design §8): the branches besides the home branch
 * where this login may log in. It has its own Save, which asks for the owner's password
 * because it gives access to more counters. Shown only when there is another live branch.
 */
export function BranchAccessCard({
  person,
  branches,
}: {
  person: StaffView;
  /** The live branches. */
  branches: readonly { id: string; name: string }[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const titleId = useId();
  const others = branches.filter((branch) => branch.id !== person.homeBranchId);
  const live = (ids: readonly string[]) => ids.filter((id) => others.some((o) => o.id === id));
  const [saved, setSaved] = useState(() => live(person.extraBranchIds));
  const [ticked, setTicked] = useState(saved);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  if (others.length === 0) return null;
  const changed = !sameSet(ticked, saved);

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader className="flex flex-col gap-1 px-7 pt-6">
        <CardTitle id={titleId}>{t('branches.access.title')}</CardTitle>
        <p className="text-muted">{t('branches.access.lead')}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 px-7 pb-6">
        <div className="flex flex-col gap-3">
          {others.map((branch) => (
            <label key={branch.id} className="flex items-center gap-3">
              <input
                type="checkbox"
                className="size-4 shrink-0 accent-primary"
                checked={ticked.includes(branch.id)}
                onChange={(event) => {
                  setDone(false);
                  setTicked(
                    event.target.checked
                      ? [...ticked, branch.id]
                      : ticked.filter((id) => id !== branch.id),
                  );
                }}
              />
              <span className="font-medium">{branch.name}</span>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-4 border-t border-border pt-5">
          <Button
            disabled={!changed}
            onClick={() => {
              setDone(false);
              setConfirming(true);
            }}
          >
            {t('branches.access.save')}
          </Button>
          {done && (
            <p role="status" className="text-label text-success">
              {t('branches.access.saved')}
            </p>
          )}
        </div>
      </CardContent>
      <OwnerPasswordDialog
        open={confirming}
        title={t('branches.access.confirmTitle', { name: person.name })}
        confirm={t('branches.access.save')}
        onSubmit={async (ownerPassword) => {
          const view = await setStaffBranches(person.id, ticked, ownerPassword);
          const next = live(view.extraBranchIds);
          setSaved(next);
          setTicked(next);
          setDone(true);
          setConfirming(false);
          void queryClient.invalidateQueries({ queryKey: STAFF_KEY });
        }}
        onClose={() => {
          setConfirming(false);
        }}
      >
        <p className="text-muted">{t('branches.access.confirmBody')}</p>
      </OwnerPasswordDialog>
    </Card>
  );
}
