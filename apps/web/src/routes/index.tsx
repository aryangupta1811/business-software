import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';

export const Route = createFileRoute('/')({
  component: Home,
  staticData: { titleKey: 'nav.home' },
});

function Home() {
  const { t } = useTranslation();
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{t('home.title')}</CardTitle>
      </CardHeader>
      <CardContent className="text-muted">{t('home.body')}</CardContent>
    </Card>
  );
}
