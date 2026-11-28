import {
  formatPaise,
  MAX_BILL_PAISE,
  MONEY_PAYMENT_MODES,
  parseRupees,
  type Paise,
  type UdhaarMoveView,
} from '@business-software/shared';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { Button } from '../components/ui/button';
import { Dialog, DialogActions } from '../components/ui/dialog';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { rupeesText } from '../lib/rupees';
import { recordPayment } from './api';

type AmountError = 'invalid' | 'too_small' | 'too_big';
type PaymentMode = (typeof MONEY_PAYMENT_MODES)[number];

/**
 * Record payment (`03` #3, #11): an amount, a mode and a reference; Enter saves. Any amount at
 * any time: more than is owed becomes an advance. A retry (a lost answer, or Enter again) sends
 * the same request key, so a payment is never recorded twice; changing a field starts a new one.
 */
export function PaymentDialog({
  open,
  customerId,
  customerName,
  balancePaise,
  onSaved,
  onClose,
}: {
  open: boolean;
  customerId: string;
  customerName: string;
  balancePaise: Paise;
  onSaved: (moved: UdhaarMoveView) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} title={t('udhaar.payment.title', { name: customerName })} onClose={onClose}>
      <PaymentForm
        customerId={customerId}
        balancePaise={balancePaise}
        onSaved={onSaved}
        onClose={onClose}
      />
    </Dialog>
  );
}

function PaymentForm({
  customerId,
  balancePaise,
  onSaved,
  onClose,
}: {
  customerId: string;
  balancePaise: Paise;
  onSaved: (moved: UdhaarMoveView) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<PaymentMode>('cash');
  const [reference, setReference] = useState('');
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [attempted, setAttempted] = useState(false);
  const [failed, setFailed] = useState<'network' | 'failed' | null>(null);
  const [busy, setBusy] = useState(false);

  const typed = parseRupees(amount);
  const amountError: AmountError | undefined =
    typed === null
      ? 'invalid'
      : typed === 0
        ? 'too_small'
        : typed > MAX_BILL_PAISE
          ? 'too_big'
          : undefined;
  const needsReference = mode === 'cheque' && reference.trim() === '';
  const owed = balancePaise > 0 ? balancePaise : 0;

  // A changed field is a different payment: it gets its own key.
  const edit = (change: () => void) => {
    change();
    setRequestKey(crypto.randomUUID());
    setFailed(null);
  };

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    if (busy || amountError !== undefined || typed === null || needsReference) return;
    setBusy(true);
    setFailed(null);
    try {
      const moved = await recordPayment({
        requestKey,
        customerId,
        amountPaise: typed,
        mode,
        ...(reference.trim() !== '' && mode !== 'cash' && { reference: reference.trim() }),
      });
      onSaved(moved);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'key_reused') {
        setRequestKey(crypto.randomUUID());
      }
      setFailed(error instanceof ApiError && error.code === 'network' ? 'network' : 'failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={(event) => void submit(event)}>
      <div className="flex flex-col gap-4">
        <p className="text-muted">
          {balancePaise > 0
            ? t('udhaar.payment.owes', { amount: formatPaise(balancePaise) })
            : balancePaise < 0
              ? t('udhaar.payment.hasAdvance', { amount: formatPaise(-balancePaise) })
              : t('udhaar.payment.owesNothing')}
        </p>

        <Field
          label={t('udhaar.payment.amount')}
          hint={t('udhaar.payment.amountHint')}
          error={attempted && amountError ? t(`udhaar.payment.errors.${amountError}`) : undefined}
        >
          {(props) => (
            <div className="flex gap-2">
              <Input
                {...props}
                // eslint-disable-next-line jsx-a11y/no-autofocus -- the cashier types at once
                autoFocus
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                className="text-right text-figure tabular-nums"
                onFocus={(event) => {
                  event.currentTarget.select();
                }}
                onChange={(event) => {
                  edit(() => {
                    setAmount(event.target.value);
                  });
                }}
              />
              {owed > 0 && (
                <Button
                  variant="secondary"
                  className="shrink-0"
                  onClick={() => {
                    edit(() => {
                      setAmount(rupeesText(owed));
                    });
                  }}
                >
                  {t('udhaar.payment.fullBalance')}
                </Button>
              )}
            </div>
          )}
        </Field>

        <div role="group" aria-label={t('udhaar.payment.mode')} className="flex flex-col gap-1.5">
          <span className="text-label font-medium">{t('udhaar.payment.mode')}</span>
          <div className="grid grid-cols-4 gap-2">
            {MONEY_PAYMENT_MODES.map((one) => (
              <Button
                key={one}
                variant={mode === one ? 'primary' : 'secondary'}
                aria-pressed={mode === one}
                onClick={() => {
                  edit(() => {
                    setMode(one);
                  });
                }}
              >
                {t(`billing.payment.modes.${one}`)}
              </Button>
            ))}
          </div>
        </div>

        {mode !== 'cash' && (
          <Field
            label={
              mode === 'cheque' ? t('billing.payment.chequeNumber') : t('billing.payment.reference')
            }
            hint={mode === 'cheque' ? undefined : t('billing.payment.referenceHint')}
            error={attempted && needsReference ? t('billing.payment.errors.required') : undefined}
          >
            {(props) => (
              <Input
                {...props}
                type="text"
                autoComplete="off"
                maxLength={40}
                value={reference}
                onChange={(event) => {
                  edit(() => {
                    setReference(event.target.value);
                  });
                }}
              />
            )}
          </Field>
        )}

        {failed !== null && (
          <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-danger">
            {t(failed === 'network' ? 'udhaar.payment.network' : 'udhaar.payment.failed')}
          </p>
        )}
      </div>
      <DialogActions
        onClose={onClose}
        confirm={t(busy ? 'udhaar.payment.saving' : 'udhaar.payment.save')}
        busy={busy}
      />
    </form>
  );
}
