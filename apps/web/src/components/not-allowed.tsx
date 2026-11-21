import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

/** A page this login doesn't hold the permission for: plain words and a way home (P1.5 §6). */
export function NotAllowed() {
  const { t } = useTranslation();
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{t('notAllowed.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-4 text-muted">
        <p>{t('notAllowed.body')}</p>
        <Link to="/" className="text-accent underline-offset-4 hover:underline">
          {t('notAllowed.home')}
        </Link>
      </CardContent>
    </Card>
  );
}
