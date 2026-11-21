import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { NotAllowed } from '../components/not-allowed';
import { Button } from '../components/ui/button';

/**
 * Loading, "You can't open this page" (a 403: the owner's switches changed, and the session is
 * being re-read), or "couldn't load, try again", until every query has its data.
 */
export function LoadGate({
  queries,
  children,
}: {
  queries: UseQueryResult[];
  children: () => ReactNode;
}) {
  const { t } = useTranslation();
  const failed = queries.find((query) => query.isError);
  if (failed) {
    if (failed.error instanceof ApiError && failed.error.status === 403) return <NotAllowed />;
    return (
      <div role="alert" className="flex max-w-xl flex-col items-start gap-3">
        <p>{t('staff.loadFailed')}</p>
        <Button
          variant="secondary"
          onClick={() => {
            for (const query of queries) if (query.isError) void query.refetch();
          }}
        >
          {t('staff.retry')}
        </Button>
      </div>
    );
  }
  if (queries.some((query) => query.isPending)) {
    return <p className="text-muted">{t('staff.loading')}</p>;
  }
  return children();
}
