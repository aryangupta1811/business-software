import {
  ALERT_SEVERITY,
  ALERT_TYPES,
  BUILT_IN_UNITS,
  type ActiveSession,
  type AlertType,
  type AlertView,
  type BuiltInUnit,
} from '@business-software/shared';
import { Link } from '@tanstack/react-router';
import { Bell } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Kbd, KbdGroup } from '../components/ui/kbd';
import { unitName } from '../items/labels';
import { quantityText } from '../items/stock-form';
import { keyLabels } from '../shortcuts/keys';
import { useShortcut } from '../shortcuts/use-shortcut';
import { useAlerts, useDismissAlert } from './api';

const BELL_KEYS = 'Alt+K';
/** The count stops at 99+ so a long list never widens the top bar. */
const COUNT_CAP = 99;
/** Worst first: out of stock above low on stock. */
const TYPES_WORST_FIRST = [...ALERT_TYPES].sort((a, b) => ALERT_SEVERITY[b] - ALERT_SEVERITY[a]);

/**
 * The bell in the top bar (Module 07 #6, #18; design §7): a count of what this person hasn't
 * dismissed, and a panel that opens only when it is clicked or its key is pressed. It never
 * makes a sound, a pop-up or a toast, so it is the same on the billing page.
 */
export function AlertsBell({ session }: { session: ActiveSession }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const alerts = useAlerts();
  const total = alerts.data?.total ?? 0;
  useShortcut({
    keys: BELL_KEYS,
    description: 'shortcuts.openAlerts',
    group: 'general',
    action: () => {
      setOpen(true);
    },
  });
  const close = () => {
    setOpen(false);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-keyshortcuts={BELL_KEYS}
        aria-label={t('alerts.bell', { count: total })}
        title={t('alerts.title')}
        onClick={() => {
          setOpen(true);
        }}
        className="relative"
      >
        <Bell aria-hidden="true" />
        {total > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full bg-danger-strong px-1 text-[11px] leading-5 font-semibold text-on-primary"
          >
            {total > COUNT_CAP ? `${String(COUNT_CAP)}+` : total}
          </span>
        )}
      </Button>
      <Dialog open={open} title={t('alerts.title')} onClose={close} wide>
        <AlertsPanel session={session} onClose={close} />
      </Dialog>
    </>
  );
}

function AlertsPanel({ session, onClose }: { session: ActiveSession; onClose: () => void }) {
  const { t } = useTranslation();
  const alerts = useAlerts();
  const data = alerts.data;
  // The owner's branch count; a staff login sees one branch only, so there is nothing to tell apart.
  const showBranch = (session.branchCount ?? 1) >= 2;
  const groups = TYPES_WORST_FIRST.map((type) => ({
    type,
    count: data?.counts[type] ?? 0,
    rows: data?.alerts.filter((row) => row.type === type) ?? [],
  })).filter((group) => group.count > 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex max-h-[60vh] flex-col gap-5 overflow-y-auto">
        {data === undefined ? (
          <p className="text-muted">{t(alerts.isError ? 'alerts.loadFailed' : 'alerts.loading')}</p>
        ) : groups.length === 0 ? (
          <p className="text-muted">{t('alerts.empty')}</p>
        ) : (
          groups.map((group) => (
            <AlertGroup
              key={group.type}
              type={group.type}
              count={group.count}
              rows={group.rows}
              showBranch={showBranch}
              canOpenItem={session.permissions.includes('items.view')}
              onOpenItem={onClose}
            />
          ))
        )}
        {data !== undefined && data.total > data.alerts.length && (
          <p className="text-label text-muted">
            {t('alerts.truncated', { shown: data.alerts.length })}
          </p>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <KbdGroup aria-hidden="true">
          {keyLabels(BELL_KEYS).map((label) => (
            <Kbd key={label}>{label}</Kbd>
          ))}
        </KbdGroup>
        <Button variant="secondary" onClick={onClose}>
          {t('alerts.close')}
        </Button>
      </div>
    </div>
  );
}

function AlertGroup({
  type,
  count,
  rows,
  showBranch,
  canOpenItem,
  onOpenItem,
}: {
  type: AlertType;
  count: number;
  rows: AlertView[];
  showBranch: boolean;
  canOpenItem: boolean;
  onOpenItem: () => void;
}) {
  const { t, i18n } = useTranslation();
  const dismiss = useDismissAlert();
  const headingId = `alerts-group-${type}`;
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="text-label font-medium text-muted">
        {t(`alerts.groups.${type}`, { count })}
      </h3>
      <ul className="mt-2 divide-y divide-border">
        {rows.map((row) => {
          const name =
            i18n.language === 'hi' && row.itemHindiName ? row.itemHindiName : row.itemName;
          return (
            <li key={row.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                {canOpenItem ? (
                  <Link
                    to="/items/$id"
                    params={{ id: row.subjectId }}
                    onClick={onOpenItem}
                    className="block truncate font-semibold text-accent hover:underline"
                  >
                    {name}
                  </Link>
                ) : (
                  <span className="block truncate font-semibold">{name}</span>
                )}
                <p className="text-label text-muted">
                  {t('alerts.stockLine', {
                    stock: quantity(t, row.details.quantity, row.stockUnit),
                    level:
                      row.details.level === null
                        ? t('alerts.noLevel')
                        : quantity(t, row.details.level, row.stockUnit),
                  })}
                  {showBranch && ` · ${row.branchName}`}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={dismiss.isPending}
                aria-label={t('alerts.dismissItem', { name })}
                onClick={() => {
                  dismiss.mutate(row.id);
                }}
              >
                {t('alerts.dismiss')}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "12.5 kg": built-in units are translated, an owner's own unit keeps the name they typed. */
function quantity(t: Parameters<typeof unitName>[0], thousandths: number, unit: string): string {
  const name = (BUILT_IN_UNITS as readonly string[]).includes(unit)
    ? unitName(t, unit as BuiltInUnit)
    : unit;
  return `${quantityText(thousandths)} ${name}`;
}
