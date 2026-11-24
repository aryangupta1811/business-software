import { weekdayOf, type MonthDay, type MonthView } from '@business-software/shared';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn';
import { useDateWords } from '../lib/dates';
import { hoursOf, STATUS_TONE } from './labels';

/**
 * One person's month as a calendar (`05` #6): each day's status, with late and overtime. A day
 * that is off the register (before joining, after leaving, or still ahead) stays blank.
 */
export function MonthGrid({ days }: { days: MonthDay[] }) {
  const { t } = useTranslation();
  const words = useDateWords();
  const first = days[0];
  const lead = first === undefined ? 0 : weekdayOf(first.date);
  return (
    <div className="flex flex-col gap-1.5">
      <div
        aria-hidden="true"
        className="grid grid-cols-7 gap-1.5 text-center text-label text-muted"
      >
        {words.weekdays.map((name) => (
          <span key={name}>{name}</span>
        ))}
      </div>
      <ol aria-label={t('attendance.month.days')} className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: lead }, (_, index) => (
          <li key={`blank-${String(index)}`} aria-hidden="true" />
        ))}
        {days.map((day) => (
          <DayCell key={day.date} day={day} />
        ))}
      </ol>
    </div>
  );
}

function DayCell({ day }: { day: MonthDay }) {
  const { t } = useTranslation();
  const words = useDateWords();
  const state = day.state;
  const overtime =
    state !== null && state.overtimeMinutes > 0
      ? t('attendance.month.overtime', {
          time: t('attendance.hours', { count: hoursOf(state.overtimeMinutes) }),
        })
      : null;
  const label = [
    words.day(day.date),
    state === null ? t('attendance.month.offRegister') : t(`attendance.status.${state.status}`),
    state?.late === true ? t('attendance.month.late') : null,
    overtime,
  ]
    .filter((part) => part !== null)
    .join(', ');
  return (
    <li
      aria-label={label}
      className={cn(
        'flex min-h-16 flex-col gap-0.5 rounded-lg border border-border p-1.5 text-label',
        state === null ? 'text-muted opacity-60' : STATUS_TONE[state.status],
      )}
    >
      <span className="font-semibold tabular-nums">{Number(day.date.slice(8))}</span>
      {state !== null && (
        <>
          <span>{t(`attendance.status.${state.status}`)}</span>
          {state.late && <span>{t('attendance.late')}</span>}
          {overtime !== null && <span>{overtime}</span>}
        </>
      )}
    </li>
  );
}

/** The month's counts, under the calendar. */
export function MonthCountsCard({ month }: { month: MonthView }) {
  const { t } = useTranslation();
  const { counts } = month;
  const rows: [string, string][] = [
    [t('attendance.month.present'), String(counts.present)],
    [t('attendance.month.halfDay'), String(counts.halfDay)],
    [t('attendance.month.absent'), String(counts.absent)],
    [
      t('attendance.month.paidLeave'),
      month.paidLeavesPerMonth > 0
        ? t('attendance.month.leavesOf', {
            used: counts.paidLeave,
            total: month.paidLeavesPerMonth,
          })
        : String(counts.paidLeave),
    ],
    [t('attendance.month.weeklyOff'), String(counts.weeklyOff)],
    [t('attendance.month.holiday'), String(counts.holiday)],
    [t('attendance.month.lateCount'), String(counts.late)],
    [
      t('attendance.month.overtimeTotal'),
      t('attendance.hours', { count: hoursOf(counts.overtimeMinutes) }),
    ],
  ];
  return (
    <section
      aria-label={t('attendance.month.counts')}
      className="flex flex-col gap-3 rounded-lg bg-surface p-5 shadow-card"
    >
      <dl className="grid grid-cols-2 gap-x-8 gap-y-2 md:grid-cols-4">
        {rows.map(([name, value]) => (
          <div key={name} className="flex flex-col">
            <dt className="text-label text-muted">{name}</dt>
            <dd className="font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col border-t border-border pt-3">
        <p className="text-label text-muted">{t('attendance.month.holidaysTaken')}</p>
        <p className="text-figure font-semibold tabular-nums">{counts.holidaysTaken}</p>
        <p className="text-label text-muted">{t('attendance.month.holidaysTakenHint')}</p>
      </div>
    </section>
  );
}
