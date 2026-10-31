import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

/**
 * Shown when a page fails, e.g. its code couldn't be downloaded. Replaces the router's
 * built-in English screen; reloading fetches the current deploy's files. Renders inside
 * the app's layout, so it has no <main> of its own.
 */
export function RouteError() {
  const { t } = useTranslation();
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{t('error.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted">{t('error.body')}</p>
        <Button
          className="mt-4"
          onClick={() => {
            window.location.reload();
          }}
        >
          {t('error.reload')}
        </Button>
      </CardContent>
    </Card>
  );
}
