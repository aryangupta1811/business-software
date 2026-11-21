import type { StaffView } from '@business-software/shared';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { deactivateStaff, reactivateStaff, resetStaffPassword } from '../api/staff';
import { OwnerPasswordDialog } from '../components/owner-password-dialog';
import { PasswordInput } from '../components/password-input';
import { Dialog, DialogActions } from '../components/ui/dialog';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { useFieldError } from '../lib/field-error';
import { formText } from '../lib/form-data';
import { failureText } from './errors';
import type { StaffDialogsHost } from './use-staff-dialogs';

/**
 * The three actions on a staff login that open a dialog (P1.5 design §6): reset its password,
 * deactivate it, reactivate it. The list and the edit page share them.
 */
export function StaffDialogs({ host }: { host: StaffDialogsHost }) {
  const { t } = useTranslation();
  const { open, close, done } = host;
  const person = open?.person;
  const name = person?.name ?? '';
  return (
    <>
      <OwnerPasswordDialog
        open={open?.kind === 'reset'}
        title={t('staff.reset.title', { name })}
        confirm={t('staff.reset.confirm')}
        autoFocusOwner={false}
        onSubmit={async (ownerPassword, form) => {
          if (person === undefined) return;
          await resetStaffPassword(person.id, {
            newPassword: formText(form, 'newPassword'),
            ownerPassword,
          });
          done(t('staff.reset.done', { name }));
        }}
        onClose={close}
      >
        {(fieldErrors) => <ResetFields error={fieldErrors.newPassword} />}
      </OwnerPasswordDialog>

      <DeactivateDialog
        open={open?.kind === 'deactivate'}
        person={person}
        onDone={() => {
          done(t('staff.deactivate.done', { name }));
        }}
        onClose={close}
      />

      <OwnerPasswordDialog
        open={open?.kind === 'reactivate'}
        title={t('staff.reactivate.title', { name })}
        confirm={t('staff.reactivate.confirm')}
        onSubmit={async (ownerPassword) => {
          if (person === undefined) return;
          await reactivateStaff(person.id, ownerPassword);
          done(t('staff.reactivate.done', { name }));
        }}
        onClose={close}
      >
        <p className="text-muted">{t('staff.reactivate.body')}</p>
      </OwnerPasswordDialog>
    </>
  );
}

/** The new password the owner sets (#33), with the warning that the person is logged out. */
function ResetFields({ error }: { error: string | undefined }) {
  const { t } = useTranslation();
  const errorText = useFieldError();
  return (
    <>
      <p className="text-muted">{t('staff.reset.body')}</p>
      <Field
        label={t('staff.reset.newPassword')}
        hint={t('account.passwordHint')}
        error={errorText('newPassword', error)}
      >
        {(props) => (
          <PasswordInput
            {...props}
            name="newPassword"
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the owner types it at once
            autoFocus
            autoComplete="new-password"
          />
        )}
      </Field>
    </>
  );
}

/**
 * Says what happens (#34) and takes an optional reason. No owner's password: deactivating only
 * takes access away, so it should take a second.
 */
function DeactivateDialog({
  open,
  person,
  onDone,
  onClose,
}: {
  open: boolean;
  person: StaffView | undefined;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setFailure(null);
  }
  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (person === undefined || sending) return;
    const reason = formText(new FormData(event.currentTarget), 'reason').trim();
    setSending(true);
    setFailure(null);
    try {
      await deactivateStaff(person.id, reason === '' ? {} : { reason });
      onDone();
    } catch (error) {
      setFailure(failureText(t, error));
    } finally {
      setSending(false);
    }
  };
  return (
    <Dialog
      open={open}
      title={t('staff.deactivate.title', { name: person?.name ?? '' })}
      onClose={onClose}
    >
      <form noValidate onSubmit={(event) => void submit(event)}>
        <ul className="mb-4 flex list-disc flex-col gap-1 pl-5 text-muted">
          <li>{t('staff.deactivate.loggedOut')}</li>
          <li>{t('staff.deactivate.noLogin')}</li>
          <li>{t('staff.deactivate.history')}</li>
          <li>{t('staff.deactivate.undo')}</li>
        </ul>
        <Field label={t('staff.deactivate.reason')} error={failure ?? undefined}>
          {(props) => <Input {...props} name="reason" maxLength={200} autoComplete="off" />}
        </Field>
        <DialogActions
          onClose={onClose}
          confirm={t('staff.deactivate.confirm')}
          busy={sending}
          danger
        />
      </form>
    </Dialog>
  );
}
