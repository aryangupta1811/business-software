import {
  formatPaise,
  MONEY_PAYMENT_MODES,
  paymentIssues,
  parseRupees,
  type Paise,
  type PaymentMode,
  type PaymentRule,
} from '@business-software/shared';
import { Check, ShieldAlert, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/button';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { Kbd, KbdGroup } from '../components/ui/kbd';
import { cn } from '../lib/cn';
import { rupeesText } from '../lib/rupees';
import { isTypingTarget } from '../shortcuts/keys';
import { useShortcut } from '../shortcuts/use-shortcut';
import { creditCheck } from '../udhaar/standing';
import { NO_UDHAAR, type UdhaarAccess } from './udhaar-access';

/** One payment on the bill, in whole paise. The same shape as a payment in the save request. */
export interface PaymentRow {
  mode: PaymentMode;
  amountPaise: Paise;
  /** Cash only: what the customer handed over, when that's more than the amount. */
  tenderedPaise?: Paise;
  /** UPI or card: last digits or UTR (optional). Cheque: its number (required). */
  reference?: string;
}

/** The most payments one bill takes (the save request's limit). */
const MAX_ROWS = 10;

/** Every mode in key order: 1 to 4 are money, 5 is udhaar and 6 is the customer's advance (P1.18 §5). */
const ALL_MODES = [...MONEY_PAYMENT_MODES, 'udhaar', 'advance'] as const;
type ModeKey = (typeof ALL_MODES)[number];
/** Udhaar and advance move no money: no cash handed over, no reference (`02` #11). */
const isLedgerMode = (mode: PaymentMode) => mode === 'udhaar' || mode === 'advance';

type AmountError = 'invalid' | 'too_small' | 'too_big';

/** What the cashier is typing for one payment. */
interface Draft {
  id: number;
  mode: PaymentMode;
  /** Rupees as typed: what the customer handed over for cash, the amount for the others. */
  text: string;
  reference: string;
}

interface Priced {
  draft: Draft;
  /** What this payment settles of the bill; 0 when the amount can't be read. */
  amountPaise: Paise;
  tenderedPaise: Paise | undefined;
  error: AmountError | undefined;
}

/**
 * Reads the rows top to bottom. A payment settles at most what's left of the bill: cash handed
 * over beyond that is change, and any other mode beyond it is an error (design §8).
 */
function price(
  drafts: readonly Draft[],
  totalPaise: Paise,
  advancePaise: Paise,
): { rows: Priced[]; paid: Paise } {
  let paid = 0;
  let advanceUsed = 0;
  const rows = drafts.map((draft): Priced => {
    const typed = parseRupees(draft.text);
    const left = Math.max(totalPaise - paid, 0);
    let amountPaise = 0;
    let tenderedPaise: Paise | undefined;
    let error: AmountError | undefined;
    if (typed === null) {
      error = 'invalid';
    } else if (draft.mode === 'cash') {
      amountPaise = Math.min(typed, left);
      if (typed > amountPaise) tenderedPaise = typed;
      if (amountPaise === 0) error = 'too_small';
    } else {
      amountPaise = typed;
      if (typed === 0) error = 'too_small';
      else if (typed > left) error = 'too_big';
      // The advance can't be used for more than the customer has.
      else if (draft.mode === 'advance' && advanceUsed + typed > advancePaise) error = 'too_big';
    }
    if (error === undefined && draft.mode === 'advance') advanceUsed += amountPaise;
    if (error === undefined) paid += amountPaise;
    else amountPaise = 0;
    return { draft, amountPaise, tenderedPaise, error };
  });
  return { rows, paid };
}

/**
 * The payment panel (P1.13 design §8): one cash row for the bill, `Alt+A` to split it, `Alt+1`
 * to `Alt+4` for the mode, Enter on a fully paid bill. It's a native `<dialog>` (ADR 0026) and
 * starts afresh every time it opens. The rules are the save request's (`paymentIssues`).
 */
export function PaymentPanel({
  open,
  totalPaise,
  udhaar = NO_UDHAAR,
  onClose,
  onNeedCustomer,
  onReady,
}: {
  open: boolean;
  /** The bill's grand total. */
  totalPaise: Paise;
  /** What of the customer's account this login may use (design §5). */
  udhaar?: UdhaarAccess;
  /** Esc or Cancel. */
  onClose: () => void;
  /** "Add the customer": closes the panel and opens the customer box (F3). */
  onNeedCustomer?: () => void;
  /** Enter on a fully paid bill. */
  onReady: (payments: PaymentRow[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      // showModal focuses the first control, which is a mode button: the cashier types an amount.
      element.querySelector<HTMLInputElement>('input[data-amount]')?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={() => {
        // Closing it from our side (open → false) fires this too; only Esc is news.
        if (open) onClose();
      }}
      className="m-auto max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-surface p-6 text-foreground shadow-card backdrop:bg-foreground/40"
    >
      {open && (
        <Panel
          titleId={titleId}
          totalPaise={totalPaise}
          udhaar={udhaar}
          onClose={onClose}
          onNeedCustomer={onNeedCustomer}
          onReady={onReady}
        />
      )}
    </dialog>
  );
}

function Panel({
  titleId,
  totalPaise,
  udhaar,
  onClose,
  onNeedCustomer,
  onReady,
}: {
  titleId: string;
  totalPaise: Paise;
  udhaar: UdhaarAccess;
  onClose: () => void;
  onNeedCustomer: (() => void) | undefined;
  onReady: (payments: PaymentRow[]) => void;
}) {
  const { t } = useTranslation();
  const form = useRef<HTMLFormElement>(null);
  const nextId = useRef(1);
  const refocus = useRef<number | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>(() => [
    { id: 0, mode: 'cash', text: rupeesText(totalPaise), reference: '' },
  ]);
  /** The row the cashier last worked in: the mode keys change this one. */
  const [activeId, setActiveId] = useState(0);
  const [attempted, setAttempted] = useState(false);

  // The modes this bill may use: money always, udhaar once there is a customer to put it on,
  // and the advance only when they have one.
  const offered = ALL_MODES.filter(
    (mode) =>
      !isLedgerMode(mode) ||
      (mode === 'udhaar' && udhaar.state === 'ready') ||
      (mode === 'advance' && udhaar.state === 'ready' && udhaar.advancePaise > 0),
  );
  // The key handler below is set up once, so it reads the modes through a ref.
  const offeredRef = useRef<readonly ModeKey[]>(offered);
  useEffect(() => {
    offeredRef.current = offered;
  });
  const { rows, paid } = price(drafts, totalPaise, udhaar.advancePaise);
  const left = totalPaise - paid;
  const changePaise = rows.reduce(
    (sum, row) => sum + (row.tenderedPaise === undefined ? 0 : row.tenderedPaise - row.amountPaise),
    0,
  );
  // The shared rules, over the rows whose amounts can be read.
  const readable = rows.filter((row) => row.error === undefined);
  const rules: PaymentRule[] = readable.map(rule);
  const issues = paymentIssues(rules, totalPaise);
  const referenceMissing = (row: Priced) =>
    issues.some((issue) => issue.field === 'reference' && readable[issue.index] === row);
  const mismatch = issues.some((issue) => issue.code === 'payments_mismatch');
  const canFinish = rows.every((row) => row.error === undefined) && issues.length === 0;
  const check =
    udhaar.standing === null
      ? null
      : creditCheck({
          payments: readable.map((row) => ({ mode: row.draft.mode, amountPaise: row.amountPaise })),
          standing: udhaar.standing,
          who: udhaar.who,
          setting: udhaar.setting,
        });

  useEffect(() => {
    if (refocus.current === null) return;
    const input = form.current?.querySelector<HTMLInputElement>(
      `input[data-amount="${String(refocus.current)}"]`,
    );
    refocus.current = null;
    input?.focus();
  }, [drafts.length]);

  function update(id: number, patch: Partial<Draft>) {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
    );
  }

  function addRow() {
    if (drafts.length >= MAX_ROWS) return;
    const id = nextId.current++;
    const mode = MONEY_PAYMENT_MODES.find((m) => !drafts.some((d) => d.mode === m)) ?? 'cash';
    setDrafts([...drafts, { id, mode, text: left > 0 ? rupeesText(left) : '', reference: '' }]);
    setActiveId(id);
    refocus.current = id;
  }

  function removeRow(id: number) {
    const index = drafts.findIndex((draft) => draft.id === id);
    setDrafts(drafts.filter((draft) => draft.id !== id));
    // The focus goes to the row above (the first row can't be removed, so there is one).
    const keep = drafts[index - 1]?.id ?? 0;
    setActiveId(keep);
    refocus.current = keep;
  }

  const setMode = (mode: PaymentMode) => {
    if (!offered.some((one) => one === mode)) return;
    update(activeId, { mode });
  };
  useShortcut({
    keys: 'Alt+1',
    description: 'billing.payment.modes.cash',
    group: 'general',
    action: () => {
      setMode('cash');
    },
    inDialog: true,
  });
  useShortcut({
    keys: 'Alt+2',
    description: 'billing.payment.modes.upi',
    group: 'general',
    action: () => {
      setMode('upi');
    },
    inDialog: true,
  });
  useShortcut({
    keys: 'Alt+3',
    description: 'billing.payment.modes.card',
    group: 'general',
    action: () => {
      setMode('card');
    },
    inDialog: true,
  });
  useShortcut({
    keys: 'Alt+4',
    description: 'billing.payment.modes.cheque',
    group: 'general',
    action: () => {
      setMode('cheque');
    },
    inDialog: true,
  });
  useShortcut({
    keys: 'Alt+5',
    description: 'billing.payment.modes.udhaar',
    group: 'general',
    action: () => {
      setMode('udhaar');
    },
    inDialog: true,
  });
  useShortcut({
    keys: 'Alt+6',
    description: 'billing.payment.modes.advance',
    group: 'general',
    action: () => {
      setMode('advance');
    },
    inDialog: true,
  });
  useShortcut({
    keys: 'Alt+A',
    description: 'billing.payment.add',
    group: 'general',
    action: addRow,
    inDialog: true,
  });

  // The row the cashier is in, and a plain 1 to 4 as a mode while a button (not an amount, where
  // it's a digit) has the focus. Native listeners: a `<form>` isn't an element React's
  // accessibility lint lets listen to keys.
  useEffect(() => {
    const element = form.current;
    if (!element) return;
    const onFocusIn = (event: FocusEvent) => {
      const row = event.target === null ? null : rowOf(event.target);
      if (row !== null) setActiveId(Number(row.dataset.row));
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) return;
      const mode = /^[1-6]$/.test(event.key) ? ALL_MODES[Number(event.key) - 1] : undefined;
      const row = event.target === null ? null : rowOf(event.target);
      if (mode === undefined || row === null || !offeredRef.current.includes(mode)) return;
      event.preventDefault();
      setDrafts((current) =>
        current.map((draft) => (draft.id === Number(row.dataset.row) ? { ...draft, mode } : draft)),
      );
    };
    element.addEventListener('focusin', onFocusIn);
    element.addEventListener('keydown', onKeyDown);
    return () => {
      element.removeEventListener('focusin', onFocusIn);
      element.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  function finish() {
    setAttempted(true);
    if (!canFinish) return;
    onReady(readable.map(toPaymentRow));
  }

  return (
    <form
      ref={form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        finish();
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <h2 id={titleId} className="text-section font-semibold">
          {t('billing.payment.title')}
        </h2>
        <div className="text-right">
          <p className="text-label text-muted">{t('billing.payment.total')}</p>
          <p data-testid="total" className="text-figure font-semibold tabular-nums">
            {formatPaise(totalPaise)}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {rows.map((row, index) => (
          <PaymentRowCard
            key={row.draft.id}
            row={row}
            modes={offered}
            udhaar={udhaar}
            number={index + 1}
            removable={index > 0}
            attempted={attempted}
            referenceMissing={referenceMissing(row)}
            onChange={(patch) => {
              update(row.draft.id, patch);
            }}
            onRemove={() => {
              removeRow(row.draft.id);
            }}
          />
        ))}
      </div>

      <div className="mt-3">
        <Button variant="secondary" size="sm" disabled={drafts.length >= MAX_ROWS} onClick={addRow}>
          {t('billing.payment.add')}
          <KbdGroup aria-hidden>
            <Kbd>Alt</Kbd>
            <Kbd>A</Kbd>
          </KbdGroup>
        </Button>
      </div>

      {udhaar.state === 'needs_customer' && (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-muted">
          {t('billing.payment.udhaar.needsCustomer')}
          {onNeedCustomer !== undefined && (
            <Button variant="ghost" size="sm" onClick={onNeedCustomer}>
              {t('billing.payment.udhaar.addCustomer')}
            </Button>
          )}
        </p>
      )}
      {check !== null && (check.kind === 'warn' || check.kind === 'needs_approval') && (
        <p
          role="status"
          className="mt-3 flex items-start gap-2 rounded-lg border border-warning bg-warning-soft p-3"
        >
          <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            {t(
              check.limitPaise === null
                ? 'billing.payment.udhaar.noLimit'
                : check.kind === 'warn'
                  ? 'billing.payment.udhaar.warn'
                  : 'billing.payment.udhaar.needsOwner',
              {
                name: udhaar.customerName,
                after: formatPaise(check.balanceAfterPaise),
                limit: check.limitPaise === null ? '' : formatPaise(check.limitPaise),
              },
            )}
          </span>
        </p>
      )}

      <dl className="mt-5 grid grid-cols-3 gap-3 rounded-lg border border-border bg-surface-muted p-4">
        <Figure label={t('billing.payment.paid')} value={formatPaise(paid)} />
        <Figure
          testId="left"
          label={left < 0 ? t('billing.payment.over') : t('billing.payment.left')}
          value={formatPaise(Math.abs(left))}
          tone={left === 0 ? 'ok' : 'warn'}
        />
        <Figure
          label={t('billing.payment.changeToReturn')}
          value={formatPaise(changePaise)}
          tone={changePaise > 0 ? 'ok' : undefined}
        />
      </dl>

      <p
        role="status"
        className={cn(
          'mt-3 flex min-h-6 items-center gap-1.5 text-label',
          mismatch && attempted ? 'text-danger' : 'text-muted',
        )}
      >
        {left === 0 && canFinish ? (
          <>
            <Check className="size-4" aria-hidden />
            {t('billing.payment.fullyPaid')}
          </>
        ) : (
          mismatch && attempted && t('billing.payment.errors.payments_mismatch')
        )}
      </p>

      <div className="mt-4 flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>
          {t('dialog.cancel')}
        </Button>
        <Button type="submit">
          {t('billing.payment.done')}
          <Kbd aria-hidden>Enter</Kbd>
        </Button>
      </div>
    </form>
  );
}

function PaymentRowCard({
  row,
  modes,
  udhaar,
  number,
  removable,
  attempted,
  referenceMissing,
  onChange,
  onRemove,
}: {
  row: Priced;
  modes: readonly ModeKey[];
  udhaar: UdhaarAccess;
  number: number;
  removable: boolean;
  attempted: boolean;
  referenceMissing: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { draft } = row;
  const cash = draft.mode === 'cash';
  const ledger = isLedgerMode(draft.mode);
  const amountError = row.error !== undefined && (attempted || row.error === 'too_big');
  const changeHere = row.tenderedPaise === undefined ? 0 : row.tenderedPaise - row.amountPaise;

  return (
    <div
      role="group"
      aria-label={t('billing.payment.rowTitle', { n: number })}
      data-row={draft.id}
      className="rounded-lg border border-border p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-label font-medium text-muted">
          {t('billing.payment.rowTitle', { n: number })}
        </p>
        {removable && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('billing.payment.remove', { n: number })}
            onClick={onRemove}
          >
            <X aria-hidden />
          </Button>
        )}
      </div>

      <div className={cn('mt-2 grid gap-2', modes.length > 4 ? 'grid-cols-3' : 'grid-cols-4')}>
        {modes.map((mode) => (
          <Button
            key={mode}
            variant={draft.mode === mode ? 'primary' : 'secondary'}
            aria-pressed={draft.mode === mode}
            onClick={() => {
              onChange({ mode });
            }}
          >
            {t(`billing.payment.modes.${mode}`)}
            <KbdGroup aria-hidden>
              <Kbd>Alt</Kbd>
              <Kbd>{ALL_MODES.indexOf(mode) + 1}</Kbd>
            </KbdGroup>
          </Button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field
          label={cash ? t('billing.payment.received') : t('billing.payment.amount')}
          error={amountError && row.error ? t(`billing.payment.errors.${row.error}`) : undefined}
        >
          {(props) => (
            <Input
              {...props}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              data-amount={draft.id}
              value={draft.text}
              className="text-right text-figure tabular-nums"
              onFocus={(event) => {
                event.currentTarget.select();
              }}
              onChange={(event) => {
                onChange({ text: event.target.value });
              }}
            />
          )}
        </Field>
        {!cash && !ledger && (
          <Field
            label={
              draft.mode === 'cheque'
                ? t('billing.payment.chequeNumber')
                : t('billing.payment.reference')
            }
            hint={draft.mode === 'cheque' ? undefined : t('billing.payment.referenceHint')}
            error={attempted && referenceMissing ? t('billing.payment.errors.required') : undefined}
          >
            {(props) => (
              <Input
                {...props}
                type="text"
                autoComplete="off"
                maxLength={40}
                value={draft.reference}
                onChange={(event) => {
                  onChange({ reference: event.target.value });
                }}
              />
            )}
          </Field>
        )}
      </div>

      {draft.mode === 'udhaar' && (
        <p className="mt-3 text-label text-muted">
          {t('billing.payment.udhaar.onAccount', { name: udhaar.customerName })}
        </p>
      )}
      {draft.mode === 'advance' && (
        <p className="mt-3 text-label text-muted">
          {t('billing.payment.udhaar.advanceHas', { amount: formatPaise(udhaar.advancePaise) })}
        </p>
      )}

      {cash && changeHere > 0 && (
        <p className="mt-3 text-body font-medium tabular-nums text-success">
          {t('billing.payment.change', { amount: formatPaise(changeHere) })}
        </p>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  testId,
  tone,
}: {
  label: string;
  value: string;
  testId?: string;
  tone?: 'ok' | 'warn' | undefined;
}) {
  return (
    <div>
      <dt className="text-label text-muted">{label}</dt>
      <dd
        data-testid={testId}
        className={cn(
          'text-section font-semibold tabular-nums',
          tone === 'ok' && 'text-success',
          tone === 'warn' && 'text-danger',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** UPI, card and cheque carry a reference; cash, udhaar and advance don't. */
const takesReference = (mode: PaymentMode) => mode !== 'cash' && !isLedgerMode(mode);

/** The payment row a control sits in. */
function rowOf(target: EventTarget): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-row]') : null;
}

/** A row as the shared rules read it. */
function rule(row: Priced): PaymentRule {
  const reference = takesReference(row.draft.mode) ? row.draft.reference.trim() : '';
  return {
    mode: row.draft.mode,
    amountPaise: row.amountPaise,
    tenderedPaise: row.tenderedPaise,
    reference: reference === '' ? undefined : reference,
  };
}

/** The same, without the keys that have nothing to say. */
function toPaymentRow(row: Priced): PaymentRow {
  const reference = takesReference(row.draft.mode) ? row.draft.reference.trim() : '';
  return {
    mode: row.draft.mode,
    amountPaise: row.amountPaise,
    ...(row.tenderedPaise !== undefined && { tenderedPaise: row.tenderedPaise }),
    ...(reference !== '' && { reference }),
  };
}
