import { zodResolver } from '@hookform/resolvers/zod';
import {
  ownerLoginSchema,
  type ActiveSession,
  staffLoginSchema,
  type OwnerLoginInput,
  type StaffLoginInput,
} from '@business-software/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, Navigate, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/client';
import { loginOwner, loginStaff, setSession, useSession } from '../../api/session';
import { PasswordInput } from '../../components/password-input';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { useFieldError } from '../../lib/field-error';
import { useRetryTime } from '../../lib/retry-time';

/** Module 00 #27, #28: the owner by email, staff by username on a remembered computer. */
export const Route = createFileRoute('/_public/login')({ component: Login });

type Who = 'owner' | 'staff';

function Login() {
  const { t } = useTranslation();
  const session = useSession();
  const device = session.data?.state === 'none' ? session.data.device : null;
  // Staff can log in only where the owner has logged in before (#28): the tab shows there.
  const [chosen, setChosen] = useState<Who | null>(null);
  const who: Who = chosen ?? (device === null ? 'owner' : 'staff');
  // Already logged in (another tab did it, or Back after logging in): go to the app.
  if (session.data !== undefined && session.data.state !== 'none') return <Navigate to="/" />;

  return (
    <Card className="w-full max-w-md self-start">
      <CardContent className="flex flex-col gap-6 px-8 py-7">
        <div className="flex flex-col gap-1">
          <h1 className="text-title font-semibold">{t('login.title')}</h1>
          {device !== null && (
            <p className="text-muted">{t('login.counterOf', { business: device.businessName })}</p>
          )}
        </div>
        {device !== null && (
          <div role="group" aria-label={t('login.who')} className="grid grid-cols-2 gap-2">
            {(['staff', 'owner'] as const).map((option) => (
              <Button
                key={option}
                type="button"
                variant={who === option ? 'primary' : 'secondary'}
                aria-pressed={who === option}
                onClick={() => {
                  setChosen(option);
                }}
              >
                {t(`login.as.${option}`)}
              </Button>
            ))}
          </div>
        )}
        {who === 'owner' ? <OwnerForm /> : <StaffForm />}
        <p className="text-muted">
          {t('login.newBusiness')}{' '}
          <Link to="/signup" className="text-accent underline-offset-4 hover:underline">
            {t('login.signUp')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

/** The words for a failed login: wrong details, too many tries, or the connection. */
function useLoginFailure(): (error: unknown, who: Who) => string {
  const { t } = useTranslation();
  const retryTime = useRetryTime();
  return (error, who) => {
    if (!(error instanceof ApiError)) return t('login.failed');
    switch (error.code) {
      case 'wrong_login':
        return t(who === 'owner' ? 'login.wrongOwner' : 'login.wrongStaff');
      case 'too_many_attempts':
        return t('login.tooMany', { time: retryTime(error) });
      case 'no_device':
        return t('login.noDevice');
      case 'busy':
        return t('login.busy');
      default:
        return t('login.failed');
    }
  };
}

function useFinishLogin() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async (view: ActiveSession) => {
    setSession(queryClient, view);
    await navigate({ to: '/' });
  };
}

function OwnerForm() {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const failureText = useLoginFailure();
  const finish = useFinishLogin();
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OwnerLoginInput>({
    resolver: zodResolver(ownerLoginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async ({ email, password }: OwnerLoginInput) => {
    setFailure(null);
    try {
      await finish(await loginOwner(email, password));
    } catch (error) {
      setFailure(failureText(error, 'owner'));
    }
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
    >
      <Field label={t('login.email')} error={errorText('email', errors.email?.message)}>
        {(props) => (
          <Input {...props} type="email" autoComplete="username" {...register('email')} />
        )}
      </Field>
      <Field label={t('login.password')} error={errorText('password', errors.password?.message)}>
        {(props) => (
          <PasswordInput {...props} autoComplete="current-password" {...register('password')} />
        )}
      </Field>
      {failure !== null && (
        <p role="alert" className="text-danger">
          {failure}
        </p>
      )}
      <Button type="submit" disabled={isSubmitting}>
        {t(isSubmitting ? 'login.submitting' : 'login.submit')}
      </Button>
    </form>
  );
}

function StaffForm() {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const failureText = useLoginFailure();
  const finish = useFinishLogin();
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<StaffLoginInput>({
    resolver: zodResolver(staffLoginSchema),
    defaultValues: { username: '', password: '' },
  });

  const onSubmit = async ({ username, password }: StaffLoginInput) => {
    setFailure(null);
    try {
      await finish(await loginStaff(username, password));
    } catch (error) {
      setFailure(failureText(error, 'staff'));
    }
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
    >
      <Field label={t('login.username')} error={errorText('username', errors.username?.message)}>
        {(props) => (
          <Input
            {...props}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            {...register('username')}
          />
        )}
      </Field>
      <Field label={t('login.password')} error={errorText('password', errors.password?.message)}>
        {(props) => (
          <PasswordInput {...props} autoComplete="current-password" {...register('password')} />
        )}
      </Field>
      {failure !== null && (
        <p role="alert" className="text-danger">
          {failure}
        </p>
      )}
      <Button type="submit" disabled={isSubmitting}>
        {t(isSubmitting ? 'login.submitting' : 'login.submit')}
      </Button>
    </form>
  );
}
