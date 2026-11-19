import { zodResolver } from '@hookform/resolvers/zod';
import { unlockSchema, type ActiveSession, type UnlockInput } from '@business-software/shared';
import { LockKeyhole } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { unlockSession } from '../api/session';
import { useSessionActions } from '../api/session-actions';
import { useFieldError } from '../lib/field-error';
import { useRetryTime } from '../lib/retry-time';
import { useShortcutContext } from '../shortcuts/context';
import { PasswordInput } from './password-input';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Field } from './ui/field';

/**
 * Module 00 #21, #38: the owner's locked screen. The page stays loaded underneath (a half-made
 * bill survives) but is blurred and `inert`, and no shortcut fires until the password is typed.
 */
export function LockScreen({ session }: { session: ActiveSession }) {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const retryTime = useRetryTime();
  const actions = useSessionActions();
  const { registry } = useShortcutContext();
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<UnlockInput>({
    resolver: zodResolver(unlockSchema),
    defaultValues: { password: '' },
  });

  // The password box is the only thing to do here.
  useEffect(() => {
    setFocus('password');
  }, [setFocus]);

  useEffect(() => {
    registry.setPaused(true);
    return () => {
      registry.setPaused(false);
    };
  }, [registry]);

  const onSubmit = async ({ password }: UnlockInput) => {
    setFailure(null);
    try {
      await unlockSession(password);
      actions.unlocked();
    } catch (error) {
      reset({ password: '' });
      if (!(error instanceof ApiError)) {
        setFailure(t('lock.failed'));
      } else if (error.code === 'wrong_password') {
        setFailure(t('lock.wrongPassword'));
      } else if (error.code === 'too_many_attempts') {
        setFailure(t('login.tooMany', { time: retryTime(error) }));
      } else {
        setFailure(t('lock.failed'));
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lock-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 backdrop-blur-md"
    >
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col gap-6 px-8 py-7">
          <div className="flex flex-col items-center gap-2 text-center">
            <span
              aria-hidden="true"
              className="flex size-12 items-center justify-center rounded-full bg-surface-muted text-accent [&_svg]:size-6"
            >
              <LockKeyhole />
            </span>
            <h1 id="lock-title" className="text-title font-semibold">
              {t('lock.title')}
            </h1>
            <p className="text-muted">
              {t('lock.who', { user: session.user.name, business: session.business.name })}
            </p>
          </div>
          <form
            noValidate
            className="flex flex-col gap-5"
            onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          >
            <Field
              label={t('login.password')}
              error={errorText('password', errors.password?.message)}
            >
              {(props) => (
                <PasswordInput
                  {...props}
                  autoComplete="current-password"
                  {...register('password')}
                />
              )}
            </Field>
            {failure !== null && (
              <p role="alert" className="text-danger">
                {failure}
              </p>
            )}
            <Button type="submit" disabled={isSubmitting}>
              {t(isSubmitting ? 'lock.unlocking' : 'lock.unlock')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                void actions.logout();
              }}
            >
              {t('lock.switchUser')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
