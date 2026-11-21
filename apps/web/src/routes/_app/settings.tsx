import { zodResolver } from '@hookform/resolvers/zod';
import {
  BUSINESS_TYPES,
  FEATURE_PRESETS,
  FEATURES,
  BRANCH_STATES,
  GST_STATUSES,
  settingsBusinessSchema,
  settingsFeaturesSchema,
  settingsSecuritySchema,
  settingsStockSchema,
  type BusinessType,
  type SettingsBusinessInput,
  type SettingsFeaturesInput,
  type SettingsSecurityInput,
  type SettingsStockInput,
  type SettingsView,
} from '@business-software/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useId, useState, type ReactNode } from 'react';
import {
  useForm,
  useWatch,
  type FieldValues,
  type Path,
  type UseFormSetError,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { ApiError, apiRequest } from '../../api/client';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { ChoiceCards } from '../../components/ui/choice-cards';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { useFieldError } from '../../lib/field-error';
import { DevicesCard } from '../../settings/devices-card';
import { PasswordCard } from '../../settings/password-card';
import { RecoveryKeyCard } from '../../settings/recovery-key-card';

/**
 * Module 00 #8–16, #3 and #21/#29, and Module 01 #12: the owner's settings, one card per save
 * (design §8). Then the
 * login's own safety: password (#46), recovery key (#31) and remembered computers (#44).
 */
export const Route = createFileRoute('/_app/settings')({
  component: Settings,
  staticData: { titleKey: 'nav.settings', permission: 'settings.view' },
});

const SETTINGS_KEY = ['settings'];

function Settings() {
  const { t } = useTranslation();
  const settings = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => apiRequest<SettingsView>('GET', '/api/settings'),
    // A 401 or a 500 won't fix itself in a second; the counter gets a Try again button instead.
    retry: false,
  });

  if (settings.isPending) return <p className="text-muted">{t('settings.loading')}</p>;
  if (settings.isError) {
    if (settings.error instanceof ApiError && settings.error.status === 401) {
      return (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>{t('settings.loggedOut.title')}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted">{t('settings.loggedOut.body')}</CardContent>
        </Card>
      );
    }
    return (
      <div role="alert" className="flex max-w-xl flex-col items-start gap-3">
        <p>{t('settings.loadFailed')}</p>
        <Button variant="secondary" onClick={() => void settings.refetch()}>
          {t('settings.retry')}
        </Button>
      </div>
    );
  }

  const view = settings.data;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {/* Printing a new recovery key prints that card alone. */}
      <div className="flex flex-col gap-6 print:hidden">
        <BusinessCard saved={view.business} />
        <FeaturesCard saved={view.features} businessType={view.business.businessType} />
        <SecurityCard saved={view.security} />
        <StockCard saved={view.stock} />
        <PasswordCard />
      </div>
      <RecoveryKeyCard businessName={view.business.businessName} />
      <div className="print:hidden">
        <DevicesCard />
      </div>
    </div>
  );
}

/**
 * Sends one card to its PUT, then shows what the server kept (PAN and GSTIN come back upper
 * case) and updates the page's copy, so the other cards see the new business type.
 */
function useSave<Form extends FieldValues>(
  card: 'business' | 'features' | 'security' | 'stock',
  setError: UseFormSetError<Form>,
  onSaved: (view: SettingsView) => void,
) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<'idle' | 'saved' | 'failed'>('idle');
  const save = async (input: unknown) => {
    setState('idle');
    try {
      const view = await apiRequest<SettingsView>('PUT', `/api/settings/${card}`, input);
      queryClient.setQueryData(SETTINGS_KEY, view);
      onSaved(view);
      setState('saved');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'invalid_body') {
        // The form checks the same schema, so this only happens if the two ever drift.
        for (const [field, code] of Object.entries(error.fields)) {
          setError(field as Path<Form>, { message: code });
        }
      } else {
        setState('failed');
      }
    }
  };
  return { save, state };
}

