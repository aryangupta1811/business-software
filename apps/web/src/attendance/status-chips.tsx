import { ATTENDANCE_STATUSES, type AttendanceStatus } from '@business-software/shared';
import { useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn';
import { STATUS_TONE } from './labels';

/**
 * One person's status for the day (`05` #6): six chips, one picked. The group is a single stop
 * on the Tab key: the arrows move between the chips and Enter or Space picks, so moving never
 * saves anything by accident.
 */
export function StatusChips({
  name,
  value,
  disabled,
  onPick,
}: {
  name: string;
  value: AttendanceStatus;
  disabled: boolean;
  onPick: (status: AttendanceStatus) => void;
}) {
  const { t } = useTranslation();
  const chips = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (event: KeyboardEvent, from: number) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    chips.current[Math.min(Math.max(from + step, 0), ATTENDANCE_STATUSES.length - 1)]?.focus();
  };

  return (
    <div
      role="group"
      aria-label={t('attendance.statusFor', { name })}
      className="flex flex-wrap gap-1.5"
    >
      {ATTENDANCE_STATUSES.map((status, index) => {
        const picked = status === value;
        return (
          <button
            key={status}
            ref={(element) => {
              chips.current[index] = element;
            }}
            type="button"
            aria-pressed={picked}
            tabIndex={picked ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              if (!picked) onPick(status);
            }}
            onKeyDown={(event) => {
              move(event, index);
            }}
            className={cn(
              'h-9 rounded-lg border px-2.5 text-label whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60',
              picked
                ? cn(STATUS_TONE[status], 'border-current font-semibold')
                : 'border-border text-muted hover:bg-surface-muted',
            )}
          >
            {t(`attendance.status.${status}`)}
          </button>
        );
      })}
    </div>
  );
}
