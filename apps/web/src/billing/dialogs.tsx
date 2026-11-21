import {
  formatPaise,
  type ApprovalView,
  type Discount,
  type DiscountLimits,
  type HeldBillView,
} from '@business-software/shared';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiRequest } from '../api/client';
import { Button } from '../components/ui/button';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { useRetryTime } from '../lib/retry-time';
import { discountText, parseDiscount, type Approval } from './discounts';

/**
 * A native `<dialog>` for the counter (ADR 0026): shown with `showModal()` while `open`, and Esc
 * or Cancel calls `onClose`. While it's open the page's shortcuts are off.
 */
function CounterDialog({
  open,
  title,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      className={`m-auto w-full ${wide ? 'max-w-xl' : 'max-w-md'} rounded-lg bg-surface p-6 text-foreground shadow-card`}
    >
      {open && (
        <>
          <h2 id={titleId} className="text-section font-semibold">
            {title}
          </h2>
          <div className="mt-4">{children}</div>
        </>
      )}
    </dialog>
  );
}

function Actions({ onClose, confirm }: { onClose: () => void; confirm: string }) {
  const { t } = useTranslation();
  return (
    <div className="mt-6 flex justify-end gap-3">
      <Button variant="secondary" onClick={onClose}>
        {t('dialog.cancel')}
      </Button>
      <Button type="submit">{confirm}</Button>
    </div>
  );
}

const percentText = (basisPoints: number) => `${String(basisPoints / 100)}%`;

/** F6 (a line) and F7 (the whole bill): a percent or rupees off; empty takes it away. */
export function DiscountDialog({
  open,
  target,
  current,
  onApply,
  onClose,
}: {
  open: boolean;
  /** The line's item name, or null for the whole bill. */
  target: string | null;
  current: Discount | undefined;
  onApply: (discount: Discount | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<Discount['kind']>('percent');
  const [typed, setTyped] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  // Opening starts from the discount already there.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setKind(current?.kind ?? 'percent');
      setTyped(discountText(current));
      setInvalid(false);
    }
  }
  return (
    <CounterDialog
      open={open}
      title={
        target === null
          ? t('billing.discount.billTitle')
          : t('billing.discount.lineTitle', { name: target })
      }
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const discount = parseDiscount(kind, typed);
          if (discount === 'invalid') {
            setInvalid(true);
            return;
          }
          onApply(discount);
        }}
      >
        <div role="radiogroup" aria-label={t('billing.discount.kind')} className="mb-4 flex gap-2">
          {(['percent', 'amount'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={kind === option}
              onClick={() => {
                setKind(option);
                setInvalid(false);
              }}
              className="h-10 flex-1 rounded-lg border border-border aria-checked:border-primary aria-checked:bg-surface-muted aria-checked:font-semibold"
            >
              {t(`billing.discount.kinds.${option}`)}
            </button>
          ))}
        </div>
        <Field
          label={t(`billing.discount.amountLabel.${kind}`)}
          error={invalid ? t(`billing.discount.invalid.${kind}`) : undefined}
          hint={t('billing.discount.hint')}
        >
          {(props) => (
            <Input
              {...props}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog exists to type this
              autoFocus
              inputMode="decimal"
              autoComplete="off"
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value);
                setInvalid(false);
              }}
              onKeyDown={(event) => {
                // % typed after the number switches to a percent, so the hands stay on the keys.
                if (event.key === '%') {
                  event.preventDefault();
                  setKind('percent');
                }
              }}
              className="text-right tabular-nums"
            />
          )}
        </Field>
        <Actions onClose={onClose} confirm={t('billing.discount.apply')} />
      </form>
    </CounterDialog>
  );
}

/**
 * Above the cashier's limit (design §6): the owner types their password at the counter. The OK
 * covers this bill, up to the shares shown, for 30 minutes. The password is sent once and
 * dropped.
 */
