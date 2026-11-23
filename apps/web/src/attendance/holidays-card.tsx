import { businessDate, type HolidayView } from '@business-software/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  addHoliday,
  ATTENDANCE_KEY,
  HOLIDAYS_KEY,
  removeHoliday,
  useHolidays,
} from '../api/attendance';
import { ApiError } from '../api/client';
import { liveBranches, useBranches } from '../api/branches';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Dialog, DialogActions } from '../components/ui/dialog';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { useDateWords } from '../lib/dates';
import { useFieldError } from '../lib/field-error';
import { formText } from '../lib/form-data';
import { AccountCard } from '../settings/account-card';

type Problems = Partial<Record<'date' | 'name' | 'branchId', string>>;

/**
 * Settings → Shop holidays (P2.3 design §6; Module 05 #7, #31): the year's list, add and remove.
 * A holiday is for every branch unless one is picked; removing one archives it (ADR 0007).
 */
export function HolidaysCard() {
  const { t } = useTranslation();
  const words = useDateWords();
  const errorText = useFieldError();
  const queryClient = useQueryClient();
  const branches = useBranches();
  const [year, setYear] = useState(() => businessDate(new Date()).slice(0, 4));
  const holidays = useHolidays(year);
  const [problems, setProblems] = useState<Problems>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [removing, setRemoving] = useState<HolidayView | null>(null);
  const [sending, setSending] = useState(false);
  // The form starts empty again after a holiday is added.
  const [formKey, setFormKey] = useState(0);
  const live = liveBranches(branches.data ?? []);
  const branchName = (id: string | null) =>
    id === null
      ? t('holidays.everyBranch')
      : (branches.data?.find((branch) => branch.id === id)?.name ?? '');

  // Every register's default days change with the calendar.
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: HOLIDAYS_KEY });
    void queryClient.invalidateQueries({ queryKey: ATTENDANCE_KEY });
  };

  const add = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    const data = new FormData(event.currentTarget);
    const date = formText(data, 'date');
    const name = formText(data, 'name').trim();
    const branchId = formText(data, 'branchId');
    setNotice(null);
    setFailure(null);
    const missing: Problems = {
      ...(date === '' && { date: 'required' }),
      ...(name === '' && { name: 'required' }),
    };
    setProblems(missing);
    if (Object.keys(missing).length > 0) return;
    setSending(true);
    try {
      await addHoliday({ date, name, branchId: branchId === '' ? null : branchId });
      setNotice(t('holidays.added', { name }));
      setFormKey((key) => key + 1);
      // Show the year the new holiday is in.
      setYear(date.slice(0, 4));
      refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'holiday_exists') {
        setProblems({ date: 'holiday_exists' });
      } else if (error instanceof ApiError && error.code === 'invalid_body') {
        setProblems(error.fields);
      } else {
        setFailure(t('account.failed'));
      }
    } finally {
      setSending(false);
    }
  };

  const list = holidays.data ?? [];
  return (
    <AccountCard title={t('holidays.title')} lead={t('holidays.lead')}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('holidays.previousYear')}
            onClick={() => {
              setYear(String(Number(year) - 1));
            }}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <h3 className="min-w-16 text-center font-semibold tabular-nums">{year}</h3>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('holidays.nextYear')}
            onClick={() => {
              setYear(String(Number(year) + 1));
            }}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>

        {notice !== null && (
          <p role="status" className="rounded-lg bg-success-soft px-4 py-3 text-success">
            {notice}
          </p>
        )}
        {failure !== null && (
          <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-danger">
            {failure}
          </p>
        )}

        {holidays.isPending ? (
          <p className="text-muted">{t('settings.loading')}</p>
        ) : holidays.isError ? (
          <div role="alert" className="flex flex-col items-start gap-3">
            <p>{t('holidays.loadFailed')}</p>
            <Button variant="secondary" onClick={() => void holidays.refetch()}>
              {t('settings.retry')}
            </Button>
          </div>
        ) : list.length === 0 ? (
          <p className="text-muted">{t('holidays.empty', { year })}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {list.map((holiday) => (
              <li key={holiday.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                <span className="w-28 text-muted tabular-nums">{words.day(holiday.date)}</span>
                <span className="flex-1 font-medium">{holiday.name}</span>
                <Badge tone={holiday.branchId === null ? 'neutral' : 'info'}>
                  {branchName(holiday.branchId)}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('holidays.removeNamed', { name: holiday.name })}
                  onClick={() => {
                    setNotice(null);
                    setRemoving(holiday);
                  }}
                >
                  {t('holidays.remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form
          key={formKey}
          noValidate
          onSubmit={(event) => void add(event)}
          className="grid grid-cols-1 items-start gap-4 border-t border-border pt-5 md:grid-cols-[11rem_1fr_12rem_auto]"
        >
          <Field label={t('holidays.date')} error={errorText('date', problems.date)}>
            {(props) => <Input {...props} type="date" name="date" />}
          </Field>
          <Field
            label={t('holidays.name')}
            hint={t('holidays.nameHint')}
            error={errorText('name', problems.name)}
          >
            {(props) => <Input {...props} name="name" maxLength={100} autoComplete="off" />}
          </Field>
          {live.length > 1 ? (
            <Field label={t('holidays.branch')} error={errorText('branchId', problems.branchId)}>
              {(props) => (
                <Select {...props} name="branchId" defaultValue="">
                  <option value="">{t('holidays.everyBranch')}</option>
                  {live.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={sending} className="md:mt-[1.625rem]">
            <Plus aria-hidden="true" />
            {t('holidays.add')}
          </Button>
        </form>
      </div>

      <RemoveDialog
        holiday={removing}
        onDone={(name) => {
          setNotice(t('holidays.removed', { name }));
          setRemoving(null);
          refresh();
        }}
        onClose={() => {
          setRemoving(null);
        }}
      />
    </AccountCard>
  );
}

/** Says what removing does (it stays on record) and takes an optional reason for the log. */
function RemoveDialog({
  holiday,
  onDone,
  onClose,
}: {
  holiday: HolidayView | null;
  onDone: (name: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (holiday === null || sending) return;
    const reason = formText(new FormData(event.currentTarget), 'reason').trim();
    setSending(true);
    setFailure(null);
    try {
      await removeHoliday(holiday.id, reason === '' ? {} : { reason });
      onDone(holiday.name);
    } catch {
      setFailure(t('account.failed'));
    } finally {
      setSending(false);
    }
  };
  return (
    <Dialog
      open={holiday !== null}
      title={t('holidays.removeTitle', { name: holiday?.name ?? '' })}
      onClose={onClose}
    >
      <form noValidate onSubmit={(event) => void submit(event)}>
        <p className="mb-4 text-muted">{t('holidays.removeBody')}</p>
        <Field label={t('holidays.removeReason')} error={failure ?? undefined}>
          {(props) => <Input {...props} name="reason" maxLength={200} autoComplete="off" />}
        </Field>
        <DialogActions
          onClose={onClose}
          confirm={t('holidays.removeConfirm')}
          busy={sending}
          danger
        />
      </form>
    </Dialog>
  );
}
