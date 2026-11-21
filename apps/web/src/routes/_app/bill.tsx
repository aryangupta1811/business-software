import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../api/session';
import { Button } from '../../components/ui/button';
import { Counter } from '../../billing/counter';
import { useBillingContext, useCatalogue } from '../../billing/use-catalogue';
import { QueryGate } from '../../items/query-gate';

/** The billing counter (P1.13): Module 02 #1–#8, design `2026-11-20-p1.13-billing-design.md`. */
export const Route = createFileRoute('/_app/bill')({
  component: Billing,
  staticData: { titleKey: 'nav.billing' },
});

function Billing() {
  const { t } = useTranslation();
  const session = useSession().data;
  const context = useBillingContext();
  const catalogue = useCatalogue();

  return (
    <QueryGate queries={[context]}>
      {() => {
        if (context.data === undefined || session === undefined || session.state === 'none') {
          return null;
        }
        if (catalogue.status === 'loading') {
          return <p className="text-muted">{t('billing.loading')}</p>;
        }
        if (catalogue.status === 'error') {
          return (
            <div role="alert" className="flex items-center gap-4">
              <p>{t('billing.loadFailed')}</p>
              <Button variant="secondary" onClick={() => void catalogue.reload()}>
                {t('billing.tryAgain')}
              </Button>
            </div>
          );
        }
        return (
          <Counter
            session={session}
            context={context.data}
            copy={catalogue.copy}
            version={catalogue.version}
          />
        );
      }}
    </QueryGate>
  );
}
