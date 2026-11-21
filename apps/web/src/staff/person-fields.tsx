import type { UseFormRegister, FieldErrors as FormErrors } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { PasswordInput } from '../components/password-input';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { useFieldError } from '../lib/field-error';

/** What the Person card edits. `password` is only asked, and only sent, when adding. */
export interface PersonForm {
  name: string;
  username: string;
  password: string;
  homeBranchId: string;
}

/**
 * The Person card's fields (P1.5 design §6): name, username, the home branch (only when the
 * business has more than one) and, when adding, the first password with its show/hide box.
 */
export function PersonFields({
  register,
  errors,
  branches,
  withPassword,
}: {
  register: UseFormRegister<PersonForm>;
  errors: FormErrors<PersonForm>;
  branches: readonly { id: string; name: string }[];
  withPassword: boolean;
}) {
  const { t } = useTranslation();
  const errorText = useFieldError();
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2">
      <Field label={t('staff.person.name')} error={errorText('name', errors.name?.message)}>
        {(props) => <Input {...props} autoComplete="off" {...register('name')} />}
      </Field>
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
    </div>
  );
}
