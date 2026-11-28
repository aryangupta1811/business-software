import { formatPaise, type OverdueBucket, type UdhaarSummaryView } from '@business-software/shared';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { cn } from '../lib/cn';
import { useDateWords } from '../lib/dates';
import { useSummary } from './api';

/** How worried each bucket looks: the later it is, the stronger the colour (and always words). */
const BUCKET_TONE: Record<OverdueBucket, string> = {
  days_1_30: 'border-warning bg-warning-soft',
  days_31_60: 'border-warning bg-warning-soft',
  days_61_90: 'border-danger bg-danger-soft',
  days_over_90: 'border-danger bg-danger-soft',
};

/**
 * Udhaar at a glance (P1.19; `03` #12, #13): what is owed by how late it is, what was collected
 * in the last seven days, and who owes the most. Every figure comes from the server's
 * `unpaidEntries`; this only lays it out.
 */
export function Overview() {
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
  return <Panels view={summary.data} />;
}

function Panels({ view }: { view: UdhaarSummaryView }) {
  const { t } = useTranslation();
  const dates = useDateWords();
  return (
    <section aria-label={t('udhaar.views.title')} className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{t('udhaar.views.overdue.title')}</CardTitle>
            <p className="text-label text-muted">
              {t('udhaar.views.overdue.of', { owed: formatPaise(view.owedPaise) })}
            </p>
          </div>
          <p
            data-testid="overdue-total"
            className={cn(
              'text-figure font-semibold tabular-nums',
              view.overduePaise > 0 && 'text-danger',
            )}
          >
            {formatPaise(view.overduePaise)}
          </p>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-5 gap-2">
            <li className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface-muted p-3">
              <span className="text-label text-muted">{t('udhaar.views.notDue')}</span>
              <span className="font-semibold tabular-nums">{formatPaise(view.notDuePaise)}</span>
            </li>
            {view.buckets.map((bucket) => (
              <li
                key={bucket.bucket}
                data-testid={bucket.bucket}
                className={cn(
                  'flex flex-col gap-0.5 rounded-lg border p-3',
                  bucket.paise > 0 ? BUCKET_TONE[bucket.bucket] : 'border-border bg-surface-muted',
                )}
              >
                <span className="text-label text-muted">
                  {t(`udhaar.views.buckets.${bucket.bucket}`)}
                </span>
                <span className="font-semibold tabular-nums">{formatPaise(bucket.paise)}</span>
                <span className="text-label text-muted">
                  {t('udhaar.views.customers', { count: bucket.customers })}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('udhaar.views.collected.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <p
            data-testid="collected"
            className="text-figure font-semibold text-success tabular-nums"
          >
            {formatPaise(view.collected.paise)}
          </p>
          <p className="text-label text-muted">
            {t('udhaar.views.collected.payments', { count: view.collected.payments })}
          </p>
          <p className="text-label text-muted">
            {t('udhaar.views.collected.range', {
              from: dates.day(view.collected.fromDate),
              to: dates.day(view.collected.toDate),
            })}
          </p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>{t('udhaar.views.top.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {view.topOwing.length === 0 ? (
            <p className="text-muted">{t('udhaar.views.top.none')}</p>
          ) : (
            <ol className="flex flex-col divide-y divide-border">
              {view.topOwing.map((row, index) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="w-5 text-right text-muted tabular-nums">{index + 1}</span>
                    <Link
                      to="/customers/$id"
                      params={{ id: row.id }}
                      className="truncate font-medium text-foreground hover:underline"
                    >
                      {row.name}
                    </Link>
                  </span>
                  <span className="flex items-center gap-3 tabular-nums">
                    {row.overduePaise > 0 && (
                      <Badge tone="danger">
                        {t('udhaar.views.top.overdue', { amount: formatPaise(row.overduePaise) })}
                      </Badge>
                    )}
                    <span className="min-w-24 text-right font-semibold">
                      {formatPaise(row.balancePaise)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
