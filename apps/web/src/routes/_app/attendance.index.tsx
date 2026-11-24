import {
  businessDate,
  dayCounts,
  summaryLine,
  type MarkedDay,
  type RegisterRow,
  type RegisterView,
} from '@business-software/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ATTENDANCE_KEY, markAttendance, registerKey, useRegister } from '../../api/attendance';
import { ApiError } from '../../api/client';
import { useSession } from '../../api/session';
import { countsText } from '../../attendance/labels';
import { ReasonDialog } from '../../attendance/reason-dialog';
import { RegisterRowItem } from '../../attendance/register-row';
import { AttendanceTabs } from '../../attendance/tabs';
import { useBranchScope } from '../../branches/branch-scope-context';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { useDateWords } from '../../lib/dates';
import { LoadGate } from '../../staff/load-gate';

/**
 * The daily register (P2.3 design §6; Module 05 #5–#9, #32): everyone at the branch starts as
 * present, a tap changes a person's day, and a day before today asks for the reason once.
 */
export const Route = createFileRoute('/_app/attendance/')({
  component: Register,
  staticData: { titleKey: 'nav.attendance', permission: 'attendance.mark', branchPicker: true },
});

/** The day before or after `date`. */
function shiftDay(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

interface Change {
  row: RegisterRow;
  next: MarkedDay;
}

function Register() {
  const { t } = useTranslation();
  const words = useDateWords();
  const queryClient = useQueryClient();
  const session = useSession().data;
  const meId = session !== undefined && session.state !== 'none' ? session.user.id : null;
  const scope = useBranchScope();
  const today = businessDate(new Date());
  const [date, setDate] = useState(today);
  // "All branches" has no single register; the picker must name one.
  const allBranches = scope.param === 'all';
  const branch = allBranches ? undefined : scope.param;
  const register = useRegister(date, branch, !allBranches);

  const past = date < today;
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState(false);
  const [waiting, setWaiting] = useState<Change | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const patch = (saved: RegisterRow) => {
    queryClient.setQueryData<RegisterView>(registerKey(date, branch), (old) => {
      if (old === undefined) return old;
      const rows = old.rows.map((row) => (row.userId === saved.userId ? saved : row));
      const counts = dayCounts(rows);
      return { ...old, rows, counts, summary: summaryLine(counts) };
    });
  };

  const save = async ({ row, next }: Change, reason: string | undefined) => {
    setNotice(null);
    setFailure(null);
    setBusy((current) => new Set(current).add(row.userId));
    try {
      const saved = await markAttendance(row.userId, date, {
        ...next,
        version: row.version,
        ...(reason !== undefined && { reason }),
      });
      patch(saved);
      void queryClient.invalidateQueries({ queryKey: [...ATTENDANCE_KEY, 'month'] });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'changed') {
        // Somebody saved this day first: show what is there now.
        patch(error.detail.latest as RegisterRow);
        setNotice(t('attendance.changed', { name: row.name }));
      } else {
        setFailure(failureText(error));
      }
    } finally {
      setBusy((current) => {
        const rest = new Set(current);
        rest.delete(row.userId);
        return rest;
      });
    }
  };

  const failureText = (error: unknown): string => {
    if (error instanceof ApiError) {
      if (error.code === 'network') return t('errors.network');
      if (error.code === 'forbidden') return t('errors.forbidden');
      if (
        ['future_date', 'not_on_register', 'other_branch', 'own_attendance'].includes(error.code)
      ) {
        return t(`attendance.errors.${error.code}` as 'attendance.errors.future_date');
      }
    }
    return t('attendance.failed');
  };

  const change = (row: RegisterRow, next: MarkedDay) => {
    const reason = reasons[date];
    // A day before today is a change that goes in the log with a reason (`05` #8).
    if (past && reason === undefined) {
      setWaiting({ row, next });
      setAsking(true);
      return;
    }
    void save({ row, next }, past ? reason : undefined);
  };

  const goTo = (next: string) => {
    if (next > today) return;
    setNotice(null);
    setFailure(null);
    setDate(next);
  };

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <AttendanceTabs current="register" />
      <p className="max-w-xl text-muted">{t('attendance.lead')}</p>

      <div className="flex flex-wrap items-end gap-3">
        <Button
          variant="secondary"
          aria-label={t('attendance.previousDay')}
          onClick={() => {
            goTo(shiftDay(date, -1));
          }}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Field label={t('attendance.date')}>
          {(props) => (
            <Input
              {...props}
              type="date"
              className="w-44"
              max={today}
              value={date}
              onChange={(event) => {
                if (event.target.value !== '') goTo(event.target.value);
              }}
            />
          )}
        </Field>
        <Button
          variant="secondary"
          aria-label={t('attendance.nextDay')}
          disabled={date >= today}
          onClick={() => {
            goTo(shiftDay(date, 1));
          }}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          disabled={date === today}
          onClick={() => {
            goTo(today);
          }}
        >
          {t('attendance.today')}
        </Button>
        <p className="ml-auto self-center text-section font-semibold" aria-live="polite">
          {register.data !== undefined && countsText(t, register.data.counts)}
        </p>
      </div>
      <p className="text-label text-muted">{words.fullDay(date)}</p>

      {past && reasons[date] !== undefined && (
        <p className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-muted px-4 py-2.5">
          <span>{t('attendance.reason.current', { reason: reasons[date] })}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setWaiting(null);
              setAsking(true);
            }}
          >
            {t('attendance.reason.change')}
          </Button>
        </p>
      )}
      {notice !== null && (
        <p role="status" className="rounded-lg bg-warning-soft px-4 py-3 text-warning">
          {notice}
        </p>
      )}
      {failure !== null && (
        <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-danger">
          {failure}
        </p>
      )}

      {allBranches ? (
        <p className="text-muted">{t('attendance.pickBranch')}</p>
      ) : (
        <LoadGate queries={[register]}>
          {() => (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-border">
                {(register.data?.rows ?? []).map((row) => (
                  <RegisterRowItem
                    key={row.userId}
                    row={row}
                    mine={row.userId === meId}
                    busy={busy.has(row.userId)}
                    onChange={(next) => {
                      change(row, next);
                    }}
                  />
                ))}
              </ul>
              {register.data?.rows.length === 0 && (
                <p className="px-4 py-10 text-center text-muted">{t('attendance.empty')}</p>
              )}
            </Card>
          )}
        </LoadGate>
      )}

      <ReasonDialog
        open={asking}
        date={words.day(date)}
        initial={reasons[date] ?? ''}
        onSave={(reason) => {
          setReasons((current) => ({ ...current, [date]: reason }));
          setAsking(false);
          if (waiting !== null) void save(waiting, reason);
          setWaiting(null);
        }}
        onClose={() => {
          setAsking(false);
          setWaiting(null);
        }}
      />
    </div>
  );
}
