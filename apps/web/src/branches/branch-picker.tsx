import type { ActiveSession } from '@business-software/shared';
import { MapPin } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { usePickerBranches } from '../api/branches';
import { Select } from '../components/ui/select';
import { useBranchScope } from './branch-scope-context';

/**
 * The owner's branch picker (P1.6 design §8, ADR 0045), in the top bar of the pages that read
 * branch data. It only changes what the page shows; everything saved still goes to this
 * computer's branch, which is marked "this counter". The caller shows it only for an owner
 * with two or more branches.
 */
export function BranchPicker({ session }: { session: ActiveSession }) {
  const { t } = useTranslation();
  const scope = useBranchScope();
  const branches = usePickerBranches(true);
  const list = branches.data;
  const known = list?.some((branch) => branch.id === scope.choice) ?? true;
  const { reset } = scope;
  // A remembered branch that was archived since: back to this counter's.
  useEffect(() => {
    if (list !== undefined && scope.choice !== 'all' && !known) reset();
  }, [list, known, scope.choice, reset]);

  if (list === undefined || scope.choice === null) return null;
  return (
    <label className="flex items-center gap-2 text-label text-muted">
      <MapPin aria-hidden="true" className="size-4" />
      <span className="sr-only">{t('branches.picker.label')}</span>
      <Select
        value={known ? scope.choice : session.branch.id}
        onChange={(event) => {
          scope.choose(event.target.value);
        }}
        className="h-9 w-auto max-w-56 py-0"
      >
        {list.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.id === session.branch.id
              ? t('branches.picker.thisCounter', { name: branch.name })
              : branch.name}
          </option>
        ))}
        <option value="all">{t('branches.picker.all')}</option>
      </Select>
    </label>
  );
}
