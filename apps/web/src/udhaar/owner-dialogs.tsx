// The owner's two corrections and the credit terms (`03` #20, #21, #24): reverse a payment taken
// by mistake, enter the old notebook's balance, change a credit limit and due days.
import {
  customerUpdateSchema,
  MAX_BILL_PAISE,
  MAX_DUE_DAYS,
  parseRupees,
  type CustomerView,
  type Paise,
  type UdhaarMoveView,
} from '@business-software/shared';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { OwnerPasswordDialog } from '../components/owner-password-dialog';
import { Dialog, DialogActions } from '../components/ui/dialog';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { formText } from '../lib/form-data';
import { rupeesText } from '../lib/rupees';
import { reversePayment, setOpeningBalance, updateCustomer } from './api';

/** `03` #21: the payment stays in the ledger; a reversing line brings its bills back. */
export function ReverseDialog({
  paymentId,
  onDone,
  onClose,
}: {
  /** The payment to take back; the dialog is open while this is set. */
  paymentId: string | null;
  onDone: (moved: UdhaarMoveView) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ask = async (ownerPassword: string, form: FormData) => {
    if (paymentId === null) return;
    const reason = formText(form, 'reason').trim();
    if (reason === '') throw new ApiError(400, 'invalid_body', { reason: 'required' });
    onDone(await reversePayment(paymentId, { reason, ownerPassword }));
  };
  return (
    <OwnerPasswordDialog
      open={paymentId !== null}
      title={t('udhaar.reverse.title')}
      confirm={t('udhaar.reverse.confirm')}
      failedText={t('udhaar.reverse.failed')}
      autoFocusOwner={false}
      onSubmit={ask}
      onClose={onClose}
    >
      {(fieldErrors) => (
        <>
          <p className="text-muted">{t('udhaar.reverse.body')}</p>
          <Field
            label={t('udhaar.reverse.reason')}
            hint={t('udhaar.reverse.reasonHint')}
            error={fieldErrors.reason === undefined ? undefined : t('errors.required')}
          >
            {(props) => (
              <Input
                {...props}
                name="reason"
                // eslint-disable-next-line jsx-a11y/no-autofocus -- the owner types the reason first
                autoFocus
                autoComplete="off"
                maxLength={200}
              />
            )}
          </Field>
        </>
      )}
    </OwnerPasswordDialog>
  );
}

/**
 * `03` #20: what the old notebook says, once per customer, at any time. It counts as the
 * customer's oldest udhaar, so payments clear it first.
 */
export function OpeningDialog({
  open,
  customerId,
  today,
  onDone,
  onClose,
}: {
  open: boolean;
  customerId: string;
  /** The shop's day (`YYYY-MM-DD`): the "as of" date can't be later. */
  today: string;
  onDone: (moved: UdhaarMoveView) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} title={t('udhaar.opening.title')} onClose={onClose}>
      <OpeningForm customerId={customerId} today={today} onDone={onDone} onClose={onClose} />
    </Dialog>
  );
}

type OpeningError = 'amount' | 'reason' | 'date';

