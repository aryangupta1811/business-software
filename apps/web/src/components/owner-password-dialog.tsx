import type { FieldErrors } from '@business-software/shared';
import { useState, type ReactNode, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { formText } from '../lib/form-data';
import { useRetryTime } from '../lib/retry-time';
import { PasswordInput } from './password-input';
import { Dialog, DialogActions } from './ui/dialog';
import { Field } from './ui/field';

/**
 * The owner's password, asked for before a change that gives someone more power or approves a
 * discount (Module 00 #17, #44). One box with show/hide; `children` can add more fields to the
 * same form (a staff member's new password).
 *
 * The password never enters React state. It is read once from the form, the box is emptied, and
 * the value goes straight to `onSubmit`, which sends it and keeps nothing. A wrong password or
 * too many tries shows here and keeps the dialog open; any other answer `onSubmit` throws shows
 * `failedText`. An `invalid_body` answer's fields go to `children`, if it is a function. The
 * caller closes the dialog (`open` false) when the request worked.
 */
export function OwnerPasswordDialog({
  open,
  title,
  confirm,
  failedText,
  autoFocusOwner = true,
  children,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  confirm: string;
  /** For any failure that isn't about the owner's password. */
  failedText?: string;
  /** Off when `children` has a field the owner types first. */
  autoFocusOwner?: boolean;
  children?: ReactNode | ((fieldErrors: FieldErrors) => ReactNode);
  onSubmit: (ownerPassword: string, form: FormData) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const retryTime = useRetryTime();
  const [failure, setFailure] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [sending, setSending] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  // Opening starts clean.
  if (open !== wasOpen) {
    setWasOpen(open);
    setFailure(null);
    setFieldErrors({});
  }

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const ownerPassword = formText(data, 'ownerPassword');
    if (ownerPassword === '') {
      setFailure(t('errors.required'));
      return;
    }
    // Empty the box now: from here on the password lives only in this call.
    const box = form.elements.namedItem('ownerPassword');
    if (box instanceof HTMLInputElement) box.value = '';
    setSending(true);
    setFailure(null);
    setFieldErrors({});
    try {
      await onSubmit(ownerPassword, data);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'wrong_password') {
        setFailure(t('errors.fields.ownerPassword.wrong'));
      } else if (error instanceof ApiError && error.code === 'too_many_attempts') {
        setFailure(t('login.tooMany', { time: retryTime(error) }));
      } else if (error instanceof ApiError && error.code === 'invalid_body') {
        setFieldErrors(error.fields);
        if (Object.keys(error.fields).length === 0) setFailure(failedText ?? t('account.failed'));
      } else {
        setFailure(failedText ?? t('account.failed'));
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} title={title} onClose={onClose}>
      <form noValidate onSubmit={(event) => void submit(event)}>
        <div className="flex flex-col gap-4">
          {typeof children === 'function' ? children(fieldErrors) : children}
          <Field label={t('account.ownerPassword')} error={failure ?? undefined}>
            {(props) => (
              <PasswordInput
                {...props}
                name="ownerPassword"
                // eslint-disable-next-line jsx-a11y/no-autofocus -- the owner types at once
                autoFocus={autoFocusOwner}
                autoComplete="off"
              />
            )}
          </Field>
        </div>
        <DialogActions onClose={onClose} confirm={confirm} busy={sending} />
      </form>
    </Dialog>
  );
}
