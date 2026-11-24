import type { MarkedDay, RegisterRow } from '@business-software/shared';
import { useTranslation } from 'react-i18next';
import { Select } from '../components/ui/select';
import { hoursOf, OVERTIME_CHOICES } from './labels';
import { StatusChips } from './status-chips';

/**
 * One person on the register (`05` #5, #6): their status for the day, and for a present day a
 * late tick and, if they have overtime on, the overtime hours. Away from present, late and
 * overtime are cleared, because the server only accepts them on a present day.
 */
export function RegisterRowItem({
  row,
  mine,
  busy,
  onChange,
}: {
  row: RegisterRow;
  /** The logged-in person's own row: nobody marks their own attendance (`05` #5). */
  mine: boolean;
  busy: boolean;
  onChange: (next: MarkedDay) => void;
}) {
  const { t } = useTranslation();
  const locked = mine || busy;
  const present = row.status === 'present';
  return (
    <li
      aria-label={row.name}
      className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 hover:bg-surface-muted/40"
    >
      <div className="flex w-44 shrink-0 flex-col">
        <span className="truncate font-medium">{row.name}</span>
        {mine && <span className="text-label text-muted">{t('attendance.own')}</span>}
        {row.paidLeavesPerMonth > 0 && (
          <span className="text-label text-muted">
            {t('attendance.leavesUsed', {
              used: row.paidLeavesUsed,
              total: row.paidLeavesPerMonth,
            })}
          </span>
        )}
      </div>
      <StatusChips
        name={row.name}
        value={row.status}
        disabled={locked}
        onPick={(status) => {
          onChange({
            status,
            late: status === 'present' && row.late,
            overtimeMinutes: status === 'present' ? row.overtimeMinutes : 0,
          });
        }}
      />
      {present && (
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-label">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              aria-label={t('attendance.lateFor', { name: row.name })}
              checked={row.late}
              disabled={locked}
              onChange={(event) => {
                onChange({
                  status: 'present',
                  late: event.target.checked,
                  overtimeMinutes: row.overtimeMinutes,
                });
              }}
            />
            {t('attendance.late')}
          </label>
          {row.overtimeAllowed && (
            <Select
              aria-label={t('attendance.overtimeFor', { name: row.name })}
              className="h-9 w-auto py-0 text-label"
              value={row.overtimeMinutes}
              disabled={locked}
              onChange={(event) => {
                onChange({
                  status: 'present',
                  late: row.late,
                  overtimeMinutes: Number(event.target.value),
                });
              }}
            >
              <option value={0}>{t('attendance.noOvertime')}</option>
              {OVERTIME_CHOICES.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {t('attendance.hours', { count: hoursOf(minutes) })}
                </option>
              ))}
            </Select>
          )}
        </div>
      )}
    </li>
  );
}
