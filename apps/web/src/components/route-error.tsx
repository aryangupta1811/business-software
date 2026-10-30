import { useTranslation } from 'react-i18next';

/**
 * Shown when a page fails, e.g. its code couldn't be downloaded. Replaces the router's
 * built-in English screen; reloading fetches the current deploy's files.
 */
export function RouteError() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold">{t('error.title')}</h1>
      <p className="mt-2 text-stone-600">{t('error.body')}</p>
      <button
        type="button"
        onClick={() => {
          window.location.reload();
        }}
        className="mt-4 rounded-md bg-stone-900 px-4 py-2 text-white"
      >
        {t('error.reload')}
      </button>
    </main>
  );
}
