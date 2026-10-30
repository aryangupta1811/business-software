import { useTranslation } from 'react-i18next';
import { changeLanguage, LANGUAGES } from '../i18n';

/** One click per language, each name in its own script so anyone can find theirs. */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  return (
    <div
      role="group"
      aria-label={t('language.label')}
      className="flex rounded-md border border-stone-300 text-sm"
    >
      {LANGUAGES.map(({ code, name }) => {
        const current = i18n.language === code;
        return (
          <button
            key={code}
            type="button"
            lang={code}
            aria-pressed={current}
            onClick={() => void changeLanguage(code)}
            className={`px-3 py-1 ${current ? 'bg-stone-900 text-white' : 'hover:bg-stone-100'}`}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}
