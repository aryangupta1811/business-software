import { businessDate, formatPaise, type UdhaarCustomerRow } from '@business-software/shared';
import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { useDateWords } from '../lib/dates';
import { useShortcut } from '../shortcuts/use-shortcut';
import { useUdhaarCustomers } from './api';
import { BalanceBadge } from './balance';
import { Overview } from './overview';
import { Reminders } from './reminders';
import { daysOverdue } from './standing';

const SEARCH_DELAY_MS = 250;

export type CustomersTab = 'all' | 'reminders';

/**
 * The Customers page (P1.18 design §7): everyone with what they owe, the credit limit and the
 * oldest due date; "Owes money" keeps only those with a balance. P1.19 adds the overview above
 * the list and the Reminders tab. Customers are added at the counter (F3), where the bill needs them.
 */
export function CustomersPage({ tab }: { tab: CustomersTab }) {
  const { t } = useTranslation();
  const tabs: CustomersTab[] = ['all', 'reminders'];
  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label={t('udhaar.tabs.label')} className="flex gap-1">
        {tabs.map((name) => (
          <Link
            key={name}
            to="/customers"
            search={name === 'all' ? {} : { tab: name }}
            role="tab"
            aria-selected={tab === name}
            className="rounded-lg px-3 py-1.5 text-muted hover:bg-surface-muted aria-selected:bg-surface-muted aria-selected:font-semibold aria-selected:text-foreground"
          >
            {t(`udhaar.tabs.${name}`)}
          </Link>
        ))}
      </div>
      {tab === 'all' ? (
        <>
          <Overview />
          <CustomerList />
        </>
      ) : (
        <Reminders />
      )}
    </div>
  );
}

function CustomerList() {
  const { t } = useTranslation();
  const searchRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [owing, setOwing] = useState(false);

  // Ask the server once typing pauses, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(typed.trim());
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [typed]);

  useShortcut({
    keys: '/',
    description: 'shortcuts.searchCustomers',
    group: 'general',
    action: () => searchRef.current?.focus(),
  });

  const list = useUdhaarCustomers({ q, owing });
  const rows = list.data?.pages.flatMap((page) => page.customers) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-72 flex-1">
          <label htmlFor={searchId} className="sr-only">
            {t('udhaar.list.search')}
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-3 left-3 size-4 text-muted"
          />
          <Input
            ref={searchRef}
            id={searchId}
            type="search"
            aria-keyshortcuts="/"
            placeholder={t('udhaar.list.searchPlaceholder')}
            className="pl-9"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
          />
        </div>
        <label className="flex h-10 items-center gap-2 text-muted">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={owing}
            onChange={(event) => {
              setOwing(event.target.checked);
            }}
          />
          {t('udhaar.list.owingOnly')}
        </label>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-left">
          <caption className="sr-only">{t('nav.customers')}</caption>
          <thead className="border-b border-border text-label text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                {t('udhaar.list.columns.name')}
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                {t('udhaar.list.columns.phone')}
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                {t('udhaar.list.columns.balance')}
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                {t('udhaar.list.columns.limit')}
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                {t('udhaar.list.columns.due')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {rows.map((row) => (
              <CustomerRow key={row.id} row={row} />
            ))}
          </tbody>
        </table>
        {list.isPending && <p className="px-4 py-6 text-muted">{t('udhaar.loading')}</p>}
        {list.isError && (
          <div role="alert" className="flex items-center gap-3 px-4 py-4">
            <p>{t('udhaar.loadFailed')}</p>
            <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
              {t('udhaar.retry')}
            </Button>
          </div>
        )}
        {list.isSuccess && rows.length === 0 && (
          <p className="px-4 py-10 text-center text-muted">
            {q || owing ? t('udhaar.list.noMatches') : t('udhaar.list.empty')}
          </p>
        )}
      </Card>
      {list.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t('udhaar.list.more')}
        </Button>
      )}
    </div>
  );
}

function CustomerRow({ row }: { row: UdhaarCustomerRow }) {
  const { t } = useTranslation();
  const dates = useDateWords();
  const today = businessDate(new Date());
  const late = row.oldestDueDate === null ? 0 : daysOverdue(row.oldestDueDate, today);
  return (
    <tr className="hover:bg-surface-muted">
      <td className="px-4 py-2.5">
        <Link
          to="/customers/$id"
          params={{ id: row.id }}
          className="font-medium text-foreground hover:underline"
        >
          {row.name}
        </Link>
      </td>
      <td className="px-4 py-2.5 text-muted">{row.phone}</td>
      <td className="px-4 py-2.5 text-right">
        <BalanceBadge paise={row.balancePaise} />
      </td>
      <td className="px-4 py-2.5 text-right text-muted">
        {row.creditLimitPaise === null ? t('udhaar.noLimit') : formatPaise(row.creditLimitPaise)}
      </td>
      <td className="px-4 py-2.5">
        {row.oldestDueDate !== null && (
          <span className="inline-flex flex-wrap items-center gap-2">
            {dates.day(row.oldestDueDate)}
            {late > 0 && <Badge tone="danger">{t('udhaar.daysLate', { count: late })}</Badge>}
          </span>
        )}
      </td>
    </tr>
  );
}
