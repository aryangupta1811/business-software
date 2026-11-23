import { SALARY_KINDS } from '@business-software/shared';
import { useId } from 'react';
import type { UseFormRegister, FieldErrors as FormErrors } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { PasswordInput } from '../components/password-input';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { useDateWords } from '../lib/dates';
import { useFieldError } from '../lib/field-error';
import type { PersonForm } from './record-form';

/**
 * The Person card's fields (P1.5 design §6, P2.3 design §6): name, the username of a login, the
 * home branch (only when the business has more than one), the phone and joining date, then pay
 * and leave: weekly off, paid leaves, overtime and, when adding, a first salary. Salary changes
 * of someone already here go through the Salary card, so its history stays.
 */
export function PersonFields({
  register,
  errors,
  branches,
  withUsername,
  withPassword,
  withSalary,
  loginSwitch,
}: {
  register: UseFormRegister<PersonForm>;
  errors: FormErrors<PersonForm>;
  branches: readonly { id: string; name: string }[];
  withUsername: boolean;
  /** The first password, with its show/hide box: only when adding a login. */
  withPassword: boolean;
  withSalary: boolean;
  /** Adding: the "Can log in" switch, which decides whether a login is made (`00` #19). */
  loginSwitch: boolean;
}) {
  const { t } = useTranslation();
  const words = useDateWords();
  const errorText = useFieldError();
  const loginHintId = useId();
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2">
        {loginSwitch && (
          <div className="flex flex-col gap-1 md:col-span-2">
            <label className="flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                aria-describedby={loginHintId}
                {...register('canLogin')}
              />
              {t('staff.person.canLogin')}
            </label>
            <p id={loginHintId} className="pl-6 text-label text-muted">
              {t('staff.person.canLoginHint')}
            </p>
          </div>
        )}
        <Field label={t('staff.person.name')} error={errorText('name', errors.name?.message)}>
          {(props) => <Input {...props} autoComplete="off" {...register('name')} />}
        </Field>
        {withUsername && (
          <Field
            label={t('staff.person.username')}
            hint={t('staff.person.usernameHint')}
            error={errorText('username', errors.username?.message)}
          >
            {(props) => (
              <Input
                {...props}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                {...register('username')}
              />
            )}
          </Field>
        )}
        {withPassword && (
          <Field
            label={t('staff.person.password')}
            hint={t('account.passwordHint')}
            error={errorText('password', errors.password?.message)}
          >
            {(props) => (
              <PasswordInput {...props} autoComplete="new-password" {...register('password')} />
            )}
          </Field>
        )}
        <Field label={t('staff.person.phone')} error={errorText('phone', errors.phone?.message)}>
          {(props) => <Input {...props} type="tel" autoComplete="off" {...register('phone')} />}
        </Field>
        {branches.length > 1 && (
          <Field
            label={t('staff.person.branch')}
            error={errorText('homeBranchId', errors.homeBranchId?.message)}
          >
            {(props) => (
              <Select {...props} {...register('homeBranchId')}>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field
          label={t('staff.person.joiningDate')}
          error={errorText('joiningDate', errors.joiningDate?.message)}
        >
          {(props) => <Input {...props} type="date" {...register('joiningDate')} />}
        </Field>
      </div>

      <div className="flex flex-col gap-4 border-t border-border pt-5">
        <h3 className="text-section font-semibold">{t('staff.person.payTitle')}</h3>
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2">
          <Field
            label={t('staff.person.weeklyOff')}
            error={errorText('weeklyOffDay', errors.weeklyOffDay?.message)}
          >
            {(props) => (
              <Select {...props} {...register('weeklyOffDay')}>
                <option value="">{t('staff.person.noWeeklyOff')}</option>
                {Array.from({ length: 7 }, (_, day) => (
                  <option key={day} value={String(day)}>
                    {words.weekdayName(day)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t('staff.person.paidLeaves')}
            error={errorText('paidLeavesPerMonth', errors.paidLeavesPerMonth?.message)}
          >
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                autoComplete="off"
                {...register('paidLeavesPerMonth')}
              />
            )}
          </Field>
          <Field
            label={t('staff.person.overtimeRate')}
            hint={t('staff.person.overtimeHint')}
            error={errorText('overtimeRatePaise', errors.overtimeRatePaise?.message)}
          >
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                autoComplete="off"
                {...register('overtimeRatePaise')}
              />
            )}
          </Field>
          {withSalary && (
            <div className="grid grid-cols-2 gap-x-3 md:col-span-2 md:max-w-md">
              <Field label={t('staff.person.salaryKind')}>
                {(props) => (
                  <Select {...props} {...register('salaryKind')}>
                    {SALARY_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {t(`staff.salaryCard.${kind}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                label={t('staff.person.salaryAmount')}
                hint={t('staff.person.salaryHint')}
                error={errorText('salaryAmount', errors.salaryAmount?.message)}
              >
                {(props) => (
                  <Input
                    {...props}
                    inputMode="decimal"
                    autoComplete="off"
                    {...register('salaryAmount')}
                  />
                )}
              </Field>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
