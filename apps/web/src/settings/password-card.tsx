import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordSchema, type ChangePasswordInput } from '@business-software/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { changePassword } from '../api/account';
import { ApiError } from '../api/client';
import { PasswordInput } from '../components/password-input';
import { Button } from '../components/ui/button';
import { Field } from '../components/ui/field';
import { useFieldError } from '../lib/field-error';
import { useRetryTime } from '../lib/retry-time';
import { AccountCard } from './account-card';
import { failureKey } from './failure-key';

/** Module 00 #46: the current password, then the new one; other computers are logged out. */
export function PasswordCard() {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const retryTime = useRetryTime();
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });

  const onSubmit = async (input: ChangePasswordInput) => {
    setDone(false);
    setFailure(null);
    try {
      await changePassword(input);
      reset();
      setDone(true);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'wrong_password') {
        setError('currentPassword', { message: 'wrong' });
      } else if (error instanceof ApiError && error.code === 'invalid_body') {
        for (const [field, code] of Object.entries(error.fields)) {
          setError(field as keyof ChangePasswordInput, { message: code });
        }
      } else {
        const code = error instanceof ApiError ? error.code : undefined;
        setFailure(
          t(failureKey(code), { time: error instanceof ApiError ? retryTime(error) : '' }),
        );
      }
    }
  };

  return (
    <AccountCard title={t('account.password.title')} lead={t('account.password.lead')}>
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      >
        <div className="grid grid-cols-2 gap-x-5 gap-y-4">
          <Field
            label={t('account.password.current')}
            error={errorText('currentPassword', errors.currentPassword?.message)}
          >
            {(props) => (
              <PasswordInput
                {...props}
                autoComplete="current-password"
                {...register('currentPassword')}
              />
            )}
          </Field>
          <Field
            label={t('forgot.newPassword')}
            hint={t('account.passwordHint')}
            error={errorText('newPassword', errors.newPassword?.message)}
          >
            {(props) => (
              <PasswordInput {...props} autoComplete="new-password" {...register('newPassword')} />
            )}
          </Field>
        </div>
        {failure !== null && (
          <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-danger">
            {failure}
          </p>
        )}
        <div className="flex items-center gap-4 border-t border-border pt-5">
          <Button type="submit" disabled={isSubmitting}>
            {t(isSubmitting ? 'account.password.saving' : 'account.password.submit')}
          </Button>
          {done && (
            <p role="status" className="text-label text-success">
              {t('account.password.done')}
            </p>
          )}
        </div>
      </form>
    </AccountCard>
  );
}
