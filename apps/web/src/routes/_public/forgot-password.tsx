import { zodResolver } from '@hookform/resolvers/zod';
import {
  recoveryResetSchema,
  resetRequestSchema,
  type RecoveryResetInput,
  type ResetRequestInput,
} from '@business-software/shared';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { MailCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { resetWithRecoveryKey, requestReset } from '../../api/account';
import { ApiError } from '../../api/client';
import { PasswordInput } from '../../components/password-input';
import { RecoveryKeyPanel } from '../../components/recovery-key-panel';
import { useMadeOn } from '../../lib/made-on';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { useFieldError } from '../../lib/field-error';
import { useRetryTime } from '../../lib/retry-time';

/**
 * Module 00 #30, #31: a reset link by email (only to a confirmed email), or the recovery key,
 * which changes the password at once and shows the next key.
 */
export const Route = createFileRoute('/_public/forgot-password')({ component: ForgotPassword });

type Way = 'email' | 'key';

function ForgotPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const madeOn = useMadeOn();
  const [way, setWay] = useState<Way>('email');
  const [newKey, setNewKey] = useState<string | null>(null);

  if (newKey !== null) {
    return (
      <Card className="w-full max-w-2xl self-start print:shadow-none">
        <CardContent className="flex flex-col gap-6 px-8 py-7">
          <p role="status" className="rounded-lg bg-success-soft px-4 py-3 text-success">
            {t('forgot.key.done')}
          </p>
          <RecoveryKeyPanel
            recoveryKey={newKey}
            printedLine={t('recoveryKey.printedOn', { date: madeOn(new Date()) })}
            doneLabel={t('forgot.toLogin')}
            onDone={() => {
              void navigate({ to: '/login' });
            }}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md self-start">
      <CardContent className="flex flex-col gap-6 px-8 py-7">
        <div className="flex flex-col gap-1">
          <h1 className="text-title font-semibold">{t('forgot.title')}</h1>
          <p className="text-muted">{t('forgot.lead')}</p>
        </div>
        <div role="group" aria-label={t('forgot.way')} className="grid grid-cols-2 gap-2">
          {(['email', 'key'] as const).map((option) => (
            <Button
              key={option}
              type="button"
              variant={way === option ? 'primary' : 'secondary'}
              aria-pressed={way === option}
              onClick={() => {
                setWay(option);
              }}
            >
              {t(`forgot.ways.${option}`)}
            </Button>
          ))}
        </div>
        {way === 'email' ? (
          <EmailForm
            onUseKey={() => {
              setWay('key');
            }}
          />
        ) : (
          <KeyForm onReset={setNewKey} />
        )}
        <Link to="/login" className="text-accent underline-offset-4 hover:underline">
          {t('forgot.backToLogin')}
        </Link>
      </CardContent>
    </Card>
  );
}

function EmailForm({ onUseKey }: { onUseKey: () => void }) {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const retryTime = useRetryTime();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetRequestInput>({
    resolver: zodResolver(resetRequestSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = async ({ email }: ResetRequestInput) => {
    setFailure(null);
    try {
      await requestReset(email);
      setSentTo(email);
    } catch (error) {
      setFailure(
        error instanceof ApiError && error.code === 'too_many_attempts'
          ? t('forgot.tooMany', { time: retryTime(error) })
          : t('forgot.failed'),
      );
    }
  };

  if (sentTo !== null) {
    return (
      <div role="status" className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <MailCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
          <p>{t('forgot.email.sent', { email: sentTo })}</p>
        </div>
        <p className="text-muted">{t('forgot.email.noEmail')}</p>
        <Button variant="secondary" className="self-start" onClick={onUseKey}>
          {t('forgot.ways.key')}
        </Button>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
    >
      <p className="text-muted">{t('forgot.email.lead')}</p>
      <Field label={t('login.email')} error={errorText('email', errors.email?.message)}>
        {(props) => (
          <Input {...props} type="email" autoComplete="username" {...register('email')} />
        )}
      </Field>
      {failure !== null && (
        <p role="alert" className="text-danger">
          {failure}
        </p>
      )}
      <Button type="submit" disabled={isSubmitting}>
        {t(isSubmitting ? 'forgot.email.sending' : 'forgot.email.submit')}
      </Button>
    </form>
  );
}

function KeyForm({ onReset }: { onReset: (recoveryKey: string) => void }) {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const retryTime = useRetryTime();
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RecoveryResetInput>({
    resolver: zodResolver(recoveryResetSchema),
    defaultValues: { email: '', recoveryKey: '', newPassword: '' },
  });

  const onSubmit = async (input: RecoveryResetInput) => {
    setFailure(null);
    try {
      onReset((await resetWithRecoveryKey(input)).recoveryKey);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setFailure(t('forgot.failed'));
      } else if (error.code === 'invalid_body' && error.fields.newPassword !== undefined) {
        setError('newPassword', { message: error.fields.newPassword });
      } else if (error.code === 'wrong_recovery_key') {
        setFailure(t('forgot.key.wrong'));
      } else if (error.code === 'too_many_attempts') {
        setFailure(t('forgot.tooMany', { time: retryTime(error) }));
      } else if (error.code === 'busy') {
        setFailure(t('login.busy'));
      } else {
        setFailure(t('forgot.failed'));
      }
    }
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
    >
      <p className="text-muted">{t('forgot.key.lead')}</p>
      <Field label={t('login.email')} error={errorText('email', errors.email?.message)}>
        {(props) => (
          <Input {...props} type="email" autoComplete="username" {...register('email')} />
        )}
      </Field>
      <Field
        label={t('forgot.key.label')}
        hint={t('forgot.key.hint')}
        error={errorText('recoveryKey', errors.recoveryKey?.message)}
      >
        {(props) => (
          <Input
            {...props}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="font-mono tracking-wider"
            {...register('recoveryKey')}
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
      {failure !== null && (
        <p role="alert" className="text-danger">
          {failure}
        </p>
      )}
      <Button type="submit" disabled={isSubmitting}>
        {t(isSubmitting ? 'forgot.key.submitting' : 'forgot.key.submit')}
      </Button>
    </form>
  );
}
