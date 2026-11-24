import { businessDate } from '@business-software/shared';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAttendancePeople, useMonth } from '../../api/attendance';
import { useSession } from '../../api/session';
import { MonthCountsCard, MonthGrid } from '../../attendance/month-grid';
import { AttendanceTabs } from '../../attendance/tabs';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Select } from '../../components/ui/select';
import { useDateWords } from '../../lib/dates';
import { LoadGate } from '../../staff/load-gate';

/**
 * One person's month (P2.3 design §6; Module 05 #25): a calendar and the month's counts. Your
 * own month is always yours; other people's need the owner or "See everyone's attendance".
 */
export const Route = createFileRoute('/_app/attendance/month')({
  component: MonthPage,
  staticData: { titleKey: 'nav.attendance', permission: 'session.own' },
  validateSearch: (search: Record<string, unknown>): { userId?: string; month?: string } => ({
    ...(typeof search.userId === 'string' && { userId: search.userId }),
    ...(typeof search.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(search.month)
      ? { month: search.month }
      : {}),
  }),
});

/** The month before or after `month` (`YYYY-MM`). */
function shiftMonth(month: string, by: number): string {
  const [year = 0, number = 1] = month.split('-').map(Number);
  const at = new Date(Date.UTC(year, number - 1 + by, 1));
  return `${String(at.getUTCFullYear())}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

interface Choice {
  id: string;
  name: string;
}

function MonthPage() {
  const { t } = useTranslation();
  const words = useDateWords();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const session = useSession().data;
  const active = session !== undefined && session.state !== 'none' ? session : null;
  const meId = active?.user.id ?? null;
  const isOwner = active?.user.role === 'owner';
  const may = (permission: 'attendance.mark' | 'attendance.view_all') =>
    active?.permissions.includes(permission) === true;
  const today = businessDate(new Date());
  const thisMonth = today.slice(0, 7);
  const month = search.month ?? thisMonth;

  // Who can be picked: the owner everyone, "See everyone's attendance" its own branch's people;
  // anyone else sees only themselves.
  const picking = isOwner || may('attendance.view_all');
  const list = useAttendancePeople(picking);
  const choices: Choice[] = (list.data ?? []).map((person) => ({
    id: person.id,
    name: person.name,
  }));

  const person = !picking
    ? meId
    : search.userId !== undefined && choices.some((choice) => choice.id === search.userId)
      ? search.userId
      : (choices.find((choice) => choice.id === meId)?.id ?? choices[0]?.id ?? null);
  const view = useMonth(person, month);

  const go = (next: { userId?: string; month: string }) => {
    void navigate({ to: '/attendance/month', search: next, replace: true });
  };

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      {may('attendance.mark') && <AttendanceTabs current="month" />}
      <p className="max-w-xl text-muted">
        {picking ? t('attendance.month.lead') : t('attendance.month.onlyOwn')}
      </p>

      <LoadGate queries={picking ? [list] : []}>
        {() => (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              {picking && (
                <Field label={t('attendance.month.person')}>
                  {(props) => (
                    <Select
                      {...props}
                      className="w-56"
                      value={person ?? ''}
                      onChange={(event) => {
                        go({ userId: event.target.value, month });
                      }}
                    >
                      {choices.map((choice) => (
                        <option key={choice.id} value={choice.id}>
                          {choice.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              <Button
                variant="secondary"
                aria-label={t('attendance.month.previous')}
                onClick={() => {
                  go({
                    ...(person !== null && picking && { userId: person }),
                    month: shiftMonth(month, -1),
                  });
                }}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <h2 className="self-center text-section font-semibold">{words.month(month)}</h2>
              <Button
                variant="secondary"
                aria-label={t('attendance.month.next')}
                disabled={month >= thisMonth}
                onClick={() => {
                  go({
                    ...(person !== null && picking && { userId: person }),
                    month: shiftMonth(month, 1),
                  });
                }}
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
            {person === null ? (
              <p className="text-muted">{t('attendance.month.empty')}</p>
            ) : (
              <LoadGate queries={[view]}>
                {() =>
                  view.data && (
                    <>
                      <MonthGrid days={view.data.days} />
                      <MonthCountsCard month={view.data} />
                    </>
                  )
                }
              </LoadGate>
            )}
          </div>
        )}
      </LoadGate>
    </div>
  );
}
