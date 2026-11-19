import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';

/**
 * Shows loading, "log in" (401), "not found" (404) or "couldn't load, try again" until every
 * query has its data, then the page.
 */
export function QueryGate({
  queries,
  children,
}: {
  queries: UseQueryResult[];
  children: () => ReactNode;
}) {
  const { t } = useTranslation();
  const failed = queries.find((query) => query.isError);
  if (failed) {
    const status = failed.error instanceof ApiError ? failed.error.status : 0;
    if (status === 401 || status === 404) {
      const key = status === 401 ? 'loggedOut' : 'notFound';
      return (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>{t(`items.${key}.title`)}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted">{t(`items.${key}.body`)}</CardContent>
        </Card>
      );
    }
    return (
      <div role="alert" className="flex max-w-xl flex-col items-start gap-3">
        <p>{t('items.loadFailed')}</p>
        <Button
          variant="secondary"
          onClick={() => {
            for (const query of queries) if (query.isError) void query.refetch();
          }}
        >
          {t('items.retry')}
        </Button>
      </div>
    );
  }
  if (queries.some((query) => query.isPending)) {
    return <p className="text-muted">{t('items.loading')}</p>;
  }
  return children();
}
