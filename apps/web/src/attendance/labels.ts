import {
  MAX_OVERTIME_MINUTES,
  OVERTIME_STEP_MINUTES,
  type AttendanceStatus,
  type DayCounts,
} from '@business-software/shared';
import type { TFunction } from 'i18next';

/** Colour only adds to the words on a chip or a day (it never carries the meaning alone). */
export const STATUS_TONE: Record<AttendanceStatus, string> = {
  present: 'bg-success-soft text-success',
  half_day: 'bg-warning-soft text-warning',
  absent: 'bg-danger-soft text-danger',
  paid_leave: 'bg-surface-muted text-accent',
  weekly_off: 'bg-surface-muted text-muted',
  holiday: 'bg-surface-muted text-muted',
};

/** "2 absent, 1 on leave", or "Everyone is in": the register's header (the summary's line, `07` #13). */
export function countsText(t: TFunction, counts: DayCounts): string {
  const parts = [
    counts.absent > 0 ? t('attendance.counts.absent', { count: counts.absent }) : null,
    counts.halfDay > 0 ? t('attendance.counts.halfDay', { count: counts.halfDay }) : null,
    counts.paidLeave > 0 ? t('attendance.counts.onLeave', { count: counts.paidLeave }) : null,
  ].filter((part) => part !== null);
  return parts.length === 0 ? t('attendance.counts.everyoneIn') : parts.join(', ');
}

/** The overtime a day can carry: half-hour steps up to 12 hours, as the server allows. */
export const OVERTIME_CHOICES = Array.from(
  { length: MAX_OVERTIME_MINUTES / OVERTIME_STEP_MINUTES },
  (_, index) => (index + 1) * OVERTIME_STEP_MINUTES,
);

/** Minutes as hours for people: 90 → 1.5. */
export const hoursOf = (minutes: number): number => minutes / 60;
