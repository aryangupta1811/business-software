import {
  businessDate,
  MAX_SALARY_PAISE,
  parseRupees,
  SALARY_KINDS,
  type SalaryKind,
  type StaffView,
} from '@business-software/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { addSalaryRate, STAFF_KEY, useSalaryRates } from '../api/staff';
import { ApiError } from '../api/client';
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
import { monthOptions } from './record-form';
import { salaryLine } from './summary';

/** A year of months to start from: this month and the next eleven. */
const MONTHS_OFFERED = 12;

/**
 * A person's salary history and "Change salary" (P2.3 design §6; Module 05 #3, #30). A change
 * starts from the 1st of this month or a later one; the old rates stay on record, so a month
 * can always be worked out again.
 */
export function SalaryCard({ person }: { person: StaffView }) {
  const { t } = useTranslation();
  const words = useDateWords();
  const rates = useSalaryRates(person.id);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const thisMonth = businessDate(new Date()).slice(0, 7);
  const list = rates.data ?? [];
  // Newest start first, so the first one that has begun is the rate in force.
  const inForce = list.find((rate) => rate.fromMonth.slice(0, 7) <= thisMonth);
  return (
    <AccountCard title={t('staff.salaryCard.title')} lead={t('staff.salaryCard.lead')}>
      <div className="flex flex-col gap-4">
        {notice !== null && (
          <p role="status" className="rounded-lg bg-success-soft px-4 py-3 text-success">
            {notice}
          </p>
        )}
        {rates.isError ? (
          <p role="alert">{t('staff.salaryCard.loadFailed')}</p>
        ) : list.length === 0 ? (
          !rates.isPending && <p className="text-muted">{t('staff.salaryCard.none')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {list.map((rate) => (
              <li key={rate.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span>
                  {t('staff.salary.from', {
                    rate: salaryLine(t, rate),
                    month: words.shortMonth(rate.fromMonth.slice(0, 7)),
                  })}
                </span>
                {rate === inForce && <Badge tone="success">{t('staff.salaryCard.now')}</Badge>}
              </li>
            ))}
          </ul>
        )}
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              setNotice(null);
              setOpen(true);
            }}
          >
            {t(person.salary === null ? 'staff.salaryCard.set' : 'staff.salaryCard.change')}
          </Button>
        </div>
      </div>
      <SalaryDialog
        open={open}
        person={person}
        thisMonth={thisMonth}
        onSaved={(month) => {
          setNotice(t('staff.salaryCard.saved', { month: words.shortMonth(month) }));
          setOpen(false);
        }}
        onClose={() => {
          setOpen(false);
        }}
      />
    </AccountCard>
  );
}

function SalaryDialog({
  open,
  person,
  thisMonth,
  onSaved,
  onClose,
}: {
  open: boolean;
  person: StaffView;
  thisMonth: string;
  onSaved: (month: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const words = useDateWords();
  const errorText = useFieldError();
  const queryClient = useQueryClient();
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setProblems({});
    setFailure(null);
  }

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    const data = new FormData(event.currentTarget);
    const fromMonth = formText(data, 'fromMonth');
    const kind = formText(data, 'kind') as SalaryKind;
    const amountPaise = parseRupees(formText(data, 'amount'));
    if (amountPaise === null || amountPaise < 1 || amountPaise > MAX_SALARY_PAISE) {
      const code = amountPaise === null ? 'invalid' : amountPaise < 1 ? 'too_small' : 'too_big';
      setProblems({ amountPaise: code });
      return;
    }
    setProblems({});
    setFailure(null);
    setSending(true);
    try {
      await addSalaryRate(person.id, { fromMonth, kind, amountPaise });
      void queryClient.invalidateQueries({ queryKey: STAFF_KEY });
      onSaved(fromMonth);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'invalid_body') setProblems(error.fields);
      else setFailure(t('account.failed'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={t('staff.salaryCard.dialogTitle', { name: person.name })}
      onClose={onClose}
    >
      <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <Field
          label={t('staff.salaryCard.startsFrom')}
          error={errorText('fromMonth', problems.fromMonth)}
        >
          {(props) => (
            <Select {...props} name="fromMonth" defaultValue={thisMonth}>
              {monthOptions(businessDate(new Date()), MONTHS_OFFERED).map((month) => (
                <option key={month} value={month}>
                  {month === thisMonth
                    ? t('staff.salaryCard.thisMonth', { month: words.shortMonth(month) })
                    : words.shortMonth(month)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('staff.salaryCard.kind')}>
          {(props) => (
            <Select {...props} name="kind" defaultValue={person.salary?.kind ?? 'monthly'}>
              {SALARY_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`staff.salaryCard.${kind}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={t('staff.salaryCard.amount')}
          error={failure ?? errorText('amountPaise', problems.amountPaise)}
        >
          {(props) => (
            <Input
              {...props}
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the owner types it at once
              autoFocus
            />
          )}
        </Field>
        <DialogActions onClose={onClose} confirm={t('staff.salaryCard.save')} busy={sending} />
      </form>
    </Dialog>
  );
}
