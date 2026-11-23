import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

/** The register and the month view: two pages of one screen (P2.3 design §6). */
export function AttendanceTabs({ current }: { current: 'register' | 'month' }) {
  const { t } = useTranslation();
  const tab =
    'rounded-lg px-3 py-1.5 text-muted hover:bg-surface-muted aria-selected:bg-surface-muted aria-selected:font-semibold aria-selected:text-foreground';
  return (
    <div role="tablist" aria-label={t('attendance.tabs.label')} className="flex gap-1">
      <Link to="/attendance" role="tab" aria-selected={current === 'register'} className={tab}>
        {t('attendance.tabs.register')}
      </Link>
      <Link to="/attendance/month" role="tab" aria-selected={current === 'month'} className={tab}>
        {t('attendance.tabs.month')}
      </Link>
    </div>
  );
}
