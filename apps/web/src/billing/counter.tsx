import {
  addToCart,
  formatPaise,
  type ActiveSession,
  type Bill,
  type BillingContext,
  type CartLine,
  type CatalogueItem,
  type Discount,
  type HeldBillView,
  type PriceList,
  type ResumedBillView,
  type SavedBillView,
} from '@business-software/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Search, ShieldAlert } from 'lucide-react';
import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ApiError, apiRequest } from '../api/client';
import { Button } from '../components/ui/button';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { Input } from '../components/ui/input';
import { Kbd } from '../components/ui/kbd';
import { cn } from '../lib/cn';
import { formatQuantity, parseQuantity } from '../items/item-form';
import { unitName } from '../items/labels';
import { useScanner } from '../items/scan';
import { stockText } from '../items/stock-form';
import { useShortcut } from '../shortcuts/use-shortcut';
import { PaymentPanel, type PaymentRow } from './payment-panel';
import type { CatalogueCopy } from './catalogue-copy';
import { CustomerBox, CustomerSummary, type BillCustomer } from './customer-box';
import { ApprovalDialog, DiscountDialog, HeldBillsDialog, HoldDialog } from './dialogs';
import {
  approvalNeeded,
  clearApproval,
  discountLimit,
  loadApproval,
  saveApproval,
  withBillDiscount,
  withLineDiscount,
  type Approval,
} from './discounts';
import {
  fromCart,
  isLoose,
  loadCustomer,
  saveCustomer,
  lineProblem,
  loadOpenBill,
  parseEntry,
  priceOpenBill,
  quantityProblem,
  repriceBill,
  saveOpenBill,
  shortOfStock,
  startBill,
  type OpenBill,
} from './open-bill';
import { applyNewPrices, billDraft, saveBill, saveProblem, type SaveProblem } from './save-bill';

const RESULTS = 20;

/** What the line under the search box says after a scan or an Enter that added nothing. */
type Notice =
  | { kind: 'unknownCode'; code: string }
  | { kind: 'archived'; name: string }
  | { kind: 'noGst'; name: string }
  | { kind: 'wholeUnits'; name: string }
  | { kind: 'badQuantity' }
  | { kind: 'discardFailed' }
  | { kind: 'holdFailed' }
  | { kind: 'heldGone' };

const HELD_KEY = ['billing', 'held'] as const;

/** The clock, for an owner's OK running out while the bill is on screen. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, everyMs);
    return () => {
      clearInterval(timer);
    };
  }, [everyMs]);
  return now;
}

/**
 * The billing counter (P1.13 design §3, §5): scan or search, quantities, retail or wholesale,
 * and the totals straight from the GST engine. The search box keeps the focus; every action has
 * a key. The open bill survives a reload and the lock screen.
 */
