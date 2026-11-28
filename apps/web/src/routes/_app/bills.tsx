import {
  businessDate,
  formatPaise,
  type BillListItem,
  type PrintSize,
} from '@business-software/shared';
import { createFileRoute } from '@tanstack/react-router';
import { FileText, MessageCircle, Printer, Search } from 'lucide-react';
import { useDeferredValue, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../api/session';
import { useBills } from '../../bills/use-bills';
import { useBranchScope } from '../../branches/branch-scope-context';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Kbd } from '../../components/ui/kbd';
import { cn } from '../../lib/cn';
import { printSavedBill, sendOnWhatsApp } from '../../printing/actions';
import { useShortcut } from '../../shortcuts/use-shortcut';
import { LoadGate } from '../../staff/load-gate';

/**
 * The Bills page (P1.15 design section 4; `02` #32): the branch's bills, newest first, today's by
 * default, with the same printing and sharing keys as the counter's "Bill saved" panel. Staff
 * see their own branch's bills; the owner picks a branch or sees them all.
 */
export const Route = createFileRoute('/_app/bills')({
  component: Bills,
  staticData: { titleKey: 'nav.bills', permission: 'billing.sell', branchPicker: true },
});

type Action = 'idle' | 'busy' | 'printFailed' | 'noPhone' | 'whatsAppFailed';

