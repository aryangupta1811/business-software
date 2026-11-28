import { formatPaise, whatsAppLink, type UdhaarReminderRow } from '@business-software/shared';
import { Link } from '@tanstack/react-router';
import { MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../api/session';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { useDateWords } from '../lib/dates';
import { markReminderPrepared, useSummary } from './api';

/**
 * The reminder list (P1.19; `03` #15, #16, ADR 0049): the app prepares it, the owner reviews it,
 * and each row's "Send on WhatsApp" opens WhatsApp Web or Desktop with the number and the message
 * filled in. The owner presses send there; the app can't know it was sent, so the entry log only
 * records that a reminder was prepared.
 */
export function Reminders() {
  const { t } = useTranslation();
  const summary = useSummary();
  if (summary.isPending) return <p className="text-muted">{t('udhaar.loading')}</p>;
  if (summary.isError) {
    return (
      <div role="alert" className="flex items-center gap-3">
        <p>{t('udhaar.views.loadFailed')}</p>
        <Button variant="secondary" size="sm" onClick={() => void summary.refetch()}>
          {t('udhaar.retry')}
        </Button>
      </div>
    );
  }
  return <Table rows={summary.data.reminders} />;
}

function Table({ rows }: { rows: readonly UdhaarReminderRow[] }) {
  const { t } = useTranslation();
  const dates = useDateWords();
  const session = useSession().data;
  const shop = session?.state === 'active' ? session.business.name : '';
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());

  function send(row: UdhaarReminderRow) {
    if (row.phone === null) return;
    const text = t('udhaar.reminders.message', {
      name: row.name,
      shop,
      amount: formatPaise(row.balancePaise),
      date: dates.day(row.oldestDueDate),
    });
    window.open(whatsAppLink(row.phone, text), '_blank', 'noopener');
    setOpened((current) => new Set([...current, row.id]));
    // Logged as prepared, never as delivered; a failed log must not stop the owner's reminder.
    void markReminderPrepared(row.id).catch(() => undefined);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-3xl text-muted">{t('udhaar.reminders.lead')}</p>
      <Card className="overflow-hidden">
        <table className="w-full text-left">
          <caption className="sr-only">{t('udhaar.reminders.title')}</caption>
          <thead className="border-b border-border text-label text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                {t('udhaar.list.columns.name')}
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                {t('udhaar.list.columns.balance')}
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                {t('udhaar.reminders.columns.overdue')}
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                {t('udhaar.reminders.columns.since')}
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                <span className="sr-only">{t('udhaar.ledger.columns.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-surface-muted">
                <td className="px-4 py-2.5">
                  <Link
                    to="/customers/$id"
                    params={{ id: row.id }}
                    className="font-medium text-foreground hover:underline"
                  >
                    {row.name}
                  </Link>
                  <div className="text-label text-muted">{row.phone ?? t('udhaar.noPhone')}</div>
                </td>
                <td className="px-4 py-2.5 text-right">{formatPaise(row.balancePaise)}</td>
                <td className="px-4 py-2.5 text-right font-semibold">
                  {formatPaise(row.overduePaise)}
                </td>
                <td className="px-4 py-2.5">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {dates.day(row.oldestDueDate)}
                    <Badge tone="danger">{t('udhaar.daysLate', { count: row.daysLate })}</Badge>
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {opened.has(row.id) && (
                      <Badge tone="success">{t('udhaar.reminders.opened')}</Badge>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={row.phone === null}
                      aria-label={t('udhaar.reminders.sendNamed', { name: row.name })}
                      onClick={() => {
                        send(row);
                      }}
                    >
                      <MessageCircle aria-hidden="true" />
                      {t('udhaar.reminders.send')}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="px-4 py-10 text-center text-muted">{t('udhaar.reminders.none')}</p>
        )}
      </Card>
    </div>
  );
}
