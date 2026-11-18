import { zodResolver } from '@hookform/resolvers/zod';
import {
  BUSINESS_TYPES,
  GST_STATUSES,
  INDIAN_STATES,
  signupSchema,
  type SignupInput,
  type SignupResult,
} from '@business-software/shared';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  Boxes,
  Eye,
  EyeOff,
  Hammer,
  NotebookPen,
  Pill,
  ReceiptText,
  Shirt,
  ShoppingBasket,
  Smartphone,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { ApiError, apiRequest } from '../../api/client';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { ChoiceCards } from '../../components/ui/choice-cards';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { useFieldError } from '../../lib/field-error';
import { holdRecoveryKey } from '../../signup/pending-key';

/** Module 00 #7: seven fields, then the recovery key (#31). */
export const Route = createFileRoute('/_public/signup')({ component: Signup });

const TYPE_ICONS: Record<(typeof BUSINESS_TYPES)[number], ReactNode> = {
  kirana: <ShoppingBasket />,
  medical: <Pill />,
  clothing: <Shirt />,
  electronics: <Smartphone />,
  hardware: <Hammer />,
};

type FormValues = z.input<typeof signupSchema>;

function Signup() {
  const { t, i18n } = useTranslation();
  const errorText = useFieldError();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [failed, setFailed] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { businessName: '', phone: '', stateCode: '', email: '', password: '' },
  });

  const states = INDIAN_STATES.map(({ code }) => ({
    code,
    name: t(`states.${code}`),
  })).sort((a, b) => a.name.localeCompare(b.name, i18n.language));

  const onSubmit = async (input: SignupInput) => {
    setFailed(false);
    try {
      const result = await apiRequest<SignupResult>('POST', '/api/signup', input);
      holdRecoveryKey({ businessName: input.businessName, recoveryKey: result.recoveryKey });
      await navigate({ to: '/signup/recovery-key' });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'email_taken') {
        setError('email', { message: 'email_taken' }, { shouldFocus: true });
      } else if (error instanceof ApiError && error.code === 'invalid_body') {
        // The form checks the same schema, so this only happens if the two ever drift.
        for (const [field, code] of Object.entries(error.fields)) {
          setError(field as keyof FormValues, { message: code });
        }
      } else {
        setFailed(true);
      }
    }
  };

  return (
    <div className="grid w-full max-w-5xl grid-cols-1 items-start gap-10 lg:grid-cols-[2fr_3fr]">
      <section className="flex flex-col gap-6 lg:sticky lg:top-10" aria-labelledby="pitch">
        <h2 id="pitch" className="text-figure font-semibold">
          {t('signup.pitch.title')}
        </h2>
        <ul className="flex flex-col gap-4">
          {[
            { icon: <ReceiptText />, text: t('signup.pitch.billing') },
            { icon: <Boxes />, text: t('signup.pitch.stock') },
            { icon: <NotebookPen />, text: t('signup.pitch.udhaar') },
          ].map(({ icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-section">
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface text-accent shadow-card [&_svg]:size-5"
              >
                {icon}
              </span>
              {text}
            </li>
          ))}
        </ul>
      </section>

      <Card>
        <CardContent className="flex flex-col gap-6 px-8 py-7">
          <div className="flex flex-col gap-1">
            <h1 className="text-title font-semibold">{t('signup.title')}</h1>
            <p className="text-muted">{t('signup.lead')}</p>
          </div>
          <form
            noValidate
            className="flex flex-col gap-5"
            onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          >
            <Field
              label={t('signup.fields.businessName')}
              error={errorText('businessName', errors.businessName?.message)}
            >
              {(props) => (
                <Input {...props} autoComplete="organization" {...register('businessName')} />
              )}
            </Field>

            <ChoiceCards
              label={t('signup.fields.businessType')}
              error={errorText('businessType', errors.businessType?.message)}
              choices={BUSINESS_TYPES.map((type) => ({
                value: type,
                title: t(`businessTypes.${type}.name`),
                hint: t(`businessTypes.${type}.hint`),
                icon: TYPE_ICONS[type],
              }))}
              inputProps={register('businessType')}
            />

            <div className="grid grid-cols-2 gap-4">
              <Field
                label={t('signup.fields.phone')}
                error={errorText('phone', errors.phone?.message)}
              >
                {(props) => (
                  <Input
                    {...props}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    {...register('phone')}
                  />
                )}
              </Field>
              <Field
                label={t('signup.fields.state')}
                error={errorText('stateCode', errors.stateCode?.message)}
              >
                {(props) => (
                  <Select {...props} {...register('stateCode')}>
                    <option value="" disabled>
                      {t('signup.fields.statePlaceholder')}
                    </option>
                    {states.map(({ code, name }) => (
                      <option key={code} value={code}>
                        {name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            <ChoiceCards
              label={t('signup.fields.gstStatus')}
              columns="grid-cols-3"
              error={errorText('gstStatus', errors.gstStatus?.message)}
              choices={GST_STATUSES.map((status) => ({
                value: status,
                title: t(`gstStatuses.${status}.name`),
                hint: t(`gstStatuses.${status}.hint`),
              }))}
              inputProps={register('gstStatus')}
            />

            <Field
              label={t('signup.fields.email')}
              hint={t('signup.fields.emailHint')}
              error={errorText('email', errors.email?.message)}
            >
              {(props) => (
                <Input {...props} type="email" autoComplete="email" {...register('email')} />
              )}
            </Field>

            <Field
              label={t('signup.fields.password')}
              hint={t('signup.fields.passwordHint')}
              error={errorText('password', errors.password?.message)}
            >
              {(props) => (
                <div className="relative">
                  <Input
                    {...props}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    className="pr-12"
                    {...register('password')}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-0 right-0"
                    aria-label={t(showPassword ? 'signup.hidePassword' : 'signup.showPassword')}
                    onClick={() => {
                      setShowPassword((shown) => !shown);
                    }}
                  >
                    {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </Button>
                </div>
              )}
            </Field>

            {failed && (
              <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-danger">
                {t('signup.failed')}
              </p>
            )}

            <Button type="submit" disabled={isSubmitting} className="self-start">
              {t(isSubmitting ? 'signup.submitting' : 'signup.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
