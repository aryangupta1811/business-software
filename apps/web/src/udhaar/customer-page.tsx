import {
  businessDate,
  formatPaise,
  type UdhaarEntryView,
  type UdhaarLedgerView,
  type UdhaarMoveView,
} from '@business-software/shared';
import {
  useQueryClient,
  type UseInfiniteQueryResult,
  type InfiniteData,
} from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, HandCoins } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ApiError } from '../api/client';
import { useSession } from '../api/session';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Kbd, KbdGroup } from '../components/ui/kbd';
import { QueryGate } from '../items/query-gate';
import { cn } from '../lib/cn';
import { useDateWords } from '../lib/dates';
import { keyLabels } from '../shortcuts/keys';
import { useShortcut } from '../shortcuts/use-shortcut';
import { UDHAAR_KEY, useLedger } from './api';
import { OpeningDialog, ReverseDialog, TermsDialog } from './owner-dialogs';
import { PaymentDialog } from './payment-dialog';
import { balanceKind, daysOverdue, limitUsedPercent } from './standing';

const PAY_KEYS = 'Alt+P';

/**
 * One customer's udhaar page (P1.18 design §7): the balance in large type, what is still
 * unpaid with its due dates, and the ledger with the balance after each line. Anyone who sells
 * records payments; only the owner changes the credit terms, reverses a payment or enters the
 * old notebook's balance (`03` #20, #21, #24).
 */
