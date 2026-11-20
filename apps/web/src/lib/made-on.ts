import { useTranslation } from 'react-i18next';

/** "19 November 2026", in the reader's language: the date printed with a recovery key. */
export function useMadeOn(): (date: Date) => string {
  const { i18n } = useTranslation();
  return (date) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(date);
}
