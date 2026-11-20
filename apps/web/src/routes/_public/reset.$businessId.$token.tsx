import { zodResolver } from '@hookform/resolvers/zod';
import { resetCompleteSchema } from '@business-software/shared';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { completeReset } from '../../api/account';
import { ApiError } from '../../api/client';
import { PasswordInput } from '../../components/password-input';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { useFieldError } from '../../lib/field-error';
import { useRetryTime } from '../../lib/retry-time';

/**
 * Module 00 #30, #42: the page a reset email links to. Opening it changes nothing; the token is
 * used only when the new password is sent, so a mail scanner that opens links can't spend it.
 */
export const Route = createFileRoute('/_public/reset/$businessId/$token')({
  component: ResetPassword,
});

const newPasswordSchema = resetCompleteSchema.pick({ newPassword: true });
interface NewPasswordForm {
  newPassword: string;
}

function ResetPassword() {
  const { t } = useTranslation();
  const { businessId, token } = Route.useParams();
  const errorText = useFieldError();
  const retryTime = useRetryTime();
  const [outcome, setOutcome] = useState<'done' | 'invalid' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<NewPasswordForm>({
    resolver: zodResolver(newPasswordSchema),
    defaultValues: { newPassword: '' },
  });

  const onSubmit = async ({ newPassword }: NewPasswordForm) => {
    setFailure(null);
    try {
      await completeReset({ businessId, token, newPassword });
      setOutcome('done');
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setFailure(t('resetPage.failed'));
      } else if (error.code === 'invalid_link') {
        setOutcome('invalid');
      } else if (error.code === 'invalid_body' && error.fields.newPassword !== undefined) {
        setError('newPassword', { message: error.fields.newPassword });
      } else if (error.code === 'invalid_body') {
        // The address itself is broken: a business or token that can't be one.
        setOutcome('invalid');
      } else if (error.code === 'too_many_attempts') {
        setFailure(t('forgot.tooMany', { time: retryTime(error) }));
      } else if (error.code === 'busy') {
        setFailure(t('login.busy'));
      } else {
        setFailure(t('resetPage.failed'));
      }
    }
  };

  return (
    <Card className="w-full max-w-md self-start">
      <CardContent className="flex flex-col gap-6 px-8 py-7">
        <h1 className="text-title font-semibold">{t('resetPage.title')}</h1>
        {outcome === 'done' && (
          <div role="status" className="flex flex-col gap-4">
            <p className="rounded-lg bg-success-soft px-4 py-3 text-success">
              {t('resetPage.done')}
            </p>
            <Link to="/login" className="text-accent underline-offset-4 hover:underline">
              {t('resetPage.toLogin')}
            </Link>
          </div>
        )}
        {outcome === 'invalid' && (
          <div role="alert" className="flex flex-col gap-4">
            <p>{t('resetPage.invalid')}</p>
            <Link to="/forgot-password" className="text-accent underline-offset-4 hover:underline">
              {t('resetPage.askAgain')}
            </Link>
          </div>
        )}
        {outcome === null && (
          <form
            noValidate
            className="flex flex-col gap-5"
            onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          >
            <p className="text-muted">{t('resetPage.lead')}</p>
            <Field
              label={t('forgot.newPassword')}
              hint={t('account.passwordHint')}
              error={errorText('newPassword', errors.newPassword?.message)}
            >
              {(props) => (
                <PasswordInput
                  {...props}
                  autoComplete="new-password"
                  {...register('newPassword')}
                />
              )}
            </Field>
            {failure !== null && (
              <p role="alert" className="text-danger">
                {failure}
              </p>
            )}
            <Button type="submit" disabled={isSubmitting}>
              {t(isSubmitting ? 'resetPage.saving' : 'resetPage.submit')}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