export function CustomerPage({ id }: { id: string }) {
  const ledger = useLedger(id);
  if (ledger.error instanceof ApiError && ledger.error.status === 404) return <NotFound />;
  return (
    <QueryGate queries={[ledger]}>
      {() => {
        const first = ledger.data?.pages[0];
        return first === undefined ? null : <Loaded id={id} ledger={ledger} first={first} />;
      }}
    </QueryGate>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{t('udhaar.notFound.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3 text-muted">
        <p>{t('udhaar.notFound.body')}</p>
        <Link to="/customers" className="text-accent underline-offset-4 hover:underline">
          {t('udhaar.back')}
        </Link>
      </CardContent>
    </Card>
  );
}

function Loaded({
  id,
  ledger,
  first,
}: {
  id: string;
  ledger: UseInfiniteQueryResult<InfiniteData<UdhaarLedgerView>>;
  first: UdhaarLedgerView;
}) {
  const { t } = useTranslation();
  const dates = useDateWords();
  const queryClient = useQueryClient();
  const session = useSession().data;
  const permissions = session?.state === 'active' ? session.permissions : [];
  const canRecord = permissions.includes('billing.sell');
  // `settings.manage` is a switch no staff login can hold: it is the owner's.
  const isOwner = permissions.includes('settings.manage');
  const today = businessDate(new Date());
  const { customer } = first;
  const entries = (ledger.data?.pages ?? []).flatMap((page) => page.entries);
  const reversed = new Set(entries.flatMap((entry) => entry.reversesEntryId ?? []));
  const hasOpening = entries.some((entry) => entry.kind === 'opening');

  const [paying, setPaying] = useState(false);
  const [reversing, setReversing] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: UDHAAR_KEY });

  useShortcut({
    keys: PAY_KEYS,
    description: 'shortcuts.recordPayment',
    group: 'general',
    action: () => {
      if (canRecord) setPaying(true);
    },
  });

  const saved = (moved: UdhaarMoveView, message: 'paymentSaved' | 'reversed' | 'openingSaved') => {
    setPaying(false);
    setReversing(null);
    setOpening(false);
    setNotice(t(`udhaar.notice.${message}`, { amount: formatBalance(t, moved.balancePaise) }));
    void refresh();
  };

  const used = limitUsedPercent(first.balancePaise, first.creditLimitPaise);
  const kind = balanceKind(first.balancePaise);

  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <Link
        to="/customers"
        className="inline-flex items-center gap-1.5 self-start text-accent underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('udhaar.back')}
      </Link>

      {notice !== null && (
        <p role="status" className="rounded-lg bg-success-soft px-4 py-3 text-success">
          {notice}
        </p>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-6 px-6 py-5">
          <div className="min-w-0">
            <h2 className="truncate text-title font-semibold">{customer.name}</h2>
            <p className="text-muted tabular-nums">
              {customer.phone ?? t('udhaar.noPhone')}
              {customer.gstin !== null &&
                ` · ${t('billing.customer.gstin', { gstin: customer.gstin })}`}
            </p>
            <div className="mt-4">
              <p className="text-label text-muted">{t(`udhaar.page.balanceLabel.${kind}`)}</p>
              <p
                data-testid="balance"
                className={cn(
                  'text-display font-semibold tabular-nums',
                  kind === 'owes' && 'text-warning',
                  kind === 'advance' && 'text-success',
                )}
              >
                {formatPaise(Math.abs(first.balancePaise))}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {isOwner && !hasOpening && (
              <Button
                variant="secondary"
                onClick={() => {
                  setOpening(true);
                }}
              >
                {t('udhaar.opening.button')}
              </Button>
            )}
            {canRecord && (
              <Button
                aria-keyshortcuts={PAY_KEYS}
                onClick={() => {
                  setPaying(true);
                }}
              >
                <HandCoins aria-hidden="true" />
                {t('udhaar.payment.button')}
                <KbdGroup aria-hidden="true" className="opacity-80">
                  {keyLabels(PAY_KEYS).map((label) => (
                    <Kbd key={label}>{label}</Kbd>
                  ))}
                </KbdGroup>
              </Button>
            )}
          </div>
        </CardContent>
        <dl className="grid grid-cols-3 gap-4 border-t border-border bg-surface-muted/50 px-6 py-4">
          <div>
            <dt className="text-label text-muted">{t('udhaar.terms.limit')}</dt>
            <dd className="font-medium tabular-nums">
              {first.creditLimitPaise === null
                ? t('udhaar.noLimit')
                : formatPaise(first.creditLimitPaise)}
            </dd>
            {used !== null && (
              <div
                role="meter"
                aria-label={t('udhaar.page.limitUsed')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={used}
                aria-valuetext={t('udhaar.page.limitUsedText', { percent: used })}
                className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
              >
                <div
                  className={cn('h-full rounded-full', used >= 100 ? 'bg-danger' : 'bg-primary')}
                  style={{ width: `${String(used)}%` }}
                />
              </div>
            )}
          </div>
          <div>
            <dt className="text-label text-muted">{t('udhaar.terms.days')}</dt>
            <dd className="font-medium tabular-nums">
              {t('udhaar.terms.daysValue', { count: first.dueDays })}
            </dd>
          </div>
          <div className="flex items-end justify-end">
            {isOwner && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(true);
                }}
              >
                {t('udhaar.terms.edit')}
              </Button>
            )}
          </div>
        </dl>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('udhaar.unpaid.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {first.unpaid.length === 0 ? (
            <p className="text-muted">
              {kind === 'advance' ? t('udhaar.unpaid.advance') : t('udhaar.unpaid.none')}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {first.unpaid.map(({ entry, unpaidPaise }) => {
                const late = entry.dueDate === null ? 0 : daysOverdue(entry.dueDate, today);
                return (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{entryTitle(t, entry)}</span>
                      <span className="text-label text-muted">
                        {t('udhaar.unpaid.given', { date: dates.day(entry.businessDate) })}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 tabular-nums">
                      {entry.dueDate !== null && (
                        <span className="text-muted">
                          {t('udhaar.unpaid.due', { date: dates.day(entry.dueDate) })}
                        </span>
                      )}
                      {late > 0 && (
                        <Badge tone="danger">{t('udhaar.daysLate', { count: late })}</Badge>
                      )}
                      <span className="min-w-24 text-right font-semibold">
                        {formatPaise(unpaidPaise)}
                      </span>
                      {unpaidPaise < entry.amountPaise && (
                        <span className="text-label text-muted">
                          {t('udhaar.unpaid.of', { amount: formatPaise(entry.amountPaise) })}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle>{t('udhaar.ledger.title')}</CardTitle>
        </CardHeader>
        <table className="w-full text-left">
          <caption className="sr-only">{t('udhaar.ledger.title')}</caption>
          <thead className="border-y border-border text-label text-muted">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">
                {t('udhaar.ledger.columns.date')}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                {t('udhaar.ledger.columns.what')}
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                {t('udhaar.ledger.columns.owed')}
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                {t('udhaar.ledger.columns.paid')}
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                {t('udhaar.ledger.columns.balance')}
              </th>
              {isOwner && (
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  <span className="sr-only">{t('udhaar.ledger.columns.actions')}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {entries.map((entry) => {
              const wasReversed = reversed.has(entry.id);
              return (
                <tr
                  key={entry.id}
                  className={cn('hover:bg-surface-muted', wasReversed && 'text-muted')}
                >
                  <td className="px-4 py-2.5 whitespace-nowrap">{dates.day(entry.businessDate)}</td>
                  <td className="px-4 py-2.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={cn(wasReversed && 'line-through')}>
                        {entryTitle(t, entry)}
                      </span>
                      {wasReversed && <Badge tone="warning">{t('udhaar.ledger.reversed')}</Badge>}
                    </span>
                    {(entry.reason !== null || entry.reference !== null) && (
                      <span className="block text-label text-muted">
                        {entry.reason ??
                          t('udhaar.ledger.reference', { reference: entry.reference })}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {entry.amountPaise > 0 ? formatPaise(entry.amountPaise) : ''}
                  </td>
                  <td className={cn('px-4 py-2.5 text-right', !wasReversed && 'text-success')}>
                    {entry.amountPaise < 0 ? formatPaise(-entry.amountPaise) : ''}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium">
                    {formatBalance(t, entry.balanceAfterPaise)}
                  </td>
                  {isOwner && (
                    <td className="px-4 py-2.5 text-right">
                      {entry.kind === 'payment' && !wasReversed && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setReversing(entry.id);
                          }}
                        >
                          {t('udhaar.reverse.button')}
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {entries.length === 0 && (
          <p className="px-4 py-8 text-center text-muted">{t('udhaar.ledger.empty')}</p>
        )}
        {ledger.hasNextPage && (
          <div className="flex justify-center border-t border-border p-3">
            <Button
              variant="secondary"
              disabled={ledger.isFetchingNextPage}
              onClick={() => void ledger.fetchNextPage()}
            >
              {t('udhaar.ledger.older')}
            </Button>
          </div>
        )}
      </Card>

      <PaymentDialog
        open={paying}
        customerId={id}
        customerName={customer.name}
        balancePaise={first.balancePaise}
        onSaved={(moved) => {
          saved(moved, 'paymentSaved');
        }}
        onClose={() => {
          setPaying(false);
        }}
      />
      <ReverseDialog
        paymentId={reversing}
        onDone={(moved) => {
          saved(moved, 'reversed');
        }}
        onClose={() => {
          setReversing(null);
        }}
      />
      <OpeningDialog
        open={opening}
        customerId={id}
        today={today}
        onDone={(moved) => {
          saved(moved, 'openingSaved');
        }}
        onClose={() => {
          setOpening(false);
        }}
      />
      <TermsDialog
        open={editing}
        customer={customer}
        onSaved={() => {
          setEditing(false);
          setNotice(t('udhaar.notice.termsSaved'));
          void refresh();
        }}
        onClose={() => {
          setEditing(false);
        }}
      />
    </div>
  );
}

/** "₹1,240 owed", "₹300 advance" or "₹0". */
function formatBalance(t: TFunction, paise: number): string {
  if (paise === 0) return formatPaise(0);
  return t(`udhaar.balance.${paise > 0 ? 'amountOwed' : 'amountAdvance'}`, {
    amount: formatPaise(Math.abs(paise)),
  });
}

/** What a ledger line is, in words. */
function entryTitle(t: TFunction, entry: UdhaarEntryView): string {
  switch (entry.kind) {
    case 'bill':
      return entry.billNumber === null
        ? t('udhaar.entry.billPlain')
        : t('udhaar.entry.bill', { number: entry.billNumber });
    case 'advance_used':
      return entry.billNumber === null
        ? t('udhaar.entry.advanceUsedPlain')
        : t('udhaar.entry.advanceUsed', { number: entry.billNumber });
    case 'payment':
      return t('udhaar.entry.payment', {
        mode: entry.mode === null ? '' : t(`billing.payment.modes.${entry.mode}`),
      });
    case 'payment_reversal':
      return t('udhaar.entry.reversal');
    case 'opening':
      return t('udhaar.entry.opening');
  }
}
