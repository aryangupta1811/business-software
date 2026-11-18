import { useTranslation } from 'react-i18next';

/**
 * The words for an error code on a field: a field's own wording when it has one
 * (`errors.fields.phone.invalid`), otherwise the general one (`errors.invalid`). The API and
 * the shared schemas only ever send codes (ADR 0036).
 */
export function useFieldError(): (field: string, code: string | undefined) => string | undefined {
  const { t, i18n } = useTranslation();
  return (field, code) => {
    if (code === undefined) return undefined;
    // Keys built at run time aren't in i18next's typed key list, hence the casts.
    const own = `errors.fields.${field}.${code}`;
    if (i18n.exists(own)) return t(own as never);
    const general = `errors.${code}`;
    return i18n.exists(general) ? t(general as never) : t('errors.invalid');
  };
}