export function Counter({
  session,
  context,
  copy,
  version,
  onReload,
}: {
  session: ActiveSession;
  context: BillingContext;
  copy: CatalogueCopy;
  /** Goes up when the copy changed. */
  version: number;
  /** Loads the whole copy again: the save said the prices changed. */
  onReload: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const searchRef = useRef<HTMLInputElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const resultsId = useId();
  const noticeId = useId();
  const [bill, setBill] = useState<OpenBill>(
    () => loadOpenBill(session.user.id) ?? startBill(context.branchStateCode),
  );
  const [selected, setSelected] = useState(() => bill.lines.length - 1);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [editing, setEditing] = useState<{ index: number; typed: string } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [changed, setChanged] = useState<ReadonlySet<number>>(new Set());
  const [confirmNew, setConfirmNew] = useState(false);
  const [discountFor, setDiscountFor] = useState<'line' | 'bill' | null>(null);
  const [approval, setApproval] = useState<Approval | null>(() => loadApproval(bill.billKey));
  const [asking, setAsking] = useState(false);
  const [holding, setHolding] = useState(false);
  const [listing, setListing] = useState(false);
  const [choosingCustomer, setChoosingCustomer] = useState(false);
  const [customer, setCustomer] = useState<BillCustomer | null>(() =>
    loadCustomer(bill.billKey, bill.customerId),
  );
  const [paying, setPaying] = useState(false);
  /** The payments of a fully paid bill, for the total they were taken against. */
  const [ready, setReady] = useState<{
    billKey: string;
    totalPaise: number;
    payments: PaymentRow[];
  } | null>(null);
  /** The held bill this one was resumed from; the save links to it (design §3.9). */
  const [heldFrom, setHeldFrom] = useState<{ id: string; billKey: string } | null>(null);
  const [saving, setSaving] = useState(false);
  /** Synchronous twin of `saving`: two Enters in one tick must not send twice. */
  const sending = useRef(false);
  const [saved, setSaved] = useState<SavedBillView | null>(null);
  const [problem, setProblem] = useState<SaveProblem | null>(null);
  /**
   * The bill can't change while it is sending, nor after a lost answer: that send may have been
   * saved, so only Enter (the same key) or Alt+N (a new bill, asked first) go on from there.
   */
  const locked = saving || problem?.kind === 'network';
  const queryClient = useQueryClient();
  const now = useNow(30_000);
  const held = useQuery({
    queryKey: HELD_KEY,
    queryFn: () => apiRequest<HeldBillView[]>('GET', '/api/held-bills'),
    refetchInterval: 60_000,
    retry: false,
  });

  useEffect(() => {
    saveOpenBill(session.user.id, bill);
  }, [session.user.id, bill]);

  // A sync brought new prices: the lines follow the copy, and the changed ones are marked.
  // (State adjusted while rendering when a prop changes, as React's docs recommend.)
  const [pricedAt, setPricedAt] = useState(version);
  if (pricedAt !== version) {
    setPricedAt(version);
    const repriced = repriceBill(bill, copy);
    if (repriced.changed.length > 0) {
      setBill(repriced.bill);
      setChanged(new Set([...changed, ...repriced.changed]));
    }
  }

  const deferredQuery = useDeferredValue(query);
  const results = useMemo(() => {
    const { query: text } = parseEntry(deferredQuery);
    return copy.search(text, RESULTS);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the copy changes in place; `version` says when
  }, [copy, deferredQuery, version]);

  const priced: Bill | null = useMemo(() => {
    return priceOpenBill(bill, context, copy);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the copy changes in place; `version` says when
  }, [bill, context, copy, version]);
  const short = useMemo(() => {
    return context.canViewStock ? shortOfStock(bill.lines, copy) : new Map<string, number>();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the copy changes in place; `version` says when
  }, [bill.lines, context.canViewStock, copy, version]);

  const limit = discountLimit(session, context);
  const needed = useMemo(
    () => approvalNeeded(bill, context, copy, limit, approval, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the copy changes in place; `version` says when
    [bill, context, copy, limit, approval, now, version],
  );

  const focusSearch = () => {
    setEditing(null);
    searchRef.current?.focus();
  };

  function add(item: CatalogueItem, packId: string | null, quantity: number | null) {
    if (locked) return;
    if (context.scheme === 'regular' && (item.gstRate === null || item.hsn === null)) {
      setNotice({ kind: 'noGst', name: item.name });
      return;
    }
    const amount = quantity ?? 1_000;
    if (quantityProblem(item, packId, amount) !== null) {
      setNotice({ kind: 'wholeUnits', name: item.name });
      return;
    }
    let lines: CartLine[];
    try {
      lines = addToCart(bill.lines, item, packId, amount, bill.priceList);
    } catch {
      setNotice({ kind: 'unknownCode', code: item.code ?? item.name });
      return;
    }
    const index = lines.findIndex(
      (line) => line.itemId === item.id && line.packId === packId && line.discount === undefined,
    );
    setBill({ ...bill, lines });
    setSaved(null);
    setProblem(null);
    setSelected(index);
    setNotice(null);
    setQuery('');
    setHighlight(0);
    // Weighed and measured items ask for their quantity at once (design §3).
    if (quantity === null && isLoose(item, packId)) {
      setEditing({ index, typed: formatQuantity(lines[index]?.quantityThousandths ?? amount) });
    }
  }

  /** A scan, or Enter in the search box: an exact code wins, then the highlighted result. */
  function enter(text: string) {
    const { quantityThousandths, query: code } = parseEntry(text.trim());
    if (code === '') return;
    // Whatever happens, the box is ready for the next scan: a refused code must not stay in it
    // and run into the next one. The notice says what went wrong.
    setQuery('');
    setHighlight(0);
    const found = copy.lookup(code);
    if (found.kind === 'item') {
      add(found.item, found.packId, quantityThousandths);
      return;
    }
    if (found.kind === 'archived') {
      setNotice({ kind: 'archived', name: found.name });
      return;
    }
    const pick = copy.search(code, RESULTS)[highlight];
    if (pick === undefined) {
      setNotice({ kind: 'unknownCode', code });
      return;
    }
    add(pick, null, quantityThousandths);
  }

  // A scan while nothing has the focus (after a click elsewhere) still lands on the bill.
  useScanner((code) => {
    enter(code);
    searchRef.current?.focus();
  });

  useEffect(() => {
    if (editing !== null) {
      quantityRef.current?.focus();
      quantityRef.current?.select();
    }
  }, [editing?.index]); // eslint-disable-line react-hooks/exhaustive-deps -- only when it opens

  function saveQuantity() {
    if (editing === null || locked) return;
    const line = bill.lines[editing.index];
    const item = line === undefined ? undefined : copy.get(line.itemId);
    const quantity = parseQuantity(editing.typed);
    if (line === undefined || item === undefined || item.archived) {
      focusSearch();
      return;
    }
    if (quantity === null || quantityProblem(item, line.packId, quantity) !== null) {
      setNotice(
        quantity !== null && quantity > 0
          ? { kind: 'wholeUnits', name: item.name }
          : { kind: 'badQuantity' },
      );
      return;
    }
    setBill({
      ...bill,
      lines: bill.lines.map((current, at) =>
        at === editing.index ? { ...current, quantityThousandths: quantity } : current,
      ),
    });
    setNotice(null);
    focusSearch();
  }

  function remove(index: number) {
    if (bill.lines[index] === undefined) return;
    setBill({ ...bill, lines: bill.lines.filter((_, at) => at !== index) });
    setChanged(new Set());
    setSelected(Math.min(index, bill.lines.length - 2));
    focusSearch();
  }

  function setPriceList(priceList: PriceList) {
    if (locked) return;
    setBill(repriceBill({ ...bill, priceList }, copy).bill);
  }

  /** A fresh bill; `done` is the one just saved, shown until the next item is scanned. */
  function startNew(done: SavedBillView | null = null) {
    setBill(startBill(context.branchStateCode));
    setApproval(null);
    setCustomer(null);
    setReady(null);
    setHeldFrom(null);
    setSaved(done);
    setProblem(null);
    setSelected(-1);
    setChanged(new Set());
    setNotice(null);
    setQuery('');
    focusSearch();
  }

  /** Question 7: a full bill thrown away is logged with its lines and total. */
  async function discardAndStartNew() {
    try {
      await apiRequest('POST', '/api/billing/discard', {
        draft: bill,
        shownTotalPaise: priced?.grandTotalPaise ?? 0,
      });
      startNew();
    } catch {
      setNotice({ kind: 'discardFailed' });
    }
  }

  /** A discount given (or taken away); above the limit, the owner is asked at once (design §6). */
  function applyDiscount(discount: Discount | null) {
    const next =
      discountFor === 'bill'
        ? withBillDiscount(bill, discount)
        : withLineDiscount(bill, selected, discount);
    setBill(next);
    setDiscountFor(null);
    if (approvalNeeded(next, context, copy, limit, approval, Date.now()) !== null) {
      setAsking(true);
    } else {
      focusSearch();
    }
  }

  function approved(given: Approval) {
    saveApproval(given);
    setApproval(given);
    setAsking(false);
    focusSearch();
  }

  /** F9: hold a bill with lines; on an empty one, show the branch's held bills. */
  function holdOrList() {
    if (locked) return;
    if (bill.lines.length > 0) setHolding(true);
    else {
      void held.refetch();
      setListing(true);
    }
  }

  async function hold(label: string | null) {
    setHolding(false);
    try {
      await apiRequest('POST', '/api/held-bills', {
        label,
        draft: bill,
        shownTotalPaise: priced?.grandTotalPaise ?? 0,
      });
      void queryClient.invalidateQueries({ queryKey: HELD_KEY });
      startNew();
    } catch {
      setNotice({ kind: 'holdFailed' });
      focusSearch();
    }
  }

  /** A held bill comes back at today's prices; any that changed are marked (design §9). */
  async function resume(id: string) {
    setListing(false);
    try {
      const { draft } = await apiRequest<ResumedBillView>(
        'POST',
        `/api/held-bills/${encodeURIComponent(id)}/resume`,
      );
      const repriced = repriceBill(fromCart(draft), copy);
      setBill(repriced.bill);
      setChanged(new Set(repriced.changed));
      setApproval(loadApproval(draft.billKey));
      setCustomer(loadCustomer(draft.billKey, draft.customerId));
      setHeldFrom({ id, billKey: draft.billKey });
      setReady(null);
      setSaved(null);
      setProblem(null);
      setSelected(repriced.bill.lines.length - 1);
      setNotice(null);
    } catch (error) {
      setNotice(
        error instanceof ApiError && (error.status === 409 || error.status === 404)
          ? { kind: 'heldGone' }
          : { kind: 'holdFailed' },
      );
    }
    void queryClient.invalidateQueries({ queryKey: HELD_KEY });
    focusSearch();
  }

  async function discardHeld(id: string) {
    try {
      await apiRequest('POST', `/api/held-bills/${encodeURIComponent(id)}/discard`);
    } catch {
      // Already resumed or thrown away elsewhere: the list below shows what's left.
    }
    void queryClient.invalidateQueries({ queryKey: HELD_KEY });
  }

  function chooseCustomer(chosen: BillCustomer | null, placeOfSupplyStateCode: string) {
    saveCustomer(bill.billKey, chosen);
    setCustomer(chosen);
    setBill({ ...bill, customerId: chosen?.id ?? null, placeOfSupplyStateCode });
  }

  /** F10: payment, once the owner has OK'd any discount above the limit (design §6, §8). */
  function pay() {
    if (priced === null || locked) return;
    if (needed !== null) setAsking(true);
    else setPaying(true);
  }

  const paid =
    ready !== null &&
    priced !== null &&
    ready.billKey === bill.billKey &&
    ready.totalPaise === priced.grandTotalPaise
      ? ready.payments
      : null;

  /**
   * Enter on a paid bill (design §6): one request with the bill's own key. A lost answer is sent
   * again with that key, and the server answers the bill it already saved.
   */
  async function save() {
    if (paid === null || priced === null || sending.current) return;
    sending.current = true;
    setSaving(true);
    setProblem(null);
    try {
      const view = await saveBill(
        billDraft(bill, paid, priced.grandTotalPaise, approval, heldFrom),
      );
      clearApproval(bill.billKey);
      saveCustomer(bill.billKey, null);
      startNew(view);
    } catch (error) {
      const found = saveProblem(error);
      setProblem(found);
      switch (found.kind) {
        case 'prices_changed': {
          // The server's prices go on the lines now; the whole copy follows, and the bill must
          // be paid again at its new total.
          const next = applyNewPrices(bill, found.lines);
          setBill(next.bill);
          setChanged(new Set(next.changed));
          setReady(null);
          await onReload();
          break;
        }
        case 'items_unavailable':
          await onReload();
          break;
        case 'approval_required':
        case 'approval_invalid':
          clearApproval(bill.billKey);
          setApproval(null);
          break;
        case 'payments_mismatch':
        case 'advance_changed':
          setReady(null);
          break;
        case 'held_bill_invalid':
          setHeldFrom(null);
          break;
        default:
      }
    } finally {
      sending.current = false;
      setSaving(false);
    }
  }

  const wholesale = context.features.includes('wholesale_price');
  const selectedLine = bill.lines[selected];
  const selectedEntry = selectedLine === undefined ? undefined : copy.get(selectedLine.itemId);

  useShortcut({
    keys: 'F2',
    description: 'shortcuts.billSearch',
    group: 'general',
    action: focusSearch,
  });
  useShortcut({
    keys: 'F3',
    description: 'shortcuts.billCustomer',
    group: 'general',
    action: () => {
      if (locked) return;
      setChoosingCustomer(true);
    },
  });
  useShortcut({
    keys: 'F10',
    description: 'shortcuts.billPay',
    group: 'general',
    action: pay,
  });
  useShortcut({
    keys: 'F4',
    description: 'shortcuts.billQuantity',
    group: 'general',
    action: () => {
      if (locked) return;
      const line = bill.lines[selected];
      if (line !== undefined) {
        setEditing({ index: selected, typed: formatQuantity(line.quantityThousandths) });
      }
    },
  });
  useShortcut({
    keys: 'F8',
    description: 'shortcuts.billPriceList',
    group: 'general',
    action: () => {
      if (wholesale) setPriceList(bill.priceList === 'retail' ? 'wholesale' : 'retail');
    },
  });
  useShortcut({
    keys: 'F6',
    description: 'shortcuts.billLineDiscount',
    group: 'general',
    action: () => {
      if (locked) return;
      if (selectedLine !== undefined) setDiscountFor('line');
    },
  });
  useShortcut({
    keys: 'F7',
    description: 'shortcuts.billDiscount',
    group: 'general',
    action: () => {
      if (locked) return;
      if (bill.lines.length > 0) setDiscountFor('bill');
    },
  });
  useShortcut({
    keys: 'F9',
    description: 'shortcuts.billHold',
    group: 'general',
    action: holdOrList,
  });
  useShortcut({
    keys: 'Ctrl+Delete',
    description: 'shortcuts.billRemoveLine',
    group: 'general',
    action: () => {
      if (locked) return;
      remove(selected);
    },
  });
  useShortcut({
    keys: 'Alt+N',
    description: 'shortcuts.billNew',
    group: 'general',
    action: () => {
      if (saving) return;
      if (bill.lines.length === 0) startNew();
      else setConfirmNew(true);
    },
  });

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    const typing = query.trim() !== '' && results.length > 0;
    if (event.key === 'Enter') {
      event.preventDefault();
      const typed = event.currentTarget.value;
      // Nothing typed: Enter saves a paid bill, or moves on from a saved one.
      if (typed.trim() !== '') enter(typed);
      else if (paid !== null) void save();
      else if (saved !== null) startNew();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      if (typing) {
        setHighlight((at) => Math.min(Math.max(at + step, 0), results.length - 1));
      } else {
        setSelected((at) => Math.min(Math.max(at + step, 0), bill.lines.length - 1));
      }
    } else if (event.key === 'Escape' && query !== '') {
      // Esc closes the results; it never clears the bill.
      event.preventDefault();
      setQuery('');
    }
  }

  const showResults = query.trim() !== '' && results.length > 0;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-label={t('billing.lines')} className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <label htmlFor={searchId} className="sr-only">
              {t('billing.search')}
            </label>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
            />
            <Input
              ref={searchRef}
              id={searchId}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the counter types into it at once
              autoFocus
              role="combobox"
              aria-expanded={showResults}
              aria-controls={resultsId}
              aria-activedescendant={showResults ? `${resultsId}-${String(highlight)}` : undefined}
              aria-describedby={noticeId}
              aria-keyshortcuts="F2"
              autoComplete="off"
              spellCheck={false}
              placeholder={t('billing.searchHint')}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlight(0);
              }}
              onKeyDown={onSearchKey}
              className="h-12 pl-9 text-section"
            />
            <Kbd aria-hidden="true" className="absolute top-1/2 right-3 -translate-y-1/2">
              F2
            </Kbd>
            {showResults && (
              <ul
                id={resultsId}
                role="listbox"
                aria-label={t('billing.results')}
                className="absolute inset-x-0 top-full z-20 mt-1 max-h-96 overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-card"
              >
                {results.map((item, index) => (
                  <li
                    key={item.id}
                    id={`${resultsId}-${String(index)}`}
                    role="option"
                    aria-selected={index === highlight}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      add(item, null, parseEntry(query).quantityThousandths);
                    }}
                    className="flex cursor-pointer items-center justify-between gap-4 px-3 py-2 aria-selected:bg-surface-muted"
                  >
                    <span className="min-w-0 truncate">
                      {item.name}
                      {item.hindiName !== null && (
                        <span className="ml-2 text-muted">{item.hindiName}</span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted">
                      {item.code !== null && <span className="mr-3">{item.code}</span>}
                      {formatPaise(item.sellingPrice)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {wholesale && (
            <button
              type="button"
              aria-keyshortcuts="F8"
              aria-pressed={bill.priceList === 'wholesale'}
              onClick={() => {
                setPriceList(bill.priceList === 'retail' ? 'wholesale' : 'retail');
              }}
              className="flex h-12 items-center gap-2 rounded-lg border border-border px-3 aria-pressed:border-primary aria-pressed:bg-surface-muted"
            >
              {t(`billing.priceLists.${bill.priceList}`)}
              <Kbd aria-hidden="true">F8</Kbd>
            </button>
          )}
          <button
            type="button"
            aria-keyshortcuts="F9"
            onClick={holdOrList}
            className="flex h-12 items-center gap-2 rounded-lg border border-border px-3 whitespace-nowrap"
          >
            {bill.lines.length > 0
              ? t('billing.held.holdButton')
              : t('billing.held.listButton', { count: held.data?.length ?? 0 })}
            <Kbd aria-hidden="true">F9</Kbd>
          </button>
        </div>
        <p id={noticeId} role="status" className="min-h-6 text-danger">
          {notice !== null && t(`billing.notices.${notice.kind}`, notice)}
        </p>
        <Lines
          bill={bill}
          priced={priced}
          copy={copy}
          context={context}
          selected={selected}
          changed={changed}
          short={short}
          editing={editing}
          quantityRef={quantityRef}
          onSelect={setSelected}
          onTyped={(typed) => {
            if (editing !== null) setEditing({ ...editing, typed });
          }}
          onSaveQuantity={saveQuantity}
          onCancelQuantity={focusSearch}
        />
        <CustomerSummary
          customer={
            customer !== null && customer.name === ''
              ? { ...customer, name: t('billing.customer.onHeldBill') }
              : customer
          }
          placeOfSupplyStateCode={bill.placeOfSupplyStateCode}
          branchStateCode={context.branchStateCode}
          onOpen={() => {
            if (!locked) setChoosingCustomer(true);
          }}
        />
      </section>
      <div className="flex flex-col gap-4">
        <Totals bill={bill} priced={priced} />
        {saved !== null ? (
          <SavedPanel
            saved={saved}
            copy={copy}
            onNext={() => {
              startNew();
            }}
          />
        ) : paid !== null ? (
          <div
            role="status"
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
          >
            <div className="flex flex-col gap-1">
              <p className="font-semibold">{t('billing.readyToSave')}</p>
              <p className="text-label text-muted">
                {paid
                  .map(
                    (row) =>
                      `${t(`billing.payment.modes.${row.mode}`)} ${formatPaise(row.amountPaise)}`,
                  )
                  .join(' · ')}
              </p>
            </div>
            <Button disabled={saving} aria-keyshortcuts="Enter" onClick={() => void save()}>
              {t(saving ? 'billing.save.saving' : 'billing.save.button')}
              {!saving && (
                <Kbd aria-hidden="true" className="ml-2">
                  Enter
                </Kbd>
              )}
            </Button>
          </div>
        ) : (
          <Button size="default" disabled={priced === null} aria-keyshortcuts="F10" onClick={pay}>
            {t('billing.pay')}
            <Kbd aria-hidden="true" className="ml-2">
              F10
            </Kbd>
          </Button>
        )}
        {problem !== null && (
          <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-danger">
            {problemText(t, problem, copy)}
          </p>
        )}
        {needed !== null && (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-lg border border-warning bg-warning-soft p-4"
          >
            <p className="flex items-center gap-2 font-semibold">
              <ShieldAlert aria-hidden="true" className="size-4 text-warning" />
              {t('billing.approval.needed')}
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                setAsking(true);
              }}
            >
              {t('billing.approval.ask')}
            </Button>
          </div>
        )}
      </div>
      <DiscountDialog
        open={discountFor !== null}
        target={discountFor === 'line' && selectedEntry !== undefined ? selectedEntry.name : null}
        current={discountFor === 'bill' ? bill.billDiscount : selectedLine?.discount}
        onApply={applyDiscount}
        onClose={() => {
          setDiscountFor(null);
          searchRef.current?.focus();
        }}
      />
      <ApprovalDialog
        open={asking}
        billKey={bill.billKey}
        shares={needed}
        onApproved={approved}
        onClose={() => {
          setAsking(false);
          searchRef.current?.focus();
        }}
      />
      <CustomerBox
        open={choosingCustomer}
        context={context}
        customer={customer}
        placeOfSupplyStateCode={bill.placeOfSupplyStateCode}
        onChange={chooseCustomer}
        onClose={() => {
          setChoosingCustomer(false);
          searchRef.current?.focus();
        }}
      />
      <PaymentPanel
        open={paying}
        totalPaise={priced?.grandTotalPaise ?? 0}
        onReady={(payments) => {
          setReady({ billKey: bill.billKey, totalPaise: priced?.grandTotalPaise ?? 0, payments });
          setPaying(false);
          setProblem(null);
          searchRef.current?.focus();
        }}
        onClose={() => {
          setPaying(false);
          searchRef.current?.focus();
        }}
      />
      <HoldDialog
        open={holding}
        onHold={(label) => void hold(label)}
        onClose={() => {
          setHolding(false);
          searchRef.current?.focus();
        }}
      />
      <HeldBillsDialog
        open={listing}
        bills={held.data}
        onResume={(id) => void resume(id)}
        onDiscard={(id) => void discardHeld(id)}
        onClose={() => {
          setListing(false);
          searchRef.current?.focus();
        }}
      />
      <ConfirmDialog
        open={confirmNew}
        title={t('billing.newBill.title')}
        body={t('billing.newBill.body')}
        confirm={t('billing.newBill.confirm')}
        onConfirm={() => void discardAndStartNew()}
        onClose={() => {
          setConfirmNew(false);
          searchRef.current?.focus();
        }}
      />
    </div>
  );
}

/** What was saved: its number, the change to give and any stock that went below zero. */
function SavedPanel({
  saved,
  copy,
  onNext,
}: {
  saved: SavedBillView;
  copy: CatalogueCopy;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-lg border border-success bg-success-soft p-4"
    >
      <p className="flex items-center gap-2 font-semibold">
        <CircleCheck aria-hidden="true" className="size-5 shrink-0 text-success" />
        {t('billing.save.saved', { number: saved.number })}
      </p>
      <p className="text-label text-muted">
        {t('billing.save.total', { amount: formatPaise(saved.grandTotalPaise) })}
      </p>
      {saved.changePaise > 0 && (
        <p className="text-section font-semibold tabular-nums">
          {t('billing.save.change', { amount: formatPaise(saved.changePaise) })}
        </p>
      )}
      {saved.warnings.map((warning) => {
        const item = copy.get(warning.itemId);
        return (
          <p key={warning.itemId} className="text-warning">
            {t('billing.save.below', {
              name: item?.name ?? '',
              quantity:
                item === undefined || item.archived
                  ? ''
                  : stockText(t, warning.balanceAfter, item.stockUnit),
            })}
          </p>
        );
      })}
      <Button variant="secondary" onClick={onNext}>
        {t('billing.save.next')}
        <Kbd aria-hidden="true" className="ml-2">
          Alt+N
        </Kbd>
      </Button>
    </div>
  );
}

/** The words for a save that didn't happen, where the cashier is looking. */
function problemText(t: TFunction, problem: SaveProblem, copy: CatalogueCopy): string {
  switch (problem.kind) {
    case 'stock_short':
      return t('billing.save.problems.stock_short', {
        name: copy.get(problem.itemId)?.name ?? '',
      });
    case 'items_unavailable':
      return t('billing.save.problems.items_unavailable', {
        count: problem.lines.length,
        lines: problem.lines.join(', '),
      });
    default:
      return t(`billing.save.problems.${problem.kind}`);
  }
}

function Lines({
  bill,
  priced,
  copy,
  context,
  selected,
  changed,
  short,
  editing,
  quantityRef,
  onSelect,
  onTyped,
  onSaveQuantity,
  onCancelQuantity,
}: {
  bill: OpenBill;
  priced: Bill | null;
  copy: CatalogueCopy;
  context: BillingContext;
  selected: number;
  changed: ReadonlySet<number>;
  short: ReadonlyMap<string, number>;
  editing: { index: number; typed: string } | null;
  quantityRef: React.RefObject<HTMLInputElement | null>;
  onSelect: (index: number) => void;
  onTyped: (typed: string) => void;
  onSaveQuantity: () => void;
  onCancelQuantity: () => void;
}) {
  const { t } = useTranslation();
  if (bill.lines.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-6 py-12 text-center text-muted">
        {t('billing.empty')}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-left">
        <thead className="border-b border-border text-label text-muted">
          <tr>
            <th className="w-10 px-3 py-2">#</th>
            <th className="px-3 py-2">{t('billing.columns.item')}</th>
            <th className="px-3 py-2 text-right">{t('billing.columns.quantity')}</th>
            <th className="px-3 py-2 text-right">{t('billing.columns.price')}</th>
            <th className="px-3 py-2 text-right">{t('billing.columns.discount')}</th>
            <th className="px-3 py-2 text-right">{t('billing.columns.amount')}</th>
          </tr>
        </thead>
        <tbody>
          {bill.lines.map((line, index) => {
            const entry = copy.get(line.itemId);
            const item = entry === undefined || entry.archived ? null : entry;
            const pack = item?.packs.find((candidate) => candidate.id === line.packId);
            const unit =
              item === null
                ? ''
                : pack === undefined
                  ? unitName(t, item.stockUnit)
                  : pack.unitCode === null
                    ? (pack.unitName ?? '')
                    : unitName(t, pack.unitCode);
            const problem = lineProblem(line, copy, context.scheme);
            const available = short.get(line.itemId);
            const worked = priced?.lines[index];
            return (
              <tr
                key={`${line.itemId}:${line.packId ?? ''}:${String(index)}`}
                aria-selected={index === selected}
                onClick={() => {
                  onSelect(index);
                }}
                className="border-b border-border last:border-0 aria-selected:bg-surface-muted"
              >
                <td className="px-3 py-2 tabular-nums text-muted">{index + 1}</td>
                <td className="px-3 py-2">
                  <span className="font-medium">{entry?.name ?? line.itemId}</span>
                  {problem !== null && (
                    <span className="block text-danger">{t(`billing.problems.${problem}`)}</span>
                  )}
                  {available !== undefined && item !== null && (
                    <span className="block text-warning">
                      {t('billing.onlyInStock', {
                        quantity: stockText(t, available, item.stockUnit),
                      })}
                    </span>
                  )}
                  {changed.has(index) && (
                    <span className="block text-warning">{t('billing.priceChanged')}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                  {editing?.index === index ? (
                    <input
                      ref={quantityRef}
                      aria-label={t('billing.quantityOf', { name: entry?.name ?? '' })}
                      inputMode="decimal"
                      value={editing.typed}
                      onChange={(event) => {
                        onTyped(event.target.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          onSaveQuantity();
                        } else if (event.key === 'Escape') {
                          event.preventDefault();
                          onCancelQuantity();
                        }
                      }}
                      onBlur={onCancelQuantity}
                      className="w-24 rounded-md border border-primary bg-background px-2 py-1 text-right"
                    />
                  ) : (
                    `${formatQuantity(line.quantityThousandths)} ${unit}`
                  )}
                </td>
                <td
                  className={cn(
                    'px-3 py-2 text-right tabular-nums',
                    changed.has(index) && 'font-semibold text-warning',
                  )}
                >
                  {formatPaise(line.shownUnitPricePaise)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">
                  {worked !== undefined && worked.itemDiscountPaise > 0
                    ? `−${formatPaise(worked.itemDiscountPaise)}`
                    : ''}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {worked === undefined
                    ? '—'
                    : formatPaise(worked.amountPaise - worked.itemDiscountPaise)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Totals({ bill, priced }: { bill: OpenBill; priced: Bill | null }) {
  const { t } = useTranslation();
  const row = (label: string, paise: number, sign = '') => (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">
        {sign}
        {formatPaise(paise)}
      </dd>
    </div>
  );
  return (
    <aside
      aria-label={t('billing.totals.label')}
      className="flex h-fit flex-col gap-4 rounded-lg border border-border bg-surface p-5 lg:sticky lg:top-20"
    >
      <dl className="flex flex-col gap-1.5">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">{t('billing.totals.items')}</dt>
          <dd className="tabular-nums">{bill.lines.length}</dd>
        </div>
        {priced !== null && (
          <>
            {row(t('billing.totals.gross'), priced.grossPaise)}
            {priced.grossPaise > priced.totalPaise &&
              row(t('billing.totals.discount'), priced.grossPaise - priced.totalPaise, '−')}
            {priced.tax !== 'none' && row(t('billing.totals.taxable'), priced.taxablePaise)}
            {priced.tax === 'cgst-sgst' && (
              <>
                {row('CGST', priced.cgstPaise)}
                {row(priced.stateTaxName ?? 'SGST', priced.sgstPaise)}
              </>
            )}
            {priced.tax === 'igst' && row('IGST', priced.igstPaise)}
            {priced.roundOffPaise !== 0 &&
              row(
                t('billing.totals.roundOff'),
                Math.abs(priced.roundOffPaise),
                priced.roundOffPaise < 0 ? '−' : '+',
              )}
          </>
        )}
      </dl>
      <div className="flex items-baseline justify-between gap-4 border-t border-border pt-4">
        <span className="text-section font-semibold">{t('billing.totals.total')}</span>
        <output
          aria-label={t('billing.totals.total')}
          className="text-figure font-semibold tabular-nums"
        >
          {formatPaise(priced?.grandTotalPaise ?? 0)}
        </output>
      </div>
      {priced !== null && (
        <p className="text-label text-muted">{t(`billing.taxTypes.${priced.tax}`)}</p>
      )}
    </aside>
  );
}
