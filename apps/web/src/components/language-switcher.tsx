import { useTranslation } from 'react-i18next';
import { changeLanguage, LANGUAGES } from '../i18n';

/** One click per language, each name in its own script so anyone can find theirs. */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  return (
    <div
      role="group"
      aria-label={t('language.label')}
      className="flex rounded-lg bg-surface-muted p-0.5 text-label"
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
            className={`rounded-md px-3 py-1 font-medium ${current ? 'bg-surface text-foreground shadow-card' : 'text-muted hover:text-foreground'}`}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}