function Bills() {
  const { t, i18n } = useTranslation();
  const session = useSession().data;
  const receiptSize = session?.state === 'active' ? session.printing.receiptSize : 80;
  const scope = useBranchScope();
  const today = businessDate(new Date());
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [chosen, setChosen] = useState<string | null>(null);
  const [action, setAction] = useState<Action>('idle');
  const searchId = useId();
  const bills = useBills({
    q: useDeferredValue(search),
    from,
    to,
    branch: scope.param,
  });
  const rows = bills.data?.pages.flatMap((page) => page.bills) ?? [];
  const selected = rows.find((row) => row.id === chosen) ?? rows[0];
  const showBranch = rows.some((row) => row.branchId !== rows[0]?.branchId);

  const when = new Intl.DateTimeFormat(i18n.language === 'hi' ? 'hi-IN' : 'en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });

  /** Every print from this page is a reprint: a copy of a bill that was saved before. */
  async function print(size: PrintSize) {
    if (selected === undefined || action === 'busy') return;
    setAction('busy');
    try {
      await printSavedBill({ id: selected.id, size, receiptSize, reprint: true });
      setAction('idle');
    } catch {
      setAction('printFailed');
    }
  }

  async function share() {
    if (selected === undefined || action === 'busy') return;
    setAction('busy');
    try {
      setAction((await sendOnWhatsApp(selected.id)) ? 'idle' : 'noPhone');
    } catch {
      setAction('whatsAppFailed');
    }
  }

  useShortcut({
    keys: 'Alt+P',
    description: 'shortcuts.billPrintReceipt',
    group: 'general',
    action: () => void print(receiptSize === 80 ? '80' : '58'),
  });
  useShortcut({
    keys: 'Alt+A',
    description: 'shortcuts.billPrintA4',
    group: 'general',
    action: () => void print('a4'),
  });
  useShortcut({
    keys: 'Alt+W',
    description: 'shortcuts.billWhatsApp',
    group: 'general',
    action: () => void share(),
  });

  const clearDates = from !== '' || to !== '';

  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <p className="text-muted">{t('bills.lead')}</p>
      <div className="flex flex-wrap items-end gap-4">
        <div className="relative min-w-64 flex-1">
          <label htmlFor={searchId} className="mb-1 block text-label font-medium">
            {t('bills.search')}
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute bottom-3 left-3 size-4 text-muted"
          />
          <Input
            id={searchId}
            type="search"
            className="pl-9"
            placeholder={t('bills.searchHint')}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </div>
        <Field label={t('bills.from')}>
          {(props) => (
            <Input
              {...props}
              type="date"
              max={to === '' ? undefined : to}
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
              }}
              className="w-44"
            />
          )}
        </Field>
        <Field label={t('bills.to')}>
          {(props) => (
            <Input
              {...props}
              type="date"
              min={from === '' ? undefined : from}
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
              }}
              className="w-44"
            />
          )}
        </Field>
        {clearDates && (
          <Button
            variant="ghost"
            onClick={() => {
              setFrom('');
              setTo('');
            }}
          >
            {t('bills.allDates')}
          </Button>
        )}
      </div>

      <LoadGate queries={[bills]}>
        {() => (
          <>
            {selected !== undefined && (
              <div
                role="toolbar"
                aria-label={t('bills.actionsFor', { number: selected.number })}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3"
              >
                <p className="mr-auto font-medium">
                  {t('bills.selected', { number: selected.number })}
                </p>
                <Button
                  variant="secondary"
                  disabled={action === 'busy'}
                  aria-keyshortcuts="Alt+P"
                  onClick={() => void print(receiptSize === 80 ? '80' : '58')}
                >
                  <Printer aria-hidden="true" />
                  {t('billing.save.printReceipt', { size: receiptSize })}
                  <Kbd aria-hidden="true">Alt+P</Kbd>
                </Button>
                <Button
                  variant="secondary"
                  disabled={action === 'busy'}
                  aria-keyshortcuts="Alt+A"
                  onClick={() => void print('a4')}
                >
                  <FileText aria-hidden="true" />
                  {t('billing.save.printA4')}
                  <Kbd aria-hidden="true">Alt+A</Kbd>
                </Button>
                <Button
                  variant="secondary"
                  disabled={action === 'busy'}
                  aria-keyshortcuts="Alt+W"
                  onClick={() => void share()}
                >
                  <MessageCircle aria-hidden="true" />
                  {t('billing.save.whatsApp')}
                  <Kbd aria-hidden="true">Alt+W</Kbd>
                </Button>
                {action !== 'idle' && action !== 'busy' && (
                  <p role="alert" className="basis-full text-label text-danger">
                    {t(`billing.save.${action}`)}
                  </p>
                )}
              </div>
            )}
            {rows.length === 0 ? (
              <Card className="px-5 py-10 text-center text-muted">{t('bills.empty')}</Card>
            ) : (
              <Card className="overflow-hidden">
                <table className="w-full text-left">
                  <caption className="sr-only">{t('nav.bills')}</caption>
                  <thead className="border-b border-border text-label text-muted">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-medium">
                        {t('bills.columns.bill')}
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        {t('bills.columns.when')}
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        {t('bills.columns.customer')}
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        {t('bills.columns.paidBy')}
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        {t('bills.columns.total')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border tabular-nums">
                    {rows.map((row) => (
                      <BillRow
                        key={row.id}
                        row={row}
                        selected={row.id === selected?.id}
                        showBranch={showBranch}
                        when={when.format(new Date(row.createdAt))}
                        onSelect={() => {
                          setChosen(row.id);
                          setAction('idle');
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
            {bills.hasNextPage && (
              <div>
                <Button
                  variant="secondary"
                  disabled={bills.isFetchingNextPage}
                  onClick={() => void bills.fetchNextPage()}
                >
                  {t('bills.more')}
                </Button>
              </div>
            )}
          </>
        )}
      </LoadGate>
    </div>
  );
}

function BillRow({
  row,
  selected,
  showBranch,
  when,
  onSelect,
}: {
  row: BillListItem;
  selected: boolean;
  showBranch: boolean;
  when: string;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <tr className={cn('hover:bg-surface-muted', selected && 'bg-surface-muted')}>
      <td className="px-4 py-2.5">
        <button
          type="button"
          aria-pressed={selected}
          onClick={onSelect}
          className="font-medium text-foreground hover:underline"
        >
          {row.number}
        </button>
        <div className="flex items-center gap-2 text-label text-muted">
          {t(`bills.documents.${row.document}`)}
          {showBranch && <Badge tone="info">{row.branchCode}</Badge>}
        </div>
      </td>
      <td className="px-4 py-2.5 text-muted">{when}</td>
      <td className="px-4 py-2.5">
        {row.customerName ?? <span className="text-muted">{t('bills.walkIn')}</span>}
        {row.customerPhone !== null && (
          <div className="text-label text-muted">{row.customerPhone}</div>
        )}
      </td>
      <td className="px-4 py-2.5 text-muted">
        {row.paymentModes.map((mode) => t(`billing.payment.modes.${mode}`)).join(', ')}
      </td>
      <td className="px-4 py-2.5 text-right font-medium">{formatPaise(row.grandTotalPaise)}</td>
    </tr>
  );
}
