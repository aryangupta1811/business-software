import { zodResolver } from '@hookform/resolvers/zod';
import {
  BRANCH_STATES,
  branchSchema,
  type BranchInput,
  type BranchView,
} from '@business-software/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { createBranch, updateBranch } from '../api/branches';
import { ApiError } from '../api/client';
import { Dialog, DialogActions } from '../components/ui/dialog';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { useFieldError } from '../lib/field-error';

type Form = z.input<typeof branchSchema>;

/** Inputs hold text, so the blanks the API sends as null start as empty strings. */
const formOf = (branch: BranchView): Form => ({
  name: branch.name,
  code: branch.code,
  address: branch.address ?? '',
  pinCode: branch.pinCode ?? '',
  stateCode: branch.stateCode,
  gstin: branch.gstin ?? '',
  drugLicence: branch.drugLicence ?? '',
  fssai: branch.fssai ?? '',
});

/**
 * Adds a branch, or edits one (P1.6 design §8). A new branch starts in the head office's state
 * with its GSTIN, which the owner can change (a business may hold more than one registration in
 * a state). A business that isn't registered for GST has no GSTIN box.
 */
export function BranchDialog({
  open,
  branch,
  all,
  withGstin,
  onSaved,
  onClose,
}: {
  open: boolean;
  /** The branch being edited; null adds one. */
  branch: BranchView | null;
  all: readonly BranchView[];
  withGstin: boolean;
  onSaved: (saved: BranchView) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      wide
      title={t(branch === null ? 'branches.form.addTitle' : 'branches.form.editTitle')}
      onClose={onClose}
    >
      <BranchForm
        branch={branch}
        all={all}
        withGstin={withGstin}
        onSaved={onSaved}
        onClose={onClose}
      />
    </Dialog>
  );
}

function BranchForm({
  branch,
  all,
  withGstin,
  onSaved,
  onClose,
}: {
  branch: BranchView | null;
  all: readonly BranchView[];
  withGstin: boolean;
  onSaved: (saved: BranchView) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const errorText = useFieldError();
  const [failed, setFailed] = useState(false);
  const head = all.find((row) => row.headOffice);
  const form = useForm<Form, unknown, BranchInput>({
    resolver: zodResolver(branchSchema),
    defaultValues:
      branch !== null
        ? formOf(branch)
        : {
            name: '',
            code: '',
            address: '',
            pinCode: '',
            stateCode: head?.stateCode ?? '',
            gstin: head?.gstin ?? '',
            drugLicence: '',
            fssai: '',
          },
  });
  const { register, formState, setError, setValue, getFieldState } = form;
  const states = BRANCH_STATES.map(({ code }) => ({ code, name: t(`states.${code}`) })).sort(
    (a, b) => a.name.localeCompare(b.name, i18n.language),
  );
  const error = (field: keyof Form) => errorText(field, formState.errors[field]?.message);
  // A branch's short code is not an item's: its own words.
  const codeProblem = formState.errors.code?.message;
  const codeError =
    codeProblem === undefined
      ? undefined
      : codeProblem === 'taken'
        ? t('branches.form.codeTaken')
        : codeProblem === 'required'
          ? t('errors.required')
          : t('branches.form.codeInvalid');

  // Another branch in the chosen state: its GSTIN is the likely one (the first two digits are
  // the state), unless the owner already typed their own.
  const onState = (code: string) => {
    if (branch !== null || getFieldState('gstin', formState).isDirty) return;
    setValue('gstin', all.find((row) => row.stateCode === code && row.gstin !== null)?.gstin ?? '');
  };

  const onSubmit = async (input: BranchInput) => {
    setFailed(false);
    try {
      onSaved(branch === null ? await createBranch(input) : await updateBranch(branch.id, input));
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'code_taken') {
        setError('code', { message: 'taken' });
      } else if (caught instanceof ApiError && caught.code === 'invalid_body') {
        for (const [field, code] of Object.entries(caught.fields)) {
          setError(field as keyof Form, { message: code });
        }
      } else {
        setFailed(true);
      }
    }
  };

  return (
    <form noValidate onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}>
      <div className="grid grid-cols-2 gap-x-5 gap-y-4">
        <Field label={t('branches.form.name')} error={error('name')}>
          {(props) => <Input {...props} autoComplete="off" {...register('name')} />}
        </Field>
        <Field label={t('branches.form.code')} hint={t('branches.form.codeHint')} error={codeError}>
          {(props) => (
            <Input
              {...props}
              autoComplete="off"
              spellCheck={false}
              maxLength={6}
              className="uppercase"
              {...register('code')}
            />
          )}
        </Field>
        <Field label={t('signup.fields.state')} error={error('stateCode')}>
          {(props) => (
            <Select
              {...props}
              {...register('stateCode', {
                onChange: (event: { target: { value: string } }) => {
                  onState(event.target.value);
                },
              })}
            >
              {states.map(({ code, name }) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('settings.business.fields.pinCode')} error={error('pinCode')}>
          {(props) => <Input {...props} inputMode="numeric" {...register('pinCode')} />}
        </Field>
        <div className="col-span-2">
          <Field label={t('settings.business.fields.address')} error={error('address')}>
            {(props) => <Textarea {...props} {...register('address')} />}
          </Field>
        </div>
        {withGstin && (
          <Field
            label={t('settings.business.fields.gstin')}
            hint={t('branches.form.gstinHint')}
            error={error('gstin')}
          >
            {(props) => <Input {...props} className="uppercase" {...register('gstin')} />}
          </Field>
        )}
        <Field label={t('settings.business.fields.drugLicence')} error={error('drugLicence')}>
          {(props) => <Input {...props} {...register('drugLicence')} />}
        </Field>
        <Field label={t('settings.business.fields.fssai')} error={error('fssai')}>
          {(props) => <Input {...props} inputMode="numeric" {...register('fssai')} />}
        </Field>
      </div>
      {failed && (
        <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-4 py-3 text-danger">
          {t('settings.saveFailed')}
        </p>
      )}
      <DialogActions
        onClose={onClose}
        confirm={t(branch === null ? 'branches.form.add' : 'branches.form.save')}
        busy={formState.isSubmitting}
      />
    </form>
  );
}