/** A card with a heading the page's landmarks can name, its fields, and its own Save. */
function SettingsCard({
  title,
  lead,
  state,
  dirty,
  submitting,
  onSubmit,
  children,
}: {
  title: string;
  lead: string;
  state: 'idle' | 'saved' | 'failed';
  dirty: boolean;
  submitting: boolean;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader className="flex flex-col gap-1 px-7 pt-6">
        <CardTitle id={titleId}>{title}</CardTitle>
        <p className="text-muted">{lead}</p>
      </CardHeader>
      <CardContent className="px-7 pb-6">
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {children}
          {state === 'failed' && (
            <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-danger">
              {t('settings.saveFailed')}
            </p>
          )}
          <div className="flex items-center gap-4 border-t border-border pt-5">
            <Button type="submit" disabled={submitting}>
              {t(submitting ? 'settings.saving' : 'settings.save')}
            </Button>
            {state === 'saved' && !dirty && (
              <p role="status" className="text-label text-success">
                {t('settings.saved')}
              </p>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

type BusinessForm = z.input<typeof settingsBusinessSchema>;

/** Inputs hold text, so the blanks the API sends as null start as empty strings. */
function businessForm(business: SettingsBusinessInput): BusinessForm {
  return Object.fromEntries(
    Object.entries(business).map(([key, value]) => [key, value ?? '']),
  ) as BusinessForm;
}

function BusinessCard({ saved }: { saved: SettingsBusinessInput }) {
  const { t, i18n } = useTranslation();
  const errorText = useFieldError();
  const form = useForm<BusinessForm, unknown, SettingsBusinessInput>({
    resolver: zodResolver(settingsBusinessSchema),
    defaultValues: businessForm(saved),
  });
  const { register, formState } = form;
  const { save, state } = useSave<BusinessForm>('business', form.setError, (view) => {
    form.reset(businessForm(view.business));
  });
  const error = (field: keyof BusinessForm) => errorText(field, formState.errors[field]?.message);
  const states = BRANCH_STATES.map(({ code }) => ({ code, name: t(`states.${code}`) })).sort(
    (a, b) => a.name.localeCompare(b.name, i18n.language),
  );
  const text = (field: keyof BusinessForm, label: string, extra: object = {}) => (
    <Field label={label} error={error(field)}>
      {(props) => <Input {...props} {...extra} {...register(field)} />}
    </Field>
  );

  return (
    <SettingsCard
      title={t('settings.business.title')}
      lead={t('settings.business.lead')}
      state={state}
      dirty={formState.isDirty}
      submitting={formState.isSubmitting}
      onSubmit={() => void form.handleSubmit(save)()}
    >
      <div className="grid grid-cols-2 gap-x-5 gap-y-4">
        {text('businessName', t('signup.fields.businessName'), { autoComplete: 'organization' })}
        {text('ownerName', t('settings.business.fields.ownerName'), { autoComplete: 'name' })}
        <Field label={t('signup.fields.businessType')} error={error('businessType')}>
          {(props) => (
            <Select {...props} {...register('businessType')}>
              {BUSINESS_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`businessTypes.${type}.name`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {text('phone', t('signup.fields.phone'), { type: 'tel', autoComplete: 'tel' })}
        <Field label={t('signup.fields.gstStatus')} error={error('gstStatus')}>
          {(props) => (
            <Select {...props} {...register('gstStatus')}>
              {GST_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`gstStatuses.${status}.name`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {text('pan', t('settings.business.fields.pan'), { className: 'uppercase' })}
      </div>

      <CardTitle level={3} className="border-t border-border pt-5">
        {t('settings.business.branchTitle')}
      </CardTitle>
      <div className="grid grid-cols-2 gap-x-5 gap-y-4">
        {text('branchName', t('settings.business.fields.branchName'))}
        <Field label={t('signup.fields.state')} error={error('stateCode')}>
          {(props) => (
            <Select {...props} {...register('stateCode')}>
              {states.map(({ code, name }) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="col-span-2">
          <Field label={t('settings.business.fields.address')} error={error('address')}>
            {(props) => (
              <Textarea {...props} autoComplete="street-address" {...register('address')} />
            )}
          </Field>
        </div>
        {text('pinCode', t('settings.business.fields.pinCode'), {
          inputMode: 'numeric',
          autoComplete: 'postal-code',
        })}
        {text('gstin', t('settings.business.fields.gstin'), { className: 'uppercase' })}
        {text('drugLicence', t('settings.business.fields.drugLicence'))}
        {text('fssai', t('settings.business.fields.fssai'), { inputMode: 'numeric' })}
      </div>
    </SettingsCard>
  );
}

/** Ticked boxes, in the list's own order: the same switches always send the same list. */
const inListOrder = (features: readonly string[]) =>
  FEATURES.filter((feature) => features.includes(feature));

function FeaturesCard({
  saved,
  businessType,
}: {
  saved: SettingsFeaturesInput['features'];
  businessType: BusinessType;
}) {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const form = useForm<SettingsFeaturesInput>({
    resolver: zodResolver(settingsFeaturesSchema),
    defaultValues: { features: [...saved] },
  });
  const { save, state } = useSave<SettingsFeaturesInput>('features', form.setError, (view) => {
    form.reset({ features: [...view.features] });
  });
  const preset = FEATURE_PRESETS[businessType];
  const ticked = useWatch({ control: form.control, name: 'features' });
  // Changing the type keeps the switches (a kirana that also sells stationery keeps its own);
  // the type's defaults are one click away (design §7).
  const matchesPreset =
    ticked.length === preset.length && preset.every((feature) => ticked.includes(feature));

  return (
    <SettingsCard
      title={t('settings.features.title')}
      lead={t('settings.features.lead')}
      state={state}
      dirty={form.formState.isDirty}
      submitting={form.formState.isSubmitting}
      onSubmit={() =>
        void form.handleSubmit((input) => save({ features: inListOrder(input.features) }))()
      }
    >
      <ChoiceCards
        type="checkbox"
        label={t('settings.features.title')}
        columns="grid-cols-3"
        error={errorText('features', form.formState.errors.features?.message)}
        choices={FEATURES.map((feature) => ({ value: feature, title: t(`features.${feature}`) }))}
        inputProps={form.register('features')}
      />
      {!matchesPreset && (
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => {
            form.setValue('features', [...preset], { shouldDirty: true });
          }}
        >
          {t('settings.features.useDefaults', { type: t(`businessTypes.${businessType}.name`) })}
        </Button>
      )}
    </SettingsCard>
  );
}

function SecurityCard({ saved }: { saved: SettingsSecurityInput }) {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const form = useForm<SettingsSecurityInput>({
    resolver: zodResolver(settingsSecuritySchema),
    defaultValues: saved,
  });
  const { save, state } = useSave<SettingsSecurityInput>('security', form.setError, (view) => {
    form.reset(view.security);
  });
  const minutes = (field: keyof SettingsSecurityInput, label: string, hint: string) => (
    <Field
      label={label}
      hint={hint}
      error={errorText(field, form.formState.errors[field]?.message)}
    >
      {(props) => (
        <Input
          {...props}
          type="number"
          inputMode="numeric"
          className="w-28"
          {...form.register(field, { valueAsNumber: true })}
        />
      )}
    </Field>
  );

  return (
    <SettingsCard
      title={t('settings.security.title')}
      lead={t('settings.security.lead')}
      state={state}
      dirty={form.formState.isDirty}
      submitting={form.formState.isSubmitting}
      onSubmit={() => void form.handleSubmit(save)()}
    >
      <div className="grid grid-cols-2 gap-x-5 gap-y-4">
        {minutes(
          'ownerLockMinutes',
          t('settings.security.ownerLock'),
          t('settings.security.ownerLockHint'),
        )}
        {minutes(
          'staffIdleMinutes',
          t('settings.security.staffIdle'),
          t('settings.security.staffIdleHint'),
        )}
      </div>
    </SettingsCard>
  );
}

/** Module 01 #12 (owner answer 1A): one switch for the whole business; billing uses it (P1.14). */
function StockCard({ saved }: { saved: SettingsStockInput }) {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const form = useForm<SettingsStockInput>({
    resolver: zodResolver(settingsStockSchema),
    defaultValues: saved,
  });
  const { save, state } = useSave<SettingsStockInput>('stock', form.setError, (view) => {
    form.reset(view.stock);
  });

  return (
    <SettingsCard
      title={t('settings.stock.title')}
      lead={t('settings.stock.lead')}
      state={state}
      dirty={form.formState.isDirty}
      submitting={form.formState.isSubmitting}
      onSubmit={() => void form.handleSubmit(save)()}
    >
      <ChoiceCards
        label={t('settings.stock.negative')}
        error={errorText('negativeStock', form.formState.errors.negativeStock?.message)}
        choices={[
          { value: 'warn', title: t('settings.stock.warn'), hint: t('settings.stock.warnHint') },
          { value: 'block', title: t('settings.stock.block'), hint: t('settings.stock.blockHint') },
        ]}
        inputProps={form.register('negativeStock')}
      />
    </SettingsCard>
  );
}
