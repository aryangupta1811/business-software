import { useTranslation } from 'react-i18next';

// English shows day first ("19 Nov"), as the shop writes it; Hinglish is English letters.
const LOCALES: Record<string, string> = { en: 'en-IN', hi: 'hi-IN', 'hi-Latn': 'en-IN' };

export interface DateWords {
  /** "19 Nov 2026" for `2026-11-19`. */
  day: (date: string) => string;
  /** "Thursday, 19 Nov 2026". */
  fullDay: (date: string) => string;
  /** "November 2026" for `2026-11`. */
  month: (month: string) => string;
  /** "Nov 2026" for `2026-11`. */
  shortMonth: (month: string) => string;
  /** Short weekday names, Sunday first. */
  weekdays: string[];
  /** The full name of weekday 0 (Sunday) to 6. */
  weekdayName: (day: number) => string;
}

/** Dates written in the reader's language. Dates are IST calendar days, so they are read as UTC. */
export function dateWords(language: string): DateWords {
  const locale = LOCALES[language] ?? 'en-IN';
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options });
  const at = (date: string) => new Date(`${date}T00:00:00Z`);
  // 2026-11-01 was a Sunday.
  const sunday = (offset: number) => new Date(Date.UTC(2026, 10, 1 + offset));
  return {
    day: (date) => format({ day: 'numeric', month: 'short', year: 'numeric' }).format(at(date)),
    fullDay: (date) =>
      format({ weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }).format(at(date)),
    month: (month) => format({ month: 'long', year: 'numeric' }).format(at(`${month}-01`)),
    shortMonth: (month) => format({ month: 'short', year: 'numeric' }).format(at(`${month}-01`)),
    weekdays: Array.from({ length: 7 }, (_, day) =>
      format({ weekday: 'short' }).format(sunday(day)),
    ),
    weekdayName: (day) => format({ weekday: 'long' }).format(sunday(day)),
  };
}

export function useDateWords(): DateWords {
  const { i18n } = useTranslation();
  return dateWords(i18n.language);
}