export function ApprovalDialog({
  open,
  billKey,
  shares,
  onApproved,
  onClose,
}: {
  open: boolean;
  billKey: string;
  shares: DiscountLimits | null;
  onApproved: (approval: Approval) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const retryTime = useRetryTime();
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setPassword('');
    setFailure(null);
  }
  const ask = async () => {
    if (shares === null || password === '' || sending) return;
    setSending(true);
    setFailure(null);
    try {
      const answer = await apiRequest<ApprovalView>('POST', '/api/billing/approvals', {
        billKey,
        kind: 'discount',
        lineBasisPoints: shares.lineBasisPoints,
        billBasisPoints: shares.billBasisPoints,
        ownerPassword: password,
      });
      onApproved({ ...answer, ...shares, billKey });
    } catch (error) {
      setPassword('');
      if (error instanceof ApiError && error.code === 'wrong_password') {
        setFailure(t('errors.fields.ownerPassword.wrong'));
      } else if (error instanceof ApiError && error.code === 'too_many_attempts') {
        setFailure(t('login.tooMany', { time: retryTime(error) }));
      } else {
        setFailure(t('billing.approval.failed'));
      }
    } finally {
      setSending(false);
    }
  };
  return (
    <CounterDialog open={open} title={t('billing.approval.title')} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        {shares !== null && (
          <p className="mb-4 text-muted">
            {t('billing.approval.body', {
              line: percentText(shares.lineBasisPoints),
              bill: percentText(shares.billBasisPoints),
            })}
          </p>
        )}
        <Field label={t('billing.approval.password')} error={failure ?? undefined}>
          {(props) => (
            <Input
              {...props}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the owner types at once
              autoFocus
              type="password"
              autoComplete="off"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
          )}
        </Field>
        <Actions onClose={onClose} confirm={t('billing.approval.confirm')} />
      </form>
    </CounterDialog>
  );
}

/** F9 on a bill with lines: hold it, with an optional label, and serve the next customer. */
export function HoldDialog({
  open,
  onHold,
  onClose,
}: {
  open: boolean;
  onHold: (label: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState('');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setLabel('');
  }
  return (
    <CounterDialog open={open} title={t('billing.held.holdTitle')} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onHold(label.trim() === '' ? null : label.trim());
        }}
      >
        <Field label={t('billing.held.label')} hint={t('billing.held.labelHint')}>
          {(props) => (
            <Input
              {...props}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- Enter holds at once
              autoFocus
              maxLength={40}
              autoComplete="off"
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
              }}
            />
          )}
        </Field>
        <Actions onClose={onClose} confirm={t('billing.held.hold')} />
      </form>
    </CounterDialog>
  );
}

/** F9 on an empty bill: the branch's held bills, newest first; resume or throw one away. */
export function HeldBillsDialog({
  open,
  bills,
  onResume,
  onDiscard,
  onClose,
}: {
  open: boolean;
  bills: readonly HeldBillView[] | undefined;
  onResume: (id: string) => void;
  onDiscard: (id: string) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [at, setAt] = useState(0);
  const [discarding, setDiscarding] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setAt(0);
    setDiscarding(null);
  }
  const list = bills ?? [];
  // React's autoFocus only works on form fields, so the list takes the focus here, after the
  // dialog (a child, whose effect runs first) has opened.
  const listRef = useRef<HTMLUListElement>(null);
  const loaded = bills !== undefined;
  useEffect(() => {
    if (open && loaded) listRef.current?.focus();
  }, [open, loaded]);
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
  return (
    <CounterDialog open={open} title={t('billing.held.listTitle')} onClose={onClose} wide>
      {bills === undefined ? (
        <p className="text-muted">{t('billing.held.loading')}</p>
      ) : list.length === 0 ? (
        <p className="text-muted">{t('billing.held.none')}</p>
      ) : (
        <ul
          role="listbox"
          aria-label={t('billing.held.listTitle')}
          ref={listRef}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setAt((index) => Math.min(Math.max(index + step, 0), list.length - 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const bill = list[at];
              if (bill !== undefined) onResume(bill.id);
            }
          }}
          className="flex max-h-96 flex-col gap-1 overflow-y-auto outline-none"
        >
          {list.map((bill, index) => (
            <li
              key={bill.id}
              role="option"
              aria-selected={index === at}
              className="flex items-center gap-4 rounded-lg px-3 py-2 aria-selected:bg-surface-muted"
            >
              <button
                type="button"
                tabIndex={-1}
                onClick={() => {
                  onResume(bill.id);
                }}
                className="flex min-w-0 flex-1 flex-col text-left"
              >
                <span className="truncate font-medium">
                  {bill.label ?? t('billing.held.noLabel')}
                </span>
                <span className="text-label text-muted">
                  {t('billing.held.meta', {
                    count: bill.lineCount,
                    name: bill.heldBy.name,
                    time: time(bill.heldAt),
                  })}
                </span>
              </button>
              <span className="tabular-nums">{formatPaise(bill.totalPaise)}</span>
              {discarding === bill.id ? (
                <Button
                  variant="danger"
                  size="sm"
                  tabIndex={-1}
                  onClick={() => {
                    onDiscard(bill.id);
                  }}
                >
                  {t('billing.held.confirmDiscard')}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  tabIndex={-1}
                  onClick={() => {
                    setDiscarding(bill.id);
                  }}
                >
                  {t('billing.held.discard')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          {t('billing.held.close')}
        </Button>
      </div>
    </CounterDialog>
  );
}
