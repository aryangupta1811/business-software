import {
  formatPaise,
  PAYMENT_MODES,
  paymentIssues,
  parseRupees,
  type Paise,
  type PaymentMode,
  type PaymentRule,
} from '@business-software/shared';
import { Check, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/button';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { Kbd, KbdGroup } from '../components/ui/kbd';
import { cn } from '../lib/cn';
import { isTypingTarget } from '../shortcuts/keys';
import { useShortcut } from '../shortcuts/use-shortcut';

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

/** 14150 → "141.50", 14100 → "141": the form `parseRupees` reads back. */
function rupeesText(paise: Paise): string {
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return rest === 0 ? String(rupees) : `${String(rupees)}.${String(rest).padStart(2, '0')}`;
}

/**
 * Reads the rows top to bottom. A payment settles at most what's left of the bill: cash handed
 * over beyond that is change, and any other mode beyond it is an error (design §8).
 */
function price(drafts: readonly Draft[], totalPaise: Paise): { rows: Priced[]; paid: Paise } {
  let paid = 0;
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
    }
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
  onClose,
  onReady,
}: {
  open: boolean;
  /** The bill's grand total. */
  totalPaise: Paise;
  /** Esc or Cancel. */
  onClose: () => void;
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
        <Panel titleId={titleId} totalPaise={totalPaise} onClose={onClose} onReady={onReady} />
      )}
    </dialog>
  );
}

function Panel({
  titleId,
  totalPaise,
  onClose,
  onReady,
}: {
  titleId: string;
  totalPaise: Paise;
  onClose: () => void;
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

  const { rows, paid } = price(drafts, totalPaise);
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
    const mode = PAYMENT_MODES.find((m) => !drafts.some((d) => d.mode === m)) ?? 'cash';
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
      const mode = /^[1-4]$/.test(event.key) ? PAYMENT_MODES[Number(event.key) - 1] : undefined;
      const row = event.target === null ? null : rowOf(event.target);
      if (mode === undefined || row === null) return;
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
  number,
  removable,
  attempted,
  referenceMissing,
  onChange,
  onRemove,
}: {
  row: Priced;
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

      <div className="mt-2 grid grid-cols-4 gap-2">
        {PAYMENT_MODES.map((mode, index) => (
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
              <Kbd>{index + 1}</Kbd>
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
        {!cash && (
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

/** The payment row a control sits in. */
function rowOf(target: EventTarget): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-row]') : null;
}

/** A row as the shared rules read it. */
function rule(row: Priced): PaymentRule {
  const reference = row.draft.mode === 'cash' ? '' : row.draft.reference.trim();
  return {
    mode: row.draft.mode,
    amountPaise: row.amountPaise,
    tenderedPaise: row.tenderedPaise,
    reference: reference === '' ? undefined : reference,
  };
}

/** The same, without the keys that have nothing to say. */
function toPaymentRow(row: Priced): PaymentRow {
  const reference = row.draft.mode === 'cash' ? '' : row.draft.reference.trim();
  return {
    mode: row.draft.mode,
    amountPaise: row.amountPaise,
    ...(row.tenderedPaise !== undefined && { tenderedPaise: row.tenderedPaise }),
    ...(reference !== '' && { reference }),
  };
}
