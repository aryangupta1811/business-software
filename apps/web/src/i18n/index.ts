import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import hiLatn from './locales/hi-Latn.json';
import hi from './locales/hi.json';

/** BCP 47 codes. Hinglish is Hindi written in Latin letters: `hi-Latn`. */
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'hi-Latn', name: 'Hinglish' },
] as const;

export type Language = (typeof LANGUAGES)[number]['code'];

const STORAGE_KEY = 'language';

function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some(({ code }) => code === value);
}

/**
 * The language chosen earlier on this computer, or English. Moves to the user's profile
 * once logins exist (P1.4). Storage can throw (blocked site data), so that means English.
 */
export function readSavedLanguage(storage?: Pick<Storage, 'getItem'>): Language {
  try {
    const saved = (storage ?? localStorage).getItem(STORAGE_KEY);
    return isLanguage(saved) ? saved : 'en';
  } catch {
    return 'en';
  }
}

export async function changeLanguage(language: Language): Promise<void> {
  await i18n.changeLanguage(language);
  document.documentElement.lang = language;
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Not saved, so the next visit starts in English; switching still works now.
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    hi: { translation: hi },
    'hi-Latn': { translation: hiLatn },
  },
  lng: readSavedLanguage(),
  supportedLngs: LANGUAGES.map(({ code }) => code),
  fallbackLng: 'en',
  // Without this, a missing hi-Latn string would fall back to hi (Devanagari) before en.
  load: 'currentOnly',
  // Resources are bundled, so start synchronously: the first render is already translated.
  initAsync: false,
  // React already escapes text it renders.
  interpolation: { escapeValue: false },
});
document.documentElement.lang = i18n.language;

export { i18n };
