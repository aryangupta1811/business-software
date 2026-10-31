import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  const { t } = useTranslation();
  return (
    <>
      <h1 className="text-2xl font-semibold">{t('home.title')}</h1>
      <p className="mt-2 text-stone-600">{t('home.body')}</p>
    </>
  );
}
