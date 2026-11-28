import { createFileRoute } from '@tanstack/react-router';
import { CustomersPage } from '../../udhaar/customers-page';

/**
 * Module 03: who owes what, the overview (overdue buckets, collected, who owes most) and the
 * reminder list, and the way into each customer's udhaar (P1.18 design §7, P1.19).
 */
export const Route = createFileRoute('/_app/customers/')({
  component: Customers,
  staticData: { titleKey: 'nav.customers', permission: 'customers.view' },
  validateSearch: (search: Record<string, unknown>): { tab?: 'reminders' } =>
    search.tab === 'reminders' ? { tab: 'reminders' } : {},
});

function Customers() {
  const { tab } = Route.useSearch();
  return <CustomersPage tab={tab ?? 'all'} />;
}
