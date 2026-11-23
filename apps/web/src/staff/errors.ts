import type { TFunction } from 'i18next';
import type { FieldPath, FieldValues, UseFormSetError } from 'react-hook-form';
import { ApiError } from '../api/client';

/**
 * Puts a refusal under the field it is about: `409 username_taken` under the username, and an
 * `invalid_body` answer's fields (`same_as_username`, `too_short`, …) under theirs. Answers
 * `true` when it did, so the caller knows the failure has been shown.
 */
export function showFieldErrors<Form extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<Form>,
  fields: readonly FieldPath<Form>[],
): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.code === 'username_taken') {
    setError('username' as FieldPath<Form>, { message: 'username_taken' });
    return true;
  }
  if (error.code !== 'invalid_body') return false;
  let shown = false;
  for (const [field, code] of Object.entries(error.fields)) {
    if ((fields as readonly string[]).includes(field)) {
      setError(field as FieldPath<Form>, { message: code });
      shown = true;
    }
  }
  return shown;
}

/** The words for a refusal that isn't about one field. */
export function failureText(t: TFunction, error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'invalid_permissions') return t('staff.errors.invalid_permissions');
    if (error.code === 'not_found') return t('staff.errors.not_found');
    if (error.code === 'marks_before_joining') return t('staff.errors.marks_before_joining');
    if (error.code === 'stale') return t('staff.errors.stale');
    if (error.code === 'forbidden') return t('errors.forbidden');
    if (error.code === 'network') return t('errors.network');
  }
  return t('account.failed');
}