function OpeningForm({
  customerId,
  today,
  onDone,
  onClose,
}: {
  customerId: string;
  today: string;
  onDone: (moved: UdhaarMoveView) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'owes' | 'advance'>('owes');
  const [asOf, setAsOf] = useState(today);
  const [reason, setReason] = useState('');
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [errors, setErrors] = useState<Partial<Record<OpeningError, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A changed field is a different request: it gets its own key.
  const edit = (change: () => void) => {
    change();
    setRequestKey(crypto.randomUUID());
    setFailure(null);
  };

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const typed = parseRupees(amount);
    const found: Partial<Record<OpeningError, string>> = {};
    if (typed === null || typed === 0 || typed > MAX_BILL_PAISE) {
      found.amount = t('udhaar.opening.errors.amount');
    }
    if (reason.trim() === '') found.reason = t('errors.required');
    if (asOf === '' || asOf > today) found.date = t('udhaar.opening.errors.date');
    setErrors(found);
    if (Object.keys(found).length > 0 || typed === null) return;
    setBusy(true);
    setFailure(null);
    try {
      onDone(
        await setOpeningBalance({
          requestKey,
          customerId,
          amountPaise: direction === 'owes' ? typed : -typed,
          asOf,
          reason: reason.trim(),
        }),
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === 'opening_exists') {
        setFailure(t('udhaar.opening.errors.exists'));
      } else if (error instanceof ApiError && error.code === 'key_reused') {
        setRequestKey(crypto.randomUUID());
        setFailure(t('udhaar.opening.errors.failed'));
      } else {
        setFailure(t('udhaar.opening.errors.failed'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={(event) => void submit(event)}>
      <div className="flex flex-col gap-4">
        <p className="text-muted">{t('udhaar.opening.lead')}</p>
        <Field label={t('udhaar.opening.direction')}>
          {(props) => (
            <Select
              {...props}
              value={direction}
              onChange={(event) => {
                edit(() => {
                  setDirection(event.target.value === 'advance' ? 'advance' : 'owes');
                });
              }}
            >
              <option value="owes">{t('udhaar.opening.owes')}</option>
              <option value="advance">{t('udhaar.opening.advance')}</option>
            </Select>
          )}
        </Field>
        <Field label={t('udhaar.opening.amount')} error={errors.amount}>
          {(props) => (
            <Input
              {...props}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the owner types at once
              autoFocus
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              className="text-right text-figure tabular-nums"
              onChange={(event) => {
                edit(() => {
                  setAmount(event.target.value);
                });
              }}
            />
          )}
        </Field>
        <Field
          label={t('udhaar.opening.asOf')}
          hint={t('udhaar.opening.asOfHint')}
          error={errors.date}
        >
          {(props) => (
            <Input
              {...props}
              type="date"
              max={today}
              value={asOf}
              onChange={(event) => {
                edit(() => {
                  setAsOf(event.target.value);
                });
              }}
            />
          )}
        </Field>
        <Field label={t('udhaar.opening.note')} error={errors.reason}>
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              maxLength={200}
              value={reason}
              onChange={(event) => {
                edit(() => {
                  setReason(event.target.value);
                });
              }}
            />
          )}
        </Field>
        {failure !== null && (
          <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-danger">
            {failure}
          </p>
        )}
      </div>
      <DialogActions
        onClose={onClose}
        confirm={t(busy ? 'udhaar.opening.saving' : 'udhaar.opening.save')}
        busy={busy}
      />
    </form>
  );
}

/**
 * `03` #5, #8, #24: the credit limit (empty is "no limit set") and the due days. Saved through
 * the customer's own record with the version it was read at.
 */
export function TermsDialog({
  open,
  customer,
  onSaved,
  onClose,
}: {
  open: boolean;
  customer: CustomerView;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} title={t('udhaar.terms.title')} onClose={onClose}>
      <TermsForm customer={customer} onSaved={onSaved} onClose={onClose} />
    </Dialog>
  );
}

function TermsForm({
  customer,
  onSaved,
  onClose,
}: {
  customer: CustomerView;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [limit, setLimit] = useState(
    customer.creditLimitPaise === null ? '' : rupeesText(customer.creditLimitPaise),
  );
  const [days, setDays] = useState(String(customer.dueDays));
  const [errors, setErrors] = useState<{ limit?: string; days?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const limitPaise: Paise | null | 'bad' =
      limit.trim() === '' ? null : (parseRupees(limit) ?? 'bad');
    const dueDays = /^\d{1,3}$/.test(days.trim()) ? Number(days.trim()) : -1;
    const found: { limit?: string; days?: string } = {};
    if (limitPaise === 'bad' || (limitPaise !== null && limitPaise > MAX_BILL_PAISE)) {
      found.limit = t('udhaar.terms.errors.limit');
    }
    if (dueDays < 0 || dueDays > MAX_DUE_DAYS) found.days = t('udhaar.terms.errors.days');
    setErrors(found);
    if (Object.keys(found).length > 0 || limitPaise === 'bad') return;
    // The whole customer goes back as it is, with only the two terms changed.
    const body = {
      name: customer.name,
      phone: customer.phone,
      gstin: customer.gstin,
      legalName: customer.legalName,
      address: customer.address,
      pinCode: customer.pinCode,
      stateCode: customer.stateCode,
      creditLimitPaise: limitPaise,
      dueDays,
      version: customer.version,
    };
    // The same checks as the server's (the form sends what it read).
    if (!customerUpdateSchema.safeParse(body).success) {
      setFailure(t('udhaar.terms.errors.failed'));
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await updateCustomer(customer.id, body);
      onSaved();
    } catch (error) {
      setFailure(
        t(
          error instanceof ApiError && error.code === 'stale'
            ? 'udhaar.terms.errors.stale'
            : 'udhaar.terms.errors.failed',
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={(event) => void submit(event)}>
      <div className="flex flex-col gap-4">
        <Field
          label={t('udhaar.terms.limit')}
          hint={t('udhaar.terms.limitHint')}
          error={errors.limit}
        >
          {(props) => (
            <Input
              {...props}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the owner types at once
              autoFocus
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={limit}
              className="tabular-nums"
              onChange={(event) => {
                setLimit(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t('udhaar.terms.days')} hint={t('udhaar.terms.daysHint')} error={errors.days}>
          {(props) => (
            <Input
              {...props}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={days}
              className="w-28 tabular-nums"
              onChange={(event) => {
                setDays(event.target.value);
              }}
            />
          )}
        </Field>
        {failure !== null && (
          <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-danger">
            {failure}
          </p>
        )}
      </div>
      <DialogActions
        onClose={onClose}
        confirm={t(busy ? 'udhaar.terms.saving' : 'udhaar.terms.save')}
        busy={busy}
      />
    </form>
  );
}
