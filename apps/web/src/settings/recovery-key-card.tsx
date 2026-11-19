import { zodResolver } from '@hookform/resolvers/zod';
import { ownerPasswordSchema, type OwnerPasswordInput } from '@business-software/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { newRecoveryKey } from '../api/account';
import { ApiError } from '../api/client';
import { PasswordInput } from '../components/password-input';
import { RecoveryKeyPanel } from '../components/recovery-key-panel';
import { useMadeOn } from '../lib/made-on';
import { Button } from '../components/ui/button';
import { Field } from '../components/ui/field';
import { useFieldError } from '../lib/field-error';
import { useRetryTime } from '../lib/retry-time';
import { AccountCard } from './account-card';
import { failureKey } from './failure-key';

/**
 * Module 00 #31: "Make a new recovery key", for a lost or used-up key. Needs the owner's
 * password (design section 6); the old key stops working and the new one is shown once.
 */
export function RecoveryKeyCard({ businessName }: { businessName: string }) {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const retryTime = useRetryTime();
  const madeOn = useMadeOn();
  const [key, setKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<OwnerPasswordInput>({
    resolver: zodResolver(ownerPasswordSchema),
    defaultValues: { ownerPassword: '' },
  });

  const onSubmit = async ({ ownerPassword }: OwnerPasswordInput) => {
    setFailure(null);
    try {
      setKey((await newRecoveryKey(ownerPassword)).recoveryKey);
      reset();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'wrong_password') {
        setError('ownerPassword', { message: 'wrong' });
      } else {
        const code = error instanceof ApiError ? error.code : undefined;
        setFailure(
          t(failureKey(code), { time: error instanceof ApiError ? retryTime(error) : '' }),
        );
      }
    }
  };

  return (
    <AccountCard title={t('account.recoveryKey.title')} lead={t('account.recoveryKey.lead')}>
      {key !== null ? (
        <RecoveryKeyPanel
          recoveryKey={key}
          heading="h3"
          printedLine={t('recoveryKey.printedFor', {
            business: businessName,
            date: madeOn(new Date()),
          })}
          doneLabel={t('account.recoveryKey.done')}
          onDone={() => {
            setKey(null);
          }}
        />
      ) : (
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        >
          <div className="max-w-xs">
            <Field
              label={t('account.ownerPassword')}
              error={errorText('ownerPassword', errors.ownerPassword?.message)}
            >
              {(props) => (
                <PasswordInput
                  {...props}
                  autoComplete="current-password"
                  {...register('ownerPassword')}
                />
              )}
            </Field>
          </div>
          {failure !== null && (
            <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-danger">
              {failure}
            </p>
          )}
          <div className="border-t border-border pt-5">
            <Button type="submit" variant="secondary" disabled={isSubmitting}>
              {t(isSubmitting ? 'account.recoveryKey.making' : 'account.recoveryKey.submit')}
            </Button>
          </div>
        </form>
      )}
    </AccountCard>
  );
}
