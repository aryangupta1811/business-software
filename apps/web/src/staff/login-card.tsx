import type { StaffView } from '@business-software/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addStaffLogin } from '../api/staff';
import { ApiError } from '../api/client';
import { OwnerPasswordDialog } from '../components/owner-password-dialog';
import { PasswordInput } from '../components/password-input';
import { Button } from '../components/ui/button';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { useFieldError } from '../lib/field-error';
import { formText } from '../lib/form-data';
import { AccountCard } from '../settings/account-card';

/**
 * "Give a login" to a person kept without one (P2.3 design §6; Module 00 #19): the same person,
 * not a second record. A login gives access, so it asks for the owner's password.
 */
export function LoginCard({
  person,
  onGiven,
}: {
  person: StaffView;
  onGiven: (view: StaffView) => void;
}) {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const [open, setOpen] = useState(false);
  return (
    <AccountCard title={t('staff.login.title')} lead={t('staff.login.lead', { name: person.name })}>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('staff.login.give')}
      </Button>
      <OwnerPasswordDialog
        open={open}
        title={t('staff.login.dialogTitle', { name: person.name })}
        confirm={t('staff.login.confirm')}
        autoFocusOwner={false}
        onSubmit={async (ownerPassword, form) => {
          let view: StaffView;
          try {
            view = await addStaffLogin(person.id, {
              ownerPassword,
              username: formText(form, 'username'),
              password: formText(form, 'password'),
            });
          } catch (error) {
            // Shown under the username, like a refused field.
            if (error instanceof ApiError && error.code === 'username_taken') {
              throw new ApiError(400, 'invalid_body', { username: 'username_taken' });
            }
            throw error;
          }
          setOpen(false);
          onGiven(view);
        }}
        onClose={() => {
          setOpen(false);
        }}
      >
        {(fieldErrors) => (
          <>
            <p className="text-muted">{t('staff.login.body')}</p>
            <Field
              label={t('staff.person.username')}
              hint={t('staff.person.usernameHint')}
              error={errorText('username', fieldErrors.username)}
            >
              {(props) => (
                <Input
                  {...props}
                  name="username"
                  // eslint-disable-next-line jsx-a11y/no-autofocus -- the owner types it at once
                  autoFocus
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              )}
            </Field>
            <Field
              label={t('staff.person.password')}
              hint={t('account.passwordHint')}
              error={errorText('password', fieldErrors.password)}
            >
              {(props) => <PasswordInput {...props} name="password" autoComplete="new-password" />}
            </Field>
          </>
        )}
      </OwnerPasswordDialog>
    </AccountCard>
  );
}
