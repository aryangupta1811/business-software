import 'i18next';
import type en from './locales/en.json';

// English is the source of truth: t('a.key') is a type error unless en.json has it.
declare module 'i18next' {
  interface CustomTypeOptions {
    resources: { translation: typeof en };
  }
}
